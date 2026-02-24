"""
rag_engine.py — Hybrid RAG Engine (Dense + Sparse + Cross-Encoder Reranking)

Search Pipeline:
  ┌──────────────────────────────────────────────────────────────┐
  │ 1. DENSE SEARCH (semantic meaning)                          │
  │    Query → bge-m3 embedding → pgvector cosine similarity    │
  │    "What are VPC limits?" finds "peering restrictions"      │
  │                                                             │
  │ 2. SPARSE SEARCH (exact keyword matching)                   │
  │    Query → BM25 sparse vector → keyword overlap scoring     │
  │    "BucketName" finds exact "BucketName" in schemas         │
  │                                                             │
  │ 3. RRF MERGE (Reciprocal Rank Fusion)                       │
  │    Combines dense + sparse rankings into a unified list     │
  │                                                             │
  │ 4. CROSS-ENCODER RERANK (bge-reranker-v2-m3)               │
  │    Scores (query, doc) pairs jointly → guaranteed accuracy  │
  └──────────────────────────────────────────────────────────────┘
"""

import os
import re
import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

import psycopg2
import psycopg2.extras

logger = logging.getLogger("rag_engine")


# ─── Data Structures ────────────────────────────────────

@dataclass
class ContextChunk:
    """A single context fragment retrieved from the vector database."""
    content: str
    filename: str
    chunk_index: int
    similarity: float
    page_number: Optional[int] = None
    doc_type: Optional[str] = None       # "structured" | "unstructured" | "technical"
    chunk_strategy: Optional[str] = None  # "entity_level" | "character_window" | "semantic_context"
    section_title: Optional[str] = None   # Heading/section context

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
    Hybrid RAG engine using BAAI/bge-m3 for search and
    BAAI/bge-reranker-v2-m3 for cross-encoder reranking.

    Supports:
    - Dense vector search (pgvector cosine similarity)
    - Sparse vector search (BM25-like keyword matching)
    - Hybrid search (RRF merge of dense + sparse)
    - Cross-encoder reranking for precision
    - Metadata filtering (doc_type, chunk_strategy, file_type)
    - Context window expansion (±1 neighbor chunks)

    Table schema:
        embedding vector(1024)      — bge-m3 dense vector
        sparse_vector JSONB         — BM25 lexical weights
        doc_type TEXT               — "structured" | "unstructured" | "technical"
        chunk_strategy TEXT         — "entity_level" | "character_window" | "semantic_context"
        metadata JSONB              — Full chunk metadata
    """

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
        self._conn: Optional[psycopg2.extensions.connection] = None
        self._embedding_engine = None  # Lazy-loaded HybridEmbeddingEngine
        self._column_cache = {}  # Cache column existence checks
        logger.info("RAGProvider initialized (hybrid: bge-m3 + sparse + reranker)")

    # ── Lazy loading ──────────────────────────────────

    @property
    def engine(self):
        """Lazy-load the HybridEmbeddingEngine."""
        if self._embedding_engine is None:
            from embedding_engine import HybridEmbeddingEngine
            logger.info("Loading HybridEmbeddingEngine (bge-m3)...")
            self._embedding_engine = HybridEmbeddingEngine()
        return self._embedding_engine

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
        """Check if a column exists (cached for performance)."""
        cache_key = f"{table_name}.{column_name}"
        if cache_key not in self._column_cache:
            conn = self._get_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_name = %s AND column_name = %s
                        );
                    """, (table_name, column_name))
                    self._column_cache[cache_key] = cur.fetchone()[0]
            except Exception:
                self._column_cache[cache_key] = False
        return self._column_cache[cache_key]

    # ══════════════════════════════════════════════════════
    # SEARCH: Dense Vector Search
    # ══════════════════════════════════════════════════════

    def search_dense(
        self,
        query_text: str,
        top_k: int = 20,
        similarity_threshold: float = 0.35,
        metadata_filters: Optional[dict] = None,
    ) -> list[ContextChunk]:
        """
        Dense vector search using bge-m3 embeddings + pgvector cosine similarity.

        This finds semantically similar content even when exact keywords differ.
        """
        if not query_text.strip():
            return []

        if not self._ensure_pgvector():
            logger.warning("document_vectors table does not exist")
            return []

        # Generate query embedding
        query_result = self.engine.encode_query(query_text)
        query_embedding = query_result["dense"]
        if query_embedding is None:
            return []

        conn = self._get_conn()

        # Build optional columns
        extra_cols = ""
        for col in ["page_number", "doc_type", "chunk_strategy", "section_title"]:
            if self._has_column("document_vectors", col):
                extra_cols += f", {col}"
            else:
                extra_cols += f", NULL AS {col}"

        # Build WHERE clause with metadata filters
        where_parts = ["1 - (embedding <=> %s::vector) >= %s"]
        params = []
        if metadata_filters:
            for key, value in metadata_filters.items():
                if self._has_column("document_vectors", key) and value is not None:
                    if isinstance(value, list):
                        placeholders = ", ".join(["%s"] * len(value))
                        where_parts.append(f"{key} IN ({placeholders})")
                        params.extend(value)
                    else:
                        where_parts.append(f"{key} = %s")
                        params.append(value)

        where_clause = " AND ".join(where_parts)
        vec_str = str(query_embedding.tolist())

        sql = f"""
            SELECT filename, chunk_index, content,
                   1 - (embedding <=> %s::vector) AS similarity
                   {extra_cols}
            FROM document_vectors
            WHERE {where_clause}
            ORDER BY embedding <=> %s::vector
            LIMIT %s;
        """

        all_params = [vec_str] + params + [vec_str, similarity_threshold, vec_str, top_k]

        try:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(sql, all_params)
                rows = cur.fetchall()
        except Exception as e:
            logger.error("Dense search failed: %s", e)
            conn.rollback()
            return []

        chunks = [self._row_to_chunk(row) for row in rows]
        logger.info(
            "Dense search '%s…' → %d result(s) (top sim=%.3f)",
            query_text[:40], len(chunks),
            chunks[0].similarity if chunks else 0.0,
        )
        return chunks

    # ══════════════════════════════════════════════════════
    # SEARCH: Sparse (BM25-like) Keyword Search
    # ══════════════════════════════════════════════════════

    def search_sparse(
        self,
        query_text: str,
        top_k: int = 20,
        metadata_filters: Optional[dict] = None,
    ) -> list[ContextChunk]:
        """
        Sparse keyword search using BM25-like token matching against
        the sparse_vector JSONB column.

        This catches exact keyword matches that dense embeddings might miss,
        e.g. "BucketName", "NAT gateway", specific error codes.
        """
        if not query_text.strip():
            return []

        if not self._has_column("document_vectors", "sparse_vector"):
            logger.info("No sparse_vector column — skipping sparse search")
            return []

        # Generate query sparse vector (bge-m3 produces native sparse)
        query_result = self.engine.encode_query(query_text)
        query_sparse = query_result.get("sparse", {})

        if not query_sparse:
            return []

        # Get top tokens from query (most distinctive)
        top_tokens = sorted(query_sparse.items(), key=lambda x: x[1], reverse=True)[:10]
        search_tokens = [t for t, w in top_tokens]

        if not search_tokens:
            return []

        conn = self._get_conn()

        # Build optional columns
        extra_cols = ""
        for col in ["page_number", "doc_type", "chunk_strategy", "section_title"]:
            if self._has_column("document_vectors", col):
                extra_cols += f", {col}"
            else:
                extra_cols += f", NULL AS {col}"

        # Build metadata filter WHERE clause
        where_parts = []
        params = []

        # Match documents that contain ANY of the query tokens
        token_conditions = []
        for token in search_tokens:
            token_conditions.append("sparse_vector ? %s")
            params.append(token)
        where_parts.append(f"({' OR '.join(token_conditions)})")

        if metadata_filters:
            for key, value in metadata_filters.items():
                if self._has_column("document_vectors", key) and value is not None:
                    if isinstance(value, list):
                        placeholders = ", ".join(["%s"] * len(value))
                        where_parts.append(f"{key} IN ({placeholders})")
                        params.extend(value)
                    else:
                        where_parts.append(f"{key} = %s")
                        params.append(value)

        where_clause = " AND ".join(where_parts) if where_parts else "TRUE"

        sql = f"""
            SELECT filename, chunk_index, content,
                   sparse_vector, 0.0 AS similarity
                   {extra_cols}
            FROM document_vectors
            WHERE {where_clause}
            LIMIT %s;
        """

        params.append(top_k * 3)  # Fetch more, then score in Python

        try:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()
        except Exception as e:
            logger.error("Sparse search failed: %s", e)
            conn.rollback()
            return []

        # Score each result by token overlap weight
        scored = []
        for row in rows:
            doc_sparse = row["sparse_vector"]
            if isinstance(doc_sparse, str):
                doc_sparse = json.loads(doc_sparse)
            if not isinstance(doc_sparse, dict):
                doc_sparse = {}

            score = self.engine.compute_sparse_similarity(query_sparse, doc_sparse)
            if score > 0:
                chunk = self._row_to_chunk(row)
                chunk.similarity = score
                scored.append(chunk)

        # Sort by sparse score, return top-K
        scored.sort(key=lambda c: c.similarity, reverse=True)
        result = scored[:top_k]

        logger.info(
            "Sparse search '%s…' → %d/%d scored (top sparse=%.3f)",
            query_text[:40], len(result), len(rows),
            result[0].similarity if result else 0.0,
        )
        return result

    # ══════════════════════════════════════════════════════
    # SEARCH: Hybrid (Dense + Sparse + RRF)
    # ══════════════════════════════════════════════════════

    def search_hybrid(
        self,
        query_text: str,
        top_k: int = 15,
        dense_top_k: int = 20,
        sparse_top_k: int = 20,
        similarity_threshold: float = 0.35,
        metadata_filters: Optional[dict] = None,
    ) -> list[ContextChunk]:
        """
        Hybrid search: combines dense (semantic) + sparse (keyword) results
        using Reciprocal Rank Fusion (RRF).

        This is the primary search method. It captures BOTH semantic meaning
        AND exact keywords, giving the best of both worlds.
        """
        # ── Step 1: Dense search ──
        dense_results = self.search_dense(
            query_text,
            top_k=dense_top_k,
            similarity_threshold=similarity_threshold,
            metadata_filters=metadata_filters,
        )

        # ── Step 2: Sparse search ──
        sparse_results = self.search_sparse(
            query_text,
            top_k=sparse_top_k,
            metadata_filters=metadata_filters,
        )

        if not dense_results and not sparse_results:
            return []

        # If sparse is empty, just use dense
        if not sparse_results:
            logger.info("Hybrid search: sparse returned 0 — using dense only (%d)", len(dense_results))
            return dense_results[:top_k]

        # ── Step 3: RRF Merge ──
        # Build ranked lists as (id, score) tuples
        all_chunks = {}  # id → ContextChunk

        dense_ranked = []
        for chunk in dense_results:
            chunk_id = f"{chunk.filename}:{chunk.chunk_index}"
            dense_ranked.append((chunk_id, chunk.similarity))
            all_chunks[chunk_id] = chunk

        sparse_ranked = []
        for chunk in sparse_results:
            chunk_id = f"{chunk.filename}:{chunk.chunk_index}"
            sparse_ranked.append((chunk_id, chunk.similarity))
            if chunk_id not in all_chunks:
                all_chunks[chunk_id] = chunk

        # RRF merge
        rrf_merged = self.engine.reciprocal_rank_fusion(
            [dense_ranked, sparse_ranked], k=60
        )

        # Build final result list
        result = []
        for chunk_id, rrf_score in rrf_merged[:top_k]:
            if chunk_id in all_chunks:
                chunk = all_chunks[chunk_id]
                chunk.similarity = rrf_score  # Replace with RRF score
                result.append(chunk)

        logger.info(
            "Hybrid search '%s…': dense=%d, sparse=%d → RRF merged=%d",
            query_text[:40], len(dense_results), len(sparse_results), len(result),
        )
        return result

    # ══════════════════════════════════════════════════════
    # SEARCH: With Cross-Encoder Reranking
    # ══════════════════════════════════════════════════════

    def search_with_rerank(
        self,
        query_text: str,
        final_top_k: int = 8,
        candidate_pool: int = 20,
        similarity_threshold: float = 0.35,
        metadata_filters: Optional[dict] = None,
    ) -> list[ContextChunk]:
        """
        Full precision search: hybrid retrieval → cross-encoder reranking.

        1. Hybrid search (dense + sparse) → top-20 candidates
        2. Cross-encoder reranking (bge-reranker-v2-m3) → final top-K
        3. The reranker mathematically scores each (query, doc) pair jointly,
           GUARANTEEING the #1 result is the most relevant.

        This is the highest-accuracy search mode.
        """
        # Step 1: Hybrid retrieval
        candidates = self.search_hybrid(
            query_text,
            top_k=candidate_pool,
            similarity_threshold=similarity_threshold,
            metadata_filters=metadata_filters,
        )

        if not candidates:
            return []

        if len(candidates) <= 2:
            # Not enough candidates to justify reranking overhead
            return candidates

        # Step 2: Cross-encoder reranking
        doc_texts = [c.content for c in candidates]
        reranked = self.engine.rerank(query_text, doc_texts, top_k=final_top_k)

        # Map reranked indices back to ContextChunks
        result = []
        for r in reranked:
            idx = r["index"]
            if idx < len(candidates):
                chunk = candidates[idx]
                chunk.similarity = r["score"]  # Use reranker score
                result.append(chunk)

        logger.info(
            "Reranked '%s…': %d candidates → top %d (reranker score: %.4f → %.4f)",
            query_text[:40], len(candidates), len(result),
            result[0].similarity if result else 0,
            result[-1].similarity if result else 0,
        )
        return result

    # ══════════════════════════════════════════════════════
    # SEARCH: Context Window Expansion
    # ══════════════════════════════════════════════════════

    def _fetch_neighbor_chunks(
        self,
        chunks: list[ContextChunk],
    ) -> list[ContextChunk]:
        """
        Fetch ±1 neighbor chunks for context continuity.
        Ensures concepts spanning chunk boundaries are fully captured.
        """
        if not chunks:
            return chunks

        conn = self._get_conn()

        # Build optional columns
        extra_cols = ""
        for col in ["page_number", "doc_type", "chunk_strategy", "section_title"]:
            if self._has_column("document_vectors", col):
                extra_cols += f", {col}"
            else:
                extra_cols += f", NULL AS {col}"

        # Collect neighbor keys
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
            params = [v for pair in needed for v in pair]

            sql = f"""
                SELECT filename, chunk_index, content,
                       0.0 AS similarity
                       {extra_cols}
                FROM document_vectors
                WHERE {conditions};
            """

            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute(sql, params)
                for row in cur.fetchall():
                    neighbor_chunks.append(self._row_to_chunk(row))

        except Exception as e:
            logger.warning("Neighbor fetch failed: %s", e)

        logger.info("Context windowing: fetched %d neighbor chunks", len(neighbor_chunks))

        # Merge: original chunks first, then neighbors
        all_chunks = list(chunks) + neighbor_chunks
        all_chunks.sort(key=lambda c: (c.filename, c.chunk_index))
        return all_chunks

    # ══════════════════════════════════════════════════════
    # SEARCH: Multi-Query (Agentic RAG)
    # ══════════════════════════════════════════════════════

    def search_multi_query(
        self,
        queries: list[str],
        key_concepts: list[str] | None = None,
        top_k_per_query: int = 8,
        final_top_k: int = 8,
        similarity_threshold: float = 0.35,
        expand_top_n: int = 3,
        metadata_filters: Optional[dict] = None,
    ) -> list[ContextChunk]:
        """
        Execute multiple search queries with hybrid search, merge, and rerank.

        This is the KEY agentic RAG method:
        1. For each query: hybrid search (dense + sparse + RRF)
        2. Merge + deduplicate across all queries
        3. Cross-encoder rerank the merged results
        4. Context window expansion for top results

        Returns the highest quality context possible.
        """
        if not queries:
            return []

        # ── Execute hybrid search for each query ──
        all_results: dict[tuple[str, int], ContextChunk] = {}

        for i, query in enumerate(queries):
            logger.info("Multi-query search [%d/%d]: '%s…'", i + 1, len(queries), query[:50])

            chunks = self.search_hybrid(
                query_text=query,
                top_k=top_k_per_query * 2,
                similarity_threshold=similarity_threshold,
                metadata_filters=metadata_filters,
            )

            for chunk in chunks:
                key = (chunk.filename, chunk.chunk_index)
                if key not in all_results or chunk.similarity > all_results[key].similarity:
                    all_results[key] = chunk

        if not all_results:
            return []

        # ── Merge and sort ──
        merged = sorted(all_results.values(), key=lambda c: c.similarity, reverse=True)
        logger.info("Multi-query merge: %d unique chunks from %d queries", len(merged), len(queries))

        # ── Cross-encoder rerank the merged results ──
        if len(merged) > 3:
            # Use the first query as the primary reranking query
            primary_query = queries[0]
            doc_texts = [c.content for c in merged[:final_top_k * 2]]

            reranked = self.engine.rerank(primary_query, doc_texts, top_k=final_top_k)
            top_results = []
            for r in reranked:
                idx = r["index"]
                if idx < len(merged):
                    chunk = merged[idx]
                    chunk.similarity = r["score"]
                    top_results.append(chunk)

            logger.info(
                "Cross-encoder reranked: %d → %d (top=%.4f)",
                len(merged), len(top_results),
                top_results[0].similarity if top_results else 0,
            )
        else:
            top_results = merged[:final_top_k]

        # ── Context window expansion for top results ──
        if expand_top_n > 0 and top_results:
            chunks_to_expand = top_results[:expand_top_n]
            remaining = top_results[expand_top_n:]

            expanded = self._fetch_neighbor_chunks(chunks_to_expand)

            seen = {(c.filename, c.chunk_index) for c in expanded}
            for c in remaining:
                if (c.filename, c.chunk_index) not in seen:
                    expanded.append(c)
                    seen.add((c.filename, c.chunk_index))

            logger.info(
                "Multi-query complete: %d queries → %d unique → %d reranked → %d final",
                len(queries), len(all_results), len(top_results), len(expanded),
            )
            return expanded

        logger.info(
            "Multi-query complete: %d queries → %d unique → %d final",
            len(queries), len(all_results), len(top_results),
        )
        return top_results

    # ══════════════════════════════════════════════════════
    # LEGACY: Backward-compatible search_context method
    # ══════════════════════════════════════════════════════

    def search_context(
        self,
        query_text: str,
        top_k: int = 5,
        similarity_threshold: float = 0.45,
        metadata_filters: Optional[dict] = None,
    ) -> list[ContextChunk]:
        """
        Backward-compatible search method.
        Now uses hybrid search internally.
        """
        return self.search_hybrid(
            query_text,
            top_k=top_k,
            similarity_threshold=similarity_threshold,
            metadata_filters=metadata_filters,
        )

    def search_context_with_rerank(
        self,
        query_text: str,
        final_top_k: int = 8,
        candidate_pool: int = 15,
        similarity_threshold: float = 0.35,
        metadata_filters: Optional[dict] = None,
    ) -> list[ContextChunk]:
        """
        Backward-compatible reranked search.
        Now uses hybrid search + cross-encoder reranking.
        """
        return self.search_with_rerank(
            query_text,
            final_top_k=final_top_k,
            candidate_pool=candidate_pool,
            similarity_threshold=similarity_threshold,
            metadata_filters=metadata_filters,
        )

    # ── Helper: Convert DB row to ContextChunk ─────────

    def _row_to_chunk(self, row) -> ContextChunk:
        """Convert a DictCursor row to a ContextChunk."""
        return ContextChunk(
            content=row["content"],
            filename=row["filename"],
            chunk_index=row["chunk_index"],
            similarity=float(row.get("similarity", 0.0)),
            page_number=row.get("page_number"),
            doc_type=row.get("doc_type"),
            chunk_strategy=row.get("chunk_strategy"),
            section_title=row.get("section_title"),
        )

    # ── Utility methods ────────────────────────────────

    def list_indexed_files(self) -> list[dict]:
        """Return a list of all files currently indexed in the vector database."""
        conn = self._get_conn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
                cur.execute("""
                    SELECT filename,
                           COUNT(*) as chunk_count,
                           MIN(created_at) as indexed_at,
                           MAX(doc_type) as doc_type,
                           MAX(chunk_strategy) as chunk_strategy
                    FROM document_vectors
                    GROUP BY filename
                    ORDER BY filename;
                """)
                return [
                    {
                        "filename": row["filename"],
                        "chunk_count": row["chunk_count"],
                        "indexed_at": row["indexed_at"].isoformat() if row["indexed_at"] else None,
                        "doc_type": row.get("doc_type"),
                        "chunk_strategy": row.get("chunk_strategy"),
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
        """Format retrieved chunks into a string block for LLM prompts."""
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
