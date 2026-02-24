import { useState, useMemo, type CSSProperties } from 'react';
import { colors, shadows, fonts } from '../../theme';
import { usePolicies, type Policy } from '../../context/PolicyContext';

/* ─── Types ─── */
export interface PlatformGroup {
    id: string;
    name: string;
    description: string;
    icon: string;
    color: string;
    memberIds: string[];
    policyIds: string[];
    createdAt: string;
    createdBy: string;
}

// Minimal user info — mirrors UserManagement's mock data shape
interface MemberInfo {
    id: string;
    name: string;
    email: string;
    avatarInitials: string;
    role: string;
}

/* ─── Constants ─── */
const GROUP_ICONS = ['groups', 'engineering', 'shield', 'cloud', 'code', 'storage', 'security', 'hub', 'developer_board', 'business'];
const GROUP_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#84cc16'];

// Mock users (aligned with UserManagement mock IDs)
const ALL_USERS: MemberInfo[] = [
    { id: 'u1', name: 'Jane Doe', email: 'jane.doe@company.io', avatarInitials: 'JD', role: 'admin' },
    { id: 'u2', name: 'Alex Rivera', email: 'alex.r@company.io', avatarInitials: 'AR', role: 'operator' },
    { id: 'u3', name: 'Sam Chen', email: 'sam.chen@company.io', avatarInitials: 'SC', role: 'operator' },
    { id: 'u4', name: 'Morgan Blake', email: 'morgan.b@company.io', avatarInitials: 'MB', role: 'viewer' },
    { id: 'u5', name: 'Taylor Kim', email: 'taylor.k@company.io', avatarInitials: 'TK', role: 'auditor' },
    { id: 'u6', name: 'Jordan Patel', email: 'jordan.p@company.io', avatarInitials: 'JP', role: 'operator' },
    { id: 'u7', name: 'Casey Nguyen', email: 'casey.n@company.io', avatarInitials: 'CN', role: 'viewer' },
    { id: 'u8', name: 'Riley Foster', email: 'riley.f@company.io', avatarInitials: 'RF', role: 'operator' },
];

const SEED_GROUPS: PlatformGroup[] = [
    { id: 'g1', name: 'Platform Engineering', description: 'Core platform team — full admin access to infrastructure and agent orchestration.', icon: 'engineering', color: '#3b82f6', memberIds: ['u1', 'u2'], policyIds: ['pol-1', 'pol-5'], createdAt: '2025-06-15T09:00:00Z', createdBy: 'Jane Doe' },
    { id: 'g2', name: 'Cloud Infrastructure', description: 'Manages cloud resources, deployments, and IaC workflows.', icon: 'cloud', color: '#8b5cf6', memberIds: ['u2', 'u3', 'u8'], policyIds: ['pol-1', 'pol-4', 'pol-6'], createdAt: '2025-07-01T10:00:00Z', createdBy: 'Jane Doe' },
    { id: 'g3', name: 'Security & Compliance', description: 'Handles audit, compliance, PII handling, and policy enforcement.', icon: 'shield', color: '#ef4444', memberIds: ['u4', 'u5'], policyIds: ['pol-2', 'pol-5', 'pol-7'], createdAt: '2025-08-20T08:00:00Z', createdBy: 'Jane Doe' },
    { id: 'g4', name: 'DevOps', description: 'CI/CD, automation pipelines, and deployment workflows.', icon: 'developer_board', color: '#10b981', memberIds: ['u6'], policyIds: ['pol-1', 'pol-3'], createdAt: '2025-09-10T11:00:00Z', createdBy: 'Alex Rivera' },
    { id: 'g5', name: 'Product', description: 'Product managers and stakeholders — read-only access with limited workflow creation.', icon: 'hub', color: '#f59e0b', memberIds: ['u7'], policyIds: ['pol-8'], createdAt: '2025-10-05T14:00:00Z', createdBy: 'Jane Doe' },
];

/* ─── Helpers ─── */
function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ─── Styles ─── */
const badge = (isDark: boolean, color: string): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
    backgroundColor: isDark ? `${color}18` : `${color}12`, color, whiteSpace: 'nowrap',
});

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

const inputStyle = (isDark: boolean): CSSProperties => ({
    width: '100%', padding: '10px 14px', borderRadius: 8,
    border: `1.5px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: isDark ? '#111827' : '#ffffff',
    color: isDark ? '#e5e7eb' : '#1f2937', fontSize: 13,
    fontFamily: fonts.display, outline: 'none', transition: 'border-color 0.15s',
    boxSizing: 'border-box' as const,
});

const selectStyle = (isDark: boolean): CSSProperties => ({
    ...inputStyle(isDark), cursor: 'pointer', appearance: 'none' as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24'%3E%3Cpath fill='${isDark ? '%239ca3af' : '%236b7280'}' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: 32,
});

const primaryBtn: CSSProperties = {
    padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    fontFamily: fonts.display, cursor: 'pointer', border: 'none',
    backgroundColor: colors.primary, color: '#fff', boxShadow: shadows.blueMd,
    display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
};

const ghostBtn = (isDark: boolean): CSSProperties => ({
    padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    fontFamily: fonts.display, cursor: 'pointer',
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: 'transparent', color: isDark ? '#d1d5db' : '#374151',
    display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
});

const modalOverlay: CSSProperties = {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
    animation: 'fadeIn 0.2s',
};

const modalBox = (isDark: boolean): CSSProperties => ({
    backgroundColor: isDark ? '#1e293b' : '#ffffff',
    borderRadius: 16, border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    boxShadow: shadows.overlay, width: 560, maxHeight: '85vh', overflowY: 'auto',
    animation: 'fadeIn 0.25s',
});

const drawerBox = (isDark: boolean): CSSProperties => ({
    position: 'fixed', top: 0, right: 0, bottom: 0, width: 480,
    backgroundColor: isDark ? '#111827' : '#ffffff',
    borderLeft: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    boxShadow: shadows.overlay, zIndex: 200, overflowY: 'auto',
    animation: 'slideIn 0.3s cubic-bezier(0.16,1,0.3,1)',
});

const contentContainer: CSSProperties = {
    maxWidth: 960, margin: '0 auto',
    display: 'flex', flexDirection: 'column', gap: 24,
};

/* ─── Component ─── */
interface Props { isDark: boolean }

export default function GroupManagement({ isDark }: Props) {
    const { policies } = usePolicies();
    const [groups, setGroups] = useState<PlatformGroup[]>(SEED_GROUPS);
    const [search, setSearch] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedGroup, setSelectedGroup] = useState<PlatformGroup | null>(null);

    // Create form
    const [formName, setFormName] = useState('');
    const [formDesc, setFormDesc] = useState('');
    const [formIcon, setFormIcon] = useState('groups');
    const [formColor, setFormColor] = useState('#3b82f6');

    // Policy assignment modal (inside drawer)
    const [showPolicyPicker, setShowPolicyPicker] = useState(false);
    const [showMemberPicker, setShowMemberPicker] = useState(false);

    const filtered = useMemo(() => {
        if (!search) return groups;
        const q = search.toLowerCase();
        return groups.filter(g => g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q));
    }, [groups, search]);

    const stats = useMemo(() => ({
        totalGroups: groups.length,
        totalMembers: new Set(groups.flatMap(g => g.memberIds)).size,
        totalPolicies: new Set(groups.flatMap(g => g.policyIds)).size,
    }), [groups]);

    const getMemberInfo = (id: string): MemberInfo | undefined => ALL_USERS.find(u => u.id === id);
    const getPolicy = (id: string): Policy | undefined => policies.find(p => p.id === id);

    const handleCreate = () => {
        if (!formName.trim()) return;
        const newGroup: PlatformGroup = {
            id: `g${Date.now()}`, name: formName.trim(), description: formDesc.trim(),
            icon: formIcon, color: formColor, memberIds: [], policyIds: [],
            createdAt: new Date().toISOString(), createdBy: 'Admin',
        };
        setGroups(prev => [newGroup, ...prev]);
        setFormName(''); setFormDesc(''); setFormIcon('groups'); setFormColor('#3b82f6');
        setShowCreateModal(false);
    };

    const addMember = (groupId: string, userId: string) => {
        setGroups(prev => prev.map(g => g.id === groupId && !g.memberIds.includes(userId)
            ? { ...g, memberIds: [...g.memberIds, userId] } : g));
        if (selectedGroup?.id === groupId)
            setSelectedGroup(prev => prev && !prev.memberIds.includes(userId) ? { ...prev, memberIds: [...prev.memberIds, userId] } : prev);
    };

    const removeMember = (groupId: string, userId: string) => {
        setGroups(prev => prev.map(g => g.id === groupId ? { ...g, memberIds: g.memberIds.filter(m => m !== userId) } : g));
        if (selectedGroup?.id === groupId)
            setSelectedGroup(prev => prev ? { ...prev, memberIds: prev.memberIds.filter(m => m !== userId) } : prev);
    };

    const assignPolicy = (groupId: string, policyId: string) => {
        setGroups(prev => prev.map(g => g.id === groupId && !g.policyIds.includes(policyId)
            ? { ...g, policyIds: [...g.policyIds, policyId] } : g));
        if (selectedGroup?.id === groupId)
            setSelectedGroup(prev => prev && !prev.policyIds.includes(policyId) ? { ...prev, policyIds: [...prev.policyIds, policyId] } : prev);
    };

    const unassignPolicy = (groupId: string, policyId: string) => {
        setGroups(prev => prev.map(g => g.id === groupId ? { ...g, policyIds: g.policyIds.filter(p => p !== policyId) } : g));
        if (selectedGroup?.id === groupId)
            setSelectedGroup(prev => prev ? { ...prev, policyIds: prev.policyIds.filter(p => p !== policyId) } : prev);
    };

    const deleteGroup = (groupId: string) => {
        setGroups(prev => prev.filter(g => g.id !== groupId));
        setSelectedGroup(null);
    };

    const sevColors: Record<string, string> = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#22c55e' };

    /* ─── Render ─── */
    return (
        <div style={contentContainer}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="material-icons" style={{ color: '#8b5cf6', fontSize: 24 }}>workspaces</span>
                        Group Management
                    </h2>
                    <p style={{ fontSize: 14, color: isDark ? '#9ca3af' : '#6b7280', marginTop: 4 }}>
                        Organize users into groups and assign policies for coordinated access control
                    </p>
                </div>
                <button style={primaryBtn} onClick={() => setShowCreateModal(true)}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#2563eb'; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.primary; }}
                >
                    <span className="material-icons" style={{ fontSize: 16 }}>group_add</span>
                    Create Group
                </button>
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: 16 }}>
                {[
                    { icon: 'workspaces', label: 'Total Groups', value: stats.totalGroups, color: '#8b5cf6' },
                    { icon: 'people', label: 'Unique Members', value: stats.totalMembers, color: '#3b82f6' },
                    { icon: 'policy', label: 'Attached Policies', value: stats.totalPolicies, color: '#10b981' },
                ].map(s => (
                    <div key={s.label} style={{
                        flex: 1, backgroundColor: isDark ? colors.surfaceDark : '#ffffff',
                        borderRadius: 14, border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                        boxShadow: shadows.sm, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14,
                    }}>
                        <div style={{
                            width: 42, height: 42, borderRadius: 11,
                            backgroundColor: isDark ? `${s.color}15` : `${s.color}10`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <span className="material-icons-outlined" style={{ fontSize: 20, color: s.color }}>{s.icon}</span>
                        </div>
                        <div>
                            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{s.value}</div>
                            <div style={{ fontSize: 11, fontWeight: 500, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Search */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input style={{ ...inputStyle(isDark), maxWidth: 320, padding: '9px 14px' }}
                    placeholder="Search groups..." value={search} onChange={e => setSearch(e.target.value)}
                    onFocus={e => { e.currentTarget.style.borderColor = colors.primary; }}
                    onBlur={e => { e.currentTarget.style.borderColor = isDark ? colors.borderDark : colors.borderLight; }}
                />
                <span style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af' }}>
                    {filtered.length} group{filtered.length !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Group Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {filtered.map(g => {
                    const members = g.memberIds.map(getMemberInfo).filter(Boolean) as MemberInfo[];
                    const groupPolicies = g.policyIds.map(getPolicy).filter(Boolean) as Policy[];
                    return (
                        <div key={g.id} style={{ ...card(isDark), cursor: 'pointer', transition: 'all 0.15s' }}
                            onClick={() => setSelectedGroup(g)}
                            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = shadows.md; }}
                            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = shadows.sm; }}
                        >
                            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {/* Group header */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div style={{
                                        width: 42, height: 42, borderRadius: 12,
                                        backgroundColor: isDark ? `${g.color}15` : `${g.color}10`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <span className="material-icons" style={{ fontSize: 22, color: g.color }}>{g.icon}</span>
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
                                        <div style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.description}</div>
                                    </div>
                                    <span className="material-icons" style={{ fontSize: 16, color: isDark ? '#4b5563' : '#d1d5db' }}>chevron_right</span>
                                </div>

                                {/* Stats row */}
                                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280' }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span className="material-icons" style={{ fontSize: 14 }}>people</span>
                                        {members.length} member{members.length !== 1 ? 's' : ''}
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span className="material-icons" style={{ fontSize: 14 }}>policy</span>
                                        {groupPolicies.length} polic{groupPolicies.length !== 1 ? 'ies' : 'y'}
                                    </span>
                                </div>

                                {/* Member avatars */}
                                <div style={{ display: 'flex', gap: -4 }}>
                                    {members.slice(0, 5).map((m, i) => (
                                        <div key={m.id} style={{
                                            width: 28, height: 28, borderRadius: '50%',
                                            backgroundColor: isDark ? `${g.color}20` : `${g.color}15`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 10, fontWeight: 700, color: g.color,
                                            border: `2px solid ${isDark ? colors.surfaceDark : '#ffffff'}`,
                                            marginLeft: i > 0 ? -6 : 0, zIndex: 5 - i,
                                        }}>{m.avatarInitials}</div>
                                    ))}
                                    {members.length > 5 && (
                                        <div style={{
                                            width: 28, height: 28, borderRadius: '50%',
                                            backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 9, fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280',
                                            border: `2px solid ${isDark ? colors.surfaceDark : '#ffffff'}`, marginLeft: -6,
                                        }}>+{members.length - 5}</div>
                                    )}
                                </div>

                                {/* Policy badges */}
                                {groupPolicies.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                                        {groupPolicies.slice(0, 3).map(p => (
                                            <span key={p.id} style={{
                                                fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 500,
                                                backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                                                color: isDark ? '#9ca3af' : '#6b7280',
                                            }}>{p.name}</span>
                                        ))}
                                        {groupPolicies.length > 3 && (
                                            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, color: isDark ? '#6b7280' : '#9ca3af' }}>+{groupPolicies.length - 3}</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ─── Create Group Modal ─── */}
            {showCreateModal && (
                <div style={modalOverlay} onClick={() => setShowCreateModal(false)}>
                    <div style={modalBox(isDark)} onClick={e => e.stopPropagation()}>
                        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontSize: 17, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span className="material-icons" style={{ color: '#8b5cf6', fontSize: 20 }}>group_add</span>
                                Create New Group
                            </div>
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: isDark ? '#9ca3af' : '#6b7280', padding: 4 }}
                                onClick={() => setShowCreateModal(false)}>
                                <span className="material-icons" style={{ fontSize: 20 }}>close</span>
                            </button>
                        </div>
                        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#d1d5db' : '#374151', display: 'block', marginBottom: 6 }}>Group Name *</label>
                                <input style={inputStyle(isDark)} placeholder="e.g. Data Science Team" value={formName} onChange={e => setFormName(e.target.value)} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#d1d5db' : '#374151', display: 'block', marginBottom: 6 }}>Description</label>
                                <textarea style={{ ...inputStyle(isDark), minHeight: 60, resize: 'vertical' as const }} placeholder="Describe the group's purpose..."
                                    value={formDesc} onChange={e => setFormDesc(e.target.value)} />
                            </div>
                            <div style={{ display: 'flex', gap: 16 }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#d1d5db' : '#374151', display: 'block', marginBottom: 6 }}>Icon</label>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {GROUP_ICONS.map(ic => (
                                            <button key={ic} onClick={() => setFormIcon(ic)} style={{
                                                width: 36, height: 36, borderRadius: 8, border: `1.5px solid ${formIcon === ic ? formColor : isDark ? colors.borderDark : colors.borderLight}`,
                                                backgroundColor: formIcon === ic ? (isDark ? `${formColor}18` : `${formColor}10`) : 'transparent',
                                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            }}>
                                                <span className="material-icons" style={{ fontSize: 18, color: formIcon === ic ? formColor : isDark ? '#6b7280' : '#9ca3af' }}>{ic}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#d1d5db' : '#374151', display: 'block', marginBottom: 6 }}>Color</label>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {GROUP_COLORS.map(c => (
                                            <button key={c} onClick={() => setFormColor(c)} style={{
                                                width: 28, height: 28, borderRadius: '50%', backgroundColor: c, border: `2.5px solid ${formColor === c ? (isDark ? '#fff' : '#1f2937') : 'transparent'}`,
                                                cursor: 'pointer', transition: 'border-color 0.15s',
                                            }} />
                                        ))}
                                    </div>
                                </div>
                            </div>
                            {/* Preview */}
                            <div style={{ padding: '14px 16px', borderRadius: 10, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', display: 'flex', alignItems: 'center', gap: 12 }}>
                                <div style={{
                                    width: 40, height: 40, borderRadius: 10,
                                    backgroundColor: isDark ? `${formColor}15` : `${formColor}10`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <span className="material-icons" style={{ fontSize: 20, color: formColor }}>{formIcon}</span>
                                </div>
                                <div>
                                    <div style={{ fontSize: 14, fontWeight: 700 }}>{formName || 'Group Name'}</div>
                                    <div style={{ fontSize: 11, color: isDark ? '#6b7280' : '#9ca3af' }}>{formDesc || 'Description'}</div>
                                </div>
                            </div>
                        </div>
                        <div style={{ padding: '16px 24px', borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                            <button style={ghostBtn(isDark)} onClick={() => setShowCreateModal(false)}>Cancel</button>
                            <button style={{ ...primaryBtn, opacity: !formName.trim() ? 0.5 : 1 }} onClick={handleCreate} disabled={!formName.trim()}>
                                <span className="material-icons" style={{ fontSize: 14 }}>add</span>Create Group
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Group Detail Drawer ─── */}
            {selectedGroup && (
                <>
                    <div style={{ ...modalOverlay, backgroundColor: 'rgba(0,0,0,0.3)' }} onClick={() => { setSelectedGroup(null); setShowPolicyPicker(false); setShowMemberPicker(false); }} />
                    <div style={drawerBox(isDark)}>
                        {/* Header */}
                        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`, display: 'flex', alignItems: 'center', gap: 14 }}>
                            <div style={{
                                width: 48, height: 48, borderRadius: 14,
                                backgroundColor: isDark ? `${selectedGroup.color}18` : `${selectedGroup.color}12`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <span className="material-icons" style={{ fontSize: 26, color: selectedGroup.color }}>{selectedGroup.icon}</span>
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedGroup.name}</div>
                                <div style={{ fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280' }}>{selectedGroup.description}</div>
                            </div>
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: isDark ? '#9ca3af' : '#6b7280', padding: 4 }}
                                onClick={() => { setSelectedGroup(null); setShowPolicyPicker(false); setShowMemberPicker(false); }}>
                                <span className="material-icons" style={{ fontSize: 20 }}>close</span>
                            </button>
                        </div>

                        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
                            {/* Meta */}
                            <div style={{ display: 'flex', gap: 12 }}>
                                {[
                                    { label: 'Created', value: formatDate(selectedGroup.createdAt), icon: 'calendar_today' },
                                    { label: 'Created By', value: selectedGroup.createdBy, icon: 'person' },
                                ].map(m => (
                                    <div key={m.label} style={{ flex: 1, padding: '10px 12px', borderRadius: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' }}>
                                        <div style={{ fontSize: 10, fontWeight: 600, color: isDark ? '#6b7280' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <span className="material-icons-outlined" style={{ fontSize: 12 }}>{m.icon}</span>{m.label}
                                        </div>
                                        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{m.value}</div>
                                    </div>
                                ))}
                            </div>

                            {/* ─── Members ─── */}
                            <div style={card(isDark)}>
                                <div style={{ ...cardHeader(isDark), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={cardTitle}>
                                        <span className="material-icons-outlined" style={{ fontSize: 16, color: '#3b82f6' }}>people</span>
                                        Members ({selectedGroup.memberIds.length})
                                    </div>
                                    <button style={ghostBtn(isDark)} onClick={() => setShowMemberPicker(!showMemberPicker)}>
                                        <span className="material-icons" style={{ fontSize: 14 }}>{showMemberPicker ? 'close' : 'person_add'}</span>
                                        {showMemberPicker ? 'Done' : 'Add'}
                                    </button>
                                </div>
                                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {showMemberPicker && (
                                        <div style={{ marginBottom: 8, padding: '10px 12px', borderRadius: 8, backgroundColor: isDark ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.03)', border: `1px solid ${isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)'}` }}>
                                            <div style={{ fontSize: 11, fontWeight: 600, color: '#3b82f6', marginBottom: 8 }}>Add Members:</div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                                {ALL_USERS.filter(u => !selectedGroup.memberIds.includes(u.id)).map(u => (
                                                    <button key={u.id} onClick={() => addMember(selectedGroup.id, u.id)} style={{
                                                        ...ghostBtn(isDark), fontSize: 11, padding: '4px 10px',
                                                    }}>
                                                        <span style={{ fontSize: 10, fontWeight: 700 }}>{u.avatarInitials}</span>
                                                        {u.name}
                                                        <span className="material-icons" style={{ fontSize: 12 }}>add</span>
                                                    </button>
                                                ))}
                                                {ALL_USERS.filter(u => !selectedGroup.memberIds.includes(u.id)).length === 0 && (
                                                    <span style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af' }}>All users already added</span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    {selectedGroup.memberIds.length === 0 ? (
                                        <div style={{ padding: 20, textAlign: 'center', color: isDark ? '#6b7280' : '#9ca3af', fontSize: 13 }}>No members yet — click Add to invite</div>
                                    ) : selectedGroup.memberIds.map(id => {
                                        const m = getMemberInfo(id);
                                        if (!m) return null;
                                        return (
                                            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}>
                                                <div style={{
                                                    width: 30, height: 30, borderRadius: '50%',
                                                    backgroundColor: isDark ? `${selectedGroup.color}18` : `${selectedGroup.color}12`,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    fontSize: 10, fontWeight: 700, color: selectedGroup.color,
                                                }}>{m.avatarInitials}</div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 13, fontWeight: 600 }}>{m.name}</div>
                                                    <div style={{ fontSize: 11, color: isDark ? '#6b7280' : '#9ca3af' }}>{m.email}</div>
                                                </div>
                                                <span style={badge(isDark, '#6b7280')}>{m.role}</span>
                                                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2 }}
                                                    onClick={() => removeMember(selectedGroup.id, m.id)}>
                                                    <span className="material-icons" style={{ fontSize: 16 }}>close</span>
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* ─── Policies ─── */}
                            <div style={card(isDark)}>
                                <div style={{ ...cardHeader(isDark), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={cardTitle}>
                                        <span className="material-icons-outlined" style={{ fontSize: 16, color: '#10b981' }}>policy</span>
                                        Assigned Policies ({selectedGroup.policyIds.length})
                                    </div>
                                    <button style={ghostBtn(isDark)} onClick={() => setShowPolicyPicker(!showPolicyPicker)}>
                                        <span className="material-icons" style={{ fontSize: 14 }}>{showPolicyPicker ? 'close' : 'add'}</span>
                                        {showPolicyPicker ? 'Done' : 'Assign'}
                                    </button>
                                </div>
                                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {showPolicyPicker && (
                                        <div style={{ marginBottom: 8, padding: '10px 12px', borderRadius: 8, backgroundColor: isDark ? 'rgba(16,185,129,0.06)' : 'rgba(16,185,129,0.03)', border: `1px solid ${isDark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)'}` }}>
                                            <div style={{ fontSize: 11, fontWeight: 600, color: '#10b981', marginBottom: 8 }}>Available Policies:</div>
                                            <select style={{ ...selectStyle(isDark), fontSize: 12 }}
                                                value="" onChange={e => { if (e.target.value) assignPolicy(selectedGroup.id, e.target.value); }}>
                                                <option value="">Select a policy to assign...</option>
                                                {policies.filter(p => !selectedGroup.policyIds.includes(p.id)).map(p => (
                                                    <option key={p.id} value={p.id}>{p.name} ({p.category})</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    {selectedGroup.policyIds.length === 0 ? (
                                        <div style={{ padding: 20, textAlign: 'center', color: isDark ? '#6b7280' : '#9ca3af', fontSize: 13 }}>No policies assigned — click Assign to add</div>
                                    ) : selectedGroup.policyIds.map(pid => {
                                        const p = getPolicy(pid);
                                        if (!p) return (
                                            <div key={pid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', opacity: 0.5 }}>
                                                <span className="material-icons" style={{ fontSize: 16, color: '#6b7280' }}>policy</span>
                                                <span style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af' }}>{pid} (not found)</span>
                                                <button style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2 }}
                                                    onClick={() => unassignPolicy(selectedGroup.id, pid)}>
                                                    <span className="material-icons" style={{ fontSize: 16 }}>close</span>
                                                </button>
                                            </div>
                                        );
                                        return (
                                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}>
                                                <span className="material-icons-outlined" style={{ fontSize: 18, color: '#10b981' }}>policy</span>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                                                    <div style={{ fontSize: 11, color: isDark ? '#6b7280' : '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>
                                                </div>
                                                <span style={badge(isDark, sevColors[p.severity] || '#6b7280')}>{p.severity}</span>
                                                <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2 }}
                                                    onClick={() => unassignPolicy(selectedGroup.id, p.id)}>
                                                    <span className="material-icons" style={{ fontSize: 16 }}>close</span>
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Danger actions */}
                            <div style={{ borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`, paddingTop: 16 }}>
                                <button style={{ ...ghostBtn(isDark), color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                                    onClick={() => deleteGroup(selectedGroup.id)}>
                                    <span className="material-icons" style={{ fontSize: 14 }}>delete</span>Delete Group
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {/* Animations */}
            <style>{`
                @keyframes slideIn {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }
            `}</style>
        </div>
    );
}
