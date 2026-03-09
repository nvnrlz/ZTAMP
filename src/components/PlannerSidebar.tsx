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
    block_type?: string;
    parameters_used?: { floating: string[]; fixed: string[] };
    condition?: string;
    on_true_step?: number;
    on_false_step?: number;
    // Dynamic schema typed payloads
    action_payload?: Record<string, any>;
    conditional_payload?: Record<string, any>;
    code_payload?: Record<string, any>;
    notify_payload?: Record<string, any>;
    result_payload?: Record<string, any>;
    parameter_payload?: Record<string, any>;
}

interface WorkflowParameterData {
    name: string;
    param_type: 'floating' | 'fixed';
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
    intent?: 'question' | 'action' | 'clarification' | 'search_results';
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
    intent: 'question' | 'action' | 'clarification' | 'search_results';
    steps: WorkflowStepData[];
    workflow_parameters: {
        floating: WorkflowParameterData[];
        fixed: WorkflowParameterData[];
    };
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
        @keyframes canvasBorderGlow {
            0%, 100% { border-color: rgba(99,102,241,0.3); box-shadow: 0 0 8px rgba(99,102,241,0.08); }
            50% { border-color: rgba(99,102,241,0.6); box-shadow: 0 0 16px rgba(99,102,241,0.15); }
        }
        @keyframes canvasBlockPulse {
            0% { opacity: 0.3; }
            50% { opacity: 0.6; }
            100% { opacity: 0.3; }
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
    const {
        nodes: canvasNodes,
        setBatchNodesAndEdges,
        setWorkflowName,
        setWorkflowDescription,
        selectNode,
    } = useWorkflow();



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
    /* allSessionFiles is now tracked in canvasLoadingMsgId section below */
    const [backendHealthy, setBackendHealthy] = useState(true);

    // RAG toggle and model selection
    const [useRag, setUseRag] = useState(true);
    const [selectedModel, setSelectedModel] = useState('');
    const [availableModels, setAvailableModels] = useState<string[]>([]);



    // Canvas push state
    const [canvasLoadingMsgId, setCanvasLoadingMsgId] = useState<number | null>(null);
    const [allSessionFiles, setAllSessionFilesState] = useState<string[]>([]);

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
        setAllSessionFilesState([]);
        setSessionId(generateSessionId());
        setIsLoading(false);

        setInput('');

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
            // Flatten workflow_parameters dict → array for display
            const flatParams: WorkflowParameterData[] = [
                ...(data.workflow_parameters?.floating || []),
                ...(data.workflow_parameters?.fixed || []),
            ];

            const agentMsg: Message = {
                id: loadingId,
                sender: 'planner',
                text: data.message_to_user,
                intent: data.intent,
                steps: data.steps?.length > 0 ? data.steps : undefined,
                workflowParameters: flatParams.length > 0 ? flatParams : undefined,
                missingParametersAudit: data.missing_parameters_audit?.length ? data.missing_parameters_audit : undefined,
                citations,
            };

            setMessages(prev => prev.map(m => m.id === loadingId ? agentMsg : m));



            // Update conversation history with the assistant's response
            setConversationHistory([
                ...newHistory,
                { role: 'assistant', content: data.message_to_user },
            ]);

            // Clear attached files after sending
            if (attachedFiles.length > 0) {
                // Track all files across the session for canvas agent
                setAllSessionFilesState(prev => {
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



    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Slash menu navigation
        if (showSlashMenu) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSlashMenuIndex(prev => (prev + 1) % 4);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSlashMenuIndex(prev => (prev - 1 + 4) % 4);
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                const commands = ['\\search ', '\\create ', '/dp ', '/fp '];
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
        // Replace the trailing '/' or '\' with the full command
        const beforeSlash = input.substring(0, pos).replace(/[/\\]$/, '');
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
        if ((charAtCursor === '/' || charAtCursor === '\\') && (charBeforeThat === ' ' || charBeforeThat === '\n' || cursorPos === 1)) {
            setShowSlashMenu(true);
            setSlashMenuIndex(0);
        } else if (showSlashMenu && !val.substring(0, cursorPos).match(/[/\\]$/)) {
            setShowSlashMenu(false);
        }

        const el = e.target;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 88)}px`;
        el.style.overflow = el.scrollHeight > 88 ? 'auto' : 'hidden';
    };

    // Render text with slash commands highlighted as chips
    const renderTextWithSlashCommands = (text: string) => {
        // Match both backslash commands (\search, \create) and forward-slash commands (/dp, /fp)
        const cmdPattern = /(?:\\(search|create)\s+(.*?)(?=\s*[\\\/](?:search|create|dp|defined|fp|floating)\b|$))|(\/(?:dp|defined|fp|floating)\s+(.*?)(?=\s*[\\\/](?:search|create|dp|defined|fp|floating)\b|$))/gi;
        const commands: { start: number; end: number; type: string; content: string }[] = [];
        let match;
        while ((match = cmdPattern.exec(text)) !== null) {
            if (match[1]) {
                // Backslash command: \search or \create
                commands.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    type: match[1].toLowerCase(),
                    content: match[2].trim(),
                });
            } else if (match[3]) {
                // Forward-slash command: /dp or /fp
                const slashCmd = match[0].match(/^\/(dp|defined|fp|floating)/i);
                commands.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    type: slashCmd ? slashCmd[1].toLowerCase() : 'dp',
                    content: match[3].trim(),
                });
            }
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
            const isSearch = cmd.type === 'search';
            const isCreate = cmd.type === 'create';

            let bgColor: string, fgColor: string, borderColor: string, emoji: string;
            if (isSearch) {
                bgColor = isDark ? 'rgba(96,165,250,0.15)' : 'rgba(59,130,246,0.12)';
                fgColor = isDark ? '#60a5fa' : '#2563eb';
                borderColor = isDark ? 'rgba(96,165,250,0.25)' : 'rgba(59,130,246,0.2)';
                emoji = '🔍';
            } else if (isCreate) {
                bgColor = isDark ? 'rgba(168,85,247,0.15)' : 'rgba(147,51,234,0.12)';
                fgColor = isDark ? '#c084fc' : '#7c3aed';
                borderColor = isDark ? 'rgba(168,85,247,0.25)' : 'rgba(147,51,234,0.2)';
                emoji = '⚙️';
            } else if (isDefined) {
                bgColor = isDark ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.12)';
                fgColor = isDark ? '#4ade80' : '#16a34a';
                borderColor = isDark ? 'rgba(34,197,94,0.25)' : 'rgba(34,197,94,0.2)';
                emoji = '📌';
            } else {
                // floating
                bgColor = isDark ? 'rgba(251,191,36,0.15)' : 'rgba(245,158,11,0.12)';
                fgColor = isDark ? '#fbbf24' : '#d97706';
                borderColor = isDark ? 'rgba(251,191,36,0.25)' : 'rgba(245,158,11,0.2)';
                emoji = '🔄';
            }

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
                    backgroundColor: bgColor,
                    color: fgColor,
                    border: `1px solid ${borderColor}`,
                }}>
                    {emoji}
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

    // ── Push to Canvas: calls /api/canvas/generate and populates React Flow ──
    const handleRenderOnCanvas = async (msg: Message) => {
        if (!msg.steps || msg.steps.length === 0) return;
        setCanvasLoadingMsgId(msg.id);

        try {
            // Build workflow_plan from the message — pass ALL fields
            // the Canvas Agent needs (block_type, parameters_used, condition, etc.)
            const workflowPlan: Record<string, any> = {
                intent: msg.intent || 'action',
                message_to_user: msg.text,
                steps: msg.steps.map(s => ({
                    step_number: s.step_number,
                    title: s.title,
                    description: s.description,
                    action_type: s.action_type,
                    block_type: s.block_type || 'action_block',
                    parameters_used: s.parameters_used || { floating: [], fixed: [] },
                    condition: s.condition,
                    on_true_step: s.on_true_step,
                    on_false_step: s.on_false_step,
                    // Forward typed payloads to Canvas Agent
                    action_payload: s.action_payload,
                    conditional_payload: s.conditional_payload,
                    code_payload: s.code_payload,
                    notify_payload: s.notify_payload,
                    result_payload: s.result_payload,
                    parameter_payload: s.parameter_payload,
                })),
                workflow_parameters: {
                    floating: msg.workflowParameters
                        ?.filter(p => p.param_type === 'floating')
                        .map(p => ({ name: p.name, description: p.description, value: p.value })) || [],
                    fixed: msg.workflowParameters
                        ?.filter(p => p.param_type === 'fixed')
                        .map(p => ({ name: p.name, description: p.description, value: p.value })) || [],
                },
            };

            // Build current_parameters from workflowParameters
            const currentParameters: Record<string, string | null> = {};
            if (msg.workflowParameters) {
                for (const param of msg.workflowParameters) {
                    currentParameters[param.name] = param.param_type === 'fixed'
                        ? (param.value || null)
                        : null;  // null = floating → Canvas Agent creates a ParamNode
                }
            }

            const response = await fetch('http://localhost:8000/api/canvas/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    workflow_plan: workflowPlan,
                    current_parameters: Object.keys(currentParameters).length > 0
                        ? currentParameters : null,
                    attached_files: allSessionFiles.length > 0 ? allSessionFiles : null,
                }),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ detail: 'Unknown error' }));
                throw new Error(err.detail || `HTTP ${response.status}`);
            }

            const data: {
                success: boolean;
                nodes: any[];
                edges: any[];
                node_configs: Record<string, any>;
                workflow_name: string;
                workflow_description: string;
            } = await response.json();

            if (data.success && data.nodes.length > 0) {
                // Populate the React Flow canvas
                setBatchNodesAndEdges(data.nodes, data.edges, data.node_configs);
                if (data.workflow_name) setWorkflowName(data.workflow_name);
                if (data.workflow_description) setWorkflowDescription(data.workflow_description);

                // Auto-select the first ParamNode (deferred parameter) to force user attention
                setTimeout(() => {
                    const paramNode = data.nodes.find(
                        (n: any) => n.type === 'paramNode'
                    );
                    if (paramNode) {
                        selectNode(paramNode.id);
                    }
                }, 300);
            }
        } catch (err) {
            console.error('Canvas generation failed:', err);
        } finally {
            setCanvasLoadingMsgId(null);
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

                                        {/* Workflow Steps (action intent) — "Draft Proposal" container */}
                                        {m.steps && m.steps.length > 0 && (
                                            <div style={{
                                                marginTop: 12,
                                                padding: '14px 14px 12px',
                                                borderRadius: 12,
                                                border: `1.5px solid ${isDark ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.2)'}`,
                                                backgroundColor: isDark ? 'rgba(99,102,241,0.04)' : 'rgba(99,102,241,0.03)',
                                                animation: 'canvasBorderGlow 3s ease-in-out infinite',
                                                position: 'relative' as const,
                                            }}>
                                                {/* Header badge */}
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    marginBottom: 10,
                                                }}>
                                                    <div style={{
                                                        fontSize: 10,
                                                        fontWeight: 700,
                                                        textTransform: 'uppercase' as const,
                                                        letterSpacing: '0.08em',
                                                        color: isDark ? '#a5b4fc' : '#6366f1',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 5,
                                                    }}>
                                                        <span className="material-icons" style={{ fontSize: 13 }}>route</span>
                                                        Workflow Ready
                                                    </div>
                                                    <span style={{
                                                        fontSize: 9,
                                                        fontWeight: 600,
                                                        padding: '2px 8px',
                                                        borderRadius: 10,
                                                        backgroundColor: isDark ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.1)',
                                                        color: isDark ? '#a5b4fc' : '#6366f1',
                                                        letterSpacing: '0.04em',
                                                    }}>
                                                        {m.steps.length} STEP{m.steps.length > 1 ? 'S' : ''}
                                                    </span>
                                                </div>

                                                {/* Steps timeline */}
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
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

                                                {/* ── Render on Canvas / Update Canvas button ── */}
                                                {canvasLoadingMsgId === m.id ? (
                                                    /* Skeleton loading: mini canvas block animation */
                                                    <div style={{
                                                        marginTop: 12,
                                                        padding: '12px 16px',
                                                        borderRadius: 8,
                                                        backgroundColor: isDark ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.05)',
                                                        border: `1px solid ${isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.15)'}`,
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: 8,
                                                    }}>
                                                        <div style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#a5b4fc' : '#6366f1' }}>
                                                            Generating canvas…
                                                        </div>
                                                        <div style={{ display: 'flex', gap: 6 }}>
                                                            {[40, 60, 35, 50].map((w, i) => (
                                                                <div key={i} style={{
                                                                    width: w,
                                                                    height: 28,
                                                                    borderRadius: 6,
                                                                    backgroundColor: isDark ? 'rgba(99,102,241,0.15)' : 'rgba(99,102,241,0.12)',
                                                                    animation: `canvasBlockPulse 1.5s ease-in-out ${i * 0.2}s infinite`,
                                                                }} />
                                                            ))}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <button
                                                        id={`render-canvas-${m.id}`}
                                                        onClick={() => handleRenderOnCanvas(m)}
                                                        disabled={isLoading}
                                                        style={{
                                                            marginTop: 12,
                                                            width: '100%',
                                                            padding: '10px 16px',
                                                            borderRadius: 8,
                                                            border: 'none',
                                                            background: isLoading
                                                                ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)')
                                                                : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                                            color: isLoading
                                                                ? (isDark ? '#6b7280' : '#9ca3af') : '#fff',
                                                            fontSize: 13,
                                                            fontWeight: 700,
                                                            cursor: isLoading ? 'not-allowed' : 'pointer',
                                                            transition: 'all 0.2s ease',
                                                            letterSpacing: '0.02em',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            gap: 8,
                                                        }}
                                                        onMouseEnter={e => {
                                                            if (!isLoading) {
                                                                (e.target as HTMLElement).style.transform = 'translateY(-1px)';
                                                                (e.target as HTMLElement).style.boxShadow = '0 4px 16px rgba(99,102,241,0.35)';
                                                            }
                                                        }}
                                                        onMouseLeave={e => {
                                                            (e.target as HTMLElement).style.transform = 'none';
                                                            (e.target as HTMLElement).style.boxShadow = 'none';
                                                        }}
                                                    >
                                                        <span className="material-icons" style={{ fontSize: 16 }}>
                                                            {canvasNodes.length > 0 ? 'refresh' : 'dashboard'}
                                                        </span>
                                                        {canvasNodes.length > 0 ? 'Update Canvas' : 'Render on Canvas'}
                                                    </button>
                                                )}
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
                                                        const isProvided = param.param_type === 'fixed' && param.value != null;
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
                                                                            {param.param_type === 'fixed' ? 'fixed' : 'floating'}
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
                                Commands
                            </div>
                            {[
                                { cmd: '\\search ', label: 'Search Parameters', desc: 'Research all parameters for a task', icon: '🔍' },
                                { cmd: '\\create ', label: 'Create Workflow', desc: 'Build workflow with your parameters', icon: '⚙️' },
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

                    {/* Spacer + command hints */}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, color: isDark ? '#4b5563' : '#9ca3af' }}>
                            <strong style={{ fontFamily: 'monospace', color: isDark ? '#60a5fa' : '#2563eb' }}>\search</strong>
                        </span>
                        <span style={{ fontSize: 10, color: isDark ? '#4b5563' : '#9ca3af' }}>
                            <strong style={{ fontFamily: 'monospace', color: isDark ? '#c084fc' : '#7c3aed' }}>\create</strong>
                        </span>
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
        </aside >
    );
}
