"""
canvas_agent.py — The Canvas Agent (v2: Smart Block Decomposition)

━━━━━━━━ STOCHASTIC-DETERMINISTIC GAP PLATFORM ━━━━━━━━━━

Core philosophy: Enterprises cannot trust LLMs to autonomously execute
tasks because results vary between runs. This platform translates
AI-planned workflows into DETERMINISTIC Python code.

Each block on the canvas IS the specification. The Coding Agent
(Qwen 2.5 Coder 7B) will later read each block's configuration
and generate Python code that, once tested, produces repeatable
results — unlike an LLM that may vary on every call.

Block = Specification → Coding Agent → Python Code → Temporal Execution

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Architecture: The Canvas Agent is the SOLE owner of block-level workflow
design. The Planner Agent only gathers three pillars (Input, Task, Output)
and hands them off.

Responsibility split:
  Planner Agent → gathers Input, Task, Output (lightweight, LLM-powered)
  Canvas Agent  → decomposes pillars into blocks (deterministic, no LLM)
  Coding Agent  → reads each block's config and generates Python (future)

Design principle: "Planner gathers WHAT. Canvas decides HOW.
                   Coder makes it DETERMINISTIC."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IMPORTANT: No separate Code Blocks are created.

  The Action Block carries BOTH the input sources AND the task
  instructions. The Coding Agent will read the Action Block's
  config and generate code that:
    1. Loads the context sources (files)
    2. Executes the task instructions
    3. Passes results to the next block

  Similarly, the Result Block and Notification Block each carry
  their own specifications — the Coding Agent generates code for
  each independently.

  Flow: Action → [Result] → [Notify]
  NOT:  Action → Code → Result → Notify  (WRONG: redundant Code block)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Output Decomposition Engine:
  "Export to Excel" → [Result Block (Excel)]
  "Send email to x@y.com" → [Notify Block (Email, x@y.com)]
  "Export to Excel and email to x@y.com"
    → [Result Block (Excel)] → [Notify Block (Email, x@y.com, attach Excel)]

A2UI Protocol Compliance (v0.8):
  - surfaceUpdate, dataModelUpdate, beginRendering

Block Type Catalog:
  - ActionNode      — Data gathering + task instructions (INPUT + TASK)
  - ConditionalNode — Decision/branching logic
  - ResultNode      — Output generation (PDF, Excel, CSV, etc.)
  - NotifyNode      — Notifications (email, Slack, PagerDuty)
  - CodeNode        — Custom code execution (manual use only)
  - ParamNode       — Parameter/variable definitions
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger("canvas_agent")


# ─── A2UI Component Catalog ─────────────────────────────

BLOCK_CATALOG = {
    "action": {
        "nodeType": "actionNode",
        "toolbarLabel": "Action",
        "icon": "search",
        "color": "#3b82f6",  # Blue
        "defaultLabel": "Action Block",
        "description": "Gathers context via RAG retrieval or research",
    },
    "conditional": {
        "nodeType": "conditionalNode",
        "toolbarLabel": "Conditional",
        "icon": "call_split",
        "color": "#eab308",  # Yellow
        "defaultLabel": "Condition",
        "description": "Branches workflow based on conditions",
    },
    "result": {
        "nodeType": "resultNode",
        "toolbarLabel": "Result",
        "icon": "description",
        "color": "#22c55e",  # Green
        "defaultLabel": "Result Output",
        "description": "Generates output in specified format",
    },
    "notification": {
        "nodeType": "notifyNode",
        "toolbarLabel": "Notify",
        "icon": "notifications",
        "color": "#a855f7",  # Purple
        "defaultLabel": "Notification",
        "description": "Sends notifications via email, Slack, etc.",
    },
    "code": {
        "nodeType": "codeNode",
        "toolbarLabel": "Code",
        "icon": "terminal",
        "color": "#6b7280",  # Grey
        "defaultLabel": "Code Block",
        "description": "Executes custom code for data processing",
    },
    "parameter": {
        "nodeType": "paramNode",
        "toolbarLabel": "Param",
        "icon": "tune",
        "color": "#f97316",  # Orange
        "defaultLabel": "Parameter",
        "description": "Defines input parameters for the workflow",
    },
}

# Keywords for step type scoring (used only for planner-generated steps)
STEP_TYPE_KEYWORDS = {
    "action": [
        "search", "find", "lookup", "query", "fetch", "retrieve",
        "gather", "research", "read", "load", "import", "ingest",
        "scan", "discover", "access", "connect", "context",
        "analyze", "examine", "inspect", "review",
    ],
    "conditional": [
        "if", "condition", "check", "verify", "validate",
        "compare", "decide", "branch", "switch", "filter",
        "threshold", "above", "below", "equal", "match",
        "greater", "less", "when", "unless",
    ],
    "result": [
        "save", "export", "output", "generate", "create",
        "produce", "write", "format", "render", "compile",
        "pdf", "excel", "csv", "json", "report", "document",
        "file", "store", "persist",
    ],
    "notification": [
        "email", "notify", "alert", "send", "message",
        "slack", "teams", "pagerduty", "webhook",
        "notification", "mail", "sms", "broadcast",
    ],
    "code": [
        "calculate", "compute", "transform", "process",
        "script", "execute", "run", "code", "function",
        "algorithm", "formula", "math", "aggregate",
        "sum", "average", "count", "total", "parse",
    ],
    "parameter": [
        "parameter", "variable", "input", "config",
        "setting", "option", "argument", "value",
        "define", "set", "specify", "configure",
    ],
}


# ─── Output Decomposition Engine ─────────────────────────
# This is the core innovation: deterministic parsing of the
# Output pillar into one or more output blocks.

@dataclass
class OutputBlock:
    """A single decomposed output action."""
    block_type: str             # "result" or "notification"
    label: str                  # Human-readable label
    description: str            # Detailed description
    format: Optional[str] = None       # e.g. "Excel", "PDF", "CSV"
    service: Optional[str] = None      # e.g. "Email", "Slack"
    recipient: Optional[str] = None    # e.g. "user@example.com"
    attachment: Optional[str] = None   # Reference to what to attach
    destination: Optional[str] = None  # e.g. "working directory"


def decompose_output(output_text: str) -> list[OutputBlock]:
    """
    Decompose the Output pillar text into one or more OutputBlocks.

    This is a deterministic parser — no LLM needed.

    Examples:
        "Export to Excel"
          → [OutputBlock(result, Excel)]

        "Send email to user@x.com"
          → [OutputBlock(notification, Email, user@x.com)]

        "Export to Excel and send email to user@x.com"
          → [OutputBlock(result, Excel),
             OutputBlock(notification, Email, user@x.com, attach=Excel)]

        "Save as PDF in working directory"
          → [OutputBlock(result, PDF, destination=working directory)]

        "Send as Excel file via email to user@x.com"
          → [OutputBlock(result, Excel),
             OutputBlock(notification, Email, user@x.com, attach=Excel)]
    """
    if not output_text:
        return []

    lower = output_text.lower().strip()
    blocks: list[OutputBlock] = []

    # ── Detect output format ──
    format_keywords = {
        "excel": "Excel", "xlsx": "Excel", "xls": "Excel",
        "pdf": "PDF",
        "csv": "CSV",
        "json": "JSON",
        "report": "Report",
        "document": "Document",
        "docx": "Document", "doc": "Document",
        "pptx": "Presentation", "ppt": "Presentation",
    }
    detected_format = None
    for kw, fmt in format_keywords.items():
        if kw in lower:
            detected_format = fmt
            break

    # ── Detect notification service ──
    service_keywords = {
        "email": "Email", "mail": "Email", "e-mail": "Email",
        "slack": "Slack",
        "teams": "Microsoft Teams",
        "pagerduty": "PagerDuty",
        "sms": "SMS",
        "webhook": "Webhook",
    }
    detected_service = None
    for kw, svc in service_keywords.items():
        if kw in lower:
            detected_service = svc
            break

    # ── Detect email address ──
    email_matches = re.findall(r'[\w.+-]+@[\w-]+\.[\w.]+', output_text)
    detected_email = email_matches[0] if email_matches else None

    # ── Detect destination ──
    dest_match = re.search(
        r'(?:in the |in a |to the |to a |into |in )'
        r'(same (?:working )?directory|same folder|current folder|'
        r'working directory|desktop|downloads?|'
        r'specific (?:folder|directory|location)|'
        r'[\w/\\.]+(?:folder|directory))',
        lower
    )
    detected_dest = dest_match.group(1) if dest_match else None

    # ── Decision logic ──
    has_export = detected_format is not None
    has_notify = detected_service is not None or detected_email is not None

    if has_export and has_notify:
        # BOTH: Result Block → Notification Block (with attachment)
        # e.g. "Export to Excel and email to user@x.com"
        result_label = f"Export to {detected_format}"
        blocks.append(OutputBlock(
            block_type="result",
            label=result_label,
            description=f"Generate the output as {detected_format} format",
            format=detected_format,
            destination=detected_dest,
        ))

        service = detected_service or "Email"
        recipient = detected_email or ""
        notify_label = f"Send {detected_format} via {service}"
        blocks.append(OutputBlock(
            block_type="notification",
            label=notify_label,
            description=(
                f"Send the {detected_format} file via {service}"
                + (f" to {recipient}" if recipient else "")
                + f". Attach the {detected_format} output from the previous step."
            ),
            service=service,
            recipient=recipient,
            attachment=f"{detected_format} output",
        ))

    elif has_export:
        # EXPORT ONLY: Result Block
        # e.g. "Save as PDF"
        result_label = f"Export to {detected_format}"
        blocks.append(OutputBlock(
            block_type="result",
            label=result_label,
            description=(
                f"Generate the output as {detected_format} format"
                + (f" and save to {detected_dest}" if detected_dest else "")
            ),
            format=detected_format,
            destination=detected_dest,
        ))

    elif has_notify:
        # NOTIFY ONLY: Notification Block
        # e.g. "Send email to user@x.com"
        service = detected_service or "Email"
        recipient = detected_email or ""
        notify_label = f"Send via {service}"
        blocks.append(OutputBlock(
            block_type="notification",
            label=notify_label,
            description=(
                f"Send the results via {service}"
                + (f" to {recipient}" if recipient else "")
            ),
            service=service,
            recipient=recipient,
        ))

    else:
        # FALLBACK: generic result block
        blocks.append(OutputBlock(
            block_type="result",
            label="Generate Output",
            description=output_text,
        ))

    return blocks


# ─── Task Decomposition Engine ────────────────────────────

@dataclass
class TaskBlock:
    """A single decomposed task step."""
    block_type: str       # "action", "code", "conditional"
    label: str
    description: str
    task_instructions: str = ""

    # Code-specific
    code_hint: str = ""
    libraries: list[str] = field(default_factory=list)

    # Conditional-specific
    condition_field: str = ""
    condition_operator: str = ""
    condition_value: str = ""


def decompose_task(task_text: str) -> list[TaskBlock]:
    """
    Decompose the Task pillar into one or more processing blocks.

    For now, most tasks are single Code blocks. Later, this can be
    extended to detect multi-step tasks.

    Examples:
        "Find the Price column and calculate the total"
          → [TaskBlock(code, "Calculate Total Price", ...)]

        "Analyze Q4 revenue and compare with Q3"
          → [TaskBlock(code, "Analyze Q4 Revenue", ...),
             TaskBlock(code, "Compare Q4 vs Q3", ...)]
    """
    if not task_text:
        return [TaskBlock(
            block_type="code",
            label="Process Data",
            description="Process the input data",
        )]

    lower = task_text.lower()
    blocks: list[TaskBlock] = []

    # Detect if the task has multiple sub-tasks separated by "and", "then"
    # For now, keep it as a single block with the full description
    # (multi-step decomposition can be added later)

    # Detect task nature for block type selection
    is_analysis = any(w in lower for w in [
        "analyze", "analyse", "compare", "trend", "pattern",
        "calculate", "compute", "aggregate", "sum", "average",
        "statistics", "correlation",
    ])

    is_extraction = any(w in lower for w in [
        "extract", "gather", "collect", "get", "find",
        "identify", "read", "parse", "pull",
    ])

    is_transformation = any(w in lower for w in [
        "transform", "convert", "format", "clean",
        "normalize", "merge", "join", "combine",
    ])

    # Generate a clear label from the task text
    label = task_text.strip()
    if len(label) > 50:
        # Truncate to first sentence or 50 chars
        first_sentence = re.split(r'[.,;]', label)[0].strip()
        label = first_sentence if len(first_sentence) <= 60 else first_sentence[:57] + "..."

    # Determine libraries based on task keywords
    libraries = []
    if any(w in lower for w in ["excel", "xlsx", "csv", "data", "column", "row", "dataframe"]):
        libraries.append("pandas")
    if any(w in lower for w in ["calculate", "compute", "math", "statistics", "average"]):
        libraries.append("numpy")
    if any(w in lower for w in ["chart", "plot", "graph", "visualize"]):
        libraries.append("matplotlib")
    if any(w in lower for w in ["pdf", "document"]):
        libraries.append("PyPDF2")
    if any(w in lower for w in ["json", "api"]):
        libraries.append("json")

    block_type = "code"
    if is_extraction and not is_analysis:
        block_type = "code"  # Still code, but with extraction focus

    blocks.append(TaskBlock(
        block_type=block_type,
        label=label,
        description=task_text,
        task_instructions=task_text,
        libraries=libraries or ["pandas"],
    ))

    return blocks


# ─── Canvas Response ─────────────────────────────────────

@dataclass
class CanvasResponse:
    """Response from the Canvas Agent to the frontend."""
    success: bool
    message: str

    # A2UI protocol payload
    a2ui_messages: list[dict[str, Any]] = field(default_factory=list)

    # Native React Flow payload for direct rendering
    nodes: list[dict[str, Any]] = field(default_factory=list)
    edges: list[dict[str, Any]] = field(default_factory=list)
    node_configs: dict[str, dict[str, Any]] = field(default_factory=dict)

    # Workflow metadata
    workflow_name: str = ""
    workflow_description: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "message": self.message,
            "a2ui_messages": self.a2ui_messages,
            "nodes": self.nodes,
            "edges": self.edges,
            "node_configs": self.node_configs,
            "workflow_name": self.workflow_name,
            "workflow_description": self.workflow_description,
        }


# ─── Canvas Agent ─────────────────────────────────────────

class CanvasAgent:
    """
    Translates the Planner Agent's three pillars into canvas blocks.

    v2 Architecture:
      Instead of relying on the Planner to generate steps,
      the Canvas Agent DECOMPOSES the pillars itself:

      1. INPUT pillar → Action Block (context sources + task instructions)
      2. TASK pillar  → Code/Processing Block(s) (deterministic decomposition)
      3. OUTPUT pillar → Result Block + Notification Block (parsed from text)

      The blocks are connected in a linear flow by default.

    This is all deterministic (no LLM) — zero GPU cost.
    """

    # ── Layout configuration ──
    HORIZONTAL_SPACING = 240
    VERTICAL_SPACING = 150
    START_X = 80
    START_Y = 80

    def __init__(self):
        logger.info("CanvasAgent v2 initialized (smart block decomposition)")

    def generate_workflow(
        self,
        workflow_plan: dict[str, Any],
        current_parameters: Optional[dict[str, Any]] = None,
        attached_files: Optional[list[str]] = None,
    ) -> CanvasResponse:
        """
        Main entry point: convert the planner's output into canvas blocks.

        NEW IN v2: The Canvas Agent now handles block decomposition itself.
        It can work with EITHER:
          a) A simple `current_parameters` dict with input/task/output
          b) A full `workflow_plan` with steps (backward compatible)

        For case (a), it uses the decomposition engines.
        For case (b), it falls back to the legacy step-mapping logic.
        """
        try:
            goal = workflow_plan.get("goal", "Untitled Workflow")
            steps = workflow_plan.get("steps", [])
            extracted_params = workflow_plan.get("extracted_parameters", {})
            params = current_parameters or {}

            # ── Utility: strip internal pillar metadata from values ──
            def _clean_param(val: str) -> str:
                if not val:
                    return val
                cleaned = val.strip()
                cleaned = re.sub(r'^[✓✗~]\s*', '', cleaned)
                cleaned = re.sub(r'^(?:INPUT|TASK|OUTPUT)\s*:\s*', '', cleaned, flags=re.IGNORECASE)
                cleaned = re.sub(r'\s*\[(?:SET at turn \d+|MISSING.*?)\]\s*$', '', cleaned)
                return cleaned.strip()

            # ── Smart decomposition: build blocks from three pillars ──
            # This is the new path — the Canvas Agent creates the blocks
            input_text = _clean_param(str(params.get("input", "")))
            task_text = _clean_param(str(params.get("task", "")))
            output_text = _clean_param(str(params.get("output", "")))

            logger.info(
                "Generating workflow: '%s' | Input='%s' | Task='%s' | Output='%s'",
                goal, input_text[:50], task_text[:50], output_text[:50],
            )

            # Decompose the three pillars into blocks
            decomposed_steps = self._decompose_pillars(
                input_text=input_text,
                task_text=task_text,
                output_text=output_text,
                planner_steps=steps,
                attached_files=attached_files or [],
            )

            if not decomposed_steps:
                return CanvasResponse(
                    success=False,
                    message="Could not decompose the workflow into blocks.",
                )

            # Layout the blocks
            positioned_steps = self._layout_nodes(decomposed_steps)

            # Generate React Flow nodes + edges + configs
            rf_nodes, rf_edges, rf_configs = self._generate_react_flow(
                positioned_steps,
                current_parameters,
                extracted_params,
                attached_files or [],
            )

            # Generate A2UI protocol messages
            a2ui_messages = self._generate_a2ui_messages(
                positioned_steps, goal
            )

            block_summary = ", ".join(
                f"{s['label']} ({s['resolved_type']})" for s in decomposed_steps
            )
            logger.info("Workflow decomposed: %s", block_summary)

            return CanvasResponse(
                success=True,
                message=f"Workflow '{goal}' created with {len(rf_nodes)} blocks.",
                a2ui_messages=a2ui_messages,
                nodes=rf_nodes,
                edges=rf_edges,
                node_configs=rf_configs,
                workflow_name=goal,
                workflow_description=self._build_description(current_parameters),
            )

        except Exception as e:
            logger.error(f"Failed to generate workflow: {e}", exc_info=True)
            return CanvasResponse(
                success=False,
                message=f"Failed to generate workflow: {str(e)}",
            )

    # ── Pillar Decomposition Engine ───────────────────────

    def _decompose_pillars(
        self,
        input_text: str,
        task_text: str,
        output_text: str,
        planner_steps: list[dict],
        attached_files: list[str],
    ) -> list[dict[str, Any]]:
        """
        Decompose the three pillars into a flat list of blocks.

        FLOW: Action → [Conditional?] → Result → [Notify?]

        Key design decision:
          The Task pillar is MERGED into the Action Block.
          Each block is a SPECIFICATION that the Coding Agent
          (Qwen 2.5) will later convert to deterministic Python.

          Action Block = Input (context sources) + Task (instructions)
          Result Block = Output format/destination
          Notify Block = Notification service/recipient/attachment

          NO separate Code Blocks are created — every block already
          carries the information the Coding Agent needs.
        """
        blocks: list[dict[str, Any]] = []
        step_idx = 0

        # ── Detect required libraries from the task text ──
        task_lower = task_text.lower() if task_text else ""
        libraries = []
        if any(w in task_lower for w in ["excel", "xlsx", "csv", "data", "column", "row"]):
            libraries.append("pandas")
        if any(w in task_lower for w in ["calculate", "compute", "math", "statistics"]):
            libraries.append("numpy")
        if any(w in task_lower for w in ["chart", "plot", "graph", "visualize"]):
            libraries.append("matplotlib")
        if any(w in task_lower for w in ["pdf", "document"]):
            libraries.append("PyPDF2")
        if any(w in task_lower for w in ["json", "api"]):
            libraries.append("json")

        # ── 1. ACTION BLOCK (always first) ──
        # Carries BOTH Input (context sources) AND Task (instructions).
        # This is the primary specification block for the Coding Agent.
        action_label = "Gather Data"
        if attached_files:
            file_names = ", ".join(attached_files)
            action_label = f"Load {file_names}"
            if len(action_label) > 50:
                action_label = f"Load {len(attached_files)} File(s)"
        elif input_text:
            action_label = input_text[:50].strip()
            if len(input_text) > 50:
                action_label = action_label[:47] + "..."

        blocks.append({
            "id": f"step_{step_idx}",
            "resolved_type": "action",
            "node_type": BLOCK_CATALOG["action"]["nodeType"],
            "toolbar_label": BLOCK_CATALOG["action"]["toolbarLabel"],
            "icon": BLOCK_CATALOG["action"]["icon"],
            "color": BLOCK_CATALOG["action"]["color"],
            "label": action_label,
            "description": (
                f"Gather and load data from: {input_text or 'user input'}"
                + (f"\nFiles: {', '.join(attached_files)}" if attached_files else "")
            ),
            "type": "action",
            "config": {},
            "index": step_idx,
            # This block carries BOTH pillars: input + task
            "_pillar": "input+task",
            "_context_sources": attached_files[:],
            "_task_instructions": task_text,
            "_libraries": libraries or ["pandas"],
        })
        step_idx += 1

        # ── 2. CONDITIONAL BLOCKS (only if explicitly requested) ──
        # Only planner-provided conditional or parameter steps survive
        # as their own blocks. Code/processing steps are NOT created
        # because the Action Block already carries the task spec.
        if planner_steps:
            for step in planner_steps:
                step_type = step.get("type", "").lower().strip()
                matched = self._match_planner_type(step_type)
                # Only create blocks for conditionals and parameters
                # — NOT for code/action/result/notification (handled elsewhere)
                if matched in ("conditional", "parameter"):
                    catalog = BLOCK_CATALOG[matched]
                    blocks.append({
                        **step,
                        "id": step.get("id", f"step_{step_idx}"),
                        "resolved_type": matched,
                        "node_type": catalog["nodeType"],
                        "toolbar_label": catalog["toolbarLabel"],
                        "icon": catalog["icon"],
                        "color": catalog["color"],
                        "index": step_idx,
                        "_pillar": "task",
                    })
                    step_idx += 1

        # ── 3. OUTPUT BLOCK(S) from Output pillar ──
        # Parse "Export to Excel and email to x@y.com" into
        # separate Result + Notify blocks deterministically.
        output_blocks = decompose_output(output_text)
        for ob in output_blocks:
            catalog = BLOCK_CATALOG[ob.block_type]
            blocks.append({
                "id": f"step_{step_idx}",
                "resolved_type": ob.block_type,
                "node_type": catalog["nodeType"],
                "toolbar_label": catalog["toolbarLabel"],
                "icon": catalog["icon"],
                "color": catalog["color"],
                "label": ob.label,
                "description": ob.description,
                "type": ob.block_type,
                "config": {},
                "index": step_idx,
                "_pillar": "output",
                "_output_format": ob.format,
                "_service": ob.service,
                "_recipient": ob.recipient,
                "_attachment": ob.attachment,
                "_destination": ob.destination,
            })
            step_idx += 1

        logger.info(
            "Decomposed %d blocks from pillars: %s",
            len(blocks),
            " → ".join(f"{b['label']} ({b['resolved_type']})" for b in blocks),
        )

        return blocks

    # ── Step matching (backward compatible) ──────────────

    def _match_planner_type(self, step_type: str) -> Optional[str]:
        """Match the planner's step type to our block catalog."""
        direct_map = {
            "context": "action", "action": "action",
            "conditional": "conditional", "condition": "conditional",
            "result": "result", "output": "result",
            "notification": "notification", "notify": "notification",
            "code": "code",
            "parameter": "parameter", "param": "parameter",
        }
        for part in step_type.split("|"):
            part = part.strip()
            if part in direct_map:
                return direct_map[part]
        return None

    def _score_keywords(self, text: str) -> Optional[str]:
        """Score text against keyword lists to find the best block type."""
        scores: dict[str, int] = {}
        for block_type, keywords in STEP_TYPE_KEYWORDS.items():
            score = sum(1 for kw in keywords if kw in text)
            if score > 0:
                scores[block_type] = score
        if scores:
            return max(scores, key=scores.get)  # type: ignore
        return None

    # ── Layout algorithm ─────────────────────────────────

    def _layout_nodes(
        self, steps: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Calculate node positions using a left-to-right flow layout."""
        positioned = []
        for i, step in enumerate(steps):
            x = self.START_X + (i * self.HORIZONTAL_SPACING)
            y = self.START_Y

            if step["resolved_type"] == "conditional":
                y = self.START_Y
            elif i > 0 and positioned[i - 1]["resolved_type"] == "conditional":
                y = self.START_Y + self.VERTICAL_SPACING // 2

            positioned.append({
                **step,
                "position": {"x": x, "y": y},
            })
        return positioned

    # ── Generate React Flow payload ──────────────────────

    def _generate_react_flow(
        self,
        steps: list[dict[str, Any]],
        current_parameters: Optional[dict[str, Any]],
        extracted_params: dict[str, Any],
        attached_files: list[str],
    ) -> tuple[list[dict], list[dict], dict[str, dict]]:
        """Generate React Flow nodes, edges, and configs."""
        nodes = []
        edges = []
        configs = {}
        node_id_counter = 200

        # Pre-generate node IDs and labels for flow description lookup
        step_node_labels: list[tuple[str, str]] = []
        temp_counter = node_id_counter
        for step in steps:
            nid = f"node-{temp_counter}"
            step_node_labels.append((nid, step.get("label", "Step")))
            temp_counter += 1

        for idx, step in enumerate(steps):
            node_id = step_node_labels[idx][0]

            # Create the React Flow node
            node = {
                "id": node_id,
                "type": step["node_type"],
                "position": step["position"],
                "data": {
                    "label": step.get("label", step.get("resolved_type", "Step")),
                    "subLabel": step.get("description", "")[:60],
                },
            }
            nodes.append(node)

            # Create the node config
            config = self._build_node_config(
                node_id, step, current_parameters,
                extracted_params, attached_files,
                idx, step_node_labels,
            )
            configs[node_id] = config

        # Create edges
        for i in range(len(nodes) - 1):
            edge = {
                "id": f"edge-{nodes[i]['id']}-{nodes[i + 1]['id']}",
                "source": nodes[i]["id"],
                "target": nodes[i + 1]["id"],
                "type": "smoothstep",
                "animated": True,
            }
            edges.append(edge)

        return nodes, edges, configs

    def _build_node_config(
        self,
        node_id: str,
        step: dict[str, Any],
        current_parameters: Optional[dict[str, Any]],
        extracted_params: dict[str, Any],
        attached_files: list[str],
        step_index: int,
        all_step_labels: list[tuple[str, str]],
    ) -> dict[str, Any]:
        """
        Build a NodeConfig for a given step.

        v2 enhancements:
        - Uses decomposition metadata (_pillar, _output_format, etc.)
        - Result blocks know their exact format
        - Notification blocks know recipient, service, and attachment
        """
        block_type = step["resolved_type"]
        label = step.get("label", "")
        description = step.get("description", "")
        step_config = step.get("config", {})
        total_steps = len(all_step_labels)

        # ── Flow-aware Input/Output descriptions ──
        if step_index == 0:
            input_desc = "⬤ Start Block — Workflow begins here"
        else:
            prev_label = all_step_labels[step_index - 1][1]
            input_desc = f"Receives from: {prev_label}"

        if step_index == total_steps - 1:
            output_desc = "⬤ End Block — Workflow completes here"
        else:
            next_label = all_step_labels[step_index + 1][1]
            output_desc = f"Passes to: {next_label}"

        config: dict[str, Any] = {
            "id": node_id,
            "label": label,
            "nodeType": step["node_type"],
            "subLabel": description[:60] if description else "",
            "description": description,
            "inputSchema": input_desc,
            "outputSchema": output_desc,
            "retryPolicy": {
                "enabled": False,
                "maxRetries": 3,
                "retryDelay": 5,
                "timeout": 30,
            },
            "code": "",
            "codeFile": "untitled.py",
            "timeout": 30,
            "retryOnFail": False,
        }

        # ── Type-specific configs using decomposition metadata ──

        if block_type == "action":
            context_sources: list[str] = step.get("_context_sources", [])
            if not context_sources and attached_files:
                context_sources = attached_files[:]
            if current_parameters:
                input_source = str(current_parameters.get("input", ""))
                if input_source and input_source not in context_sources:
                    context_sources.append(input_source)

            task_instructions = step.get("_task_instructions", description or label)

            config["contextConfig"] = {
                "contextSources": context_sources,
                "query": task_instructions,
            }

        elif block_type == "conditional":
            rules = []
            condition_field = step.get("_condition_field", "")
            if step_config:
                for key, val in step_config.items():
                    rules.append({
                        "id": f"rule-{len(rules) + 1}",
                        "field": key,
                        "operator": ">",
                        "value": str(val),
                        "branchLabel": "True",
                    })
            if not rules:
                rules = [{
                    "id": "rule-1",
                    "field": condition_field,
                    "operator": ">",
                    "value": "",
                    "branchLabel": "True",
                }]
            config["conditionalConfig"] = {
                "rules": rules,
                "defaultBranch": "Default",
            }

        elif block_type == "result":
            # v2: use the decomposed format from OutputBlock
            output_format = step.get("_output_format", None)
            if not output_format and current_parameters:
                out_str = str(current_parameters.get("output", "")).lower()
                if "excel" in out_str or "xlsx" in out_str:
                    output_format = "Excel"
                elif "csv" in out_str:
                    output_format = "CSV"
                elif "json" in out_str:
                    output_format = "JSON"
                elif "pdf" in out_str:
                    output_format = "PDF"
            output_format = output_format or "PDF"

            destination = step.get("_destination", "")

            config["resultConfig"] = {
                "outputFormat": output_format,
                "template": "",
                "destination": destination,
            }

        elif block_type == "notification":
            # v2: use the decomposed service/recipient from OutputBlock
            service = step.get("_service", "Email")
            recipient = step.get("_recipient", "")
            attachment = step.get("_attachment", "")

            if not service and current_parameters:
                out_str = str(current_parameters.get("output", "")).lower()
                if "slack" in out_str:
                    service = "Slack"
                elif "teams" in out_str:
                    service = "Microsoft Teams"
                else:
                    service = "Email"

            if not recipient and current_parameters:
                out_str = str(current_parameters.get("output", ""))
                email_match = re.findall(r'[\w.+-]+@[\w-]+\.[\w.]+', out_str)
                if email_match:
                    recipient = email_match[0]

            config["notificationConfig"] = {
                "service": service,
                "recipient": recipient,
                "messageTemplate": description,
                "attachment": attachment,
            }

        elif block_type == "code":
            libraries = step.get("_libraries", ["pandas"])
            task_instr = step.get("_task_instructions", description)
            config["codeConfig"] = {
                "code": f"# {task_instr}\n# Auto-generated by Canvas Agent\n",
                "codeFile": "workflow_step.py",
                "libraryImports": libraries,
            }

        elif block_type == "parameter":
            params = []
            if extracted_params:
                for name, value in extracted_params.items():
                    params.append({
                        "name": name,
                        "type": "string",
                        "defaultValue": str(value) if value else "",
                    })
            if not params:
                params = [{
                    "name": "input_param",
                    "type": "string",
                    "defaultValue": "",
                }]
            config["parameterConfig"] = {"parameters": params}

        return config

    # ── A2UI Protocol Messages ───────────────────────────

    def _generate_a2ui_messages(
        self,
        steps: list[dict[str, Any]],
        goal: str,
    ) -> list[dict[str, Any]]:
        """
        Generate A2UI protocol compliant messages.

        Message sequence:
        1. surfaceUpdate — registers all components
        2. dataModelUpdate — sets dynamic values
        3. beginRendering — tells the UI to render
        """
        messages = []
        components = []
        node_id_counter = 200

        for i, step in enumerate(steps):
            comp_id = f"node-{node_id_counter + i}"
            component = {
                "id": comp_id,
                "componentType": step["node_type"],
                "properties": {
                    "label": step.get("label", ""),
                    "subLabel": step.get("description", "")[:60],
                    "icon": step.get("icon", ""),
                    "color": step.get("color", ""),
                    "position": step.get("position", {"x": 0, "y": 0}),
                },
                "adjacentComponents": [],
            }

            # Connect to next component
            if i < len(steps) - 1:
                next_id = f"node-{node_id_counter + i + 1}"
                component["adjacentComponents"].append({
                    "targetId": next_id,
                    "relationship": "flows_to",
                })

            components.append(component)

        # 1. surfaceUpdate
        messages.append({
            "type": "surfaceUpdate",
            "surface": "canvas",
            "components": components,
            "metadata": {
                "workflowName": goal,
                "totalBlocks": len(components),
            },
        })

        # 2. dataModelUpdate
        data_updates = {}
        for i, step in enumerate(steps):
            comp_id = f"node-{node_id_counter + i}"
            data_updates[comp_id] = {
                "status": "configured",
                "blockType": step["resolved_type"],
                "pillar": step.get("_pillar", "unknown"),
            }

        messages.append({
            "type": "dataModelUpdate",
            "updates": data_updates,
        })

        # 3. beginRendering
        messages.append({
            "type": "beginRendering",
            "surface": "canvas",
        })

        return messages

    # ── Helpers ───────────────────────────────────────────

    def _build_description(
        self, current_parameters: Optional[dict[str, Any]]
    ) -> str:
        """Build a workflow description from parameters."""
        if not current_parameters:
            return ""

        parts = []
        if current_parameters.get("input"):
            parts.append(f"Input: {current_parameters['input']}")
        if current_parameters.get("task"):
            parts.append(f"Task: {current_parameters['task']}")
        if current_parameters.get("output"):
            parts.append(f"Output: {current_parameters['output']}")

        return " | ".join(parts)
