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
class PlannerResponse:
    """Response from the Planner Agent → Frontend."""
    message_to_user: str
    rag_citations: list[str] = field(default_factory=list)
    session_id: str = ""

    def to_dict(self) -> dict:
        return {
            "message_to_user": self.message_to_user,
            "rag_citations": self.rag_citations,
            "session_id": self.session_id,
        }


# ─── System Prompt ──────────────────────────────────────

SYSTEM_PROMPT = """You are the **Architect** — a knowledgeable assistant for the Agentic Studio platform.

## YOUR ROLE

Answer the user's questions accurately using the provided document context. You have access to the user's uploaded knowledge base (technical documentation, manuals, guides) via the "Retrieved Document Content" section below.

## HOW TO ANSWER

1. **Use the document context first** — When the answer is in the Retrieved Document Content, use it and cite the source (filename + page number). Example: "According to vpc-ug.pdf (Page 42), you need to..."
2. **Be upfront when it's not there** — If the documents don't contain the answer, say so clearly: "I couldn't find this in your uploaded documents." Then provide what you know from general knowledge, clearly labeled as such.
3. **Never fabricate document content** — Don't pretend the documents say something they don't.
4. **Be specific and actionable** — Give concrete steps, not vague overviews. If the user asks how to do something, walk them through it.
5. **Acknowledge what the user said** — Before diving into your answer, briefly confirm you understand their request.

## RESPONSE FORMAT

Respond with valid JSON:

```json
{
  "message_to_user": "Your detailed, helpful response with source citations where applicable."
}
```

## TONE
- Professional but conversational
- Concise yet thorough — don't pad responses, but don't omit important details
- When you cite sources, weave them naturally into your response"""


# ─── LLM Configuration ─────────────────────────────────

@dataclass
class LLMConfig:
    """
    Configuration for the LLM backend. Designed to be swapped
    between dev (8B local) and production (70B cluster).
    """
    model: str = "llama3.1:8b"
    base_url: str = "http://localhost:11434"
    temperature: float = 0.3
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
            temperature=0.2,
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
    ) -> PlannerResponse:
        """
        Process a user message and return a response.

        Steps:
        1. Get/create conversation session
        2. Update rolling summary (compress old messages)
        3. Refine query → RAG search with reranking + context window
        4. Build prompt: system + history + RAG context + user message
        5. Call LLM
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

        # ── Step 3: RAG retrieval ──
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
        )

        # ── Step 5: Call LLM ──
        raw_response = await self._call_ollama(messages)

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
            },
            "format": "json",
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

    def _parse_llm_response(
        self,
        raw_response: str,
        rag_citations: list[str],
    ) -> PlannerResponse:
        """
        Parse the LLM's raw text into a PlannerResponse.
        Handles markdown code fences, malformed JSON, plain text, etc.
        """
        cleaned = raw_response.strip()

        # Strip markdown code fences if present
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
            cleaned = re.sub(r"\n?```\s*$", "", cleaned)

        try:
            data = json.loads(cleaned)
            message = data.get("message_to_user", data.get("message", ""))
        except json.JSONDecodeError:
            # If it's not JSON, just use the raw text as the message
            logger.info("LLM responded with plain text (not JSON) — using as-is")
            message = raw_response.strip()

        if not message:
            message = "I'm having trouble processing that. Could you rephrase your request?"

        return PlannerResponse(
            message_to_user=message,
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
