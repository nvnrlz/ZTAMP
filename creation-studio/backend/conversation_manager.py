"""
conversation_manager.py — Conversation State Manager

Manages multi-session conversations with:
1. Rolling summaries (compress old messages)
2. RAG result caching (reduce vector DB load)
3. Session lifecycle management

Architecture:
    ┌────────────────────────────────────────────────────────┐
    │                  ConversationSession                    │
    │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
    │  │   Rolling     │  │   RAG        │  │  Session     │  │
    │  │   Summary     │  │   Cache      │  │  Metadata    │  │
    │  │  (compress    │  │  (dedup      │  │  (files,     │  │
    │  │  old messages)│  │  RAG calls)  │  │  turn count) │  │
    │  └──────────────┘  └──────────────┘  └─────────────┘  │
    └────────────────────────────────────────────────────────┘
"""

import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Optional
from collections import OrderedDict

logger = logging.getLogger("conversation_manager")


# ─── Rolling Summary ─────────────────────────────────────

@dataclass
class RollingSummary:
    """
    Compresses older messages into a single summary paragraph.

    Strategy:
    - Keep the last `raw_window` message pairs as-is (full fidelity)
    - Everything older gets compressed into a rolling text summary
    - Summary stays under ~400 tokens (~1600 chars)
    """
    summary_text: str = ""
    last_summarized_index: int = 0
    key_facts: list[str] = field(default_factory=list)

    def needs_update(self, total_messages: int) -> bool:
        """Check if we need to compress more messages into the summary."""
        # Start summarizing after 6 raw messages
        raw_window = 6
        return total_messages > raw_window and self.last_summarized_index < (total_messages - raw_window)

    def to_prompt_block(self) -> str:
        if not self.summary_text:
            return ""
        return (
            f"## Conversation Summary (earlier messages)\n"
            f"{self.summary_text}\n"
        )

    def to_dict(self) -> dict:
        return {
            "summary_text": self.summary_text,
            "last_summarized_index": self.last_summarized_index,
            "key_facts": self.key_facts,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "RollingSummary":
        return cls(
            summary_text=data.get("summary_text", ""),
            last_summarized_index=data.get("last_summarized_index", 0),
            key_facts=data.get("key_facts", []),
        )


# ─── RAG Cache ────────────────────────────────────────────

class RAGSessionCache:
    """
    Caches RAG results per conversation session to avoid redundant
    vector searches.

    Strategy:
    - Cache by query hash → results
    - LRU eviction when cache is full
    - TTL-based expiry for stale results
    """

    def __init__(self, max_entries: int = 20, ttl_seconds: int = 600):
        self._cache: OrderedDict = OrderedDict()
        self._max_entries = max_entries
        self._ttl = ttl_seconds

    def _hash_query(self, query: str) -> str:
        return query.strip().lower()[:200]

    def get(self, query: str) -> Optional[list]:
        key = self._hash_query(query)
        if key in self._cache:
            entry = self._cache[key]
            if time.time() - entry["timestamp"] < self._ttl:
                self._cache.move_to_end(key)
                return entry["results"]
            else:
                del self._cache[key]
        return None

    def put(self, query: str, results: list) -> None:
        key = self._hash_query(query)
        self._cache[key] = {
            "results": results,
            "timestamp": time.time(),
        }
        self._cache.move_to_end(key)
        while len(self._cache) > self._max_entries:
            self._cache.popitem(last=False)

    def get_all_unique_chunks(self) -> list:
        """Return all unique chunks across cached queries (for context)."""
        seen = set()
        unique = []
        for entry in self._cache.values():
            for chunk in entry["results"]:
                key = (chunk.filename, chunk.chunk_index)
                if key not in seen:
                    seen.add(key)
                    unique.append(chunk)
        return unique


# ─── Session State ────────────────────────────────────────

@dataclass
class ConversationSession:
    """
    Complete state for one user's conversation.

    In production, this would be stored in Redis with the session_id
    as the key, enabling horizontal scaling across multiple backend
    instances.
    """
    session_id: str
    rolling_summary: RollingSummary = field(default_factory=RollingSummary)
    rag_cache: RAGSessionCache = field(default_factory=RAGSessionCache)
    attached_files: set[str] = field(default_factory=set)
    turn_count: int = 0
    created_at: float = field(default_factory=time.time)
    last_active: float = field(default_factory=time.time)

    def touch(self):
        self.last_active = time.time()

    def to_serializable(self) -> dict:
        """Serialize for Redis/persistent storage."""
        return {
            "session_id": self.session_id,
            "rolling_summary": self.rolling_summary.to_dict(),
            "attached_files": list(self.attached_files),
            "turn_count": self.turn_count,
            "created_at": self.created_at,
            "last_active": self.last_active,
        }

    @classmethod
    def from_serializable(cls, data: dict) -> "ConversationSession":
        session = cls(session_id=data["session_id"])
        session.rolling_summary = RollingSummary.from_dict(data.get("rolling_summary", {}))
        session.attached_files = set(data.get("attached_files", []))
        session.turn_count = data.get("turn_count", 0)
        session.created_at = data.get("created_at", time.time())
        session.last_active = data.get("last_active", time.time())
        return session


# ─── Conversation Manager ─────────────────────────────────

class ConversationManager:
    """
    Manages conversation sessions with context handling.

    This orchestrator:
    1. Manages rolling summaries (compresses old messages)
    2. Caches RAG results (reduces vector DB load)
    3. Builds optimized LLM prompts (minimal tokens, maximum context)
    """

    SESSION_TTL = 3600  # 1 hour

    # ── Context budget ──
    MAX_RAW_HISTORY_PAIRS = 3    # Keep last 3 user+assistant pairs raw
    MAX_RAG_CHUNKS = 5           # 5 direct + ~8 neighbors = ~13 total
    MAX_SUMMARY_TOKENS = 400     # Rolling summary budget
    MAX_OUTPUT_TOKENS = 2048     # LLM response budget

    def __init__(self):
        self._sessions: dict[str, ConversationSession] = {}
        self._cleanup_counter = 0
        logger.info("ConversationManager initialized")

    def get_or_create_session(self, session_id: str) -> ConversationSession:
        """Get an existing session or create a new one."""
        if session_id not in self._sessions:
            self._sessions[session_id] = ConversationSession(session_id=session_id)
            logger.info("Created new session: %s", session_id)

        session = self._sessions[session_id]
        session.touch()

        # Periodic cleanup
        self._cleanup_counter += 1
        if self._cleanup_counter % 100 == 0:
            self._cleanup_expired_sessions()

        return session

    def update_rolling_summary(
        self,
        session: ConversationSession,
        conversation_history: list[dict],
    ) -> None:
        """Compress older messages into the rolling summary."""
        new_summary = self.generate_rolling_summary(
            conversation_history,
            session.rolling_summary.summary_text,
        )
        session.rolling_summary.summary_text = new_summary
        session.rolling_summary.last_summarized_index = len(conversation_history)

    def track_attached_files(
        self,
        session: ConversationSession,
        files: list[str],
    ) -> None:
        """Track attached files across the session."""
        session.attached_files.update(files)

    def build_optimized_messages(
        self,
        session: ConversationSession,
        system_prompt: str,
        user_message: str,
        conversation_history: list[dict],
        rag_context: str,
        attached_note: str = "",
        context_budget_tokens: int = 0,
    ) -> list[dict]:
        """
        Build a token-budget-aware message array for the LLM.

        Priority (must-have filled first):
          1. System prompt  — fixed instructions (MUST-HAVE)
          2. Augmented user message with RAG + question (MUST-HAVE)
          3. Rolling summary  — condensed history (OPTIONAL, budget permitting)
          4. Recent conversation pairs  (OPTIONAL, budget permitting)
        """
        # ── Calculate budget ──
        # Reserve tokens for the LLM response
        response_reserve = self.MAX_OUTPUT_TOKENS  # 2048
        total_budget = (context_budget_tokens or 30720) - response_reserve

        # ══════════════════════════════════════════════════
        # MUST-HAVE #1: System prompt
        # ══════════════════════════════════════════════════
        system_msg = {"role": "system", "content": system_prompt}
        used_tokens = self._estimate_tokens(system_prompt)

        # ══════════════════════════════════════════════════
        # MUST-HAVE #2: Augmented user message (RAG + slash commands + question)
        # ══════════════════════════════════════════════════
        augmented = (
            f"## Retrieved Document Content\n"
            f"{rag_context}"
            f"{attached_note}\n\n"
        )

        if session.attached_files:
            augmented += (
                f"## Files Referenced in This Session\n"
                + "\n".join(f"- {f}" for f in sorted(session.attached_files))
                + "\n\n"
            )

        # ── Parse slash commands from user message ──
        defined_params, floating_params, clean_message = self._parse_slash_commands(
            user_message
        )

        augmented += (
            f"## User's Request\n"
            f"{clean_message}\n\n"
        )

        # Add structured parameter block if slash commands were found
        if defined_params or floating_params:
            augmented += "## User-Specified Parameters\n"
            if defined_params:
                augmented += "### Defined Parameters (concrete values):\n"
                for i, dp in enumerate(defined_params, 1):
                    augmented += f"{i}. {dp}\n"
                augmented += "\n"
            if floating_params:
                augmented += "### Floating Parameters (to be decided at runtime):\n"
                for i, fp in enumerate(floating_params, 1):
                    augmented += f"{i}. {fp} → use {{{{param_name}}}} in steps\n"
                augmented += "\n"
            augmented += (
                "## Cross-Reference Task\n"
                "Compare the user-specified parameters against ALL parameters "
                "from the Retrieved Document Content — mandatory, optional, and defaults. "
                "List EVERY parameter from the docs for THIS SPECIFIC TASK ONLY. "
                "If any are NOT covered by /dp or /fp, use intent='clarification' "
                "and list ALL unaccounted ones (mandatory AND optional). "
                "If ALL are covered, use intent='action'. "
                "Generate steps ONLY for the exact task requested — do NOT expand scope.\n\n"
            )
        else:
            # No slash commands — check if it's a PARAMETER DECISIONS message
            if user_message.strip().startswith("PARAMETER DECISIONS"):
                augmented += (
                    "The user has made explicit choices for EVERY missing parameter. "
                    "You MUST respond with intent='action' and generate the complete workflow. "
                    "For [PROVIDED] params use the exact value. For [DEFERRED] params use {{param_name}} syntax. "
                    "For [DEFAULT] params use the document-recommended default. "
                    "Generate steps ONLY for the exact task the user originally requested.\n\n"
                )
            else:
                augmented += (
                    "Begin by writing your <parameter_audit> reasoning block. "
                    "Then output a valid JSON object with your response.\n\n"
                )

        user_msg = {"role": "user", "content": augmented}
        used_tokens += self._estimate_tokens(augmented)

        # ══════════════════════════════════════════════════
        # OPTIONAL: Rolling summary (if budget allows)
        # ══════════════════════════════════════════════════
        optional_messages: list[dict] = []
        summary_block = session.rolling_summary.to_prompt_block()
        if summary_block:
            summary_tokens = self._estimate_tokens(summary_block)
            if used_tokens + summary_tokens < total_budget:
                optional_messages.append({
                    "role": "system",
                    "content": summary_block,
                })
                used_tokens += summary_tokens
                logger.debug(
                    "Token budget: added rolling summary (%d tokens, %d/%d used)",
                    summary_tokens, used_tokens, total_budget,
                )
            else:
                logger.info(
                    "Token budget: skipping rolling summary (%d tokens would exceed %d/%d)",
                    summary_tokens, used_tokens, total_budget,
                )

        # ══════════════════════════════════════════════════
        # OPTIONAL: Recent conversation history (newest first, if budget allows)
        # ══════════════════════════════════════════════════
        history_messages: list[dict] = []
        if conversation_history:
            # Try to include recent history, newest first
            max_pairs = self.MAX_RAW_HISTORY_PAIRS
            raw_window = max_pairs * 2
            candidates = conversation_history[-raw_window:]

            for msg in reversed(candidates):
                role = msg.get("role", "user")
                content = msg.get("content", "")
                msg_tokens = self._estimate_tokens(content)

                if used_tokens + msg_tokens < total_budget:
                    history_messages.insert(0, {"role": role, "content": content})
                    used_tokens += msg_tokens
                else:
                    logger.info(
                        "Token budget: stopping history inclusion (%d/%d used, next msg: %d tokens)",
                        used_tokens, total_budget, msg_tokens,
                    )
                    break

        # ── Assemble final message array ──
        messages = [system_msg]
        messages.extend(optional_messages)  # rolling summary
        messages.extend(history_messages)   # conversation history (budget-limited)
        messages.append(user_msg)           # augmented user message (always last)

        logger.info(
            "Context budget: %d/%d tokens used (%d system, %d history msgs, %d user+RAG) | "
            "%d tokens remaining",
            used_tokens, total_budget,
            self._estimate_tokens(system_prompt),
            len(history_messages),
            self._estimate_tokens(augmented),
            total_budget - used_tokens,
        )

        return messages

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        """
        Rough token estimate: ~4 characters per token for English text.
        This is a fast heuristic — production would use tiktoken or similar.
        """
        return max(1, len(text) // 4)

    @staticmethod
    def _parse_slash_commands(
        message: str,
    ) -> tuple[list[str], list[str], str]:
        """
        Parse /dp and /fp slash commands from the user message.

        Supports:
          /dp <value/description>  or  /defined <value/description>
          /fp <description>        or  /floating <description>

        Returns:
          (defined_params, floating_params, clean_message)
        """
        defined_params: list[str] = []
        floating_params: list[str] = []

        # Pattern: match /dp, /defined, /fp, /floating followed by text
        # until the next slash command or end of string
        pattern = re.compile(
            r'/(dp|defined|fp|floating)\s+'   # command
            r'(.*?)'                           # content (lazy)
            r'(?=\s*/(?:dp|defined|fp|floating)\b|$)',  # lookahead for next cmd or end
            re.IGNORECASE | re.DOTALL,
        )

        for match in pattern.finditer(message):
            cmd_type = match.group(1).lower()
            content = match.group(2).strip()
            if not content:
                continue

            if cmd_type in ('dp', 'defined'):
                defined_params.append(content)
            elif cmd_type in ('fp', 'floating'):
                floating_params.append(content)

        # Remove slash commands from the message to get the clean request
        clean_message = pattern.sub('', message).strip()
        # Collapse extra whitespace
        clean_message = re.sub(r'\s{2,}', ' ', clean_message).strip()

        if defined_params or floating_params:
            logger.info(
                "Parsed slash commands: %d defined, %d floating",
                len(defined_params), len(floating_params),
            )

        return defined_params, floating_params, clean_message

    def generate_rolling_summary(
        self,
        conversation_history: list[dict],
        existing_summary: str,
    ) -> str:
        """
        Generate a rolling summary from conversation history.

        Extracts key facts from older messages that will be compressed
        out of the raw message window.
        """
        raw_window = self.MAX_RAW_HISTORY_PAIRS * 2
        messages_to_summarize = conversation_history[:-raw_window] if len(conversation_history) > raw_window else []

        if not messages_to_summarize:
            return existing_summary

        facts = []
        for msg in messages_to_summarize:
            role = msg.get("role", getattr(msg, "role", ""))
            content = msg.get("content", getattr(msg, "content", ""))
            if role == "user" and content.strip():
                fact = content.strip()[:150]
                if len(content.strip()) > 150:
                    fact += "…"
                facts.append(f"- User: {fact}")
            elif role == "assistant" and content.strip():
                try:
                    parsed = json.loads(content)
                    msg_text = parsed.get("message_to_user", "")[:100]
                    if msg_text:
                        facts.append(f"- Agent: {msg_text}")
                except (json.JSONDecodeError, AttributeError):
                    short = content.strip()[:100]
                    if short:
                        facts.append(f"- Agent: {short}")

        if not facts:
            return existing_summary

        if existing_summary:
            summary = f"{existing_summary}\n\nSubsequent turns:\n" + "\n".join(facts[-6:])
        else:
            summary = "Conversation started with:\n" + "\n".join(facts[-8:])

        if len(summary) > 1600:
            summary = summary[:1600] + "…"

        return summary

    def _cleanup_expired_sessions(self):
        """Remove sessions that have been inactive for too long."""
        now = time.time()
        expired = [
            sid for sid, session in self._sessions.items()
            if now - session.last_active > self.SESSION_TTL
        ]
        for sid in expired:
            del self._sessions[sid]
        if expired:
            logger.info("Cleaned up %d expired sessions", len(expired))

    def get_session_count(self) -> int:
        return len(self._sessions)

    def get_session_stats(self) -> dict:
        """Get stats for monitoring."""
        return {
            "active_sessions": len(self._sessions),
            "sessions": {
                sid: {
                    "turn_count": s.turn_count,
                    "summary_length": len(s.rolling_summary.summary_text),
                    "attached_files": len(s.attached_files),
                    "idle_seconds": int(time.time() - s.last_active),
                }
                for sid, s in self._sessions.items()
            },
        }
