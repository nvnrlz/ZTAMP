import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

/* ─── Types ─── */
export type AuditDomain = 'workflow' | 'policy' | 'system' | 'user';
export type AuditAction =
    | 'created' | 'updated' | 'deleted' | 'archived'
    | 'shared' | 'executed' | 'scheduled'
    | 'assigned' | 'unassigned' | 'enabled' | 'disabled'
    | 'downloaded' | 'viewed_code' | 'duplicated';

export interface PlatformAuditEntry {
    id: string;
    domain: AuditDomain;
    action: AuditAction;
    resourceName: string;          // workflow name, policy name, etc.
    resourceId?: string;
    actor: string;
    actorRole?: string;
    details: string;
    metadata?: Record<string, string>; // extra k/v pairs like "sharedWith", "accessLevel"
    timestamp: string;
}

/* ─── Label & icon maps ─── */
export const domainLabels: Record<AuditDomain, string> = {
    workflow: 'Workflow',
    policy: 'Policy',
    system: 'System',
    user: 'User',
};

export const domainIcons: Record<AuditDomain, string> = {
    workflow: 'account_tree',
    policy: 'policy',
    system: 'settings',
    user: 'person',
};

export const domainColors: Record<AuditDomain, string> = {
    workflow: '#3b82f6',
    policy: '#8b5cf6',
    system: '#6b7280',
    user: '#10b981',
};

export const actionLabels: Record<AuditAction, string> = {
    created: 'Created',
    updated: 'Updated',
    deleted: 'Deleted',
    archived: 'Archived',
    shared: 'Shared',
    executed: 'Executed',
    scheduled: 'Scheduled',
    assigned: 'Assigned',
    unassigned: 'Unassigned',
    enabled: 'Enabled',
    disabled: 'Disabled',
    downloaded: 'Downloaded',
    viewed_code: 'Viewed Code',
    duplicated: 'Duplicated',
};

export const actionColors: Record<AuditAction, { bg: string; bgDark: string; text: string; textDark: string }> = {
    created: { bg: '#dcfce7', bgDark: '#14532d', text: '#16a34a', textDark: '#86efac' },
    updated: { bg: '#dbeafe', bgDark: '#1e3a5f', text: '#2563eb', textDark: '#93c5fd' },
    deleted: { bg: '#fee2e2', bgDark: '#7f1d1d', text: '#dc2626', textDark: '#fca5a5' },
    archived: { bg: '#f3f4f6', bgDark: '#374151', text: '#6b7280', textDark: '#9ca3af' },
    shared: { bg: '#ede9fe', bgDark: '#3b1f7e', text: '#7c3aed', textDark: '#c4b5fd' },
    executed: { bg: '#d1fae5', bgDark: '#064e3b', text: '#059669', textDark: '#6ee7b7' },
    scheduled: { bg: '#fef3c7', bgDark: '#78350f', text: '#d97706', textDark: '#fcd34d' },
    assigned: { bg: '#ede9fe', bgDark: '#3b1f7e', text: '#7c3aed', textDark: '#c4b5fd' },
    unassigned: { bg: '#fce7f3', bgDark: '#831843', text: '#db2777', textDark: '#f9a8d4' },
    enabled: { bg: '#dcfce7', bgDark: '#14532d', text: '#16a34a', textDark: '#86efac' },
    disabled: { bg: '#f3f4f6', bgDark: '#374151', text: '#6b7280', textDark: '#9ca3af' },
    downloaded: { bg: '#e0e7ff', bgDark: '#312e81', text: '#4f46e5', textDark: '#a5b4fc' },
    viewed_code: { bg: '#e0e7ff', bgDark: '#312e81', text: '#4f46e5', textDark: '#a5b4fc' },
    duplicated: { bg: '#cffafe', bgDark: '#164e63', text: '#0891b2', textDark: '#67e8f9' },
};

/* ─── Seed Data ─── */
const seedAuditEntries: PlatformAuditEntry[] = [
    // Policy events (migrated from PolicyContext)
    { id: 'aud-1', domain: 'policy', action: 'created', resourceName: 'Role-Based Access Control', actor: 'Admin', actorRole: 'admin', details: 'Created initial RBAC policy with 4 role definitions', timestamp: '2026-01-05T10:00:00Z' },
    { id: 'aud-2', domain: 'policy', action: 'assigned', resourceName: 'Role-Based Access Control', actor: 'Admin', actorRole: 'admin', details: 'Assigned to group "All Users"', timestamp: '2026-01-10T08:00:00Z' },
    { id: 'aud-3', domain: 'policy', action: 'created', resourceName: 'Agent Execution Sandbox', actor: 'Admin', actorRole: 'admin', details: 'Created sandbox enforcement policy for agents', timestamp: '2026-01-10T09:00:00Z' },
    { id: 'aud-4', domain: 'policy', action: 'created', resourceName: 'Data Classification Enforcement', actor: 'Compliance Team', actorRole: 'compliance', details: 'Initial data classification policy for document handling', timestamp: '2026-01-12T10:00:00Z' },
    { id: 'aud-5', domain: 'policy', action: 'assigned', resourceName: 'Agent Execution Sandbox', actor: 'Admin', actorRole: 'admin', details: 'Assigned to Planner Agent and Code Agent', timestamp: '2026-01-15T10:00:00Z' },
    { id: 'aud-6', domain: 'policy', action: 'created', resourceName: 'Workflow Approval Chain', actor: 'Admin', actorRole: 'admin', details: 'Created multi-tier approval chain for production workflows', timestamp: '2026-01-15T08:00:00Z' },
    { id: 'aud-7', domain: 'policy', action: 'assigned', resourceName: 'Data Classification Enforcement', actor: 'Compliance Team', actorRole: 'compliance', details: 'Assigned to Engineering and Data Science teams', timestamp: '2026-01-18T14:00:00Z' },
    { id: 'aud-8', domain: 'policy', action: 'updated', resourceName: 'Agent Execution Sandbox', actor: 'Admin', actorRole: 'admin', details: 'Updated memory limit from 2Gi to 4Gi, bumped to v3', timestamp: '2026-02-05T14:30:00Z' },
    { id: 'aud-9', domain: 'policy', action: 'disabled', resourceName: 'Team Resource Quotas', actor: 'Platform Team', actorRole: 'platform', details: 'Temporarily disabled while reviewing tier limits', timestamp: '2026-02-01T09:00:00Z' },
    { id: 'aud-10', domain: 'policy', action: 'updated', resourceName: 'Role-Based Access Control', actor: 'Admin', actorRole: 'admin', details: 'Added execute_workflow permission to Developer role, v5', timestamp: '2026-02-12T15:00:00Z' },
    { id: 'aud-11', domain: 'policy', action: 'updated', resourceName: 'Workflow Approval Chain', actor: 'Admin', actorRole: 'admin', details: 'Changed high-risk approval count from 3 to 2, v4', timestamp: '2026-02-10T16:00:00Z' },

    // Workflow events
    { id: 'aud-w1', domain: 'workflow', action: 'created', resourceName: 'Customer Onboarding Pipeline', actor: 'John D.', actorRole: 'developer', details: 'Created new onboarding workflow with 8 nodes', timestamp: '2026-01-08T09:30:00Z' },
    { id: 'aud-w2', domain: 'workflow', action: 'shared', resourceName: 'Customer Onboarding Pipeline', actor: 'John D.', actorRole: 'developer', details: 'Shared with Sarah M. as Editor', metadata: { sharedWith: 'Sarah M.', accessLevel: 'editor' }, timestamp: '2026-01-09T11:00:00Z' },
    { id: 'aud-w3', domain: 'workflow', action: 'executed', resourceName: 'Data Processing Pipeline', actor: 'Admin', actorRole: 'admin', details: 'Manual execution triggered — completed in 4.2s', metadata: { duration: '4.2s', status: 'success' }, timestamp: '2026-01-20T14:15:00Z' },
    { id: 'aud-w4', domain: 'workflow', action: 'scheduled', resourceName: 'Weekly Report Generator', actor: 'Sarah M.', actorRole: 'analyst', details: 'Scheduled for every Monday at 08:00 UTC', metadata: { cron: '0 8 * * 1', timezone: 'UTC' }, timestamp: '2026-01-22T16:00:00Z' },
    { id: 'aud-w5', domain: 'workflow', action: 'downloaded', resourceName: 'Customer Onboarding Pipeline', actor: 'Mike T.', actorRole: 'viewer', details: 'Downloaded workflow JSON for review', timestamp: '2026-01-25T10:30:00Z' },
    { id: 'aud-w6', domain: 'workflow', action: 'archived', resourceName: 'Legacy Import Scripts', actor: 'Admin', actorRole: 'admin', details: 'Archived deprecated import workflow', timestamp: '2026-02-01T13:00:00Z' },
    { id: 'aud-w7', domain: 'workflow', action: 'updated', resourceName: 'Data Processing Pipeline', actor: 'John D.', actorRole: 'developer', details: 'Added retry logic on API nodes, bumped to v3', timestamp: '2026-02-03T09:45:00Z' },
    { id: 'aud-w8', domain: 'workflow', action: 'executed', resourceName: 'Customer Onboarding Pipeline', actor: 'Sarah M.', actorRole: 'developer', details: 'Executed with test data — 6 of 8 nodes passed', metadata: { duration: '12.1s', status: 'partial' }, timestamp: '2026-02-08T11:20:00Z' },
    { id: 'aud-w9', domain: 'workflow', action: 'shared', resourceName: 'Weekly Report Generator', actor: 'Sarah M.', actorRole: 'analyst', details: 'Shared with Compliance Team for audit (view-only)', metadata: { sharedWith: 'Compliance Team', accessLevel: 'viewer' }, timestamp: '2026-02-10T09:00:00Z' },
    { id: 'aud-w10', domain: 'workflow', action: 'deleted', resourceName: 'Test Workflow Alpha', actor: 'John D.', actorRole: 'developer', details: 'Deleted test workflow — no longer needed', timestamp: '2026-02-14T15:00:00Z' },

    // System events
    { id: 'aud-s1', domain: 'system', action: 'updated', resourceName: 'Platform Configuration', actor: 'Admin', actorRole: 'admin', details: 'Updated maximum concurrent agent count to 10', timestamp: '2026-01-12T08:00:00Z' },
    { id: 'aud-s2', domain: 'system', action: 'enabled', resourceName: 'OPA Policy Engine', actor: 'Admin', actorRole: 'admin', details: 'Enabled OPA runtime policy evaluation', timestamp: '2026-01-15T07:00:00Z' },

    // User events
    { id: 'aud-u1', domain: 'user', action: 'created', resourceName: 'New User: Sarah M.', actor: 'Admin', actorRole: 'admin', details: 'Created user account with Analyst role', timestamp: '2026-01-06T10:00:00Z' },
    { id: 'aud-u2', domain: 'user', action: 'updated', resourceName: 'Mike T.', actor: 'Admin', actorRole: 'admin', details: 'Role changed from Viewer to Developer', timestamp: '2026-02-05T11:00:00Z' },
];

/* ─── Context ─── */
export interface AuditContextValue {
    entries: PlatformAuditEntry[];
    addEntry: (entry: Omit<PlatformAuditEntry, 'id' | 'timestamp'>) => PlatformAuditEntry;
    getEntriesByDomain: (domain: AuditDomain) => PlatformAuditEntry[];
    getEntriesByResource: (resourceName: string) => PlatformAuditEntry[];
}

const AuditContext = createContext<AuditContextValue | null>(null);

export function useAudit() {
    const ctx = useContext(AuditContext);
    if (!ctx) throw new Error('useAudit must be inside AuditProvider');
    return ctx;
}

export function AuditProvider({ children }: { children: ReactNode }) {
    const [entries, setEntries] = useState<PlatformAuditEntry[]>(seedAuditEntries);

    const addEntry = useCallback((entry: Omit<PlatformAuditEntry, 'id' | 'timestamp'>): PlatformAuditEntry => {
        const newEntry: PlatformAuditEntry = {
            ...entry,
            id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString(),
        };
        setEntries((prev) => [newEntry, ...prev]);
        return newEntry;
    }, []);

    const getEntriesByDomain = useCallback(
        (domain: AuditDomain) => entries.filter((e) => e.domain === domain),
        [entries],
    );

    const getEntriesByResource = useCallback(
        (resourceName: string) => entries.filter((e) => e.resourceName === resourceName),
        [entries],
    );

    return (
        <AuditContext.Provider value={{ entries, addEntry, getEntriesByDomain, getEntriesByResource }}>
            {children}
        </AuditContext.Provider>
    );
}
