#!/usr/bin/env python3
"""
vectorize.py — Convert uploaded documents into hybrid vector embeddings
and store them in PostgreSQL with pgvector.

Uses BAAI/bge-m3 for BOTH dense (1024-dim) and sparse (BM25) vectors.
Uses the three-strategy chunking engine for intelligent document chunking.
Each chunk carries rich metadata for filtered retrieval.

Embedding Pipeline:
  Document → Chunk (3-strategy) → bge-m3 → Dense + Sparse → PostgreSQL

Usage:
  python3 vectorize.py --dir ./uploaded_documents
  python3 vectorize.py --dir ./uploaded_documents --files doc1.pdf doc2.docx
  python3 vectorize.py --dir ./uploaded_documents --clear
"""

import argparse
import json
import os
import sys
import hashlib
import logging
import time
from pathlib import Path

logger = logging.getLogger("vectorize")


def emit(event_type: str, **kwargs):
    """Emit a JSON progress event to stdout for the Node.js server to parse."""
    payload = {"event": event_type, **kwargs}
    print(json.dumps(payload), flush=True)


# ─── Lazy imports ─────────────────────────────────────────

def ensure_imports():
    """Import heavy dependencies; print helpful message if missing."""
    global psycopg2, HybridEmbeddingEngine, chunk_document, classify_document

    try:
        import psycopg2 as _psycopg2
        psycopg2 = _psycopg2
    except ImportError:
        emit("error", message="Missing dependency: psycopg2-binary")
        sys.exit(1)

    # Hybrid embedding engine (bge-m3 dense + sparse)
    try:
        # Add backend dir to path for embedding_engine import
        backend_dir = str(Path(__file__).resolve().parent.parent / "backend")
        if backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)
        from embedding_engine import HybridEmbeddingEngine as _HE
        HybridEmbeddingEngine = _HE
    except ImportError as e:
        emit("error", message=f"Missing dependency: embedding_engine ({e})")
        sys.exit(1)

    # Three-strategy chunking engine (handles all formats including PDF via PyMuPDF)
    try:
        from chunking_engine import chunk_document as _cd, classify_document as _cls
        chunk_document = _cd
        classify_document = _cls
    except ImportError:
        emit("error", message="Missing dependency: chunking_engine")
        sys.exit(1)


# ─── Supported extensions (union of all strategies) ───────

SUPPORTED_EXTENSIONS = {
    # Entity-level (structured)
    ".json", ".md",
    ".xlsx", ".xls", ".csv",
    # Character window (unstructured)
    ".txt", ".log", ".cfg", ".ini", ".conf", ".env", ".yaml", ".yml", ".toml",
    # Semantic context (technical)
    ".pdf", ".docx", ".doc", ".pptx", ".ppt",
    ".html", ".htm", ".xhtml",
    ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp",
}

def is_file_supported(filepath: str) -> bool:
    """Check if a file extension is supported by any strategy."""
    return Path(filepath).suffix.lower() in SUPPORTED_EXTENSIONS


# ─── Database ─────────────────────────────────────────────

DB_CONFIG = {
    "dbname": "vectordb",
    "user": os.environ.get("PGUSER", os.environ.get("USER", "postgres")),
    "password": os.environ.get("PGPASSWORD", ""),
    "host": os.environ.get("PGHOST", "localhost"),
    "port": os.environ.get("PGPORT", "5432"),
}

EMBEDDING_DIM = 1024  # BAAI/bge-m3


def get_connection():
    return psycopg2.connect(**DB_CONFIG)


def setup_database(conn):
    """Create pgvector extension and document_vectors table."""
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS document_vectors (
                id SERIAL PRIMARY KEY,
                filename TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                content_hash TEXT NOT NULL UNIQUE,
                embedding vector({EMBEDDING_DIM}),
                sparse_vector JSONB DEFAULT '{{}}'::jsonb,
                created_at TIMESTAMP DEFAULT NOW(),
                page_number INTEGER DEFAULT NULL,
                doc_type TEXT DEFAULT NULL,
                chunk_strategy TEXT DEFAULT NULL,
                file_type TEXT DEFAULT NULL,
                section_title TEXT DEFAULT NULL,
                headings JSONB DEFAULT '[]'::jsonb,
                metadata JSONB DEFAULT '{{}}'::jsonb
            );
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_doc_vectors_filename ON document_vectors(filename);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_doc_type ON document_vectors(doc_type);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_chunk_strategy ON document_vectors(chunk_strategy);")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_file_type ON document_vectors(file_type);")

        # Add sparse_vector column if it doesn't exist (migration)
        cur.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'document_vectors'
                    AND column_name = 'sparse_vector'
                ) THEN
                    ALTER TABLE document_vectors
                    ADD COLUMN sparse_vector JSONB DEFAULT '{}'::jsonb;
                END IF;
            END
            $$;
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_sparse_gin ON document_vectors USING GIN (sparse_vector);")

    conn.commit()
    emit("log", message=f"Database schema ready (pgvector {EMBEDDING_DIM}-dim + sparse + metadata)")


def clear_file_vectors(conn, filename: str):
    """Remove all existing vectors for a specific file."""
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM document_vectors WHERE filename = %s",
            (filename,),
        )
        deleted = cur.rowcount
    conn.commit()
    if deleted > 0:
        emit("log", message=f"Cleared {deleted} old vector(s) for {filename}")
    return deleted


def insert_vectors(
    conn,
    filename: str,
    chunks: list[dict],
    dense_embeddings,
    sparse_vectors: list[dict],
):
    """Insert chunk vectors (dense + sparse) with metadata into PostgreSQL."""
    inserted = 0
    with conn.cursor() as cur:
        for i, (chunk, dense, sparse) in enumerate(
            zip(chunks, dense_embeddings, sparse_vectors)
        ):
            content = chunk["text"]
            page_number = chunk.get("page_number", None)
            metadata = chunk.get("metadata", {})
            content_hash = hashlib.sha256(content.encode()).hexdigest()

            # Extract metadata fields
            doc_type = metadata.get("doc_type", None)
            chunk_strategy = metadata.get("chunk_strategy", None)
            file_type = metadata.get("file_type", None)
            section_title = metadata.get("section_title", None)
            headings = json.dumps(metadata.get("headings", []))
            metadata_json = json.dumps(metadata)
            sparse_json = json.dumps(sparse)

            try:
                cur.execute(
                    """INSERT INTO document_vectors
                       (filename, chunk_index, content, content_hash, embedding,
                        sparse_vector, page_number, doc_type, chunk_strategy,
                        file_type, section_title, headings, metadata)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (content_hash) DO NOTHING""",
                    (filename, i, content, content_hash,
                     dense.tolist(), sparse_json,
                     page_number, doc_type, chunk_strategy, file_type,
                     section_title, headings, metadata_json),
                )
                if cur.rowcount > 0:
                    inserted += 1
            except Exception as e:
                emit("log", message=f"Chunk {i} insert error: {e}")
                conn.rollback()
    conn.commit()
    return inserted


# ─── Main ─────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Vectorize documents with BAAI/bge-m3 hybrid embeddings"
    )
    parser.add_argument("--dir", required=True, help="Directory containing documents")
    parser.add_argument("--files", nargs="*", help="Specific files to vectorize")
    parser.add_argument(
        "--clear", action="store_true",
        help="Clear old vectors for each file before re-indexing"
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.WARNING,
        format="%(asctime)s │ %(name)-15s │ %(levelname)-5s │ %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )

    ensure_imports()

    doc_dir = Path(args.dir)
    if not doc_dir.exists():
        emit("error", message=f"Directory not found: {doc_dir}")
        sys.exit(1)

    # Determine files to process
    if args.files:
        file_paths = [doc_dir / f for f in args.files if (doc_dir / f).exists()]
    else:
        file_paths = [
            p for p in sorted(doc_dir.rglob("*"))
            if p.is_file() and is_file_supported(str(p)) and not p.name.startswith(".")
        ]

    if not file_paths:
        emit("done", total=0, processed=0, message="No supported documents found")
        return

    emit("init", total=len(file_paths), message=f"Found {len(file_paths)} document(s)")

    # Load BAAI/bge-m3 hybrid embedding engine
    emit("log", message="Loading BAAI/bge-m3 hybrid embedding engine...")
    t0 = time.time()
    engine = HybridEmbeddingEngine()
    # Trigger lazy load by encoding a test string
    _ = engine.encode(["test"])
    emit("log", message=f"Embedding engine loaded in {time.time() - t0:.1f}s "
         f"({engine.DENSE_DIM}-dim dense, native sparse)")

    # Database connection
    emit("log", message="Connecting to PostgreSQL...")
    conn = get_connection()
    setup_database(conn)

    total_chunks = 0
    total_inserted = 0
    strategy_counts = {}

    for idx, fp in enumerate(file_paths):
        file_start = time.time()
        emit("file_start", index=idx, total=len(file_paths), file=fp.name)

        if args.clear:
            clear_file_vectors(conn, fp.name)

        # ── Step 1: Classify + Chunk ──
        classification = classify_document(str(fp))
        strategy = classification["chunk_strategy"]
        emit("log", message=f"Strategy: {strategy} (doc_type={classification['doc_type']})")

        try:
            chunks = chunk_document(str(fp))
        except Exception as e:
            emit("file_error", index=idx, file=fp.name, error=str(e))
            continue

        if not chunks:
            emit("file_error", index=idx, file=fp.name, error="No content extracted")
            continue

        strategy_counts[strategy] = strategy_counts.get(strategy, 0) + len(chunks)

        # ── Step 2: Generate hybrid embeddings (dense + sparse) ──
        chunk_texts = [c["text"] for c in chunks]
        emit("log", message=f"Encoding {len(chunk_texts)} chunks with bge-m3...")

        encode_result = engine.encode(chunk_texts, show_progress=True)
        dense_embeddings = encode_result["dense"]
        sparse_vectors = encode_result["sparse"]

        # ── Step 3: Store in PostgreSQL ──
        inserted = insert_vectors(conn, fp.name, chunks, dense_embeddings, sparse_vectors)

        elapsed = time.time() - file_start
        emit("file_done", index=idx, file=fp.name,
             chunks=len(chunks), inserted=inserted,
             strategy=strategy, elapsed=round(elapsed, 1))

        total_chunks += len(chunks)
        total_inserted += inserted

    conn.close()
    emit("done", total=len(file_paths), processed=total_inserted,
         chunks=total_chunks,
         strategies=strategy_counts,
         engine_status=engine.get_status(),
         message="Vectorization complete (bge-m3 hybrid: dense + sparse)")


if __name__ == "__main__":
    main()
