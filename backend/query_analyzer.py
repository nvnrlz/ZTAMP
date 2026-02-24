"""
query_analyzer.py — Steps 1 & 3 of the 4-Step Agentic RAG Pipeline

Step 1: Intent & State Extraction (Pre-Retrieval)
  BEFORE any RAG search, the LLM extracts a structured state from the user's
  natural language input. This enables metadata-filtered retrieval and
  provides the user_provided_parameters for the diff check.

Step 3: Two-Phase Diff Check (hallucination-proof)
  Phase A — SCHEMA EXTRACTION (LLM):
    The LLM reads unstructured document text and extracts a clean JSON schema.
    This is a focused task (information extraction) that 8B models excel at.

  Phase B — PROGRAMMATIC DIFF (Python):
    Pure dictionary comparison: Extracted_Schema minus User_State.
    Zero LLM involvement → zero hallucinations on the diff itself.

  Why two phases?
    Asking an 8B model to read a dense paragraph, mentally map rules,
    compare them to user state, and output a diff in one prompt often
    triggers hallucinations. By splitting the cognitive load:
    - The LLM only does what it's good at (reading text → JSON extraction)
    - Python does what it's deterministic at (set comparison)
"""

import json
import logging
import re
from typing import Optional

import httpx

logger = logging.getLogger("query_analyzer")


# ─── Intent Extraction Prompt (Step 1) ────────────────────

INTENT_EXTRACTION_PROMPT = """You are a precise intent extractor. Given a user's message, extract a structured JSON object representing their intent and state.

You MUST output ONLY valid JSON. No explanations.

Extract these fields:
{
  "intent": "create|query|configure|modify|delete|troubleshoot|explain|list",
  "domain": "aws|azure|gcp|general|networking|security|storage|compute",
  "service": "s3|ec2|vpc|iam|lambda|rds|..." or null if not applicable,
  "resource": "bucket|instance|subnet|role|..." or null if not applicable,
  "action": "create|modify|delete|list|describe|configure|upload|download|connect" or null,
  "core_entity": "The fundamental resource/object being acted upon (e.g. SecurityGroup, Subnet, S3Bucket, Employee, Invoice, Patient). This is the ROOT object — not the sub-properties or rules within it.",
  "schema_root_query": "A search query specifically designed to retrieve the ROOT DEFINITION / TEMPLATE / SCHEMA for the core_entity. Example: 'AWS::EC2::SecurityGroup properties parameters' or 'employee onboarding required fields'. This query MUST target the base object definition, NOT specific sub-features.",
  "user_provided_parameters": {"param_name": "value", ...},
  "search_queries": ["query1", "query2", "query3"],
  "key_concepts": ["concept1", "concept2", ...],
  "expected_answer_type": "fact|procedure|comparison|list|explanation|workflow",
  "is_followup": false
}

Rules:
1. "search_queries": Generate 2-4 search queries with DIFFERENT phrasings. First = most literal. Others use synonyms, broader/narrower scope.
2. "user_provided_parameters": Extract ONLY explicitly stated values. Do NOT guess or infer missing ones.
3. "service": Identify the specific cloud service or technology mentioned. null if general question.
4. "intent": 
   - "create" = user wants to create/build something new
   - "query" = user has a question about existing docs
   - "configure" = user wants to set up/modify settings
   - "explain" = user wants a concept explained
   - "troubleshoot" = user has a problem to solve
5. "is_followup": true only if the message clearly references a prior exchange (e.g., "that", "also", "what about the other")
6. "key_concepts": Technical terms, service names, parameter names that should appear in relevant documents.

Examples:

User: "I want to create an S3 bucket in us-east-1 called my-app-data"
{"intent":"create","domain":"aws","service":"s3","resource":"bucket","action":"create","core_entity":"S3Bucket","schema_root_query":"AWS::S3::Bucket properties parameters required","user_provided_parameters":{"region":"us-east-1","bucket_name":"my-app-data"},"search_queries":["create S3 bucket configuration","S3 bucket required parameters","Amazon S3 bucket creation steps"],"key_concepts":["S3","bucket","create","us-east-1","parameters"],"expected_answer_type":"workflow","is_followup":false}

User: "What are the VPC peering limitations?"
{"intent":"query","domain":"aws","service":"vpc","resource":"peering","action":null,"user_provided_parameters":{},"search_queries":["VPC peering limitations","peering connection restrictions","cross-region VPC peering limits"],"key_concepts":["VPC","peering","limitations","restrictions"],"expected_answer_type":"list","is_followup":false}

User: "Upload my application files to the existing S3 bucket rgmlwebapp"
{"intent":"configure","domain":"aws","service":"s3","resource":"bucket","action":"upload","user_provided_parameters":{"bucket_name":"rgmlwebapp"},"search_queries":["upload files to S3 bucket","S3 object upload methods","S3 bucket file upload configuration"],"key_concepts":["S3","upload","files","bucket"],"expected_answer_type":"procedure","is_followup":false}

User: "How do I set up a NAT gateway in my VPC?"
{"intent":"create","domain":"aws","service":"vpc","resource":"nat_gateway","action":"create","user_provided_parameters":{},"search_queries":["create NAT gateway VPC","NAT gateway setup configuration","NAT gateway requirements prerequisites"],"key_concepts":["NAT gateway","VPC","setup","create"],"expected_answer_type":"procedure","is_followup":false}

User: "Can you explain more about that?"
{"intent":"explain","domain":"general","service":null,"resource":null,"action":null,"user_provided_parameters":{},"search_queries":[],"key_concepts":[],"expected_answer_type":"explanation","is_followup":true}

Now extract the intent from this message:"""


# ─── Schema Extraction Prompt (Micro-Call A) ──────────────

SCHEMA_EXTRACTION_PROMPT = """You are a parameter extraction agent. Read the documentation text below and extract EVERY configurable parameter or setting mentioned.

Output ONLY this JSON structure:
{
  "parameters": [
    {
      "name": "parameter_name",
      "category": "mandatory|optional|default",
      "default_value": null,
      "description": "brief description"
    }
  ],
  "task_summary": "What this documentation describes"
}

Rules:
1. EXTRACT parameters — do NOT invent them. Every parameter must come from the text.
2. "category":
   - "mandatory" = the text says it is required, must be specified, or cannot be empty
   - "default" = the text specifies a default value (state the default in "default_value")
   - "optional" = the text mentions it as configurable but not required
3. If you are unsure whether a parameter is mandatory or optional, mark it "optional".
4. "name": Use a short, standardized name (e.g. "region", "bucket_name", "availability_zone").
5. "description": One sentence describing what this parameter controls.
6. Do NOT include general concepts, features, or service descriptions as parameters.
   ONLY include things that require a user-specified VALUE or CHOICE.
7. If the text does not mention any configurable parameters, return {"parameters": [], "task_summary": "..."}.

Examples of what IS a parameter: region, bucket name, CIDR block, instance type, availability zone, encryption key
Examples of what is NOT a parameter: "S3 is a storage service", "VPCs provide network isolation" (these are descriptions, not parameters)"""


# ─── Keyword fallback ────────────────────────────────────

def _keyword_fallback(message: str) -> dict:
    """Fallback intent extraction using simple text processing."""
    refined = message.strip()
    for filler in [
        "hey ", "hi ", "hello ", "can you ", "could you ", "please ",
        "tell me ", "i want to know ", "i'd like to ", "what about ",
    ]:
        if refined.lower().startswith(filler):
            refined = refined[len(filler):]
    refined = refined.strip().rstrip("?").strip()

    stop_words = {
        "the", "a", "an", "is", "are", "was", "were", "be", "been",
        "to", "of", "in", "for", "on", "with", "at", "by", "from",
        "and", "or", "but", "not", "so", "if", "then", "that", "this",
        "what", "how", "when", "where", "why", "which", "who",
        "me", "my", "i", "you", "your", "we", "our", "they", "their",
    }
    words = re.findall(r'[a-zA-Z]{2,}', refined.lower())
    concepts = [w for w in words if w not in stop_words][:8]

    # Detect intent
    lower = message.lower()
    if any(w in lower for w in ["create", "build", "make", "set up", "launch", "deploy"]):
        intent = "create"
    elif any(w in lower for w in ["configure", "modify", "update", "change", "upload"]):
        intent = "configure"
    elif any(w in lower for w in ["delete", "remove", "destroy", "terminate"]):
        intent = "delete"
    elif any(w in lower for w in ["troubleshoot", "fix", "error", "problem", "issue"]):
        intent = "troubleshoot"
    elif any(w in lower for w in ["explain", "what is", "describe"]):
        intent = "explain"
    elif any(w in lower for w in ["list", "show", "what are"]):
        intent = "list"
    else:
        intent = "query"

    # Detect answer type
    if intent in ("create", "configure"):
        answer_type = "workflow"
    elif any(w in lower for w in ["how to", "steps"]):
        answer_type = "procedure"
    elif any(w in lower for w in ["difference", "vs", "compare"]):
        answer_type = "comparison"
    elif any(w in lower for w in ["list", "what are", "types"]):
        answer_type = "list"
    else:
        answer_type = "fact"

    # Detect service
    service_map = {
        "s3": "s3", "bucket": "s3", "storage": "s3",
        "ec2": "ec2", "instance": "ec2", "server": "ec2",
        "vpc": "vpc", "subnet": "vpc", "peering": "vpc", "nat": "vpc",
        "iam": "iam", "role": "iam", "policy": "iam", "permission": "iam",
        "lambda": "lambda", "function": "lambda",
        "rds": "rds", "database": "rds",
        "cloudfront": "cloudfront", "cdn": "cloudfront",
        "route53": "route53", "dns": "route53",
    }
    detected_service = None
    for keyword, service in service_map.items():
        if keyword in lower:
            detected_service = service
            break

    search_queries = [refined]
    if len(concepts) >= 2:
        search_queries.append(" ".join(concepts))
    if len(refined.split()) >= 3:
        search_queries.append(" ".join(refined.split()[:5]))

    return {
        "intent": intent,
        "domain": "aws" if detected_service else "general",
        "service": detected_service,
        "resource": None,
        "action": intent if intent in ("create", "configure", "delete") else None,
        "user_provided_parameters": {},
        "refined_query": refined,
        "search_queries": search_queries[:4],
        "key_concepts": concepts,
        "expected_answer_type": answer_type,
        "is_followup": len(refined.split()) <= 3 and any(
            w in lower for w in ["that", "this", "more", "also"]
        ),
        "_method": "keyword_fallback",
    }


# ─── Query Analyzer ──────────────────────────────────────

class QueryAnalyzer:
    """
    Steps 1 & 3 of the 4-Step Agentic RAG Pipeline.

    Step 1: Intent & State Extraction (Pre-Retrieval)
      BEFORE any document search, the LLM extracts structured state.

    Step 3: Two-Phase Diff Check (hallucination-proof)
      Phase A (LLM): Extract clean JSON schema from unstructured docs
      Phase B (Python): Deterministic set diff — no LLM, no hallucinations
    """

    def __init__(
        self,
        ollama_base_url: str = "http://localhost:11434",
        model: str = "llama3.1:8b",
        timeout: float = 30.0,
    ):
        self.base_url = ollama_base_url
        self.model = model
        self.timeout = timeout
        logger.info("QueryAnalyzer initialized (model=%s)", model)

    # ══════════════════════════════════════════════════════
    # STEP 1: Intent & State Extraction
    # ══════════════════════════════════════════════════════

    async def analyze(
        self,
        user_message: str,
        conversation_history: Optional[list[dict]] = None,
    ) -> dict:
        """
        Step 1: Extract structured intent + state from user message.

        Returns:
            {
                "intent": str,
                "domain": str,
                "service": str | None,
                "resource": str | None,
                "action": str | None,
                "user_provided_parameters": dict,
                "search_queries": list[str],
                "key_concepts": list[str],
                "expected_answer_type": str,
                "is_followup": bool,
            }
        """
        try:
            result = await self._llm_extract(user_message, conversation_history)
            result["_method"] = "llm"
            logger.info(
                "Intent extracted (LLM): intent=%s, service=%s, params=%s, queries=%d",
                result.get("intent"), result.get("service"),
                list(result.get("user_provided_parameters", {}).keys()),
                len(result.get("search_queries", [])),
            )
            return result

        except Exception as e:
            logger.warning("LLM extraction failed (%s), using keyword fallback", e)
            result = _keyword_fallback(user_message)
            logger.info(
                "Intent extracted (fallback): intent=%s, service=%s, queries=%d",
                result.get("intent"), result.get("service"),
                len(result.get("search_queries", [])),
            )
            return result

    async def _llm_extract(
        self,
        user_message: str,
        conversation_history: Optional[list[dict]] = None,
    ) -> dict:
        """Call the LLM to extract structured intent + state."""
        messages = [
            {"role": "system", "content": INTENT_EXTRACTION_PROMPT},
        ]

        # Include last 2 exchanges for follow-up detection
        if conversation_history:
            for msg in conversation_history[-4:]:
                messages.append({
                    "role": msg.get("role", "user"),
                    "content": msg.get("content", ""),
                })

        messages.append({"role": "user", "content": user_message})

        url = f"{self.base_url}/api/chat"
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "format": "json",
            "options": {
                "num_ctx": 4096,
                "num_predict": 512,
                "temperature": 0.0,
                "top_p": 0.1,
            },
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()

        content = resp.json().get("message", {}).get("content", "")
        content = content.strip()
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)

        result = json.loads(content)
        if not isinstance(result, dict):
            raise ValueError("LLM output is not a JSON object")

        # Validate and set defaults
        result.setdefault("intent", "query")
        result.setdefault("domain", "general")
        result.setdefault("service", None)
        result.setdefault("resource", None)
        result.setdefault("action", None)
        result.setdefault("user_provided_parameters", {})
        result.setdefault("search_queries", [user_message])
        result.setdefault("key_concepts", [])
        result.setdefault("core_entity", result.get("resource"))
        result.setdefault("schema_root_query", None)
        result.setdefault("expected_answer_type", "fact")
        result.setdefault("is_followup", False)
        result.setdefault("refined_query", result["search_queries"][0] if result["search_queries"] else user_message)

        # Ensure at least one search query
        if not result["search_queries"]:
            result["search_queries"] = [user_message]

        # Cap at 4 queries
        result["search_queries"] = result["search_queries"][:4]

        return result

    # ══════════════════════════════════════════════════════
    # STEP 3: Two-Phase Diff Check
    # ══════════════════════════════════════════════════════
    #
    #   Phase A (LLM): Extract clean JSON schema from docs
    #   Phase B (Python): Deterministic diff — no LLM
    #
    # Architecture:
    #
    #   ┌──────────────────────────────────────────────────┐
    #   │ Phase A: Schema Extraction (LLM)                 │
    #   │                                                  │
    #   │ "When creating the bucket, the admin must        │
    #   │  ensure a region is specified..."                │
    #   │              ↓ LLM (focused extraction)          │
    #   │ {"parameters": [                                 │
    #   │   {"name":"region","category":"mandatory",...}    │
    #   │ ]}                                               │
    #   └──────────────────┬───────────────────────────────┘
    #                      ↓
    #   ┌──────────────────────────────────────────────────┐
    #   │ Phase B: Programmatic Diff (Python)              │
    #   │                                                  │
    #   │ extracted_mandatory = {"region", "bucket_name"}   │
    #   │ user_provided      = {"bucket_name"}             │
    #   │ missing            = {"region"}   ← set diff     │
    #   │                                                  │
    #   │ ZERO LLM. ZERO hallucinations.                   │
    #   └──────────────────────────────────────────────────┘
    # ══════════════════════════════════════════════════════

    async def diff_check(
        self,
        user_params: dict,
        schema_text: str,
        task_description: str = "",
    ) -> dict:
        """
        Step 3: Two-phase hallucination-proof diff check.

        Phase A: LLM extracts a clean JSON schema from unstructured docs.
        Phase B: Python set-diff computes missing/optional params.

        Returns:
            {
                "missing_mandatory_parameters": [...],
                "available_optional_parameters": [...],
                "parameters_with_defaults": [...],
                "all_identified_parameters": [...],
                "task_summary": str,
                "extracted_schema": dict,   # Raw Phase A output
            }
        """
        logger.info("━" * 40)
        logger.info("Diff Check: Phase A (Schema Extraction)")
        logger.info("━" * 40)

        # ── Phase A: LLM extracts schema from docs ──
        extracted_schema = await self._extract_schema(schema_text, task_description)

        logger.info(
            "Phase A complete: %d parameters extracted (task: %s)",
            len(extracted_schema.get("parameters", [])),
            extracted_schema.get("task_summary", "")[:60],
        )

        # ── Phase B: Programmatic diff (no LLM) ──
        logger.info("━" * 40)
        logger.info("Diff Check: Phase B (Programmatic Diff)")
        logger.info("━" * 40)

        diff_result = self._compute_diff(user_params, extracted_schema)

        logger.info(
            "Phase B complete: %d mandatory missing, %d optional, %d with defaults",
            len(diff_result["missing_mandatory_parameters"]),
            len(diff_result["available_optional_parameters"]),
            len(diff_result["parameters_with_defaults"]),
        )

        return diff_result

    async def _extract_schema(
        self,
        doc_text: str,
        task_description: str = "",
    ) -> dict:
        """
        Phase A: LLM reads unstructured documentation and extracts a
        clean JSON schema of parameters.

        This is a focused information-extraction task. The LLM is ONLY
        asked to read and structure — not compare or reason about diffs.
        8B models are reliable at this task.

        Returns:
            {
                "parameters": [
                    {"name": str, "category": str, "default_value": str|None, "description": str},
                    ...
                ],
                "task_summary": str,
            }
        """
        user_prompt = f"""Task context: {task_description}

Documentation text:
{doc_text[:4000]}

Extract ALL configurable parameters from this documentation. Output the JSON."""

        messages = [
            {"role": "system", "content": SCHEMA_EXTRACTION_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        url = f"{self.base_url}/api/chat"
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "format": "json",
            "options": {
                "num_ctx": 4096,
                "num_predict": 1024,
                "temperature": 0.0,
                "top_p": 0.1,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()

            content = resp.json().get("message", {}).get("content", "")
            content = content.strip()
            content = re.sub(r"^```(?:json)?\s*", "", content)
            content = re.sub(r"\s*```$", "", content)

            result = json.loads(content)
            if not isinstance(result, dict):
                raise ValueError("Schema extraction output is not a JSON object")

            # Validate structure
            result.setdefault("parameters", [])
            result.setdefault("task_summary", "")

            # Normalize parameters
            normalized = []
            for param in result["parameters"]:
                if isinstance(param, dict) and param.get("name"):
                    normalized.append({
                        "name": param["name"].strip(),
                        "category": param.get("category", "optional").lower(),
                        "default_value": param.get("default_value"),
                        "description": param.get("description", ""),
                    })
            result["parameters"] = normalized

            if normalized:
                logger.info(
                    "  Extracted parameters: %s",
                    [p["name"] for p in normalized[:10]],
                )

            return result

        except Exception as e:
            logger.warning("Schema extraction failed (%s) — returning empty", e)
            return {"parameters": [], "task_summary": "", "_error": str(e)}

    @staticmethod
    def _compute_diff(user_params: dict, extracted_schema: dict) -> dict:
        """
        Phase B: Pure Python deterministic diff.

        Compares user_provided_parameters against the extracted schema.
        ZERO LLM involvement — ZERO hallucinations.

        Logic:
          mandatory_params = {p for p in schema if category == "mandatory"}
          user_keys = set(user_params.keys())
          missing = mandatory_params - user_keys
          optional = {p for p in schema if category == "optional"} - user_keys
          defaults = {p for p in schema if category == "default"} - user_keys
        """
        schema_params = extracted_schema.get("parameters", [])

        # Normalize user parameter keys for comparison
        # Convert to lowercase set for fuzzy matching
        user_keys_raw = set(user_params.keys())
        user_keys_lower = {k.lower().replace(" ", "_").replace("-", "_") for k in user_keys_raw}

        # Also include user parameter VALUES as potential matches
        # (e.g., user might say "region": "us-east-1" — the key "region" matches)
        user_values_lower = {
            str(v).lower().replace(" ", "_").replace("-", "_")
            for v in user_params.values()
            if isinstance(v, str)
        }

        def _is_covered(param_name: str) -> bool:
            """Check if a schema parameter is already covered by user input."""
            normalized = param_name.lower().replace(" ", "_").replace("-", "_")
            # Direct key match
            if normalized in user_keys_lower:
                return True
            # Partial key match (e.g., "bucket_name" matches user key "bucket")
            for uk in user_keys_lower:
                if normalized in uk or uk in normalized:
                    return True
            return False

        # Categorize schema parameters
        missing_mandatory = []
        available_optional = []
        params_with_defaults = []
        all_param_names = []

        for param in schema_params:
            name = param.get("name", "")
            category = param.get("category", "optional").lower()
            default_value = param.get("default_value")
            description = param.get("description", "")

            if not name:
                continue

            all_param_names.append(name)

            # Skip if user already provided this parameter
            if _is_covered(name):
                logger.debug("  ✓ User covered: %s", name)
                continue

            if category == "mandatory":
                missing_mandatory.append({
                    "name": name,
                    "description": description,
                    "category": "mandatory",
                    "source": "extracted_from_docs",
                })
            elif category == "default" and default_value is not None:
                params_with_defaults.append({
                    "name": name,
                    "default_value": str(default_value) if default_value else "",
                    "description": description,
                    "category": "default",
                })
            else:
                # Optional or uncategorized
                available_optional.append({
                    "name": name,
                    "description": description,
                    "default_value": str(default_value) if default_value else "",
                    "category": "optional",
                })

        # Log the diff
        covered = [name for name in all_param_names if _is_covered(name)]
        logger.info("  Schema params: %d total", len(all_param_names))
        logger.info("  User covered:  %d %s", len(covered), covered[:5])
        logger.info("  Missing mandatory: %d %s",
                    len(missing_mandatory),
                    [p["name"] for p in missing_mandatory[:5]])
        logger.info("  Optional available: %d", len(available_optional))
        logger.info("  With defaults: %d", len(params_with_defaults))

        return {
            "missing_mandatory_parameters": missing_mandatory,
            "available_optional_parameters": available_optional,
            "parameters_with_defaults": params_with_defaults,
            "all_identified_parameters": all_param_names,
            "task_summary": extracted_schema.get("task_summary", ""),
            "extracted_schema": extracted_schema,  # Pass through for debugging
        }
