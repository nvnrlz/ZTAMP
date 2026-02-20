import { useState, useRef, useEffect, type CSSProperties, type KeyboardEvent } from 'react';
import { useTheme } from '../context/ThemeContext';
import { colors, fonts } from '../theme';
import FileAttachmentModal from './FileAttachmentModal';
import { useWorkflow } from '../context/WorkflowContext';

/* ─── Types ─── */

interface WorkflowStepData {
    step_number: number;
    title: string;
    description: string;
    action_type: string;
}

interface WorkflowParameterData {
    name: string;
    status: 'provided' | 'deferred';
    value: string | null;
    description: string;
}

interface MissingParameterAuditData {
    parameter: string;
    source_quote: string;
    default_value?: string;
    required?: boolean;
    category?: 'mandatory' | 'optional' | 'default';
}

interface Message {
    id: number;
    sender: 'planner' | 'user';
    text: string;
    intent?: 'question' | 'action' | 'clarification';
    steps?: WorkflowStepData[];
    workflowParameters?: WorkflowParameterData[];
    missingParametersAudit?: MissingParameterAuditData[];
    citations?: string[];
    isLoading?: boolean;
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
    message_to_user: string;
    intent: 'question' | 'action' | 'clarification';
    steps: WorkflowStepData[];
    workflow_parameters: WorkflowParameterData[];
    missing_parameters_audit?: MissingParameterAuditData[];
    rag_citations: string[];
    session_id: string;
}

const PLANNER_API = 'http://localhost:8000/api/planner';


/* ─── Helpers ─── */

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

let msgIdCounter = 2;
const nextId = () => msgIdCounter++;

/* ─── Styles ─── */

const sidebar = (isDark: boolean, isExpanded: boolean): CSSProperties => ({
    width: isExpanded ? '50%' : 400,
    minWidth: 400,
    display: 'flex',
    flexDirection: 'column',
    borderRight: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight,
    flexShrink: 0,
    position: 'relative',
    zIndex: 10,
    boxShadow: '1px 0 2px rgba(0,0,0,0.04)',
    fontFamily: fonts.display,
    transition: 'width 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
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
    top: '50%',
    transform: 'translateY(-50%)',
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
    top: '50%',
    transform: 'translateY(-50%)',
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

interface PlannerSidebarProps {
    isExpanded: boolean;
    onCollapse: () => void;
    onExpand: () => void;
}

export default function PlannerSidebar({ isExpanded, onCollapse, onExpand }: PlannerSidebarProps) {
    const { isDark } = useTheme();
    useWorkflow();



    // Welcome message constant
    const welcomeMessage: Message = {
        id: 1,
        sender: 'planner',
        text: "Hello! I'm the **Architect** — your workflow planning assistant. Describe what you want to build and I'll design the workflow for you.\n\nI can also reference documents you've uploaded to the knowledge base.",
    };

    // State
    const [messages, setMessages] = useState<Message[]>([welcomeMessage]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [conversationHistory, setConversationHistory] = useState<ConversationEntry[]>([]);
    const [showAttachModal, setShowAttachModal] = useState(false);
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
    const [, setAllSessionFiles] = useState<string[]>([]);
    const [backendHealthy, setBackendHealthy] = useState(true);

    // RAG toggle and model selection
    const [useRag, setUseRag] = useState(true);
    const [selectedModel, setSelectedModel] = useState('');
    const [availableModels, setAvailableModels] = useState<string[]>([]);

    // Interactive parameter decisions state
    const [paramDecisions, setParamDecisions] = useState<Record<string, { choice: '' | 'default' | 'deferred' | 'provide'; value: string }>>({});
    const [, setActiveClarificationMsgId] = useState<number | null>(null);

    // Slash command autocomplete state
    const [showSlashMenu, setShowSlashMenu] = useState(false);
    const [slashMenuIndex, setSlashMenuIndex] = useState(0);

    // Generate a unique session ID per conversation — mutable so it resets per workflow
    const generateSessionId = () =>
        'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    const [sessionId, setSessionId] = useState<string>(generateSessionId);

    // ── Start a fresh conversation (reset all state) ──
    const startNewConversation = () => {
        msgIdCounter = 2;  // reset ID counter
        setMessages([{ ...welcomeMessage }]);
        setConversationHistory([]);
        setAttachedFiles([]);
        setAllSessionFiles([]);
        setSessionId(generateSessionId());
        setIsLoading(false);

        setInput('');
        setParamDecisions({});
        setActiveClarificationMsgId(null);
    };

    const chatEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Inject keyframes on mount
    useEffect(() => {
        injectKeyframes();
    }, []);

    // Health check + fetch available models on mount
    useEffect(() => {
        fetch(`${PLANNER_API}/health`)
            .then(r => r.json())
            .then(data => setBackendHealthy(data.status === 'healthy' || data.status === 'degraded'))
            .catch(() => setBackendHealthy(false));

        // Fetch available models
        fetch(`${PLANNER_API}/models`)
            .then(r => r.json())
            .then(data => {
                if (data.models?.length) setAvailableModels(data.models);
                if (data.active_model) setSelectedModel(data.active_model);
            })
            .catch(() => { /* Models will remain empty */ });
    }, []);

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // ── Send message ──────────────────────────────────

    const sendMessage = async (overrideMessage?: string) => {
        const text = overrideMessage || input.trim();
        if (!text || isLoading) return;

        // Add user message
        const userMsg: Message = { id: nextId(), sender: 'user', text };
        setMessages(prev => [...prev, userMsg]);
        if (!overrideMessage) {
            setInput('');
            if (inputRef.current) {
                inputRef.current.style.height = 'auto';
                inputRef.current.style.overflow = 'hidden';
            }
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
                    session_id: sessionId,
                    use_rag: useRag,
                    model: selectedModel || undefined,
                }),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
                throw new Error(err.detail || `HTTP ${response.status}`);
            }

            const data: PlannerAPIResponse = await response.json();

            // Show all RAG citations from the response
            const citations = data.rag_citations.length > 0 ? data.rag_citations : undefined;

            // Replace loading message with the real response
            const agentMsg: Message = {
                id: loadingId,
                sender: 'planner',
                text: data.message_to_user,
                intent: data.intent,
                steps: data.steps?.length > 0 ? data.steps : undefined,
                workflowParameters: data.workflow_parameters?.length > 0 ? data.workflow_parameters : undefined,
                missingParametersAudit: data.missing_parameters_audit?.length ? data.missing_parameters_audit : undefined,
                citations,
            };

            setMessages(prev => prev.map(m => m.id === loadingId ? agentMsg : m));

            // If this is a clarification with missing parameters, initialize interactive decisions
            if (data.intent === 'clarification' && data.missing_parameters_audit?.length) {
                const initial: Record<string, { choice: '' | 'default' | 'deferred' | 'provide'; value: string }> = {};
                for (const audit of data.missing_parameters_audit) {
                    initial[audit.parameter] = { choice: '', value: '' };
                }
                setParamDecisions(initial);
                setActiveClarificationMsgId(loadingId);
            } else {
                // Clear any active clarification
                setParamDecisions({});
                setActiveClarificationMsgId(null);
            }

            // Update conversation history with the assistant's response
            setConversationHistory([
                ...newHistory,
                { role: 'assistant', content: data.message_to_user },
            ]);

            // Clear attached files after sending
            if (attachedFiles.length > 0) {
                // Track all files across the session for canvas agent
                setAllSessionFiles(prev => {
                    const newNames = attachedFiles.map(f => f.name);
                    return [...new Set([...prev, ...newNames])];
                });
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

    // ── Submit parameter decisions as structured message ──
    const handleParameterSubmit = () => {
        const parts: string[] = [];
        for (const [name, decision] of Object.entries(paramDecisions)) {
            if (decision.choice === 'default') {
                parts.push(`[DEFAULT] ${name} — use the document-recommended default value`);
            } else if (decision.choice === 'deferred') {
                parts.push(`[DEFERRED] ${name} — make this an interchangeable parameter ({{${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}}}), the user will configure it later`);
            } else if (decision.choice === 'provide') {
                parts.push(`[PROVIDED] ${name} = "${decision.value}"`);
            }
        }

        const structuredMsg = [
            'PARAMETER DECISIONS (user has made explicit choices for every parameter):',
            ...parts,
            '',
            'ALL PARAMETERS ARE NOW ACCOUNTED FOR.',
            'Generate the complete workflow with intent="action".',
            'For [DEFAULT] parameters, use the standard/document-recommended value.',
            'For [DEFERRED] parameters, use {{parameter_name}} syntax in step descriptions and add them to workflow_parameters with status="deferred".',
            'For [PROVIDED] parameters, use the exact value given.',
        ].join('\n');

        // Clear the clarification state
        setParamDecisions({});
        setActiveClarificationMsgId(null);

        // Send as a regular message
        sendMessage(structuredMsg);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Slash menu navigation
        if (showSlashMenu) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSlashMenuIndex(prev => (prev + 1) % 2);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSlashMenuIndex(prev => (prev - 1 + 2) % 2);
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const commands = ['/dp ', '/fp '];
                insertSlashCommand(commands[slashMenuIndex]);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setShowSlashMenu(false);
                return;
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    // Insert a slash command at the current cursor position
    const insertSlashCommand = (cmd: string) => {
        const el = inputRef.current;
        if (!el) return;
        const pos = el.selectionStart || input.length;
        // Replace the trailing '/' with the full command
        const beforeSlash = input.substring(0, pos).replace(/\/$/, '');
        const after = input.substring(pos);
        const newValue = beforeSlash + cmd + after;
        setInput(newValue);
        setShowSlashMenu(false);
        // Focus and set cursor after the command
        setTimeout(() => {
            el.focus();
            const newPos = (beforeSlash + cmd).length;
            el.setSelectionRange(newPos, newPos);
        }, 0);
    };

    /* Auto-resize textarea up to 4 lines */
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setInput(val);

        // Show slash menu when user types '/'
        const cursorPos = e.target.selectionStart || 0;
        const charAtCursor = val[cursorPos - 1];
        const charBeforeThat = cursorPos >= 2 ? val[cursorPos - 2] : ' ';
        if (charAtCursor === '/' && (charBeforeThat === ' ' || charBeforeThat === '\n' || cursorPos === 1)) {
            setShowSlashMenu(true);
            setSlashMenuIndex(0);
        } else if (showSlashMenu && !val.substring(0, cursorPos).endsWith('/')) {
            setShowSlashMenu(false);
        }

        const el = e.target;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 88)}px`;
        el.style.overflow = el.scrollHeight > 88 ? 'auto' : 'hidden';
    };

    // Render text with slash commands highlighted as chips
    const renderTextWithSlashCommands = (text: string) => {
        // More precise approach: use regex to find all commands and split around them
        const cmdPattern = /\/(dp|defined|fp|floating)\s+(.*?)(?=\s*\/(?:dp|defined|fp|floating)\b|$)/gi;
        const commands: { start: number; end: number; type: string; content: string }[] = [];
        let match;
        while ((match = cmdPattern.exec(text)) !== null) {
            commands.push({
                start: match.index,
                end: match.index + match[0].length,
                type: match[1].toLowerCase(),
                content: match[2].trim(),
            });
        }

        if (commands.length === 0) return renderText(text);

        const result: React.ReactNode[] = [];
        let lastIdx = 0;
        commands.forEach((cmd, i) => {
            // Text before this command
            if (cmd.start > lastIdx) {
                const before = text.substring(lastIdx, cmd.start).trim();
                if (before) result.push(<span key={`t${i}`}>{before} </span>);
            }
            const isDefined = cmd.type === 'dp' || cmd.type === 'defined';
            result.push(
                <span key={`c${i}`} style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    borderRadius: 5,
                    margin: '1px 3px',
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: isDefined
                        ? (isDark ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.12)')
                        : (isDark ? 'rgba(251,191,36,0.15)' : 'rgba(245,158,11,0.12)'),
                    color: isDefined
                        ? (isDark ? '#4ade80' : '#16a34a')
                        : (isDark ? '#fbbf24' : '#d97706'),
                    border: `1px solid ${isDefined
                        ? (isDark ? 'rgba(34,197,94,0.25)' : 'rgba(34,197,94,0.2)')
                        : (isDark ? 'rgba(251,191,36,0.25)' : 'rgba(245,158,11,0.2)')}`,
                }}>
                    {isDefined ? '📌' : '🔄'}
                    {cmd.content}
                </span>
            );
            lastIdx = cmd.end;
        });
        // Text after last command
        if (lastIdx < text.length) {
            const remaining = text.substring(lastIdx).trim();
            if (remaining) result.push(<span key="end"> {remaining}</span>);
        }
        return <>{result}</>;
    };

    const handleFileAttached = (file: AttachedFile) => {
        setAttachedFiles(prev => [...prev, file]);
    };

    const removeAttachedFile = (index: number) => {
        setAttachedFiles(prev => prev.filter((_, i) => i !== index));
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
        <aside style={sidebar(isDark, isExpanded)}>
            {/* Header */}
            <div style={headerBar(isDark)}>
                <h2 style={headerTitle(isDark)}>
                    <span className="material-icons-outlined" style={{ fontSize: 16, color: isDark ? '#a78bfa' : '#7c3aed' }}>
                        smart_toy
                    </span>
                    Planner Agent
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                        onClick={startNewConversation}
                        title="Start new workflow"
                        style={{
                            background: isDark ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.1)',
                            border: `1px solid ${isDark ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.2)'}`,
                            borderRadius: 6,
                            padding: '3px 8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            fontSize: 10,
                            fontWeight: 600,
                            color: isDark ? '#a5b4fc' : '#6366f1',
                            transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = isDark ? 'rgba(99,102,241,0.25)' : 'rgba(99,102,241,0.2)';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = isDark ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.1)';
                        }}
                    >
                        <span className="material-icons" style={{ fontSize: 13 }}>add</span>
                        New
                    </button>
                    <span style={badge(isDark)}>
                        <span style={statusDot(backendHealthy)} />
                        {backendHealthy ? 'Online' : 'Offline'}
                    </span>
                    <button
                        onClick={isExpanded ? onCollapse : onExpand}
                        title={isExpanded ? 'Collapse panel' : 'Expand panel'}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 4,
                            borderRadius: 6,
                            display: 'flex',
                            alignItems: 'center',
                            color: isDark ? '#9ca3af' : '#6b7280',
                            transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
                            e.currentTarget.style.color = isDark ? '#e5e7eb' : '#374151';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = 'none';
                            e.currentTarget.style.color = isDark ? '#9ca3af' : '#6b7280';
                        }}
                    >
                        <span className="material-icons" style={{ fontSize: 18 }}>
                            {isExpanded ? 'chevron_left' : 'chevron_right'}
                        </span>
                    </button>
                </div>
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
                                                {isUser ? renderTextWithSlashCommands(m.text) : renderText(m.text)}
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

                                        {/* Workflow Steps (action intent) */}
                                        {m.steps && m.steps.length > 0 && (
                                            <div style={{
                                                marginTop: 12,
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: 0,
                                            }}>
                                                <div style={{
                                                    fontSize: 10,
                                                    fontWeight: 700,
                                                    textTransform: 'uppercase' as const,
                                                    letterSpacing: '0.08em',
                                                    color: isDark ? '#60a5fa' : '#3b82f6',
                                                    marginBottom: 8,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 5,
                                                }}>
                                                    <span className="material-icons" style={{ fontSize: 13 }}>route</span>
                                                    Workflow Steps
                                                </div>
                                                {m.steps.map((step, idx) => {
                                                    const isLast = idx === (m.steps?.length ?? 0) - 1;
                                                    const actionColors: Record<string, string> = {
                                                        create: '#22c55e',
                                                        configure: '#3b82f6',
                                                        verify: '#f59e0b',
                                                        connect: '#8b5cf6',
                                                        modify: '#f97316',
                                                        delete: '#ef4444',
                                                    };
                                                    const accentColor = actionColors[step.action_type] || (isDark ? '#60a5fa' : '#3b82f6');

                                                    return (
                                                        <div key={step.step_number} style={{ display: 'flex', gap: 10 }}>
                                                            {/* Timeline connector */}
                                                            <div style={{
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                alignItems: 'center',
                                                                width: 28,
                                                                flexShrink: 0,
                                                            }}>
                                                                <div style={{
                                                                    width: 24,
                                                                    height: 24,
                                                                    borderRadius: '50%',
                                                                    backgroundColor: accentColor + '20',
                                                                    border: `2px solid ${accentColor}`,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    justifyContent: 'center',
                                                                    fontSize: 11,
                                                                    fontWeight: 700,
                                                                    color: accentColor,
                                                                    flexShrink: 0,
                                                                }}>
                                                                    {step.step_number}
                                                                </div>
                                                                {!isLast && (
                                                                    <div style={{
                                                                        width: 2,
                                                                        flex: 1,
                                                                        backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                                                                        minHeight: 12,
                                                                    }} />
                                                                )}
                                                            </div>

                                                            {/* Step content */}
                                                            <div style={{
                                                                flex: 1,
                                                                paddingBottom: isLast ? 0 : 12,
                                                                minWidth: 0,
                                                            }}>
                                                                <div style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: 6,
                                                                    marginBottom: 3,
                                                                }}>
                                                                    <span style={{
                                                                        fontSize: 13,
                                                                        fontWeight: 700,
                                                                        color: isDark ? '#e5e7eb' : '#1f2937',
                                                                    }}>
                                                                        {step.title}
                                                                    </span>
                                                                    {step.action_type && (
                                                                        <span style={{
                                                                            fontSize: 9,
                                                                            fontWeight: 600,
                                                                            textTransform: 'uppercase' as const,
                                                                            letterSpacing: '0.05em',
                                                                            padding: '2px 6px',
                                                                            borderRadius: 4,
                                                                            backgroundColor: accentColor + '18',
                                                                            color: accentColor,
                                                                        }}>
                                                                            {step.action_type}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div style={{
                                                                    fontSize: 12,
                                                                    lineHeight: 1.5,
                                                                    color: isDark ? '#9ca3af' : '#6b7280',
                                                                    wordBreak: 'break-word' as const,
                                                                }}>
                                                                    {/* Render description with {{param}} highlighting */}
                                                                    {step.description.split(/(\{\{[^}]+\}\})/).map((part, pi) => {
                                                                        if (part.startsWith('{{') && part.endsWith('}}')) {
                                                                            const paramName = part.slice(2, -2);
                                                                            return (
                                                                                <span key={pi} style={{
                                                                                    display: 'inline-block',
                                                                                    padding: '1px 6px',
                                                                                    borderRadius: 4,
                                                                                    backgroundColor: isDark ? 'rgba(251,191,36,0.15)' : 'rgba(245,158,11,0.12)',
                                                                                    color: isDark ? '#fbbf24' : '#d97706',
                                                                                    fontWeight: 600,
                                                                                    fontSize: 11,
                                                                                    fontFamily: 'monospace',
                                                                                    border: `1px solid ${isDark ? 'rgba(251,191,36,0.25)' : 'rgba(245,158,11,0.25)'}`,
                                                                                }}>
                                                                                    {paramName}
                                                                                </span>
                                                                            );
                                                                        }
                                                                        return <span key={pi}>{part}</span>;
                                                                    })}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {/* Workflow Parameters Panel */}
                                        {m.workflowParameters && m.workflowParameters.length > 0 && (
                                            <div style={{
                                                marginTop: 12,
                                                padding: '10px 12px',
                                                borderRadius: 8,
                                                backgroundColor: isDark ? 'rgba(251,191,36,0.06)' : 'rgba(245,158,11,0.05)',
                                                border: `1px solid ${isDark ? 'rgba(251,191,36,0.15)' : 'rgba(245,158,11,0.15)'}`,
                                            }}>
                                                <div style={{
                                                    fontSize: 10,
                                                    fontWeight: 700,
                                                    textTransform: 'uppercase' as const,
                                                    letterSpacing: '0.08em',
                                                    color: isDark ? '#fbbf24' : '#d97706',
                                                    marginBottom: 8,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 5,
                                                }}>
                                                    <span className="material-icons" style={{ fontSize: 13 }}>tune</span>
                                                    Workflow Parameters
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                    {m.workflowParameters.map((param) => {
                                                        const isProvided = param.status === 'provided';
                                                        return (
                                                            <div key={param.name} style={{
                                                                display: 'flex',
                                                                alignItems: 'flex-start',
                                                                gap: 8,
                                                                padding: '6px 8px',
                                                                borderRadius: 6,
                                                                backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                                                            }}>
                                                                {/* Status indicator */}
                                                                <span style={{
                                                                    fontSize: 11,
                                                                    marginTop: 1,
                                                                    color: isProvided
                                                                        ? (isDark ? '#4ade80' : '#16a34a')
                                                                        : (isDark ? '#fbbf24' : '#d97706'),
                                                                }}>
                                                                    {isProvided ? '✓' : '⟐'}
                                                                </span>
                                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                                    <div style={{
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: 6,
                                                                        flexWrap: 'wrap',
                                                                    }}>
                                                                        <span style={{
                                                                            fontFamily: 'monospace',
                                                                            fontSize: 11,
                                                                            fontWeight: 700,
                                                                            color: isProvided
                                                                                ? (isDark ? '#4ade80' : '#16a34a')
                                                                                : (isDark ? '#fbbf24' : '#d97706'),
                                                                        }}>
                                                                            {isProvided ? param.name : `{{${param.name}}}`}
                                                                        </span>
                                                                        <span style={{
                                                                            fontSize: 9,
                                                                            fontWeight: 600,
                                                                            textTransform: 'uppercase' as const,
                                                                            padding: '1px 5px',
                                                                            borderRadius: 3,
                                                                            backgroundColor: isProvided
                                                                                ? (isDark ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.1)')
                                                                                : (isDark ? 'rgba(251,191,36,0.15)' : 'rgba(245,158,11,0.1)'),
                                                                            color: isProvided
                                                                                ? (isDark ? '#4ade80' : '#16a34a')
                                                                                : (isDark ? '#fbbf24' : '#d97706'),
                                                                        }}>
                                                                            {isProvided ? 'provided' : 'deferred'}
                                                                        </span>
                                                                    </div>
                                                                    {isProvided && param.value && (
                                                                        <div style={{
                                                                            fontSize: 12,
                                                                            color: isDark ? '#d1d5db' : '#374151',
                                                                            marginTop: 2,
                                                                        }}>
                                                                            Value: <strong>{param.value}</strong>
                                                                        </div>
                                                                    )}
                                                                    {!isProvided && param.description && (
                                                                        <div style={{
                                                                            fontSize: 11,
                                                                            color: isDark ? '#9ca3af' : '#6b7280',
                                                                            marginTop: 2,
                                                                            fontStyle: 'italic',
                                                                        }}>
                                                                            {param.description}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {/* Interactive Parameter Decision Cards */}
                                        {m.missingParametersAudit && m.missingParametersAudit.length > 0 && (
                                            <div style={{
                                                marginTop: 12,
                                                padding: '12px',
                                                borderRadius: 10,
                                                backgroundColor: isDark ? 'rgba(96,165,250,0.06)' : 'rgba(59,130,246,0.04)',
                                                border: `1px solid ${isDark ? 'rgba(96,165,250,0.18)' : 'rgba(59,130,246,0.15)'}`,
                                            }}>
                                                <div style={{
                                                    fontSize: 10,
                                                    fontWeight: 700,
                                                    textTransform: 'uppercase' as const,
                                                    letterSpacing: '0.08em',
                                                    color: isDark ? '#60a5fa' : '#3b82f6',
                                                    marginBottom: 10,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 5,
                                                }}>
                                                    <span className="material-icons" style={{ fontSize: 14 }}>tune</span>
                                                    All Parameters Must Be Addressed
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                                    {m.missingParametersAudit.map((audit, ai) => {
                                                        const decision = paramDecisions[audit.parameter];
                                                        const currentChoice = decision?.choice || '';
                                                        return (
                                                            <div key={ai} style={{
                                                                padding: '10px 12px',
                                                                borderRadius: 8,
                                                                backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
                                                                border: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
                                                            }}>
                                                                {/* Parameter name + category badge */}
                                                                <div style={{
                                                                    fontSize: 13,
                                                                    fontWeight: 700,
                                                                    color: isDark ? '#e5e7eb' : '#1f2937',
                                                                    marginBottom: 4,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: 6,
                                                                }}>
                                                                    {audit.parameter}
                                                                    <span style={{
                                                                        fontSize: 9,
                                                                        fontWeight: 700,
                                                                        textTransform: 'uppercase' as const,
                                                                        letterSpacing: '0.06em',
                                                                        padding: '1px 6px',
                                                                        borderRadius: 3,
                                                                        backgroundColor: (audit.category === 'mandatory' || audit.required !== false)
                                                                            ? (isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)')
                                                                            : audit.category === 'default'
                                                                                ? (isDark ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.1)')
                                                                                : (isDark ? 'rgba(251,191,36,0.15)' : 'rgba(245,158,11,0.1)'),
                                                                        color: (audit.category === 'mandatory' || audit.required !== false)
                                                                            ? (isDark ? '#f87171' : '#dc2626')
                                                                            : audit.category === 'default'
                                                                                ? (isDark ? '#4ade80' : '#16a34a')
                                                                                : (isDark ? '#fbbf24' : '#d97706'),
                                                                    }}>
                                                                        {(audit.category === 'mandatory' || audit.required !== false) ? 'MANDATORY' : audit.category === 'default' ? 'HAS DEFAULT' : 'OPTIONAL'}
                                                                    </span>
                                                                </div>

                                                                {/* Source quote */}
                                                                {audit.source_quote && (
                                                                    <div style={{
                                                                        fontSize: 11,
                                                                        color: isDark ? '#9ca3af' : '#6b7280',
                                                                        fontStyle: 'italic',
                                                                        borderLeft: `2px solid ${isDark ? 'rgba(96,165,250,0.3)' : 'rgba(59,130,246,0.25)'}`,
                                                                        paddingLeft: 8,
                                                                        marginBottom: 8,
                                                                        lineHeight: 1.4,
                                                                    }}>
                                                                        "{audit.source_quote}"
                                                                    </div>
                                                                )}

                                                                {/* Default value info */}
                                                                {audit.default_value && (
                                                                    <div style={{
                                                                        fontSize: 11,
                                                                        color: isDark ? '#4ade80' : '#16a34a',
                                                                        marginBottom: 8,
                                                                    }}>
                                                                        📋 Document default: <strong>{audit.default_value}</strong>
                                                                    </div>
                                                                )}

                                                                {/* Dropdown */}
                                                                <select
                                                                    value={currentChoice}
                                                                    onChange={(e) => {
                                                                        const val = e.target.value as '' | 'default' | 'deferred' | 'provide';
                                                                        setParamDecisions(prev => ({
                                                                            ...prev,
                                                                            [audit.parameter]: { choice: val, value: prev[audit.parameter]?.value || '' },
                                                                        }));
                                                                    }}
                                                                    style={{
                                                                        width: '100%',
                                                                        padding: '7px 10px',
                                                                        borderRadius: 6,
                                                                        border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.15)'}`,
                                                                        backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#fff',
                                                                        color: isDark ? '#e5e7eb' : '#1f2937',
                                                                        fontSize: 12,
                                                                        fontWeight: 500,
                                                                        outline: 'none',
                                                                        cursor: 'pointer',
                                                                        appearance: 'auto' as any,
                                                                    }}
                                                                >
                                                                    <option value="">— Select an option —</option>
                                                                    <option value="default">📋 Use Default</option>
                                                                    <option value="deferred">🔄 Interchangeable Parameter (decide later)</option>
                                                                    <option value="provide">✏️ Enter Details</option>
                                                                </select>

                                                                {/* Text input for "Enter Details" */}
                                                                {currentChoice === 'provide' && (
                                                                    <input
                                                                        type="text"
                                                                        placeholder={`Enter ${audit.parameter}...`}
                                                                        value={decision?.value || ''}
                                                                        onChange={(e) => {
                                                                            setParamDecisions(prev => ({
                                                                                ...prev,
                                                                                [audit.parameter]: { choice: 'provide', value: e.target.value },
                                                                            }));
                                                                        }}
                                                                        style={{
                                                                            width: '100%',
                                                                            marginTop: 8,
                                                                            padding: '7px 10px',
                                                                            borderRadius: 6,
                                                                            border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`,
                                                                            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#fff',
                                                                            color: isDark ? '#e5e7eb' : '#1f2937',
                                                                            fontSize: 12,
                                                                            outline: 'none',
                                                                            boxSizing: 'border-box',
                                                                        }}
                                                                        onFocus={(e) => {
                                                                            e.target.style.borderColor = isDark ? '#60a5fa' : '#3b82f6';
                                                                        }}
                                                                        onBlur={(e) => {
                                                                            e.target.style.borderColor = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)';
                                                                        }}
                                                                    />
                                                                )}

                                                                {/* Status badge for selected choice */}
                                                                {currentChoice && currentChoice !== 'provide' && (
                                                                    <div style={{
                                                                        marginTop: 6,
                                                                        fontSize: 11,
                                                                        color: currentChoice === 'default'
                                                                            ? (isDark ? '#4ade80' : '#16a34a')
                                                                            : (isDark ? '#fbbf24' : '#d97706'),
                                                                        fontWeight: 500,
                                                                    }}>
                                                                        {currentChoice === 'default'
                                                                            ? '✓ Will use the recommended default value'
                                                                            : '⟐ Will be configurable — you\'ll set this value at runtime'}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {/* Generate Workflow button */}
                                                {(() => {
                                                    const allDecided = m.missingParametersAudit!.every(
                                                        a => paramDecisions[a.parameter]?.choice &&
                                                            (paramDecisions[a.parameter].choice !== 'provide' || paramDecisions[a.parameter].value.trim())
                                                    );
                                                    return (
                                                        <button
                                                            onClick={handleParameterSubmit}
                                                            disabled={!allDecided || isLoading}
                                                            style={{
                                                                marginTop: 12,
                                                                width: '100%',
                                                                padding: '10px 16px',
                                                                borderRadius: 8,
                                                                border: 'none',
                                                                background: allDecided && !isLoading
                                                                    ? 'linear-gradient(135deg, #3b82f6, #6366f1)'
                                                                    : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'),
                                                                color: allDecided && !isLoading
                                                                    ? '#fff'
                                                                    : (isDark ? '#6b7280' : '#9ca3af'),
                                                                fontSize: 13,
                                                                fontWeight: 700,
                                                                cursor: allDecided && !isLoading ? 'pointer' : 'not-allowed',
                                                                transition: 'all 0.2s ease',
                                                                letterSpacing: '0.02em',
                                                            }}
                                                            onMouseEnter={(e) => {
                                                                if (allDecided && !isLoading) {
                                                                    (e.target as HTMLElement).style.transform = 'translateY(-1px)';
                                                                    (e.target as HTMLElement).style.boxShadow = '0 4px 12px rgba(59,130,246,0.3)';
                                                                }
                                                            }}
                                                            onMouseLeave={(e) => {
                                                                (e.target as HTMLElement).style.transform = 'none';
                                                                (e.target as HTMLElement).style.boxShadow = 'none';
                                                            }}
                                                        >
                                                            Generate Workflow →
                                                        </button>
                                                    );
                                                })()}
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
                        onClick={() => sendMessage()}
                        disabled={isLoading || !input.trim()}
                        title="Send"
                    >
                        <span className="material-icons" style={{ fontSize: 18 }}>arrow_upward</span>
                    </button>

                    {/* Slash command autocomplete popup */}
                    {showSlashMenu && (
                        <div style={{
                            position: 'absolute',
                            bottom: '100%',
                            left: 0,
                            right: 0,
                            marginBottom: 4,
                            backgroundColor: isDark ? '#1e293b' : '#fff',
                            border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`,
                            borderRadius: 10,
                            boxShadow: '0 -4px 20px rgba(0,0,0,0.15)',
                            zIndex: 50,
                            overflow: 'hidden',
                        }}>
                            <div style={{
                                padding: '6px 10px',
                                fontSize: 10,
                                fontWeight: 700,
                                textTransform: 'uppercase' as const,
                                letterSpacing: '0.08em',
                                color: isDark ? '#64748b' : '#94a3b8',
                                borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
                            }}>
                                Parameter Commands
                            </div>
                            {[
                                { cmd: '/dp ', label: 'Defined Parameter', desc: 'Provide a concrete value', icon: '📌' },
                                { cmd: '/fp ', label: 'Floating Parameter', desc: 'Decide later at runtime', icon: '🔄' },
                            ].map((item, i) => (
                                <div
                                    key={item.cmd}
                                    onClick={() => insertSlashCommand(item.cmd)}
                                    style={{
                                        padding: '8px 12px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 10,
                                        backgroundColor: i === slashMenuIndex
                                            ? (isDark ? 'rgba(96,165,250,0.12)' : 'rgba(59,130,246,0.08)')
                                            : 'transparent',
                                        transition: 'background-color 0.1s',
                                    }}
                                    onMouseEnter={() => setSlashMenuIndex(i)}
                                >
                                    <span style={{ fontSize: 18 }}>{item.icon}</span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{
                                            fontSize: 13,
                                            fontWeight: 600,
                                            color: isDark ? '#e5e7eb' : '#1f2937',
                                        }}>
                                            {item.label}
                                            <span style={{
                                                fontFamily: 'monospace',
                                                fontSize: 11,
                                                fontWeight: 400,
                                                color: isDark ? '#64748b' : '#94a3b8',
                                                marginLeft: 6,
                                            }}>
                                                {item.cmd.trim()}
                                            </span>
                                        </div>
                                        <div style={{
                                            fontSize: 11,
                                            color: isDark ? '#9ca3af' : '#6b7280',
                                        }}>
                                            {item.desc}
                                        </div>
                                    </div>
                                    {i === slashMenuIndex && (
                                        <span style={{
                                            fontSize: 10,
                                            fontWeight: 500,
                                            color: isDark ? '#64748b' : '#94a3b8',
                                            padding: '2px 6px',
                                            borderRadius: 4,
                                            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
                                        }}>Enter ↵</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Controls bar: RAG toggle + Model selector */}
                <div style={{
                    padding: '6px 14px 8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                }}>
                    {/* Attach button */}
                    <button
                        style={{
                            background: 'none',
                            border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                            borderRadius: 6,
                            cursor: 'pointer',
                            padding: '3px 6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: isDark ? '#6b7280' : '#9ca3af',
                            transition: 'all 0.15s',
                        }}
                        onClick={() => setShowAttachModal(true)}
                        title="Attach file"
                        onMouseEnter={e => {
                            e.currentTarget.style.color = colors.primary;
                            e.currentTarget.style.borderColor = colors.primary;
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.color = isDark ? '#6b7280' : '#9ca3af';
                            e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
                        }}
                    >
                        <span className="material-icons" style={{ fontSize: 15 }}>add</span>
                    </button>

                    {/* RAG toggle (segmented control) */}
                    <div style={{
                        display: 'flex',
                        borderRadius: 6,
                        overflow: 'hidden',
                        border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                    }}>
                        <button
                            style={{
                                padding: '3px 10px',
                                fontSize: 11,
                                fontWeight: 600,
                                fontFamily: fonts.display,
                                border: 'none',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                transition: 'all 0.15s',
                                backgroundColor: !useRag
                                    ? (isDark ? 'rgba(96,165,250,0.15)' : 'rgba(59,130,246,0.1)')
                                    : 'transparent',
                                color: !useRag
                                    ? (isDark ? '#60a5fa' : '#3b82f6')
                                    : (isDark ? '#6b7280' : '#9ca3af'),
                            }}
                            onClick={() => setUseRag(false)}
                            title="Direct response using existing context — no new document search"
                        >
                            <span className="material-icons" style={{ fontSize: 12 }}>bolt</span>
                            Direct
                        </button>
                        <button
                            style={{
                                padding: '3px 10px',
                                fontSize: 11,
                                fontWeight: 600,
                                fontFamily: fonts.display,
                                border: 'none',
                                borderLeft: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                transition: 'all 0.15s',
                                backgroundColor: useRag
                                    ? (isDark ? 'rgba(34,197,94,0.12)' : 'rgba(34,197,94,0.08)')
                                    : 'transparent',
                                color: useRag
                                    ? (isDark ? '#4ade80' : '#16a34a')
                                    : (isDark ? '#6b7280' : '#9ca3af'),
                            }}
                            onClick={() => setUseRag(true)}
                            title="Search the document library for relevant context"
                        >
                            <span className="material-icons" style={{ fontSize: 12 }}>search</span>
                            RAG Search
                        </button>
                    </div>

                    {/* Model selector */}
                    {availableModels.length > 0 && (
                        <div style={{
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                        }}>
                            <select
                                value={selectedModel}
                                onChange={e => setSelectedModel(e.target.value)}
                                style={{
                                    appearance: 'none',
                                    WebkitAppearance: 'none',
                                    background: 'transparent',
                                    border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                                    borderRadius: 6,
                                    padding: '3px 24px 3px 8px',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    fontFamily: fonts.display,
                                    color: isDark ? '#a78bfa' : '#7c3aed',
                                    cursor: 'pointer',
                                    outline: 'none',
                                    transition: 'border-color 0.15s',
                                    maxWidth: 180,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                }}
                                title="Select LLM model"
                            >
                                {availableModels.map(m => (
                                    <option key={m} value={m} style={{
                                        backgroundColor: isDark ? '#1e293b' : '#fff',
                                        color: isDark ? '#e5e7eb' : '#1f2937',
                                    }}>
                                        {m}
                                    </option>
                                ))}
                            </select>
                            <span
                                className="material-icons"
                                style={{
                                    position: 'absolute',
                                    right: 4,
                                    fontSize: 14,
                                    color: isDark ? '#6b7280' : '#9ca3af',
                                    pointerEvents: 'none',
                                }}
                            >
                                expand_more
                            </span>
                        </div>
                    )}

                    {/* Spacer + slash command hint */}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, color: isDark ? '#4b5563' : '#9ca3af' }}>
                            <strong style={{ fontFamily: 'monospace', color: isDark ? '#4ade80' : '#16a34a' }}>/dp</strong> defined
                        </span>
                        <span style={{ fontSize: 10, color: isDark ? '#4b5563' : '#9ca3af' }}>
                            <strong style={{ fontFamily: 'monospace', color: isDark ? '#fbbf24' : '#d97706' }}>/fp</strong> floating
                        </span>
                    </div>
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
