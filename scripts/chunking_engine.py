#!/usr/bin/env python3
"""
chunking_engine.py — Three-Strategy Chunking Engine

Routes documents to the correct chunking strategy based on file type:

  ┌────────────────────────────────────────────────────────────────┐
  │ Strategy 1: ENTITY-LEVEL                                      │
  │ Formats:  .json, .md, .xlsx, .csv                             │
  │ How:      Parse structure → split by entity/section boundary   │
  │ Why:      Preserves semantic units (keys, headings, rows)      │
  │ Example:  Each JSON key-value block = 1 chunk                 │
  │           Each Markdown ## section = 1 chunk                  │
  │           Each Excel sheet = 1 chunk                          │
  ├────────────────────────────────────────────────────────────────┤
  │ Strategy 2: PRE-DEFINED CHARACTER WINDOW                      │
  │ Formats:  .txt, .log, .cfg, .ini, unrecognized text           │
  │ How:      Fixed-size windows (1000 chars) with 200 overlap     │
  │ Why:      No structure to parse — uniform windowing is safest  │
  │ Example:  Audit logs, plain text, config files                │
  ├────────────────────────────────────────────────────────────────┤
  │ Strategy 3: SEMANTIC CONTEXT                                  │
  │ Formats:  .pdf, .docx, .pptx, .html                          │
  │ How:      Split at sentence/paragraph boundaries aware of      │
  │           headings, keeping ~500 tokens per chunk              │
  │ Why:      Dense technical content needs semantic coherence     │
  │ Example:  AWS docs, technical manuals, contracts, policies    │
  └────────────────────────────────────────────────────────────────┘

Every chunk carries rich metadata for filtering:
  - doc_type: "structured" | "unstructured" | "technical"
  - chunk_strategy: "entity_level" | "character_window" | "semantic_context"
  - file_type: original file extension
  - headings: list of heading hierarchy
  - section_title: immediate section context
  - page_number: for paginated docs
  - source_file: original filename
"""

import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Optional

logger = logging.getLogger("chunking_engine")


# ─── Strategy Classification ─────────────────────────────

ENTITY_LEVEL_EXTENSIONS = {".json", ".md", ".xlsx", ".xls", ".csv"}
CHARACTER_WINDOW_EXTENSIONS = {".txt", ".log", ".cfg", ".ini", ".conf", ".env", ".yaml", ".yml", ".toml"}
SEMANTIC_CONTEXT_EXTENSIONS = {".pdf", ".docx", ".doc", ".pptx", ".ppt", ".html", ".htm", ".xhtml"}

# Image formats — OCR then semantic chunking
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp"}


def classify_document(file_path: str) -> dict:
    """
    Classify a document and return its chunking strategy.

    Returns:
        {
            "doc_type": "structured" | "unstructured" | "technical",
            "chunk_strategy": "entity_level" | "character_window" | "semantic_context",
            "file_type": ".pdf",
        }
    """
    ext = Path(file_path).suffix.lower()

    if ext in ENTITY_LEVEL_EXTENSIONS:
        return {
            "doc_type": "structured",
            "chunk_strategy": "entity_level",
            "file_type": ext,
        }
    elif ext in CHARACTER_WINDOW_EXTENSIONS:
        return {
            "doc_type": "unstructured",
            "chunk_strategy": "character_window",
            "file_type": ext,
        }
    elif ext in SEMANTIC_CONTEXT_EXTENSIONS or ext in IMAGE_EXTENSIONS:
        return {
            "doc_type": "technical",
            "chunk_strategy": "semantic_context",
            "file_type": ext,
        }
    else:
        # Unknown extension — default to character window (safest)
        return {
            "doc_type": "unstructured",
            "chunk_strategy": "character_window",
            "file_type": ext,
        }


# ─── Metadata Builder ────────────────────────────────────

def _build_metadata(
    chunk_index: int,
    source_file: str,
    doc_type: str,
    chunk_strategy: str,
    file_type: str,
    headings: list[str] = None,
    section_title: str = "",
    page_number: int = 0,
    processor: str = "",
    extra: dict = None,
) -> dict:
    """Build a standardized metadata dict for every chunk."""
    meta = {
        "chunk_index": chunk_index,
        "source_file": source_file,
        "doc_type": doc_type,
        "chunk_strategy": chunk_strategy,
        "file_type": file_type,
        "headings": headings or [],
        "section_title": section_title,
        "page_number": page_number,
        "processor": processor,
    }
    if extra:
        meta.update(extra)
    return meta


# ═══════════════════════════════════════════════════════════
# Strategy 1: ENTITY-LEVEL CHUNKING
# ═══════════════════════════════════════════════════════════

def chunk_entity_level(file_path: str, raw_text: str = None) -> list[dict]:
    """
    Entity-level chunking for structured documents.

    JSON:  Each top-level key → 1 chunk (nested objects flattened)
    MD:    Each heading section → 1 chunk
    XLSX:  Each sheet → 1 chunk (as Markdown table)
    CSV:   Entire file → 1 chunk (as Markdown table)
    """
    ext = Path(file_path).suffix.lower()
    name = Path(file_path).name

    if ext == ".json":
        return _chunk_json(file_path, name)
    elif ext == ".md":
        return _chunk_markdown(file_path, name, raw_text)
    elif ext in (".xlsx", ".xls"):
        return _chunk_excel(file_path, name)
    elif ext == ".csv":
        return _chunk_csv(file_path, name)
    else:
        # Fallback: treat as markdown-like
        return _chunk_markdown(file_path, name, raw_text)


def _chunk_json(file_path: str, source_file: str) -> list[dict]:
    """
    Entity-level chunking for JSON files.

    Each top-level key becomes a chunk. Nested objects are serialized
    with pretty-print for readability. Arrays are treated as sub-entities.
    """
    text = Path(file_path).read_text(encoding="utf-8", errors="replace")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("Invalid JSON in %s — falling back to character window", source_file)
        return chunk_character_window(
            file_path, text,
            doc_type="structured", file_type=".json",
        )

    chunks = []

    if isinstance(data, dict):
        for key, value in data.items():
            # Serialize the entity
            if isinstance(value, (dict, list)):
                entity_text = f"## {key}\n\n```json\n{json.dumps(value, indent=2, default=str)[:3000]}\n```"
            else:
                entity_text = f"## {key}\n\n{value}"

            # Split large entities into sub-chunks
            sub_chunks = _split_if_large(entity_text, max_chars=2000)
            for j, sub in enumerate(sub_chunks):
                section_title = f"{key}" + (f" (part {j+1})" if len(sub_chunks) > 1 else "")
                chunks.append({
                    "text": sub,
                    "page_number": 0,
                    "metadata": _build_metadata(
                        chunk_index=len(chunks),
                        source_file=source_file,
                        doc_type="structured",
                        chunk_strategy="entity_level",
                        file_type=".json",
                        headings=[key],
                        section_title=section_title,
                        processor="entity_json",
                    ),
                })

    elif isinstance(data, list):
        # Array: chunk by groups of items
        group_size = max(1, min(10, len(data) // 5))  # 5-10 items per chunk
        for i in range(0, len(data), group_size):
            group = data[i:i + group_size]
            entity_text = f"## Items {i+1}-{min(i+group_size, len(data))}\n\n```json\n{json.dumps(group, indent=2, default=str)[:3000]}\n```"
            chunks.append({
                "text": entity_text,
                "page_number": 0,
                "metadata": _build_metadata(
                    chunk_index=len(chunks),
                    source_file=source_file,
                    doc_type="structured",
                    chunk_strategy="entity_level",
                    file_type=".json",
                    section_title=f"Items {i+1}-{min(i+group_size, len(data))}",
                    processor="entity_json",
                ),
            })
    else:
        # Scalar — single chunk
        chunks.append({
            "text": str(data),
            "page_number": 0,
            "metadata": _build_metadata(
                chunk_index=0,
                source_file=source_file,
                doc_type="structured",
                chunk_strategy="entity_level",
                file_type=".json",
                processor="entity_json",
            ),
        })

    logger.info("Entity-level JSON: %s → %d chunk(s)", source_file, len(chunks))
    return chunks


def _chunk_markdown(file_path: str, source_file: str, raw_text: str = None) -> list[dict]:
    """
    Entity-level chunking for Markdown files.

    Each heading section (# or ##) becomes one chunk.
    Sub-headings are preserved within their parent section.
    Large sections are split at paragraph boundaries.
    """
    if raw_text is None:
        raw_text = Path(file_path).read_text(encoding="utf-8", errors="replace")

    if not raw_text.strip():
        return [{
            "text": "(empty Markdown file)",
            "page_number": 0,
            "metadata": _build_metadata(
                chunk_index=0, source_file=source_file,
                doc_type="structured", chunk_strategy="entity_level",
                file_type=".md", processor="entity_md",
            ),
        }]

    # Split by top-level headings (# or ##)
    sections = re.split(r'(?=^#{1,2}\s)', raw_text, flags=re.MULTILINE)

    chunks = []
    for section in sections:
        section = section.strip()
        if not section:
            continue

        # Extract heading
        lines = section.split("\n", 1)
        heading = lines[0].lstrip("#").strip() if lines[0].startswith("#") else ""

        # Split large sections
        sub_chunks = _split_if_large(section, max_chars=2000)
        for j, sub in enumerate(sub_chunks):
            chunks.append({
                "text": sub,
                "page_number": 0,
                "metadata": _build_metadata(
                    chunk_index=len(chunks),
                    source_file=source_file,
                    doc_type="structured",
                    chunk_strategy="entity_level",
                    file_type=".md",
                    headings=[heading] if heading else [],
                    section_title=heading,
                    processor="entity_md",
                ),
            })

    logger.info("Entity-level Markdown: %s → %d chunk(s)", source_file, len(chunks))
    return chunks


def _chunk_excel(file_path: str, source_file: str) -> list[dict]:
    """
    Entity-level chunking for Excel files.
    Each sheet becomes one chunk (as a Markdown table).
    """
    try:
        import openpyxl
    except ImportError:
        logger.warning("openpyxl not installed — falling back to character window for %s", source_file)
        text = Path(file_path).read_text(encoding="utf-8", errors="replace")
        return chunk_character_window(file_path, text, doc_type="structured", file_type=Path(file_path).suffix)

    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    chunks = []

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue

        # Convert to Markdown table
        md_lines = [f"## Sheet: {sheet_name}\n"]
        headers = [str(c) if c is not None else "" for c in rows[0]]
        md_lines.append("| " + " | ".join(headers) + " |")
        md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")

        for row in rows[1:]:
            cells = [str(c) if c is not None else "" for c in row]
            if any(c.strip() for c in cells):
                md_lines.append("| " + " | ".join(cells) + " |")

        md_text = "\n".join(md_lines)

        # Split large sheets
        sub_chunks = _split_if_large(md_text, max_chars=2000)
        for j, sub in enumerate(sub_chunks):
            chunks.append({
                "text": sub,
                "page_number": 0,
                "metadata": _build_metadata(
                    chunk_index=len(chunks),
                    source_file=source_file,
                    doc_type="structured",
                    chunk_strategy="entity_level",
                    file_type=Path(file_path).suffix.lower(),
                    headings=[f"Sheet: {sheet_name}"],
                    section_title=sheet_name,
                    processor="entity_xlsx",
                    extra={"sheet_name": sheet_name},
                ),
            })

    wb.close()
    logger.info("Entity-level Excel: %s → %d chunk(s)", source_file, len(chunks))
    return chunks


def _chunk_csv(file_path: str, source_file: str) -> list[dict]:
    """
    Entity-level chunking for CSV files.
    Groups rows into chunks of ~50 rows, preserving header.
    """
    import csv
    import io

    text = Path(file_path).read_text(encoding="utf-8", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)

    if not rows:
        return [{
            "text": "(empty CSV file)",
            "page_number": 0,
            "metadata": _build_metadata(
                chunk_index=0, source_file=source_file,
                doc_type="structured", chunk_strategy="entity_level",
                file_type=".csv", processor="entity_csv",
            ),
        }]

    headers = rows[0]
    data_rows = rows[1:]
    chunks = []

    # Group rows into chunks of ~50
    group_size = 50
    for start in range(0, max(1, len(data_rows)), group_size):
        group = data_rows[start:start + group_size]

        md_lines = [f"## {source_file} (rows {start+1}-{start+len(group)})\n"]
        md_lines.append("| " + " | ".join(headers) + " |")
        md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
        for row in group:
            padded = row + [""] * (len(headers) - len(row))
            md_lines.append("| " + " | ".join(padded[:len(headers)]) + " |")

        md_text = "\n".join(md_lines)
        chunks.append({
            "text": md_text,
            "page_number": 0,
            "metadata": _build_metadata(
                chunk_index=len(chunks),
                source_file=source_file,
                doc_type="structured",
                chunk_strategy="entity_level",
                file_type=".csv",
                section_title=f"Rows {start+1}-{start+len(group)}",
                processor="entity_csv",
                extra={"row_range": f"{start+1}-{start+len(group)}"},
            ),
        })

    logger.info("Entity-level CSV: %s → %d chunk(s)", source_file, len(chunks))
    return chunks


# ═══════════════════════════════════════════════════════════
# Strategy 2: PRE-DEFINED CHARACTER WINDOW
# ═══════════════════════════════════════════════════════════

def chunk_character_window(
    file_path: str,
    raw_text: str = None,
    window_size: int = 1000,
    overlap: int = 200,
    doc_type: str = "unstructured",
    file_type: str = None,
) -> list[dict]:
    """
    Fixed-size character window chunking with overlap.

    Best for unstructured text (audit logs, plain text, config files)
    where there are no reliable structural boundaries.

    Args:
        file_path: Path to the file
        raw_text: Pre-loaded text (optional)
        window_size: Characters per window (default 1000 ≈ 250 tokens)
        overlap: Characters to overlap between windows (default 200)
        doc_type: Document type classification
        file_type: File extension
    """
    source_file = Path(file_path).name
    if file_type is None:
        file_type = Path(file_path).suffix.lower()

    if raw_text is None:
        raw_text = Path(file_path).read_text(encoding="utf-8", errors="replace")

    if not raw_text.strip():
        return [{
            "text": "(empty file)",
            "page_number": 0,
            "metadata": _build_metadata(
                chunk_index=0, source_file=source_file,
                doc_type=doc_type, chunk_strategy="character_window",
                file_type=file_type, processor="char_window",
            ),
        }]

    chunks = []
    text_len = len(raw_text)
    step = max(1, window_size - overlap)

    pos = 0
    while pos < text_len:
        end = min(pos + window_size, text_len)
        window = raw_text[pos:end]

        # Try to break at a natural boundary (newline, period, space)
        if end < text_len:
            # Look backwards from the window end for a good break point
            for br_char in ["\n\n", "\n", ". ", " "]:
                br_pos = window.rfind(br_char, max(0, len(window) - 100))
                if br_pos > len(window) // 2:
                    window = window[:br_pos + len(br_char)]
                    end = pos + len(window)
                    break

        window = window.strip()
        if window:
            # Extract a section hint from the first line
            first_line = window.split("\n", 1)[0][:80].strip()

            chunks.append({
                "text": window,
                "page_number": 0,
                "metadata": _build_metadata(
                    chunk_index=len(chunks),
                    source_file=source_file,
                    doc_type=doc_type,
                    chunk_strategy="character_window",
                    file_type=file_type,
                    section_title=first_line,
                    processor="char_window",
                    extra={"char_offset": pos},
                ),
            })

        pos = pos + step
        # If we already reached the end, break
        if end >= text_len:
            break

    logger.info(
        "Character window (%d/%d): %s → %d chunk(s)",
        window_size, overlap, source_file, len(chunks),
    )
    return chunks


# ═══════════════════════════════════════════════════════════
# Strategy 3: SEMANTIC CONTEXT CHUNKING
# ═══════════════════════════════════════════════════════════

def chunk_semantic_context(
    file_path: str,
    raw_text: str = None,
    pages: list[dict] = None,
    max_chunk_tokens: int = 500,
    file_type: str = None,
) -> list[dict]:
    """
    Semantic context chunking for technically dense documents.

    Splits at natural semantic boundaries:
    1. Heading boundaries (## Title → new chunk)
    2. Paragraph boundaries  (double newline → potential split point)
    3. Sentence boundaries (. + space → last-resort split)

    Heading context is carried forward so each chunk knows its section.

    Args:
        file_path: Path to the file
        raw_text: Pre-extracted text (optional, for non-PDF)
        pages: Pre-extracted pages [{"page_number": int, "text": str}]
        max_chunk_tokens: Target max tokens per chunk (~4 chars/token)
        file_type: File extension
    """
    source_file = Path(file_path).name
    if file_type is None:
        file_type = Path(file_path).suffix.lower()

    max_chars = max_chunk_tokens * 4  # ~4 chars per token

    # ── Step 1: Get pages ──
    if pages is not None:
        page_list = pages
    elif raw_text is not None:
        page_list = [{"page_number": 0, "text": raw_text}]
    else:
        # For PDFs, extract pages with PyMuPDF
        page_list = _extract_pdf_pages(file_path)

    chunks = []
    current_heading_stack = []  # Tracks the heading hierarchy

    for page_data in page_list:
        page_num = page_data.get("page_number", 0)
        text = page_data.get("text", "").strip()
        if not text:
            continue

        # Split the page into semantic blocks
        blocks = _split_into_semantic_blocks(text)

        current_chunk_lines = []
        current_chunk_len = 0

        for block in blocks:
            block_text = block["text"]
            is_heading = block.get("is_heading", False)

            # Track heading hierarchy
            if is_heading:
                level = block.get("heading_level", 1)
                # Trim the stack to this heading level
                current_heading_stack = current_heading_stack[:level - 1]
                current_heading_stack.append(block_text.lstrip("#").strip())

            # Would this block push the chunk over the limit?
            if current_chunk_len + len(block_text) > max_chars and current_chunk_lines:
                # Flush the current chunk
                chunk_text = "\n\n".join(current_chunk_lines).strip()
                if chunk_text:
                    section_title = current_heading_stack[-1] if current_heading_stack else ""
                    chunks.append({
                        "text": chunk_text,
                        "page_number": page_num,
                        "metadata": _build_metadata(
                            chunk_index=len(chunks),
                            source_file=source_file,
                            doc_type="technical",
                            chunk_strategy="semantic_context",
                            file_type=file_type,
                            headings=list(current_heading_stack),
                            section_title=section_title,
                            page_number=page_num,
                            processor="semantic",
                        ),
                    })
                current_chunk_lines = []
                current_chunk_len = 0

            # If a single block is too large, split it at sentences
            if len(block_text) > max_chars:
                sentences = _split_at_sentences(block_text, max_chars)
                for sent in sentences:
                    section_title = current_heading_stack[-1] if current_heading_stack else ""
                    chunks.append({
                        "text": sent.strip(),
                        "page_number": page_num,
                        "metadata": _build_metadata(
                            chunk_index=len(chunks),
                            source_file=source_file,
                            doc_type="technical",
                            chunk_strategy="semantic_context",
                            file_type=file_type,
                            headings=list(current_heading_stack),
                            section_title=section_title,
                            page_number=page_num,
                            processor="semantic",
                        ),
                    })
            else:
                current_chunk_lines.append(block_text)
                current_chunk_len += len(block_text)

        # Flush remaining text from this page
        if current_chunk_lines:
            chunk_text = "\n\n".join(current_chunk_lines).strip()
            if chunk_text:
                section_title = current_heading_stack[-1] if current_heading_stack else ""
                chunks.append({
                    "text": chunk_text,
                    "page_number": page_num,
                    "metadata": _build_metadata(
                        chunk_index=len(chunks),
                        source_file=source_file,
                        doc_type="technical",
                        chunk_strategy="semantic_context",
                        file_type=file_type,
                        headings=list(current_heading_stack),
                        section_title=section_title,
                        page_number=page_num,
                        processor="semantic",
                    ),
                })

    logger.info(
        "Semantic context: %s → %d chunk(s) (max ~%d tokens)",
        source_file, len(chunks), max_chunk_tokens,
    )
    return chunks


# ─── Semantic chunking helpers ────────────────────────────

def _split_into_semantic_blocks(text: str) -> list[dict]:
    """
    Split text into semantic blocks at natural boundaries.

    Identifies:
    - Headings (lines starting with #)
    - Paragraph breaks (double newline)
    - List items (lines starting with - or *)
    """
    blocks = []
    paragraphs = re.split(r'\n\s*\n', text)

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        # Check if it's a heading
        heading_match = re.match(r'^(#{1,6})\s+(.+)', para)
        if heading_match:
            blocks.append({
                "text": para,
                "is_heading": True,
                "heading_level": len(heading_match.group(1)),
            })
        else:
            blocks.append({
                "text": para,
                "is_heading": False,
            })

    return blocks


def _split_at_sentences(text: str, max_chars: int) -> list[str]:
    """Split text at sentence boundaries, keeping chunks under max_chars."""
    # Split at sentence endings (. ! ? followed by space or newline)
    sentences = re.split(r'(?<=[.!?])\s+', text)

    chunks = []
    current = ""

    for sentence in sentences:
        if len(current) + len(sentence) + 1 > max_chars and current:
            chunks.append(current.strip())
            current = sentence
        else:
            current += (" " if current else "") + sentence

    if current.strip():
        chunks.append(current.strip())

    return chunks


def _extract_pdf_pages(file_path: str) -> list[dict]:
    """Extract pages from a PDF using PyMuPDF."""
    try:
        import fitz
    except ImportError:
        logger.warning("PyMuPDF not installed — reading as plain text")
        text = Path(file_path).read_text(encoding="utf-8", errors="replace")
        return [{"page_number": 0, "text": text}]

    doc = fitz.open(file_path)
    pages = []
    for i in range(len(doc)):
        text = doc[i].get_text().strip()
        if text:
            pages.append({"page_number": i + 1, "text": text})
    doc.close()
    return pages


# ─── Shared helpers ───────────────────────────────────────

def _split_if_large(text: str, max_chars: int = 2000) -> list[str]:
    """Split text into sub-chunks if it exceeds max_chars."""
    if len(text) <= max_chars:
        return [text]

    # Split at paragraph boundaries first
    paragraphs = text.split("\n\n")
    sub_chunks = []
    current = ""

    for para in paragraphs:
        if len(current) + len(para) + 2 > max_chars and current:
            sub_chunks.append(current.strip())
            current = para
        else:
            current += ("\n\n" if current else "") + para

    if current.strip():
        sub_chunks.append(current.strip())

    return sub_chunks


# ═══════════════════════════════════════════════════════════
# UNIFIED ENTRY POINT
# ═══════════════════════════════════════════════════════════

def chunk_document(
    file_path: str,
    raw_text: str = None,
    pages: list[dict] = None,
) -> list[dict]:
    """
    Route a document to the correct chunking strategy.

    This is the single entry point for all chunking.
    The document is classified by file type, then chunked
    with the appropriate strategy.

    Returns:
        List of chunk dicts, each with:
            - "text": str — chunk content
            - "page_number": int — source page (0 if unavailable)
            - "metadata": dict — rich metadata for filtering
    """
    classification = classify_document(file_path)
    strategy = classification["chunk_strategy"]

    logger.info(
        "Chunking %s: strategy=%s, doc_type=%s, file_type=%s",
        Path(file_path).name, strategy,
        classification["doc_type"], classification["file_type"],
    )

    if strategy == "entity_level":
        chunks = chunk_entity_level(file_path, raw_text)
    elif strategy == "character_window":
        chunks = chunk_character_window(
            file_path, raw_text,
            doc_type=classification["doc_type"],
            file_type=classification["file_type"],
        )
    elif strategy == "semantic_context":
        chunks = chunk_semantic_context(
            file_path, raw_text, pages,
            file_type=classification["file_type"],
        )
    else:
        chunks = chunk_character_window(
            file_path, raw_text,
            doc_type=classification["doc_type"],
            file_type=classification["file_type"],
        )

    return chunks


# ─── CLI for testing ──────────────────────────────────────

if __name__ == "__main__":
    import sys
    import time

    logging.basicConfig(level=logging.INFO, format="%(name)s | %(message)s")

    if len(sys.argv) < 2:
        print("Usage: python3 chunking_engine.py <file_path>")
        sys.exit(1)

    fp = sys.argv[1]
    print(f"\n📄 Chunking: {fp}\n")

    classification = classify_document(fp)
    print(f"Classification: {json.dumps(classification, indent=2)}\n")

    start = time.time()
    chunks = chunk_document(fp)
    elapsed = time.time() - start

    print(f"✅ {len(chunks)} chunk(s) in {elapsed:.2f}s\n")

    for chunk in chunks[:10]:  # Show first 10
        meta = chunk["metadata"]
        preview = chunk["text"][:120].replace("\n", " ")
        print(f"── Chunk {meta['chunk_index']} | strategy={meta['chunk_strategy']} | "
              f"type={meta['doc_type']} | section={meta.get('section_title', '')[:40]}")
        print(f"   {preview}…")
        print()
