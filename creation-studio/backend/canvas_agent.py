"""
canvas_agent.py — The Canvas Agent

Translates a Planner Agent's workflow_plan into a visual flowchart
using the A2UI protocol (Agent-to-UI) from Google.

Architecture:
  1. Receives workflow_plan + current_parameters from Planner Agent
  2. Maps each step to the best-fitting block type
  3. Generates an A2UI-compliant surfaceUpdate JSON payload
  4. Also produces a native React Flow payload (nodes + edges + configs)
     for direct rendering on the canvas

A2UI Protocol Compliance (v0.8):
  - Uses surfaceUpdate messages with flat component adjacency list
  - Each component has a unique id and a component type mapping
  - Uses dataModelUpdate for dynamic values
  - Uses beginRendering to signal the client to render

Block Type Catalog (maps to existing canvas blocks):
  - ActionNode     — Context/research blocks (RAG retrieval, data gathering)
  - ConditionalNode — Decision/branching logic
  - ResultNode     — Output generation (PDF, Excel, CSV, etc.)
  - NotifyNode     — Notifications (email, Slack, PagerDuty)
  - CodeNode       — Custom code execution
  - ParamNode      — Parameter/variable definitions
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger("canvas_agent")


# ─── A2UI Component Catalog ─────────────────────────────
# Maps our block types to the A2UI component catalog.
# This acts as the "Widget Registry" that the A2UI spec requires.

BLOCK_CATALOG = {
    "action": {
        "nodeType": "actionNode",
        "toolbarLabel": "Action",
        "icon": "search",
        "color": "#3b82f6",  # Blue
        "defaultLabel": "Context Block",
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

# Keywords that help determine the best block type for a step
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


class CanvasAgent:
    """
    Translates a Planner Agent's workflow_plan into canvas nodes.

    Uses the A2UI protocol pattern:
    1. Maps step types → block catalog
    2. Generates surfaceUpdate components (adjacency list)
    3. Produces native React Flow nodes + edges for canvas rendering
    """

    # ── Layout configuration ──
    HORIZONTAL_SPACING = 240  # px between nodes horizontally
    VERTICAL_SPACING = 150    # px between nodes vertically
    START_X = 80              # Starting X position
    START_Y = 80              # Starting Y position

    def __init__(self):
        logger.info("CanvasAgent initialized")

    def generate_workflow(
        self,
        workflow_plan: dict[str, Any],
        current_parameters: Optional[dict[str, Any]] = None,
    ) -> CanvasResponse:
        """
        Main entry point: convert a workflow plan into canvas elements.

        Args:
            workflow_plan: The plan from PlannerAgent with goal, steps, etc.
            current_parameters: The input/task/output from the planner.

        Returns:
            CanvasResponse with A2UI messages + React Flow nodes/edges.
        """
        try:
            goal = workflow_plan.get("goal", "Untitled Workflow")
            steps = workflow_plan.get("steps", [])
            extracted_params = workflow_plan.get("extracted_parameters", {})

            if not steps:
                return CanvasResponse(
                    success=False,
                    message="No steps found in the workflow plan.",
                )

            logger.info(
                f"Generating workflow: '{goal}' with {len(steps)} steps"
            )

            # Step 1: Resolve the best block type for each step
            resolved_steps = self._resolve_block_types(steps)

            # Step 2: Generate node positions (layout algorithm)
            positioned_steps = self._layout_nodes(resolved_steps)

            # Step 3: Generate React Flow nodes + edges
            rf_nodes, rf_edges, rf_configs = self._generate_react_flow(
                positioned_steps, current_parameters, extracted_params
            )

            # Step 4: Generate A2UI protocol messages
            a2ui_messages = self._generate_a2ui_messages(
                positioned_steps, goal
            )

            return CanvasResponse(
                success=True,
                message=f"Workflow '{goal}' created with {len(rf_nodes)} blocks.",
                a2ui_messages=a2ui_messages,
                nodes=rf_nodes,
                edges=rf_edges,
                node_configs=rf_configs,
                workflow_name=goal,
                workflow_description=self._build_description(
                    current_parameters
                ),
            )

        except Exception as e:
            logger.error(f"Failed to generate workflow: {e}", exc_info=True)
            return CanvasResponse(
                success=False,
                message=f"Failed to generate workflow: {str(e)}",
            )

    # ── Step 1: Resolve block types ──────────────────────

    def _resolve_block_types(
        self, steps: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        For each step, determine the best-fitting block type
        from our catalog based on:
        1. Explicit step.type (if the planner specified one)
        2. Keyword matching in label + description
        3. Position heuristics (first step → context, last step → result)
        """
        resolved = []

        for i, step in enumerate(steps):
            step_type = step.get("type", "").lower().strip()
            label = step.get("label", "")
            description = step.get("description", "")
            combined_text = f"{label} {description}".lower()

            # Try to match from the planner's suggested type
            block_type = self._match_planner_type(step_type)

            # If no match, use keyword scoring
            if not block_type:
                block_type = self._score_keywords(combined_text)

            # Apply position heuristics as final fallback
            if not block_type:
                if i == 0:
                    block_type = "action"  # First step → context/research
                elif i == len(steps) - 1:
                    block_type = "result"  # Last step → output
                else:
                    block_type = "code"  # Middle steps → processing

            catalog_entry = BLOCK_CATALOG[block_type]

            resolved.append({
                **step,
                "resolved_type": block_type,
                "node_type": catalog_entry["nodeType"],
                "toolbar_label": catalog_entry["toolbarLabel"],
                "icon": catalog_entry["icon"],
                "color": catalog_entry["color"],
                "index": i,
            })

        logger.info(
            "Resolved block types: "
            + ", ".join(
                f"{s['label']} → {s['resolved_type']}" for s in resolved
            )
        )

        return resolved

    def _match_planner_type(self, step_type: str) -> Optional[str]:
        """Match the planner's step type to our block catalog."""
        # Direct matches
        direct_map = {
            "context": "action",
            "action": "action",
            "conditional": "conditional",
            "condition": "conditional",
            "result": "result",
            "output": "result",
            "notification": "notification",
            "notify": "notification",
            "code": "code",
            "parameter": "parameter",
            "param": "parameter",
        }

        # The planner might send compound types like
        # "context|conditional|action"
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

    # ── Step 2: Layout algorithm ─────────────────────────

    def _layout_nodes(
        self, steps: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """
        Calculate node positions using a left-to-right flow layout.

        For linear workflows: horizontal chain
        For branching workflows: vertical spread at branch points
        """
        positioned = []

        for i, step in enumerate(steps):
            # Simple horizontal layout for linear workflows
            x = self.START_X + (i * self.HORIZONTAL_SPACING)
            y = self.START_Y

            # Special handling for conditional branches
            if step["resolved_type"] == "conditional":
                # Keep the conditional node in the main flow
                y = self.START_Y
            elif i > 0 and positioned[i - 1]["resolved_type"] == "conditional":
                # Step after a conditional gets offset vertically
                y = self.START_Y + self.VERTICAL_SPACING // 2

            positioned.append({
                **step,
                "position": {"x": x, "y": y},
            })

        return positioned

    # ── Step 3: Generate React Flow payload ──────────────

    def _generate_react_flow(
        self,
        steps: list[dict[str, Any]],
        current_parameters: Optional[dict[str, Any]],
        extracted_params: dict[str, Any],
    ) -> tuple[list[dict], list[dict], dict[str, dict]]:
        """Generate React Flow nodes, edges, and configs."""
        nodes = []
        edges = []
        configs = {}
        node_id_counter = 200  # Start at 200 to avoid conflicts

        # Map step IDs to node IDs
        step_to_node: dict[str, str] = {}

        for step in steps:
            node_id = f"node-{node_id_counter}"
            step_to_node[step.get("id", f"step_{step['index']}")] = node_id
            node_id_counter += 1

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
                node_id, step, current_parameters, extracted_params
            )
            configs[node_id] = config

        # Create edges (connect sequential steps)
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
    ) -> dict[str, Any]:
        """Build a NodeConfig object for a given step."""
        block_type = step["resolved_type"]
        label = step.get("label", "")
        description = step.get("description", "")
        step_config = step.get("config", {})

        config: dict[str, Any] = {
            "id": node_id,
            "label": label,
            "nodeType": step["node_type"],
            "subLabel": description[:60] if description else "",
            "description": description,
            "inputSchema": "{ }",
            "outputSchema": "{ }",
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

        # Populate type-specific configs based on block type
        if block_type == "action":
            input_source = ""
            if current_parameters:
                input_source = str(current_parameters.get("input", ""))
            config["contextConfig"] = {
                "contextSources": [input_source] if input_source else [],
                "query": description or label,
            }

        elif block_type == "conditional":
            rules = []
            if step_config:
                # Try to extract condition rules from the step config
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
                    "field": "",
                    "operator": ">",
                    "value": "",
                    "branchLabel": "True",
                }]
            config["conditionalConfig"] = {
                "rules": rules,
                "defaultBranch": "Default",
            }

        elif block_type == "result":
            # Determine output format from parameters
            output_format = "PDF"
            if current_parameters:
                output_str = str(
                    current_parameters.get("output", "")
                ).lower()
                if "excel" in output_str or "xlsx" in output_str:
                    output_format = "Excel"
                elif "csv" in output_str:
                    output_format = "CSV"
                elif "json" in output_str:
                    output_format = "JSON"
            config["resultConfig"] = {
                "outputFormat": output_format,
                "template": "",
            }

        elif block_type == "notification":
            service = "Email"
            recipient = ""
            if current_parameters:
                output_str = str(
                    current_parameters.get("output", "")
                )
                if "slack" in output_str.lower():
                    service = "Slack"
                elif "teams" in output_str.lower():
                    service = "PagerDuty"
                # Extract email address
                email_match = re.findall(
                    r'[\w.+-]+@[\w-]+\.[\w.]+', output_str
                )
                if email_match:
                    recipient = email_match[0]
            config["notificationConfig"] = {
                "service": service,
                "recipient": recipient,
                "messageTemplate": description,
            }

        elif block_type == "code":
            config["codeConfig"] = {
                "code": f"# {description}\n# Auto-generated by Canvas Agent\n",
                "codeFile": "workflow_step.py",
                "libraryImports": ["pandas", "numpy"],
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

    # ── Step 4: Generate A2UI protocol messages ──────────

    def _generate_a2ui_messages(
        self,
        steps: list[dict[str, Any]],
        goal: str,
    ) -> list[dict[str, Any]]:
        """
        Generate A2UI-compliant JSONL messages.

        Following the A2UI v0.8 specification:
        - surfaceUpdate: component tree (adjacency list model)
        - dataModelUpdate: dynamic values
        - beginRendering: signal to render

        Our component catalog maps to workflow blocks:
        - WorkflowNode: An individual block on the canvas
        - WorkflowEdge: A connection between blocks
        - WorkflowContainer: The root container for the graph
        """
        messages: list[dict[str, Any]] = []

        # 1. Surface update: Root container
        root_children = [f"wf_node_{s['index']}" for s in steps]
        edge_children = [
            f"wf_edge_{i}"
            for i in range(len(steps) - 1)
        ]

        messages.append({
            "surfaceUpdate": {
                "surfaceId": "workflow_canvas",
                "components": [{
                    "id": "workflow_root",
                    "component": {
                        "WorkflowContainer": {
                            "title": {"literalString": goal},
                            "children": {
                                "explicitList": root_children + edge_children,
                            },
                        },
                    },
                }],
            },
        })

        # 2. Surface update: Individual workflow nodes
        for step in steps:
            component_type = self._a2ui_component_type(step["resolved_type"])
            messages.append({
                "surfaceUpdate": {
                    "surfaceId": "workflow_canvas",
                    "components": [{
                        "id": f"wf_node_{step['index']}",
                        "component": {
                            component_type: {
                                "label": {
                                    "literalString": step.get("label", ""),
                                },
                                "description": {
                                    "literalString": step.get(
                                        "description", ""
                                    ),
                                },
                                "blockType": {
                                    "literalString": step["resolved_type"],
                                },
                                "position": step["position"],
                                "icon": {
                                    "literalString": step["icon"],
                                },
                                "color": {
                                    "literalString": step["color"],
                                },
                            },
                        },
                    }],
                },
            })

        # 3. Surface update: Edges between nodes
        for i in range(len(steps) - 1):
            messages.append({
                "surfaceUpdate": {
                    "surfaceId": "workflow_canvas",
                    "components": [{
                        "id": f"wf_edge_{i}",
                        "component": {
                            "WorkflowEdge": {
                                "source": {
                                    "literalString": f"wf_node_{i}",
                                },
                                "target": {
                                    "literalString": f"wf_node_{i + 1}",
                                },
                                "animated": True,
                            },
                        },
                    }],
                },
            })

        # 4. Data model update
        messages.append({
            "dataModelUpdate": {
                "surfaceId": "workflow_canvas",
                "contents": {
                    "workflow_goal": goal,
                    "step_count": len(steps),
                    "steps": [
                        {
                            "id": s.get("id", f"step_{s['index']}"),
                            "label": s.get("label", ""),
                            "type": s["resolved_type"],
                        }
                        for s in steps
                    ],
                },
            },
        })

        # 5. Begin rendering signal
        messages.append({
            "beginRendering": {
                "surfaceId": "workflow_canvas",
                "root": "workflow_root",
            },
        })

        return messages

    def _a2ui_component_type(self, block_type: str) -> str:
        """Map internal block type to A2UI component type name."""
        return {
            "action": "WorkflowActionNode",
            "conditional": "WorkflowConditionalNode",
            "result": "WorkflowResultNode",
            "notification": "WorkflowNotifyNode",
            "code": "WorkflowCodeNode",
            "parameter": "WorkflowParamNode",
        }.get(block_type, "WorkflowActionNode")

    # ── Helpers ──────────────────────────────────────────

    def _build_description(
        self, current_parameters: Optional[dict[str, Any]]
    ) -> str:
        """Build a human-readable description from parameters."""
        if not current_parameters:
            return ""

        parts = []
        inp = current_parameters.get("input", "")
        task = current_parameters.get("task", "")
        out = current_parameters.get("output", "")

        if task:
            parts.append(str(task))
        if inp:
            parts.append(f"Input: {inp}")
        if out:
            parts.append(f"Output: {out}")

        return " | ".join(parts)
