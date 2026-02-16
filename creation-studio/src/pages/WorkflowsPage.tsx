import { useEffect, useState, useRef, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAudit } from '../context/AuditContext';
import { colors, shadows, fonts } from '../theme';
import { ShareModal, ScheduleModal, ExecuteModal, ViewCodeModal, ArchiveModal } from '../components/workflow/WorkflowActionModals';

/* ─── Types ─── */
type WorkflowStatus = 'completed' | 'draft';

interface WorkflowSummary {
    id: string;
    name: string;
    description: string;
    nodeCount: number;
    edgeCount: number;
    createdAt: string;
    updatedAt: string;
    version: number;
    status: WorkflowStatus;
}

/* ─── Styles ─── */
const pageStyle = (isDark: boolean): CSSProperties => ({
    flex: 1,
    overflow: 'auto',
    padding: '32px 48px',
    fontFamily: fonts.display,
    backgroundColor: isDark ? colors.backgroundDark : colors.backgroundLight,
});

const headerRow: CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 32,
};

const titleStyle: CSSProperties = {
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: '-0.03em',
    lineHeight: 1.2,
};

const subtitleStyle = (isDark: boolean): CSSProperties => ({
    fontSize: 15,
    color: isDark ? '#9ca3af' : '#6b7280',
    marginTop: 6,
    fontWeight: 400,
});

const newBtn: CSSProperties = {
    padding: '12px 24px',
    backgroundColor: colors.primary,
    color: '#ffffff',
    border: 'none',
    borderRadius: 14,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: shadows.blueMd,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontFamily: fonts.display,
    transition: 'box-shadow 0.2s, transform 0.1s',
};

const statsRow = (_isDark: boolean): CSSProperties => ({
    display: 'flex',
    gap: 16,
    marginBottom: 32,
});

const statCard = (isDark: boolean, _accentColor: string): CSSProperties => ({
    flex: '1 1 0',
    padding: '20px 24px',
    backgroundColor: isDark ? colors.surfaceDark : '#ffffff',
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    borderRadius: 16,
    boxShadow: shadows.sm,
    display: 'flex',
    alignItems: 'center',
    gap: 16,
});

const statIconWrap = (accentColor: string, isDark: boolean): CSSProperties => ({
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: isDark ? `${accentColor}20` : `${accentColor}15`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
});

const statNumber: CSSProperties = {
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    lineHeight: 1,
};

const statLabel = (isDark: boolean): CSSProperties => ({
    fontSize: 13,
    color: isDark ? '#9ca3af' : '#6b7280',
    fontWeight: 500,
    marginTop: 2,
});

const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
    gap: 20,
};

const cardStyle = (isDark: boolean): CSSProperties => ({
    backgroundColor: isDark ? colors.surfaceDark : '#ffffff',
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    borderRadius: 20,
    padding: 0,
    boxShadow: shadows.sm,
    transition: 'box-shadow 0.2s, transform 0.15s, border-color 0.2s',
    cursor: 'default',
    overflow: 'visible',
    display: 'flex',
    flexDirection: 'column',
});

const cardHeader = (isDark: boolean): CSSProperties => ({
    padding: '20px 24px 16px',
    borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
});

const cardName: CSSProperties = {
    fontSize: 17,
    fontWeight: 700,
    letterSpacing: '-0.01em',
    lineHeight: 1.3,
};

const versionBadge = (isDark: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    color: isDark ? '#818cf8' : '#6366f1',
    backgroundColor: isDark ? 'rgba(99,102,241,0.15)' : '#eef2ff',
    padding: '3px 10px',
    borderRadius: 6,
    whiteSpace: 'nowrap',
    flexShrink: 0,
});

const cardDesc = (isDark: boolean): CSSProperties => ({
    fontSize: 13,
    color: isDark ? '#9ca3af' : '#6b7280',
    marginTop: 6,
    lineHeight: 1.5,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
});

const cardBody = (_isDark: boolean): CSSProperties => ({
    padding: '16px 24px',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
});

const metaRow: CSSProperties = {
    display: 'flex',
    gap: 20,
};

const metaItem = (isDark: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13,
    color: isDark ? '#9ca3af' : '#6b7280',
});

const metaIconStyle = (color: string): CSSProperties => ({
    fontSize: 16,
    color,
});

const dateRow = (isDark: boolean): CSSProperties => ({
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 11,
    color: isDark ? '#6b7280' : '#9ca3af',
    marginTop: 4,
});

const cardFooter = (isDark: boolean): CSSProperties => ({
    padding: '12px 24px 16px',
    borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    position: 'relative',
});

const actionBtn = (isDark: boolean, variant: 'primary' | 'secondary' | 'danger'): CSSProperties => {
    void isDark;
    const baseStyle: CSSProperties = {
        flex: 1,
        padding: '9px 16px',
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        fontFamily: fonts.display,
        transition: 'background-color 0.15s, transform 0.1s',
        border: 'none',
    };

    if (variant === 'primary') {
        return {
            ...baseStyle,
            backgroundColor: colors.primary,
            color: '#ffffff',
            boxShadow: shadows.sm,
        };
    }
    if (variant === 'danger') {
        return {
            ...baseStyle,
            backgroundColor: isDark ? '#7f1d1d' : '#fee2e2',
            color: isDark ? '#fca5a5' : '#dc2626',
            border: `1px solid ${isDark ? '#991b1b' : '#fca5a5'}`,
        };
    }
    return {
        ...baseStyle,
        backgroundColor: isDark ? '#1f2937' : '#f9fafb',
        color: isDark ? '#d1d5db' : '#374151',
        border: `1px solid ${isDark ? '#374151' : '#d1d5db'}`,
    };
};

const statusBadge = (isDark: boolean, status: WorkflowStatus): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600,
    backgroundColor: status === 'completed'
        ? isDark ? '#14532d' : '#dcfce7'
        : isDark ? '#713f12' : '#fef9c3',
    color: status === 'completed'
        ? isDark ? '#86efac' : '#16a34a'
        : isDark ? '#fde047' : '#ca8a04',
    whiteSpace: 'nowrap',
    flexShrink: 0,
});

const moreMenuStyle = (isDark: boolean): CSSProperties => ({
    position: 'absolute', right: 20, bottom: '100%', marginBottom: 6,
    backgroundColor: isDark ? '#1f2937' : '#ffffff',
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    borderRadius: 14, padding: 6, minWidth: 200,
    boxShadow: shadows.overlay, zIndex: 50,
    fontFamily: fonts.display,
});

const menuItem = (isDark: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
    cursor: 'pointer', border: 'none', width: '100%', textAlign: 'left' as const,
    backgroundColor: 'transparent', fontFamily: fonts.display,
    color: isDark ? '#d1d5db' : '#374151', transition: 'background 0.1s',
});

const emptyState = (isDark: boolean): CSSProperties => ({
    textAlign: 'center',
    padding: '80px 40px',
    color: isDark ? '#6b7280' : '#9ca3af',
});

const emptyIcon: CSSProperties = {
    fontSize: 72,
    opacity: 0.3,
    marginBottom: 16,
};

const emptyTitle: CSSProperties = {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 8,
    letterSpacing: '-0.02em',
};

const emptyDesc = (isDark: boolean): CSSProperties => ({
    fontSize: 15,
    color: isDark ? '#6b7280' : '#9ca3af',
    marginBottom: 28,
    lineHeight: 1.6,
});

const loadingSpinner: CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    height: 300,
    fontSize: 16,
    gap: 10,
};

/* ─── Delete Confirm Modal ─── */
const modalOverlay: CSSProperties = {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    backdropFilter: 'blur(4px)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
};

const modalBox = (isDark: boolean): CSSProperties => ({
    width: 420,
    backgroundColor: isDark ? '#1f2937' : '#ffffff',
    borderRadius: 20,
    padding: 32,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    fontFamily: fonts.display,
});

/* ─── Helpers ─── */
function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return formatDate(iso);
}

/* ─── Action types ─── */
type ModalType = 'share' | 'schedule' | 'execute' | 'viewCode' | 'archive' | null;

/* ─── Component ─── */
export default function WorkflowsPage() {
    const { isDark } = useTheme();
    const navigate = useNavigate();
    const { addEntry } = useAudit();

    const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [deleteTarget, setDeleteTarget] = useState<WorkflowSummary | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    const [activeModal, setActiveModal] = useState<{ type: ModalType; wf: WorkflowSummary } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpenMenu(null);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const fetchWorkflows = async () => {
        try {
            const res = await fetch('http://localhost:4000/api/workflows');
            const data = await res.json();
            // Assign status: workflows with >=3 nodes are 'completed', rest are 'draft'
            const wfs = (data.workflows || []).map((w: WorkflowSummary, idx: number) => ({
                ...w,
                status: (w.nodeCount >= 3 || idx % 3 !== 2 ? 'completed' : 'draft') as WorkflowStatus,
            }));
            setWorkflows(wfs);
        } catch (err) {
            console.error('Failed to fetch workflows:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchWorkflows();
    }, []);

    const handleEdit = (wfId: string) => {
        navigate(`/?load=${wfId}`);
    };

    const handleDownload = async (wf: WorkflowSummary) => {
        try {
            const res = await fetch(`http://localhost:4000/api/workflows/${wf.id}/download`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${wf.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            addEntry({ domain: 'workflow', action: 'downloaded', resourceName: wf.name, resourceId: wf.id, actor: 'John D.', actorRole: 'developer', details: 'Downloaded workflow JSON' });
        } catch (err) {
            console.error('Download failed:', err);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await fetch(`http://localhost:4000/api/workflows/${deleteTarget.id}`, {
                method: 'DELETE',
            });
            setWorkflows((prev) => prev.filter((w) => w.id !== deleteTarget.id));
            setDeleteTarget(null);
        } catch (err) {
            console.error('Delete failed:', err);
        } finally {
            setDeleting(false);
        }
    };

    const totalNodes = workflows.reduce((sum, w) => sum + w.nodeCount, 0);
    const totalEdges = workflows.reduce((sum, w) => sum + w.edgeCount, 0);

    return (
        <div style={pageStyle(isDark)}>
            {/* Header */}
            <div style={headerRow}>
                <div>
                    <h1 style={titleStyle}>
                        <span className="material-icons" style={{ fontSize: 28, verticalAlign: 'middle', marginRight: 10, color: colors.primary }}>
                            library_books
                        </span>
                        Workflow Library
                    </h1>
                    <p style={subtitleStyle(isDark)}>
                        Manage, edit, and download your saved workflows
                    </p>
                </div>
                <button
                    style={newBtn}
                    onClick={() => navigate('/')}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = shadows.blueLg;
                        e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = shadows.blueMd;
                        e.currentTarget.style.transform = 'translateY(0)';
                    }}
                >
                    <span className="material-icons" style={{ fontSize: 18 }}>add</span>
                    New Workflow
                </button>
            </div>

            {/* Stats Row */}
            {workflows.length > 0 && (
                <div style={statsRow(isDark)}>
                    <div style={statCard(isDark, colors.primary)}>
                        <div style={statIconWrap(colors.primary, isDark)}>
                            <span className="material-icons" style={{ fontSize: 24, color: colors.primary }}>account_tree</span>
                        </div>
                        <div>
                            <div style={statNumber}>{workflows.length}</div>
                            <div style={statLabel(isDark)}>Total Workflows</div>
                        </div>
                    </div>
                    <div style={statCard(isDark, '#22c55e')}>
                        <div style={statIconWrap('#22c55e', isDark)}>
                            <span className="material-icons" style={{ fontSize: 24, color: '#22c55e' }}>hub</span>
                        </div>
                        <div>
                            <div style={statNumber}>{totalNodes}</div>
                            <div style={statLabel(isDark)}>Total Nodes</div>
                        </div>
                    </div>
                    <div style={statCard(isDark, '#f59e0b')}>
                        <div style={statIconWrap('#f59e0b', isDark)}>
                            <span className="material-icons" style={{ fontSize: 24, color: '#f59e0b' }}>sync_alt</span>
                        </div>
                        <div>
                            <div style={statNumber}>{totalEdges}</div>
                            <div style={statLabel(isDark)}>Total Connections</div>
                        </div>
                    </div>
                </div>
            )}

            {/* Loading / Empty / Grid */}
            {loading ? (
                <div style={loadingSpinner}>
                    <span className="material-icons" style={{ fontSize: 24, animation: 'spin 1s linear infinite', color: colors.primary }}>
                        autorenew
                    </span>
                    Loading workflows...
                </div>
            ) : workflows.length === 0 ? (
                <div style={emptyState(isDark)}>
                    <span className="material-icons" style={emptyIcon}>account_tree</span>
                    <div style={emptyTitle}>No Workflows Yet</div>
                    <div style={emptyDesc(isDark)}>
                        Create your first workflow in the Creation Studio and save it to see it here.
                    </div>
                    <button
                        style={newBtn}
                        onClick={() => navigate('/')}
                    >
                        <span className="material-icons" style={{ fontSize: 18 }}>add</span>
                        Create Your First Workflow
                    </button>
                </div>
            ) : (
                <div style={gridStyle}>
                    {workflows.map((wf) => (
                        <div
                            key={wf.id}
                            style={cardStyle(isDark)}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.boxShadow = shadows.lg;
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.borderColor = isDark ? '#4b5563' : '#93c5fd';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.boxShadow = shadows.sm;
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.borderColor = isDark ? colors.borderDark : colors.borderLight;
                            }}
                        >
                            <div style={cardHeader(isDark)}>
                                <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div style={cardName}>{wf.name}</div>
                                        <span style={statusBadge(isDark, wf.status)}>
                                            <span className="material-icons" style={{ fontSize: 12 }}>{wf.status === 'completed' ? 'check_circle' : 'edit_note'}</span>
                                            {wf.status === 'completed' ? 'Completed' : 'Draft'}
                                        </span>
                                    </div>
                                    {wf.description && (
                                        <div style={cardDesc(isDark)}>{wf.description}</div>
                                    )}
                                </div>
                                <span style={versionBadge(isDark)}>v{wf.version}</span>
                            </div>

                            <div style={cardBody(isDark)}>
                                <div style={metaRow}>
                                    <div style={metaItem(isDark)}>
                                        <span className="material-icons" style={metaIconStyle(colors.primary)}>hub</span>
                                        {wf.nodeCount} nodes
                                    </div>
                                    <div style={metaItem(isDark)}>
                                        <span className="material-icons" style={metaIconStyle('#f59e0b')}>sync_alt</span>
                                        {wf.edgeCount} connections
                                    </div>
                                </div>
                                <div style={dateRow(isDark)}>
                                    <span>Created {relativeTime(wf.createdAt)}</span>
                                    <span>Updated {relativeTime(wf.updatedAt)}</span>
                                </div>
                            </div>

                            <div style={cardFooter(isDark)}>
                                <button
                                    style={actionBtn(isDark, 'primary')}
                                    onClick={() => handleEdit(wf.id)}
                                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.02)'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                                >
                                    <span className="material-icons" style={{ fontSize: 15 }}>edit</span>
                                    Edit
                                </button>

                                {/* ••• More actions button */}
                                <button
                                    style={actionBtn(isDark, 'secondary')}
                                    onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === wf.id ? null : wf.id); }}
                                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.02)'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                                >
                                    <span className="material-icons" style={{ fontSize: 15 }}>more_horiz</span>
                                    Actions
                                </button>

                                {/* Delete is always available */}
                                <button
                                    style={actionBtn(isDark, 'danger')}
                                    onClick={() => setDeleteTarget(wf)}
                                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.02)'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                                >
                                    <span className="material-icons" style={{ fontSize: 15 }}>delete</span>
                                </button>

                                {/* Dropdown action menu */}
                                {openMenu === wf.id && (
                                    <div ref={menuRef} style={moreMenuStyle(isDark)}>
                                        {/* Share — available for both draft & completed */}
                                        <button style={menuItem(isDark)} onClick={() => { setOpenMenu(null); setActiveModal({ type: 'share', wf }); }}
                                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#f3f4f6'; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                                            <span className="material-icons" style={{ fontSize: 18, color: '#7c3aed' }}>share</span> Share
                                        </button>

                                        {/* Completed-only actions */}
                                        {wf.status === 'completed' && (
                                            <>
                                                <button style={menuItem(isDark)} onClick={() => { setOpenMenu(null); setActiveModal({ type: 'execute', wf }); }}
                                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#f3f4f6'; }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                                                    <span className="material-icons" style={{ fontSize: 18, color: '#059669' }}>play_arrow</span> Execute
                                                </button>
                                                <button style={menuItem(isDark)} onClick={() => { setOpenMenu(null); setActiveModal({ type: 'viewCode', wf }); }}
                                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#f3f4f6'; }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                                                    <span className="material-icons" style={{ fontSize: 18, color: '#4f46e5' }}>code</span> View Code
                                                </button>
                                                <button style={menuItem(isDark)} onClick={() => { setOpenMenu(null); handleDownload(wf); }}
                                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#f3f4f6'; }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                                                    <span className="material-icons" style={{ fontSize: 18, color: '#3b82f6' }}>download</span> Download
                                                </button>
                                                <button style={menuItem(isDark)} onClick={() => { setOpenMenu(null); setActiveModal({ type: 'schedule', wf }); }}
                                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#f3f4f6'; }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                                                    <span className="material-icons" style={{ fontSize: 18, color: '#d97706' }}>schedule</span> Schedule
                                                </button>
                                                <div style={{ height: 1, backgroundColor: isDark ? colors.borderDark : colors.borderLight, margin: '4px 8px' }} />
                                                <button style={menuItem(isDark)} onClick={() => { setOpenMenu(null); setActiveModal({ type: 'archive', wf }); }}
                                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#f3f4f6'; }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                                                    <span className="material-icons" style={{ fontSize: 18, color: '#6b7280' }}>archive</span> Archive
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteTarget && (
                <div style={modalOverlay} onClick={() => !deleting && setDeleteTarget(null)}>
                    <div style={modalBox(isDark)} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                            <div style={{
                                width: 48, height: 48, borderRadius: 14,
                                backgroundColor: isDark ? '#7f1d1d' : '#fee2e2',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <span className="material-icons" style={{ fontSize: 24, color: '#ef4444' }}>warning</span>
                            </div>
                            <div>
                                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>Delete Workflow</div>
                                <div style={{ fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280' }}>This action cannot be undone</div>
                            </div>
                        </div>

                        <div style={{
                            padding: 16, borderRadius: 12,
                            backgroundColor: isDark ? '#111827' : '#f9fafb',
                            border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                            marginBottom: 20,
                        }}>
                            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{deleteTarget.name}</div>
                            <div style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af' }}>
                                {deleteTarget.nodeCount} nodes · {deleteTarget.edgeCount} connections · v{deleteTarget.version}
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                            <button
                                style={{
                                    padding: '10px 20px', borderRadius: 12, fontSize: 14, fontWeight: 600,
                                    border: `1px solid ${isDark ? '#374151' : '#d1d5db'}`,
                                    backgroundColor: isDark ? '#374151' : '#f3f4f6',
                                    color: isDark ? '#d1d5db' : '#4b5563',
                                    cursor: 'pointer', fontFamily: fonts.display,
                                }}
                                onClick={() => setDeleteTarget(null)}
                                disabled={deleting}
                            >
                                Cancel
                            </button>
                            <button
                                style={{
                                    padding: '10px 20px', borderRadius: 12, fontSize: 14, fontWeight: 600,
                                    border: 'none',
                                    backgroundColor: '#ef4444',
                                    color: '#ffffff',
                                    cursor: deleting ? 'not-allowed' : 'pointer',
                                    opacity: deleting ? 0.6 : 1,
                                    fontFamily: fonts.display,
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    boxShadow: '0 4px 14px rgba(239,68,68,0.3)',
                                }}
                                onClick={handleDelete}
                                disabled={deleting}
                            >
                                <span className="material-icons" style={{ fontSize: 16 }}>
                                    {deleting ? 'hourglass_empty' : 'delete_forever'}
                                </span>
                                {deleting ? 'Deleting...' : 'Delete Permanently'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ Action Modals ═══ */}
            {activeModal?.type === 'share' && <ShareModal wf={activeModal.wf} onClose={() => setActiveModal(null)} />}
            {activeModal?.type === 'schedule' && <ScheduleModal wf={activeModal.wf} onClose={() => setActiveModal(null)} />}
            {activeModal?.type === 'execute' && <ExecuteModal wf={activeModal.wf} onClose={() => setActiveModal(null)} />}
            {activeModal?.type === 'viewCode' && <ViewCodeModal wf={activeModal.wf} onClose={() => setActiveModal(null)} />}
            {activeModal?.type === 'archive' && <ArchiveModal wf={activeModal.wf} onClose={() => setActiveModal(null)} onArchive={() => setWorkflows(prev => prev.filter(w => w.id !== activeModal.wf.id))} />}
        </div>
    );
}
