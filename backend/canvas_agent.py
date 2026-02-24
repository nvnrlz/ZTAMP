"""
canvas_agent.py — The Canvas Agent (v3: Planner-JSON Step Mapping)

━━━━━━━━ MULTI-AGENT ORCHESTRATION ENGINE ━━━━━━━━━━━━━━━━

Architecture:
  PlannerAgent (Llama 3.1 8B) → structured JSON workflow
  CanvasAgent  (deterministic) → React Flow nodes/edges + A2UI
  CodingAgent  (Qwen 2.5)     → Python code per block (future)

The Planner Agent now outputs a validated JSON containing:
  - intent, message_to_user
  - workflow_parameters: { floating: [...], fixed: [...] }
  - steps: [ { step_number, title, description, block_type, ... } ]

This Canvas Agent:
  1. Maps each planner step to the BLOCK_CATALOG React Flow component.
  2. Auto-injects ConditionalNodes after every action_block to check
     success/failure (defensive design — actions can fail by default).
  3. Generates branching edges (true/false) for ConditionalNodes.
  4. Builds node configs required by the .tsx components.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

A2UI Protocol Compliance (v0.8):
  - surfaceUpdate, dataModelUpdate, beginRendering

Block Type Catalog (matches PlannerAgent block_type field):
  action_block       → ActionNode      (blue)   — infrastructure actions
  conditional_block  → ConditionalNode (yellow) — branching / checks
  result_block       → ResultNode      (green)  — success/failure terminal
  notification_block → NotifyNode      (purple) — alerts / notifications
  code_block         → CodeNode        (grey)   — custom scripts
  parameter_block    → ParamNode       (orange) — parameter collection
"""

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger("canvas_agent")


# ─── A2UI Component Catalog ─────────────────────────────

BLOCK_CATALOG = {
    "action_block": {
        "nodeType": "actionNode",
        "toolbarLabel": "Action",
        "icon": "search",
        "color": "#3b82f6",
        "defaultLabel": "Action Block",
        "description": "Executes a concrete infrastructure action",
    },
    "conditional_block": {
        "nodeType": "conditionalNode",
        "toolbarLabel": "Conditional",
        "icon": "call_split",
        "color": "#eab308",
        "defaultLabel": "Condition",
        "description": "Branches workflow based on conditions",
    },
    "result_block": {
        "nodeType": "resultNode",
        "toolbarLabel": "Result",
        "icon": "description",
        "color": "#22c55e",
        "defaultLabel": "Result Output",
        "description": "Reports success or failure",
    },
    "notification_block": {
        "nodeType": "notifyNode",
        "toolbarLabel": "Notify",
        "icon": "notifications",
        "color": "#a855f7",
        "defaultLabel": "Notification",
        "description": "Sends notifications via email, Slack, etc.",
    },
    "code_block": {
        "nodeType": "codeNode",
        "toolbarLabel": "Code",
        "icon": "terminal",
        "color": "#6b7280",
        "defaultLabel": "Code Block",
        "description": "Executes custom code for data processing",
    },
    "parameter_block": {
        "nodeType": "paramNode",
        "toolbarLabel": "Param",
        "icon": "tune",
        "color": "#f97316",
        "defaultLabel": "Parameter",
        "description": "Defines input parameters for the workflow",
    },
}

# Backward-compatible aliases: map legacy Planner types to catalog keys
_BLOCK_TYPE_ALIASES = {
    "action": "action_block",
    "conditional": "conditional_block",
    "result": "result_block",
    "notification": "notification_block",
    "code": "code_block",
    "parameter": "parameter_block",
}


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
    Translates the PlannerAgent's structured JSON workflow into
    React Flow nodes, edges, and configs for canvas rendering.

    v3 Architecture:
      1. Parse Planner JSON step array directly.
      2. Auto-inject ConditionalNodes after every action_block
         (defensive: actions can fail by default).
      3. Generate branching edges for true/false paths.
      4. Build typed node configs for each .tsx component.

    All logic is deterministic — zero LLM cost.
    """

    # ── Layout configuration ──
    HORIZONTAL_SPACING = 240
    VERTICAL_SPACING = 160
    ERROR_ROW_OFFSET = 180   # Y-offset for error/false-branch nodes
    START_X = 80
    START_Y = 80

    def __init__(self):
        logger.info("CanvasAgent v3 initialized (planner-JSON step mapping)")

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # Main entry point
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def generate_workflow(
        self,
        workflow_plan: dict[str, Any],
        current_parameters: Optional[dict[str, Any]] = None,
        attached_files: Optional[list[str]] = None,
    ) -> CanvasResponse:
        """
        Convert the PlannerAgent's JSON output into canvas blocks.

        Expected workflow_plan keys:
          - message_to_user: str
          - intent: "action" | "question" | "clarification"
          - workflow_parameters: { floating: [...], fixed: [...] }
          - steps: [ { step_number, title, description, block_type, ... } ]
        """
        try:
            steps = workflow_plan.get("steps", [])
            message = workflow_plan.get("message_to_user", "")
            intent = workflow_plan.get("intent", "question")
            params = workflow_plan.get("workflow_parameters", {})
            goal = workflow_plan.get("goal", message[:60] or "Untitled Workflow")

            if intent != "action" or not steps:
                return CanvasResponse(
                    success=False,
                    message=(
                        "No actionable workflow to render. "
                        "The Planner returned a non-action response."
                    ),
                )

            logger.info(
                "Generating workflow canvas: %d planner steps, intent=%s",
                len(steps), intent,
            )

            # ── Step 1: Map planner steps → Canvas blocks ──
            # This includes auto-injecting conditionals after action blocks.
            blocks = self._map_planner_steps_to_blocks(steps)

            if not blocks:
                return CanvasResponse(
                    success=False,
                    message="Could not map any planner steps to canvas blocks.",
                )

            # ── Step 2: Layout the blocks ──
            positioned = self._layout_nodes(blocks)

            # ── Step 3: Generate React Flow nodes + edges + configs ──
            rf_nodes, rf_edges, rf_configs = self._generate_react_flow(
                positioned, params, attached_files or [],
            )

            # ── Step 4: Generate A2UI protocol messages ──
            a2ui_messages = self._generate_a2ui_messages(positioned, goal)

            block_summary = " → ".join(
                f"{b['label']} ({b['block_type']})" for b in blocks
                if not b.get("_is_error_node")
            )
            logger.info("Workflow mapped: %s", block_summary)

            return CanvasResponse(
                success=True,
                message=f"Workflow created with {len(rf_nodes)} blocks.",
                a2ui_messages=a2ui_messages,
                nodes=rf_nodes,
                edges=rf_edges,
                node_configs=rf_configs,
                workflow_name=goal,
                workflow_description=message[:200],
            )

        except Exception as e:
            logger.error("Failed to generate workflow: %s", e, exc_info=True)
            return CanvasResponse(
                success=False,
                message=f"Failed to generate workflow: {str(e)}",
            )

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # Step 1: Map Planner Steps → Canvas Blocks
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def _map_planner_steps_to_blocks(
        self, planner_steps: list[dict],
    ) -> list[dict[str, Any]]:
        """
        Iterate through the PlannerAgent's JSON steps and map each to
        a BLOCK_CATALOG entry.

        AUTO-CONDITIONAL RULE:
          After every action_block, automatically inject:
            1. A ConditionalNode ("Check [Action] Success")
            2. A ResultNode for the false branch ("[Action] Failed")

          Exception: If the Planner JSON already provides a diagnostic
          or fallback step linked to the failure of that action (via
          on_false_step), route the false branch there instead.
        """
        blocks: list[dict[str, Any]] = []
        block_idx = 0

        # First pass: build a lookup of step_number → planner step
        step_lookup: dict[int, dict] = {}
        for ps in planner_steps:
            sn = ps.get("step_number")
            if sn is not None:
                step_lookup[sn] = ps

        for i, ps in enumerate(planner_steps):
            raw_type = ps.get("block_type", "action_block")
            block_type = _BLOCK_TYPE_ALIASES.get(raw_type, raw_type)

            # Validate against catalog
            if block_type not in BLOCK_CATALOG:
                logger.warning(
                    "Unknown block_type '%s' — defaulting to action_block",
                    block_type,
                )
                block_type = "action_block"

            catalog = BLOCK_CATALOG[block_type]
            block_id = f"block_{block_idx}"

            title = ps.get("title", catalog["defaultLabel"])
            description = ps.get("description", "")

            block: dict[str, Any] = {
                "id": block_id,
                "block_type": block_type,
                "node_type": catalog["nodeType"],
                "icon": catalog["icon"],
                "color": catalog["color"],
                "label": title,
                "description": description,
                "action_type": ps.get("action_type", ""),
                "parameters_used": ps.get("parameters_used", {"floating": [], "fixed": []}),
                "step_number": ps.get("step_number", i + 1),
                "index": block_idx,
                # Branching metadata (populated below for conditionals)
                "_next_on_true": None,
                "_next_on_false": None,
                "_is_error_node": False,
                "_is_auto_injected": False,
            }

            # For conditional blocks from the planner, preserve branching
            if block_type == "conditional_block":
                block["condition"] = ps.get("condition", "")
                block["_planner_on_true"] = ps.get("on_true_step")
                block["_planner_on_false"] = ps.get("on_false_step")

            blocks.append(block)
            block_idx += 1

            # ── AUTO-CONDITIONAL INJECTION ──
            # After every action_block, inject a check + error node
            if block_type == "action_block":
                action_label = title

                # Inject: ConditionalNode
                check_id = f"block_{block_idx}"
                check_block: dict[str, Any] = {
                    "id": check_id,
                    "block_type": "conditional_block",
                    "node_type": BLOCK_CATALOG["conditional_block"]["nodeType"],
                    "icon": BLOCK_CATALOG["conditional_block"]["icon"],
                    "color": BLOCK_CATALOG["conditional_block"]["color"],
                    "label": f"Check: {action_label[:30]}",
                    "description": f"Verify that '{action_label}' completed successfully.",
                    "action_type": "validate",
                    "parameters_used": {"floating": [], "fixed": []},
                    "step_number": None,  # synthetic
                    "index": block_idx,
                    "condition": f"{block_id}_success == true",
                    "_next_on_true": None,   # filled in wiring pass
                    "_next_on_false": None,  # filled in wiring pass
                    "_is_error_node": False,
                    "_is_auto_injected": True,
                    "_parent_action_id": block_id,
                }
                blocks.append(check_block)
                block_idx += 1

                # Inject: ResultNode (error terminal for false branch)
                error_id = f"block_{block_idx}"
                error_block: dict[str, Any] = {
                    "id": error_id,
                    "block_type": "result_block",
                    "node_type": BLOCK_CATALOG["result_block"]["nodeType"],
                    "icon": BLOCK_CATALOG["result_block"]["icon"],
                    "color": "#ef4444",  # Red for failure
                    "label": f"✗ {action_label[:25]} Failed",
                    "description": (
                        f"The action '{action_label}' did not complete successfully. "
                        "Review logs and retry or escalate."
                    ),
                    "action_type": "report",
                    "parameters_used": {"floating": [], "fixed": []},
                    "step_number": None,
                    "index": block_idx,
                    "_next_on_true": None,
                    "_next_on_false": None,
                    "_is_error_node": True,
                    "_is_auto_injected": True,
                }
                blocks.append(error_block)
                block_idx += 1

                # Wire: check_block true→ next mainline, false→ error_block
                check_block["_next_on_false"] = error_id
                # _next_on_true is resolved in the wiring pass below

        # ── Wiring pass: resolve _next_on_true / _next_on_false ──
        mainline_blocks = [b for b in blocks if not b.get("_is_error_node")]

        for idx, b in enumerate(mainline_blocks):
            if b["block_type"] == "conditional_block":
                # Find the next mainline block for the true branch
                if b["_next_on_true"] is None:
                    next_main_idx = idx + 1
                    if next_main_idx < len(mainline_blocks):
                        b["_next_on_true"] = mainline_blocks[next_main_idx]["id"]

                # For planner-provided conditionals, resolve on_true/on_false
                # by step_number lookup
                planner_true = b.get("_planner_on_true")
                planner_false = b.get("_planner_on_false")

                if planner_true is not None:
                    target = self._find_block_by_step_number(blocks, planner_true)
                    if target:
                        b["_next_on_true"] = target["id"]

                if planner_false is not None:
                    target = self._find_block_by_step_number(blocks, planner_false)
                    if target:
                        b["_next_on_false"] = target["id"]

                # Default false → error node if still unset
                if b["_next_on_false"] is None and b.get("_is_auto_injected"):
                    # Already set during injection
                    pass

        logger.info(
            "Mapped %d planner steps → %d canvas blocks "
            "(%d mainline, %d error nodes)",
            len(planner_steps), len(blocks),
            len(mainline_blocks),
            sum(1 for b in blocks if b.get("_is_error_node")),
        )

        return blocks

    @staticmethod
    def _find_block_by_step_number(
        blocks: list[dict], step_number: int
    ) -> Optional[dict]:
        """Find the first block matching a planner step_number."""
        for b in blocks:
            if b.get("step_number") == step_number and not b.get("_is_auto_injected"):
                return b
        return None

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # Step 2: Layout Algorithm
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def _layout_nodes(
        self, blocks: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """
        Calculate node positions.

        Mainline blocks flow left-to-right on row Y=START_Y.
        Error nodes (false-branch terminals) drop below their parent
        conditional at Y=START_Y + ERROR_ROW_OFFSET.
        """
        positioned = []
        main_col = 0  # Column index for mainline

        # Two-pass: first position mainline, then error nodes
        mainline_order: list[dict] = []
        error_nodes: list[dict] = []

        for b in blocks:
            if b.get("_is_error_node"):
                error_nodes.append(b)
            else:
                mainline_order.append(b)

        # Position mainline blocks
        id_to_position: dict[str, dict] = {}
        for b in mainline_order:
            x = self.START_X + (main_col * self.HORIZONTAL_SPACING)
            y = self.START_Y
            pos = {"x": x, "y": y}
            id_to_position[b["id"]] = pos
            positioned.append({**b, "position": pos})
            main_col += 1

        # Position error nodes below their parent conditional
        for eb in error_nodes:
            # Find the conditional that points to this error node
            parent_pos = None
            for b in blocks:
                if b.get("_next_on_false") == eb["id"]:
                    parent_pos = id_to_position.get(b["id"])
                    break

            if parent_pos:
                pos = {
                    "x": parent_pos["x"],
                    "y": parent_pos["y"] + self.ERROR_ROW_OFFSET,
                }
            else:
                pos = {
                    "x": self.START_X + (main_col * self.HORIZONTAL_SPACING),
                    "y": self.START_Y + self.ERROR_ROW_OFFSET,
                }
                main_col += 1

            id_to_position[eb["id"]] = pos
            positioned.append({**eb, "position": pos})

        return positioned

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # Step 3: React Flow Payload Generation
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def _generate_react_flow(
        self,
        blocks: list[dict[str, Any]],
        workflow_params: dict[str, Any],
        attached_files: list[str],
    ) -> tuple[list[dict], list[dict], dict[str, dict]]:
        """
        Generate React Flow nodes, edges, and configs.

        Edge generation supports branching:
        - ConditionalNodes emit two edges:
            True  → sourceHandle=None  (Right handle in ConditionalNode.tsx)
            False → sourceHandle='bottom' (Bottom handle in ConditionalNode.tsx)
        - All other nodes emit a single forward edge to the next mainline block.
        """
        nodes: list[dict] = []
        edges: list[dict] = []
        configs: dict[str, dict] = {}

        # Build block lookup by id
        block_by_id: dict[str, dict] = {b["id"]: b for b in blocks}

        # Separate mainline and error blocks for edge generation
        mainline = [b for b in blocks if not b.get("_is_error_node")]

        # ── Create nodes ──
        for b in blocks:
            node = {
                "id": b["id"],
                "type": b["node_type"],
                "position": b["position"],
                "data": {
                    "label": b.get("label", "Step"),
                    "subLabel": b.get("description", "")[:60],
                },
            }
            nodes.append(node)

            # Build config
            config = self._build_node_config(
                b, blocks, workflow_params, attached_files,
            )
            configs[b["id"]] = config

        # ── Create edges ──
        for idx, b in enumerate(mainline):
            if b["block_type"] == "conditional_block":
                # True branch → Right handle (default source)
                true_target = b.get("_next_on_true")
                if true_target and true_target in block_by_id:
                    edges.append({
                        "id": f"edge-{b['id']}-true-{true_target}",
                        "source": b["id"],
                        "target": true_target,
                        "type": "smoothstep",
                        "animated": True,
                        "label": "✓ True",
                        "style": {"stroke": "#22c55e"},
                    })

                # False branch → Bottom handle
                false_target = b.get("_next_on_false")
                if false_target and false_target in block_by_id:
                    edges.append({
                        "id": f"edge-{b['id']}-false-{false_target}",
                        "source": b["id"],
                        "sourceHandle": "bottom",
                        "target": false_target,
                        "targetHandle": "top",
                        "type": "smoothstep",
                        "animated": True,
                        "label": "✗ False",
                        "style": {"stroke": "#ef4444"},
                    })

            else:
                # Non-conditional: linear edge to next mainline block
                next_idx = idx + 1
                if next_idx < len(mainline):
                    next_block = mainline[next_idx]
                    edges.append({
                        "id": f"edge-{b['id']}-{next_block['id']}",
                        "source": b["id"],
                        "target": next_block["id"],
                        "type": "smoothstep",
                        "animated": True,
                    })

        return nodes, edges, configs

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # Step 4: Node Config Builder
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def _build_node_config(
        self,
        block: dict[str, Any],
        all_blocks: list[dict[str, Any]],
        workflow_params: dict[str, Any],
        attached_files: list[str],
    ) -> dict[str, Any]:
        """
        Build a NodeConfig for a given block.

        Populates the properties required by the React .tsx components:
          - label, subLabel, description, nodeType
          - Type-specific config sections (contextConfig, conditionalConfig, etc.)
        """
        block_type = block["block_type"]
        label = block.get("label", "")
        description = block.get("description", "")
        params_used = block.get("parameters_used", {"floating": [], "fixed": []})

        # ── Find neighbors for input/output descriptions ──
        mainline = [b for b in all_blocks if not b.get("_is_error_node")]
        mainline_ids = [b["id"] for b in mainline]
        my_idx = mainline_ids.index(block["id"]) if block["id"] in mainline_ids else -1

        if my_idx == 0 or my_idx == -1:
            input_desc = "⬤ Start — Workflow begins here"
        else:
            prev_label = mainline[my_idx - 1].get("label", "Previous")
            input_desc = f"Receives from: {prev_label}"

        if my_idx == len(mainline) - 1 or my_idx == -1:
            output_desc = "⬤ End — Workflow completes here"
        else:
            next_label = mainline[my_idx + 1].get("label", "Next")
            output_desc = f"Passes to: {next_label}"

        # For error nodes, override descriptions
        if block.get("_is_error_node"):
            input_desc = "⬤ Error Branch — action failed"
            output_desc = "⬤ Terminal — branch ends here"

        config: dict[str, Any] = {
            "id": block["id"],
            "label": label,
            "nodeType": block["node_type"],
            "subLabel": description[:60] if description else "",
            "description": description,
            "inputSchema": input_desc,
            "outputSchema": output_desc,
            "parametersUsed": params_used,
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

        # ── Type-specific configs ──

        if block_type == "action_block":
            floating_params = params_used.get("floating", [])
            fixed_params = params_used.get("fixed", [])

            # Build context sources from attached files and floating params
            context_sources = attached_files[:]
            config["contextConfig"] = {
                "contextSources": context_sources,
                "query": description or label,
                "floatingParameters": floating_params,
                "fixedParameters": fixed_params,
                "actionType": block.get("action_type", ""),
            }

        elif block_type == "conditional_block":
            condition = block.get("condition", "")
            rules = []

            if condition:
                # Parse simple conditions like "step_1_success == true"
                parts = condition.split()
                field_name = parts[0] if parts else "result"
                operator = parts[1] if len(parts) > 1 else "=="
                value = parts[2] if len(parts) > 2 else "true"

                rules.append({
                    "id": "rule-1",
                    "field": field_name,
                    "operator": operator,
                    "value": value,
                    "branchLabel": "True",
                })

            if not rules:
                rules = [{
                    "id": "rule-1",
                    "field": "success",
                    "operator": "==",
                    "value": "true",
                    "branchLabel": "True",
                }]

            config["conditionalConfig"] = {
                "condition": condition,
                "rules": rules,
                "defaultBranch": "False",
                "trueBranch": block.get("_next_on_true", ""),
                "falseBranch": block.get("_next_on_false", ""),
            }

        elif block_type == "result_block":
            is_error = block.get("_is_error_node", False)
            config["resultConfig"] = {
                "outputFormat": "Error Report" if is_error else "Report",
                "status": "failure" if is_error else "success",
                "template": "",
                "destination": "",
            }

        elif block_type == "notification_block":
            config["notificationConfig"] = {
                "service": "Email",
                "recipient": "",
                "messageTemplate": description,
                "attachment": "",
            }

        elif block_type == "code_block":
            config["codeConfig"] = {
                "code": f"# {description}\n# Auto-generated by Canvas Agent\n",
                "codeFile": "workflow_step.py",
                "libraryImports": [],
            }

        elif block_type == "parameter_block":
            # Build parameter entries from workflow_params
            params = []
            for p in workflow_params.get("floating", []):
                if isinstance(p, dict):
                    params.append({
                        "name": p.get("name", ""),
                        "type": "string",
                        "defaultValue": p.get("value") or "",
                        "description": p.get("description", ""),
                    })
            for p in workflow_params.get("fixed", []):
                if isinstance(p, dict):
                    params.append({
                        "name": p.get("name", ""),
                        "type": "string",
                        "defaultValue": p.get("value") or "",
                        "description": p.get("description", ""),
                    })
            if not params:
                params = [{
                    "name": "input_param",
                    "type": "string",
                    "defaultValue": "",
                    "description": "",
                }]
            config["parameterConfig"] = {"parameters": params}

        return config

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # A2UI Protocol Messages
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def _generate_a2ui_messages(
        self,
        blocks: list[dict[str, Any]],
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

        for i, block in enumerate(blocks):
            component: dict[str, Any] = {
                "id": block["id"],
                "componentType": block["node_type"],
                "properties": {
                    "label": block.get("label", ""),
                    "subLabel": block.get("description", "")[:60],
                    "icon": block.get("icon", ""),
                    "color": block.get("color", ""),
                    "position": block.get("position", {"x": 0, "y": 0}),
                },
                "adjacentComponents": [],
            }

            # Wire adjacency for non-error mainline blocks
            if not block.get("_is_error_node"):
                if block["block_type"] == "conditional_block":
                    true_target = block.get("_next_on_true")
                    false_target = block.get("_next_on_false")
                    if true_target:
                        component["adjacentComponents"].append({
                            "targetId": true_target,
                            "relationship": "flows_to_on_true",
                        })
                    if false_target:
                        component["adjacentComponents"].append({
                            "targetId": false_target,
                            "relationship": "flows_to_on_false",
                        })
                else:
                    # Find next mainline block
                    mainline = [b for b in blocks if not b.get("_is_error_node")]
                    mainline_ids = [b["id"] for b in mainline]
                    if block["id"] in mainline_ids:
                        idx = mainline_ids.index(block["id"])
                        if idx + 1 < len(mainline):
                            component["adjacentComponents"].append({
                                "targetId": mainline[idx + 1]["id"],
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
        for block in blocks:
            data_updates[block["id"]] = {
                "status": "configured",
                "blockType": block["block_type"],
                "isAutoInjected": block.get("_is_auto_injected", False),
                "isErrorNode": block.get("_is_error_node", False),
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
