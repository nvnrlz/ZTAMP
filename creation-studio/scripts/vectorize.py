#!/usr/bin/env python3
"""
vectorize.py — Convert uploaded documents into vector embeddings
and store them in PostgreSQL with pgvector.

Uses a hybrid processing pipeline:
- Lightweight native Python for simple formats (XLSX, CSV, DOCX, MD)
- Docling (IBM DS4SD) for complex formats (PDF, images, PPTX, HTML)

Outputs JSON progress events to stdout for real-time tracking.

Usage:
  python3 vectorize.py --dir ./uploaded_documents
  python3 vectorize.py --dir ./uploaded_documents --files doc1.pdf doc2.docx
  python3 vectorize.py --dir ./uploaded_documents --clear  # clear old vectors first
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
    global psycopg2, SentenceTransformer, process_file, is_supported
    try:
        import psycopg2 as _psycopg2
        psycopg2 = _psycopg2
    except ImportError:
        emit("error", message="Missing dependency: psycopg2-binary")
        sys.exit(1)

    try:
        from sentence_transformers import SentenceTransformer as _ST
        SentenceTransformer = _ST
    except ImportError:
        emit("error", message="Missing dependency: sentence-transformers")
        sys.exit(1)

    try:
        from docling_processor import process_file as _pf, is_supported as _is
        process_file = _pf
        is_supported = _is
    except ImportError:
        emit("error", message="Missing dependency: docling_processor")
        sys.exit(1)


# ─── Database ─────────────────────────────────────────────

DB_CONFIG = {
    "dbname": "vectordb",
    "user": os.environ.get("PGUSER", os.environ.get("USER", "postgres")),
    "password": os.environ.get("PGPASSWORD", ""),
    "host": os.environ.get("PGHOST", "localhost"),
    "port": os.environ.get("PGPORT", "5432"),
}

EMBEDDING_DIM = 384  # all-MiniLM-L6-v2


def get_connection():
    return psycopg2.connect(**DB_CONFIG)


def setup_database(conn):
    """Create pgvector extension and documents table if not exists."""
    with conn.cursor() as cur:
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS document_vectors (
                id SERIAL PRIMARY KEY,
                filename TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                embedding vector({EMBEDDING_DIM}),
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(content_hash)
            );
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_doc_vectors_filename
            ON document_vectors(filename);
        """)
        # ── Add page_number column if it doesn't exist ──
        cur.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'document_vectors'
                    AND column_name = 'page_number'
                ) THEN
                    ALTER TABLE document_vectors
                    ADD COLUMN page_number INTEGER DEFAULT NULL;
                END IF;
            END
            $$;
        """)
    conn.commit()
    emit("log", message="Database schema ready (pgvector)")


def clear_file_vectors(conn, filename: str):
    """Remove all existing vectors for a specific file (for re-indexing)."""
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
    embeddings,
):
    """Insert chunk vectors into PostgreSQL. Skips duplicates."""
    inserted = 0
    with conn.cursor() as cur:
        for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
            content = chunk["text"]
            page_number = chunk.get("page_number", None)
            content_hash = hashlib.sha256(content.encode()).hexdigest()
            try:
                cur.execute(
                    """INSERT INTO document_vectors
                       (filename, chunk_index, content, content_hash, embedding, page_number)
                       VALUES (%s, %s, %s, %s, %s, %s)
                       ON CONFLICT (content_hash) DO NOTHING""",
                    (filename, i, content, content_hash, emb.tolist(), page_number),
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
        description="Vectorize documents into PostgreSQL using Docling"
    )
    parser.add_argument("--dir", required=True, help="Directory containing documents")
    parser.add_argument("--files", nargs="*", help="Specific files to vectorize (optional)")
    parser.add_argument(
        "--clear", action="store_true",
        help="Clear old vectors for each file before re-indexing"
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.WARNING,  # Suppress verbose logging to keep stdout clean for JSON
        format="%(asctime)s │ %(name)-15s │ %(levelname)-5s │ %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,  # Logs to stderr, JSON events to stdout
    )

    ensure_imports()

    doc_dir = Path(args.dir)
    if not doc_dir.exists():
        emit("error", message=f"Directory not found: {doc_dir}")
        sys.exit(1)

    # Determine which files to process
    if args.files:
        file_paths = [doc_dir / f for f in args.files if (doc_dir / f).exists()]
    else:
        file_paths = [
            p for p in sorted(doc_dir.iterdir())
            if p.is_file() and is_supported(str(p))
        ]

    if not file_paths:
        emit("done", total=0, processed=0, message="No supported documents found")
        return

    emit("init", total=len(file_paths), message=f"Found {len(file_paths)} document(s)")

    # Load embedding model (this is the slow part — ~10-30s on first run)
    emit("log", message="Loading embedding model (all-MiniLM-L6-v2)...")
    t0 = time.time()
    model = SentenceTransformer("all-MiniLM-L6-v2")
    emit("log", message=f"Model loaded in {time.time() - t0:.1f}s")

    # Database connection
    emit("log", message="Connecting to PostgreSQL...")
    conn = get_connection()
    setup_database(conn)

    total_chunks = 0
    total_inserted = 0

    for idx, fp in enumerate(file_paths):
        file_start = time.time()
        emit("file_start", index=idx, total=len(file_paths), file=fp.name)

        # Optionally clear old vectors
        if args.clear:
            clear_file_vectors(conn, fp.name)

        # ── Step 1: Extract + chunk (lightweight or Docling) ──
        try:
            chunks = process_file(str(fp))
        except Exception as e:
            emit("file_error", index=idx, file=fp.name, error=str(e))
            continue

        if not chunks:
            emit("file_error", index=idx, file=fp.name, error="No content extracted")
            continue

        # ── Step 2: Generate embeddings ──
        chunk_texts = [c["text"] for c in chunks]
        embeddings = model.encode(chunk_texts, show_progress_bar=False)

        # ── Step 3: Store in PostgreSQL ──
        inserted = insert_vectors(conn, fp.name, chunks, embeddings)

        elapsed = time.time() - file_start
        emit("file_done", index=idx, file=fp.name,
             chunks=len(chunks), inserted=inserted, elapsed=round(elapsed, 1))

        total_chunks += len(chunks)
        total_inserted += inserted

    conn.close()
    emit("done", total=len(file_paths), processed=total_inserted,
         chunks=total_chunks, message="Vectorization complete")


if __name__ == "__main__":
    main()
