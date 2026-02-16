import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

/* ─── Types ─── */
export type LibraryScope = 'personal' | 'team' | 'global';

export interface LibraryFile {
    id: string;
    name: string;
    size: number;            // bytes
    type: string;            // mime type
    uploadedAt: string;      // ISO date
    scope: LibraryScope;
    uploadedBy: string;      // user display name
}

export interface FileLibraryContextValue {
    /** All files across all libraries */
    files: LibraryFile[];
    /** Get files filtered by scope */
    getFilesByScope: (scope: LibraryScope) => LibraryFile[];
    /** Add a file to a library scope */
    addFile: (file: Omit<LibraryFile, 'id' | 'uploadedAt'>) => LibraryFile;
    /** Remove a file from a library */
    removeFile: (id: string) => void;
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
export { MAX_FILE_SIZE };

const FileLibraryContext = createContext<FileLibraryContextValue | null>(null);

export function useFileLibrary() {
    const ctx = useContext(FileLibraryContext);
    if (!ctx) throw new Error('useFileLibrary must be used within FileLibraryProvider');
    return ctx;
}

/* ─── Sample seed data so the library isn't empty on first visit ─── */
const seedFiles: LibraryFile[] = [
    {
        id: 'seed-1',
        name: 'Q4_Sales_Report.xlsx',
        size: 1_240_000,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        uploadedAt: '2026-01-15T09:30:00Z',
        scope: 'personal',
        uploadedBy: 'You',
    },
    {
        id: 'seed-2',
        name: 'Employee_Directory.csv',
        size: 520_000,
        type: 'text/csv',
        uploadedAt: '2026-01-20T14:12:00Z',
        scope: 'team',
        uploadedBy: 'Sarah K.',
    },
    {
        id: 'seed-3',
        name: 'Company_Policy_2026.pdf',
        size: 3_800_000,
        type: 'application/pdf',
        uploadedAt: '2026-02-01T08:00:00Z',
        scope: 'global',
        uploadedBy: 'Admin',
    },
    {
        id: 'seed-4',
        name: 'API_Documentation.md',
        size: 86_000,
        type: 'text/markdown',
        uploadedAt: '2026-02-10T16:45:00Z',
        scope: 'team',
        uploadedBy: 'Dev Team',
    },
];

export function FileLibraryProvider({ children }: { children: ReactNode }) {
    const [files, setFiles] = useState<LibraryFile[]>(seedFiles);

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
        <FileLibraryContext.Provider value={{ files, getFilesByScope, addFile, removeFile }}>
            {children}
        </FileLibraryContext.Provider>
    );
}
