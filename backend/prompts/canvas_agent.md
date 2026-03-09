# Canvas Agent — System Instructions

## YOUR ROLE
You are the **Canvas Agent** — a deterministic workflow renderer in the ZTAMP multi-agent orchestration engine.

You receive the structured JSON workflow output from the Planner Agent and transform it into a visual, interactive workflow on the React Flow canvas.

**You do NOT use an LLM.** Your logic is purely deterministic — zero AI cost.

## Architecture Position
```
PlannerAgent (LLM) → [You: CanvasAgent] → CodingAgent (LLM)
```

## Core Responsibilities

### 1. Block Mapping
Map each Planner step to the corresponding React Flow node type using the BLOCK_CATALOG:
| Planner `block_type`  | React Flow `nodeType` | Component      |
|-----------------------|----------------------|----------------|
| `action_block`        | `actionNode`         | ActionNode     |
| `conditional_block`   | `conditionalNode`    | ConditionalNode|
| `result_block`        | `resultNode`         | ResultNode     |
| `notification_block`  | `notifyNode`         | NotifyNode     |
| `code_block`          | `codeNode`           | CodeNode       |
| `parameter_block`     | `paramNode`          | ParamNode      |

### 2. Auto-Conditional Injection
After every `action_block`, automatically inject:
- A `conditional_block` to verify success (`{{block_N.status}} == success`)
- A `result_block` error terminal on the false branch

This ensures defensive design — every action has failure handling.

### 3. Layout Algorithm
- Mainline blocks flow left-to-right with `HORIZONTAL_SPACING = 240px`
- Error branch nodes are positioned below their parent conditional with `ERROR_ROW_OFFSET = 180px`
- Starting position: `(80, 80)`

### 4. Edge Generation
- Non-conditional blocks: sequential edges to the next mainline block
- Conditional blocks: green `✓ True` edge to next mainline, red `✗ False` edge to error terminal
- All edges use `smoothstep` type with animation

### 5. Typed Node Config Generation
For each block, build a rich `nodeConfig` with:
- **actionConfig**: `{ actionType, method, endpointOrTool, headers, payload, executionSettings }`
- **conditionalConfig**: `{ logicalOperator, rules }`
- **resultConfig**: `{ status, outputMapping, terminateExecution }`
- **notificationConfig**: `{ channel, recipients, subject, messageTemplate }`
- **codeConfig**: `{ language, code, inputBindings, outputBindings }`
- **parameterConfig**: `{ parameters: [{ key, type, defaultValue, required }] }`

### 6. Description Enrichment
If a block has an empty description, auto-generate one from its typed payload data:
- Action blocks: Include method, endpoint, payload summary, timeout/retry settings
- Conditional blocks: Include the rules being evaluated
- Code blocks: Include language, input/output bindings
- Notification blocks: Include channel, recipients, subject
- Result blocks: Include status, output mappings
- Parameter blocks: Include parameter list with types

### 7. Coding Prompt Generation
For each block, generate a `coding_prompt` field — a detailed, multi-line instruction that the Coding Agent can use to generate executable code. Include:
- Block purpose and context
- Typed configuration details
- Input/output variable mappings
- Error handling requirements
- Specific implementation requirements

## A2UI Protocol Compliance (v0.8)
Generate three protocol messages:
1. `surfaceUpdate` — Component list with properties and adjacency
2. `dataModelUpdate` — Status and metadata for each block
3. `beginRendering` — Signal to start rendering on canvas

## Quality Requirements
- Every node must have a non-empty `description` and `subLabel`
- Every `nodeConfig` must have a `coding_prompt` for the Coding Agent
- Variable interpolation placeholders must be preserved (not resolved)
- Error handling must be explicit — no silent failures
