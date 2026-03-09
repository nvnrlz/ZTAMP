"""
canvas_agent.py — The Canvas Agent (v4: Dynamic Schema-Driven Mapping)

Deterministic mapper: PlannerAgent JSON → React Flow nodes/edges + A2UI protocol.
No LLM used. See backend/prompts/canvas_agent.md for full documentation.

Pipeline: PlannerAgent (LLM) → CanvasAgent (this) → CodingAgent (LLM)
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger("canvas_agent")


# ─── Variable Interpolation Utility ─────────────────────

def interpolate_variables(template: str, state: dict[str, Any]) -> str:
    """
    Replace {{variable}} placeholders in a string with actual values
    from the runtime state dictionary.

    Supports:
      - Simple variables: {{bucket_name}} → state["bucket_name"]
      - Dotted paths:     {{node_123.output_key}} → state["node_123"]["output_key"]

    If a variable is not found in state, it is left as-is (unreplaced).
    """
    def _replacer(match: re.Match) -> str:
        var_path = match.group(1).strip()
        parts = var_path.split(".")
        current: Any = state

        for part in parts:
            if isinstance(current, dict) and part in current:
                current = current[part]
            else:
                return match.group(0)

        return str(current)

    return re.sub(r"\{\{(.+?)\}\}", _replacer, template)


def interpolate_config(config: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """
    Deep-walk a config dictionary and interpolate all string values
    that contain {{variable}} placeholders.
    """
    result = {}
    for key, value in config.items():
        if isinstance(value, str):
            result[key] = interpolate_variables(value, state)
        elif isinstance(value, dict):
            result[key] = interpolate_config(value, state)
        elif isinstance(value, list):
            result[key] = [
                interpolate_config(item, state) if isinstance(item, dict)
                else interpolate_variables(item, state) if isinstance(item, str)
                else item
                for item in value
            ]
        else:
            result[key] = value
    return result


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

    v4 Architecture (Dynamic Schema):
      1. Parse Planner JSON step array with typed payloads.
      2. Auto-inject ConditionalNodes after every action_block
         (defensive: actions can fail by default).
      3. Generate branching edges for true/false paths.
      4. Build dynamic typed node configs matching the .tsx interfaces:
         - ActionNode: actionConfig { actionType, method, endpointOrTool, headers, payload, executionSettings }
         - ConditionalNode: conditionalConfig { logicalOperator, rules }
         - ResultNode: resultConfig { status, outputMapping, terminateExecution }
         - NotifyNode: notificationConfig { channel, recipients, subject, messageTemplate }
         - CodeNode: codeConfig { language, code, inputBindings, outputBindings }
         - ParamNode: parameterConfig { parameters[{ key, type, defaultValue, required }] }
      5. Supports runtime interpolation via interpolate_config().

    All logic is deterministic — zero LLM cost.
    """

    # ── Layout configuration ──
    HORIZONTAL_SPACING = 240
    VERTICAL_SPACING = 160
    ERROR_ROW_OFFSET = 180   # Y-offset for error/false-branch nodes
    START_X = 80
    START_Y = 80

    def __init__(self):
        logger.info("CanvasAgent v4 initialized (dynamic schema-driven mapping)")

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
          - steps: [ { step_number, title, description, block_type, *_payload, ... } ]
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
        Map PlannerAgent's JSON steps to BLOCK_CATALOG entries,
        preserving typed payloads for dynamic config building.
        """
        blocks: list[dict[str, Any]] = []
        block_idx = 0

        step_lookup: dict[int, dict] = {}
        for ps in planner_steps:
            sn = ps.get("step_number")
            if sn is not None:
                step_lookup[sn] = ps

        for i, ps in enumerate(planner_steps):
            raw_type = ps.get("block_type", "action_block")
            block_type = _BLOCK_TYPE_ALIASES.get(raw_type, raw_type)

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
                # Typed payloads from the Planner
                "_action_payload": ps.get("action_payload"),
                "_conditional_payload": ps.get("conditional_payload"),
                "_code_payload": ps.get("code_payload"),
                "_notify_payload": ps.get("notify_payload"),
                "_result_payload": ps.get("result_payload"),
                "_parameter_payload": ps.get("parameter_payload"),
                # Branching metadata
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
                    "step_number": None,
                    "index": block_idx,
                    "condition": f"{block_id}_success == true",
                    "_action_payload": None,
                    "_conditional_payload": {
                        "logicalOperator": "AND",
                        "rules": [{
                            "variable": f"{{{{{block_id}.status}}}}",
                            "operator": "==",
                            "compareValue": "success",
                        }],
                    },
                    "_code_payload": None,
                    "_notify_payload": None,
                    "_result_payload": None,
                    "_parameter_payload": None,
                    "_next_on_true": None,
                    "_next_on_false": None,
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
                    "color": "#ef4444",
                    "label": f"✗ {action_label[:25]} Failed",
                    "description": (
                        f"The action '{action_label}' did not complete successfully. "
                        "Review logs and retry or escalate."
                    ),
                    "action_type": "report",
                    "parameters_used": {"floating": [], "fixed": []},
                    "step_number": None,
                    "index": block_idx,
                    "_action_payload": None,
                    "_conditional_payload": None,
                    "_code_payload": None,
                    "_notify_payload": None,
                    "_result_payload": {
                        "status": "Failure",
                        "outputMapping": [
                            {"outputKey": "error_source", "mappedValue": f"{{{{{block_id}.error}}}}"},
                        ],
                        "terminateExecution": True,
                    },
                    "_parameter_payload": None,
                    "_next_on_true": None,
                    "_next_on_false": None,
                    "_is_error_node": True,
                    "_is_auto_injected": True,
                }
                blocks.append(error_block)
                block_idx += 1

                # Wire: check_block true→ next mainline, false→ error_block
                check_block["_next_on_false"] = error_id

        # ── Wiring pass ──
        mainline_blocks = [b for b in blocks if not b.get("_is_error_node")]

        for idx, b in enumerate(mainline_blocks):
            if b["block_type"] == "conditional_block":
                if b["_next_on_true"] is None:
                    next_main_idx = idx + 1
                    if next_main_idx < len(mainline_blocks):
                        b["_next_on_true"] = mainline_blocks[next_main_idx]["id"]

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

                if b["_next_on_false"] is None and b.get("_is_auto_injected"):
                    pass  # Already set during injection

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
        """Calculate node positions."""
        positioned = []
        main_col = 0

        mainline_order: list[dict] = []
        error_nodes: list[dict] = []

        for b in blocks:
            if b.get("_is_error_node"):
                error_nodes.append(b)
            else:
                mainline_order.append(b)

        id_to_position: dict[str, dict] = {}
        for b in mainline_order:
            x = self.START_X + (main_col * self.HORIZONTAL_SPACING)
            y = self.START_Y
            pos = {"x": x, "y": y}
            id_to_position[b["id"]] = pos
            positioned.append({**b, "position": pos})
            main_col += 1

        for eb in error_nodes:
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
        """Generate React Flow nodes, edges, and typed configs."""
        nodes: list[dict] = []
        edges: list[dict] = []
        configs: dict[str, dict] = {}

        block_by_id: dict[str, dict] = {b["id"]: b for b in blocks}
        mainline = [b for b in blocks if not b.get("_is_error_node")]

        # ── Create nodes ──
        for b in blocks:
            full_desc = b.get("description", "")
            node = {
                "id": b["id"],
                "type": b["node_type"],
                "position": b["position"],
                "data": {
                    "label": b.get("label", "Step"),
                    "subLabel": full_desc,
                },
            }
            nodes.append(node)

            config = self._build_node_config(
                b, blocks, workflow_params, attached_files,
            )
            configs[b["id"]] = config

        # ── Create edges ──
        for idx, b in enumerate(mainline):
            if b["block_type"] == "conditional_block":
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
    # Step 4: Node Config Builder (Dynamic Schema)
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def _build_node_config(
        self,
        block: dict[str, Any],
        all_blocks: list[dict[str, Any]],
        workflow_params: dict[str, Any],
        attached_files: list[str],
    ) -> dict[str, Any]:
        """
        Build a NodeConfig for a given block using the new dynamic schema.

        Populates typed config sections matching the TypeScript interfaces:
          - actionConfig { actionType, method, endpointOrTool, headers, payload, executionSettings }
          - conditionalConfig { logicalOperator, rules }
          - resultConfig { status, outputMapping, terminateExecution }
          - notificationConfig { channel, recipients, subject, messageTemplate }
          - codeConfig { language, code, inputBindings, outputBindings }
          - parameterConfig { parameters[{ key, type, defaultValue, required }] }

        Also generates a rich `coding_prompt` for the Coding Agent to use.
        """
        block_type = block["block_type"]
        label = block.get("label", "")
        description = block.get("description", "")

        # ── Auto-generate description if missing ──
        if not description:
            description = self._generate_description(block, all_blocks)

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

        if block.get("_is_error_node"):
            input_desc = "⬤ Error Branch — action failed"
            output_desc = "⬤ Terminal — branch ends here"

        config: dict[str, Any] = {
            "id": block["id"],
            "label": label,
            "nodeType": block["node_type"],
            "subLabel": description,
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

        # ── Type-specific configs (dynamic schema) ──

        if block_type == "action_block":
            ap = block.get("_action_payload") or {}
            config["actionConfig"] = {
                "actionType": ap.get("actionType", block.get("action_type", "")),
                "endpointOrTool": ap.get("endpointOrTool", ""),
                "method": ap.get("method", "GET"),
                "headers": ap.get("headers", []),
                "payload": ap.get("payload", ""),
                "executionSettings": ap.get("executionSettings", {
                    "timeoutMs": 30000,
                    "maxRetries": 3,
                    "continueOnError": False,
                }),
            }

        elif block_type == "conditional_block":
            cp = block.get("_conditional_payload") or {}
            condition = block.get("condition", "")

            # Use typed rules if provided, otherwise parse from condition string
            rules = cp.get("rules", [])
            if not rules and condition:
                parts = condition.split()
                field_name = parts[0] if parts else "result"
                operator = parts[1] if len(parts) > 1 else "=="
                value = parts[2] if len(parts) > 2 else "true"
                rules = [{
                    "variable": field_name,
                    "operator": operator,
                    "compareValue": value,
                }]

            if not rules:
                rules = [{
                    "variable": "success",
                    "operator": "==",
                    "compareValue": "true",
                }]

            config["conditionalConfig"] = {
                "logicalOperator": cp.get("logicalOperator", "AND"),
                "rules": rules,
            }

        elif block_type == "result_block":
            rp = block.get("_result_payload") or {}
            is_error = block.get("_is_error_node", False)
            config["resultConfig"] = {
                "status": rp.get("status", "Failure" if is_error else "Success"),
                "outputMapping": rp.get("outputMapping", []),
                "terminateExecution": rp.get("terminateExecution", True),
            }

        elif block_type == "notification_block":
            np = block.get("_notify_payload") or {}
            config["notificationConfig"] = {
                "channel": np.get("channel", "Email"),
                "recipients": np.get("recipients", []),
                "subject": np.get("subject", ""),
                "messageTemplate": np.get("messageTemplate", description),
            }

        elif block_type == "code_block":
            cdp = block.get("_code_payload") or {}
            config["codeConfig"] = {
                "language": cdp.get("language", "Python"),
                "code": cdp.get("code", f"# {description}\n# Auto-generated by Canvas Agent\n"),
                "inputBindings": cdp.get("inputBindings", []),
                "outputBindings": cdp.get("outputBindings", []),
            }

        elif block_type == "parameter_block":
            pp = block.get("_parameter_payload") or {}
            params = pp.get("parameters", [])

            # Fallback: build from workflow_params if no typed payload
            if not params:
                for p in workflow_params.get("floating", []):
                    if isinstance(p, dict):
                        params.append({
                            "key": p.get("name", ""),
                            "type": "String",
                            "defaultValue": p.get("value") or "",
                            "required": True,
                        })
                for p in workflow_params.get("fixed", []):
                    if isinstance(p, dict):
                        params.append({
                            "key": p.get("name", ""),
                            "type": "String",
                            "defaultValue": p.get("value") or "",
                            "required": False,
                        })

            if not params:
                params = [{
                    "key": "input_param",
                    "type": "String",
                    "defaultValue": "",
                    "required": True,
                }]

            config["parameterConfig"] = {"parameters": params}

        # ── Generate coding-agent prompt ──
        config["coding_prompt"] = self._build_coding_prompt(block, config, all_blocks)

        return config

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # Description Generator
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    @staticmethod
    def _generate_description(
        block: dict[str, Any],
        all_blocks: list[dict[str, Any]],
    ) -> str:
        """
        Auto-generate a meaningful description for blocks that are missing one.
        Uses the typed payload data to create a human-readable summary.
        """
        block_type = block["block_type"]
        label = block.get("label", "")

        if block_type == "action_block":
            ap = block.get("_action_payload") or {}
            method = ap.get("method", "GET")
            endpoint = ap.get("endpointOrTool", "")
            action = ap.get("actionType", block.get("action_type", ""))
            payload = ap.get("payload", "")
            parts = [f"Execute {action} action" if action else f"Execute '{label}'"]
            if method and endpoint:
                parts.append(f"via {method} {endpoint}")
            if payload:
                parts.append(f"with payload: {payload[:120]}")
            es = ap.get("executionSettings", {})
            if es:
                timeout = es.get("timeoutMs", 30000)
                retries = es.get("maxRetries", 0)
                parts.append(f"Timeout: {timeout}ms, Max retries: {retries}.")
            return ". ".join(parts) + "."

        elif block_type == "conditional_block":
            cp = block.get("_conditional_payload") or {}
            rules = cp.get("rules", [])
            condition = block.get("condition", "")
            if rules:
                rule_descs = []
                for r in rules:
                    rule_descs.append(
                        f"{r.get('variable', '?')} {r.get('operator', '==')} {r.get('compareValue', '?')}"
                    )
                op = cp.get("logicalOperator", "AND")
                return f"Evaluate condition: {f' {op} '.join(rule_descs)}. Route to true/false branches accordingly."
            elif condition:
                return f"Evaluate condition: {condition}. Route to true branch if satisfied, false branch otherwise."
            return f"Check the result of '{label}' and branch accordingly."

        elif block_type == "code_block":
            cdp = block.get("_code_payload") or {}
            lang = cdp.get("language", "Python")
            inputs = cdp.get("inputBindings", [])
            outputs = cdp.get("outputBindings", [])
            parts = [f"Execute custom {lang} code for '{label}'"]
            if inputs:
                input_names = [b.get("envKey", "?") for b in inputs]
                parts.append(f"Inputs: {', '.join(input_names)}")
            if outputs:
                parts.append(f"Outputs: {', '.join(outputs)}")
            return ". ".join(parts) + "."

        elif block_type == "notification_block":
            np_payload = block.get("_notify_payload") or {}
            channel = np_payload.get("channel", "Email")
            recipients = np_payload.get("recipients", [])
            subject = np_payload.get("subject", "")
            parts = [f"Send {channel} notification"]
            if recipients:
                parts.append(f"to {', '.join(recipients)}")
            if subject:
                parts.append(f"Subject: '{subject}'")
            return ". ".join(parts) + "."

        elif block_type == "result_block":
            rp = block.get("_result_payload") or {}
            status = rp.get("status", "Success")
            outputs = rp.get("outputMapping", [])
            parts = [f"Return workflow result with status '{status}'"]
            if outputs:
                output_keys = [o.get("outputKey", "?") for o in outputs]
                parts.append(f"Output keys: {', '.join(output_keys)}")
            terminate = rp.get("terminateExecution", True)
            if terminate:
                parts.append("Terminates workflow execution")
            return ". ".join(parts) + "."

        elif block_type == "parameter_block":
            pp = block.get("_parameter_payload") or {}
            params = pp.get("parameters", [])
            if params:
                param_descs = [f"{p.get('key', '?')} ({p.get('type', 'String')})" for p in params]
                return f"Define workflow input parameters: {', '.join(param_descs)}."
            return f"Define input parameters for '{label}'."

        return f"Execute step: {label}."

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # Coding Agent Prompt Builder
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    @staticmethod
    def _build_coding_prompt(
        block: dict[str, Any],
        config: dict[str, Any],
        all_blocks: list[dict[str, Any]],
    ) -> str:
        """
        Build a detailed, actionable prompt that the Coding Agent can use
        to generate executable code for this block.

        The prompt includes:
          - Block purpose and context
          - Typed configuration details (endpoints, payloads, rules, code)
          - Input/output variable mappings
          - Error handling requirements
        """
        block_type = block["block_type"]
        label = block.get("label", "")
        description = config.get("description", "")
        input_schema = config.get("inputSchema", "")
        output_schema = config.get("outputSchema", "")

        lines: list[str] = [
            f"# Coding Agent Prompt for: {label}",
            f"# Block ID: {block['id']}",
            f"# Block Type: {block_type}",
            f"# Input: {input_schema}",
            f"# Output: {output_schema}",
            f"#",
            f"# Description: {description}",
            "#",
        ]

        if block_type == "action_block":
            ac = config.get("actionConfig", {})
            lines.extend([
                "# ACTION BLOCK — Generate HTTP/API call code",
                f"# Action Type: {ac.get('actionType', 'N/A')}",
                f"# HTTP Method: {ac.get('method', 'GET')}",
                f"# Endpoint: {ac.get('endpointOrTool', 'N/A')}",
                f"# Payload: {ac.get('payload', 'None')}",
                "# Headers:",
            ])
            for h in ac.get("headers", []):
                lines.append(f"#   {h.get('key', '?')}: {h.get('value', '?')}")
            es = ac.get("executionSettings", {})
            lines.extend([
                "# Execution Settings:",
                f"#   Timeout: {es.get('timeoutMs', 30000)}ms",
                f"#   Max Retries: {es.get('maxRetries', 3)}",
                f"#   Continue on Error: {es.get('continueOnError', False)}",
                "#",
                "# Requirements:",
                "# 1. Make the HTTP request to the endpoint with the specified method and payload.",
                "# 2. Include all headers in the request.",
                "# 3. Resolve all {{variable}} placeholders from the runtime state before sending.",
                "# 4. Handle timeouts and retries as configured.",
                "# 5. Store the response body and status code in the block output.",
                "# 6. Set block status to 'success' or 'failure' based on HTTP response.",
            ])

        elif block_type == "conditional_block":
            cc = config.get("conditionalConfig", {})
            lines.extend([
                "# CONDITIONAL BLOCK — Generate branching logic",
                f"# Logical Operator: {cc.get('logicalOperator', 'AND')}",
                "# Rules:",
            ])
            for i, rule in enumerate(cc.get("rules", [])):
                lines.append(
                    f"#   Rule {i+1}: {rule.get('variable', '?')} "
                    f"{rule.get('operator', '==')} {rule.get('compareValue', '?')}"
                )
            lines.extend([
                "#",
                "# Requirements:",
                "# 1. Evaluate all rules and combine with the logical operator.",
                "# 2. Resolve {{variable}} placeholders from the runtime state.",
                "# 3. Return True to proceed on the true branch, False for the false branch.",
                "# 4. Log the evaluation result and the values compared.",
            ])

        elif block_type == "code_block":
            cc = config.get("codeConfig", {})
            lines.extend([
                "# CODE BLOCK — Execute custom code",
                f"# Language: {cc.get('language', 'Python')}",
                "# Input Bindings:",
            ])
            for ib in cc.get("inputBindings", []):
                lines.append(f"#   {ib.get('envKey', '?')} ← {ib.get('mappedValue', '?')}")
            lines.append("# Output Bindings:")
            for ob in cc.get("outputBindings", []):
                lines.append(f"#   → {ob}")
            code = cc.get("code", "")
            if code:
                lines.extend([
                    "#",
                    "# Provided Code:",
                    "# ```",
                ])
                for code_line in code.split("\n"):
                    lines.append(f"# {code_line}")
                lines.append("# ```")
            lines.extend([
                "#",
                "# Requirements:",
                "# 1. Execute the provided code in a sandboxed environment.",
                "# 2. Map input bindings from the runtime state to environment variables.",
                "# 3. Capture output bindings and store them in the block output.",
                "# 4. Handle exceptions and set block status accordingly.",
            ])

        elif block_type == "notification_block":
            nc = config.get("notificationConfig", {})
            lines.extend([
                "# NOTIFICATION BLOCK — Send alert/notification",
                f"# Channel: {nc.get('channel', 'Email')}",
                f"# Recipients: {', '.join(nc.get('recipients', []))}",
                f"# Subject: {nc.get('subject', 'N/A')}",
                f"# Message Template: {nc.get('messageTemplate', 'N/A')}",
                "#",
                "# Requirements:",
                "# 1. Resolve all {{variable}} placeholders in subject and message template.",
                "# 2. Send the notification via the specified channel.",
                "# 3. Include all recipients.",
                "# 4. Log delivery status and any errors.",
            ])

        elif block_type == "result_block":
            rc = config.get("resultConfig", {})
            lines.extend([
                "# RESULT BLOCK — Return workflow result",
                f"# Status: {rc.get('status', 'Success')}",
                "# Output Mapping:",
            ])
            for om in rc.get("outputMapping", []):
                lines.append(f"#   {om.get('outputKey', '?')} ← {om.get('mappedValue', '?')}")
            lines.extend([
                f"# Terminate Execution: {rc.get('terminateExecution', True)}",
                "#",
                "# Requirements:",
                "# 1. Collect all output mappings from the runtime state.",
                "# 2. Format the final result payload.",
                "# 3. If terminateExecution is true, halt the workflow engine.",
                "# 4. Return the status and output values to the caller.",
            ])

        elif block_type == "parameter_block":
            pc = config.get("parameterConfig", {})
            lines.extend([
                "# PARAMETER BLOCK — Define/collect workflow inputs",
                "# Parameters:",
            ])
            for p in pc.get("parameters", []):
                req = "required" if p.get("required") else "optional"
                lines.append(
                    f"#   {p.get('key', '?')}: {p.get('type', 'String')} "
                    f"(default: {p.get('defaultValue', 'N/A')}, {req})"
                )
            lines.extend([
                "#",
                "# Requirements:",
                "# 1. Validate all required parameters are provided.",
                "# 2. Apply default values for optional parameters not provided.",
                "# 3. Type-check parameter values against their declared types.",
                "# 4. Store validated parameters in the runtime state for downstream blocks.",
            ])

        return "\n".join(lines)

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # A2UI Protocol Messages
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    def _generate_a2ui_messages(
        self,
        blocks: list[dict[str, Any]],
        goal: str,
    ) -> list[dict[str, Any]]:
        """Generate A2UI protocol compliant messages."""
        messages = []
        components = []

        for i, block in enumerate(blocks):
            component: dict[str, Any] = {
                "id": block["id"],
                "componentType": block["node_type"],
                "properties": {
                    "label": block.get("label", ""),
                    "subLabel": block.get("description", ""),
                    "icon": block.get("icon", ""),
                    "color": block.get("color", ""),
                    "position": block.get("position", {"x": 0, "y": 0}),
                },
                "adjacentComponents": [],
            }

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
