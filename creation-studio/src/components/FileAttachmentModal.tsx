import { useState, useRef, type CSSProperties } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useFileLibrary, MAX_FILE_SIZE, type LibraryScope, type LibraryFile } from '../context/FileLibraryContext';
import { colors, fonts, shadows } from '../theme';

/* ─── Types ─── */
type ModalView = 'choose' | 'library' | 'upload';

interface Props {
    open: boolean;
    onClose: () => void;
    onFileAttached: (file: { name: string; size: number; source: 'library' | 'upload' }) => void;
}

/* ─── Helpers ─── */
const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (iso: string): string => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

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

const fileIcon = (type: string): string => {
    if (type.includes('spreadsheet') || type.includes('csv') || type.includes('excel')) return 'table_chart';
    if (type.includes('pdf')) return 'picture_as_pdf';
    if (type.includes('image')) return 'image';
    if (type.includes('json')) return 'data_object';
    if (type.includes('text') || type.includes('markdown')) return 'article';
    if (type.includes('word') || type.includes('document')) return 'description';
    return 'insert_drive_file';
};

const fileIconColor = (type: string): string => {
    if (type.includes('spreadsheet') || type.includes('csv') || type.includes('excel')) return '#16a34a';
    if (type.includes('pdf')) return '#dc2626';
    if (type.includes('image')) return '#8b5cf6';
    if (type.includes('json')) return '#f59e0b';
    if (type.includes('text') || type.includes('markdown')) return '#3b82f6';
    return '#6b7280';
};

/* ─── Component ─── */
export default function FileAttachmentModal({ open, onClose, onFileAttached }: Props) {
    const { isDark } = useTheme();
    const { getFilesByScope, addFile } = useFileLibrary();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [view, setView] = useState<ModalView>('choose');
    const [libraryScope, setLibraryScope] = useState<LibraryScope>('personal');
    const [selectedFile, setSelectedFile] = useState<LibraryFile | null>(null);

    // Upload state
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [saveToLibrary, setSaveToLibrary] = useState(false);
    const [uploadScope, setUploadScope] = useState<LibraryScope>('personal');
    const [sizeError, setSizeError] = useState('');
    const [dragOver, setDragOver] = useState(false);

    if (!open) return null;

    const resetAndClose = () => {
        setView('choose');
        setSelectedFile(null);
        setUploadFile(null);
        setSaveToLibrary(false);
        setSizeError('');
        setDragOver(false);
        onClose();
    };

    const handleLocalFile = (file: File) => {
        setSizeError('');
        if (file.size > MAX_FILE_SIZE) {
            setSizeError(`File exceeds the 25 MB limit (${formatSize(file.size)})`);
            setUploadFile(null);
            return;
        }
        setUploadFile(file);
    };

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (f) handleLocalFile(f);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) handleLocalFile(f);
    };

    const attachFromLibrary = () => {
        if (!selectedFile) return;
        onFileAttached({ name: selectedFile.name, size: selectedFile.size, source: 'library' });
        resetAndClose();
    };

    const attachFromUpload = () => {
        if (!uploadFile) return;
        if (saveToLibrary) {
            addFile({
                name: uploadFile.name,
                size: uploadFile.size,
                type: uploadFile.type || 'application/octet-stream',
                scope: uploadScope,
                uploadedBy: 'You',
            });
        }
        onFileAttached({ name: uploadFile.name, size: uploadFile.size, source: 'upload' });
        resetAndClose();
    };

    const libraryFiles = getFilesByScope(libraryScope);

    /* ─── Styles ─── */
    const overlay: CSSProperties = {
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(4px)',
    };

    const modal: CSSProperties = {
        width: 520,
        maxHeight: '80vh',
        backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight,
        borderRadius: 16,
        boxShadow: shadows.overlay,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: fonts.display,
        overflow: 'hidden',
        border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
        animation: 'fadeScaleIn 0.2s ease-out',
    };

    const modalHeader: CSSProperties = {
        padding: '20px 24px 16px',
        borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
    };

    const modalTitle: CSSProperties = {
        fontSize: 16,
        fontWeight: 700,
        color: isDark ? colors.textLight : colors.textDark,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
    };

    const closeBtn: CSSProperties = {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: isDark ? colors.textMutedLight : colors.textMuted,
        padding: 4,
        borderRadius: 6,
        display: 'flex',
    };

    const modalBody: CSSProperties = {
        padding: 24,
        flex: 1,
        overflowY: 'auto',
    };

    const modalFooter: CSSProperties = {
        padding: '16px 24px',
        borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 10,
    };

    const optCard = (hovered?: boolean): CSSProperties => ({
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '18px 20px',
        borderRadius: 12,
        border: `1.5px solid ${hovered ? colors.primary : isDark ? colors.borderDark : colors.borderLight}`,
        backgroundColor: isDark
            ? hovered ? 'rgba(59,130,246,0.08)' : '#111827'
            : hovered ? 'rgba(59,130,246,0.04)' : '#f9fafb',
        cursor: 'pointer',
        transition: 'all 0.15s',
        boxShadow: hovered ? `0 0 0 1px ${colors.primary}` : 'none',
    });

    const optIconWrap = (bg: string): CSSProperties => ({
        width: 44,
        height: 44,
        borderRadius: 10,
        backgroundColor: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    });

    const primaryBtn: CSSProperties = {
        padding: '10px 24px',
        borderRadius: 8,
        border: 'none',
        fontWeight: 600,
        fontSize: 13,
        cursor: 'pointer',
        backgroundColor: colors.primary,
        color: '#fff',
        fontFamily: fonts.display,
        transition: 'background-color 0.15s',
    };

    const secondaryBtn: CSSProperties = {
        ...primaryBtn,
        backgroundColor: isDark ? '#374151' : '#e5e7eb',
        color: isDark ? '#e5e7eb' : '#374151',
    };

    const scopeSelect: CSSProperties = {
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
    };

    const fileRow = (isSelected: boolean): CSSProperties => ({
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 10,
        cursor: 'pointer',
        border: `1.5px solid ${isSelected ? colors.primary : 'transparent'}`,
        backgroundColor: isSelected
            ? isDark ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.05)'
            : isDark ? '#111827' : '#f9fafb',
        transition: 'all 0.12s',
    });

    const dropZone: CSSProperties = {
        border: `2px dashed ${dragOver ? colors.primary : isDark ? '#4b5563' : '#d1d5db'}`,
        borderRadius: 12,
        padding: 32,
        textAlign: 'center',
        backgroundColor: dragOver
            ? isDark ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.04)'
            : isDark ? '#111827' : '#fafafa',
        transition: 'all 0.15s',
        cursor: 'pointer',
    };

    const toggleTrack = (on: boolean): CSSProperties => ({
        width: 40,
        height: 22,
        borderRadius: 11,
        backgroundColor: on ? colors.primary : isDark ? '#4b5563' : '#d1d5db',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background-color 0.2s',
        flexShrink: 0,
    });

    const toggleThumb = (on: boolean): CSSProperties => ({
        width: 16,
        height: 16,
        borderRadius: '50%',
        backgroundColor: '#fff',
        position: 'absolute',
        top: 3,
        left: on ? 21 : 3,
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    });

    const emptyState: CSSProperties = {
        textAlign: 'center',
        padding: '32px 16px',
        color: isDark ? colors.textMutedLight : colors.textMuted,
    };

    const backBtn: CSSProperties = {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: isDark ? colors.textMutedLight : colors.textMuted,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
        fontWeight: 500,
        fontFamily: fonts.display,
        padding: 0,
        marginBottom: 16,
    };

    /* ─── Render ─── */

    // ── View 1: Choose source ──
    if (view === 'choose') {
        return (
            <div style={overlay} onClick={resetAndClose}>
                <div style={modal} onClick={(e) => e.stopPropagation()}>
                    <div style={modalHeader}>
                        <span style={modalTitle}>
                            <span className="material-icons" style={{ fontSize: 20, color: colors.primary }}>attach_file</span>
                            Attach File
                        </span>
                        <button style={closeBtn} onClick={resetAndClose}>
                            <span className="material-icons" style={{ fontSize: 20 }}>close</span>
                        </button>
                    </div>

                    <div style={modalBody}>
                        <p style={{
                            fontSize: 13,
                            color: isDark ? colors.textMutedLight : colors.textMuted,
                            margin: '0 0 20px',
                            lineHeight: 1.5,
                        }}>
                            Choose how you'd like to attach a file to this conversation.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {/* Browse Library */}
                            <div
                                style={optCard()}
                                onClick={() => setView('library')}
                                onMouseEnter={(e) => {
                                    Object.assign(e.currentTarget.style, {
                                        borderColor: colors.primary,
                                        boxShadow: `0 0 0 1px ${colors.primary}`,
                                    });
                                }}
                                onMouseLeave={(e) => {
                                    Object.assign(e.currentTarget.style, {
                                        borderColor: isDark ? colors.borderDark : colors.borderLight,
                                        boxShadow: 'none',
                                    });
                                }}
                            >
                                <div style={optIconWrap(isDark ? '#1e3a5f' : '#dbeafe')}>
                                    <span className="material-icons" style={{ fontSize: 22, color: colors.primary }}>
                                        local_library
                                    </span>
                                </div>
                                <div>
                                    <div style={{
                                        fontSize: 14,
                                        fontWeight: 600,
                                        color: isDark ? colors.textLight : colors.textDark,
                                        marginBottom: 2,
                                    }}>
                                        Browse Library
                                    </div>
                                    <div style={{
                                        fontSize: 12,
                                        color: isDark ? colors.textMutedLight : colors.textMuted,
                                    }}>
                                        Select from your Personal, Team, or Global file libraries
                                    </div>
                                </div>
                                <span className="material-icons" style={{
                                    fontSize: 18,
                                    color: isDark ? colors.textMutedLight : colors.textMuted,
                                    marginLeft: 'auto',
                                }}>
                                    chevron_right
                                </span>
                            </div>

                            {/* Upload from Computer */}
                            <div
                                style={optCard()}
                                onClick={() => setView('upload')}
                                onMouseEnter={(e) => {
                                    Object.assign(e.currentTarget.style, {
                                        borderColor: colors.primary,
                                        boxShadow: `0 0 0 1px ${colors.primary}`,
                                    });
                                }}
                                onMouseLeave={(e) => {
                                    Object.assign(e.currentTarget.style, {
                                        borderColor: isDark ? colors.borderDark : colors.borderLight,
                                        boxShadow: 'none',
                                    });
                                }}
                            >
                                <div style={optIconWrap(isDark ? '#14532d' : '#dcfce7')}>
                                    <span className="material-icons" style={{ fontSize: 22, color: '#16a34a' }}>
                                        upload_file
                                    </span>
                                </div>
                                <div>
                                    <div style={{
                                        fontSize: 14,
                                        fontWeight: 600,
                                        color: isDark ? colors.textLight : colors.textDark,
                                        marginBottom: 2,
                                    }}>
                                        Upload from Computer
                                    </div>
                                    <div style={{
                                        fontSize: 12,
                                        color: isDark ? colors.textMutedLight : colors.textMuted,
                                    }}>
                                        Upload a new file from your device (max 25 MB)
                                    </div>
                                </div>
                                <span className="material-icons" style={{
                                    fontSize: 18,
                                    color: isDark ? colors.textMutedLight : colors.textMuted,
                                    marginLeft: 'auto',
                                }}>
                                    chevron_right
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── View 2: Browse Library ──
    if (view === 'library') {
        return (
            <div style={overlay} onClick={resetAndClose}>
                <div style={modal} onClick={(e) => e.stopPropagation()}>
                    <div style={modalHeader}>
                        <span style={modalTitle}>
                            <span className="material-icons" style={{ fontSize: 20, color: colors.primary }}>local_library</span>
                            Browse Library
                        </span>
                        <button style={closeBtn} onClick={resetAndClose}>
                            <span className="material-icons" style={{ fontSize: 20 }}>close</span>
                        </button>
                    </div>

                    <div style={modalBody}>
                        <button style={backBtn} onClick={() => { setView('choose'); setSelectedFile(null); }}>
                            <span className="material-icons" style={{ fontSize: 16 }}>arrow_back</span>
                            Back
                        </button>

                        {/* Scope selector */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                            <span className="material-icons" style={{
                                fontSize: 18,
                                color: isDark ? colors.textMutedLight : colors.textMuted,
                            }}>
                                {scopeIcons[libraryScope]}
                            </span>
                            <select
                                value={libraryScope}
                                onChange={(e) => { setLibraryScope(e.target.value as LibraryScope); setSelectedFile(null); }}
                                style={scopeSelect}
                            >
                                <option value="personal">Personal Library</option>
                                <option value="team">My Team</option>
                                <option value="global">Global Library</option>
                            </select>
                            <span style={{
                                fontSize: 11,
                                color: isDark ? colors.textMutedLight : colors.textMuted,
                                marginLeft: 'auto',
                                fontWeight: 500,
                            }}>
                                {libraryFiles.length} file{libraryFiles.length !== 1 ? 's' : ''}
                            </span>
                        </div>

                        {/* File list */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                            {libraryFiles.length === 0 ? (
                                <div style={emptyState}>
                                    <span className="material-icons" style={{ fontSize: 40, opacity: 0.3, display: 'block', marginBottom: 8 }}>
                                        folder_open
                                    </span>
                                    <div style={{ fontSize: 13, fontWeight: 500 }}>No files in {scopeLabels[libraryScope]}</div>
                                    <div style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>
                                        Upload files to populate this library
                                    </div>
                                </div>
                            ) : (
                                libraryFiles.map((f) => (
                                    <div
                                        key={f.id}
                                        style={fileRow(selectedFile?.id === f.id)}
                                        onClick={() => setSelectedFile(f)}
                                    >
                                        <span className="material-icons" style={{
                                            fontSize: 22,
                                            color: fileIconColor(f.type),
                                        }}>
                                            {fileIcon(f.type)}
                                        </span>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                fontSize: 13,
                                                fontWeight: 600,
                                                color: isDark ? colors.textLight : colors.textDark,
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                            }}>
                                                {f.name}
                                            </div>
                                            <div style={{
                                                fontSize: 11,
                                                color: isDark ? colors.textMutedLight : colors.textMuted,
                                                marginTop: 2,
                                            }}>
                                                {formatSize(f.size)} · {formatDate(f.uploadedAt)} · {f.uploadedBy}
                                            </div>
                                        </div>
                                        {selectedFile?.id === f.id && (
                                            <span className="material-icons" style={{ fontSize: 18, color: colors.primary }}>
                                                check_circle
                                            </span>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div style={modalFooter}>
                        <button style={secondaryBtn} onClick={() => { setView('choose'); setSelectedFile(null); }}>
                            Cancel
                        </button>
                        <button
                            style={{
                                ...primaryBtn,
                                opacity: selectedFile ? 1 : 0.5,
                                cursor: selectedFile ? 'pointer' : 'not-allowed',
                            }}
                            disabled={!selectedFile}
                            onClick={attachFromLibrary}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span className="material-icons" style={{ fontSize: 16 }}>attach_file</span>
                                Attach Selected
                            </span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── View 3: Upload from Computer ──
    return (
        <div style={overlay} onClick={resetAndClose}>
            <div style={modal} onClick={(e) => e.stopPropagation()}>
                <div style={modalHeader}>
                    <span style={modalTitle}>
                        <span className="material-icons" style={{ fontSize: 20, color: '#16a34a' }}>upload_file</span>
                        Upload File
                    </span>
                    <button style={closeBtn} onClick={resetAndClose}>
                        <span className="material-icons" style={{ fontSize: 20 }}>close</span>
                    </button>
                </div>

                <div style={modalBody}>
                    <button style={backBtn} onClick={() => { setView('choose'); setUploadFile(null); setSizeError(''); }}>
                        <span className="material-icons" style={{ fontSize: 16 }}>arrow_back</span>
                        Back
                    </button>

                    {/* Drop zone */}
                    <div
                        style={dropZone}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            style={{ display: 'none' }}
                            onChange={handleFileInputChange}
                        />
                        {!uploadFile ? (
                            <>
                                <span className="material-icons" style={{
                                    fontSize: 40,
                                    color: dragOver ? colors.primary : isDark ? '#4b5563' : '#9ca3af',
                                    display: 'block',
                                    marginBottom: 8,
                                }}>
                                    cloud_upload
                                </span>
                                <div style={{
                                    fontSize: 14,
                                    fontWeight: 600,
                                    color: isDark ? colors.textLight : colors.textDark,
                                    marginBottom: 4,
                                }}>
                                    Drop file here or click to browse
                                </div>
                                <div style={{
                                    fontSize: 12,
                                    color: isDark ? colors.textMutedLight : colors.textMuted,
                                }}>
                                    Maximum file size: 25 MB
                                </div>
                            </>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
                                <span className="material-icons" style={{
                                    fontSize: 28,
                                    color: fileIconColor(uploadFile.type),
                                }}>
                                    {fileIcon(uploadFile.type)}
                                </span>
                                <div style={{ textAlign: 'left' }}>
                                    <div style={{
                                        fontSize: 13,
                                        fontWeight: 600,
                                        color: isDark ? colors.textLight : colors.textDark,
                                    }}>
                                        {uploadFile.name}
                                    </div>
                                    <div style={{
                                        fontSize: 11,
                                        color: isDark ? colors.textMutedLight : colors.textMuted,
                                        marginTop: 2,
                                    }}>
                                        {formatSize(uploadFile.size)}
                                    </div>
                                </div>
                                <button
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        color: '#ef4444',
                                        padding: 4,
                                        borderRadius: 4,
                                        display: 'flex',
                                    }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setUploadFile(null);
                                    }}
                                >
                                    <span className="material-icons" style={{ fontSize: 18 }}>close</span>
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Size error */}
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

                    {/* Save to library toggle */}
                    <div style={{
                        marginTop: 20,
                        padding: '16px 18px',
                        borderRadius: 10,
                        backgroundColor: isDark ? '#111827' : '#f9fafb',
                        border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                    }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                        }}>
                            <div>
                                <div style={{
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: isDark ? colors.textLight : colors.textDark,
                                }}>
                                    Also save to library
                                </div>
                                <div style={{
                                    fontSize: 11,
                                    color: isDark ? colors.textMutedLight : colors.textMuted,
                                    marginTop: 2,
                                }}>
                                    Make this file available for future workflows
                                </div>
                            </div>
                            <div
                                style={toggleTrack(saveToLibrary)}
                                onClick={() => setSaveToLibrary(!saveToLibrary)}
                            >
                                <div style={toggleThumb(saveToLibrary)} />
                            </div>
                        </div>

                        {/* Library scope selector (visible when toggle is on) */}
                        {saveToLibrary && (
                            <div style={{
                                marginTop: 14,
                                paddingTop: 14,
                                borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                            }}>
                                <span style={{
                                    fontSize: 12,
                                    fontWeight: 500,
                                    color: isDark ? colors.textMutedLight : colors.textMuted,
                                }}>
                                    Save to:
                                </span>
                                <select
                                    value={uploadScope}
                                    onChange={(e) => setUploadScope(e.target.value as LibraryScope)}
                                    style={scopeSelect}
                                >
                                    <option value="personal">Personal Library</option>
                                    <option value="team">My Team</option>
                                    <option value="global">Global Library</option>
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                <div style={modalFooter}>
                    <button style={secondaryBtn} onClick={() => { setView('choose'); setUploadFile(null); setSizeError(''); }}>
                        Cancel
                    </button>
                    <button
                        style={{
                            ...primaryBtn,
                            opacity: uploadFile ? 1 : 0.5,
                            cursor: uploadFile ? 'pointer' : 'not-allowed',
                        }}
                        disabled={!uploadFile}
                        onClick={attachFromUpload}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="material-icons" style={{ fontSize: 16 }}>attach_file</span>
                            Attach File
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
}
