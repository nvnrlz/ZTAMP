import { useMemo, useCallback, useRef, useState, type CSSProperties, type DragEvent } from 'react';
import {
    ReactFlow,
    Background,
    BackgroundVariant,
    Controls,
    type NodeTypes,
    type EdgeTypes,
    useReactFlow,
    ReactFlowProvider,
    type NodeMouseHandler,
    type EdgeMouseHandler,
    BaseEdge,
    getSmoothStepPath,
    type EdgeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useTheme } from '../context/ThemeContext';
import { useWorkflow } from '../context/WorkflowContext';
import { colors, shadows, fonts } from '../theme';
import ActionNode from './nodes/ActionNode';
import ConditionalNode from './nodes/ConditionalNode';
import ResultNode from './nodes/ResultNode';
import NotifyNode from './nodes/NotifyNode';
import ParamNode from './nodes/ParamNode';
import CodeNode from './nodes/CodeNode';

/* ─── Toolbar items config ─── */
const toolbarItems = [
    { label: 'Action', color: colors.nodeBlue, shape: 'square' as const },
    { label: 'Conditional', color: colors.nodeYellow, shape: 'diamond' as const },
    { label: 'Result', color: colors.nodeGreen, shape: 'circle' as const },
    { label: 'Notify', color: colors.nodePurple, shape: 'icon' as const, icon: 'notifications' },
    { label: 'Code', color: colors.nodeGrey, shape: 'pill' as const },
    { label: 'Param', color: colors.nodeOrange, shape: 'hex' as const },
];

/* ─── Custom edge component with selection highlight ─── */
function SelectableEdge(props: EdgeProps) {
    const { isDark } = useTheme();
    const {
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
        selected,
        markerEnd,
    } = props;

    const [edgePath] = getSmoothStepPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition,
        targetPosition,
    });

    const defaultColor = isDark ? '#9ca3af' : '#6b7280';
    const selectedColor = colors.primary;

    return (
        <>
            {/* Invisible wider hitbox for easier clicking */}
            <path
                d={edgePath}
                fill="none"
                stroke="transparent"
                strokeWidth={20}
                style={{ cursor: 'pointer' }}
            />
            {/* Glow layer when selected */}
            {selected && (
                <path
                    d={edgePath}
                    fill="none"
                    stroke={selectedColor}
                    strokeWidth={6}
                    strokeOpacity={0.25}
                    style={{ filter: 'blur(3px)' }}
                />
            )}
            {/* Main edge */}
            <BaseEdge
                path={edgePath}
                markerEnd={markerEnd}
                style={{
                    stroke: selected ? selectedColor : defaultColor,
                    strokeWidth: selected ? 2.5 : 1.5,
                    transition: 'stroke 0.2s, stroke-width 0.2s',
                    cursor: 'pointer',
                }}
            />
        </>
    );
}

/* ─── Styles ─── */
const wrapper = (isDark: boolean): CSSProperties => ({
    flex: 1,
    backgroundColor: isDark ? '#0f1115' : '#ffffff',
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
});

const toolbarStyle = (isDark: boolean): CSSProperties => ({
    position: 'absolute',
    top: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight,
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    borderRadius: 16,
    padding: '8px 16px',
    display: 'flex',
    gap: 8,
    zIndex: 10,
    boxShadow: shadows.lg,
});

const toolItemStyle = (isDark: boolean, disabled: boolean): CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    padding: '8px 14px',
    borderRadius: 10,
    cursor: disabled ? 'not-allowed' : 'grab',
    transition: 'background 0.15s, opacity 0.15s',
    backgroundColor: 'transparent',
    color: isDark ? '#d1d5db' : '#4b5563',
    opacity: disabled ? 0.4 : 1,
    pointerEvents: disabled ? 'none' : 'auto',
});

const toolLabel = (isDark: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 500,
    color: isDark ? '#9ca3af' : '#6b7280',
});

const shapeBox = (color: string): CSSProperties => ({
    width: 18, height: 18, borderRadius: 4,
    backgroundColor: color, opacity: 0.85,
});
const diamondBox = (color: string): CSSProperties => ({
    width: 14, height: 14, backgroundColor: color,
    transform: 'rotate(45deg)', borderRadius: 2, opacity: 0.85,
});
const circleBox = (color: string): CSSProperties => ({
    width: 16, height: 16, borderRadius: '50%',
    backgroundColor: color, opacity: 0.85,
});
const pillBox = (color: string): CSSProperties => ({
    width: 22, height: 14, borderRadius: 7,
    backgroundColor: color, opacity: 0.85,
});
const hexBox = (color: string): CSSProperties => ({
    width: 16, height: 16, borderRadius: 3,
    backgroundColor: color, opacity: 0.85,
    clipPath: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
});

const hintBarStyle = (isDark: boolean): CSSProperties => ({
    position: 'absolute',
    bottom: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: 12,
    color: isDark ? '#9ca3af' : '#6b7280',
    backgroundColor: isDark ? colors.surfaceDark : '#ffffff',
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    padding: '6px 16px',
    borderRadius: 8,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    zIndex: 20,
    fontFamily: "'Inter', sans-serif",
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    pointerEvents: 'none',
});

/* ─── Save button styles ─── */
const saveButtonStyle = (_isDark: boolean): CSSProperties => ({
    position: 'absolute',
    top: 16,
    right: 16,
    padding: '10px 20px',
    backgroundColor: colors.primary,
    color: '#ffffff',
    border: 'none',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: shadows.blueMd,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontFamily: fonts.display,
    transition: 'box-shadow 0.2s, background-color 0.15s, transform 0.1s',
});

/* Lock indicator badge */
const lockBadge = (isDark: boolean): CSSProperties => ({
    position: 'absolute',
    top: 16,
    right: 210,
    padding: '8px 16px',
    backgroundColor: isDark ? '#78350f' : '#fef3c7',
    color: isDark ? '#fcd34d' : '#92400e',
    border: `1px solid ${isDark ? '#92400e' : '#fcd34d'}`,
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 600,
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontFamily: fonts.display,
    animation: 'fadeIn 0.2s ease-out',
});

/* ─── Save Modal styles ─── */
const modalOverlay: CSSProperties = {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    backdropFilter: 'blur(4px)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'fadeIn 0.2s ease-out',
};

const modalBox = (isDark: boolean): CSSProperties => ({
    width: 480,
    backgroundColor: isDark ? '#1f2937' : '#ffffff',
    borderRadius: 20,
    padding: 32,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    fontFamily: fonts.display,
    animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
});

const modalTitleStyle: CSSProperties = {
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 4,
    letterSpacing: '-0.02em',
};

const modalSubtitle = (isDark: boolean): CSSProperties => ({
    fontSize: 14,
    color: isDark ? '#9ca3af' : '#6b7280',
    marginBottom: 24,
});

const modalLabel = (isDark: boolean): CSSProperties => ({
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: isDark ? '#9ca3af' : '#6b7280',
    marginBottom: 8,
});

const modalInput = (isDark: boolean): CSSProperties => ({
    width: '100%',
    padding: 12,
    backgroundColor: isDark ? '#111827' : '#f9fafb',
    border: `1px solid ${isDark ? '#374151' : '#d1d5db'}`,
    borderRadius: 12,
    fontSize: 14,
    color: isDark ? '#e5e7eb' : '#1f2937',
    outline: 'none',
    fontFamily: fonts.display,
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
});

const modalTextarea = (isDark: boolean): CSSProperties => ({
    ...modalInput(isDark),
    minHeight: 80,
    resize: 'vertical',
    lineHeight: 1.6,
});

const modalActions: CSSProperties = {
    display: 'flex',
    gap: 12,
    marginTop: 24,
    justifyContent: 'flex-end',
};

const modalCancelBtn = (isDark: boolean): CSSProperties => ({
    padding: '10px 20px',
    backgroundColor: isDark ? '#374151' : '#f3f4f6',
    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
    color: isDark ? '#d1d5db' : '#4b5563',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: fonts.display,
    transition: 'background-color 0.15s',
});

const modalSaveBtn: CSSProperties = {
    padding: '10px 24px',
    backgroundColor: colors.primary,
    color: '#ffffff',
    border: 'none',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: shadows.blueMd,
    fontFamily: fonts.display,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    transition: 'box-shadow 0.2s, opacity 0.15s',
};

const successToast = (isDark: boolean): CSSProperties => ({
    position: 'absolute',
    top: 72,
    right: 16,
    padding: '12px 20px',
    backgroundColor: isDark ? '#065f46' : '#d1fae5',
    color: isDark ? '#6ee7b7' : '#065f46',
    border: `1px solid ${isDark ? '#047857' : '#6ee7b7'}`,
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    zIndex: 20,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    boxShadow: shadows.lg,
    animation: 'slideInRight 0.3s ease-out',
    fontFamily: fonts.display,
});

/* ─── Empty canvas state ─── */
const emptyCanvasStyle: CSSProperties = {
    position: 'absolute',
    top: '50%',
    left: '55%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center',
    zIndex: 5,
    pointerEvents: 'none',
};

function renderShape(item: (typeof toolbarItems)[0]) {
    if (item.shape === 'square') return <div style={shapeBox(item.color)} />;
    if (item.shape === 'diamond') return <div style={diamondBox(item.color)} />;
    if (item.shape === 'circle') return <div style={circleBox(item.color)} />;
    if (item.shape === 'pill') return <div style={pillBox(item.color)} />;
    if (item.shape === 'hex') return <div style={hexBox(item.color)} />;
    if (item.shape === 'icon')
        return (
            <span
                className="material-icons"
                style={{ color: item.color, fontSize: 16, marginBottom: 2 }}
            >
                {item.icon}
            </span>
        );
    return null;
}

/* ─── Inner canvas (needs ReactFlow context) ─── */
function InnerCanvas() {
    const { isDark } = useTheme();
    const {
        nodes,
        edges,
        selectedNodeId,
        onNodesChange,
        onEdgesChange,
        onConnect,
        selectNode,
        addNode,
        deleteNode,
        saveWorkflow,
        workflowName,
        workflowDescription,
        workflowId,
        isSaving,
        isLocked,
        setIsLocked,
    } = useWorkflow();

    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const { screenToFlowPosition } = useReactFlow();

    const [showSaveModal, setShowSaveModal] = useState(false);
    const [saveName, setSaveName] = useState('');
    const [saveDesc, setSaveDesc] = useState('');
    const [showSuccess, setShowSuccess] = useState(false);
    const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

    const nodeTypes: NodeTypes = useMemo(
        () => ({
            actionNode: ActionNode,
            conditionalNode: ConditionalNode,
            resultNode: ResultNode,
            notifyNode: NotifyNode,
            paramNode: ParamNode,
            codeNode: CodeNode,
        }),
        [],
    );

    const edgeTypes: EdgeTypes = useMemo(
        () => ({
            smoothstep: SelectableEdge,
            default: SelectableEdge,
        }),
        [],
    );

    const edgeDefaults = {
        style: { stroke: isDark ? '#9ca3af' : '#6b7280', strokeWidth: 1.5 },
        markerEnd: { type: 'arrowclosed' as const, color: isDark ? '#9ca3af' : '#6b7280' },
        type: 'smoothstep',
    };

    /* ─── Node click → select ─── */
    const onNodeClick: NodeMouseHandler = useCallback(
        (_event, node) => {
            selectNode(node.id);
            setSelectedEdgeId(null);
        },
        [selectNode],
    );

    /* ─── Edge click → select edge ─── */
    const onEdgeClick: EdgeMouseHandler = useCallback(
        (_event, edge) => {
            setSelectedEdgeId(edge.id);
            selectNode(null);
        },
        [selectNode],
    );

    /* ─── Pane click → deselect ─── */
    const onPaneClick = useCallback(() => {
        selectNode(null);
        setSelectedEdgeId(null);
    }, [selectNode]);

    /* ─── Keyboard delete ─── */
    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (isLocked) return; // Block when locked
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedNodeId) {
                    e.preventDefault();
                    deleteNode(selectedNodeId);
                }
                /* Edge delete is handled by React Flow's deleteKeyCode */
            }
        },
        [selectedNodeId, deleteNode, isLocked],
    );

    /* ─── Drag & Drop from toolbar ─── */
    const onDragOver = useCallback((e: DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (e: DragEvent) => {
            if (isLocked) return; // Block when locked
            e.preventDefault();
            const toolbarLabel = e.dataTransfer.getData('application/reactflow-type');
            if (!toolbarLabel) return;

            const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            addNode(toolbarLabel, position);
        },
        [screenToFlowPosition, addNode, isLocked],
    );

    /* ─── Lock toggle from Controls ─── */
    const onInteractiveChange = useCallback(
        (interactive: boolean) => {
            setIsLocked(!interactive);
        },
        [setIsLocked],
    );

    /* ─── Save handler ─── */
    const handleOpenSave = () => {
        setSaveName(workflowName || '');
        setSaveDesc(workflowDescription || '');
        setShowSaveModal(true);
    };

    const handleSave = async () => {
        if (!saveName.trim()) return;
        await saveWorkflow(saveName.trim(), saveDesc.trim());
        setShowSaveModal(false);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 3000);
    };

    /* Highlight the selected node */
    const styledNodes = nodes.map((n) => ({
        ...n,
        selected: n.id === selectedNodeId,
        style: {
            ...n.style,
            outline: n.id === selectedNodeId ? `2px solid ${colors.primary}` : undefined,
            outlineOffset: n.id === selectedNodeId ? 2 : undefined,
            borderRadius: n.id === selectedNodeId ? 8 : undefined,
        },
    }));

    /* Mark edges as selected */
    const styledEdges = edges.map((e) => ({
        ...e,
        selected: e.id === selectedEdgeId,
        type: 'smoothstep',
    }));

    /* Build hint text */
    const getHintText = () => {
        if (isLocked) return { icon: 'lock', text: 'Canvas is locked — unlock to make changes' };
        if (selectedEdgeId) return { icon: 'info_outline', text: 'Press Delete or Backspace to remove this connection' };
        if (selectedNodeId) return { icon: 'info_outline', text: 'Press Delete or Backspace to remove node' };
        return null;
    };
    const hint = getHintText();

    return (
        <section
            style={wrapper(isDark)}
            ref={reactFlowWrapper}
            tabIndex={0}
            onKeyDown={onKeyDown}
        >
            {/* Toolbar */}
            <div style={toolbarStyle(isDark)}>
                {toolbarItems.map((item) => (
                    <div
                        key={item.label}
                        style={toolItemStyle(isDark, isLocked)}
                        draggable={!isLocked}
                        onDragStart={(e) => {
                            if (isLocked) { e.preventDefault(); return; }
                            e.dataTransfer.setData('application/reactflow-type', item.label);
                            e.dataTransfer.effectAllowed = 'move';
                        }}
                        onMouseEnter={(e) => {
                            if (!isLocked) e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#f3f4f6';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                        title={isLocked ? 'Canvas is locked' : `Drag to add ${item.label} node`}
                    >
                        {renderShape(item)}
                        <span style={toolLabel(isDark)}>{item.label}</span>
                    </div>
                ))}
            </div>

            {/* Lock indicator */}
            {isLocked && (
                <div style={lockBadge(isDark)}>
                    <span className="material-icons" style={{ fontSize: 16 }}>lock</span>
                    Locked
                </div>
            )}

            {/* Save Workflow Button */}
            <button
                style={saveButtonStyle(isDark)}
                onClick={handleOpenSave}
                onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = shadows.blueLg;
                    e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = shadows.blueMd;
                    e.currentTarget.style.transform = 'translateY(0)';
                }}
            >
                <span className="material-icons" style={{ fontSize: 18 }}>save</span>
                {workflowId ? 'Update Workflow' : 'Save Workflow'}
            </button>

            {/* Success toast */}
            {showSuccess && (
                <div style={successToast(isDark)}>
                    <span className="material-icons" style={{ fontSize: 18 }}>check_circle</span>
                    Workflow saved successfully!
                </div>
            )}

            {/* Empty canvas prompt */}
            {nodes.length === 0 && !showSaveModal && (
                <div style={emptyCanvasStyle}>
                    <span className="material-icons" style={{
                        fontSize: 56,
                        color: isDark ? '#374151' : '#d1d5db',
                        marginBottom: 12,
                        display: 'block',
                    }}>
                        account_tree
                    </span>
                    <div style={{
                        fontSize: 18,
                        fontWeight: 600,
                        color: isDark ? '#6b7280' : '#9ca3af',
                        marginBottom: 6,
                        fontFamily: fonts.display,
                    }}>
                        Start Building Your Workflow
                    </div>
                    <div style={{
                        fontSize: 14,
                        color: isDark ? '#4b5563' : '#d1d5db',
                        fontFamily: fonts.display,
                        lineHeight: 1.5,
                    }}>
                        Drag blocks from the toolbar above, or describe your workflow<br />
                        in the planner chat on the left.
                    </div>
                </div>
            )}

            {/* React Flow canvas */}
            <ReactFlow
                nodes={styledNodes}
                edges={styledEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                defaultEdgeOptions={edgeDefaults}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={onNodeClick}
                onEdgeClick={onEdgeClick}
                onPaneClick={onPaneClick}
                onDragOver={onDragOver}
                onDrop={onDrop}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                proOptions={{ hideAttribution: true }}
                deleteKeyCode={isLocked ? null : ['Backspace', 'Delete']}
                style={{ flex: 1 }}
                nodesDraggable={!isLocked}
                nodesConnectable={!isLocked}
                elementsSelectable
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={20}
                    size={1}
                    color={isDark ? '#374151' : '#e5e7eb'}
                />
                <Controls
                    style={{
                        bottom: 24,
                        left: 16,
                        display: 'flex',
                        flexDirection: 'column',
                    }}
                    showInteractive
                    onInteractiveChange={onInteractiveChange}
                />
            </ReactFlow>

            {/* Hint bar */}
            {hint && (
                <div style={hintBarStyle(isDark)}>
                    <span className="material-icons" style={{ fontSize: 14 }}>{hint.icon}</span>
                    {hint.text}
                </div>
            )}

            {/* Save Modal */}
            {showSaveModal && (
                <div style={modalOverlay} onClick={() => setShowSaveModal(false)}>
                    <div style={modalBox(isDark)} onClick={(e) => e.stopPropagation()}>
                        <div style={modalTitleStyle}>
                            <span className="material-icons" style={{ fontSize: 24, color: colors.primary, verticalAlign: 'middle', marginRight: 8 }}>
                                save
                            </span>
                            {workflowId ? 'Update Workflow' : 'Save Workflow'}
                        </div>
                        <div style={modalSubtitle(isDark)}>
                            {workflowId
                                ? 'Update the saved workflow with your latest changes.'
                                : 'Save your workflow so you can access it later from the Workflow Library.'}
                        </div>

                        <div style={{ marginBottom: 16 }}>
                            <label style={modalLabel(isDark)}>Workflow Name *</label>
                            <input
                                style={modalInput(isDark)}
                                value={saveName}
                                onChange={(e) => setSaveName(e.target.value)}
                                placeholder="e.g., Sales Data Pipeline"
                                autoFocus
                                onFocus={(e) => {
                                    e.currentTarget.style.borderColor = colors.primary;
                                }}
                                onBlur={(e) => {
                                    e.currentTarget.style.borderColor = isDark ? '#374151' : '#d1d5db';
                                }}
                            />
                        </div>

                        <div>
                            <label style={modalLabel(isDark)}>Description</label>
                            <textarea
                                style={modalTextarea(isDark)}
                                value={saveDesc}
                                onChange={(e) => setSaveDesc(e.target.value)}
                                placeholder="Describe what this workflow does..."
                                onFocus={(e) => {
                                    e.currentTarget.style.borderColor = colors.primary;
                                }}
                                onBlur={(e) => {
                                    e.currentTarget.style.borderColor = isDark ? '#374151' : '#d1d5db';
                                }}
                            />
                        </div>

                        <div style={{ ...modalSubtitle(isDark), marginTop: 12, marginBottom: 0, fontSize: 12 }}>
                            <span className="material-icons" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }}>info</span>
                            {nodes.length} nodes · {edges.length} connections
                        </div>

                        <div style={modalActions}>
                            <button
                                style={modalCancelBtn(isDark)}
                                onClick={() => setShowSaveModal(false)}
                            >
                                Cancel
                            </button>
                            <button
                                style={{
                                    ...modalSaveBtn,
                                    opacity: (!saveName.trim() || isSaving) ? 0.6 : 1,
                                    cursor: (!saveName.trim() || isSaving) ? 'not-allowed' : 'pointer',
                                }}
                                onClick={handleSave}
                                disabled={!saveName.trim() || isSaving}
                            >
                                <span className="material-icons" style={{ fontSize: 16 }}>
                                    {isSaving ? 'hourglass_empty' : 'save'}
                                </span>
                                {isSaving ? 'Saving...' : workflowId ? 'Update' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}

/* ─── Outer wrapper with ReactFlowProvider ─── */
export default function WorkflowCanvas() {
    return (
        <ReactFlowProvider>
            <InnerCanvas />
        </ReactFlowProvider>
    );
}
