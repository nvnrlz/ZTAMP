"""
prompt_loader.py — Centralized Prompt Management Utility

Provides functions to load, combine, and manage agent instruction files
stored as Markdown in the `backend/prompts/` directory.

Architecture:
  - Master prompt (master.md) contains global system rules
  - Agent-specific prompts ({agent_name}.md) contain per-agent instructions
  - Combined prompt = Master + Separator + Agent-specific

Usage:
  from prompt_loader import get_agent_prompt, list_prompt_files, read_prompt_file, write_prompt_file

  system_prompt = get_agent_prompt("planner_agent")
"""

import logging
import os
from pathlib import Path

logger = logging.getLogger("prompt_loader")

# ─── Configuration ──────────────────────────────────────

PROMPTS_DIR = Path(__file__).parent / "prompts"

SEPARATOR = """

---

# Agent-Specific Instructions

The following instructions are specific to your role and override any conflicting guidance above.

---

"""

# ─── Fallback Defaults ──────────────────────────────────
# Used when .md files are missing (startup safety net)

_FALLBACK_MASTER = """# ZTAMP — Master System Architecture
You are part of ZTAMP — a multi-agent cloud infrastructure orchestration engine.
Follow all standard operating procedures for workflow design and execution.
"""

_FALLBACK_PROMPTS: dict[str, str] = {
    "planner_agent": (
        "You are the Systems Architect. Design precise, step-by-step executable "
        "workflows using the defined block types. Output valid JSON only."
    ),
    "canvas_agent": (
        "You are the Canvas Agent. Transform Planner JSON into React Flow nodes, "
        "edges, and typed configs deterministically."
    ),
    "coding_agent": (
        "You are the Coding Agent. Generate executable Python code for each "
        "workflow block. Include all dependencies in requirements.txt."
    ),
}


# ─── Core Functions ─────────────────────────────────────

def _ensure_prompts_dir() -> None:
    """Create the prompts directory if it doesn't exist."""
    if not PROMPTS_DIR.exists():
        PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
        logger.info("Created prompts directory: %s", PROMPTS_DIR)


def get_agent_prompt(agent_name: str) -> str:
    """
    Load and combine the master prompt with the agent-specific prompt.

    Returns: Combined string of master + separator + agent instructions.

    Falls back to hardcoded defaults if files are missing.
    """
    _ensure_prompts_dir()

    # Load master prompt
    master_file = PROMPTS_DIR / "master.md"
    if master_file.exists():
        try:
            master_content = master_file.read_text(encoding="utf-8").strip()
            logger.debug("Loaded master prompt (%d chars)", len(master_content))
        except Exception as e:
            logger.warning("Failed to read master.md: %s — using fallback", e)
            master_content = _FALLBACK_MASTER
    else:
        logger.warning("master.md not found — using fallback default")
        master_content = _FALLBACK_MASTER

    # Load agent-specific prompt
    agent_file = PROMPTS_DIR / f"{agent_name}.md"
    if agent_file.exists():
        try:
            agent_content = agent_file.read_text(encoding="utf-8").strip()
            logger.debug(
                "Loaded %s prompt (%d chars)", agent_name, len(agent_content)
            )
        except Exception as e:
            logger.warning(
                "Failed to read %s.md: %s — using fallback", agent_name, e
            )
            agent_content = _FALLBACK_PROMPTS.get(agent_name, "")
    else:
        logger.warning(
            "%s.md not found — using fallback default", agent_name
        )
        agent_content = _FALLBACK_PROMPTS.get(agent_name, "")

    # Combine
    combined = master_content + SEPARATOR + agent_content

    logger.info(
        "Loaded prompt for '%s': %d chars (master=%d, agent=%d)",
        agent_name,
        len(combined),
        len(master_content),
        len(agent_content),
    )

    return combined


def list_prompt_files() -> list[dict[str, str | int]]:
    """
    List all .md files in the prompts directory.

    Returns a list of dicts with:
      - filename: str
      - size_bytes: int
      - last_modified: str (ISO 8601)
    """
    _ensure_prompts_dir()

    files = []
    for f in sorted(PROMPTS_DIR.iterdir()):
        if f.suffix == ".md" and f.is_file():
            stat = f.stat()
            files.append({
                "filename": f.name,
                "size_bytes": stat.st_size,
                "last_modified": (
                    __import__("datetime")
                    .datetime.fromtimestamp(stat.st_mtime)
                    .isoformat()
                ),
            })

    return files


def read_prompt_file(filename: str) -> str:
    """
    Read the raw content of a prompt file.

    Args:
        filename: The .md filename (e.g., "master.md", "planner_agent.md")

    Returns:
        The file content as a string.

    Raises:
        FileNotFoundError: If the file doesn't exist.
        ValueError: If the filename is invalid.
    """
    _ensure_prompts_dir()
    _validate_filename(filename)

    file_path = PROMPTS_DIR / filename
    if not file_path.exists():
        raise FileNotFoundError(f"Prompt file not found: {filename}")

    return file_path.read_text(encoding="utf-8")


def write_prompt_file(filename: str, content: str) -> dict[str, str | int]:
    """
    Write content to a prompt file.

    Args:
        filename: The .md filename (e.g., "planner_agent.md")
        content: The new file content.

    Returns:
        Dict with filename, size_bytes, and last_modified.

    Raises:
        ValueError: If the filename is invalid.
    """
    _ensure_prompts_dir()
    _validate_filename(filename)

    file_path = PROMPTS_DIR / filename
    file_path.write_text(content, encoding="utf-8")

    stat = file_path.stat()
    logger.info(
        "Updated prompt file '%s' (%d bytes)", filename, stat.st_size
    )

    return {
        "filename": filename,
        "size_bytes": stat.st_size,
        "last_modified": (
            __import__("datetime")
            .datetime.fromtimestamp(stat.st_mtime)
            .isoformat()
        ),
    }


def _validate_filename(filename: str) -> None:
    """
    Validate that the filename is safe and ends with .md.

    Raises ValueError for invalid filenames.
    """
    if not filename.endswith(".md"):
        raise ValueError(f"Only .md files are allowed, got: {filename}")

    # Prevent path traversal
    if ".." in filename or "/" in filename or "\\" in filename:
        raise ValueError(f"Invalid filename (path traversal detected): {filename}")

    # Ensure it's a simple filename
    if filename != os.path.basename(filename):
        raise ValueError(f"Invalid filename: {filename}")
