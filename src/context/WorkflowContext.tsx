import {
    createContext,
    useContext,
    useState,
    useCallback,
    useEffect,
    useRef,
    type ReactNode,
} from 'react';
import {
    type Node,
    type Edge,
    type OnNodesChange,
    type OnEdgesChange,
    type OnConnect,
    applyNodeChanges,
    applyEdgeChanges,
    addEdge,
} from '@xyflow/react';
import { type WorkflowNodeData } from '../data/workflowData';
import type {
    ParamNodeParameter,
    ActionHeaderEntry,
    ExecutionSettings,
    ConditionalRule,
    CodeInputBinding,
    OutputMappingEntry,
} from '../data/workflowData';

/* ═══════════════════════════════════════════════════════════
   Dynamic Schema-Driven Block Config Interfaces
   ═══════════════════════════════════════════════════════════ */

/** A. Action Block Config */
export interface ActionBlockConfig {
    actionType: string;
    endpointOrTool: string;
    method: string;
    headers: ActionHeaderEntry[];
    payload: string;
    executionSettings: ExecutionSettings;
}

/** B. Conditional Block Config */
export interface ConditionalBlockConfig {
    logicalOperator: 'AND' | 'OR';
    rules: ConditionalRule[];
}

/** C. Result Block Config */
export interface ResultBlockConfig {
    status: 'Success' | 'Failure';
    outputMapping: OutputMappingEntry[];
    terminateExecution: boolean;
}

/** D. Notification Block Config */
export interface NotificationBlockConfig {
    channel: string;
    recipients: string[];
    subject: string;
    messageTemplate: string;
}

/** E. Code Block Config */
export interface CodeBlockConfig {
    language: 'Python' | 'JavaScript';
    code: string;
    inputBindings: CodeInputBinding[];
    outputBindings: string[];
}

/** F. Parameter Block Config */
export interface ParameterBlockConfig {
    parameters: ParamNodeParameter[];
}

/* ─── Retry Policy (shared across all blocks) ─── */
export interface RetryPolicy {
    enabled: boolean;
    maxRetries: number;
    retryDelay: number;       // seconds between retries
    timeout: number;          // max execution time
}

/* ─── Unified Node Config ─── */
export interface NodeConfig {
    id: string;
    label: string;
    nodeType: string;
    subLabel?: string;
    description: string;
    inputSchema: string;
    outputSchema: string;
    retryPolicy: RetryPolicy;

    // Type-specific configs (only one will be populated per node)
    actionConfig?: ActionBlockConfig;
    conditionalConfig?: ConditionalBlockConfig;
    resultConfig?: ResultBlockConfig;
    notificationConfig?: NotificationBlockConfig;
    codeConfig?: CodeBlockConfig;
    parameterConfig?: ParameterBlockConfig;

    // Legacy fields for backward compat during migration
    code: string;
    codeFile: string;
    timeout: number;
    retryOnFail: boolean;
}

/* ─── Default configs per node type ─── */
function defaultRetryPolicy(): RetryPolicy {
    return { enabled: false, maxRetries: 3, retryDelay: 5, timeout: 30 };
}

function defaultConfigForNode(node: Node<WorkflowNodeData>): NodeConfig {
    const nodeType = node.type || 'actionNode';
    const base: NodeConfig = {
        id: node.id,
        label: (node.data as WorkflowNodeData).label,
        nodeType,
        subLabel: (node.data as WorkflowNodeData).subLabel,
        description: '',
        inputSchema: '{ }',
        outputSchema: '{ }',
        retryPolicy: defaultRetryPolicy(),
        code: '',
        codeFile: 'untitled.py',
        timeout: 30,
        retryOnFail: false,
    };

    switch (nodeType) {
        case 'actionNode':
            base.actionConfig = {
                actionType: '',
                endpointOrTool: '',
                method: 'GET',
                headers: [],
                payload: '',
                executionSettings: { timeoutMs: 30000, maxRetries: 3, continueOnError: false },
            };
            break;
        case 'conditionalNode':
            base.conditionalConfig = {
                logicalOperator: 'AND',
                rules: [{ variable: '', operator: '==', compareValue: '' }],
            };
            break;
        case 'resultNode':
            base.resultConfig = {
                status: 'Success',
                outputMapping: [],
                terminateExecution: true,
            };
            break;
        case 'notifyNode':
            base.notificationConfig = {
                channel: 'Email',
                recipients: [],
                subject: '',
                messageTemplate: '',
            };
            break;
        case 'codeNode':
            base.codeConfig = {
                language: 'Python',
                code: '',
                inputBindings: [],
                outputBindings: [],
            };
            break;
        case 'paramNode':
            base.parameterConfig = {
                parameters: [{ key: 'input_param', type: 'String', defaultValue: '', required: true }],
            };
            break;
    }

    return base;
}

/* ─── Context interface ─── */
interface WorkflowContextValue {
    nodes: Node<WorkflowNodeData>[];
    edges: Edge[];
    selectedNodeId: string | null;
    selectedConfig: NodeConfig | null;
    nodeConfigs: Record<string, NodeConfig>;
    workflowId: string | null;
    workflowName: string;
    workflowDescription: string;
    isSaving: boolean;
    isLocked: boolean;
    hasUnsavedChanges: boolean;

    onNodesChange: OnNodesChange;
    onEdgesChange: OnEdgesChange;
    onConnect: OnConnect;

    selectNode: (id: string | null) => void;
    addNode: (type: string, position: { x: number; y: number }) => void;
    deleteNode: (id: string) => void;
    updateNodeConfig: (id: string, updates: Partial<NodeConfig>) => void;
    closePanel: () => void;
    saveWorkflow: (name: string, description: string) => Promise<void>;
    loadWorkflow: (workflowData: SavedWorkflow) => void;
    resetWorkflow: () => void;
    setWorkflowName: (name: string) => void;
    setWorkflowDescription: (desc: string) => void;
    setIsLocked: (locked: boolean) => void;
    markSaved: () => void;
    setBatchNodesAndEdges: (
        nodes: Node<WorkflowNodeData>[],
        edges: Edge[],
        configs: Record<string, NodeConfig>,
    ) => void;
}

export interface SavedWorkflow {
    id: string;
    name: string;
    description: string;
    nodes: Node<WorkflowNodeData>[];
    edges: Edge[];
    nodeConfigs: Record<string, NodeConfig>;
    createdAt: string;
    updatedAt: string;
    version: number;
}

const WorkflowContext = createContext<WorkflowContextValue | null>(null);

export function useWorkflow() {
    const ctx = useContext(WorkflowContext);
    if (!ctx) throw new Error('useWorkflow must be inside WorkflowProvider');
    return ctx;
}

/* ─── Counter for unique node IDs ─── */
let nextNodeId = 100;

/* ─── Node type → display type mapping ─── */
const NODE_TYPE_MAP: Record<string, string> = {
    Action: 'actionNode',
    Conditional: 'conditionalNode',
    Result: 'resultNode',
    Notify: 'notifyNode',
    Code: 'codeNode',
    Param: 'paramNode',
};

const NODE_LABEL_MAP: Record<string, string> = {
    Action: 'New Action Block',
    Conditional: 'New Condition',
    Result: 'New Result',
    Notify: 'New Notification',
    Code: 'New Code Block',
    Param: 'New Parameter',
};

/* ─── Provider ─── */
export function WorkflowProvider({ children }: { children: ReactNode }) {
    const [nodes, setNodes] = useState<Node<WorkflowNodeData>[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [nodeConfigs, setNodeConfigs] = useState<Record<string, NodeConfig>>({});
    const [workflowId, setWorkflowId] = useState<string | null>(null);
    const [workflowName, setWorkflowName] = useState('');
    const [workflowDescription, setWorkflowDescription] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isLocked, setIsLocked] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    const isInitialMount = useRef(true);
    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }
        if (nodes.length > 0 || edges.length > 0) {
            setHasUnsavedChanges(true);
        }
    }, [nodes, edges, nodeConfigs]);

    const markSaved = useCallback(() => {
        setHasUnsavedChanges(false);
    }, []);

    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [hasUnsavedChanges]);

    /* ─── React Flow callbacks ─── */
    const onNodesChange: OnNodesChange = useCallback(
        (changes) => {
            if (isLocked) {
                const allowedChanges = changes.filter((c) => c.type === 'select');
                if (allowedChanges.length > 0) {
                    setNodes((nds) => applyNodeChanges(allowedChanges, nds) as Node<WorkflowNodeData>[]);
                }
                return;
            }
            setNodes((nds) => applyNodeChanges(changes, nds) as Node<WorkflowNodeData>[]);
        },
        [isLocked],
    );

    const onEdgesChange: OnEdgesChange = useCallback(
        (changes) => {
            if (isLocked) {
                const allowedChanges = changes.filter((c) => c.type === 'select');
                if (allowedChanges.length > 0) {
                    setEdges((eds) => applyEdgeChanges(allowedChanges, eds));
                }
                return;
            }
            setEdges((eds) => applyEdgeChanges(changes, eds));
        },
        [isLocked],
    );

    const onConnect: OnConnect = useCallback(
        (connection) => {
            if (isLocked) return;
            setEdges((eds) => addEdge({ ...connection, type: 'smoothstep' }, eds));
        },
        [isLocked],
    );

    const selectNode = useCallback(
        (id: string | null) => {
            setSelectedNodeId(id);
            if (id && !nodeConfigs[id]) {
                const node = nodes.find((n) => n.id === id);
                if (node) {
                    setNodeConfigs((prev) => ({
                        ...prev,
                        [id]: defaultConfigForNode(node),
                    }));
                }
            }
        },
        [nodeConfigs, nodes],
    );

    const closePanel = useCallback(() => setSelectedNodeId(null), []);

    const addNode = useCallback(
        (toolbarLabel: string, position: { x: number; y: number }) => {
            if (isLocked) return;
            const id = `node-${nextNodeId++}`;
            const type = NODE_TYPE_MAP[toolbarLabel] || 'actionNode';
            const label = NODE_LABEL_MAP[toolbarLabel] || toolbarLabel;

            const newNode: Node<WorkflowNodeData> = {
                id,
                type,
                position,
                data: { label },
            };

            setNodes((nds) => [...nds, newNode]);
            setNodeConfigs((prev) => ({
                ...prev,
                [id]: defaultConfigForNode(newNode),
            }));
            setSelectedNodeId(id);
        },
        [isLocked],
    );

    const deleteNode = useCallback(
        (id: string) => {
            if (isLocked) return;
            setNodes((nds) => nds.filter((n) => n.id !== id));
            setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
            setNodeConfigs((prev) => {
                const copy = { ...prev };
                delete copy[id];
                return copy;
            });
            if (selectedNodeId === id) setSelectedNodeId(null);
        },
        [selectedNodeId, isLocked],
    );

    const updateNodeConfig = useCallback(
        (id: string, updates: Partial<NodeConfig>) => {
            setNodeConfigs((prev) => ({
                ...prev,
                [id]: { ...prev[id], ...updates },
            }));
            if (updates.label) {
                setNodes((nds) =>
                    nds.map((n) =>
                        n.id === id ? { ...n, data: { ...n.data, label: updates.label! } } : n,
                    ),
                );
            }
        },
        [],
    );

    const saveWorkflow = useCallback(
        async (name: string, description: string) => {
            setIsSaving(true);
            try {
                const payload = { name, description, nodes, edges, nodeConfigs };

                if (workflowId) {
                    await fetch(`http://localhost:4000/api/workflows/${workflowId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                } else {
                    const res = await fetch('http://localhost:4000/api/workflows', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    });
                    const data = await res.json();
                    if (data.workflow?.id) {
                        setWorkflowId(data.workflow.id);
                    }
                }
                setWorkflowName(name);
                setWorkflowDescription(description);
                setHasUnsavedChanges(false);
            } finally {
                setIsSaving(false);
            }
        },
        [nodes, edges, nodeConfigs, workflowId],
    );

    const loadWorkflow = useCallback((wf: SavedWorkflow) => {
        setNodes(wf.nodes || []);
        setEdges(wf.edges || []);
        setNodeConfigs(wf.nodeConfigs || {});
        setWorkflowId(wf.id);
        setWorkflowName(wf.name);
        setWorkflowDescription(wf.description || '');
        setSelectedNodeId(null);
        setHasUnsavedChanges(false);
        setIsLocked(false);
    }, []);

    const resetWorkflow = useCallback(() => {
        setNodes([]);
        setEdges([]);
        setNodeConfigs({});
        setWorkflowId(null);
        setWorkflowName('');
        setWorkflowDescription('');
        setSelectedNodeId(null);
        setHasUnsavedChanges(false);
        setIsLocked(false);
    }, []);

    const setBatchNodesAndEdges = useCallback(
        (
            newNodes: Node<WorkflowNodeData>[],
            newEdges: Edge[],
            newConfigs: Record<string, NodeConfig>,
        ) => {
            setNodes(newNodes);
            setEdges(newEdges);
            setNodeConfigs(newConfigs);
            setSelectedNodeId(null);
            setHasUnsavedChanges(true);
        },
        [],
    );

    const selectedConfig = selectedNodeId ? nodeConfigs[selectedNodeId] ?? null : null;

    return (
        <WorkflowContext.Provider
            value={{
                nodes,
                edges,
                selectedNodeId,
                selectedConfig,
                nodeConfigs,
                workflowId,
                workflowName,
                workflowDescription,
                isSaving,
                isLocked,
                hasUnsavedChanges,
                onNodesChange,
                onEdgesChange,
                onConnect,
                selectNode,
                addNode,
                deleteNode,
                updateNodeConfig,
                closePanel,
                saveWorkflow,
                loadWorkflow,
                resetWorkflow,
                setWorkflowName,
                setWorkflowDescription,
                setIsLocked,
                markSaved,
                setBatchNodesAndEdges,
            }}
        >
            {children}
        </WorkflowContext.Provider>
    );
}
