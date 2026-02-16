import { useState, useRef, useCallback, useEffect, type CSSProperties, type DragEvent } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useFileLibrary, type LibraryScope, type LibraryFile } from '../context/FileLibraryContext';
import { colors, shadows, fonts } from '../theme';
import PolicySettings from '../components/settings/PolicySettings';

/* ─── Types ─── */
type SettingsTab = 'fileLibrary' | 'policySettings' | 'userProfile';

interface UploadedFile {
    name: string;
    size: number;
    type: string;
    uploadedAt: string;
    status: 'uploading' | 'uploaded' | 'vectorizing' | 'vectorized' | 'error';
}

const ACCEPTED = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.md,.txt,.json';
const ACCEPTED_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/markdown',
    'text/plain',
    'application/json',
];

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

const scopeLabels: Record<LibraryScope, string> = {
    personal: 'Personal Library',
    team: 'My Team',
    global: 'Global Library',
};

const scopeIcons: Record<LibraryScope, string> = {
    personal: 'person',
    team: 'group',
    global: 'public',
};

const scopeDescriptions: Record<LibraryScope, string> = {
    personal: 'Files visible only to you',
    team: 'Shared with your team members',
    global: 'Available to everyone in the organization',
};

/* ─── Helpers ─── */
function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function fileIcon(name: string): { icon: string; color: string } {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') return { icon: 'picture_as_pdf', color: '#ef4444' };
    if (['doc', 'docx'].includes(ext)) return { icon: 'description', color: '#3b82f6' };
    if (['xls', 'xlsx'].includes(ext)) return { icon: 'table_chart', color: '#22c55e' };
    if (ext === 'csv') return { icon: 'table_chart', color: '#16a34a' };
    if (['md', 'txt'].includes(ext)) return { icon: 'article', color: '#3b82f6' };
    if (ext === 'json') return { icon: 'data_object', color: '#f59e0b' };
    return { icon: 'insert_drive_file', color: '#9ca3af' };
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const navItems: { key: SettingsTab; label: string; icon: string; description: string }[] = [
    { key: 'fileLibrary', label: 'File Library', icon: 'local_library', description: 'Manage files across libraries' },
    { key: 'policySettings', label: 'Policy Settings', icon: 'policy', description: 'Configure security policies' },
    { key: 'userProfile', label: 'User Profile', icon: 'account_circle', description: 'Your account settings' },
];

/* ─────────── Styles ─────────── */
const page = (isDark: boolean): CSSProperties => ({
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    backgroundColor: isDark ? colors.backgroundDark : colors.backgroundLight,
    fontFamily: fonts.display,
});

const settingsSidebar = (isDark: boolean): CSSProperties => ({
    width: 280,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    borderRight: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight,
    overflowY: 'auto',
});

const sidebarHeader: CSSProperties = {
    padding: '28px 24px 20px',
};

const sidebarTitle: CSSProperties = {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: '-0.02em',
};

const sidebarSubtitle = (isDark: boolean): CSSProperties => ({
    fontSize: 13,
    color: isDark ? '#9ca3af' : '#6b7280',
    marginTop: 4,
    lineHeight: 1.5,
});

const navList: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '0 12px',
};

const navItem = (isDark: boolean, isActive: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 16px',
    borderRadius: 10,
    cursor: 'pointer',
    backgroundColor: isActive
        ? isDark ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.08)'
        : 'transparent',
    border: isActive
        ? `1px solid ${isDark ? 'rgba(59,130,246,0.25)' : 'rgba(59,130,246,0.2)'}`
        : '1px solid transparent',
    transition: 'all 0.15s',
    position: 'relative',
});

const navIcon = (isDark: boolean, isActive: boolean): CSSProperties => ({
    fontSize: 20,
    color: isActive
        ? colors.primary
        : isDark ? '#9ca3af' : '#6b7280',
    transition: 'color 0.15s',
});

const navLabel = (isDark: boolean, isActive: boolean): CSSProperties => ({
    fontSize: 14,
    fontWeight: isActive ? 600 : 500,
    color: isActive
        ? isDark ? '#e5e7eb' : '#1f2937'
        : isDark ? '#d1d5db' : '#4b5563',
    transition: 'color 0.15s',
});

const navDesc = (isDark: boolean): CSSProperties => ({
    fontSize: 11,
    color: isDark ? '#6b7280' : '#9ca3af',
    marginTop: 1,
});

const mainContent: CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: 32,
};

const contentContainer: CSSProperties = {
    maxWidth: 900,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
};

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

const card = (isDark: boolean): CSSProperties => ({
    backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight,
    borderRadius: 16,
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    boxShadow: shadows.sm,
    overflow: 'hidden',
});

const cardHeader = (isDark: boolean): CSSProperties => ({
    padding: '18px 24px',
    borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
});

const cardTitle: CSSProperties = {
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
};

const cardBody: CSSProperties = {
    padding: 24,
};

const dropzone = (isDark: boolean, dragActive: boolean): CSSProperties => ({
    border: `2px dashed ${dragActive ? colors.primary : isDark ? '#4b5563' : '#d1d5db'}`,
    borderRadius: 12,
    padding: '40px 24px',
    textAlign: 'center',
    cursor: 'pointer',
    backgroundColor: dragActive
        ? isDark ? 'rgba(59,130,246,0.08)' : '#eff6ff'
        : isDark ? 'rgba(17,24,39,0.5)' : '#fafafa',
    transition: 'border-color 0.2s, background-color 0.2s',
});

const dropIcon = (dragActive: boolean): CSSProperties => ({
    fontSize: 44,
    color: dragActive ? colors.primary : '#9ca3af',
    marginBottom: 10,
    transition: 'color 0.2s',
});

const dropTitle = (isDark: boolean): CSSProperties => ({
    fontSize: 15,
    fontWeight: 600,
    color: isDark ? '#e5e7eb' : '#1f2937',
    marginBottom: 4,
});

const dropSub = (isDark: boolean): CSSProperties => ({
    fontSize: 12,
    color: isDark ? '#9ca3af' : '#6b7280',
    marginBottom: 14,
});

const browseBtn: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 20px',
    backgroundColor: colors.primary,
    color: '#ffffff',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    boxShadow: shadows.blueMd,
    fontFamily: fonts.display,
    transition: 'background 0.15s',
};

const chipRow: CSSProperties = {
    display: 'flex',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 14,
};

const chipStyle = (isDark: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 6,
    backgroundColor: isDark ? '#1f2937' : '#f3f4f6',
    color: isDark ? '#d1d5db' : '#4b5563',
    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
});

const scopeTab = (isDark: boolean, isActive: boolean): CSSProperties => ({
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
        ? `1.5px solid ${colors.primary}`
        : `1.5px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: isActive
        ? isDark ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.05)'
        : isDark ? '#111827' : '#ffffff',
    color: isActive
        ? colors.primary
        : isDark ? '#d1d5db' : '#4b5563',
    transition: 'all 0.15s',
});

const scopeCount = (isDark: boolean, isActive: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 700,
    padding: '1px 7px',
    borderRadius: 10,
    backgroundColor: isActive
        ? isDark ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.15)'
        : isDark ? '#374151' : '#e5e7eb',
    color: isActive
        ? colors.primary
        : isDark ? '#9ca3af' : '#6b7280',
});

const fileTable = (isDark: boolean): CSSProperties => ({
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
    color: isDark ? '#e5e7eb' : '#1f2937',
});

const thStyle = (isDark: boolean): CSSProperties => ({
    textAlign: 'left',
    padding: '10px 16px',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: isDark ? '#9ca3af' : '#6b7280',
    borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
});

const tdStyle = (isDark: boolean): CSSProperties => ({
    padding: '12px 16px',
    borderBottom: `1px solid ${isDark ? '#1f2937' : '#f3f4f6'}`,
    verticalAlign: 'middle',
});

const statusBadge = (status: UploadedFile['status'], isDark: boolean): CSSProperties => {
    const map: Record<string, { bg: string; color: string }> = {
        uploading: { bg: isDark ? '#1e3a5f' : '#dbeafe', color: isDark ? '#93c5fd' : '#2563eb' },
        uploaded: { bg: isDark ? '#14532d' : '#dcfce7', color: isDark ? '#86efac' : '#16a34a' },
        vectorizing: { bg: isDark ? '#713f12' : '#fef9c3', color: isDark ? '#fde047' : '#ca8a04' },
        vectorized: { bg: isDark ? '#312e81' : '#e0e7ff', color: isDark ? '#a5b4fc' : '#4f46e5' },
        error: { bg: isDark ? '#7f1d1d' : '#fee2e2', color: isDark ? '#fca5a5' : '#dc2626' },
    };
    const s = map[status] || map.uploaded;
    return {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 9999,
        backgroundColor: s.bg,
        color: s.color,
        textTransform: 'capitalize',
    };
};

const vectorizeAllBtn = (isDark: boolean): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 16px',
    backgroundColor: isDark ? '#312e81' : '#4f46e5',
    color: '#ffffff',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    fontFamily: fonts.display,
    boxShadow: '0 4px 6px -1px rgba(79,70,229,0.25)',
    transition: 'background 0.15s',
});

const deleteBtn = (isDark: boolean): CSSProperties => ({
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    color: isDark ? '#9ca3af' : '#9ca3af',
    transition: 'background 0.15s, color 0.15s',
});

const emptyState = (isDark: boolean): CSSProperties => ({
    textAlign: 'center',
    padding: '40px 24px',
    color: isDark ? '#6b7280' : '#9ca3af',
});

const infoBox = (isDark: boolean): CSSProperties => ({
    display: 'flex',
    gap: 12,
    padding: 14,
    borderRadius: 10,
    backgroundColor: isDark ? 'rgba(59,130,246,0.08)' : '#eff6ff',
    border: `1px solid ${isDark ? 'rgba(59,130,246,0.2)' : '#bfdbfe'}`,
    fontSize: 13,
    color: isDark ? '#93c5fd' : '#1e40af',
    lineHeight: 1.5,
});

const placeholderPage = (isDark: boolean): CSSProperties => ({
    textAlign: 'center',
    padding: '80px 24px',
    color: isDark ? '#6b7280' : '#9ca3af',
});

const uploadScopeSelect = (isDark: boolean): CSSProperties => ({
    padding: '8px 12px',
    borderRadius: 8,
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: isDark ? '#111827' : '#ffffff',
    color: isDark ? colors.textLight : colors.textDark,
    fontSize: 13,
    fontFamily: fonts.display,
    fontWeight: 500,
    outline: 'none',
    cursor: 'pointer',
});

/* ─────────── Sub-Components ─────────── */

function FileLibraryTab() {
    const { isDark } = useTheme();
    const { files: libraryFiles, getFilesByScope, addFile, removeFile } = useFileLibrary();
    const [activeScope, setActiveScope] = useState<LibraryScope>('personal');
    const [uploadScope, setUploadScope] = useState<LibraryScope>('personal');

    // Legacy upload state (for backend uploads)
    const [backendFiles, setBackendFiles] = useState<UploadedFile[]>([]);
    const [dragActive, setDragActive] = useState(false);
    const [sizeError, setSizeError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // Load files from backend on mount
    useEffect(() => {
        fetch('http://localhost:4000/api/files')
            .then((res) => res.json())
            .then((data: { files: Array<{ name: string; size: number; uploadedAt: string; status: string }> }) => {
                const loaded: UploadedFile[] = data.files.map((f) => ({
                    name: f.name,
                    size: f.size,
                    type: '',
                    uploadedAt: new Date(f.uploadedAt).toLocaleString(),
                    status: (f.status as UploadedFile['status']) || 'uploaded',
                }));
                setBackendFiles(loaded);
            })
            .catch(() => { /* server may not be running */ });
    }, []);

    const handleFiles = useCallback((incoming: FileList | null) => {
        if (!incoming) return;
        setSizeError('');
        for (let i = 0; i < incoming.length; i++) {
            const f = incoming[i];
            if (f.size > MAX_FILE_SIZE) {
                setSizeError(`"${f.name}" exceeds the 25 MB limit (${formatBytes(f.size)})`);
                continue;
            }

            // Add to FileLibrary context in selected scope
            addFile({
                name: f.name,
                size: f.size,
                type: f.type || 'application/octet-stream',
                scope: uploadScope,
                uploadedBy: 'You',
            });

            // Also upload to backend
            const formData = new FormData();
            formData.append('file', f);

            const entry: UploadedFile = {
                name: f.name,
                size: f.size,
                type: f.type,
                uploadedAt: new Date().toLocaleString(),
                status: 'uploading',
            };

            setBackendFiles((prev) => {
                if (prev.some((x) => x.name === f.name)) return prev;
                return [...prev, entry];
            });

            fetch('http://localhost:4000/api/upload', { method: 'POST', body: formData })
                .then((res) => res.json())
                .then(() => {
                    setBackendFiles((prev) =>
                        prev.map((x) => (x.name === f.name ? { ...x, status: 'uploaded' } : x)),
                    );
                })
                .catch(() => {
                    setBackendFiles((prev) =>
                        prev.map((x) => (x.name === f.name ? { ...x, status: 'error' } : x)),
                    );
                });
        }
    }, [addFile, uploadScope]);

    const handleDrag = useCallback((e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
        else if (e.type === 'dragleave') setDragActive(false);
    }, []);

    const handleDrop = useCallback(
        (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setDragActive(false);
            handleFiles(e.dataTransfer.files);
        },
        [handleFiles],
    );

    const handleVectorizeAll = useCallback(() => {
        const uploadedNames = backendFiles.filter((f) => f.status === 'uploaded').map((f) => f.name);
        if (uploadedNames.length === 0) return;
        setBackendFiles((prev) =>
            prev.map((f) =>
                f.status === 'uploaded' ? { ...f, status: 'vectorizing' } : f,
            ),
        );
        fetch('http://localhost:4000/api/vectorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: uploadedNames }),
        })
            .then((res) => res.json())
            .then(() => {
                setBackendFiles((prev) =>
                    prev.map((f) =>
                        f.status === 'vectorizing' ? { ...f, status: 'vectorized' } : f,
                    ),
                );
            })
            .catch(() => {
                setBackendFiles((prev) =>
                    prev.map((f) => (f.status === 'vectorizing' ? { ...f, status: 'error' } : f)),
                );
            });
    }, [backendFiles]);

    const handleDeleteBackend = useCallback((name: string) => {
        setBackendFiles((prev) => prev.filter((f) => f.name !== name));
        fetch(`http://localhost:4000/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => { });
    }, []);

    const scopedFiles = getFilesByScope(activeScope);
    const scopes: LibraryScope[] = ['personal', 'team', 'global'];

    return (
        <div style={contentContainer}>
            {/* Section Title */}
            <div>
                <h3 style={sectionTitle}>File Library</h3>
                <p style={sectionSubtitle(isDark)}>
                    Manage files across your personal, team, and global libraries. Upload documents to be vectorized for RAG retrieval.
                </p>
            </div>

            {/* Info box */}
            <div style={infoBox(isDark)}>
                <span className="material-icons-outlined" style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>
                    info
                </span>
                <div>
                    Files are organized into three libraries: <strong>Personal</strong> (only you),{' '}
                    <strong>My Team</strong> (shared with your team), and <strong>Global</strong> (everyone).
                    Max file size: <strong>25 MB</strong>.
                </div>
            </div>

            {/* Upload Card */}
            <div style={card(isDark)}>
                <div style={cardHeader(isDark)}>
                    <span style={cardTitle}>
                        <span className="material-icons" style={{ fontSize: 18, color: colors.primary }}>upload_file</span>
                        Upload Documents
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280', fontWeight: 500 }}>
                            Upload to:
                        </span>
                        <select
                            value={uploadScope}
                            onChange={(e) => setUploadScope(e.target.value as LibraryScope)}
                            style={uploadScopeSelect(isDark)}
                        >
                            <option value="personal">Personal Library</option>
                            <option value="team">My Team</option>
                            <option value="global">Global Library</option>
                        </select>
                    </div>
                </div>
                <div style={cardBody}>
                    <div
                        style={dropzone(isDark, dragActive)}
                        onDragEnter={handleDrag}
                        onDragOver={handleDrag}
                        onDragLeave={handleDrag}
                        onDrop={handleDrop}
                        onClick={() => inputRef.current?.click()}
                    >
                        <span className="material-icons-outlined" style={dropIcon(dragActive)}>
                            cloud_upload
                        </span>
                        <div style={dropTitle(isDark)}>
                            {dragActive ? 'Drop files here' : 'Drag & drop your documents here'}
                        </div>
                        <div style={dropSub(isDark)}>or click to browse · max 25 MB per file</div>
                        <button
                            style={browseBtn}
                            onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                        >
                            <span className="material-icons" style={{ fontSize: 16 }}>folder_open</span>
                            Browse Files
                        </button>
                        <input
                            ref={inputRef}
                            type="file"
                            accept={ACCEPTED}
                            multiple
                            style={{ display: 'none' }}
                            onChange={(e) => handleFiles(e.target.files)}
                        />
                    </div>
                    {sizeError && (
                        <div style={{
                            marginTop: 10,
                            padding: '10px 14px',
                            borderRadius: 8,
                            backgroundColor: isDark ? 'rgba(239,68,68,0.1)' : '#fef2f2',
                            border: '1px solid rgba(239,68,68,0.3)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 12,
                            color: '#ef4444',
                            fontWeight: 500,
                        }}>
                            <span className="material-icons" style={{ fontSize: 16 }}>error</span>
                            {sizeError}
                        </div>
                    )}
                    <div style={chipRow}>
                        {['PDF', 'DOC / DOCX', 'XLS / XLSX', 'CSV', 'Markdown', 'JSON'].map((label) => (
                            <span key={label} style={chipStyle(isDark)}>
                                <span className="material-icons" style={{ fontSize: 13 }}>check_circle</span>
                                {label}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {/* Library Browser Card */}
            <div style={card(isDark)}>
                <div style={cardHeader(isDark)}>
                    <span style={cardTitle}>
                        <span className="material-icons" style={{ fontSize: 18, color: colors.primary }}>local_library</span>
                        Library Browser
                    </span>
                    {backendFiles.some((f) => f.status === 'uploaded') && (
                        <button style={vectorizeAllBtn(isDark)} onClick={handleVectorizeAll}>
                            <span className="material-icons" style={{ fontSize: 16 }}>memory</span>
                            Vectorize All
                        </button>
                    )}
                </div>

                {/* Scope tabs */}
                <div style={{
                    padding: '16px 24px',
                    display: 'flex',
                    gap: 8,
                    borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                }}>
                    {scopes.map((scope) => {
                        const count = getFilesByScope(scope).length;
                        const isActive = activeScope === scope;
                        return (
                            <div
                                key={scope}
                                style={scopeTab(isDark, isActive)}
                                onClick={() => setActiveScope(scope)}
                                onMouseEnter={(e) => {
                                    if (!isActive) {
                                        e.currentTarget.style.backgroundColor = isDark ? '#1f2937' : '#f3f4f6';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!isActive) {
                                        e.currentTarget.style.backgroundColor = isDark ? '#111827' : '#ffffff';
                                    }
                                }}
                            >
                                <span className="material-icons" style={{ fontSize: 16 }}>
                                    {scopeIcons[scope]}
                                </span>
                                {scopeLabels[scope]}
                                <span style={scopeCount(isDark, isActive)}>{count}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Scope description */}
                <div style={{
                    padding: '10px 24px',
                    fontSize: 12,
                    color: isDark ? '#6b7280' : '#9ca3af',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                }}>
                    <span className="material-icons" style={{ fontSize: 14 }}>info_outline</span>
                    {scopeDescriptions[activeScope]}
                </div>

                {/* File list */}
                {scopedFiles.length === 0 ? (
                    <div style={emptyState(isDark)}>
                        <span className="material-icons-outlined" style={{ fontSize: 40, marginBottom: 8, display: 'block', opacity: 0.4 }}>
                            folder_open
                        </span>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>
                            No files in {scopeLabels[activeScope]}
                        </div>
                        <div style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>
                            Upload files and select this library as the destination
                        </div>
                    </div>
                ) : (
                    <table style={fileTable(isDark)}>
                        <thead>
                            <tr>
                                <th style={thStyle(isDark)}>File</th>
                                <th style={thStyle(isDark)}>Size</th>
                                <th style={thStyle(isDark)}>Uploaded</th>
                                <th style={thStyle(isDark)}>By</th>
                                <th style={{ ...thStyle(isDark), width: 48 }} />
                            </tr>
                        </thead>
                        <tbody>
                            {scopedFiles.map((f: LibraryFile) => {
                                const fi = fileIcon(f.name);
                                // Check if this file has backend status
                                const backendMatch = backendFiles.find((bf) => bf.name === f.name);
                                return (
                                    <tr key={f.id}>
                                        <td style={tdStyle(isDark)}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                <span className="material-icons" style={{ fontSize: 20, color: fi.color }}>
                                                    {fi.icon}
                                                </span>
                                                <span style={{ fontWeight: 500 }}>{f.name}</span>
                                                {backendMatch && (
                                                    <span style={statusBadge(backendMatch.status, isDark)}>
                                                        {backendMatch.status}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td style={{ ...tdStyle(isDark), color: isDark ? '#9ca3af' : '#6b7280' }}>
                                            {formatBytes(f.size)}
                                        </td>
                                        <td style={{ ...tdStyle(isDark), color: isDark ? '#9ca3af' : '#6b7280', fontSize: 13 }}>
                                            {formatDate(f.uploadedAt)}
                                        </td>
                                        <td style={{ ...tdStyle(isDark), color: isDark ? '#9ca3af' : '#6b7280', fontSize: 13 }}>
                                            {f.uploadedBy}
                                        </td>
                                        <td style={tdStyle(isDark)}>
                                            <button
                                                style={deleteBtn(isDark)}
                                                onClick={() => {
                                                    removeFile(f.id);
                                                    handleDeleteBackend(f.name);
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#fee2e2';
                                                    e.currentTarget.style.color = '#ef4444';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.backgroundColor = 'transparent';
                                                    e.currentTarget.style.color = isDark ? '#9ca3af' : '#9ca3af';
                                                }}
                                                title="Delete file"
                                            >
                                                <span className="material-icons" style={{ fontSize: 16 }}>delete</span>
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

function PolicySettingsTab() {
    return <PolicySettings />;
}

function UserProfileTab() {
    const { isDark } = useTheme();
    return (
        <div style={contentContainer}>
            <div>
                <h3 style={sectionTitle}>User Profile</h3>
                <p style={sectionSubtitle(isDark)}>
                    Manage your personal account information, preferences, and notification settings.
                </p>
            </div>
            <div style={card(isDark)}>
                <div style={placeholderPage(isDark)}>
                    <span className="material-icons-outlined" style={{ fontSize: 56, display: 'block', marginBottom: 12, opacity: 0.3 }}>
                        account_circle
                    </span>
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, color: isDark ? '#d1d5db' : '#4b5563' }}>
                        Coming Soon
                    </div>
                    <div style={{ fontSize: 13, maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
                        User profile settings will let you update your name, avatar, email preferences,
                        team memberships, and application-wide preferences.
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ─────────── Main Component ─────────── */
export default function SettingsPage() {
    const { isDark } = useTheme();
    const [activeTab, setActiveTab] = useState<SettingsTab>('fileLibrary');

    return (
        <div style={page(isDark)}>
            {/* Settings Sidebar */}
            <div style={settingsSidebar(isDark)}>
                <div style={sidebarHeader}>
                    <h2 style={sidebarTitle}>Settings</h2>
                    <p style={sidebarSubtitle(isDark)}>Manage your workspace configuration</p>
                </div>

                <nav style={navList}>
                    {navItems.map((item) => {
                        const isActive = activeTab === item.key;
                        return (
                            <div
                                key={item.key}
                                style={navItem(isDark, isActive)}
                                onClick={() => setActiveTab(item.key)}
                                onMouseEnter={(e) => {
                                    if (!isActive) {
                                        e.currentTarget.style.backgroundColor = isDark ? '#111827' : '#f3f4f6';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!isActive) {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }
                                }}
                            >
                                <span className="material-icons-outlined" style={navIcon(isDark, isActive)}>
                                    {item.icon}
                                </span>
                                <div>
                                    <div style={navLabel(isDark, isActive)}>{item.label}</div>
                                    <div style={navDesc(isDark)}>{item.description}</div>
                                </div>
                                {isActive && (
                                    <div style={{
                                        position: 'absolute',
                                        left: -1,
                                        top: '25%',
                                        bottom: '25%',
                                        width: 3,
                                        borderRadius: 2,
                                        backgroundColor: colors.primary,
                                    }} />
                                )}
                            </div>
                        );
                    })}
                </nav>

                {/* Bottom info */}
                <div style={{
                    marginTop: 'auto',
                    padding: '16px 24px',
                    borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                    fontSize: 11,
                    color: isDark ? '#4b5563' : '#9ca3af',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                }}>
                    <span className="material-icons" style={{ fontSize: 14 }}>info_outline</span>
                    Settings are saved automatically
                </div>
            </div>

            {/* Main Content */}
            <div style={mainContent}>
                {activeTab === 'fileLibrary' && <FileLibraryTab />}
                {activeTab === 'policySettings' && <PolicySettingsTab />}
                {activeTab === 'userProfile' && <UserProfileTab />}
            </div>
        </div>
    );
}
