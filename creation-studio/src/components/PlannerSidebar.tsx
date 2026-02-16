import { useState, type CSSProperties } from 'react';
import { useTheme } from '../context/ThemeContext';
import { colors } from '../theme';
import FileAttachmentModal from './FileAttachmentModal';

interface Message {
    id: number;
    sender: 'planner' | 'user';
    text: string;
}

interface AttachedFile {
    name: string;
    size: number;
    source: 'library' | 'upload';
}

const initialMessages: Message[] = [
    {
        id: 1,
        sender: 'planner',
        text: "Hello! I'm ready to help you build your workflow. Describe what you want to achieve.",
    },
];

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/* ─── Styles ─── */
const sidebar = (isDark: boolean): CSSProperties => ({
    width: 320,
    display: 'flex',
    flexDirection: 'column',
    borderRight: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight,
    flexShrink: 0,
    position: 'relative',
    zIndex: 10,
    boxShadow: '1px 0 2px rgba(0,0,0,0.04)',
    fontFamily: "'Inter', sans-serif",
});

const headerBar = (isDark: boolean): CSSProperties => ({
    padding: 16,
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
});

const badge: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 500,
    backgroundColor: '#dcfce7',
    color: '#166534',
};

const badgeDark: CSSProperties = {
    ...badge,
    backgroundColor: '#14532d',
    color: '#86efac',
};

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
    gap: 12,
    flexDirection: isUser ? 'row-reverse' : 'row',
});

const avatarCircle = (bg: string, isDark: boolean): CSSProperties => ({
    width: 32,
    height: 32,
    borderRadius: '50%',
    backgroundColor: isDark ? (bg === 'purple' ? '#581c87' : '#374151') : (bg === 'purple' ? '#f3e8ff' : '#e5e7eb'),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
});

const avatarIcon = (type: string, isDark: boolean): CSSProperties => ({
    fontSize: 14,
    color: type === 'purple'
        ? isDark ? '#d8b4fe' : '#9333ea'
        : isDark ? '#d1d5db' : '#4b5563',
});

const msgMeta = (isUser: boolean): CSSProperties => ({
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    alignItems: isUser ? 'flex-end' : 'flex-start',
    maxWidth: '85%',
});

const senderLabel: CSSProperties = {
    fontSize: 11,
    fontWeight: 500,
    color: colors.textMuted,
};

const bubbleBase = (isDark: boolean, isUser: boolean): CSSProperties => ({
    padding: 12,
    borderRadius: 8,
    fontSize: 14,
    lineHeight: 1.5,
    border: `1px solid ${isUser
        ? isDark ? '#1e3a5f' : '#dbeafe'
        : isDark ? colors.borderDark : colors.borderLight
        }`,
    backgroundColor: isUser
        ? isDark ? 'rgba(30, 58, 95, 0.3)' : '#eff6ff'
        : isDark ? '#1f2937' : '#f3f4f6',
    color: isUser
        ? isDark ? '#bfdbfe' : '#1e3a5f'
        : isDark ? '#e5e7eb' : '#1f2937',
    ...(isUser
        ? { borderTopRightRadius: 0 }
        : { borderTopLeftRadius: 0 }),
});

const inputBar = (isDark: boolean): CSSProperties => ({
    padding: 16,
    backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight,
    borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
});

const inputWrapper: CSSProperties = {
    position: 'relative',
};

const inputField = (isDark: boolean): CSSProperties => ({
    width: '100%',
    paddingLeft: 40,
    paddingRight: 40,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: isDark ? '#111827' : '#ffffff',
    border: `1px solid ${isDark ? '#374151' : '#d1d5db'}`,
    borderRadius: 12,
    outline: 'none',
    fontSize: 14,
    color: isDark ? '#e5e7eb' : '#1f2937',
    fontFamily: "'Inter', sans-serif",
    boxSizing: 'border-box',
    transition: 'box-shadow 0.15s',
});

const attachBtn = (isDark: boolean): CSSProperties => ({
    position: 'absolute',
    left: 4,
    top: '50%',
    transform: 'translateY(-50%)',
    color: isDark ? colors.textMutedLight : colors.textMuted,
    fontSize: 20,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 6,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'color 0.15s, background-color 0.15s',
});

const sendBtn: CSSProperties = {
    position: 'absolute',
    right: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: colors.primary,
    display: 'flex',
    alignItems: 'center',
    padding: 4,
};

const attachedFilesArea = (isDark: boolean): CSSProperties => ({
    paddingTop: 10,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    ...(isDark ? {} : {}),
});

const fileChip = (isDark: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 10px',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 500,
    backgroundColor: isDark ? 'rgba(59,130,246,0.1)' : '#eff6ff',
    border: `1px solid ${isDark ? 'rgba(59,130,246,0.2)' : '#dbeafe'}`,
    color: isDark ? '#93c5fd' : '#2563eb',
    fontFamily: "'Inter', sans-serif",
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

export default function PlannerSidebar() {
    const { isDark } = useTheme();
    const [showAttachModal, setShowAttachModal] = useState(false);
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

    const handleFileAttached = (file: AttachedFile) => {
        setAttachedFiles((prev) => [...prev, file]);
    };

    const removeAttachedFile = (index: number) => {
        setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
    };

    return (
        <aside style={sidebar(isDark)}>
            <div style={headerBar(isDark)}>
                <h2 style={headerTitle(isDark)}>Planner Agent</h2>
                <span style={isDark ? badgeDark : badge}>Active</span>
            </div>

            <div style={chatArea}>
                {initialMessages.map((m) => {
                    const isUser = m.sender === 'user';
                    return (
                        <div key={m.id} style={msgRow(isUser)}>
                            <div style={avatarCircle(isUser ? 'gray' : 'purple', isDark)}>
                                <span
                                    className={isUser ? 'material-icons' : 'material-icons-outlined'}
                                    style={avatarIcon(isUser ? 'gray' : 'purple', isDark)}
                                >
                                    {isUser ? 'person' : 'smart_toy'}
                                </span>
                            </div>
                            <div style={msgMeta(isUser)}>
                                <span style={senderLabel}>{isUser ? 'You' : 'Planner'}</span>
                                <div style={bubbleBase(isDark, isUser)}>
                                    <p style={{ margin: 0 }}>{m.text}</p>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div style={inputBar(isDark)}>
                {/* Attached files preview */}
                {attachedFiles.length > 0 && (
                    <div style={attachedFilesArea(isDark)}>
                        {attachedFiles.map((f, i) => (
                            <div key={i} style={fileChip(isDark)}>
                                <span className="material-icons" style={{ fontSize: 14 }}>
                                    {f.source === 'library' ? 'local_library' : 'description'}
                                </span>
                                <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {f.name}
                                </span>
                                <span style={{ opacity: 0.6, fontSize: 10 }}>
                                    {formatSize(f.size)}
                                </span>
                                <button style={chipRemove} onClick={() => removeAttachedFile(i)}>
                                    <span className="material-icons" style={{ fontSize: 14 }}>close</span>
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <div style={{ ...inputWrapper, marginTop: attachedFiles.length > 0 ? 8 : 0 }}>
                    <button
                        style={attachBtn(isDark)}
                        onClick={() => setShowAttachModal(true)}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.color = colors.primary;
                            e.currentTarget.style.backgroundColor = isDark ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.06)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.color = isDark ? colors.textMutedLight : colors.textMuted;
                            e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                        title="Attach file"
                    >
                        <span className="material-icons-outlined" style={{ fontSize: 20, transform: 'rotate(45deg)' }}>
                            attach_file
                        </span>
                    </button>
                    <input
                        type="text"
                        placeholder="Type here..."
                        style={inputField(isDark)}
                        onFocus={(e) => {
                            e.currentTarget.style.boxShadow = `0 0 0 2px ${colors.primary}`;
                            e.currentTarget.style.borderColor = 'transparent';
                        }}
                        onBlur={(e) => {
                            e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
                            e.currentTarget.style.borderColor = isDark ? '#374151' : '#d1d5db';
                        }}
                    />
                    <button style={sendBtn}>
                        <span className="material-icons">arrow_upward</span>
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
