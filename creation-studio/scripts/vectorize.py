#!/usr/bin/env python3
"""
vectorize.py — Convert uploaded documents into vector embeddings
and store them in PostgreSQL with pgvector.

Supported formats: PDF, DOCX, XLSX/XLS

Usage:
  python3 vectorize.py --dir ./uploaded_documents
  python3 vectorize.py --dir ./uploaded_documents --files doc1.pdf doc2.docx
"""

import argparse
import os
import sys
import hashlib
from pathlib import Path

# ─── Lazy imports (installed by setup) ─────────────────────
def ensure_imports():
    """Import dependencies; print helpful message if missing."""
    global psycopg2, PyPDF2, Document, openpyxl, SentenceTransformer
    try:
        import psycopg2
        import PyPDF2
        from docx import Document
        import openpyxl
        from sentence_transformers import SentenceTransformer
    except ImportError as e:
        print(f"Missing dependency: {e.name}")
        print("Install with:  pip3 install psycopg2-binary PyPDF2 python-docx openpyxl sentence-transformers")
        sys.exit(1)


# ─── Text extraction ──────────────────────────────────────

def extract_pdf(path: str) -> str:
    reader = PyPDF2.PdfReader(path)
    texts = []
    for page in reader.pages:
        t = page.extract_text()
        if t:
            texts.append(t)
    return "\n".join(texts)


def extract_docx(path: str) -> str:
    doc = Document(path)
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def extract_xlsx(path: str) -> str:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    lines = []
    for sheet in wb.sheetnames:
        ws = wb[sheet]
        lines.append(f"--- Sheet: {sheet} ---")
        for row in ws.iter_rows(values_only=True):
            line = "\t".join(str(c) if c is not None else "" for c in row)
            if line.strip():
                lines.append(line)
    return "\n".join(lines)


EXTRACTORS = {
    ".pdf": extract_pdf,
    ".docx": extract_docx,
    ".doc": extract_docx,  # best-effort via python-docx
    ".xlsx": extract_xlsx,
    ".xls": extract_xlsx,
}


def extract_text(filepath: str) -> str:
    ext = Path(filepath).suffix.lower()
    extractor = EXTRACTORS.get(ext)
    if not extractor:
        print(f"  ⚠ Unsupported format: {ext}")
        return ""
    return extractor(filepath)


# ─── Chunking ─────────────────────────────────────────────

def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """Split text into overlapping chunks of ~chunk_size words."""
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i : i + chunk_size])
        if chunk.strip():
            chunks.append(chunk)
        i += chunk_size - overlap
    return chunks if chunks else [text[:2000]]  # fallback: first 2000 chars


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
    conn.commit()
    print("✓ Database schema ready (pgvector)")


def insert_vectors(conn, filename: str, chunks: list[str], embeddings):
    """Insert chunk vectors, skip duplicates."""
    inserted = 0
    with conn.cursor() as cur:
        for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
            content_hash = hashlib.sha256(chunk.encode()).hexdigest()
            try:
                cur.execute(
                    """INSERT INTO document_vectors (filename, chunk_index, content, content_hash, embedding)
                       VALUES (%s, %s, %s, %s, %s)
                       ON CONFLICT (content_hash) DO NOTHING""",
                    (filename, i, chunk, content_hash, emb.tolist()),
                )
                if cur.rowcount > 0:
                    inserted += 1
            except Exception as e:
                print(f"  ⚠ Chunk {i} insert error: {e}")
                conn.rollback()
    conn.commit()
    return inserted


# ─── Main ─────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Vectorize documents into PostgreSQL")
    parser.add_argument("--dir", required=True, help="Directory containing documents")
    parser.add_argument("--files", nargs="*", help="Specific files to vectorize (optional)")
    args = parser.parse_args()

    ensure_imports()

    doc_dir = Path(args.dir)
    if not doc_dir.exists():
        print(f"Error: Directory not found: {doc_dir}")
        sys.exit(1)

    # Determine which files to process
    if args.files:
        file_paths = [doc_dir / f for f in args.files if (doc_dir / f).exists()]
    else:
        file_paths = [
            p for p in doc_dir.iterdir()
            if p.suffix.lower() in EXTRACTORS and p.is_file()
        ]

    if not file_paths:
        print("No documents found to vectorize.")
        return

    print(f"\n📄 Found {len(file_paths)} document(s) to vectorize")

    # Load embedding model
    print("🔄 Loading embedding model (all-MiniLM-L6-v2)...")
    model = SentenceTransformer("all-MiniLM-L6-v2")

    # Database connection
    print("🔌 Connecting to PostgreSQL...")
    conn = get_connection()
    setup_database(conn)

    total_chunks = 0
    total_inserted = 0

    for fp in file_paths:
        print(f"\n── Processing: {fp.name}")

        # Extract text
        text = extract_text(str(fp))
        if not text.strip():
            print("  ⚠ No text extracted, skipping.")
            continue

        # Chunk
        chunks = chunk_text(text)
        print(f"  📝 {len(chunks)} chunk(s)")

        # Embed
        embeddings = model.encode(chunks, show_progress_bar=False)
        print(f"  🧠 Embedded ({EMBEDDING_DIM}-dim vectors)")

        # Store
        inserted = insert_vectors(conn, fp.name, chunks, embeddings)
        print(f"  💾 {inserted} new vector(s) stored")

        total_chunks += len(chunks)
        total_inserted += inserted

    conn.close()
    print(f"\n✅ Done! {total_inserted}/{total_chunks} chunks vectorized and stored.\n")


if __name__ == "__main__":
    main()
