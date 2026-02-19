"""
rag_engine.py — The Knowledge Base

Provides RAGProvider: connects to the PostgreSQL/pgvector database
that already stores document chunks from vectorize.py, converts
queries to embeddings using all-MiniLM-L6-v2, and performs cosine
similarity search against stored vectors.
"""

import os
import re
import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional

import psycopg2
import psycopg2.extras
from sentence_transformers import SentenceTransformer

logger = logging.getLogger("rag_engine")

# ─── Types ──────────────────────────────────────────────

@dataclass
class ContextChunk:
    """A single context fragment retrieved from the vector database."""
    content: str
    filename: str
    chunk_index: int
    similarity: float
    page_number: Optional[int] = None  # populated when Docling provides provenance

    @property
    def citation(self) -> str:
        """Human-readable citation string, with page number if available."""
        if self.page_number and self.page_number > 0:
            return f"{self.filename} (Page {self.page_number})"
        return f"{self.filename} (chunk {self.chunk_index})"

    def __repr__(self) -> str:
        preview = self.content[:80].replace("\n", " ")
        return f"ContextChunk({self.citation}, sim={self.similarity:.3f}, '{preview}…')"


# ─── RAG Provider ───────────────────────────────────────

class RAGProvider:
    """
    Handles embedding generation and cosine similarity search
    against the PostgreSQL/pgvector document_vectors table.

    Table schema (from vectorize.py):
        id SERIAL PRIMARY KEY,
        filename TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        embedding vector(384),
        created_at TIMESTAMP DEFAULT NOW()
    """

    EMBEDDING_MODEL = "all-MiniLM-L6-v2"
    EMBEDDING_DIM = 384

    def __init__(
        self,
        dbname: str = "vectordb",
        host: str = "localhost",
        port: str = "5432",
        user: Optional[str] = None,
        password: Optional[str] = None,
    ):
        self._db_config = {
            "dbname": dbname,
            "host": host,
            "port": port,
            "user": user or os.environ.get("PGUSER", os.environ.get("USER", "postgres")),
            "password": password or os.environ.get("PGPASSWORD", ""),
        }
        self._model: Optional[SentenceTransformer] = None
        self._conn: Optional[psycopg2.extensions.connection] = None
        logger.info("RAGProvider initialized (model=%s, db=%s@%s)", self.EMBEDDING_MODEL, dbname, host)

    # ── Lazy model loading ─────────────────────────────

    @property
    def model(self) -> SentenceTransformer:
        """Load embedding model on first use (avoids startup latency if RAG is unused)."""
        if self._model is None:
            logger.info("Loading embedding model: %s …", self.EMBEDDING_MODEL)
            self._model = SentenceTransformer(self.EMBEDDING_MODEL)
            logger.info("Embedding model loaded (%d-dim)", self.EMBEDDING_DIM)
        return self._model

    # ── Database connection ────────────────────────────

    def _get_conn(self) -> psycopg2.extensions.connection:
        """Get or create a persistent database connection."""
        if self._conn is None or self._conn.closed:
            logger.info("Connecting to PostgreSQL: %s@%s:%s/%s",
                        self._db_config["user"], self._db_config["host"],
                        self._db_config["port"], self._db_config["dbname"])
            self._conn = psycopg2.connect(**self._db_config)
        return self._conn

    def _ensure_pgvector(self):
        """Make sure the pgvector extension and table exist."""
        conn = self._get_conn()
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            cur.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_name = 'document_vectors'
                );
            """)
            exists = cur.fetchone()[0]
        conn.commit()
        return exists

    def _has_column(self, table_name: str, column_name: str) -> bool:
        """Check if a column exists in a table (for backward compatibility)."""
        conn = self._get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = %s AND column_name = %s
                    );
                """, (table_name, column_name))
                return cur.fetchone()[0]
        except Exception:
            return False

    # ── Core: vector search ────────────────────────────

    def search_context(
        self,
        query_text: str,
        top_k: int = 5,
        similarity_threshold: float = 0.45,
    ) -> list[ContextChunk]:
        """
        Convert query_text to an embedding and run cosine similarity
        search against stored document vectors.

        Args:
            query_text: The user's query or message.
            top_k: Maximum number of results to return.
            similarity_threshold: Minimum cosine similarity (0→1) to include.
                Raised to 0.45 (from 0.25) to filter out low-relevance noise.

        Returns:
            List of ContextChunk sorted by descending similarity.
        """
        if not query_text.strip():
            return []

        # Check if table exists
        if not self._ensure_pgvector():
            logger.warning("document_vectors table does not exist — no RAG context available")
            return []

        # Check if page_number column exists (backward compatibility)
        has_page_col = self._has_column("document_vectors", "page_number")

        # Generate embedding for the query
        query_embedding = self.model.encode(query_text).tolist()

        # Cosine similarity search via pgvector
        # pgvector's <=> operator gives cosine DISTANCE (1 - similarity).
        # So similarity = 1 - distance.
        conn = self._get_conn()

        page_col = ", page_number" if has_page_col else ", NULL AS page_number"
        sql = f"""
            SELECT
                filename,
                chunk_index,
                content,
                1 - (embedding <=> %s::vector) AS similarity
                {page_col}
            FROM document_vectors
            WHERE 1 - (embedding <=> %s::vector) >= %s
            ORDER BY embedding <=> %s::vector
            LIMIT %s;
        """
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                vec_str = str(query_embedding)
                cur.execute(sql, (vec_str, vec_str, similarity_threshold, vec_str, top_k))
                rows = cur.fetchall()
        except Exception as e:
            logger.error("Vector search failed: %s", e)
            conn.rollback()
            return []

        chunks = [
            ContextChunk(
                content=row["content"],
                filename=row["filename"],
                chunk_index=row["chunk_index"],
                similarity=float(row["similarity"]),
                page_number=row["page_number"] if row["page_number"] else None,
            )
            for row in rows
        ]

        logger.info(
            "RAG search for '%s…' → %d result(s) (top sim=%.3f)",
            query_text[:50], len(chunks),
            chunks[0].similarity if chunks else 0.0,
        )
        return chunks

    # ── Re-ranking (BM25-lite keyword overlap) ─────────

    @staticmethod
    def _extract_keywords(text: str) -> set[str]:
        """Extract meaningful keywords from text, ignoring common stop words."""
        stop_words = {
            "the", "a", "an", "is", "are", "was", "were", "be", "been",
            "being", "have", "has", "had", "do", "does", "did", "will",
            "would", "could", "should", "may", "might", "can", "shall",
            "to", "of", "in", "for", "on", "with", "at", "by", "from",
            "and", "or", "but", "not", "so", "if", "then", "that",
            "this", "it", "its", "i", "you", "we", "they", "me", "my",
            "your", "our", "their", "what", "how", "when", "where",
            "which", "who", "about", "up", "out", "into",
        }
        words = set(re.findall(r"[a-z0-9]{2,}", text.lower()))
        return words - stop_words

    def _rerank_with_keywords(
        self,
        query_text: str,
        chunks: list[ContextChunk],
        cosine_weight: float = 0.7,
        keyword_weight: float = 0.3,
    ) -> list[ContextChunk]:
        """
        Re-rank chunks by combining cosine similarity (semantic) with
        keyword overlap (BM25-lite lexical matching).

        This catches cases where embeddings miss exact term matches,
        e.g. "NAT gateway" might have low cosine sim but exact keyword match.
        """
        query_keywords = self._extract_keywords(query_text)
        if not query_keywords:
            return chunks  # no keywords to match, keep cosine order

        scored = []
        for chunk in chunks:
            chunk_keywords = self._extract_keywords(chunk.content)
            if chunk_keywords:
                overlap = len(query_keywords & chunk_keywords)
                keyword_score = overlap / len(query_keywords)
            else:
                keyword_score = 0.0

            combined = (cosine_weight * chunk.similarity) + (keyword_weight * keyword_score)
            scored.append((combined, keyword_score, chunk))

        scored.sort(key=lambda x: x[0], reverse=True)

        # Log re-ranking changes
        for combined, kw_score, chunk in scored[:3]:
            logger.debug(
                "  Reranked: %s (cos=%.3f, kw=%.3f, combined=%.3f)",
                chunk.citation, chunk.similarity, kw_score, combined,
            )

        return [chunk for _, _, chunk in scored]

    def search_context_with_rerank(
        self,
        query_text: str,
        final_top_k: int = 8,
        candidate_pool: int = 15,
        similarity_threshold: float = 0.35,
    ) -> list[ContextChunk]:
        """
        Retrieve a wide pool of candidates, then re-rank using keyword
        overlap to surface the most relevant chunks.

        Strategy:
        1. Fetch top-15 by cosine similarity (wider net, lower threshold)
        2. Re-rank by combining cosine (70%) + keyword overlap (30%)
        3. Return the top-8 after re-ranking

        The lower initial threshold (0.35) catches candidates that might
        be lexically relevant but have slightly lower embedding similarity.
        The re-ranking then promotes those with better keyword matches.
        """
        # Fetch wider pool
        candidates = self.search_context(
            query_text,
            top_k=candidate_pool,
            similarity_threshold=similarity_threshold,
        )

        if not candidates:
            return []

        # Re-rank
        reranked = self._rerank_with_keywords(query_text, candidates)

        # Return top-N
        result = reranked[:final_top_k]
        logger.info(
            "Re-ranked %d candidates → top %d (query: '%s…')",
            len(candidates), len(result), query_text[:40],
        )
        return result

    # ── Context windowing (±1 neighbor chunks) ─────────

    def _fetch_neighbor_chunks(
        self,
        chunks: list[ContextChunk],
    ) -> list[ContextChunk]:
        """
        For each retrieved chunk, also fetch its immediate neighbors
        (chunk_index ± 1 from the same file) to ensure concepts that
        span chunk boundaries are fully captured.

        Deduplicates by (filename, chunk_index) to avoid repeats.
        """
        if not chunks:
            return chunks

        conn = self._get_conn()
        has_page_col = self._has_column("document_vectors", "page_number")
        page_col = ", page_number" if has_page_col else ", NULL AS page_number"

        # Collect all (filename, chunk_index) pairs we need to fetch
        seen = {(c.filename, c.chunk_index) for c in chunks}
        needed = []
        for c in chunks:
            for offset in (-1, 1):
                neighbor_idx = c.chunk_index + offset
                key = (c.filename, neighbor_idx)
                if neighbor_idx >= 0 and key not in seen:
                    needed.append(key)
                    seen.add(key)

        if not needed:
            return chunks

        # Fetch neighbors in a single query
        neighbor_chunks = []
        try:
            conditions = " OR ".join(
                f"(filename = %s AND chunk_index = %s)" for _ in needed
            )
            params = []
            for fn, ci in needed:
                params.extend([fn, ci])

            sql = f"""
                SELECT filename, chunk_index, content{page_col}
                FROM document_vectors
                WHERE {conditions};
            """
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(sql, params)
                for row in cur.fetchall():
                    neighbor_chunks.append(ContextChunk(
                        content=row["content"],
                        filename=row["filename"],
                        chunk_index=row["chunk_index"],
                        similarity=0.0,  # neighbor — no direct similarity score
                        page_number=row["page_number"] if row["page_number"] else None,
                    ))
        except Exception as e:
            logger.warning("Failed to fetch neighbor chunks: %s", e)
            return chunks

        logger.info("Context windowing: fetched %d neighbor chunks", len(neighbor_chunks))

        # Merge: group by file, sort by chunk_index for reading order
        all_chunks = chunks + neighbor_chunks
        by_file = defaultdict(list)
        for c in all_chunks:
            by_file[c.filename].append(c)

        # Sort each file's chunks by chunk_index
        result = []
        for fn in sorted(by_file.keys()):
            file_chunks = sorted(by_file[fn], key=lambda c: c.chunk_index)
            # Deduplicate
            seen_idx = set()
            for c in file_chunks:
                if c.chunk_index not in seen_idx:
                    seen_idx.add(c.chunk_index)
                    result.append(c)

        return result

    def search_with_context_window(
        self,
        query_text: str,
        final_top_k: int = 5,
        candidate_pool: int = 15,
        similarity_threshold: float = 0.35,
        expand_top_n: int = 3,
    ) -> list[ContextChunk]:
        """
        The most accurate search mode: retrieve → re-rank → expand with neighbors.

        Combines all three accuracy improvements:
        1. Wider candidate pool (15) with re-ranking
        2. Keyword overlap scoring (catches exact term matches)
        3. Context windowing (±1 chunks for the top-N most relevant results only)

        Only the top `expand_top_n` chunks get neighbor expansion to keep
        total context within the LLM's budget (~8K tokens for 8B model).
        """
        # Step 1+2: Retrieve and re-rank
        reranked = self.search_context_with_rerank(
            query_text,
            final_top_k=final_top_k,
            candidate_pool=candidate_pool,
            similarity_threshold=similarity_threshold,
        )

        if not reranked:
            return []

        # Step 3: Expand only the top-N most relevant chunks with neighbors
        # This limits context explosion while giving full context for key results
        chunks_to_expand = reranked[:expand_top_n]
        remaining = reranked[expand_top_n:]

        expanded = self._fetch_neighbor_chunks(chunks_to_expand)

        # Merge back the non-expanded chunks (deduplicate by filename+chunk_index)
        seen = {(c.filename, c.chunk_index) for c in expanded}
        for c in remaining:
            if (c.filename, c.chunk_index) not in seen:
                expanded.append(c)
                seen.add((c.filename, c.chunk_index))

        logger.info(
            "Full RAG pipeline: '%s…' → %d reranked → %d with context window",
            query_text[:40], len(reranked), len(expanded),
        )
        return expanded

    # ── Utility methods ────────────────────────────────

    def list_indexed_files(self) -> list[dict]:
        """Return a list of all files currently indexed in the vector database."""
        conn = self._get_conn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute("""
                    SELECT filename, COUNT(*) as chunk_count, MIN(created_at) as indexed_at
                    FROM document_vectors
                    GROUP BY filename
                    ORDER BY filename;
                """)
                return [
                    {
                        "filename": row["filename"],
                        "chunk_count": row["chunk_count"],
                        "indexed_at": row["indexed_at"].isoformat() if row["indexed_at"] else None,
                    }
                    for row in cur.fetchall()
                ]
        except Exception as e:
            logger.error("Failed to list indexed files: %s", e)
            return []

    def get_context_summary(self) -> dict:
        """Quick stats about the knowledge base."""
        conn = self._get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM document_vectors;")
                total_chunks = cur.fetchone()[0]
                cur.execute("SELECT COUNT(DISTINCT filename) FROM document_vectors;")
                total_files = cur.fetchone()[0]
            return {"total_files": total_files, "total_chunks": total_chunks}
        except Exception as e:
            logger.error("Failed to get context summary: %s", e)
            return {"total_files": 0, "total_chunks": 0}

    def format_context_for_prompt(self, chunks: list[ContextChunk]) -> str:
        """
        Format retrieved chunks into a string block for LLM prompts.

        Includes clear source attribution so the LLM can cite its sources.
        Neighbor chunks (similarity=0.0) are marked as context expansions.
        """
        if not chunks:
            return "No relevant documents found in the knowledge base.\n⚠️ The answer below is based on general knowledge, NOT your documents."

        sections = []
        for i, chunk in enumerate(chunks, 1):
            if chunk.similarity > 0:
                header = f"── Source {i}: {chunk.citation} (relevance: {chunk.similarity:.0%}) ──"
            else:
                header = f"── Source {i}: {chunk.citation} (context expansion) ──"
            sections.append(f"{header}\n{chunk.content}\n")
        return "\n".join(sections)

    # ── Cleanup ────────────────────────────────────────

    def close(self):
        """Close the database connection."""
        if self._conn and not self._conn.closed:
            self._conn.close()
            logger.info("Database connection closed")
