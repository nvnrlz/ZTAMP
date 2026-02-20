"""
planner_agent.py — RAG-Powered Q&A Assistant

Simple pipeline:
  1. Receive user message + conversation history
  2. Refine query → search RAG (retrieve → rerank → context window)
  3. Build prompt: system prompt + history + RAG context + user message
  4. Call LLM → return answer with citations

The LLM does what it's good at — understanding natural language and
answering questions using the provided document context. No keyword
matching, no state machines, no deterministic overrides.
"""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

import httpx

from rag_engine import ContextChunk, RAGProvider
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


@dataclass
class WorkflowStep:
    """A single step in an actionable workflow."""
    step_number: int
    title: str
    description: str
    action_type: str = ""  # e.g., "create", "configure", "verify", "connect"

    def to_dict(self) -> dict:
        return {
            "step_number": self.step_number,
            "title": self.title,
            "description": self.description,
            "action_type": self.action_type,
        }


@dataclass
class WorkflowParameter:
    """
    A workflow parameter — either user-provided or deferred.
    
    status: "provided" (user gave a concrete value) or
            "deferred" (user said 'decide later' — becomes {{param_name}} in steps)
    """
    name: str
    status: str = "deferred"    # "provided" or "deferred"
    value: Optional[str] = None # Concrete value if provided, None if deferred
    description: str = ""       # What this parameter controls

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "status": self.status,
            "value": self.value,
            "description": self.description,
        }


@dataclass
class MissingParameterAudit:
    """A missing parameter with the source quote proving it's required."""
    parameter: str
    source_quote: str
    default_value: str = ""  # Document-specified default, if any
    required: bool = True    # True for mandatory, False for optional
    category: str = "mandatory"  # "mandatory", "optional", or "default"

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
            "workflow_parameters": [p.to_dict() for p in self.workflow_parameters],
            "rag_citations": self.rag_citations,
            "session_id": self.session_id,
        }
        if self.missing_parameters_audit:
            result["missing_parameters_audit"] = [
                m.to_dict() for m in self.missing_parameters_audit
            ]
        return result


# ─── System Prompt ──────────────────────────────────────

SYSTEM_PROMPT = """You are the **Architect** — the master Planner Agent for the Zero-Trust Agentic Workflow Platform (ZTAWP).

## YOUR ROLE
You help users build executable workflows for cloud infrastructure tasks. Your job:
1. Identify the EXACT task the user wants to perform
2. Find ALL parameters for THAT SPECIFIC TASK in the RAG documents
3. Check which parameters the user already specified
4. Ask about any unaccounted parameters, or generate the workflow if all are covered

## USER SLASH COMMANDS
- `/dp <value> as <parameter_name>` — **Defined Parameter**: concrete value provided by user
- `/fp <parameter_description>` — **Floating Parameter**: user will decide later (becomes `{{param_name}}`)

## ⚠️ TASK FIDELITY (CRITICAL)
You MUST generate steps ONLY for the EXACT task the user requested.

### Scope Rule
- If the user asks to "create a subnet" → generate steps for creating a subnet ONLY. Do NOT include VPC creation steps.
- If the user asks to "create a VPC" → generate steps for creating a VPC ONLY.
- NEVER expand the scope beyond what was asked.

### Existing vs New Resources
- If the user says "upload files to S3" → the task is UPLOADING. Do NOT create a new bucket unless the user explicitly says they need one.
- If the user mentions a resource by name ("my bucket rgmlwebapp") → ASSUME IT EXISTS. Do not generate creation steps for it.
- If the user says "configure permissions for my Lambda" → the task is PERMISSIONS. Do not create a new Lambda.
- **General rule: if the user describes an ACTION on a resource (upload, configure, modify, delete), assume the resource exists. Only include creation steps if the user explicitly says "create" or "new".**

## ⚠️ TOTAL PARAMETER ACCOUNTABILITY
Before generating ANY workflow, EVERY parameter from the RAG documents for the requested task MUST be accounted for:

### Category A: MANDATORY — documents say required. User MUST specify via /dp or /fp, or you must ask.
### Category B: OPTIONAL — documents mention as configurable. You MUST STILL present these and ask.
### Category C: DEFAULT — has a document-specified default. You MUST present the default and ask if the user wants to keep, change, or defer it.

**If a parameter exists in the docs for this task, it MUST appear in your response.**
**But ONLY include parameters relevant to the user's actual task — skip parameters for operations the user did NOT request.**

## INTERNAL REASONING (parameter_audit)
Always begin with a `<parameter_audit>` block:
1. **Task**: State the user's ACTUAL intent precisely. Write what they want to DO, not what resource to create.
   - GOOD: "Upload files from a mobile app to the existing S3 bucket 'rgmlwebapp' using a secure channel without public access"
   - BAD: "Create an S3 bucket"
   - If the user implies a resource exists, note: "User implies bucket already exists — skip creation parameters"
2. **All_Document_Parameters**: Every parameter from the docs for THIS task only (not for related tasks like resource creation)
3. **User_Specified**: What the user covered via /dp or /fp
4. **Unaccounted**: What's left
5. **Decision**: Unaccounted > 0 → clarification. Otherwise → action.

## RESPONSE FORMATS

### intent = "question"
```json
{
  "intent": "question",
  "message_to_user": "<direct answer based on documents>"
}
```

### intent = "clarification"
Parameters are missing. Present what the user specified and what's still needed.
```json
{
  "intent": "clarification",
  "message_to_user": "To create the subnet, I need a few more details:\\n\\n**You've specified:**\\n• VPC Name: RGML_VPC1234\\n• CIDR Block: 10.0.0.0/16\\n\\n**Still needed (mandatory):**\\n1. **Availability Zone** — which AZ should the subnet be in?\\n\\n**Optional parameters:**\\n1. **Map Public IP on Launch** — default is No. Keep the default or change it?\\n2. **IPv6 CIDR Block** — add IPv6 support?\\n\\nPlease specify values or mark them as floating parameters.",
  "missing_parameters_audit": [
    {
      "parameter": "Availability Zone",
      "source_quote": "choose the Availability Zone for your subnet",
      "default_value": "",
      "required": true,
      "category": "mandatory"
    },
    {
      "parameter": "Map Public IP on Launch",
      "source_quote": "choose Yes or No for Map public IP on launch",
      "default_value": "No",
      "required": false,
      "category": "optional"
    }
  ]
}
```

### intent = "action"
ALL parameters accounted for. Generate steps for the EXACT task only.
```json
{
  "intent": "action",
  "message_to_user": "All parameters are set. Here is the workflow to create the subnet.",
  "workflow_parameters": {
    "vpc_name": {
      "status": "provided",
      "value": "RGML_VPC1234"
    },
    "availability_zone": {
      "status": "deferred",
      "value": null,
      "description": "The Availability Zone for the subnet"
    }
  },
  "steps": [
    {
      "step_number": 1,
      "title": "Open the VPC Console",
      "description": "Navigate to the Amazon VPC console and select Subnets from the left navigation.",
      "action_type": "configure"
    },
    {
      "step_number": 2,
      "title": "Configure Subnet Settings",
      "description": "Select VPC RGML_VPC1234, set the IPv4 CIDR block to 10.0.0.0/24, and choose Availability Zone {{availability_zone}}.",
      "action_type": "configure"
    },
    {
      "step_number": 3,
      "title": "Create the Subnet",
      "description": "Review the configuration and click Create subnet.",
      "action_type": "create"
    }
  ]
}
```

## STRICT RULES
1. **EVERY parameter must be accounted for** — mandatory, optional, defaults. No silent omissions.
2. **TASK FIDELITY** — generate steps ONLY for what the user asked. Never expand scope.
3. **EXISTING RESOURCES** — if the user implies a resource exists, do NOT generate creation steps or creation parameters for it.
4. **Steps must be specific** — describe the actual actions to perform in the cloud console or CLI, referencing the actual parameter values or {{placeholders}}.
5. **Steps must come from the documents** — base step descriptions on the procedures described in the RAG documents.
6. **message_to_user must be natural** — write like a helpful assistant, not a machine. Summarize what the user specified and what you need.
7. **PARAMETER DECISIONS** — if the user sends parameter decisions, proceed with intent="action".
8. **Only include parameters for the user's actual task** — if docs describe creating a resource but the user wants to configure or use it, skip creation-specific parameters like Region or resource name creation.
9. **Output format** — `<parameter_audit>` block, then the JSON object. Nothing else."""


# ─── LLM Configuration ─────────────────────────────────

@dataclass
class LLMConfig:
    """
    Configuration for the LLM backend. Designed to be swapped
    between dev (8B local) and production (70B cluster).
    """
    model: str = "llama3.1:8b"
    base_url: str = "http://localhost:11434"
    temperature: float = 0.1
    top_p: float = 0.9
    num_ctx: int = 32768       # Llama 3.1 supports 128K; 32K is the dev sweet spot
    num_predict: int = 2048    # Room for detailed responses
    timeout: float = 120.0

    @classmethod
    def development(cls) -> "LLMConfig":
        """Dev config: Llama 3.1 8B, local Ollama."""
        return cls(
            model="llama3.1:8b",
            base_url="http://localhost:11434",
            num_ctx=32768,
            num_predict=2048,
            timeout=120.0,
        )

    @classmethod
    def enterprise(cls) -> "LLMConfig":
        """Production config: Llama 3.3 70B on vLLM/TGI cluster."""
        return cls(
            model="llama3.3:70b",
            base_url="http://llm-cluster:8000",
            num_ctx=65536,
            num_predict=4096,
            temperature=0.1,
            timeout=180.0,
        )


# ─── Planner Agent ──────────────────────────────────────

class PlannerAgent:
    """
    RAG-powered Q&A assistant.

    Simple pipeline:
    1. Refine the user's query (strip conversational filler)
    2. Search RAG (retrieve → rerank → context window)
    3. Build prompt with document context
    4. Call LLM → return answer with citations
    """

    def __init__(
        self,
        rag_provider: RAGProvider,
        llm_config: Optional[LLMConfig] = None,
    ):
        self.rag = rag_provider
        self.llm_config = llm_config or LLMConfig.development()
        self.conversation_manager = ConversationManager()
        self._http = httpx.Client(timeout=10.0)

        logger.info(
            "PlannerAgent initialized (model=%s, num_ctx=%d, num_predict=%d)",
            self.llm_config.model,
            self.llm_config.num_ctx,
            self.llm_config.num_predict,
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
        3. (If use_rag) Refine query → RAG search with reranking + context window
        4. Build prompt: system + history + RAG context + user message
        5. Call LLM (with optional model override)
        6. Return response with citations
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

        # ── Step 2: Rolling summary ──
        history_dicts = [
            {"role": msg.role, "content": msg.content}
            for msg in conversation_history
        ]
        if session.rolling_summary.needs_update(len(history_dicts)):
            self.conversation_manager.update_rolling_summary(
                session, history_dicts
            )

        # ── Step 3: RAG retrieval (skipped if use_rag=False) ──
        rag_context_text = ""
        rag_citations: list[str] = []

        if use_rag:
            refined_query = self._refine_query(user_message)
            logger.info("Query refinement: '%s…' → '%s…'", user_message[:40], refined_query[:40])

            rag_chunks = session.rag_cache.get(refined_query)
            if rag_chunks is None:
                rag_chunks = self.rag.search_with_context_window(
                    refined_query,
                    final_top_k=self.conversation_manager.MAX_RAG_CHUNKS,
                )
                session.rag_cache.put(refined_query, rag_chunks)
                logger.info("RAG cache MISS — fetched %d chunks", len(rag_chunks))
            else:
                logger.info("RAG cache HIT — reusing %d chunks", len(rag_chunks))

            rag_context_text = self.rag.format_context_for_prompt(rag_chunks)
            rag_citations = [chunk.citation for chunk in rag_chunks]
        else:
            logger.info("RAG disabled for this request — using direct mode")

        # Note about attached files
        attached_note = ""
        if attached_files:
            file_list = ", ".join(attached_files)
            attached_note = f"\n\n📎 The user just attached: {file_list}\n"

        # ── Step 4: Build prompt ──
        messages = self.conversation_manager.build_optimized_messages(
            session=session,
            system_prompt=SYSTEM_PROMPT,
            user_message=user_message,
            conversation_history=history_dicts,
            rag_context=rag_context_text,
            attached_note=attached_note,
            context_budget_tokens=self.llm_config.num_ctx,
        )

        # ── Step 5: Call LLM ──
        # Temporarily override model if requested
        original_model = None
        if model_override and model_override != self.llm_config.model:
            original_model = self.llm_config.model
            self.llm_config.model = model_override
            logger.info("Model override: %s → %s", original_model, model_override)

        try:
            raw_response = await self._call_ollama(messages)
        finally:
            if original_model:
                self.llm_config.model = original_model

        # ── Step 6: Parse and return ──
        response = self._parse_llm_response(raw_response, rag_citations)
        response.session_id = sid

        logger.info(
            "Turn %d complete: %d citations, session=%s",
            turn, len(rag_citations), sid,
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

        filler_patterns = [
            r"^(hey|hi|hello|okay|ok|so|well|alright|right)\s*,?\s*",
            r"^(I was thinking about|I've been thinking about|I need help with)\s+",
            r"^(can you help me with|could you help me with|help me with)\s+",
            r"^(I want to|I need to|I'd like to|let's|we need to|we should)\s+",
            r"^(can you|could you|would you|please)\s+",
            r"^(tell me about|explain|describe|show me)\s+",
            r"^(what about|how about|regarding|about)\s+",
            r"^(you know|basically|actually|literally)\s*,?\s*",
        ]

        refined = query
        for pattern in filler_patterns:
            refined = re.sub(pattern, "", refined, flags=re.IGNORECASE).strip()

        refined = re.sub(r"\?+$", "", refined).strip()
        refined = re.sub(r"(please|thanks|thank you)\.?$", "", refined, flags=re.IGNORECASE).strip()

        if len(refined) < 10:
            return query

        return refined

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
            # NOTE: No "format": "json" — we need the LLM to output
            # <parameter_audit> XML reasoning before the JSON block
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

    # ── Parse LLM response ────────────────────────────

    def _extract_json_from_response(self, raw: str) -> str:
        """
        Extract the JSON block from a response that may contain
        parameter_audit reasoning (in any format) before/after the JSON.

        Strategy: find the FIRST '{' and its matching '}' using brace depth.
        Everything outside those braces is discarded — this handles:
        - <parameter_audit>...</parameter_audit> XML blocks
        - Plain text "parameter_audit" headers (no XML tags)
        - Markdown code fences (```json ... ```)
        - Trailing commentary after the JSON
        """
        text = raw.strip()

        # Find the first '{' — everything before it is preamble
        start = text.find("{")
        if start == -1:
            logger.warning("No JSON object found in LLM response")
            return text  # No JSON found, return as-is for fallback

        # Log what we're stripping (for debugging)
        if start > 0:
            preamble = text[:start].strip()
            if preamble:
                logger.debug("Stripped preamble (%d chars): %s…", len(preamble), preamble[:100])

        # Find matching closing brace using depth counting
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    json_block = text[start:i + 1]
                    # Log if there's trailing text
                    trailing = text[i + 1:].strip()
                    if trailing:
                        logger.debug("Stripped trailing text (%d chars): %s…", len(trailing), trailing[:100])
                    return json_block

        # If no matching brace, return from start to end
        logger.warning("No matching closing brace found — returning from first '{' to end")
        return text[start:]

    def _parse_llm_response(
        self,
        raw_response: str,
        rag_citations: list[str],
    ) -> PlannerResponse:
        """
        Parse the LLM's raw text into a PlannerResponse.

        Handles:
        - <parameter_audit> XML blocks (stripped before JSON parsing)
        - Markdown code fences
        - workflow_parameters as dict (new format) or list (old format)
        - missing_parameters_audit for clarification responses
        - Plain text fallback
        """
        # Log if parameter audit was present (for debugging)
        if "<parameter_audit>" in raw_response:
            audit_match = re.search(
                r"<parameter_audit>(.*?)</parameter_audit>",
                raw_response, re.DOTALL,
            )
            if audit_match:
                logger.info("Parameter audit (XML):\n%s", audit_match.group(1).strip()[:500])
        elif re.search(r"(?:^|\n)\s*parameter_audit\b", raw_response, re.IGNORECASE):
            logger.info("Parameter audit detected (plain text format)")

        cleaned = self._extract_json_from_response(raw_response)

        intent = "question"
        steps: list[WorkflowStep] = []
        workflow_params: list[WorkflowParameter] = []
        missing_audit: list[MissingParameterAudit] = []
        message = ""

        try:
            data = json.loads(cleaned)
            message = data.get("message_to_user", data.get("message", ""))
            intent = data.get("intent", "question")

            # Normalize intent
            if intent not in ("question", "action", "clarification"):
                intent = "action" if "steps" in data else "question"

            # Parse steps if present
            raw_steps = data.get("steps", [])
            if isinstance(raw_steps, list):
                for i, s in enumerate(raw_steps):
                    if isinstance(s, dict):
                        steps.append(WorkflowStep(
                            step_number=s.get("step_number", i + 1),
                            title=s.get("title", f"Step {i + 1}"),
                            description=s.get("description", ""),
                            action_type=s.get("action_type", ""),
                        ))

            # Parse workflow parameters — handle BOTH dict and list formats
            raw_params = data.get("workflow_parameters", {})
            if isinstance(raw_params, dict):
                # New format: {"param_name": {"status": ..., "value": ..., "description": ...}}
                for param_name, param_data in raw_params.items():
                    if isinstance(param_data, dict):
                        workflow_params.append(WorkflowParameter(
                            name=param_name,
                            status=param_data.get("status", "deferred"),
                            value=param_data.get("value"),
                            description=param_data.get("description", ""),
                        ))
            elif isinstance(raw_params, list):
                # Legacy list format fallback
                for p in raw_params:
                    if isinstance(p, dict):
                        workflow_params.append(WorkflowParameter(
                            name=p.get("name", ""),
                            status="provided" if p.get("value") else "deferred",
                            value=p.get("value") or p.get("default_value"),
                            description=p.get("description", ""),
                        ))

            # Parse missing_parameters_audit for clarification responses
            raw_audit = data.get("missing_parameters_audit", [])
            if isinstance(raw_audit, list):
                for a in raw_audit:
                    if isinstance(a, dict):
                        missing_audit.append(MissingParameterAudit(
                            parameter=a.get("parameter", ""),
                            source_quote=a.get("source_quote", ""),
                            default_value=a.get("default_value", ""),
                            required=a.get("required", True),
                            category=a.get("category", "mandatory"),
                        ))

            if steps:
                intent = "action"
                logger.info(
                    "Parsed %d steps, %d params (%d provided, %d deferred)",
                    len(steps), len(workflow_params),
                    sum(1 for p in workflow_params if p.status == "provided"),
                    sum(1 for p in workflow_params if p.status == "deferred"),
                )
            elif missing_audit:
                intent = "clarification"
                logger.info(
                    "Clarification needed: %d missing parameters",
                    len(missing_audit),
                )
            else:
                logger.info("Direct answer (intent=%s)", intent)

        except json.JSONDecodeError:
            logger.warning("Could not parse JSON from LLM response")
            logger.debug("Raw response that failed parsing:\n%s", cleaned[:500])
            # Strip any parameter_audit text (XML or plain text) and return clean message
            text = raw_response.strip()
            # Remove XML-style audit blocks
            text = re.sub(
                r"<parameter_audit>.*?</parameter_audit>",
                "", text, flags=re.DOTALL,
            )
            # Remove plain-text audit blocks (e.g. "parameter_audit\n\nTask: ...")
            # Match from "parameter_audit" to the start of "json" or "{" or "```"
            text = re.sub(
                r"(?:^|\n)\s*parameter_audit\b.*?(?=\n\s*(?:```|json\s*\{|\{))",
                "", text, flags=re.DOTALL | re.IGNORECASE,
            )
            # Strip code fences and JSON blocks
            text = re.sub(r"```(?:json)?.*?```", "", text, flags=re.DOTALL)
            text = re.sub(r"\{.*\}", "", text, flags=re.DOTALL)
            text = text.strip()
            message = text if text else "I'm having trouble formatting my response. Could you try again?"

        if not message:
            message = "I'm having trouble processing that. Could you rephrase your request?"

        return PlannerResponse(
            message_to_user=message,
            intent=intent,
            steps=steps,
            workflow_parameters=workflow_params,
            missing_parameters_audit=missing_audit,
            rag_citations=rag_citations,
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
        self.rag.close()
        logger.info("PlannerAgent resources cleaned up")
