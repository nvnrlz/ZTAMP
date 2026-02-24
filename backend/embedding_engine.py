"""
embedding_engine.py — Hybrid Embedding Engine (BAAI/bge-m3 + Cross-Encoder Reranker)

Architecture:
┌─────────────────────────────────────────────────────────────────┐
│                    BAAI/bge-m3 (M3-Embedding)                   │
│  Multi-lingual · Multi-granularity · Multi-representation       │
│                                                                 │
│  Input: "What are VPC peering limitations?"                     │
│                    │                                            │
│            ┌──────┴──────┐                                      │
│            ▼              ▼                                      │
│     Dense Vector    Sparse Vector (Lexical Weights)             │
│     (1024-dim)      {"vpc": 0.83, "peering": 0.91, ...}        │
│                                                                 │
│  Both generated in a SINGLE forward pass — no extra cost.       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                Cross-Encoder Reranker                           │
│             BAAI/bge-reranker-v2-m3                             │
│                                                                 │
│  Takes (query, document) PAIR → scores them jointly.            │
│  Far more accurate than independent embedding comparison.       │
│  Used AFTER hybrid retrieval to guarantee #1 result is correct. │
└─────────────────────────────────────────────────────────────────┘

Search Pipeline:
  1. Dense search (pgvector cosine) → top-20 candidates
  2. Sparse search (BM25/keyword) → top-20 candidates
  3. RRF merge (Reciprocal Rank Fusion) → combined top-15
  4. Cross-encoder rerank → final top-K with guaranteed accuracy
"""

import json
import logging
import numpy as np

logger = logging.getLogger("embedding_engine")


class HybridEmbeddingEngine:
    """
    Hybrid embedding + reranking engine using BAAI/bge-m3.

    Generates BOTH dense and sparse vectors in a single forward pass.
    Uses cross-encoder reranking for final precision.

    Dense vectors: 1024-dim (semantic understanding)
    Sparse vectors: BM25-like lexical weights (exact keyword matching)
    """

    # Model names
    EMBEDDING_MODEL = "BAAI/bge-m3"
    RERANKER_MODEL = "BAAI/bge-reranker-v2-m3"

    # Dense vector dimension (bge-m3 fixed output)
    DENSE_DIM = 1024

    def __init__(
        self,
        embedding_model: str = None,
        reranker_model: str = None,
    ):
        self._embedding_model_name = embedding_model or self.EMBEDDING_MODEL
        self._reranker_model_name = reranker_model or self.RERANKER_MODEL

        self._embedder = None
        self._reranker = None

        logger.info(
            "HybridEmbeddingEngine configured (model=%s, reranker=%s)",
            self._embedding_model_name, self._reranker_model_name,
        )

    # ── Lazy loading ──────────────────────────────────────

    @property
    def embedder(self):
        """Load embedding model on first use."""
        if self._embedder is None:
            self._load_embedder()
        return self._embedder

    def _load_embedder(self):
        """Load bge-m3 via FlagEmbedding for native dense + sparse vectors."""
        from FlagEmbedding import BGEM3FlagModel

        logger.info("Loading %s via FlagEmbedding (dense + sparse)...",
                     self._embedding_model_name)
        self._embedder = BGEM3FlagModel(
            self._embedding_model_name,
            use_fp16=False,  # MPS doesn't support fp16 well
        )
        logger.info(
            "✓ %s loaded (%d-dim dense + native sparse)",
            self._embedding_model_name, self.DENSE_DIM,
        )

    @property
    def reranker(self):
        """Load cross-encoder reranker on first use."""
        if self._reranker is None:
            self._load_reranker()
        return self._reranker

    def _load_reranker(self):
        """Load the cross-encoder reranker."""
        try:
            from sentence_transformers import CrossEncoder
            logger.info("Loading cross-encoder reranker: %s ...", self._reranker_model_name)
            self._reranker = CrossEncoder(self._reranker_model_name)
            logger.info("✓ Reranker loaded: %s", self._reranker_model_name)
        except Exception as e:
            logger.warning("Reranker load failed (%s) — reranking disabled", e)
            self._reranker = "DISABLED"  # Sentinel to avoid retrying

    # ── Encoding (Dense + Sparse) ─────────────────────────

    def encode(
        self,
        texts: list[str],
        batch_size: int = 12,
        show_progress: bool = False,
    ) -> dict:
        """
        Encode texts into BOTH dense and sparse vectors via bge-m3.

        Both representations are generated in a single forward pass.

        Returns:
            {
                "dense": numpy array (n, 1024),
                "sparse": list of dicts [{token: weight}, ...]
            }
        """
        if not texts:
            return {"dense": np.array([]), "sparse": []}

        embedder = self.embedder  # Trigger lazy load
        logger.info("Encoding %d text(s) with %s...", len(texts), self._embedding_model_name)

        output = embedder.encode(
            texts,
            batch_size=batch_size,
            return_dense=True,
            return_sparse=True,
            return_colbert_vecs=False,
        )

        dense = output["dense_vecs"]
        sparse_list = self._convert_bge_sparse(output["lexical_weights"])

        logger.info(
            "✓ Encoded %d texts: %d-dim dense + native sparse vectors",
            len(texts), self.DENSE_DIM,
        )

        return {"dense": dense, "sparse": sparse_list}

    def encode_single(self, text: str) -> dict:
        """Encode a single text. Returns {"dense": array, "sparse": dict}."""
        result = self.encode([text])
        return {
            "dense": result["dense"][0] if len(result["dense"]) > 0 else None,
            "sparse": result["sparse"][0] if result["sparse"] else {},
        }

    def encode_query(self, query: str) -> dict:
        """Encode a search query. Same as encode_single for bge-m3."""
        return self.encode_single(query)

    # ── Sparse vector helpers ─────────────────────────────

    def _convert_bge_sparse(self, lexical_weights: list) -> list[dict]:
        """
        Convert bge-m3's lexical_weights to token-based sparse vectors.

        bge-m3 returns {token_id: weight} — we convert to {token_string: weight}
        using the tokenizer for human-readable BM25-like storage.
        """
        sparse_list = []
        tokenizer = self._embedder.tokenizer

        for weights in lexical_weights:
            token_weights = {}
            if isinstance(weights, dict):
                for token_id, weight in weights.items():
                    token_id = int(token_id)
                    token = tokenizer.decode([token_id]).strip()
                    if token and len(token) > 1 and weight > 0.01:
                        token_weights[token.lower()] = round(float(weight), 4)
            sparse_list.append(token_weights)

        return sparse_list

    # ── Reranking ─────────────────────────────────────────

    def rerank(
        self,
        query: str,
        documents: list[str],
        top_k: int = 5,
    ) -> list[dict]:
        """
        Rerank documents using the BAAI/bge-reranker-v2-m3 cross-encoder.

        The cross-encoder scores (query, document) pairs JOINTLY,
        which is far more accurate than comparing embeddings independently.

        Args:
            query: The search query
            documents: Candidate document texts to rerank
            top_k: Number of top results to return

        Returns:
            List of {"index": int, "score": float, "text": str}
            sorted by descending score.
        """
        if not documents:
            return []

        reranker = self.reranker
        if reranker == "DISABLED" or reranker is None:
            logger.warning("Reranker not available — returning original order")
            return [
                {"index": i, "score": 1.0 - i * 0.01, "text": doc}
                for i, doc in enumerate(documents[:top_k])
            ]

        pairs = [(query, doc) for doc in documents]

        logger.info("Cross-encoder reranking %d candidates...", len(documents))
        scores = reranker.predict(pairs)

        if not hasattr(scores, '__len__'):
            scores = [scores]

        results = [
            {"index": i, "score": float(s), "text": documents[i]}
            for i, s in enumerate(scores)
        ]
        results.sort(key=lambda x: x["score"], reverse=True)

        logger.info(
            "✓ Reranked: top=%.4f, #2=%.4f, bottom=%.4f",
            results[0]["score"] if results else 0,
            results[1]["score"] if len(results) > 1 else 0,
            results[-1]["score"] if results else 0,
        )

        return results[:top_k]

    # ── Reciprocal Rank Fusion ────────────────────────────

    @staticmethod
    def reciprocal_rank_fusion(
        ranked_lists: list[list[tuple]],
        k: int = 60,
    ) -> list[tuple]:
        """
        Merge multiple ranked lists using Reciprocal Rank Fusion (RRF).

        RRF score = Σ 1/(k + rank_i) for each list where the item appears.
        k=60 is the standard constant (from the original RRF paper).

        Args:
            ranked_lists: List of ranked lists, each containing (id, score) tuples
            k: RRF constant (default 60)

        Returns:
            Merged list of (id, rrf_score) sorted by descending RRF score
        """
        rrf_scores = {}
        for ranked_list in ranked_lists:
            for rank, (item_id, _score) in enumerate(ranked_list):
                if item_id not in rrf_scores:
                    rrf_scores[item_id] = 0.0
                rrf_scores[item_id] += 1.0 / (k + rank + 1)

        merged = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
        return merged

    # ── Sparse similarity ─────────────────────────────────

    @staticmethod
    def compute_sparse_similarity(sparse_a: dict, sparse_b: dict) -> float:
        """Dot product of shared token weights (BM25-like scoring)."""
        if not sparse_a or not sparse_b:
            return 0.0
        score = 0.0
        for token, weight_a in sparse_a.items():
            if token in sparse_b:
                score += weight_a * sparse_b[token]
        return score

    @staticmethod
    def sparse_to_json(sparse_vec: dict) -> str:
        """Serialize sparse vector to JSON for PostgreSQL JSONB."""
        return json.dumps(sparse_vec)

    @staticmethod
    def json_to_sparse(json_str) -> dict:
        """Deserialize sparse vector from PostgreSQL JSONB."""
        if isinstance(json_str, dict):
            return json_str
        if isinstance(json_str, str):
            return json.loads(json_str)
        return {}

    # ── Status ────────────────────────────────────────────

    def get_status(self) -> dict:
        """Get current engine status."""
        return {
            "embedding_model": self._embedding_model_name,
            "reranker_model": self._reranker_model_name,
            "dense_dim": self.DENSE_DIM,
            "native_sparse": True,
            "loaded": self._embedder is not None,
            "reranker_loaded": self._reranker is not None and self._reranker != "DISABLED",
        }
