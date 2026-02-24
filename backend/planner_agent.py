"""
planner_agent.py — Policy-Driven Planning Agent with Real-Time Web Retrieval

Architecture (v2 — replaces local RAG with live web retrieval):

  Phase 1: Intent & Domain Resolution  (~0.5s)
    User query → keyword extraction → PolicyEngine → allowed domains

  Phase 2: Dynamic Web Retrieval  (~2-4s)
    DuckDuckGo site-search → fetch top pages → HTML→markdown conversion
    All gated by Access Restriction Policy (only whitelisted domains)

  Phase 3: Context Compilation & LLM Generation  (~5-8s)
    Token-budgeted context → system prompt + history → LLM → parsed response

  Total target: ~8-12 seconds (down from ~120 seconds with local RAG)

Key changes from v1:
  - Removed: rag_engine.py, embedding_engine.py, query_analyzer.py dependencies
  - Added:   policy_engine.py, retrieval_router.py
  - The agent now fetches LIVE documentation from approved websites
  - Zero local vector database required
"""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

import httpx

from policy_engine import PolicyEngine
from retrieval_router import RetrievalRouter, RetrievalResult
from conversation_manager import (
    ConversationManager,
    ConversationSession,
)


logger = logging.getLogger("planner_agent")

# ─── Types ──────────────────────────────────────────────


@dataclass
class ConversationMessage:
    """A single message in the conversation history."""
    role: Literal["user", "assistant"]
    content: str


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

    For conditional_block, condition / on_true_step / on_false_step are required.
    """
    step_number: int
    title: str
    description: str
    block_type: str = "action_block"
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

## BLOCK TYPES
Every step in your workflow MUST use one of these block types:
- **action_block**: A concrete infrastructure action (e.g., "Create S3 Bucket", "Attach IAM Policy").
- **conditional_block**: A branching decision point. MUST include `condition`, `on_true_step`, `on_false_step`.
- **result_block**: A terminal step that reports success or failure of the workflow.
- **parameter_block**: A step that collects or validates user input before proceeding.
- **notification_block**: A step that sends an alert or notification (e.g., email, Slack, SNS).
- **code_block**: A step that executes custom code (e.g., a Lambda function, a shell script).

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
      "description": "Detailed description of what this step does, using {{param_name}} for floating parameters.",
      "block_type": "action_block",
      "action_type": "create | configure | validate | execute | notify",
      "parameters_used": {
        "floating": ["param_name_1"],
        "fixed": ["param_name_2"]
      }
    },
    {
      "step_number": 2,
      "title": "Verify Result",
      "description": "Check that the previous step completed successfully.",
      "block_type": "conditional_block",
      "action_type": "validate",
      "parameters_used": {"floating": [], "fixed": []},
      "condition": "step_1_success == true",
      "on_true_step": 3,
      "on_false_step": 4
    }
  ]
}

## RULES
1. **JSON ONLY** — Your entire response must be a single valid JSON object. No text before or after.
2. **Use the documentation** — Base your workflow on the provided web documentation. If the docs are insufficient, state so in `message_to_user` but still output valid JSON with `"intent": "question"` and an empty `steps` array.
3. **Every step needs a block_type** — No step may omit its `block_type`.
4. **Floating vs Fixed** — Classify parameters correctly. User-specific values are floating; standard/default values are fixed.
5. **Conditional blocks** — Must include `condition`, `on_true_step`, and `on_false_step`.
6. **For simple questions** — If the user asks a general question (not a workflow request), respond with `"intent": "question"` and put your answer in `message_to_user`. The `steps` array MUST be empty `[]`.
7. **Task fidelity** — Design steps ONLY for the exact task requested. Never expand scope.
8. **Existing resources** — If the user mentions a resource by name, ASSUME IT EXISTS. Do not add creation steps for it."""


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

    Architecture (v2):
    1. User query → intent detection → domain resolution (PolicyEngine)
    2. DuckDuckGo site-search → fetch approved pages → HTML→markdown
    3. Token-budgeted context → system prompt → LLM → structured response

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
            "PlannerAgent v2 initialized (model=%s, num_ctx=%d, policy=%s)",
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
        7. Parse and return structured response
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
            # \search always retrieves — that's the whole point
            do_retrieve = True
        elif command_mode == "create":
            # \create: check if there's a prior \search in conversation history
            has_prior_search = any(
                "search_results" in msg.get("content", "") or
                "\\search" in msg.get("content", "") or
                "parameters_found" in msg.get("content", "")
                for msg in history_dicts
            )
            if has_prior_search:
                logger.info("\\create with prior \\search — using chat context (no new retrieval)")
                do_retrieve = False

                # Extract prior search results as formal SchemaReference
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
            # General mode: respect the use_rag toggle
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
                        # Append the failed attempt + correction hint to the conversation
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
                        # All retries exhausted — fall back to raw text
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

        Uses lightweight regex heuristics (no extra LLM call) to:
        1. Strip conversational filler ("hey", "so", "I was thinking about")
        2. Remove question preambles ("can you help me with", "I need to")
        3. Extract core technical terms

        Falls back to original message if refinement is too aggressive.
        """
        query = user_message.strip()

        # Strip common conversational prefixes
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

        # Keep at least 3 words
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
        then map it into typed PlannerResponse / WorkflowStep / WorkflowParameter
        dataclasses.

        Strategy:
        1. Strip markdown code fences (```json ... ```) if the LLM wrapped its output.
        2. Regex-extract everything between the FIRST '{' and the LAST '}'.
        3. Parse with json.loads().
        4. Map the parsed dict into our dataclasses.

        Raises json.JSONDecodeError if no valid JSON can be extracted — this
        triggers the retry loop in process_message.
        """
        text = raw_response.strip()

        # Step 1: Strip markdown code fences
        fence_match = re.search(r'```(?:json)?\s*(\{.*\})\s*```', text, re.DOTALL)
        if fence_match:
            text = fence_match.group(1).strip()
            logger.debug("Stripped markdown code fence from LLM response")

        # Step 2: Extract JSON object — first '{' to last '}'
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

        # Step 3: Parse (may raise JSONDecodeError → triggers retry)
        data = json.loads(json_text)

        # Step 4: Map into dataclasses ──────────────────────
        message = data.get("message_to_user", "")
        intent = data.get("intent", "question")

        # Normalize intent
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
            # Backward-compatible: flat list without param_type
            for p in raw_params:
                if isinstance(p, dict):
                    workflow_params.append(WorkflowParameter(
                        name=p.get("name", ""),
                        param_type=p.get("param_type", "floating"),
                        value=p.get("value"),
                        description=p.get("description", ""),
                    ))

        # ── Steps ──
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

            steps.append(WorkflowStep(
                step_number=s.get("step_number", len(steps) + 1),
                title=s.get("title", f"Step {len(steps) + 1}"),
                description=s.get("description", ""),
                block_type=block_type,
                action_type=s.get("action_type", ""),
                parameters_used=s.get("parameters_used", {"floating": [], "fixed": []}),
                condition=s.get("condition"),
                on_true_step=s.get("on_true_step"),
                on_false_step=s.get("on_false_step"),
            ))

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
