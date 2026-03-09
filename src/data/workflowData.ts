import type { Node, Edge } from '@xyflow/react';

/* ─── Live state for execution monitoring ─── */
export type LiveState = 'idle' | 'running' | 'success' | 'fail' | 'diagnosing';

/* ═══════════════════════════════════════════════════════════
   Dynamic Schema-Driven Node Data Interfaces
   ═══════════════════════════════════════════════════════════ */

/** F. Parameter Block — defines workflow input arguments */
export interface ParamNodeParameter {
    key: string;
    type: 'String' | 'Number' | 'Boolean' | 'JSON';
    defaultValue: any;
    required: boolean;
}

export interface ParamNodeData {
    label: string;
    subLabel?: string;
    selected?: boolean;
    dimmed?: boolean;
    liveState?: LiveState;
    parameters: ParamNodeParameter[];
    [key: string]: unknown;
}

/** A. Action Block — HTTP/API calls, infrastructure actions */
export interface ActionHeaderEntry {
    key: string;
    value: string;
}

export interface ExecutionSettings {
    timeoutMs: number;
    maxRetries: number;
    continueOnError: boolean;
}

export interface ActionNodeData {
    label: string;
    subLabel?: string;
    selected?: boolean;
    dimmed?: boolean;
    liveState?: LiveState;
    actionType: string;
    endpointOrTool: string;              // supports {{var}} interpolation
    method: string;                      // GET, POST, PUT, DELETE, etc.
    headers: ActionHeaderEntry[];
    payload: string;                     // stringified JSON or KV map
    executionSettings: ExecutionSettings;
    [key: string]: unknown;
}

/** B. Conditional Block — branching / decision logic */
export interface ConditionalRule {
    variable: string;
    operator: string;
    compareValue: string;
}

export interface ConditionalNodeData {
    label: string;
    subLabel?: string;
    selected?: boolean;
    dimmed?: boolean;
    liveState?: LiveState;
    logicalOperator: 'AND' | 'OR';
    rules: ConditionalRule[];
    [key: string]: unknown;
}

/** E. Code Block — custom scripts */
export interface CodeInputBinding {
    envKey: string;
    mappedValue: string;
}

export interface CodeNodeData {
    label: string;
    subLabel?: string;
    selected?: boolean;
    dimmed?: boolean;
    liveState?: LiveState;
    language: 'Python' | 'JavaScript';
    code: string;
    inputBindings: CodeInputBinding[];
    outputBindings: string[];
    [key: string]: unknown;
}

/** D. Notification Block — alerts & messaging */
export interface NotifyNodeData {
    label: string;
    subLabel?: string;
    selected?: boolean;
    dimmed?: boolean;
    liveState?: LiveState;
    channel: string;                     // Email, Slack, PagerDuty, Webhook, SNS
    recipients: string[];
    subject: string;
    messageTemplate: string;             // supports {{var}} interpolation
    [key: string]: unknown;
}

/** C. Result Block — workflow terminal / output */
export interface OutputMappingEntry {
    outputKey: string;
    mappedValue: string;
}

export interface ResultNodeData {
    label: string;
    subLabel?: string;
    selected?: boolean;
    dimmed?: boolean;
    liveState?: LiveState;
    status: 'Success' | 'Failure';
    outputMapping: OutputMappingEntry[];
    terminateExecution: boolean;
    [key: string]: unknown;
}

/* ─── Union type for backward compat + generic usage ─── */
export interface WorkflowNodeData {
    label: string;
    subLabel?: string;
    selected?: boolean;
    dimmed?: boolean;
    liveState?: LiveState;
    [key: string]: unknown;
}

/* These are kept for backward compat but no longer used as initial state */
export const initialNodes: Node<WorkflowNodeData>[] = [];
export const initialEdges: Edge[] = [];
