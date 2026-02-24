import type { Node, Edge } from '@xyflow/react';

/* ─── Live state for execution monitoring ─── */
export type LiveState = 'idle' | 'running' | 'success' | 'fail' | 'diagnosing';

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
