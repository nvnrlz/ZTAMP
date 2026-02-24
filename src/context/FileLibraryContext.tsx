import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

/* ─── Types ─── */
export type LibraryScope = 'personal' | 'team' | 'global';

export interface LibraryFile {
    id: string;
    name: string;
    relativePath?: string;   // e.g. "docs/aws/ec2.pdf" — present for files in subdirs
    size: number;            // bytes
    type: string;            // mime type
    uploadedAt: string;      // ISO date
    scope: LibraryScope;
    uploadedBy: string;      // user display name
    status?: 'uploading' | 'uploaded' | 'vectorizing' | 'vectorized' | 'error';
}

export interface FileLibraryContextValue {
    /** All files across all libraries */
    files: LibraryFile[];
    /** Loading state */
    loading: boolean;
    /** Get files filtered by scope */
    getFilesByScope: (scope: LibraryScope) => LibraryFile[];
    /** Add a file to a library scope */
    addFile: (file: Omit<LibraryFile, 'id' | 'uploadedAt'>) => LibraryFile;
    /** Remove a file from a library */
    removeFile: (id: string) => void;
    /** Refresh files from backend */
    refreshFiles: () => Promise<void>;
}

const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1 GB
export { MAX_FILE_SIZE };

const FileLibraryContext = createContext<FileLibraryContextValue | null>(null);

export function useFileLibrary() {
    const ctx = useContext(FileLibraryContext);
    if (!ctx) throw new Error('useFileLibrary must be used within FileLibraryProvider');
    return ctx;
}

/* ─── Mime type inference from filename ─── */
function inferMimeType(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
        pdf: 'application/pdf',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        csv: 'text/csv',
        md: 'text/markdown',
        txt: 'text/plain',
        json: 'application/json',
    };
    return map[ext] || 'application/octet-stream';
}

/* ─── Scope label for "uploadedBy" fallback ─── */
const scopeUploader: Record<LibraryScope, string> = {
    personal: 'You',
    team: 'Team',
    global: 'Admin',
};

/* ─── Provider ─── */

export function FileLibraryProvider({ children }: { children: ReactNode }) {
    const [files, setFiles] = useState<LibraryFile[]>([]);
    const [loading, setLoading] = useState(true);

    /* Fetch real files from the backend */
    const refreshFiles = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('http://localhost:4000/api/files');
            const data: {
                files: Array<{
                    name: string;
                    relativePath?: string;
                    size: number;
                    uploadedAt: string;
                    status: string;
                    scope: string;
                }>;
            } = await res.json();

            const loaded: LibraryFile[] = data.files.map((f, i) => ({
                id: `backend-${f.scope}-${f.relativePath || f.name}-${i}`,
                name: f.name,
                relativePath: f.relativePath && f.relativePath.includes('/') ? f.relativePath : undefined,
                size: f.size,
                type: inferMimeType(f.name),
                uploadedAt: f.uploadedAt,
                scope: (f.scope as LibraryScope) || 'personal',
                uploadedBy: scopeUploader[(f.scope as LibraryScope) || 'personal'],
                status: (f.status as LibraryFile['status']) || 'uploaded',
            }));
            setFiles(loaded);
        } catch {
            // Server may not be running; leave files empty
            setFiles([]);
        } finally {
            setLoading(false);
        }
    }, []);

    /* Load on mount */
    useEffect(() => {
        refreshFiles();
    }, [refreshFiles]);

    const getFilesByScope = useCallback(
        (scope: LibraryScope): LibraryFile[] => files.filter((f) => f.scope === scope),
        [files],
    );

    const addFile = useCallback(
        (file: Omit<LibraryFile, 'id' | 'uploadedAt'>): LibraryFile => {
            const newFile: LibraryFile = {
                ...file,
                id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                uploadedAt: new Date().toISOString(),
            };
            setFiles((prev) => [newFile, ...prev]);
            return newFile;
        },
        [],
    );

    const removeFile = useCallback((id: string) => {
        setFiles((prev) => prev.filter((f) => f.id !== id));
    }, []);

    return (
        <FileLibraryContext.Provider value={{ files, loading, getFilesByScope, addFile, removeFile, refreshFiles }}>
            {children}
        </FileLibraryContext.Provider>
    );
}
