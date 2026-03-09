"""
planner_agent.py — Policy-Driven Planning Agent with Real-Time Web Retrieval

Architecture (v3 — Dynamic Schema-Driven Workflows):

  Phase 1: Intent & Domain Resolution  (~0.5s)
    User query → keyword extraction → PolicyEngine → allowed domains

  Phase 2: Dynamic Web Retrieval  (~2-4s)
    DuckDuckGo site-search → fetch top pages → HTML→markdown conversion
    All gated by Access Restriction Policy (only whitelisted domains)

  Phase 3: Context Compilation & LLM Generation  (~5-8s)
    Token-budgeted context → system prompt + history → LLM → parsed response

  Total target: ~8-12 seconds (down from ~120 seconds with local RAG)

Key changes in v3:
  - Dynamic schema-driven node data: each block_type now carries its own
    structured payload (actionType, method, headers, rules, code, etc.)
  - Variable interpolation: {{node_id.output_key}} syntax for cross-node data flow
  - Pydantic-compatible dataclasses matching the TypeScript interfaces exactly
"""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

import httpx

from policy_engine import PolicyEngine
from retrieval_router import RetrievalRouter
from conversation_manager import ConversationManager


logger = logging.getLogger("planner_agent")

# ─── Types ──────────────────────────────────────────────


@dataclass
class ConversationMessage:
    """A single message in the conversation history."""
    role: Literal["user", "assistant"]
    content: str


# ─── Dynamic Schema Sub-Types ───────────────────────────

@dataclass
class HeaderEntry:
    """A single HTTP header key-value pair."""
    key: str
    value: str

    def to_dict(self) -> dict:
        return {"key": self.key, "value": self.value}


@dataclass
class ExecutionSettings:
    """Execution settings for an action block."""
    timeoutMs: int = 30000
    maxRetries: int = 3
    continueOnError: bool = False

    def to_dict(self) -> dict:
        return {
            "timeoutMs": self.timeoutMs,
            "maxRetries": self.maxRetries,
            "continueOnError": self.continueOnError,
        }


@dataclass
class ConditionalRule:
    """A single rule in a conditional block."""
    variable: str
    operator: str
    compareValue: str

    def to_dict(self) -> dict:
        return {
            "variable": self.variable,
            "operator": self.operator,
            "compareValue": self.compareValue,
        }


@dataclass
class CodeInputBinding:
    """An input binding for a code block."""
    envKey: str
    mappedValue: str

    def to_dict(self) -> dict:
        return {"envKey": self.envKey, "mappedValue": self.mappedValue}


@dataclass
class OutputMappingEntry:
    """An output mapping for a result block."""
    outputKey: str
    mappedValue: str

    def to_dict(self) -> dict:
        return {"outputKey": self.outputKey, "mappedValue": self.mappedValue}


@dataclass
class ParamEntry:
    """A parameter definition for a parameter block."""
    key: str
    type: str = "String"  # String | Number | Boolean | JSON
    defaultValue: Any = ""
    required: bool = True

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "type": self.type,
            "defaultValue": self.defaultValue,
            "required": self.required,
        }


# ─── Block-Specific Payloads ────────────────────────────

@dataclass
class ActionBlockPayload:
    """Payload for action_block — matches ActionNodeData."""
    actionType: str = ""
    endpointOrTool: str = ""
    method: str = "GET"
    headers: list[HeaderEntry] = field(default_factory=list)
    payload: str = ""
    executionSettings: ExecutionSettings = field(default_factory=ExecutionSettings)

    def to_dict(self) -> dict:
        return {
            "actionType": self.actionType,
            "endpointOrTool": self.endpointOrTool,
            "method": self.method,
            "headers": [h.to_dict() for h in self.headers],
            "payload": self.payload,
            "executionSettings": self.executionSettings.to_dict(),
        }


@dataclass
class ConditionalBlockPayload:
    """Payload for conditional_block — matches ConditionalNodeData."""
    logicalOperator: str = "AND"  # AND | OR
    rules: list[ConditionalRule] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "logicalOperator": self.logicalOperator,
            "rules": [r.to_dict() for r in self.rules],
        }


@dataclass
class CodeBlockPayload:
    """Payload for code_block — matches CodeNodeData."""
    language: str = "Python"  # Python | JavaScript
    code: str = ""
    inputBindings: list[CodeInputBinding] = field(default_factory=list)
    outputBindings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "language": self.language,
            "code": self.code,
            "inputBindings": [b.to_dict() for b in self.inputBindings],
            "outputBindings": self.outputBindings,
        }


@dataclass
class NotifyBlockPayload:
    """Payload for notification_block — matches NotifyNodeData."""
    channel: str = "Email"
    recipients: list[str] = field(default_factory=list)
    subject: str = ""
    messageTemplate: str = ""

    def to_dict(self) -> dict:
        return {
            "channel": self.channel,
            "recipients": self.recipients,
            "subject": self.subject,
            "messageTemplate": self.messageTemplate,
        }


@dataclass
class ResultBlockPayload:
    """Payload for result_block — matches ResultNodeData."""
    status: str = "Success"  # Success | Failure
    outputMapping: list[OutputMappingEntry] = field(default_factory=list)
    terminateExecution: bool = True

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "outputMapping": [m.to_dict() for m in self.outputMapping],
            "terminateExecution": self.terminateExecution,
        }


@dataclass
class ParameterBlockPayload:
    """Payload for parameter_block — matches ParamNodeData."""
    parameters: list[ParamEntry] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "parameters": [p.to_dict() for p in self.parameters],
        }


# Valid block types for Canvas rendering
VALID_BLOCK_TYPES = {
    "action_block",
    "conditional_block",
    "result_block",
    "parameter_block",
    "notification_block",
    "code_block",
}


@dataclass
class WorkflowStep:
    """A single step in an actionable workflow, mapped to a Canvas block.

    block_type must be one of:
      action_block, conditional_block, result_block,
      parameter_block, notification_block, code_block.

    Each step carries a typed payload matching its block_type.
    Supports {{variable}} interpolation syntax for cross-node data flow.
    """
    step_number: int
    title: str
    description: str
    block_type: str = "action_block"

    # Dynamic schema payloads — only one should be populated per step
    action_payload: Optional[ActionBlockPayload] = None
    conditional_payload: Optional[ConditionalBlockPayload] = None
    code_payload: Optional[CodeBlockPayload] = None
    notify_payload: Optional[NotifyBlockPayload] = None
    result_payload: Optional[ResultBlockPayload] = None
    parameter_payload: Optional[ParameterBlockPayload] = None

    # Legacy fields for backward compat
    action_type: str = ""
    parameters_used: dict = field(default_factory=lambda: {"floating": [], "fixed": []})
    condition: Optional[str] = None
    on_true_step: Optional[int] = None
    on_false_step: Optional[int] = None

    def to_dict(self) -> dict:
        d: dict[str, Any] = {
            "step_number": self.step_number,
            "title": self.title,
            "description": self.description,
            "block_type": self.block_type,
            "action_type": self.action_type,
            "parameters_used": self.parameters_used,
        }
        if self.condition is not None:
            d["condition"] = self.condition
        if self.on_true_step is not None:
            d["on_true_step"] = self.on_true_step
        if self.on_false_step is not None:
            d["on_false_step"] = self.on_false_step

        # Attach typed payload
        if self.action_payload:
            d["action_payload"] = self.action_payload.to_dict()
        if self.conditional_payload:
            d["conditional_payload"] = self.conditional_payload.to_dict()
        if self.code_payload:
            d["code_payload"] = self.code_payload.to_dict()
        if self.notify_payload:
            d["notify_payload"] = self.notify_payload.to_dict()
        if self.result_payload:
            d["result_payload"] = self.result_payload.to_dict()
        if self.parameter_payload:
            d["parameter_payload"] = self.parameter_payload.to_dict()

        return d


@dataclass
class WorkflowParameter:
    """A workflow parameter — floating (user-decided at runtime) or fixed (standard/known).

    param_type:
      "floating" — value decided by the user at runtime (e.g., bucket_name, vpc_id).
                    Rendered as {{param_name}} placeholders in workflow steps.
      "fixed"    — standard value that doesn't typically change (e.g., protocol=tcp, port=443).
                    Provided directly with a concrete value.
    """
    name: str
    param_type: str = "floating"   # "floating" | "fixed"
    value: Optional[str] = None
    description: str = ""

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "param_type": self.param_type,
            "value": self.value,
            "description": self.description,
        }


@dataclass
class MissingParameterAudit:
    """A missing parameter with the source quote proving it's required."""
    parameter: str
    source_quote: str
    default_value: str = ""
    required: bool = True
    category: str = "mandatory"

    def to_dict(self) -> dict:
        return {
            "parameter": self.parameter,
            "source_quote": self.source_quote,
            "default_value": self.default_value,
            "required": self.required,
            "category": self.category,
        }


@dataclass
class PlannerResponse:
    """Response from the Planner Agent → Frontend."""
    message_to_user: str
    intent: str = "question"  # "question", "clarification", or "action"
    steps: list[WorkflowStep] = field(default_factory=list)
    workflow_parameters: list[WorkflowParameter] = field(default_factory=list)
    missing_parameters_audit: list[MissingParameterAudit] = field(default_factory=list)
    rag_citations: list[str] = field(default_factory=list)
    session_id: str = ""

    def to_dict(self) -> dict:
        result: dict[str, Any] = {
            "message_to_user": self.message_to_user,
            "intent": self.intent,
            "steps": [s.to_dict() for s in self.steps],
            "workflow_parameters": {
                "floating": [
                    p.to_dict() for p in self.workflow_parameters
                    if p.param_type == "floating"
                ],
                "fixed": [
                    p.to_dict() for p in self.workflow_parameters
                    if p.param_type == "fixed"
                ],
            },
            "rag_citations": self.rag_citations,
            "session_id": self.session_id,
        }
        if self.missing_parameters_audit:
            result["missing_parameters_audit"] = [
                m.to_dict() for m in self.missing_parameters_audit
            ]
        return result


# ─── Variable Interpolation Utility ─────────────────────

def interpolate_variables(template: str, state: dict[str, Any]) -> str:
    """
    Replace {{variable}} placeholders in a string with actual values
    from the runtime state dictionary.

    Supports:
      - Simple variables: {{bucket_name}} → state["bucket_name"]
      - Dotted paths:     {{node_123.output_key}} → state["node_123"]["output_key"]

    If a variable is not found in state, it is left as-is (unreplaced).
    """
    def _replacer(match: re.Match) -> str:
        var_path = match.group(1).strip()

        # Handle dotted paths: {{node_id.field}}
        parts = var_path.split(".")
        current: Any = state

        for part in parts:
            if isinstance(current, dict) and part in current:
                current = current[part]
            else:
                # Variable not found — leave the placeholder as-is
                return match.group(0)

        return str(current)

    return re.sub(r"\{\{(.+?)\}\}", _replacer, template)


# ─── System Prompt ──────────────────────────────────────

SYSTEM_PROMPT = """You are the **Systems Architect** — a rigorous workflow designer for a multi-agent cloud infrastructure orchestration engine.

## YOUR ROLE
You receive a user's request along with LIVE DOCUMENTATION retrieved in real-time from approved websites.
Your job is to:
1. Analyze the user's intent.
2. Cross-reference it with the provided documentation context.
3. Design a precise, step-by-step executable workflow expressed as interconnected blocks.

Your output will be consumed by a Canvas Agent (A2UI protocol) to visually render the workflow,
and ultimately executed by a Coding Agent. Precision is paramount.

## BLOCK TYPES & DYNAMIC SCHEMAS
Every step MUST use one of these block types and include its corresponding typed payload:

### action_block
An API call or infrastructure action. Include the `action_payload` object:
```json
{
  "action_payload": {
    "actionType": "create | configure | deploy | validate",
    "endpointOrTool": "https://api.example.com/v1/{{resource_id}}/action",
    "method": "POST",
    "headers": [{"key": "Authorization", "value": "Bearer {{api_token}}"}],
    "payload": "{\\"name\\": \\"{{bucket_name}}\\"}",
    "executionSettings": {"timeoutMs": 30000, "maxRetries": 3, "continueOnError": false}
  }
}
```

### conditional_block
A branching decision point. Include `conditional_payload`:
```json
{
  "conditional_payload": {
    "logicalOperator": "AND",
    "rules": [{"variable": "{{node_1.status}}", "operator": "==", "compareValue": "200"}]
  },
  "condition": "{{node_1.status}} == 200",
  "on_true_step": 3,
  "on_false_step": 4
}
```

### code_block
Custom code execution. Include `code_payload`:
```json
{
  "code_payload": {
    "language": "Python",
    "code": "import json\\nresult = json.loads(input_data)\\noutput = result['items']",
    "inputBindings": [{"envKey": "input_data", "mappedValue": "{{node_2.response_body}}"}],
    "outputBindings": ["processed_items"]
  }
}
```

### notification_block
Sends alerts. Include `notify_payload`:
```json
{
  "notify_payload": {
    "channel": "Slack",
    "recipients": ["#engineering-alerts"],
    "subject": "Deployment: {{workflow_name}}",
    "messageTemplate": "Workflow completed. Status: {{node_5.status}}. Results: {{node_4.output}}"
  }
}
```

### result_block
Terminal step. Include `result_payload`:
```json
{
  "result_payload": {
    "status": "Success",
    "outputMapping": [{"outputKey": "final_result", "mappedValue": "{{node_3.output}}"}],
    "terminateExecution": true
  }
}
```

### parameter_block
Defines workflow inputs. Include `parameter_payload`:
```json
{
  "parameter_payload": {
    "parameters": [
      {"key": "bucket_name", "type": "String", "defaultValue": "", "required": true},
      {"key": "max_retries", "type": "Number", "defaultValue": 3, "required": false}
    ]
  }
}
```

## VARIABLE INTERPOLATION
Use the `{{variable}}` syntax to pass data between nodes:
- **Simple**: `{{bucket_name}}` — references a workflow parameter
- **Cross-node**: `{{node_1.response_body}}` — references output from node_1
- **Nested**: `{{node_2.data.items[0].id}}` — deep path reference

Always use interpolation in: `endpointOrTool`, `payload`, `headers[].value`, `messageTemplate`, `code`, `rules[].variable`, `outputMapping[].mappedValue`.

## PARAMETER CLASSIFICATION
You MUST classify every parameter into one of two categories:
- **floating**: Parameters whose values are decided by the user at runtime.
  Examples: "bucket_name", "vpc_id", "instance_type", "number_of_rules".
  These become `{{param_name}}` placeholders in step descriptions.
- **fixed**: Parameters with standard, well-known values that rarely change.
  Examples: "protocol": "tcp", "cidr_block": "10.0.0.0/16", "port": 443.
  Provide their concrete values directly.

## OUTPUT FORMAT
You MUST output ONLY a valid JSON object. No markdown, no commentary, no code fences — just raw JSON.

Use this exact schema:
{
  "intent": "<action | question | clarification>",
  "message_to_user": "<A natural-language summary of the designed workflow or your answer>",
  "workflow_parameters": {
    "floating": [
      {"name": "param_name", "description": "What this parameter controls", "value": null}
    ],
    "fixed": [
      {"name": "param_name", "description": "What this parameter controls", "value": "known_value"}
    ]
  },
  "steps": [
    {
      "step_number": 1,
      "title": "Step Title",
      "description": "Detailed description using {{param_name}} for floating parameters.",
      "block_type": "action_block",
      "action_type": "create | configure | validate | execute | notify",
      "parameters_used": {
        "floating": ["param_name_1"],
        "fixed": ["param_name_2"]
      },
      "action_payload": { ... }
    }
  ]
}

## RULES
1. **JSON ONLY** — Your entire response must be a single valid JSON object. No text before or after.
2. **Use the documentation** — Base your workflow on the provided web documentation. If the docs are insufficient, state so in `message_to_user` but still output valid JSON with `"intent": "question"` and an empty `steps` array.
3. **Every step needs a block_type** — No step may omit its `block_type`.
4. **Every step needs its typed payload** — Include the corresponding `*_payload` object for each block_type.
5. **Floating vs Fixed** — Classify parameters correctly. User-specific values are floating; standard/default values are fixed.
6. **Conditional blocks** — Must include `condition`, `on_true_step`, and `on_false_step`.
7. **For simple questions** — If the user asks a general question (not a workflow request), respond with `"intent": "question"` and put your answer in `message_to_user`. The `steps` array MUST be empty `[]`.
8. **Task fidelity** — Design steps ONLY for the exact task requested. Never expand scope.
9. **Existing resources** — If the user mentions a resource by name, ASSUME IT EXISTS. Do not add creation steps for it.
10. **Variable interpolation** — Use `{{node_X.output_key}}` to wire data between steps. Use `{{param_name}}` for user parameters."""


# ─── Template Injection Prompt ──────────────────────────

TEMPLATE_INJECTION_PROMPT = """

## ⚠️ WORKFLOW TEMPLATE PROVIDED — STRICT BLUEPRINT MODE

The user has provided a structured YAML Workflow Template below.
You MUST treat this template as the **absolute source of truth** and **strict blueprint** for the workflow.

### MANDATORY TEMPLATE RULES:
1. **Inputs → ParamNode**: Parse every `inputs` entry defined in the template.
   Map each input EXACTLY to the `parameter_block` dynamic schema with `parameter_payload`.
   Preserve the input's `name`, `type` (map to String/Number/Boolean/JSON), `default` (as defaultValue), and `required` flag.

2. **Steps → Block Mapping**: Follow the `steps` outlined in the template **chronologically**.
   Map each step to the appropriate block_type based on its `type` field:
   - `action` / `api_call` / `http` → `action_block` with `action_payload`
   - `condition` / `check` / `branch` / `if` → `conditional_block` with `conditional_payload`
   - `code` / `script` / `transform` / `compute` → `code_block` with `code_payload`
   - `notify` / `alert` / `notification` / `email` / `slack` → `notification_block` with `notify_payload`
   - `result` / `output` / `return` / `done` → `result_block` with `result_payload`
   - `parameter` / `input` / `config` → `parameter_block` with `parameter_payload`

3. **Variable Interpolation**: Ensure ALL variables are wired correctly between nodes:
   - Use `{{input_name}}` for template-defined inputs (from the `inputs` section)
   - Use `{{step_N.output_key}}` for cross-step data flow
   - Wire every `input_from` / `depends_on` / `uses` reference in the template to the correct interpolation path

4. **Rules & Constraints**: If the template includes `rules`, `constraints`, or `requirements`:
   - Obey them STRICTLY — they override any default behavior
   - Include timeout, retry, and error-handling settings as specified
   - Add conditional_block nodes for any explicit error-handling or branching rules

5. **Do not hallucinate steps**: Only generate steps that are explicitly defined in the template.
   Do NOT add extra steps, remove steps, or reorder steps unless the template explicitly instructs branching.

6. **Step metadata**: Preserve the template's step `name`/`title` as the step title,
   and use the `description` field verbatim (with {{variable}} substitution) as the step description.

### USER TEMPLATE INSTRUCTIONS:
```yaml
{template_content}
```

You MUST generate a workflow that EXACTLY follows this template. Any deviation is a failure.
"""


# ─── LLM Configuration ─────────────────────────────────

@dataclass
class LLMConfig:
    """Configuration for the LLM backend. Designed to be swapped
    between dev (8B local) and production (70B cluster)."""

    model: str = "llama3.1:8b"
    base_url: str = "http://localhost:11434"
    temperature: float = 0.2
    top_p: float = 0.9
    num_ctx: int = 32768
    num_predict: int = 2048
    timeout: float = 120.0

    @classmethod
    def development(cls):
        """Dev config: Llama 3.1 8B, local Ollama."""
        return cls(
            model="llama3.1:8b",
            base_url="http://localhost:11434",
            temperature=0.2,
            top_p=0.9,
            num_ctx=32768,
            num_predict=2048,
            timeout=300.0,
        )

    @classmethod
    def enterprise(cls):
        """Production config: Llama 3.3 70B on vLLM/TGI cluster."""
        return cls(
            model="llama3.3:70b",
            base_url="http://localhost:8080",
            temperature=0.15,
            top_p=0.85,
            num_ctx=65536,
            num_predict=4096,
            timeout=180.0,
        )


# ─── Planner Agent ──────────────────────────────────────

class PlannerAgent:
    """
    Policy-driven planning agent with real-time web retrieval.

    Architecture (v3 — Dynamic Schema):
    1. User query → intent detection → domain resolution (PolicyEngine)
    2. DuckDuckGo site-search → fetch approved pages → HTML→markdown
    3. Token-budgeted context → system prompt → LLM → structured response
    4. Parse response into typed WorkflowStep payloads with interpolation support

    No local vector database required.
    All web access governed by Access Restriction Policy.
    """

    def __init__(
        self,
        policy_engine: PolicyEngine,
        retrieval_router: RetrievalRouter,
        llm_config: Optional[LLMConfig] = None,
    ):
        self.policy = policy_engine
        self.retrieval = retrieval_router
        self.llm_config = llm_config or LLMConfig.development()
        self.conversation_manager = ConversationManager()
        self._http = httpx.Client(timeout=10.0)

        logger.info(
            "PlannerAgent v3 initialized (model=%s, num_ctx=%d, policy=%s)",
            self.llm_config.model,
            self.llm_config.num_ctx,
            [r.domain for r in policy_engine.get_allowed_domains()],
        )

    # ── Main entry point ──────────────────────────────

    async def process_message(
        self,
        user_message: str,
        conversation_history: list[ConversationMessage],
        attached_files: Optional[list[str]] = None,
        session_id: Optional[str] = None,
        use_rag: bool = True,
        model_override: Optional[str] = None,
        template_content: Optional[str] = None,
    ) -> PlannerResponse:
        """
        Process a user message and return a response.

        Steps:
        1. Get/create conversation session
        2. Update rolling summary (compress old messages)
        3. Detect command mode (\\search, \\create, general)
        4. Real-time web retrieval (policy-gated)
        5. Build prompt: system + history + web context + user message
        6. Call LLM
        7. Parse and return structured response with typed payloads
        """
        # ── Step 1: Session management ──
        sid = session_id or "default"
        session = self.conversation_manager.get_or_create_session(sid)
        turn = session.turn_count + 1
        session.turn_count = turn

        # Track attached files
        if attached_files:
            session.attached_files.update(attached_files)
            logger.info("Session %s: attached %d file(s)", sid, len(attached_files))

        # ── Step 2: Detect command mode ──
        search_match = re.match(r'^\\\\?search\s+(.+)', user_message, re.IGNORECASE | re.DOTALL)
        create_match = re.match(r'^\\\\?create\s+(.+)', user_message, re.IGNORECASE | re.DOTALL)

        if search_match:
            command_mode = "search"
            task_text = search_match.group(1).strip()
            logger.info("COMMAND MODE: \\search — task: %s", task_text[:80])
        elif create_match:
            command_mode = "create"
            task_text = create_match.group(1).strip()
            logger.info("COMMAND MODE: \\create — task: %s", task_text[:80])
        else:
            command_mode = "general"
            task_text = user_message
            logger.info("COMMAND MODE: general conversation")

        # ── Step 3: Rolling summary ──
        history_dicts = [
            {"role": msg.role, "content": msg.content}
            for msg in conversation_history
        ]
        if session.rolling_summary.needs_update(len(history_dicts)):
            self.conversation_manager.update_rolling_summary(
                session, history_dicts
            )

        # ── Step 4: Web retrieval (policy-gated) ──
        web_context_text = ""
        web_citations: list[str] = []

        # Determine whether to do web retrieval
        do_retrieve = False
        if command_mode == "search":
            do_retrieve = True
        elif command_mode == "create":
            has_prior_search = any(
                "search_results" in msg.get("content", "") or
                "\\search" in msg.get("content", "") or
                "parameters_found" in msg.get("content", "")
                for msg in history_dicts
            )
            if has_prior_search:
                logger.info("\\create with prior \\search — using chat context (no new retrieval)")
                do_retrieve = False

                prior_search_response = None
                for msg in reversed(history_dicts):
                    content = msg.get("content", "")
                    if msg.get("role") == "assistant" and (
                        "parameters_found" in content or
                        "search_results" in content or
                        "Mandatory Parameters" in content or
                        "mandatory" in content.lower()
                    ):
                        prior_search_response = content
                        break

                if prior_search_response:
                    web_context_text = (
                        "\n\n<SchemaReference>\n"
                        "THE FOLLOWING IS THE AUTHORITATIVE PARAMETER LIST FROM THE PRIOR \\search COMMAND.\n"
                        "Use ONLY this reference to validate the user's parameters.\n"
                        "Do NOT add, remove, or modify any parameters from this list.\n\n"
                        f"{prior_search_response}\n"
                        "</SchemaReference>\n"
                    )
                    logger.info(
                        "Injected SchemaReference from prior \\search (%d chars)",
                        len(prior_search_response),
                    )
            else:
                logger.info("\\create cold start — performing web retrieval")
                do_retrieve = True
        else:
            do_retrieve = use_rag

        if do_retrieve:
            raw_query = task_text if command_mode in ("search", "create") else user_message
            search_query = self._refine_query(raw_query)

            logger.info("═" * 60)
            logger.info("  POLICY-DRIVEN WEB RETRIEVAL: Starting")
            logger.info("  Query: '%s…'", search_query[:60])
            logger.info("═" * 60)

            retrieval_result = await self.retrieval.retrieve(search_query)

            if retrieval_result.documents:
                web_context_text = self.retrieval.format_context_for_prompt(retrieval_result)
                web_citations = retrieval_result.citations
                logger.info(
                    "Web retrieval: %d documents, %d chars context, %.0fms",
                    len(retrieval_result.documents),
                    len(web_context_text),
                    retrieval_result.total_retrieval_ms,
                )
            else:
                logger.warning("Web retrieval returned no documents")
                if retrieval_result.error:
                    logger.warning("Retrieval error: %s", retrieval_result.error)

            if retrieval_result.domains_blocked:
                logger.warning(
                    "Domains blocked by policy: %s",
                    retrieval_result.domains_blocked,
                )

        elif not do_retrieve and command_mode != "create":
            logger.info("Web retrieval disabled for this request — direct mode")

        # Note about attached files
        attached_note = ""
        if attached_files:
            file_list = ", ".join(attached_files)
            attached_note = f"\n\n📎 The user just attached: {file_list}\n"

        # ── Step 5: Select system prompt ──
        system_prompt = SYSTEM_PROMPT

        # ── Step 5b: Inject workflow template if provided ──
        if template_content and template_content.strip():
            template_block = TEMPLATE_INJECTION_PROMPT.replace(
                "{template_content}", template_content.strip()
            )
            system_prompt = system_prompt + template_block
            logger.info(
                "Template injected into system prompt (%d chars template, %d chars total prompt)",
                len(template_content),
                len(system_prompt),
            )

        # ── Step 6: Build prompt ──
        messages = self.conversation_manager.build_optimized_messages(
            session=session,
            system_prompt=system_prompt,
            user_message=user_message,
            conversation_history=history_dicts,
            rag_context=web_context_text,
            attached_note=attached_note,
            context_budget_tokens=self.llm_config.num_ctx,
        )

        # ── Step 7: Call LLM with validation + retry ──
        original_model = None
        if model_override and model_override != self.llm_config.model:
            original_model = self.llm_config.model
            self.llm_config.model = model_override
            logger.info("Model override: %s → %s", original_model, model_override)

        max_retries = 2
        response = None

        try:
            for attempt in range(1 + max_retries):
                raw_response = await self._call_ollama(messages)

                try:
                    response = self._parse_llm_response(raw_response, web_citations)
                    break  # ✓ Valid JSON parsed — exit retry loop

                except json.JSONDecodeError as e:
                    error_detail = str(e)
                    if attempt < max_retries:
                        logger.warning(
                            "JSON parse failed (attempt %d/%d): %s — retrying",
                            attempt + 1, 1 + max_retries, error_detail,
                        )
                        messages.append({"role": "assistant", "content": raw_response})
                        messages.append({
                            "role": "user",
                            "content": (
                                "Your output was invalid JSON. "
                                f"Fix the following error: {error_detail}\n\n"
                                "Output ONLY valid JSON. No markdown, no code fences, "
                                "no commentary. Just a raw JSON object."
                            ),
                        })
                    else:
                        logger.error(
                            "JSON parse failed after %d attempts — "
                            "falling back to raw text response.",
                            1 + max_retries,
                        )
                        response = PlannerResponse(
                            message_to_user=raw_response.strip(),
                            intent="question",
                            rag_citations=web_citations,
                        )
        finally:
            if original_model:
                self.llm_config.model = original_model

        # ── Step 8: Return ──
        response.session_id = sid

        logger.info(
            "Turn %d complete (mode=%s): %d citations, session=%s",
            turn, command_mode, len(web_citations), sid,
        )
        return response

    # ── Query refinement ──────────────────────────────

    @staticmethod
    def _refine_query(user_message: str) -> str:
        """
        Refine a user's conversational message into a focused search query.
        """
        query = user_message.strip()

        prefixes = [
            r"^(?:hey|hi|hello|howdy)\s*[,!.]?\s*",
            r"^(?:so|well|ok|okay|now)\s*[,]?\s*",
            r"^(?:can you|could you|please|I need to|I want to|help me)\s+",
            r"^(?:I was thinking about|I'm trying to|I'd like to)\s+",
            r"^(?:what is|what are|how to|how do I)\s+",
        ]
        for pattern in prefixes:
            query = re.sub(pattern, "", query, flags=re.IGNORECASE)

        query = query.strip()

        if len(query.split()) < 3 and len(user_message.split()) >= 3:
            return user_message

        return query if query else user_message

    # ── LLM call ──────────────────────────────────────

    async def _call_ollama(self, messages: list[dict]) -> str:
        """Send messages to the Ollama API and return the response text."""
        url = f"{self.llm_config.base_url}/api/chat"
        payload = {
            "model": self.llm_config.model,
            "messages": messages,
            "stream": False,
            "options": {
                "num_ctx": self.llm_config.num_ctx,
                "num_predict": self.llm_config.num_predict,
                "temperature": self.llm_config.temperature,
                "top_p": self.llm_config.top_p,
                "repeat_penalty": 1.15,
            },
        }

        total_chars = sum(len(m.get("content", "")) for m in messages)
        est_tokens = total_chars // 4
        logger.info(
            "Calling %s with %d messages (~%d tokens), num_ctx=%d",
            self.llm_config.model, len(messages), est_tokens,
            self.llm_config.num_ctx,
        )

        try:
            async with httpx.AsyncClient(timeout=self.llm_config.timeout) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()

            result = resp.json()
            content = result.get("message", {}).get("content", "")

            eval_count = result.get("eval_count", 0)
            prompt_eval_count = result.get("prompt_eval_count", 0)
            if eval_count or prompt_eval_count:
                logger.info(
                    "LLM usage: prompt=%d tokens, completion=%d tokens, total=%d",
                    prompt_eval_count, eval_count,
                    prompt_eval_count + eval_count,
                )

            logger.info("LLM response received (%d chars)", len(content))
            return content

        except httpx.ConnectError:
            logger.error("Cannot connect to LLM at %s", self.llm_config.base_url)
            raise ConnectionError(
                f"Cannot connect to LLM. Ensure it is running at {self.llm_config.base_url}"
            )
        except httpx.HTTPStatusError as e:
            logger.error("LLM HTTP error: %s", e)
            raise RuntimeError(f"LLM API error: {e.response.status_code}")
        except Exception as e:
            logger.error("Unexpected LLM error: %s", e)
            raise

    def _parse_llm_response(
        self,
        raw_response: str,
        web_citations: list[str],
    ) -> PlannerResponse:
        """
        Extract and parse a JSON object from the LLM's raw output,
        then map it into typed PlannerResponse / WorkflowStep dataclasses
        with dynamic schema payloads.
        """
        text = raw_response.strip()

        # Step 1: Strip markdown code fences
        fence_match = re.search(r'```(?:json)?\s*(\{.*\})\s*```', text, re.DOTALL)
        if fence_match:
            text = fence_match.group(1).strip()
            logger.debug("Stripped markdown code fence from LLM response")

        # Step 2: Extract JSON object
        first_brace = text.find('{')
        last_brace = text.rfind('}')

        if first_brace == -1 or last_brace == -1 or last_brace <= first_brace:
            logger.warning("No JSON object boundaries found in LLM response")
            raise json.JSONDecodeError(
                "No JSON object found in response", text, 0
            )

        if first_brace > 0:
            preamble = text[:first_brace].strip()
            if preamble:
                logger.debug(
                    "Stripped preamble before JSON (%d chars): %s…",
                    len(preamble), preamble[:80],
                )

        json_text = text[first_brace:last_brace + 1]

        # Step 3: Parse
        data = json.loads(json_text)

        # Step 4: Map into dataclasses
        message = data.get("message_to_user", "")
        intent = data.get("intent", "question")

        if intent not in ("question", "action", "clarification"):
            intent = "action" if data.get("steps") else "question"

        # ── Workflow parameters (floating + fixed) ──
        workflow_params: list[WorkflowParameter] = []
        raw_params = data.get("workflow_parameters", {})

        if isinstance(raw_params, dict):
            for p in raw_params.get("floating", []):
                if isinstance(p, dict):
                    workflow_params.append(WorkflowParameter(
                        name=p.get("name", ""),
                        param_type="floating",
                        value=p.get("value"),
                        description=p.get("description", ""),
                    ))
            for p in raw_params.get("fixed", []):
                if isinstance(p, dict):
                    workflow_params.append(WorkflowParameter(
                        name=p.get("name", ""),
                        param_type="fixed",
                        value=p.get("value"),
                        description=p.get("description", ""),
                    ))
        elif isinstance(raw_params, list):
            for p in raw_params:
                if isinstance(p, dict):
                    workflow_params.append(WorkflowParameter(
                        name=p.get("name", ""),
                        param_type=p.get("param_type", "floating"),
                        value=p.get("value"),
                        description=p.get("description", ""),
                    ))

        # ── Steps with typed payloads ──
        steps: list[WorkflowStep] = []
        for s in data.get("steps", []):
            if not isinstance(s, dict):
                continue

            block_type = s.get("block_type", "action_block")
            if block_type not in VALID_BLOCK_TYPES:
                logger.warning(
                    "Unknown block_type '%s' in step %s — defaulting to action_block",
                    block_type, s.get("step_number"),
                )
                block_type = "action_block"

            step = WorkflowStep(
                step_number=s.get("step_number", len(steps) + 1),
                title=s.get("title", f"Step {len(steps) + 1}"),
                description=s.get("description", ""),
                block_type=block_type,
                action_type=s.get("action_type", ""),
                parameters_used=s.get("parameters_used", {"floating": [], "fixed": []}),
                condition=s.get("condition"),
                on_true_step=s.get("on_true_step"),
                on_false_step=s.get("on_false_step"),
            )

            # Parse typed payloads from the LLM response
            if block_type == "action_block" and "action_payload" in s:
                ap = s["action_payload"]
                step.action_payload = ActionBlockPayload(
                    actionType=ap.get("actionType", ""),
                    endpointOrTool=ap.get("endpointOrTool", ""),
                    method=ap.get("method", "GET"),
                    headers=[HeaderEntry(**h) for h in ap.get("headers", []) if isinstance(h, dict)],
                    payload=ap.get("payload", ""),
                    executionSettings=ExecutionSettings(
                        **{k: v for k, v in ap.get("executionSettings", {}).items()
                           if k in ("timeoutMs", "maxRetries", "continueOnError")}
                    ) if ap.get("executionSettings") else ExecutionSettings(),
                )

            elif block_type == "conditional_block" and "conditional_payload" in s:
                cp = s["conditional_payload"]
                step.conditional_payload = ConditionalBlockPayload(
                    logicalOperator=cp.get("logicalOperator", "AND"),
                    rules=[ConditionalRule(**r) for r in cp.get("rules", []) if isinstance(r, dict)],
                )

            elif block_type == "code_block" and "code_payload" in s:
                cdp = s["code_payload"]
                step.code_payload = CodeBlockPayload(
                    language=cdp.get("language", "Python"),
                    code=cdp.get("code", ""),
                    inputBindings=[CodeInputBinding(**b) for b in cdp.get("inputBindings", []) if isinstance(b, dict)],
                    outputBindings=cdp.get("outputBindings", []),
                )

            elif block_type == "notification_block" and "notify_payload" in s:
                np = s["notify_payload"]
                step.notify_payload = NotifyBlockPayload(
                    channel=np.get("channel", "Email"),
                    recipients=np.get("recipients", []),
                    subject=np.get("subject", ""),
                    messageTemplate=np.get("messageTemplate", ""),
                )

            elif block_type == "result_block" and "result_payload" in s:
                rp = s["result_payload"]
                step.result_payload = ResultBlockPayload(
                    status=rp.get("status", "Success"),
                    outputMapping=[OutputMappingEntry(**m) for m in rp.get("outputMapping", []) if isinstance(m, dict)],
                    terminateExecution=rp.get("terminateExecution", True),
                )

            elif block_type == "parameter_block" and "parameter_payload" in s:
                pp = s["parameter_payload"]
                step.parameter_payload = ParameterBlockPayload(
                    parameters=[ParamEntry(**p) for p in pp.get("parameters", []) if isinstance(p, dict)],
                )

            steps.append(step)

        # If the LLM produced steps, force intent to 'action'
        if steps:
            intent = "action"

        logger.info(
            "Parsed JSON: intent=%s, %d steps, %d params (%d floating, %d fixed)",
            intent, len(steps), len(workflow_params),
            sum(1 for p in workflow_params if p.param_type == "floating"),
            sum(1 for p in workflow_params if p.param_type == "fixed"),
        )

        return PlannerResponse(
            message_to_user=message,
            intent=intent,
            steps=steps,
            workflow_parameters=workflow_params,
            rag_citations=web_citations,
        )

    # ── Health check ──────────────────────────────────

    async def check_ollama_health(self) -> dict:
        """Verify the LLM backend is reachable and the required model is available."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{self.llm_config.base_url}/api/tags")
                resp.raise_for_status()
                models = resp.json().get("models", [])
                model_names = [m.get("name", "") for m in models]

                has_model = any(self.llm_config.model in name for name in model_names)

                return {
                    "ollama_running": True,
                    "model_available": has_model,
                    "model_name": self.llm_config.model,
                    "available_models": model_names,
                    "num_ctx": self.llm_config.num_ctx,
                    "num_predict": self.llm_config.num_predict,
                    "active_sessions": self.conversation_manager.get_session_count(),
                    "retrieval_mode": "policy_driven_web",
                    "policy_summary": self.policy.get_policy_summary(),
                }
        except Exception as e:
            return {
                "ollama_running": False,
                "model_available": False,
                "model_name": self.llm_config.model,
                "error": str(e),
            }

    # ── Session stats ─────────────────────────────────

    def get_session_stats(self) -> dict:
        """Get conversation session stats for monitoring."""
        return self.conversation_manager.get_session_stats()

    # ── Cleanup ───────────────────────────────────────

    def close(self):
        """Clean up resources."""
        self._http.close()
        logger.info("PlannerAgent resources cleaned up")
