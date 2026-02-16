import { useState, useRef, useEffect, type CSSProperties, type KeyboardEvent } from 'react';
import { useTheme } from '../context/ThemeContext';
import { colors, fonts } from '../theme';
import FileAttachmentModal from './FileAttachmentModal';
import { useWorkflow } from '../context/WorkflowContext';
import type { NodeConfig } from '../context/WorkflowContext';

/* ─── Types ─── */

interface Message {
    id: number;
    sender: 'planner' | 'user';
    text: string;
    citations?: string[];
    status?: 'GATHERING_INFO' | 'READY_TO_CREATE';
    currentParameters?: Record<string, unknown>;
    workflowPlan?: WorkflowPlan | null;
    isLoading?: boolean;
}

interface WorkflowPlan {
    goal: string;
    steps: {
        id: string;
        type: string;
        label: string;
        description: string;
        config?: Record<string, unknown>;
    }[];
    extracted_parameters: Record<string, unknown>;
}

interface ConversationEntry {
    role: 'user' | 'assistant';
    content: string;
}

interface AttachedFile {
    name: string;
    size: number;
    source: 'library' | 'upload';
}

interface PlannerAPIResponse {
    status: 'GATHERING_INFO' | 'READY_TO_CREATE';
    message_to_user: string;
    rag_citations: string[];
    current_parameters: Record<string, unknown>;
    workflow_plan: WorkflowPlan | null;
}

const PLANNER_API = 'http://localhost:8000/api/planner';
const CANVAS_API = 'http://localhost:8000/api/canvas';

/* ─── Helpers ─── */

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

let msgIdCounter = 2;
const nextId = () => msgIdCounter++;

/* ─── Styles ─── */

const sidebar = (isDark: boolean): CSSProperties => ({
    width: 400,
    display: 'flex',
    flexDirection: 'column',
    borderRight: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight,
    flexShrink: 0,
    position: 'relative',
    zIndex: 10,
    boxShadow: '1px 0 2px rgba(0,0,0,0.04)',
    fontFamily: fonts.display,
});

const headerBar = (isDark: boolean): CSSProperties => ({
    padding: '14px 16px',
    borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
});

const headerTitle = (isDark: boolean): CSSProperties => ({
    fontWeight: 600,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: isDark ? colors.textMutedLight : colors.textMuted,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
});

const statusDot = (healthy: boolean): CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: '50%',
    backgroundColor: healthy ? '#22c55e' : '#ef4444',
    boxShadow: healthy ? '0 0 6px rgba(34,197,94,0.4)' : '0 0 6px rgba(239,68,68,0.4)',
    flexShrink: 0,
});

const badge = (isDark: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    backgroundColor: isDark ? '#14532d' : '#dcfce7',
    color: isDark ? '#86efac' : '#166534',
});

const chatArea: CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
};

const msgRow = (isUser: boolean): CSSProperties => ({
    display: 'flex',
    gap: 10,
    flexDirection: isUser ? 'row-reverse' : 'row',
    animation: 'fadeSlideIn 0.25s ease-out',
});

const avatarCircle = (type: 'planner' | 'user', isDark: boolean): CSSProperties => ({
    width: 30,
    height: 30,
    minWidth: 30,
    borderRadius: '50%',
    backgroundColor: type === 'planner'
        ? isDark ? '#581c87' : '#f3e8ff'
        : isDark ? '#374151' : '#e5e7eb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
});

const avatarIcon = (type: 'planner' | 'user', isDark: boolean): CSSProperties => ({
    fontSize: 14,
    color: type === 'planner'
        ? isDark ? '#d8b4fe' : '#9333ea'
        : isDark ? '#d1d5db' : '#4b5563',
});

const msgMeta = (isUser: boolean): CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    alignItems: isUser ? 'flex-end' : 'flex-start',
    maxWidth: '85%',
    minWidth: 0,
});

const senderLabel = (isDark: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 500,
    color: isDark ? '#6b7280' : '#9ca3af',
});

const bubbleBase = (isDark: boolean, isUser: boolean): CSSProperties => ({
    padding: '10px 14px',
    borderRadius: 12,
    fontSize: 13.5,
    lineHeight: 1.55,
    border: `1px solid ${isUser
        ? isDark ? '#1e3a5f' : '#dbeafe'
        : isDark ? colors.borderDark : colors.borderLight
        }`,
    backgroundColor: isUser
        ? isDark ? 'rgba(30, 58, 95, 0.3)' : '#eff6ff'
        : isDark ? '#1f2937' : '#f8f9fa',
    color: isUser
        ? isDark ? '#bfdbfe' : '#1e3a5f'
        : isDark ? '#e5e7eb' : '#1f2937',
    ...(isUser
        ? { borderTopRightRadius: 2 }
        : { borderTopLeftRadius: 2 }),
    wordBreak: 'break-word' as const,
});

const citationBar = (_isDark: boolean): CSSProperties => ({
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
    marginTop: 8,
});

const citationChip = (isDark: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    borderRadius: 6,
    fontSize: 10,
    fontWeight: 600,
    backgroundColor: isDark ? 'rgba(168,85,247,0.12)' : '#f5f3ff',
    border: `1px solid ${isDark ? 'rgba(168,85,247,0.25)' : '#e9d5ff'}`,
    color: isDark ? '#c4b5fd' : '#7c3aed',
    fontFamily: fonts.mono,
});

const readyBanner = (isDark: boolean): CSSProperties => ({
    marginTop: 10,
    padding: '12px 14px',
    borderRadius: 10,
    background: isDark
        ? 'linear-gradient(135deg, #14532d 0%, #1a3a2a 100%)'
        : 'linear-gradient(135deg, #dcfce7 0%, #d1fae5 100%)',
    border: `1px solid ${isDark ? '#22c55e33' : '#86efac'}`,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
});

const createBtn: CSSProperties = {
    marginLeft: 'auto',
    padding: '8px 16px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    border: 'none',
    backgroundColor: '#22c55e',
    color: '#ffffff',
    fontFamily: fonts.display,
    boxShadow: '0 2px 8px rgba(34,197,94,0.3)',
    transition: 'transform 0.1s, box-shadow 0.15s',
    whiteSpace: 'nowrap',
};

/* Loading dots animation */
const loadingDots: CSSProperties = {
    display: 'inline-flex',
    gap: 4,
    padding: '12px 16px',
};

const dot = (delay: number, isDark: boolean): CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: '50%',
    backgroundColor: isDark ? '#6b7280' : '#9ca3af',
    animation: `dotPulse 1.2s ease-in-out ${delay}s infinite`,
});

const inputBar = (isDark: boolean): CSSProperties => ({
    padding: 14,
    backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight,
    borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
});

const inputWrapper: CSSProperties = {
    position: 'relative',
};

const inputField = (isDark: boolean): CSSProperties => ({
    width: '100%',
    paddingLeft: 38,
    paddingRight: 40,
    paddingTop: 11,
    paddingBottom: 11,
    backgroundColor: isDark ? '#111827' : '#ffffff',
    border: `1px solid ${isDark ? '#374151' : '#d1d5db'}`,
    borderRadius: 12,
    outline: 'none',
    fontSize: 13.5,
    color: isDark ? '#e5e7eb' : '#1f2937',
    fontFamily: fonts.display,
    boxSizing: 'border-box',
    transition: 'box-shadow 0.15s, border-color 0.15s',
    resize: 'none',
    overflow: 'hidden',
    minHeight: 42,
    maxHeight: 88,
    lineHeight: '1.4',
});

const attachBtn = (isDark: boolean): CSSProperties => ({
    position: 'absolute',
    left: 4,
    bottom: 8,
    color: isDark ? colors.textMutedLight : colors.textMuted,
    fontSize: 18,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 5,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.15s, background-color 0.15s',
});

const sendBtnStyle = (isDark: boolean, hasText: boolean): CSSProperties => ({
    position: 'absolute',
    right: 5,
    bottom: 6,
    background: hasText ? colors.primary : 'transparent',
    border: 'none',
    cursor: hasText ? 'pointer' : 'default',
    color: hasText ? '#ffffff' : isDark ? '#4b5563' : '#9ca3af',
    display: 'flex',
    alignItems: 'center',
    padding: 5,
    borderRadius: 8,
    transition: 'background 0.15s, color 0.15s',
});

const attachedFilesArea = (isDark: boolean): CSSProperties => ({
    paddingTop: 8,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 5,
    ...(isDark ? {} : {}),
});

const fileChip = (isDark: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 9px',
    borderRadius: 7,
    fontSize: 11,
    fontWeight: 500,
    backgroundColor: isDark ? 'rgba(59,130,246,0.1)' : '#eff6ff',
    border: `1px solid ${isDark ? 'rgba(59,130,246,0.2)' : '#dbeafe'}`,
    color: isDark ? '#93c5fd' : '#2563eb',
    fontFamily: fonts.display,
});

const chipRemove: CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    color: 'inherit',
    opacity: 0.6,
};

const parameterPanel = (isDark: boolean): CSSProperties => ({
    margin: '8px 0 0',
    padding: '12px 14px',
    borderRadius: 10,
    backgroundColor: isDark ? 'rgba(59,130,246,0.06)' : '#f0f9ff',
    border: `1px solid ${isDark ? 'rgba(59,130,246,0.15)' : '#dbeafe'}`,
    fontSize: 11,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
});

const pillarSection = (isDark: boolean, filled: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '8px 0',
    borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
    opacity: filled ? 1 : 0.5,
});

const pillarIcon: CSSProperties = {
    width: 26,
    height: 26,
    minWidth: 26,
    borderRadius: 7,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
};

const pillarLabel = (isDark: boolean): CSSProperties => ({
    fontSize: 9.5,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: isDark ? '#6b7280' : '#9ca3af',
    marginBottom: 2,
});

const pillarValue = (isDark: boolean, filled: boolean): CSSProperties => ({
    fontSize: 11.5,
    lineHeight: 1.4,
    color: filled
        ? isDark ? '#e5e7eb' : '#1f2937'
        : isDark ? '#4b5563' : '#9ca3af',
    fontStyle: filled ? 'normal' : 'italic',
    wordBreak: 'break-word',
});

/* ─── CSS Keyframes (injected once) ─── */

const KEYFRAMES_ID = 'planner-sidebar-keyframes';

function injectKeyframes() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(KEYFRAMES_ID)) return;
    const style = document.createElement('style');
    style.id = KEYFRAMES_ID;
    style.textContent = `
        @keyframes dotPulse {
            0%, 80%, 100% { transform: scale(0.4); opacity: 0.4; }
            40% { transform: scale(1); opacity: 1; }
        }
        @keyframes fadeSlideIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
        }
    `;
    document.head.appendChild(style);
}

/* ─── Component ─── */

export default function PlannerSidebar() {
    const { isDark } = useTheme();
    const { setBatchNodesAndEdges, setWorkflowName, setWorkflowDescription } = useWorkflow();

    // State
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 1,
            sender: 'planner',
            text: "Hello! I'm the **Architect** — your workflow planning assistant. Describe what you want to build and I'll design the workflow for you.\n\nI can also reference documents you've uploaded to the knowledge base.",
        },
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [conversationHistory, setConversationHistory] = useState<ConversationEntry[]>([]);
    const [showAttachModal, setShowAttachModal] = useState(false);
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
    const [backendHealthy, setBackendHealthy] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);

    const chatEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Inject keyframes on mount
    useEffect(() => {
        injectKeyframes();
    }, []);

    // Health check on mount
    useEffect(() => {
        fetch(`${PLANNER_API}/health`)
            .then(r => r.json())
            .then(data => setBackendHealthy(data.status === 'healthy' || data.status === 'degraded'))
            .catch(() => setBackendHealthy(false));
    }, []);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // ── Send message ──────────────────────────────────

    const sendMessage = async () => {
        const text = input.trim();
        if (!text || isLoading) return;

        // Add user message
        const userMsg: Message = { id: nextId(), sender: 'user', text };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.overflow = 'hidden';
        }
        setIsLoading(true);

        // Add loading indicator
        const loadingId = nextId();
        setMessages(prev => [...prev, { id: loadingId, sender: 'planner', text: '', isLoading: true }]);

        // Update conversation history
        const newHistory: ConversationEntry[] = [
            ...conversationHistory,
            { role: 'user', content: text },
        ];

        try {
            const response = await fetch(`${PLANNER_API}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    conversation_history: newHistory,
                    attached_files: attachedFiles.length > 0
                        ? attachedFiles.map(f => f.name)
                        : null,
                }),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
                throw new Error(err.detail || `HTTP ${response.status}`);
            }

            const data: PlannerAPIResponse = await response.json();

            // Replace loading message with the real response
            const agentMsg: Message = {
                id: loadingId,
                sender: 'planner',
                text: data.message_to_user,
                citations: data.rag_citations.length > 0 ? data.rag_citations : undefined,
                status: data.status,
                currentParameters: Object.keys(data.current_parameters).length > 0
                    ? data.current_parameters
                    : undefined,
                workflowPlan: data.workflow_plan,
            };

            setMessages(prev => prev.map(m => m.id === loadingId ? agentMsg : m));

            // Update conversation history with the assistant's response
            setConversationHistory([
                ...newHistory,
                { role: 'assistant', content: data.message_to_user },
            ]);

            // Clear attached files after sending
            if (attachedFiles.length > 0) {
                setAttachedFiles([]);
            }

        } catch (err) {
            const errorMsg: Message = {
                id: loadingId,
                sender: 'planner',
                text: `⚠️ **Error**: ${err instanceof Error ? err.message : 'Failed to reach the Planner Agent'}.\n\nMake sure the backend is running at \`http://localhost:8000\`.`,
            };
            setMessages(prev => prev.map(m => m.id === loadingId ? errorMsg : m));
        } finally {
            setIsLoading(false);
            inputRef.current?.focus();
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    /* Auto-resize textarea up to 4 lines */
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 88)}px`;
        el.style.overflow = el.scrollHeight > 88 ? 'auto' : 'hidden';
    };

    const handleFileAttached = (file: AttachedFile) => {
        setAttachedFiles(prev => [...prev, file]);
    };

    const removeAttachedFile = (index: number) => {
        setAttachedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleCreateWorkflow = async (plan: WorkflowPlan) => {
        setIsGenerating(true);

        // Add a generating message
        const genMsgId = nextId();
        setMessages(prev => [...prev, {
            id: genMsgId,
            sender: 'planner' as const,
            text: '⚙️ **Generating workflow on canvas...** Using A2UI protocol to create your flowchart.',
            isLoading: true,
        }]);

        try {
            // Find the most recent READY_TO_CREATE message to get current_parameters
            const readyMsg = [...messages].reverse().find(
                m => m.status === 'READY_TO_CREATE' && m.currentParameters
            );

            const res = await fetch(`${CANVAS_API}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflow_plan: plan,
                    current_parameters: readyMsg?.currentParameters || null,
                }),
            });

            if (!res.ok) {
                throw new Error(`Canvas Agent returned ${res.status}`);
            }

            const data = await res.json();

            if (data.success) {
                // Push nodes, edges, configs to the canvas
                setBatchNodesAndEdges(
                    data.nodes,
                    data.edges,
                    data.node_configs as Record<string, NodeConfig>,
                );

                // Set workflow metadata
                if (data.workflow_name) setWorkflowName(data.workflow_name);
                if (data.workflow_description) setWorkflowDescription(data.workflow_description);

                // Replace the generating message with success
                setMessages(prev =>
                    prev.map(m =>
                        m.id === genMsgId
                            ? {
                                ...m,
                                text: `✅ **Workflow created!** ${data.nodes.length} blocks placed on canvas.\n\n` +
                                    `📋 **${data.workflow_name}**\n` +
                                    `${data.nodes.map((n: { data?: { label?: string } }) => `• ${n.data?.label || 'Block'}`).join('\n')}\n\n` +
                                    `You can now drag blocks to reposition them, click to configure, and connect them as needed.`,
                                isLoading: false,
                            }
                            : m
                    )
                );
            } else {
                throw new Error(data.message || 'Canvas generation failed');
            }
        } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            // Replace generating message with error
            setMessages(prev =>
                prev.map(m =>
                    m.id === genMsgId
                        ? {
                            ...m,
                            text: `❌ **Failed to generate workflow:** ${errorMsg}\n\nPlease try again or create blocks manually.`,
                            isLoading: false,
                        }
                        : m
                )
            );
        } finally {
            setIsGenerating(false);
        }
    };

    // ── Render message text (simple markdown) ─────────

    const renderText = (text: string) => {
        // Convert **bold** and `code` for basic formatting
        const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g);
        return parts.map((part, i) => {
            if (part === '\n') return <br key={i} />;
            if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={i}>{part.slice(2, -2)}</strong>;
            }
            if (part.startsWith('`') && part.endsWith('`')) {
                return (
                    <code
                        key={i}
                        style={{
                            padding: '1px 5px',
                            borderRadius: 4,
                            fontSize: '0.88em',
                            backgroundColor: isDark ? '#1f2937' : '#f3f4f6',
                            fontFamily: fonts.mono,
                        }}
                    >
                        {part.slice(1, -1)}
                    </code>
                );
            }
            return <span key={i}>{part}</span>;
        });
    };

    // ── JSX ────────────────────────────────────────────

    return (
        <aside style={sidebar(isDark)}>
            {/* Header */}
            <div style={headerBar(isDark)}>
                <h2 style={headerTitle(isDark)}>
                    <span className="material-icons-outlined" style={{ fontSize: 16, color: isDark ? '#a78bfa' : '#7c3aed' }}>
                        smart_toy
                    </span>
                    Planner Agent
                </h2>
                <span style={badge(isDark)}>
                    <span style={statusDot(backendHealthy)} />
                    {backendHealthy ? 'Online' : 'Offline'}
                </span>
            </div>

            {/* Chat messages */}
            <div style={chatArea}>
                {messages.map(m => {
                    const isUser = m.sender === 'user';
                    return (
                        <div key={m.id} style={msgRow(isUser)}>
                            {/* Avatar */}
                            <div style={avatarCircle(m.sender, isDark)}>
                                <span
                                    className={isUser ? 'material-icons' : 'material-icons-outlined'}
                                    style={avatarIcon(m.sender, isDark)}
                                >
                                    {isUser ? 'person' : 'smart_toy'}
                                </span>
                            </div>

                            {/* Message content */}
                            <div style={msgMeta(isUser)}>
                                <span style={senderLabel(isDark)}>
                                    {isUser ? 'You' : 'Architect'}
                                </span>

                                {m.isLoading ? (
                                    /* Loading dots */
                                    <div style={{ ...bubbleBase(isDark, false), padding: 0 }}>
                                        <div style={loadingDots}>
                                            <div style={dot(0, isDark)} />
                                            <div style={dot(0.15, isDark)} />
                                            <div style={dot(0.3, isDark)} />
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {/* Message bubble */}
                                        <div style={bubbleBase(isDark, isUser)}>
                                            <div style={{ margin: 0 }}>
                                                {renderText(m.text)}
                                            </div>
                                        </div>

                                        {/* RAG citations */}
                                        {m.citations && m.citations.length > 0 && (
                                            <div style={citationBar(isDark)}>
                                                <span
                                                    className="material-icons-outlined"
                                                    style={{ fontSize: 12, color: isDark ? '#a78bfa' : '#7c3aed', marginTop: 1 }}
                                                >
                                                    menu_book
                                                </span>
                                                {m.citations.map((c, i) => (
                                                    <span key={i} style={citationChip(isDark)}>
                                                        {c}
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        {/* Workflow Requirements — Input / Task / Output */}
                                        {m.currentParameters && Object.keys(m.currentParameters).length > 0 && (() => {
                                            const params = m.currentParameters!;
                                            const inputVal = String(params.input ?? params.input_source ?? '');
                                            const taskVal = String(params.task ?? params.goal ?? '');
                                            const outputVal = String(params.output ?? params.output_format ?? '');

                                            const pillars = [
                                                {
                                                    key: 'input',
                                                    label: 'INPUT',
                                                    icon: 'download',
                                                    bg: isDark ? 'rgba(59,130,246,0.15)' : '#dbeafe',
                                                    iconColor: isDark ? '#60a5fa' : '#3b82f6',
                                                    value: inputVal,
                                                },
                                                {
                                                    key: 'task',
                                                    label: 'TASK',
                                                    icon: 'settings',
                                                    bg: isDark ? 'rgba(168,85,247,0.15)' : '#f3e8ff',
                                                    iconColor: isDark ? '#c084fc' : '#9333ea',
                                                    value: taskVal,
                                                },
                                                {
                                                    key: 'output',
                                                    label: 'OUTPUT',
                                                    icon: 'upload',
                                                    bg: isDark ? 'rgba(34,197,94,0.15)' : '#dcfce7',
                                                    iconColor: isDark ? '#4ade80' : '#16a34a',
                                                    value: outputVal,
                                                },
                                            ];

                                            return (
                                                <div style={parameterPanel(isDark)}>
                                                    <div style={{
                                                        fontSize: 9.5,
                                                        fontWeight: 700,
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.06em',
                                                        color: isDark ? '#60a5fa' : '#3b82f6',
                                                        marginBottom: 6,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 5,
                                                    }}>
                                                        <span className="material-icons" style={{ fontSize: 12 }}>checklist</span>
                                                        Workflow Requirements
                                                    </div>
                                                    {pillars.map((p, idx) => {
                                                        const filled = !!p.value && p.value !== 'null' && p.value !== 'Not yet specified' && p.value !== 'undefined' && p.value !== '' && !p.value.startsWith('NOT FOUND');
                                                        const isLast = idx === pillars.length - 1;
                                                        return (
                                                            <div
                                                                key={p.key}
                                                                style={{
                                                                    ...pillarSection(isDark, filled),
                                                                    ...(isLast ? { borderBottom: 'none', paddingBottom: 4 } : {}),
                                                                }}
                                                            >
                                                                <div style={{
                                                                    ...pillarIcon,
                                                                    backgroundColor: p.bg,
                                                                }}>
                                                                    <span
                                                                        className="material-icons"
                                                                        style={{ fontSize: 14, color: p.iconColor }}
                                                                    >
                                                                        {p.icon}
                                                                    </span>
                                                                </div>
                                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                                    <div style={pillarLabel(isDark)}>
                                                                        {p.label}
                                                                    </div>
                                                                    <div style={pillarValue(isDark, filled)}>
                                                                        {filled ? p.value : 'Not yet specified'}
                                                                    </div>
                                                                </div>
                                                                {filled && (
                                                                    <span
                                                                        className="material-icons"
                                                                        style={{
                                                                            fontSize: 14,
                                                                            color: isDark ? '#22c55e' : '#16a34a',
                                                                            marginTop: 2,
                                                                            flexShrink: 0,
                                                                        }}
                                                                    >
                                                                        check_circle
                                                                    </span>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })()}

                                        {/* READY_TO_CREATE banner */}
                                        {m.status === 'READY_TO_CREATE' && m.workflowPlan && (
                                            <div style={readyBanner(isDark)}>
                                                <span
                                                    className="material-icons"
                                                    style={{ fontSize: 20, color: '#22c55e' }}
                                                >
                                                    check_circle
                                                </span>
                                                <div>
                                                    <div style={{
                                                        fontSize: 12,
                                                        fontWeight: 700,
                                                        color: isDark ? '#86efac' : '#166534',
                                                    }}>
                                                        Workflow Ready
                                                    </div>
                                                    <div style={{
                                                        fontSize: 11,
                                                        color: isDark ? '#6ee7b7' : '#15803d',
                                                        marginTop: 2,
                                                    }}>
                                                        {m.workflowPlan.steps.length} steps · {m.workflowPlan.goal}
                                                    </div>
                                                </div>
                                                <button
                                                    style={{
                                                        ...createBtn,
                                                        opacity: isGenerating ? 0.6 : 1,
                                                        cursor: isGenerating ? 'wait' : 'pointer',
                                                    }}
                                                    disabled={isGenerating}
                                                    onClick={() => handleCreateWorkflow(m.workflowPlan!)}
                                                    onMouseEnter={e => {
                                                        if (!isGenerating) {
                                                            e.currentTarget.style.transform = 'scale(1.03)';
                                                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(34,197,94,0.4)';
                                                        }
                                                    }}
                                                    onMouseLeave={e => {
                                                        e.currentTarget.style.transform = 'scale(1)';
                                                        e.currentTarget.style.boxShadow = '0 2px 8px rgba(34,197,94,0.3)';
                                                    }}
                                                >
                                                    {isGenerating ? 'Generating…' : 'Create Plan →'}
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
                <div ref={chatEndRef} />
            </div>

            {/* Input bar */}
            <div style={inputBar(isDark)}>
                {/* Attached files */}
                {attachedFiles.length > 0 && (
                    <div style={attachedFilesArea(isDark)}>
                        {attachedFiles.map((f, i) => (
                            <div key={i} style={fileChip(isDark)}>
                                <span className="material-icons" style={{ fontSize: 13 }}>
                                    {f.source === 'library' ? 'local_library' : 'description'}
                                </span>
                                <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {f.name}
                                </span>
                                <span style={{ opacity: 0.6, fontSize: 10 }}>
                                    {formatSize(f.size)}
                                </span>
                                <button style={chipRemove} onClick={() => removeAttachedFile(i)}>
                                    <span className="material-icons" style={{ fontSize: 13 }}>close</span>
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <div style={{ ...inputWrapper, marginTop: attachedFiles.length > 0 ? 6 : 0 }}>
                    <button
                        style={attachBtn(isDark)}
                        onClick={() => setShowAttachModal(true)}
                        onMouseEnter={e => {
                            e.currentTarget.style.color = colors.primary;
                            e.currentTarget.style.backgroundColor = isDark
                                ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.06)';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.color = isDark ? colors.textMutedLight : colors.textMuted;
                            e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                        title="Attach file"
                    >
                        <span className="material-icons-outlined" style={{ fontSize: 18, transform: 'rotate(45deg)' }}>
                            attach_file
                        </span>
                    </button>
                    <textarea
                        ref={inputRef}
                        rows={1}
                        value={input}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        placeholder={isLoading ? 'Architect is thinking…' : 'Describe your workflow…'}
                        disabled={isLoading}
                        style={{
                            ...inputField(isDark),
                            opacity: isLoading ? 0.6 : 1,
                        }}
                        onFocus={e => {
                            e.currentTarget.style.boxShadow = `0 0 0 2px ${colors.primary}`;
                            e.currentTarget.style.borderColor = 'transparent';
                        }}
                        onBlur={e => {
                            e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
                            e.currentTarget.style.borderColor = isDark ? '#374151' : '#d1d5db';
                        }}
                    />
                    <button
                        style={sendBtnStyle(isDark, input.trim().length > 0)}
                        onClick={sendMessage}
                        disabled={isLoading || !input.trim()}
                        title="Send"
                    >
                        <span className="material-icons" style={{ fontSize: 18 }}>arrow_upward</span>
                    </button>
                </div>
            </div>

            {/* Attachment modal */}
            <FileAttachmentModal
                open={showAttachModal}
                onClose={() => setShowAttachModal(false)}
                onFileAttached={handleFileAttached}
            />
        </aside>
    );
}
