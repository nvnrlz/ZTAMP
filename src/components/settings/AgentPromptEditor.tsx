import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { colors, shadows, fonts } from '../../theme';

/* ─── Types ─── */
interface PromptFile {
    filename: string;
    size_bytes: number;
    last_modified: string;
}

/* ─── Constants ─── */
const API_BASE = 'http://localhost:8000/api/admin/prompts';

const agentMeta: Record<string, { label: string; icon: string; color: string; description: string }> = {
    'master.md': {
        label: 'Master Prompt',
        icon: 'hub',
        color: '#f59e0b',
        description: 'Global system architecture, rules, and standards all agents must follow.',
    },
    'planner_agent.md': {
        label: 'Planner Agent',
        icon: 'architecture',
        color: '#3b82f6',
        description: 'Workflow design instructions, block schemas, and JSON output format.',
    },
    'canvas_agent.md': {
        label: 'Canvas Agent',
        icon: 'dashboard',
        color: '#22c55e',
        description: 'Deterministic React Flow mapping, layout rules, and config generation.',
    },
    'coding_agent.md': {
        label: 'Coding Agent',
        icon: 'terminal',
        color: '#a855f7',
        description: 'Code generation patterns, dependency management, and Firecracker microVM execution.',
    },
};

/* ─── Helpers ─── */
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}

/* ─── Styles ─── */
const card = (isDark: boolean): CSSProperties => ({
    backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight,
    borderRadius: 16,
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    boxShadow: shadows.sm,
    overflow: 'hidden',
});

const sectionTitle: CSSProperties = {
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: '-0.01em',
};

const sectionSubtitle = (isDark: boolean): CSSProperties => ({
    fontSize: 13,
    color: isDark ? '#9ca3af' : '#6b7280',
    marginTop: 4,
    lineHeight: 1.5,
});

/* ─── Main Component ─── */
export default function AgentPromptEditor() {
    const { isDark } = useTheme();

    const [files, setFiles] = useState<PromptFile[]>([]);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [content, setContent] = useState('');
    const [originalContent, setOriginalContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    // ── Load file list ──
    const loadFiles = useCallback(async () => {
        try {
            const res = await fetch(API_BASE);
            if (!res.ok) throw new Error('Failed to fetch prompt list');
            const data = await res.json();
            setFiles(data.prompts || []);
            // Auto-select master.md if nothing selected
            if (!selectedFile && data.prompts?.length > 0) {
                const master = data.prompts.find((f: PromptFile) => f.filename === 'master.md');
                setSelectedFile(master ? master.filename : data.prompts[0].filename);
            }
        } catch (err) {
            console.error('Failed to load prompt files:', err);
            showToast('Failed to load prompt files', 'error');
        }
    }, [selectedFile]);

    useEffect(() => { loadFiles(); }, [loadFiles]);

    // ── Load selected file content ──
    useEffect(() => {
        if (!selectedFile) return;
        setLoading(true);
        fetch(`${API_BASE}/${selectedFile}`)
            .then(res => {
                if (!res.ok) throw new Error('Failed to load file');
                return res.json();
            })
            .then(data => {
                setContent(data.content || '');
                setOriginalContent(data.content || '');
            })
            .catch(err => {
                console.error(`Failed to load ${selectedFile}:`, err);
                showToast(`Failed to load ${selectedFile}`, 'error');
            })
            .finally(() => setLoading(false));
    }, [selectedFile]);

    // ── Save file ──
    const handleSave = async () => {
        if (!selectedFile) return;
        setSaving(true);
        try {
            const res = await fetch(`${API_BASE}/${selectedFile}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content }),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'Save failed');
            }
            setOriginalContent(content);
            showToast(`${selectedFile} saved successfully!`, 'success');
            loadFiles(); // Refresh metadata
        } catch (err: any) {
            showToast(err.message || 'Failed to save', 'error');
        } finally {
            setSaving(false);
        }
    };

    const showToast = (message: string, type: 'success' | 'error') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    const hasChanges = content !== originalContent;
    const meta = selectedFile ? agentMeta[selectedFile] : null;
    const lineCount = content.split('\n').length;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 900, margin: '0 auto' }}>
            {/* Header */}
            <div>
                <h3 style={sectionTitle}>Agent Instructions</h3>
                <p style={sectionSubtitle(isDark)}>
                    Manage the system prompts and instructions for each AI agent. Changes take effect immediately.
                </p>
            </div>

            {/* Info box */}
            <div style={{
                display: 'flex',
                gap: 12,
                padding: 14,
                borderRadius: 10,
                backgroundColor: isDark ? 'rgba(245,158,11,0.08)' : '#fffbeb',
                border: `1px solid ${isDark ? 'rgba(245,158,11,0.2)' : '#fde68a'}`,
                fontSize: 13,
                color: isDark ? '#fbbf24' : '#92400e',
                lineHeight: 1.5,
            }}>
                <span className="material-icons-outlined" style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>
                    admin_panel_settings
                </span>
                <div>
                    <strong>Master + Agent Architecture:</strong> The <code style={{
                        padding: '1px 6px',
                        borderRadius: 4,
                        backgroundColor: isDark ? 'rgba(245,158,11,0.15)' : 'rgba(245,158,11,0.1)',
                        fontSize: 12,
                    }}>master.md</code> prompt is prepended to every agent's instructions.
                    Editing it affects all agents simultaneously.
                </div>
            </div>

            {/* File selector tabs */}
            <div style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
            }}>
                {files.map(f => {
                    const m = agentMeta[f.filename] || {
                        label: f.filename,
                        icon: 'article',
                        color: '#6b7280',
                        description: '',
                    };
                    const isActive = selectedFile === f.filename;
                    return (
                        <button
                            key={f.filename}
                            onClick={() => setSelectedFile(f.filename)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '10px 18px',
                                borderRadius: 10,
                                cursor: 'pointer',
                                fontFamily: fonts.display,
                                fontSize: 13,
                                fontWeight: isActive ? 600 : 500,
                                border: isActive
                                    ? `1.5px solid ${m.color}`
                                    : `1.5px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                                backgroundColor: isActive
                                    ? isDark
                                        ? `${m.color}18`
                                        : `${m.color}10`
                                    : isDark ? '#111827' : '#ffffff',
                                color: isActive
                                    ? m.color
                                    : isDark ? '#d1d5db' : '#4b5563',
                                transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => {
                                if (!isActive) {
                                    e.currentTarget.style.backgroundColor = isDark ? '#1f2937' : '#f9fafb';
                                }
                            }}
                            onMouseLeave={e => {
                                if (!isActive) {
                                    e.currentTarget.style.backgroundColor = isDark ? '#111827' : '#ffffff';
                                }
                            }}
                        >
                            <span className="material-icons" style={{ fontSize: 18, color: m.color }}>{m.icon}</span>
                            {m.label}
                            <span style={{
                                fontSize: 10,
                                fontWeight: 600,
                                padding: '2px 7px',
                                borderRadius: 10,
                                backgroundColor: isDark ? '#374151' : '#f3f4f6',
                                color: isDark ? '#9ca3af' : '#6b7280',
                            }}>
                                {formatBytes(f.size_bytes)}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Editor Card */}
            {selectedFile && (
                <div style={card(isDark)}>
                    {/* Card Header */}
                    <div style={{
                        padding: '16px 24px',
                        borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span
                                className="material-icons"
                                style={{ fontSize: 20, color: meta?.color || '#6b7280' }}
                            >
                                {meta?.icon || 'article'}
                            </span>
                            <div>
                                <div style={{
                                    fontSize: 15,
                                    fontWeight: 600,
                                    letterSpacing: '-0.01em',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                }}>
                                    {meta?.label || selectedFile}
                                    {hasChanges && (
                                        <span style={{
                                            fontSize: 10,
                                            fontWeight: 700,
                                            padding: '2px 8px',
                                            borderRadius: 9999,
                                            backgroundColor: isDark ? 'rgba(245,158,11,0.15)' : '#fffbeb',
                                            color: '#f59e0b',
                                            border: '1px solid rgba(245,158,11,0.3)',
                                        }}>
                                            MODIFIED
                                        </span>
                                    )}
                                </div>
                                <div style={{
                                    fontSize: 11,
                                    color: isDark ? '#6b7280' : '#9ca3af',
                                    marginTop: 2,
                                }}>
                                    {meta?.description}
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {/* Metadata badges */}
                            <span style={{
                                fontSize: 11,
                                fontWeight: 500,
                                padding: '3px 10px',
                                borderRadius: 6,
                                backgroundColor: isDark ? '#1f2937' : '#f3f4f6',
                                color: isDark ? '#9ca3af' : '#6b7280',
                            }}>
                                {lineCount} lines
                            </span>

                            {/* Reset button */}
                            {hasChanges && (
                                <button
                                    onClick={() => setContent(originalContent)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        padding: '6px 14px',
                                        fontSize: 12,
                                        fontWeight: 600,
                                        fontFamily: fonts.display,
                                        borderRadius: 8,
                                        border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                                        backgroundColor: 'transparent',
                                        color: isDark ? '#d1d5db' : '#4b5563',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s',
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.backgroundColor = isDark ? '#1f2937' : '#f3f4f6';
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                >
                                    <span className="material-icons" style={{ fontSize: 14 }}>undo</span>
                                    Reset
                                </button>
                            )}

                            {/* Save button */}
                            <button
                                onClick={handleSave}
                                disabled={!hasChanges || saving}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '7px 18px',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    fontFamily: fonts.display,
                                    borderRadius: 8,
                                    border: 'none',
                                    backgroundColor: hasChanges
                                        ? meta?.color || colors.primary
                                        : isDark ? '#374151' : '#e5e7eb',
                                    color: hasChanges ? '#ffffff' : isDark ? '#6b7280' : '#9ca3af',
                                    cursor: hasChanges && !saving ? 'pointer' : 'not-allowed',
                                    boxShadow: hasChanges ? `0 4px 12px -2px ${meta?.color || colors.primary}40` : 'none',
                                    transition: 'all 0.15s',
                                    opacity: saving ? 0.7 : 1,
                                }}
                            >
                                <span className="material-icons" style={{ fontSize: 16 }}>
                                    {saving ? 'sync' : 'save'}
                                </span>
                                {saving ? 'Saving…' : 'Save Changes'}
                            </button>
                        </div>
                    </div>

                    {/* Editor */}
                    <div style={{ padding: 0, position: 'relative' }}>
                        {loading ? (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '60px 24px',
                                color: isDark ? '#6b7280' : '#9ca3af',
                                gap: 8,
                            }}>
                                <span className="material-icons" style={{
                                    fontSize: 20,
                                    animation: 'spin 1s linear infinite',
                                }}>sync</span>
                                Loading prompt file…
                            </div>
                        ) : (
                            <textarea
                                value={content}
                                onChange={e => setContent(e.target.value)}
                                spellCheck={false}
                                style={{
                                    width: '100%',
                                    minHeight: 500,
                                    padding: '20px 24px',
                                    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
                                    fontSize: 13,
                                    lineHeight: 1.7,
                                    color: isDark ? '#e5e7eb' : '#1f2937',
                                    backgroundColor: isDark ? '#0f1218' : '#fafbfc',
                                    border: 'none',
                                    outline: 'none',
                                    resize: 'vertical',
                                    tabSize: 2,
                                    boxSizing: 'border-box',
                                }}
                            />
                        )}
                    </div>

                    {/* Footer */}
                    <div style={{
                        padding: '12px 24px',
                        borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: 11,
                        color: isDark ? '#4b5563' : '#9ca3af',
                    }}>
                        <span>
                            {selectedFile} · {content.length.toLocaleString()} characters
                        </span>
                        <span>
                            Last modified: {files.find(f => f.filename === selectedFile)
                                ? formatDate(files.find(f => f.filename === selectedFile)!.last_modified)
                                : '—'}
                        </span>
                    </div>
                </div>
            )}

            {/* Toast notification */}
            {toast && (
                <div style={{
                    position: 'fixed',
                    bottom: 24,
                    right: 24,
                    padding: '12px 20px',
                    borderRadius: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: fonts.display,
                    backgroundColor: toast.type === 'success'
                        ? isDark ? 'rgba(34,197,94,0.15)' : '#f0fdf4'
                        : isDark ? 'rgba(239,68,68,0.15)' : '#fef2f2',
                    color: toast.type === 'success'
                        ? isDark ? '#86efac' : '#16a34a'
                        : isDark ? '#fca5a5' : '#dc2626',
                    border: `1px solid ${toast.type === 'success'
                            ? isDark ? 'rgba(34,197,94,0.3)' : '#bbf7d0'
                            : isDark ? 'rgba(239,68,68,0.3)' : '#fecaca'
                        }`,
                    boxShadow: '0 10px 30px -5px rgba(0,0,0,0.2)',
                    zIndex: 9999,
                    animation: 'slideUp 0.3s ease-out',
                }}>
                    <span className="material-icons" style={{ fontSize: 18 }}>
                        {toast.type === 'success' ? 'check_circle' : 'error'}
                    </span>
                    {toast.message}
                </div>
            )}

            {/* Animation keyframes */}
            <style>{`
                @keyframes slideUp {
                    from { opacity: 0; transform: translateY(16px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}
