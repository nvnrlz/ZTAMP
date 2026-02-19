#!/usr/bin/env python3
"""
docling_processor.py — Structure-Aware Document Processing with Docling

Uses IBM Docling (DS4SD) for complex documents (PDF, images) that need
layout analysis, table detection, and OCR.

For simple formats (XLSX, CSV, DOCX, Markdown), uses lightweight native
Python libraries for fast extraction — no ML models needed.

Supported formats: PDF, DOCX, PPTX, HTML, Images (PNG, JPG, TIFF),
                   AsciiDoc, Markdown, XLSX, XLS, CSV

Usage (as a library):
    from docling_processor import process_file
    chunks = process_file("contract.pdf")
    for chunk in chunks:
        print(chunk["text"][:100], "| page:", chunk["page_number"])

Usage (standalone test):
    python3 docling_processor.py path/to/document.pdf
"""

import logging
import sys
import csv
import io
from pathlib import Path
from typing import Optional

logger = logging.getLogger("docling_processor")

# ─── Supported file extensions ────────────────────────────

SUPPORTED_EXTENSIONS = {
    ".pdf", ".docx", ".doc", ".pptx", ".ppt",
    ".html", ".htm", ".xhtml",
    ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp",
    ".md", ".adoc", ".asciidoc",
    ".xlsx", ".xls", ".csv",
}

# Formats that need Docling's heavy ML pipeline (layout analysis, OCR, etc.)
# Note: PDFs are handled by PyMuPDF (fast) by default, not Docling
_DOCLING_FORMATS = {
    ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp",
    ".pptx", ".ppt",
    ".html", ".htm", ".xhtml",
    ".adoc", ".asciidoc",
}

# Formats that can be processed with lightweight native Python
_LIGHTWEIGHT_FORMATS = {
    ".pdf",
    ".xlsx", ".xls", ".csv",
    ".docx", ".doc",
    ".md",
}


def is_supported(filepath: str) -> bool:
    """Check if a file extension is supported."""
    return Path(filepath).suffix.lower() in SUPPORTED_EXTENSIONS


# ─── Lightweight processors for simple formats ────────────

def _process_xlsx(file_path: str) -> list[dict]:
    """Fast extraction from Excel files using openpyxl."""
    try:
        import openpyxl
    except ImportError:
        logger.warning("openpyxl not installed, falling back to Docling for XLSX")
        return _process_with_docling(file_path)

    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    chunks = []

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue

        # Convert sheet to Markdown table
        md_lines = [f"## Sheet: {sheet_name}\n"]

        # Find header row (first non-empty row)
        headers = [str(c) if c is not None else "" for c in rows[0]]
        md_lines.append("| " + " | ".join(headers) + " |")
        md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")

        for row in rows[1:]:
            cells = [str(c) if c is not None else "" for c in row]
            # Skip fully empty rows
            if any(c.strip() for c in cells):
                md_lines.append("| " + " | ".join(cells) + " |")

        md_text = "\n".join(md_lines)

        chunks.append({
            "text": md_text,
            "page_number": 0,
            "metadata": {
                "chunk_index": len(chunks),
                "headings": [f"Sheet: {sheet_name}"],
                "raw_text_length": len(md_text),
                "enriched_text_length": len(md_text),
                "source_file": Path(file_path).name,
                "processor": "lightweight_xlsx",
            },
        })

    wb.close()
    logger.info("XLSX fast extraction: %s → %d chunk(s)", Path(file_path).name, len(chunks))
    return chunks


def _process_csv(file_path: str) -> list[dict]:
    """Fast extraction from CSV files."""
    path = Path(file_path)
    text = path.read_text(encoding="utf-8", errors="replace")

    reader = csv.reader(io.StringIO(text))
    rows = list(reader)

    if not rows:
        return [{
            "text": "(empty CSV file)",
            "page_number": 0,
            "metadata": {"chunk_index": 0, "headings": [], "raw_text_length": 0,
                         "enriched_text_length": 0, "source_file": path.name, "processor": "lightweight_csv"},
        }]

    # Convert to Markdown table
    md_lines = [f"## {path.name}\n"]
    headers = rows[0]
    md_lines.append("| " + " | ".join(headers) + " |")
    md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")

    for row in rows[1:]:
        # Pad or truncate row to match header count
        padded = row + [""] * (len(headers) - len(row))
        md_lines.append("| " + " | ".join(padded[:len(headers)]) + " |")

    md_text = "\n".join(md_lines)

    logger.info("CSV fast extraction: %s → 1 chunk", path.name)
    return [{
        "text": md_text,
        "page_number": 0,
        "metadata": {
            "chunk_index": 0,
            "headings": [path.name],
            "raw_text_length": len(md_text),
            "enriched_text_length": len(md_text),
            "source_file": path.name,
            "processor": "lightweight_csv",
        },
    }]


def _process_docx(file_path: str) -> list[dict]:
    """Fast extraction from DOCX files using python-docx."""
    try:
        import docx
    except ImportError:
        logger.warning("python-docx not installed, falling back to Docling for DOCX")
        return _process_with_docling(file_path)

    path = Path(file_path)
    document = docx.Document(file_path)

    # Extract all paragraphs with headings
    sections: list[dict] = []
    current_heading = ""
    current_text_lines: list[str] = []

    for para in document.paragraphs:
        text = para.text.strip()
        if not text:
            continue

        style_name = para.style.name.lower() if para.style else ""

        if "heading" in style_name:
            # Flush current section
            if current_text_lines:
                sections.append({
                    "heading": current_heading,
                    "text": "\n".join(current_text_lines),
                })
                current_text_lines = []
            current_heading = text
        else:
            current_text_lines.append(text)

    # Flush remaining
    if current_text_lines:
        sections.append({
            "heading": current_heading,
            "text": "\n".join(current_text_lines),
        })

    # Also extract tables
    for i, table in enumerate(document.tables):
        rows = []
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            rows.append(cells)

        if rows:
            md_lines = []
            if rows:
                md_lines.append("| " + " | ".join(rows[0]) + " |")
                md_lines.append("| " + " | ".join(["---"] * len(rows[0])) + " |")
                for row in rows[1:]:
                    padded = row + [""] * (len(rows[0]) - len(row))
                    md_lines.append("| " + " | ".join(padded[:len(rows[0])]) + " |")

            sections.append({
                "heading": f"Table {i + 1}",
                "text": "\n".join(md_lines),
            })

    # Convert sections to chunks
    chunks = []
    for i, section in enumerate(sections):
        heading_prefix = f"## {section['heading']}\n\n" if section['heading'] else ""
        chunk_text = heading_prefix + section['text']
        chunks.append({
            "text": chunk_text,
            "page_number": 0,
            "metadata": {
                "chunk_index": i,
                "headings": [section['heading']] if section['heading'] else [],
                "raw_text_length": len(section['text']),
                "enriched_text_length": len(chunk_text),
                "source_file": path.name,
                "processor": "lightweight_docx",
            },
        })

    # If no sections found, create one chunk from all text
    if not chunks:
        all_text = "\n".join(p.text for p in document.paragraphs if p.text.strip())
        if all_text.strip():
            chunks.append({
                "text": all_text[:8000],
                "page_number": 0,
                "metadata": {
                    "chunk_index": 0,
                    "headings": [],
                    "raw_text_length": len(all_text),
                    "enriched_text_length": min(len(all_text), 8000),
                    "source_file": path.name,
                    "processor": "lightweight_docx",
                    "fallback": True,
                },
            })

    logger.info("DOCX fast extraction: %s → %d chunk(s)", path.name, len(chunks))
    return chunks


def _process_markdown(file_path: str) -> list[dict]:
    """Fast extraction from Markdown files (already structured)."""
    path = Path(file_path)
    text = path.read_text(encoding="utf-8", errors="replace")

    if not text.strip():
        return [{
            "text": "(empty Markdown file)",
            "page_number": 0,
            "metadata": {"chunk_index": 0, "headings": [], "raw_text_length": 0,
                         "enriched_text_length": 0, "source_file": path.name, "processor": "lightweight_md"},
        }]

    # Split by headings (## or #)
    import re
    sections = re.split(r'(?=^#{1,3}\s)', text, flags=re.MULTILINE)

    chunks = []
    for i, section in enumerate(sections):
        section = section.strip()
        if not section:
            continue

        # Extract heading from first line
        lines = section.split("\n", 1)
        heading = lines[0].lstrip("#").strip() if lines[0].startswith("#") else ""

        chunks.append({
            "text": section,
            "page_number": 0,
            "metadata": {
                "chunk_index": i,
                "headings": [heading] if heading else [],
                "raw_text_length": len(section),
                "enriched_text_length": len(section),
                "source_file": path.name,
                "processor": "lightweight_md",
            },
        })

    logger.info("Markdown fast extraction: %s → %d chunk(s)", path.name, len(chunks))
    return chunks


def _detect_pdf_type(file_path: str) -> dict:
    """
    Smart PDF inspection using PyMuPDF — determines whether a PDF needs
    Docling's heavy ML pipeline (OCR, layout analysis) or can be handled
    by the fast PyMuPDF text extractor.

    Samples up to 5 pages from across the document. Takes ~50ms even
    for 10,000+ page PDFs.

    Returns:
        dict with keys:
            - 'type': 'text' | 'scanned' | 'mixed'
            - 'pages': total page count
            - 'embedded_files': count of embedded files (audio, video, etc.)
            - 'sampled_pages': number of pages inspected
            - 'scanned_ratio': fraction of sampled pages that appear scanned
            - 'reason': human-readable explanation of the decision
    """
    try:
        import fitz
    except ImportError:
        # If PyMuPDF isn't available, default to Docling
        return {
            'type': 'scanned', 'pages': 0, 'embedded_files': 0,
            'sampled_pages': 0, 'scanned_ratio': 1.0,
            'reason': 'PyMuPDF not installed, defaulting to Docling',
        }

    doc = fitz.open(file_path)
    total_pages = len(doc)

    # Check for embedded multimedia files (audio, video, attachments)
    embedded_files = doc.embfile_count()

    # Sample pages: first, 25%, middle, 75%, last — covers the full document
    sample_indices = sorted(set([
        0,
        max(0, total_pages // 4),
        max(0, total_pages // 2),
        max(0, 3 * total_pages // 4),
        max(0, total_pages - 1),
    ]))
    # Don't sample more pages than exist
    sample_indices = [i for i in sample_indices if i < total_pages]

    scanned_pages = 0
    text_pages = 0
    min_text_threshold = 50  # chars — less than this = likely scanned/image page

    for i in sample_indices:
        page = doc[i]
        text = page.get_text().strip()
        images = page.get_images(full=True)

        has_meaningful_text = len(text) > min_text_threshold
        has_images = len(images) > 0

        if has_images and not has_meaningful_text:
            # Page has images but no selectable text → scanned page
            scanned_pages += 1
        else:
            text_pages += 1

    doc.close()

    sampled = len(sample_indices)
    scanned_ratio = scanned_pages / sampled if sampled > 0 else 0

    # Decision logic
    if embedded_files > 0:
        pdf_type = 'mixed'
        reason = f'{embedded_files} embedded file(s) detected — Docling needed for full extraction'
    elif scanned_ratio >= 0.5:
        pdf_type = 'scanned'
        reason = f'{scanned_pages}/{sampled} sampled pages have images but no text — likely scanned PDF'
    elif scanned_ratio > 0:
        pdf_type = 'mixed'
        reason = f'{scanned_pages}/{sampled} sampled pages appear scanned — mixed document'
    else:
        pdf_type = 'text'
        reason = f'All {sampled} sampled pages have selectable text — fast extraction safe'

    result = {
        'type': pdf_type,
        'pages': total_pages,
        'embedded_files': embedded_files,
        'sampled_pages': sampled,
        'scanned_ratio': scanned_ratio,
        'reason': reason,
    }

    logger.info(
        "PDF detection: %s → type=%s (%s)",
        Path(file_path).name, pdf_type, reason,
    )
    return result


def _process_pdf_fast(file_path: str, max_chunk_tokens: int = 500) -> list[dict]:
    """
    Fast PDF text extraction using PyMuPDF (fitz).

    Extracts text page-by-page and splits into ~500-token chunks,
    preserving page numbers. 100x+ faster than Docling for text-heavy PDFs.
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        logger.warning("PyMuPDF not installed, falling back to Docling for PDF")
        return _process_with_docling(file_path)

    path = Path(file_path)
    doc = fitz.open(file_path)
    chunks = []

    # Approximate: 1 token ≈ 4 characters
    max_chars = max_chunk_tokens * 4

    for page_num in range(len(doc)):
        page = doc[page_num]
        text = page.get_text().strip()
        if not text:
            continue

        # Split long pages into multiple chunks
        if len(text) <= max_chars:
            chunks.append({
                "text": text,
                "page_number": page_num + 1,
                "metadata": {
                    "chunk_index": len(chunks),
                    "headings": [],
                    "raw_text_length": len(text),
                    "enriched_text_length": len(text),
                    "source_file": path.name,
                    "processor": "lightweight_pdf",
                },
            })
        else:
            # Split by paragraphs (double newline) to keep text natural
            paragraphs = text.split("\n\n")
            current_chunk = ""

            for para in paragraphs:
                para = para.strip()
                if not para:
                    continue

                if len(current_chunk) + len(para) + 2 > max_chars and current_chunk:
                    chunks.append({
                        "text": current_chunk.strip(),
                        "page_number": page_num + 1,
                        "metadata": {
                            "chunk_index": len(chunks),
                            "headings": [],
                            "raw_text_length": len(current_chunk),
                            "enriched_text_length": len(current_chunk),
                            "source_file": path.name,
                            "processor": "lightweight_pdf",
                        },
                    })
                    current_chunk = para
                else:
                    current_chunk += ("\n\n" if current_chunk else "") + para

            if current_chunk.strip():
                chunks.append({
                    "text": current_chunk.strip(),
                    "page_number": page_num + 1,
                    "metadata": {
                        "chunk_index": len(chunks),
                        "headings": [],
                        "raw_text_length": len(current_chunk),
                        "enriched_text_length": len(current_chunk),
                        "source_file": path.name,
                        "processor": "lightweight_pdf",
                    },
                })

    doc.close()
    logger.info("PDF fast extraction: %s → %d chunk(s)", path.name, len(chunks))
    return chunks


# ─── Docling processor (for complex formats) ─────────────

# Module-level cache for the heavy Docling converter
_docling_converter = None
_docling_chunker_cache = {}


def _get_docling_converter():
    """Get or create a cached DocumentConverter (avoids re-initialization)."""
    global _docling_converter
    if _docling_converter is None:
        from docling.document_converter import DocumentConverter
        logger.info("Initializing Docling DocumentConverter (first time)...")
        _docling_converter = DocumentConverter()
        logger.info("Docling DocumentConverter ready")
    return _docling_converter


def _get_docling_chunker(
    embedding_model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
    max_tokens: int = 512,
):
    """Get or create a cached HybridChunker."""
    cache_key = (embedding_model_name, max_tokens)
    if cache_key not in _docling_chunker_cache:
        from docling.chunking import HybridChunker
        _docling_chunker_cache[cache_key] = HybridChunker(
            tokenizer=embedding_model_name,
            max_tokens=max_tokens,
            merge_peers=True,
        )
    return _docling_chunker_cache[cache_key]


def _process_with_docling(
    file_path: str,
    max_tokens: int = 512,
    embedding_model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
) -> list[dict]:
    """
    Process a document using Docling's full ML pipeline.
    Best for PDFs, images, presentations, and HTML.
    """
    path = Path(file_path)

    try:
        from docling.document_converter import DocumentConverter
        from docling.chunking import HybridChunker
    except ImportError as e:
        logger.error("Docling is not installed: %s", e)
        raise ImportError(
            "Docling is required for this file format. Install with:\n"
            "  pip install docling 'docling-core[chunking]'"
        ) from e

    # ── Step 1: Convert document ──
    logger.info("Converting document with Docling: %s", path.name)
    converter = _get_docling_converter()

    try:
        result = converter.convert(str(path))
    except Exception as e:
        raise RuntimeError(
            f"Docling conversion failed for {path.name}: {e}"
        ) from e

    doc = result.document

    # ── Step 2: Export full Markdown ──
    full_markdown = doc.export_to_markdown()
    logger.info(
        "Document converted: %s → %d characters of Markdown",
        path.name, len(full_markdown),
    )

    # ── Step 3: Semantic chunking with HybridChunker ──
    chunker = _get_docling_chunker(embedding_model_name, max_tokens)

    chunks = []
    for i, chunk in enumerate(chunker.chunk(dl_doc=doc)):
        enriched_text = chunker.contextualize(chunk=chunk)
        page_number = _extract_page_number(chunk)
        headings = _extract_headings(chunk)

        chunks.append({
            "text": enriched_text,
            "page_number": page_number,
            "metadata": {
                "chunk_index": i,
                "headings": headings,
                "raw_text_length": len(chunk.text),
                "enriched_text_length": len(enriched_text),
                "source_file": path.name,
                "processor": "docling",
            },
        })

    logger.info(
        "Chunking complete: %s → %d semantic chunks",
        path.name, len(chunks),
    )

    # Fallback: if Docling produced zero chunks, create one from the full Markdown
    if not chunks and full_markdown.strip():
        logger.warning(
            "Docling produced 0 chunks for %s; falling back to full Markdown",
            path.name,
        )
        chunks.append({
            "text": full_markdown[:8000],
            "page_number": 0,
            "metadata": {
                "chunk_index": 0,
                "headings": [],
                "raw_text_length": len(full_markdown),
                "enriched_text_length": len(full_markdown[:8000]),
                "source_file": path.name,
                "processor": "docling",
                "fallback": True,
            },
        })

    return chunks


# ─── Core: Process a single file (unified entry point) ────

def process_file(
    file_path: str,
    max_tokens: int = 512,
    embedding_model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
) -> list[dict]:
    """
    Convert a document to structured Markdown and chunk it semantically.

    Uses lightweight native extraction for simple formats (XLSX, CSV, DOCX, MD)
    and Docling's full ML pipeline for complex formats (PDF, images, PPTX, HTML).

    Args:
        file_path: Path to the document file.
        max_tokens: Maximum tokens per chunk (aligned to the embedding model).
        embedding_model_name: HuggingFace tokenizer name for chunk sizing.

    Returns:
        List of chunk dicts, each with:
            - "text": str — Markdown-formatted chunk content
            - "page_number": int — source page (0 if unavailable)
            - "metadata": dict — additional metadata (headings, doc_hash, etc.)

    Raises:
        FileNotFoundError: If the file doesn't exist.
        ValueError: If the file format is not supported.
        RuntimeError: If conversion fails.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")
    if not is_supported(file_path):
        raise ValueError(
            f"Unsupported format: {path.suffix}. "
            f"Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )

    ext = path.suffix.lower()

    # ── Route to the right processor ──
    if ext == ".pdf":
        # Smart detection: inspect PDF structure to choose the best processor
        detection = _detect_pdf_type(file_path)
        if detection['type'] == 'text':
            logger.info("Using PyMuPDF (fast) for %s: %s", path.name, detection['reason'])
            return _process_pdf_fast(file_path)
        else:
            logger.info("Using Docling (ML) for %s: %s", path.name, detection['reason'])
            return _process_with_docling(file_path, max_tokens, embedding_model_name)
    elif ext in (".xlsx", ".xls"):
        return _process_xlsx(file_path)
    elif ext == ".csv":
        return _process_csv(file_path)
    elif ext in (".docx", ".doc"):
        return _process_docx(file_path)
    elif ext == ".md":
        return _process_markdown(file_path)
    else:
        # Images, PPTX, HTML, etc. → Docling's full pipeline
        return _process_with_docling(file_path, max_tokens, embedding_model_name)


# ─── Helpers ──────────────────────────────────────────────

def _extract_page_number(chunk) -> int:
    """
    Extract the page number from a Docling chunk's provenance metadata.

    The chunk.meta.doc_items list contains references to document elements,
    each of which may have provenance (prov) with page_no.
    Returns the first page number found, or 0 if unavailable.
    """
    try:
        if hasattr(chunk, "meta") and hasattr(chunk.meta, "doc_items"):
            for doc_item in chunk.meta.doc_items:
                if hasattr(doc_item, "prov") and doc_item.prov:
                    for prov in doc_item.prov:
                        if hasattr(prov, "page_no") and prov.page_no:
                            return int(prov.page_no)
    except (AttributeError, TypeError, ValueError):
        pass
    return 0


def _extract_headings(chunk) -> list[str]:
    """
    Extract heading context from a Docling chunk.

    The chunk.meta.headings contains the heading hierarchy leading to this chunk.
    """
    headings = []
    try:
        if hasattr(chunk, "meta") and hasattr(chunk.meta, "headings"):
            for heading in chunk.meta.headings:
                if hasattr(heading, "text") and heading.text:
                    headings.append(heading.text.strip())
    except (AttributeError, TypeError):
        pass
    return headings


# ─── Standalone CLI ───────────────────────────────────────

def main():
    """Process a document and print the chunks (for testing)."""
    if len(sys.argv) < 2:
        print("Usage: python3 docling_processor.py <file_path>")
        print(f"Supported formats: {', '.join(sorted(SUPPORTED_EXTENSIONS))}")
        sys.exit(1)

    logging.basicConfig(level=logging.INFO, format="%(name)s | %(message)s")

    file_path = sys.argv[1]
    print(f"\n📄 Processing: {file_path}\n")

    import time
    start = time.time()

    try:
        chunks = process_file(file_path)
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

    elapsed = time.time() - start
    print(f"✅ {len(chunks)} chunk(s) generated in {elapsed:.1f}s\n")
    for chunk in chunks:
        page = chunk["page_number"]
        processor = chunk["metadata"].get("processor", "unknown")
        text_preview = chunk["text"][:200].replace("\n", " ")
        headings = " > ".join(chunk["metadata"]["headings"]) if chunk["metadata"]["headings"] else "(no headings)"
        print(f"── Chunk {chunk['metadata']['chunk_index']} | Page {page} | {headings} | via {processor}")
        print(f"   {text_preview}…")
        print()


if __name__ == "__main__":
    main()
