import { useState, useMemo, type CSSProperties } from 'react';
import { colors, shadows, fonts } from '../../theme';
import GroupManagement from './GroupManagement';

type SubTab = 'users' | 'groups';

/* ─── Types ─── */
export type UserRole = 'admin' | 'operator' | 'viewer' | 'auditor';
export type UserStatus = 'active' | 'suspended' | 'pending' | 'deactivated';

export interface PlatformUser {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    status: UserStatus;
    team: string;
    lastLogin: string | null;
    createdAt: string;
    mfaEnabled: boolean;
    sessionsToday: number;
    totalQueries: number;
    apiKeyCount: number;
    quotaUsedPct: number; // 0-100
    avatarInitials: string;
}

/* ─── Role / Status metadata ─── */
const roleConfig: Record<UserRole, { label: string; color: string; icon: string; permissions: string[] }> = {
    admin: { label: 'Admin', color: '#ef4444', icon: 'shield', permissions: ['Full access', 'User management', 'System config', 'Danger zone', 'Audit log'] },
    operator: { label: 'Operator', color: '#3b82f6', icon: 'engineering', permissions: ['Create workflows', 'Upload documents', 'RAG search', 'Manage own files'] },
    viewer: { label: 'Viewer', color: '#10b981', icon: 'visibility', permissions: ['View workflows', 'RAG search (read-only)', 'View audit log'] },
    auditor: { label: 'Auditor', color: '#8b5cf6', icon: 'verified_user', permissions: ['Full audit log', 'View all sessions', 'Export reports', 'Compliance dashboard'] },
};

const statusConfig: Record<UserStatus, { label: string; color: string; icon: string }> = {
    active: { label: 'Active', color: '#22c55e', icon: 'check_circle' },
    suspended: { label: 'Suspended', color: '#f59e0b', icon: 'pause_circle' },
    pending: { label: 'Pending', color: '#6366f1', icon: 'hourglass_top' },
    deactivated: { label: 'Deactivated', color: '#6b7280', icon: 'cancel' },
};

/* ─── Mock data ─── */
const MOCK_USERS: PlatformUser[] = [
    { id: 'u1', name: 'Jane Doe', email: 'jane.doe@company.io', role: 'admin', status: 'active', team: 'Platform Engineering', lastLogin: '2026-02-23T10:30:00Z', createdAt: '2025-06-01T09:00:00Z', mfaEnabled: true, sessionsToday: 3, totalQueries: 1240, apiKeyCount: 2, quotaUsedPct: 62, avatarInitials: 'JD' },
    { id: 'u2', name: 'Alex Rivera', email: 'alex.r@company.io', role: 'operator', status: 'active', team: 'Cloud Infrastructure', lastLogin: '2026-02-23T09:15:00Z', createdAt: '2025-08-15T14:00:00Z', mfaEnabled: true, sessionsToday: 5, totalQueries: 890, apiKeyCount: 1, quotaUsedPct: 45, avatarInitials: 'AR' },
    { id: 'u3', name: 'Sam Chen', email: 'sam.chen@company.io', role: 'operator', status: 'active', team: 'Cloud Infrastructure', lastLogin: '2026-02-22T17:45:00Z', createdAt: '2025-09-20T11:00:00Z', mfaEnabled: false, sessionsToday: 0, totalQueries: 567, apiKeyCount: 0, quotaUsedPct: 28, avatarInitials: 'SC' },
    { id: 'u4', name: 'Morgan Blake', email: 'morgan.b@company.io', role: 'viewer', status: 'active', team: 'Security & Compliance', lastLogin: '2026-02-23T08:00:00Z', createdAt: '2025-11-01T10:00:00Z', mfaEnabled: true, sessionsToday: 1, totalQueries: 210, apiKeyCount: 0, quotaUsedPct: 12, avatarInitials: 'MB' },
    { id: 'u5', name: 'Taylor Kim', email: 'taylor.k@company.io', role: 'auditor', status: 'active', team: 'Security & Compliance', lastLogin: '2026-02-22T16:30:00Z', createdAt: '2025-10-10T08:00:00Z', mfaEnabled: true, sessionsToday: 2, totalQueries: 430, apiKeyCount: 1, quotaUsedPct: 35, avatarInitials: 'TK' },
    { id: 'u6', name: 'Jordan Patel', email: 'jordan.p@company.io', role: 'operator', status: 'suspended', team: 'DevOps', lastLogin: '2026-02-10T12:00:00Z', createdAt: '2025-07-22T15:00:00Z', mfaEnabled: false, sessionsToday: 0, totalQueries: 320, apiKeyCount: 0, quotaUsedPct: 0, avatarInitials: 'JP' },
    { id: 'u7', name: 'Casey Nguyen', email: 'casey.n@company.io', role: 'viewer', status: 'pending', team: 'Product', lastLogin: null, createdAt: '2026-02-20T09:00:00Z', mfaEnabled: false, sessionsToday: 0, totalQueries: 0, apiKeyCount: 0, quotaUsedPct: 0, avatarInitials: 'CN' },
    { id: 'u8', name: 'Riley Foster', email: 'riley.f@company.io', role: 'operator', status: 'deactivated', team: 'Cloud Infrastructure', lastLogin: '2026-01-05T11:00:00Z', createdAt: '2025-05-10T13:00:00Z', mfaEnabled: true, sessionsToday: 0, totalQueries: 1500, apiKeyCount: 0, quotaUsedPct: 0, avatarInitials: 'RF' },
];

const TEAMS = ['All Teams', 'Platform Engineering', 'Cloud Infrastructure', 'Security & Compliance', 'DevOps', 'Product'];

/* ─── Helpers ─── */
function formatDate(iso: string | null): string {
    if (!iso) return 'Never';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function timeAgo(iso: string | null): string {
    if (!iso) return 'Never';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

/* ─── Styles ─── */
const badge = (isDark: boolean, color: string): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
    backgroundColor: isDark ? `${color}18` : `${color}12`,
    color: color, whiteSpace: 'nowrap',
});

const userRow = (isDark: boolean, even: boolean): CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: '2fr 120px 100px 1.2fr 100px 100px 60px',
    alignItems: 'center', padding: '12px 20px', gap: 12,
    borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: even ? isDark ? 'rgba(17,24,39,0.3)' : 'rgba(249,250,251,0.5)' : 'transparent',
    fontSize: 13, transition: 'background-color 0.1s', cursor: 'pointer',
});

const modalOverlay: CSSProperties = {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
    animation: 'fadeIn 0.2s',
};

const modalBox = (isDark: boolean): CSSProperties => ({
    backgroundColor: isDark ? '#1e293b' : '#ffffff',
    borderRadius: 16, border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    boxShadow: shadows.overlay, width: 520, maxHeight: '85vh', overflowY: 'auto',
    animation: 'fadeIn 0.25s',
});

const drawerBox = (isDark: boolean): CSSProperties => ({
    position: 'fixed', top: 0, right: 0, bottom: 0, width: 440,
    backgroundColor: isDark ? '#111827' : '#ffffff',
    borderLeft: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    boxShadow: shadows.overlay, zIndex: 200, overflowY: 'auto',
    animation: 'slideIn 0.3s cubic-bezier(0.16,1,0.3,1)',
});

const inputStyle = (isDark: boolean): CSSProperties => ({
    width: '100%', padding: '10px 14px', borderRadius: 8,
    border: `1.5px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: isDark ? '#111827' : '#ffffff',
    color: isDark ? '#e5e7eb' : '#1f2937', fontSize: 13,
    fontFamily: fonts.display, outline: 'none', transition: 'border-color 0.15s',
});

const selectStyle = (isDark: boolean): CSSProperties => ({
    ...inputStyle(isDark), cursor: 'pointer', appearance: 'none' as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24'%3E%3Cpath fill='${isDark ? '%239ca3af' : '%236b7280'}' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
    paddingRight: 32,
});

const primaryBtn = (_isDark: boolean): CSSProperties => ({
    padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    fontFamily: fonts.display, cursor: 'pointer', border: 'none',
    backgroundColor: colors.primary, color: '#fff', boxShadow: shadows.blueMd,
    display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
});

const ghostBtn = (isDark: boolean): CSSProperties => ({
    padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    fontFamily: fonts.display, cursor: 'pointer',
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: 'transparent', color: isDark ? '#d1d5db' : '#374151',
    display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
});

const quotaBar = (isDark: boolean, _pct: number): CSSProperties => ({
    width: '100%', height: 6, borderRadius: 3,
    backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    position: 'relative' as const, overflow: 'hidden',
});

const quotaFill = (pct: number): CSSProperties => ({
    position: 'absolute' as const, left: 0, top: 0, bottom: 0,
    width: `${Math.min(pct, 100)}%`, borderRadius: 3,
    backgroundColor: pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#22c55e',
    transition: 'width 0.4s ease',
});

const contentContainer: CSSProperties = {
    maxWidth: 960, margin: '0 auto',
    display: 'flex', flexDirection: 'column', gap: 24,
};

const card = (isDark: boolean): CSSProperties => ({
    backgroundColor: isDark ? colors.surfaceDark : '#ffffff',
    borderRadius: 16, border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    boxShadow: shadows.sm, overflow: 'hidden',
});

const cardHeader = (isDark: boolean): CSSProperties => ({
    padding: '16px 24px',
    borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: isDark ? 'rgba(17,24,39,0.5)' : 'rgba(249,250,251,0.8)',
});

const cardTitle: CSSProperties = {
    fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em',
    display: 'flex', alignItems: 'center', gap: 8,
};

/* ─── Component ─── */
interface Props { isDark: boolean }

export default function UserManagement({ isDark }: Props) {
    const [subTab, setSubTab] = useState<SubTab>('users');
    const [users, setUsers] = useState<PlatformUser[]>(MOCK_USERS);
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
    const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all');
    const [teamFilter, setTeamFilter] = useState('All Teams');
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [selectedUser, setSelectedUser] = useState<PlatformUser | null>(null);

    // Invite form state
    const [inviteName, setInviteName] = useState('');
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<UserRole>('viewer');
    const [inviteTeam, setInviteTeam] = useState('Product');

    const filtered = useMemo(() => {
        return users.filter(u => {
            if (roleFilter !== 'all' && u.role !== roleFilter) return false;
            if (statusFilter !== 'all' && u.status !== statusFilter) return false;
            if (teamFilter !== 'All Teams' && u.team !== teamFilter) return false;
            if (search) {
                const q = search.toLowerCase();
                return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.team.toLowerCase().includes(q);
            }
            return true;
        });
    }, [users, search, roleFilter, statusFilter, teamFilter]);

    const stats = useMemo(() => ({
        total: users.length,
        active: users.filter(u => u.status === 'active').length,
        mfaEnabled: users.filter(u => u.mfaEnabled).length,
        pending: users.filter(u => u.status === 'pending').length,
    }), [users]);

    const handleInvite = () => {
        if (!inviteName.trim() || !inviteEmail.trim()) return;
        const newUser: PlatformUser = {
            id: `u${Date.now()}`, name: inviteName.trim(), email: inviteEmail.trim(),
            role: inviteRole, status: 'pending', team: inviteTeam,
            lastLogin: null, createdAt: new Date().toISOString(),
            mfaEnabled: false, sessionsToday: 0, totalQueries: 0,
            apiKeyCount: 0, quotaUsedPct: 0,
            avatarInitials: inviteName.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
        };
        setUsers(prev => [newUser, ...prev]);
        setInviteName(''); setInviteEmail(''); setInviteRole('viewer'); setInviteTeam('Product');
        setShowInviteModal(false);
    };

    const toggleStatus = (userId: string, newStatus: UserStatus) => {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, status: newStatus } : u));
        if (selectedUser?.id === userId) setSelectedUser(prev => prev ? { ...prev, status: newStatus } : null);
    };

    const changeRole = (userId: string, newRole: UserRole) => {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
        if (selectedUser?.id === userId) setSelectedUser(prev => prev ? { ...prev, role: newRole } : null);
    };

    /* ─── Stat Card ─── */
    const StatCard = ({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) => (
        <div style={{
            flex: 1, backgroundColor: isDark ? colors.surfaceDark : '#ffffff',
            borderRadius: 14, border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
            boxShadow: shadows.sm, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14,
        }}>
            <div style={{
                width: 42, height: 42, borderRadius: 11,
                backgroundColor: isDark ? `${color}15` : `${color}10`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                <span className="material-icons-outlined" style={{ fontSize: 20, color }}>{icon}</span>
            </div>
            <div>
                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{value}</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
            </div>
        </div>
    );

    /* ─── Render ─── */
    return (
        <div style={contentContainer}>
            {/* Sub-tab toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12, backgroundColor: isDark ? '#111827' : '#f3f4f6' }}>
                    {([{ key: 'users' as SubTab, label: 'Users', icon: 'person' }, { key: 'groups' as SubTab, label: 'Groups', icon: 'workspaces' }]).map(t => (
                        <button key={t.key} onClick={() => setSubTab(t.key)} style={{
                            padding: '8px 20px', borderRadius: 10, fontSize: 13, fontWeight: subTab === t.key ? 600 : 500,
                            border: 'none', cursor: 'pointer', fontFamily: fonts.display,
                            backgroundColor: subTab === t.key ? colors.primary : 'transparent',
                            color: subTab === t.key ? '#fff' : isDark ? '#9ca3af' : '#6b7280',
                            display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
                        }}>
                            <span className="material-icons" style={{ fontSize: 16 }}>{t.icon}</span>
                            {t.label}
                        </button>
                    ))}
                </div>
                {subTab === 'users' && (
                    <button style={primaryBtn(isDark)} onClick={() => setShowInviteModal(true)}
                        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#2563eb'; }}
                        onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.primary; }}
                    >
                        <span className="material-icons" style={{ fontSize: 16 }}>person_add</span>
                        Invite User
                    </button>
                )}
            </div>

            {/* ─── Groups Tab ─── */}
            {subTab === 'groups' && <GroupManagement isDark={isDark} />}

            {/* ─── Users Tab ─── */}
            {subTab === 'users' && <>
                {/* Header */}
                <div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="material-icons" style={{ color: '#f59e0b', fontSize: 24 }}>group</span>
                        User Management
                    </h2>
                    <p style={{ fontSize: 14, color: isDark ? '#9ca3af' : '#6b7280', marginTop: 4 }}>
                        Manage user accounts, roles, permissions, and access controls
                    </p>
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', gap: 16 }}>
                    <StatCard icon="people" label="Total Users" value={stats.total} color="#3b82f6" />
                    <StatCard icon="check_circle" label="Active" value={stats.active} color="#22c55e" />
                    <StatCard icon="security" label="MFA Enabled" value={stats.mfaEnabled} color="#8b5cf6" />
                    <StatCard icon="hourglass_top" label="Pending" value={stats.pending} color="#f59e0b" />
                </div>

                {/* RBAC Summary */}
                <div style={card(isDark)}>
                    <div style={cardHeader(isDark)}>
                        <div style={cardTitle}>
                            <span className="material-icons-outlined" style={{ fontSize: 16, color: '#8b5cf6' }}>admin_panel_settings</span>
                            Role-Based Access Control (RBAC)
                        </div>
                    </div>
                    <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        {(Object.entries(roleConfig) as [UserRole, typeof roleConfig.admin][]).map(([key, cfg]) => (
                            <div key={key} style={{
                                padding: '14px 16px', borderRadius: 10,
                                backgroundColor: isDark ? `${cfg.color}08` : `${cfg.color}05`,
                                border: `1px solid ${isDark ? `${cfg.color}20` : `${cfg.color}12`}`,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                    <span className="material-icons-outlined" style={{ fontSize: 18, color: cfg.color }}>{cfg.icon}</span>
                                    <span style={{ fontSize: 14, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
                                    <span style={{
                                        marginLeft: 'auto', fontSize: 11, fontWeight: 600,
                                        padding: '2px 8px', borderRadius: 10,
                                        backgroundColor: isDark ? `${cfg.color}15` : `${cfg.color}10`, color: cfg.color,
                                    }}>
                                        {users.filter(u => u.role === key).length} user{users.filter(u => u.role === key).length !== 1 ? 's' : ''}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {cfg.permissions.map(p => (
                                        <span key={p} style={{
                                            fontSize: 10, padding: '2px 8px', borderRadius: 4,
                                            backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                                            color: isDark ? '#9ca3af' : '#6b7280', fontWeight: 500,
                                        }}>{p}</span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* User Table */}
                <div style={card(isDark)}>
                    <div style={{ ...cardHeader(isDark), display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                        <div style={cardTitle}>
                            <span className="material-icons-outlined" style={{ fontSize: 16, color: '#f59e0b' }}>list</span>
                            All Users
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <input style={{ ...inputStyle(isDark), width: 200, padding: '7px 12px', fontSize: 12 }}
                                placeholder="Search users..." value={search}
                                onChange={e => setSearch(e.target.value)}
                                onFocus={e => { e.currentTarget.style.borderColor = colors.primary; }}
                                onBlur={e => { e.currentTarget.style.borderColor = isDark ? colors.borderDark : colors.borderLight; }}
                            />
                            <select style={{ ...selectStyle(isDark), width: 120, padding: '7px 12px', fontSize: 12 }}
                                value={roleFilter} onChange={e => setRoleFilter(e.target.value as UserRole | 'all')}>
                                <option value="all">All Roles</option>
                                {Object.entries(roleConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                            <select style={{ ...selectStyle(isDark), width: 120, padding: '7px 12px', fontSize: 12 }}
                                value={statusFilter} onChange={e => setStatusFilter(e.target.value as UserStatus | 'all')}>
                                <option value="all">All Status</option>
                                {Object.entries(statusConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                            </select>
                            <select style={{ ...selectStyle(isDark), width: 160, padding: '7px 12px', fontSize: 12 }}
                                value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
                                {TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Table header */}
                    <div style={{
                        ...userRow(isDark, false), cursor: 'default',
                        fontWeight: 700, fontSize: 10, textTransform: 'uppercase' as const,
                        letterSpacing: '0.06em', color: isDark ? '#6b7280' : '#9ca3af',
                    }}>
                        <div>User</div><div>Role</div><div>Status</div><div>Team</div><div>Quota</div><div>Last Active</div><div></div>
                    </div>

                    {/* Table body */}
                    {filtered.length === 0 ? (
                        <div style={{ padding: 48, textAlign: 'center', color: isDark ? '#6b7280' : '#9ca3af' }}>
                            <span className="material-icons" style={{ fontSize: 48, opacity: 0.3, display: 'block', marginBottom: 12 }}>search_off</span>
                            No users match your filters
                        </div>
                    ) : filtered.map((u, i) => (
                        <div key={u.id} style={userRow(isDark, i % 2 === 0)}
                            onClick={() => setSelectedUser(u)}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = isDark ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.03)'; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = i % 2 === 0 ? (isDark ? 'rgba(17,24,39,0.3)' : 'rgba(249,250,251,0.5)') : 'transparent'; }}
                        >
                            {/* User */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{
                                    width: 32, height: 32, borderRadius: '50%',
                                    backgroundColor: isDark ? `${roleConfig[u.role].color}18` : `${roleConfig[u.role].color}12`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 11, fontWeight: 700, color: roleConfig[u.role].color, flexShrink: 0,
                                }}>{u.avatarInitials}</div>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                                    <div style={{ fontSize: 11, color: isDark ? '#6b7280' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                                </div>
                            </div>
                            {/* Role */}
                            <div><span style={badge(isDark, roleConfig[u.role].color)}>
                                <span className="material-icons" style={{ fontSize: 12 }}>{roleConfig[u.role].icon}</span>
                                {roleConfig[u.role].label}
                            </span></div>
                            {/* Status */}
                            <div><span style={badge(isDark, statusConfig[u.status].color)}>
                                <span className="material-icons" style={{ fontSize: 12 }}>{statusConfig[u.status].icon}</span>
                                {statusConfig[u.status].label}
                            </span></div>
                            {/* Team */}
                            <div style={{ fontSize: 12, fontWeight: 500, color: isDark ? '#d1d5db' : '#374151' }}>{u.team}</div>
                            {/* Quota */}
                            <div>
                                <div style={quotaBar(isDark, u.quotaUsedPct)}><div style={quotaFill(u.quotaUsedPct)} /></div>
                                <div style={{ fontSize: 10, color: isDark ? '#6b7280' : '#9ca3af', marginTop: 3 }}>{u.quotaUsedPct}%</div>
                            </div>
                            {/* Last Active */}
                            <div style={{ fontSize: 11, color: isDark ? '#6b7280' : '#9ca3af' }}>{timeAgo(u.lastLogin)}</div>
                            {/* Chevron */}
                            <div><span className="material-icons" style={{ fontSize: 16, color: isDark ? '#4b5563' : '#d1d5db' }}>chevron_right</span></div>
                        </div>
                    ))}

                    {/* Footer */}
                    <div style={{
                        padding: '12px 20px', fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af',
                        borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                        display: 'flex', justifyContent: 'space-between',
                    }}>
                        <span>Showing {filtered.length} of {users.length} users</span>
                        <span style={{ fontSize: 11, opacity: 0.7 }}>Click a row for details</span>
                    </div>
                </div>

                {/* ─── Invite Modal ─── */}
                {showInviteModal && (
                    <div style={modalOverlay} onClick={() => setShowInviteModal(false)}>
                        <div style={modalBox(isDark)} onClick={e => e.stopPropagation()}>
                            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span className="material-icons" style={{ color: colors.primary, fontSize: 20 }}>person_add</span>
                                    Invite New User
                                </div>
                                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: isDark ? '#9ca3af' : '#6b7280', padding: 4 }}
                                    onClick={() => setShowInviteModal(false)}>
                                    <span className="material-icons" style={{ fontSize: 20 }}>close</span>
                                </button>
                            </div>
                            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#d1d5db' : '#374151', display: 'block', marginBottom: 6 }}>Full Name *</label>
                                    <input style={inputStyle(isDark)} placeholder="e.g. John Smith" value={inviteName} onChange={e => setInviteName(e.target.value)} />
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#d1d5db' : '#374151', display: 'block', marginBottom: 6 }}>Email Address *</label>
                                    <input style={inputStyle(isDark)} placeholder="e.g. john@company.io" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
                                </div>
                                <div style={{ display: 'flex', gap: 12 }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#d1d5db' : '#374151', display: 'block', marginBottom: 6 }}>Role</label>
                                        <select style={selectStyle(isDark)} value={inviteRole} onChange={e => setInviteRole(e.target.value as UserRole)}>
                                            {Object.entries(roleConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                        </select>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#d1d5db' : '#374151', display: 'block', marginBottom: 6 }}>Team</label>
                                        <select style={selectStyle(isDark)} value={inviteTeam} onChange={e => setInviteTeam(e.target.value)}>
                                            {TEAMS.filter(t => t !== 'All Teams').map(t => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                    </div>
                                </div>
                                {/* Role permissions preview */}
                                <div style={{
                                    padding: '12px 14px', borderRadius: 8,
                                    backgroundColor: isDark ? `${roleConfig[inviteRole].color}08` : `${roleConfig[inviteRole].color}04`,
                                    border: `1px solid ${isDark ? `${roleConfig[inviteRole].color}20` : `${roleConfig[inviteRole].color}12`}`,
                                }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: roleConfig[inviteRole].color, marginBottom: 6 }}>
                                        {roleConfig[inviteRole].label} Permissions:
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                        {roleConfig[inviteRole].permissions.map(p => (
                                            <span key={p} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)', color: isDark ? '#9ca3af' : '#6b7280' }}>{p}</span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div style={{ padding: '16px 24px', borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                                <button style={ghostBtn(isDark)} onClick={() => setShowInviteModal(false)}>Cancel</button>
                                <button style={{ ...primaryBtn(isDark), opacity: !inviteName.trim() || !inviteEmail.trim() ? 0.5 : 1 }}
                                    onClick={handleInvite} disabled={!inviteName.trim() || !inviteEmail.trim()}>
                                    <span className="material-icons" style={{ fontSize: 14 }}>send</span>
                                    Send Invitation
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ─── User Detail Drawer ─── */}
                {selectedUser && (
                    <>
                        <div style={{ ...modalOverlay, backgroundColor: 'rgba(0,0,0,0.3)' }} onClick={() => setSelectedUser(null)} />
                        <div style={drawerBox(isDark)}>
                            {/* Drawer header */}
                            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`, display: 'flex', alignItems: 'center', gap: 14 }}>
                                <div style={{
                                    width: 48, height: 48, borderRadius: '50%',
                                    backgroundColor: isDark ? `${roleConfig[selectedUser.role].color}18` : `${roleConfig[selectedUser.role].color}12`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 16, fontWeight: 700, color: roleConfig[selectedUser.role].color,
                                }}>{selectedUser.avatarInitials}</div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedUser.name}</div>
                                    <div style={{ fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280' }}>{selectedUser.email}</div>
                                </div>
                                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: isDark ? '#9ca3af' : '#6b7280', padding: 4 }}
                                    onClick={() => setSelectedUser(null)}>
                                    <span className="material-icons" style={{ fontSize: 20 }}>close</span>
                                </button>
                            </div>

                            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
                                {/* Status & Role */}
                                <div style={{ display: 'flex', gap: 10 }}>
                                    <span style={badge(isDark, roleConfig[selectedUser.role].color)}>
                                        <span className="material-icons" style={{ fontSize: 12 }}>{roleConfig[selectedUser.role].icon}</span>
                                        {roleConfig[selectedUser.role].label}
                                    </span>
                                    <span style={badge(isDark, statusConfig[selectedUser.status].color)}>
                                        <span className="material-icons" style={{ fontSize: 12 }}>{statusConfig[selectedUser.status].icon}</span>
                                        {statusConfig[selectedUser.status].label}
                                    </span>
                                    {selectedUser.mfaEnabled && <span style={badge(isDark, '#8b5cf6')}>
                                        <span className="material-icons" style={{ fontSize: 12 }}>security</span>MFA
                                    </span>}
                                </div>

                                {/* Info grid */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                    {[
                                        { label: 'Team', value: selectedUser.team, icon: 'groups' },
                                        { label: 'Created', value: formatDate(selectedUser.createdAt), icon: 'calendar_today' },
                                        { label: 'Last Login', value: selectedUser.lastLogin ? timeAgo(selectedUser.lastLogin) : 'Never', icon: 'login' },
                                        { label: 'Sessions Today', value: String(selectedUser.sessionsToday), icon: 'forum' },
                                        { label: 'Total Queries', value: selectedUser.totalQueries.toLocaleString(), icon: 'query_stats' },
                                        { label: 'API Keys', value: String(selectedUser.apiKeyCount), icon: 'key' },
                                    ].map(item => (
                                        <div key={item.label} style={{ padding: '10px 12px', borderRadius: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
                                            <div style={{ fontSize: 10, fontWeight: 600, color: isDark ? '#6b7280' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <span className="material-icons-outlined" style={{ fontSize: 13 }}>{item.icon}</span>{item.label}
                                            </div>
                                            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>{item.value}</div>
                                        </div>
                                    ))}
                                </div>

                                {/* Quota */}
                                <div style={{ padding: '12px 14px', borderRadius: 10, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                        <span style={{ fontSize: 12, fontWeight: 600 }}>Usage Quota</span>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: selectedUser.quotaUsedPct > 80 ? '#ef4444' : selectedUser.quotaUsedPct > 50 ? '#f59e0b' : '#22c55e' }}>{selectedUser.quotaUsedPct}%</span>
                                    </div>
                                    <div style={quotaBar(isDark, selectedUser.quotaUsedPct)}><div style={quotaFill(selectedUser.quotaUsedPct)} /></div>
                                </div>

                                {/* Permissions list */}
                                <div>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: isDark ? '#d1d5db' : '#374151', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span className="material-icons-outlined" style={{ fontSize: 14, color: roleConfig[selectedUser.role].color }}>lock</span>
                                        Permissions ({roleConfig[selectedUser.role].label})
                                    </div>
                                    {roleConfig[selectedUser.role].permissions.map(p => (
                                        <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13 }}>
                                            <span className="material-icons" style={{ fontSize: 14, color: '#22c55e' }}>check</span>
                                            {p}
                                        </div>
                                    ))}
                                </div>

                                {/* Actions */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`, paddingTop: 16 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: isDark ? '#d1d5db' : '#374151', marginBottom: 4 }}>Quick Actions</div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <select style={{ ...selectStyle(isDark), flex: 1, fontSize: 12 }}
                                            value={selectedUser.role} onChange={e => changeRole(selectedUser.id, e.target.value as UserRole)}>
                                            {Object.entries(roleConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                        </select>
                                        {selectedUser.status === 'active' ? (
                                            <button style={{ ...ghostBtn(isDark), color: '#f59e0b', borderColor: 'rgba(245,158,11,0.3)' }}
                                                onClick={() => toggleStatus(selectedUser.id, 'suspended')}>
                                                <span className="material-icons" style={{ fontSize: 14 }}>pause_circle</span>Suspend
                                            </button>
                                        ) : (
                                            <button style={{ ...ghostBtn(isDark), color: '#22c55e', borderColor: 'rgba(34,197,94,0.3)' }}
                                                onClick={() => toggleStatus(selectedUser.id, 'active')}>
                                                <span className="material-icons" style={{ fontSize: 14 }}>play_circle</span>Activate
                                            </button>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button style={ghostBtn(isDark)}>
                                            <span className="material-icons" style={{ fontSize: 14 }}>key</span>Generate API Key
                                        </button>
                                        <button style={ghostBtn(isDark)}>
                                            <span className="material-icons" style={{ fontSize: 14 }}>lock_reset</span>Reset Password
                                        </button>
                                        <button style={{ ...ghostBtn(isDark), color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                                            onClick={() => toggleStatus(selectedUser.id, 'deactivated')}>
                                            <span className="material-icons" style={{ fontSize: 14 }}>person_off</span>Deactivate
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {/* Inline animations */}
                <style>{`
                @keyframes slideIn {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }
            `}</style>
            </>}
        </div>
    );
}
