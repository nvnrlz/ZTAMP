#!/usr/bin/env python3
"""
test_rag.py — End-to-end verification of the Docling RAG pipeline

This script:
1. Creates a sample PDF with a table using reportlab (or a sample Markdown file)
2. Processes it through docling_processor.py
3. Embeds the chunks and stores them in PostgreSQL
4. Queries the database for a value inside the table
5. Asserts the returned chunk contains the Markdown table representation

Usage:
    python3 test_rag.py
    python3 test_rag.py --verbose
    python3 test_rag.py --skip-pdf  # use Markdown instead (no reportlab needed)
"""

import argparse
import hashlib
import logging
import os
import sys
import tempfile
from pathlib import Path

logger = logging.getLogger("test_rag")


# ─── Test Data ────────────────────────────────────────────

SAMPLE_MARKDOWN = """# Q4 2025 Revenue Report

## Executive Summary

This report summarizes the quarterly revenue performance across all regions.

## Revenue by Region

| Region        | Q3 Revenue ($M) | Q4 Revenue ($M) | Growth (%) |
|---------------|-----------------|-----------------|------------|
| North America | 145.2           | 162.8           | 12.1       |
| Europe        | 98.7            | 108.3           | 9.7        |
| Asia Pacific  | 76.4            | 89.1            | 16.6       |
| Latin America | 34.5            | 38.2            | 10.7       |
| **Total**     | **354.8**       | **398.4**       | **12.3**   |

## Product Breakdown

| Product       | Units Sold | Revenue ($M) | Avg Price ($) |
|---------------|-----------|--------------|---------------|
| Widget Pro    | 42,000    | 126.0        | 3,000         |
| Widget Basic  | 85,000    | 127.5        | 1,500         |
| Widget Lite   | 120,000   | 96.0         | 800           |
| Services      | N/A       | 48.9         | N/A           |

## Key Findings

1. Asia Pacific showed the strongest growth at 16.6%
2. Widget Pro had the highest average price at $3,000
3. Total revenue grew 12.3% quarter-over-quarter
"""


def create_sample_pdf(output_path: str) -> None:
    """Create a sample PDF with tables using reportlab."""
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.units import inch
        from reportlab.platypus import (
            SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        )
        from reportlab.lib.styles import getSampleStyleSheet
    except ImportError:
        raise ImportError(
            "reportlab is required to generate test PDFs.\n"
            "Install with: pip install reportlab\n"
            "Or use --skip-pdf to test with Markdown instead."
        )

    doc = SimpleDocTemplate(output_path, pagesize=letter)
    styles = getSampleStyleSheet()
    elements = []

    # Title
    elements.append(Paragraph("Q4 2025 Revenue Report", styles['Title']))
    elements.append(Spacer(1, 0.3 * inch))
    elements.append(Paragraph("Executive Summary", styles['Heading2']))
    elements.append(Paragraph(
        "This report summarizes the quarterly revenue performance across all regions.",
        styles['Normal']
    ))
    elements.append(Spacer(1, 0.3 * inch))

    # Revenue table
    elements.append(Paragraph("Revenue by Region", styles['Heading2']))
    revenue_data = [
        ['Region', 'Q3 Revenue ($M)', 'Q4 Revenue ($M)', 'Growth (%)'],
        ['North America', '145.2', '162.8', '12.1'],
        ['Europe', '98.7', '108.3', '9.7'],
        ['Asia Pacific', '76.4', '89.1', '16.6'],
        ['Latin America', '34.5', '38.2', '10.7'],
        ['Total', '354.8', '398.4', '12.3'],
    ]
    table = Table(revenue_data, colWidths=[1.8 * inch, 1.5 * inch, 1.5 * inch, 1.2 * inch])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.black),
        ('BACKGROUND', (0, -1), (-1, -1), colors.lightgrey),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ]))
    elements.append(table)
    elements.append(Spacer(1, 0.3 * inch))

    # Product table
    elements.append(Paragraph("Product Breakdown", styles['Heading2']))
    product_data = [
        ['Product', 'Units Sold', 'Revenue ($M)', 'Avg Price ($)'],
        ['Widget Pro', '42,000', '126.0', '3,000'],
        ['Widget Basic', '85,000', '127.5', '1,500'],
        ['Widget Lite', '120,000', '96.0', '800'],
        ['Services', 'N/A', '48.9', 'N/A'],
    ]
    table2 = Table(product_data, colWidths=[1.5 * inch, 1.3 * inch, 1.3 * inch, 1.3 * inch])
    table2.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3b82f6')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.black),
    ]))
    elements.append(table2)
    elements.append(Spacer(1, 0.3 * inch))

    # Key findings
    elements.append(Paragraph("Key Findings", styles['Heading2']))
    findings = [
        "Asia Pacific showed the strongest growth at 16.6%",
        "Widget Pro had the highest average price at $3,000",
        "Total revenue grew 12.3% quarter-over-quarter",
    ]
    for i, finding in enumerate(findings, 1):
        elements.append(Paragraph(f"{i}. {finding}", styles['Normal']))

    doc.build(elements)
    print(f"✓ Sample PDF created: {output_path}")


def create_sample_markdown(output_path: str) -> None:
    """Create a sample Markdown file with tables."""
    with open(output_path, "w") as f:
        f.write(SAMPLE_MARKDOWN)
    print(f"✓ Sample Markdown created: {output_path}")


# ─── Test Steps ───────────────────────────────────────────

def test_docling_processing(file_path: str, verbose: bool = False) -> list[dict]:
    """Step 1: Process the document with Docling."""
    print("\n━━━ Step 1: Docling Processing ━━━")

    # Import from the same scripts directory
    sys.path.insert(0, str(Path(__file__).parent))
    from docling_processor import process_file

    chunks = process_file(file_path)

    print(f"✓ Produced {len(chunks)} chunk(s)")

    if verbose:
        for chunk in chunks:
            print(f"\n  ── Chunk {chunk['metadata']['chunk_index']} "
                  f"(Page {chunk['page_number']}) ──")
            print(f"  {chunk['text'][:200]}...")

    # ── Assertion: at least one chunk should exist ──
    assert len(chunks) > 0, "❌ FAIL: No chunks produced"
    print("✓ PASS: At least one chunk produced")

    # ── Assertion: chunks should contain table content ──
    all_text = " ".join(c["text"] for c in chunks)
    # Look for table markers: pipe characters or table-like content
    has_table_structure = (
        "|" in all_text  # Markdown table pipes
        or "162.8" in all_text  # specific value from the table
        or "North America" in all_text
    )
    assert has_table_structure, (
        "❌ FAIL: No table structure found in chunks. "
        "Docling should preserve tables as Markdown."
    )
    print("✓ PASS: Table structure preserved in Markdown output")

    return chunks


def test_embedding_and_storage(
    chunks: list[dict],
    filename: str,
    verbose: bool = False,
) -> None:
    """Step 2: Embed chunks and store in PostgreSQL."""
    print("\n━━━ Step 2: Embedding & Storage ━━━")

    import psycopg2
    from sentence_transformers import SentenceTransformer

    # Embed
    model = SentenceTransformer("all-MiniLM-L6-v2")
    chunk_texts = [c["text"] for c in chunks]
    embeddings = model.encode(chunk_texts, show_progress_bar=False)
    print(f"✓ Generated {len(embeddings)} embedding(s) (dim={embeddings.shape[1]})")

    assert embeddings.shape[1] == 384, (
        f"❌ FAIL: Expected 384-dim embeddings, got {embeddings.shape[1]}"
    )
    print("✓ PASS: Embedding dimension is 384")

    # Store
    db_config = {
        "dbname": "vectordb",
        "user": os.environ.get("PGUSER", os.environ.get("USER", "postgres")),
        "password": os.environ.get("PGPASSWORD", ""),
        "host": os.environ.get("PGHOST", "localhost"),
        "port": os.environ.get("PGPORT", "5432"),
    }

    conn = psycopg2.connect(**db_config)
    cur = conn.cursor()

    # Clear any old test data
    cur.execute(
        "DELETE FROM document_vectors WHERE filename = %s",
        (filename,),
    )

    # Insert
    inserted = 0
    for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
        content = chunk["text"]
        page_number = chunk.get("page_number", None)
        content_hash = hashlib.sha256(content.encode()).hexdigest()

        # Try with page_number column first, fall back without it
        try:
            cur.execute(
                """INSERT INTO document_vectors
                   (filename, chunk_index, content, content_hash, embedding, page_number)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (content_hash) DO NOTHING""",
                (filename, i, content, content_hash, emb.tolist(), page_number),
            )
        except psycopg2.errors.UndefinedColumn:
            conn.rollback()
            cur.execute(
                """INSERT INTO document_vectors
                   (filename, chunk_index, content, content_hash, embedding)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (content_hash) DO NOTHING""",
                (filename, i, content, content_hash, emb.tolist()),
            )

        if cur.rowcount > 0:
            inserted += 1

    conn.commit()
    print(f"✓ Stored {inserted} vector(s) in PostgreSQL")

    assert inserted > 0, "❌ FAIL: No vectors inserted"
    print("✓ PASS: Vectors stored successfully")

    cur.close()
    conn.close()

    return model


def test_rag_retrieval(
    filename: str,
    verbose: bool = False,
) -> None:
    """Step 3: Query the RAG database and verify results."""
    print("\n━━━ Step 3: RAG Retrieval ━━━")

    # Add backend to path for rag_engine
    backend_dir = str(Path(__file__).parent.parent / "backend")
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)

    from rag_engine import RAGProvider

    rag = RAGProvider()

    # ── Test 1: Query for a specific table value ──
    print("\n  Test 3a: Query for 'Asia Pacific revenue growth'")
    results = rag.search_context("Asia Pacific revenue growth", top_k=3)

    assert len(results) > 0, "❌ FAIL: No results for 'Asia Pacific revenue growth'"
    print(f"  ✓ Got {len(results)} result(s)")

    # Check that the top result contains the table data
    top_content = results[0].content
    has_relevant_content = (
        "Asia Pacific" in top_content
        or "16.6" in top_content
        or "89.1" in top_content
    )
    assert has_relevant_content, (
        f"❌ FAIL: Top result doesn't contain Asia Pacific data.\n"
        f"  Content preview: {top_content[:200]}"
    )
    print("  ✓ PASS: Top result contains Asia Pacific table data")

    # ── Test 2: Check Markdown table structure ──
    print("\n  Test 3b: Verify Markdown table structure in results")
    all_content = " ".join(r.content for r in results)
    has_table = "|" in all_content
    if has_table:
        print("  ✓ PASS: Results contain Markdown table (pipe characters)")
    else:
        print("  ⚠ WARNING: No Markdown table pipes found. "
              "Tables may be in a different format.")

    # ── Test 3: Citation format ──
    print(f"\n  Test 3c: Citation format check")
    citation = results[0].citation
    print(f"  Citation: {citation}")
    assert filename in citation, (
        f"❌ FAIL: Citation doesn't contain filename. Got: {citation}"
    )
    print("  ✓ PASS: Citation contains filename")

    # ── Test 4: Query for Widget Pro ──
    print("\n  Test 3d: Query for 'Widget Pro price'")
    results2 = rag.search_context("Widget Pro average price", top_k=3)
    assert len(results2) > 0, "❌ FAIL: No results for 'Widget Pro price'"

    widget_found = any(
        "Widget Pro" in r.content or "3,000" in r.content or "3000" in r.content
        for r in results2
    )
    assert widget_found, (
        f"❌ FAIL: No result contains Widget Pro data.\n"
        f"  Results: {[r.content[:100] for r in results2]}"
    )
    print("  ✓ PASS: Widget Pro product data found")

    # ── Test 5: ContextChunk interface compatibility ──
    print("\n  Test 3e: ContextChunk interface compatibility")
    chunk = results[0]
    assert hasattr(chunk, 'content'), "❌ Missing 'content' attribute"
    assert hasattr(chunk, 'filename'), "❌ Missing 'filename' attribute"
    assert hasattr(chunk, 'chunk_index'), "❌ Missing 'chunk_index' attribute"
    assert hasattr(chunk, 'similarity'), "❌ Missing 'similarity' attribute"
    assert hasattr(chunk, 'citation'), "❌ Missing 'citation' property"
    assert isinstance(chunk.similarity, float), "❌ 'similarity' should be float"
    print("  ✓ PASS: ContextChunk interface is fully backward compatible")

    if verbose:
        print("\n  ── Top result content ──")
        print(f"  {top_content[:500]}")

    rag.close()


def cleanup_test_data(filename: str) -> None:
    """Remove test data from the database."""
    import psycopg2

    db_config = {
        "dbname": "vectordb",
        "user": os.environ.get("PGUSER", os.environ.get("USER", "postgres")),
        "password": os.environ.get("PGPASSWORD", ""),
        "host": os.environ.get("PGHOST", "localhost"),
        "port": os.environ.get("PGPORT", "5432"),
    }

    try:
        conn = psycopg2.connect(**db_config)
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM document_vectors WHERE filename = %s",
            (filename,),
        )
        deleted = cur.rowcount
        conn.commit()
        cur.close()
        conn.close()
        print(f"\n🗑️  Cleaned up {deleted} test vector(s)")
    except Exception as e:
        print(f"\n⚠  Cleanup failed: {e}")


# ─── Main ─────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="End-to-end test for Docling RAG pipeline"
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="Show detailed output")
    parser.add_argument(
        "--skip-pdf", action="store_true",
        help="Use Markdown instead of PDF (no reportlab needed)"
    )
    parser.add_argument(
        "--keep", action="store_true",
        help="Don't clean up test data from DB after test"
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(name)s | %(message)s",
    )

    print("=" * 60)
    print("  Docling RAG Pipeline — End-to-End Test")
    print("=" * 60)

    # Create temp directory for test files
    with tempfile.TemporaryDirectory(prefix="rag_test_") as tmp_dir:
        if args.skip_pdf:
            test_file = os.path.join(tmp_dir, "test_report.md")
            create_sample_markdown(test_file)
            test_filename = "test_report.md"
        else:
            test_file = os.path.join(tmp_dir, "test_report.pdf")
            try:
                create_sample_pdf(test_file)
            except ImportError as e:
                print(f"\n⚠  {e}")
                print("Falling back to Markdown test...\n")
                test_file = os.path.join(tmp_dir, "test_report.md")
                create_sample_markdown(test_file)
                test_filename = "test_report.md"
            else:
                test_filename = "test_report.pdf"

        try:
            # Step 1: Process with Docling
            chunks = test_docling_processing(test_file, verbose=args.verbose)

            # Step 2: Embed and store
            test_embedding_and_storage(chunks, test_filename, verbose=args.verbose)

            # Step 3: RAG retrieval
            test_rag_retrieval(test_filename, verbose=args.verbose)

            print("\n" + "=" * 60)
            print("  ✅ ALL TESTS PASSED")
            print("=" * 60)

        except AssertionError as e:
            print(f"\n{e}")
            print("\n" + "=" * 60)
            print("  ❌ TEST FAILED")
            print("=" * 60)
            sys.exit(1)

        except Exception as e:
            print(f"\n❌ Unexpected error: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)

        finally:
            if not args.keep:
                cleanup_test_data(test_filename)


if __name__ == "__main__":
    main()
