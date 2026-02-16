import { useState, type CSSProperties } from 'react';
import { useTheme } from '../../context/ThemeContext';
import {
    usePolicies,
    categoryLabels, categoryIcons, categoryColors,
    targetLabels, targetIcons,
    statusColors, severityColors,
    type PolicyCategory, type PolicyTarget, type PolicyStatus, type Policy,
} from '../../context/PolicyContext';
import { colors, shadows, fonts } from '../../theme';

/* ─── Sub-tab type ─── */
type SubTab = 'overview' | 'policies' | 'assignments' | 'audit';

/* ─── Helpers ─── */
function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatDateTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        + ' · '
        + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

/* ─── Style factories ─── */
const s = {
    wrapper: { display: 'flex', flexDirection: 'column' as const, gap: 24, maxWidth: 960, margin: '0 auto' },
    sectionTitle: { fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' } as CSSProperties,
    sectionSub: (isDark: boolean): CSSProperties => ({
        fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280', marginTop: 4, lineHeight: 1.5,
    }),
    card: (isDark: boolean): CSSProperties => ({
        backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight,
        borderRadius: 16,
        border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
        boxShadow: shadows.sm,
        overflow: 'hidden',
    }),
    cardHead: (isDark: boolean): CSSProperties => ({
        padding: '16px 24px',
        borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }),
    cardTitle: { fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 } as CSSProperties,
    tabBar: (isDark: boolean): CSSProperties => ({
        display: 'flex', gap: 2,
        padding: '0 0 0 0',
        borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
        backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight,
        borderRadius: '16px 16px 0 0',
    }),
    tab: (isDark: boolean, active: boolean): CSSProperties => ({
        padding: '13px 22px',
        fontSize: 13, fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        color: active ? colors.primary : isDark ? '#9ca3af' : '#6b7280',
        borderBottom: `2px solid ${active ? colors.primary : 'transparent'}`,
        display: 'flex', alignItems: 'center', gap: 6,
        transition: 'color 0.15s, border-color 0.15s',
        userSelect: 'none' as const,
        fontFamily: fonts.display,
        backgroundColor: 'transparent', border: 'none',
    }),
    badge: (bg: string, color: string): CSSProperties => ({
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '2px 9px', fontSize: 11, fontWeight: 600,
        borderRadius: 9999, backgroundColor: bg, color,
        textTransform: 'capitalize' as const,
    }),
    table: (isDark: boolean): CSSProperties => ({
        width: '100%', borderCollapse: 'collapse' as const, fontSize: 14,
        color: isDark ? '#e5e7eb' : '#1f2937',
    }),
    th: (isDark: boolean): CSSProperties => ({
        textAlign: 'left' as const, padding: '10px 16px', fontSize: 11,
        fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em',
        color: isDark ? '#9ca3af' : '#6b7280',
        borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    }),
    td: (isDark: boolean): CSSProperties => ({
        padding: '12px 16px', verticalAlign: 'middle' as const,
        borderBottom: `1px solid ${isDark ? '#1f2937' : '#f3f4f6'}`,
    }),
};

/* ═══════════════════════════════════════════════
   OVERVIEW  Sub-Tab
   ═══════════════════════════════════════════════ */
function OverviewSection() {
    const { isDark } = useTheme();
    const { policies, assignments, auditLog } = usePolicies();

    const activePolicies = policies.filter((p: Policy) => p.status === 'active').length;
    const totalAssignments = assignments.length;

    // Compliance percentage (active + assigned / total)
    const assignedActive = new Set(
        assignments.filter((a) => policies.find((p: Policy) => p.id === a.policyId)?.status === 'active').map((a) => a.policyId)
    ).size;
    const complianceRate = activePolicies > 0 ? Math.round((assignedActive / activePolicies) * 100) : 0;

    // Category breakdown
    const categoryBreakdown: { category: PolicyCategory; count: number; active: number }[] =
        (['access', 'execution', 'data', 'workflow', 'network'] as PolicyCategory[]).map((cat) => ({
            category: cat,
            count: policies.filter((p: Policy) => p.category === cat).length,
            active: policies.filter((p: Policy) => p.category === cat && p.status === 'active').length,
        }));

    // Target breakdown
    const targetBreakdown: { target: PolicyTarget; count: number }[] =
        (['user', 'agent', 'team', 'group', 'role'] as PolicyTarget[]).map((t) => ({
            target: t,
            count: assignments.filter((a) => a.targetType === t).length,
        }));

    const recentAudit = [...auditLog].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 5);

    return (
        <div style={s.wrapper}>
            <div>
                <h3 style={s.sectionTitle}>Policy Overview</h3>
                <p style={s.sectionSub(isDark)}>
                    Monitor your OPA policy landscape — compliance health, enforcement status, and recent activity.
                </p>
            </div>

            {/* OPA Info Banner */}
            <div style={{
                display: 'flex', gap: 12, padding: 16, borderRadius: 12,
                backgroundColor: isDark ? 'rgba(139,92,246,0.08)' : '#f5f3ff',
                border: `1px solid ${isDark ? 'rgba(139,92,246,0.2)' : '#ddd6fe'}`,
                fontSize: 13, color: isDark ? '#c4b5fd' : '#5b21b6', lineHeight: 1.5,
                alignItems: 'flex-start',
            }}>
                <span className="material-icons" style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>verified_user</span>
                <div>
                    Policies are authored in <strong>OPA Rego</strong> and evaluated at runtime.
                    They can be attached to <strong>Users</strong>, <strong>Agents</strong>, <strong>Teams</strong>, <strong>Groups</strong>, or <strong>Roles</strong>.
                    Use the <em>Policies</em> tab to view Rego code and the <em>Assignments</em> tab to manage bindings.
                </div>
            </div>

            {/* Stat cards row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                {[
                    { icon: 'policy', label: 'Total Policies', value: policies.length, color: colors.primary },
                    { icon: 'check_circle', label: 'Active', value: activePolicies, color: '#16a34a' },
                    { icon: 'link', label: 'Assignments', value: totalAssignments, color: '#f59e0b' },
                    { icon: 'security', label: 'Compliance', value: `${complianceRate}%`, color: complianceRate >= 80 ? '#16a34a' : '#ef4444' },
                ].map((item) => (
                    <div key={item.label} style={{
                        ...s.card(isDark),
                        padding: '20px',
                        display: 'flex', flexDirection: 'column', gap: 8,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="material-icons-outlined" style={{ fontSize: 20, color: item.color }}>{item.icon}</span>
                            <span style={{ fontSize: 12, fontWeight: 500, color: isDark ? '#9ca3af' : '#6b7280' }}>{item.label}</span>
                        </div>
                        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>{item.value}</div>
                    </div>
                ))}
            </div>

            {/* Two-column: Categories + Targets */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Category Breakdown */}
                <div style={s.card(isDark)}>
                    <div style={s.cardHead(isDark)}>
                        <span style={s.cardTitle}>
                            <span className="material-icons" style={{ fontSize: 16, color: colors.primary }}>category</span>
                            Policy Categories
                        </span>
                    </div>
                    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {categoryBreakdown.map((cb) => (
                            <div key={cb.category} style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '10px 12px', borderRadius: 8,
                                backgroundColor: isDark ? '#111827' : '#fafafa',
                            }}>
                                <span className="material-icons" style={{ fontSize: 18, color: categoryColors[cb.category] }}>
                                    {categoryIcons[cb.category]}
                                </span>
                                <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
                                    {categoryLabels[cb.category]}
                                </span>
                                <span style={{ fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280' }}>
                                    {cb.active}/{cb.count} active
                                </span>
                                <div style={{
                                    width: 60, height: 4, borderRadius: 2,
                                    backgroundColor: isDark ? '#374151' : '#e5e7eb',
                                    overflow: 'hidden',
                                }}>
                                    <div style={{
                                        width: `${cb.count > 0 ? (cb.active / cb.count) * 100 : 0}%`,
                                        height: '100%', borderRadius: 2,
                                        backgroundColor: categoryColors[cb.category],
                                        transition: 'width 0.3s',
                                    }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Target Breakdown */}
                <div style={s.card(isDark)}>
                    <div style={s.cardHead(isDark)}>
                        <span style={s.cardTitle}>
                            <span className="material-icons" style={{ fontSize: 16, color: colors.primary }}>hub</span>
                            Assignment Targets
                        </span>
                    </div>
                    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {targetBreakdown.map((tb) => (
                            <div key={tb.target} style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '10px 12px', borderRadius: 8,
                                backgroundColor: isDark ? '#111827' : '#fafafa',
                            }}>
                                <span className="material-icons-outlined" style={{ fontSize: 18, color: colors.primary }}>
                                    {targetIcons[tb.target]}
                                </span>
                                <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>
                                    {targetLabels[tb.target]}
                                </span>
                                <span style={{
                                    fontSize: 12, fontWeight: 700,
                                    padding: '2px 10px', borderRadius: 10,
                                    backgroundColor: isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)',
                                    color: colors.primary,
                                }}>
                                    {tb.count}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Recent Activity */}
            <div style={s.card(isDark)}>
                <div style={s.cardHead(isDark)}>
                    <span style={s.cardTitle}>
                        <span className="material-icons" style={{ fontSize: 16, color: colors.primary }}>history</span>
                        Recent Activity
                    </span>
                </div>
                <div style={{ padding: '0 24px 16px' }}>
                    {recentAudit.map((entry, idx) => {
                        const actionColors: Record<string, string> = {
                            created: '#16a34a', updated: '#3b82f6', assigned: '#8b5cf6',
                            unassigned: '#f59e0b', enabled: '#10b981', disabled: '#6b7280',
                        };
                        const actionIcons: Record<string, string> = {
                            created: 'add_circle', updated: 'edit', assigned: 'link',
                            unassigned: 'link_off', enabled: 'toggle_on', disabled: 'toggle_off',
                        };
                        return (
                            <div key={entry.id} style={{
                                display: 'flex', gap: 12, padding: '14px 0',
                                borderBottom: idx < recentAudit.length - 1 ? `1px solid ${isDark ? '#1f2937' : '#f3f4f6'}` : 'none',
                                alignItems: 'flex-start',
                            }}>
                                <span className="material-icons" style={{
                                    fontSize: 18, color: actionColors[entry.action] || '#6b7280',
                                    marginTop: 2,
                                }}>
                                    {actionIcons[entry.action] || 'info'}
                                </span>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                                        <span style={{ fontWeight: 600 }}>{entry.actor}</span>
                                        {' '}{entry.action}{' '}
                                        <span style={{ color: colors.primary, fontWeight: 600 }}>{entry.policyName}</span>
                                    </div>
                                    <div style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af', marginTop: 2 }}>
                                        {entry.details}
                                    </div>
                                </div>
                                <span style={{ fontSize: 11, color: isDark ? '#4b5563' : '#9ca3af', whiteSpace: 'nowrap', marginTop: 2 }}>
                                    {formatDate(entry.timestamp)}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════
   POLICIES  Sub-Tab
   ═══════════════════════════════════════════════ */
function PoliciesSection() {
    const { isDark } = useTheme();
    const { policies, getAssignmentsForPolicy, updatePolicyStatus } = usePolicies();
    const [categoryFilter, setCategoryFilter] = useState<PolicyCategory | 'all'>('all');
    const [statusFilter, setStatusFilter] = useState<PolicyStatus | 'all'>('all');
    const [expandedPolicy, setExpandedPolicy] = useState<string | null>(null);

    const filtered = policies.filter((p) => {
        if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
        if (statusFilter !== 'all' && p.status !== statusFilter) return false;
        return true;
    });

    const filterBtnStyle = (value: string, current: string): CSSProperties => ({
        padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: current === value ? 600 : 500,
        cursor: 'pointer', fontFamily: fonts.display,
        border: `1.5px solid ${current === value ? colors.primary : isDark ? colors.borderDark : colors.borderLight}`,
        backgroundColor: current === value
            ? isDark ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.05)'
            : 'transparent',
        color: current === value ? colors.primary : isDark ? '#d1d5db' : '#4b5563',
        transition: 'all 0.15s',
    });

    return (
        <div style={s.wrapper}>
            <div>
                <h3 style={s.sectionTitle}>Policies</h3>
                <p style={s.sectionSub(isDark)}>
                    View, manage, and inspect OPA Rego policies. Click a policy row to expand and view its Rego source code.
                </p>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280', marginRight: 4 }}>CATEGORY</span>
                    {(['all', 'access', 'execution', 'data', 'workflow', 'network'] as const).map((cat) => (
                        <button
                            key={cat}
                            style={filterBtnStyle(cat, categoryFilter)}
                            onClick={() => setCategoryFilter(cat)}
                        >
                            {cat === 'all' ? 'All' : categoryLabels[cat]}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280', marginRight: 4 }}>STATUS</span>
                    {(['all', 'active', 'draft', 'disabled'] as const).map((st) => (
                        <button
                            key={st}
                            style={filterBtnStyle(st, statusFilter)}
                            onClick={() => setStatusFilter(st)}
                        >
                            {st === 'all' ? 'All' : st.charAt(0).toUpperCase() + st.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Policy List */}
            <div style={s.card(isDark)}>
                <div style={s.cardHead(isDark)}>
                    <span style={s.cardTitle}>
                        <span className="material-icons" style={{ fontSize: 16, color: colors.primary }}>policy</span>
                        {filtered.length} {filtered.length === 1 ? 'Policy' : 'Policies'}
                    </span>
                </div>

                {filtered.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 24px', color: isDark ? '#6b7280' : '#9ca3af' }}>
                        <span className="material-icons-outlined" style={{ fontSize: 40, display: 'block', marginBottom: 8, opacity: 0.3 }}>filter_alt_off</span>
                        No policies match the current filters
                    </div>
                ) : (
                    <div>
                        {filtered.map((policy) => {
                            const isExpanded = expandedPolicy === policy.id;
                            const assignCount = getAssignmentsForPolicy(policy.id).length;
                            const assignments = getAssignmentsForPolicy(policy.id);
                            const stColor = statusColors[policy.status];
                            const sevColor = severityColors[policy.severity];

                            return (
                                <div key={policy.id}>
                                    {/* Policy Row */}
                                    <div
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 16,
                                            padding: '16px 24px',
                                            borderBottom: `1px solid ${isDark ? '#1f2937' : '#f3f4f6'}`,
                                            cursor: 'pointer',
                                            backgroundColor: isExpanded
                                                ? isDark ? 'rgba(59,130,246,0.04)' : 'rgba(59,130,246,0.02)'
                                                : 'transparent',
                                            transition: 'background 0.15s',
                                        }}
                                        onClick={() => setExpandedPolicy(isExpanded ? null : policy.id)}
                                        onMouseEnter={(e) => {
                                            if (!isExpanded) e.currentTarget.style.backgroundColor = isDark ? '#111827' : '#fafafa';
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isExpanded) e.currentTarget.style.backgroundColor = 'transparent';
                                        }}
                                    >
                                        {/* Category icon */}
                                        <div style={{
                                            width: 36, height: 36, borderRadius: 10,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            backgroundColor: categoryColors[policy.category] + '15',
                                            flexShrink: 0,
                                        }}>
                                            <span className="material-icons" style={{
                                                fontSize: 18, color: categoryColors[policy.category],
                                            }}>
                                                {categoryIcons[policy.category]}
                                            </span>
                                        </div>

                                        {/* Name + description */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{ fontSize: 14, fontWeight: 600 }}>{policy.name}</span>
                                                <span style={{ fontSize: 11, color: isDark ? '#4b5563' : '#9ca3af' }}>v{policy.version}</span>
                                            </div>
                                            <div style={{
                                                fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af',
                                                marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            }}>
                                                {policy.description}
                                            </div>
                                        </div>

                                        {/* Severity */}
                                        <span style={s.badge(isDark ? sevColor.bgDark : sevColor.bg, isDark ? sevColor.textDark : sevColor.text)}>
                                            {policy.severity}
                                        </span>

                                        {/* Status */}
                                        <span style={s.badge(isDark ? stColor.bgDark : stColor.bg, isDark ? stColor.textDark : stColor.text)}>
                                            {policy.status}
                                        </span>

                                        {/* Assignment count */}
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: 4,
                                            fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af',
                                            minWidth: 48,
                                        }}>
                                            <span className="material-icons" style={{ fontSize: 14 }}>link</span>
                                            {assignCount}
                                        </div>

                                        {/* Expand icon */}
                                        <span className="material-icons" style={{
                                            fontSize: 18, color: isDark ? '#4b5563' : '#9ca3af',
                                            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                            transition: 'transform 0.2s',
                                        }}>
                                            expand_more
                                        </span>
                                    </div>

                                    {/* Expanded Detail */}
                                    {isExpanded && (
                                        <PolicyExpandedDetail
                                            policy={policy}
                                            assignments={assignments}
                                            onStatusChange={(status) => updatePolicyStatus(policy.id, status)}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

/* ─── Expanded Policy Detail ─── */
function PolicyExpandedDetail({
    policy, assignments, onStatusChange,
}: {
    policy: Policy;
    assignments: { targetType: PolicyTarget; targetName: string }[];
    onStatusChange: (s: PolicyStatus) => void;
}) {
    const { isDark } = useTheme();

    return (
        <div style={{
            padding: '0 24px 20px 24px',
            backgroundColor: isDark ? 'rgba(59,130,246,0.02)' : 'rgba(59,130,246,0.01)',
            borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
        }}>
            {/* Meta row */}
            <div style={{
                display: 'flex', gap: 24, padding: '14px 0', marginBottom: 12,
                borderBottom: `1px solid ${isDark ? '#1f2937' : '#f3f4f6'}`,
                flexWrap: 'wrap',
            }}>
                {[
                    { label: 'Category', value: categoryLabels[policy.category], icon: categoryIcons[policy.category], color: categoryColors[policy.category] },
                    { label: 'Created', value: formatDate(policy.createdAt), icon: 'calendar_today', color: isDark ? '#6b7280' : '#9ca3af' },
                    { label: 'Updated', value: formatDate(policy.updatedAt), icon: 'update', color: isDark ? '#6b7280' : '#9ca3af' },
                    { label: 'Author', value: policy.createdBy, icon: 'person', color: isDark ? '#6b7280' : '#9ca3af' },
                ].map((meta) => (
                    <div key={meta.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: isDark ? '#4b5563' : '#9ca3af' }}>
                            {meta.label}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500 }}>
                            <span className="material-icons" style={{ fontSize: 14, color: meta.color }}>{meta.icon}</span>
                            {meta.value}
                        </div>
                    </div>
                ))}
                {/* Applicable targets */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: isDark ? '#4b5563' : '#9ca3af' }}>
                        Applicable To
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                        {policy.targets.map((t) => (
                            <span key={t} style={{
                                fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 6,
                                backgroundColor: isDark ? '#1f2937' : '#f3f4f6',
                                color: isDark ? '#d1d5db' : '#4b5563',
                                display: 'flex', alignItems: 'center', gap: 3,
                            }}>
                                <span className="material-icons" style={{ fontSize: 12 }}>{targetIcons[t]}</span>
                                {targetLabels[t]}
                            </span>
                        ))}
                    </div>
                </div>
            </div>

            {/* Status controls */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280', marginRight: 4, lineHeight: '28px' }}>
                    SET STATUS:
                </span>
                {(['active', 'draft', 'disabled'] as PolicyStatus[]).map((st) => {
                    const isActive = policy.status === st;
                    return (
                        <button
                            key={st}
                            onClick={() => onStatusChange(st)}
                            style={{
                                padding: '4px 12px', borderRadius: 6,
                                fontSize: 11, fontWeight: isActive ? 600 : 500,
                                cursor: 'pointer', fontFamily: fonts.display,
                                border: `1.5px solid ${isActive ? colors.primary : isDark ? colors.borderDark : colors.borderLight}`,
                                backgroundColor: isActive ? isDark ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.08)' : 'transparent',
                                color: isActive ? colors.primary : isDark ? '#9ca3af' : '#6b7280',
                                transition: 'all 0.15s',
                                textTransform: 'capitalize',
                            }}
                        >
                            {st}
                        </button>
                    );
                })}
            </div>

            {/* Current assignments */}
            {assignments.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: isDark ? '#4b5563' : '#9ca3af', display: 'block', marginBottom: 6 }}>
                        Current Assignments ({assignments.length})
                    </span>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {assignments.map((a, i) => (
                            <span key={i} style={{
                                fontSize: 12, fontWeight: 500, padding: '4px 10px', borderRadius: 8,
                                backgroundColor: isDark ? 'rgba(139,92,246,0.1)' : '#f5f3ff',
                                color: isDark ? '#c4b5fd' : '#6d28d9',
                                border: `1px solid ${isDark ? 'rgba(139,92,246,0.2)' : '#ddd6fe'}`,
                                display: 'flex', alignItems: 'center', gap: 4,
                            }}>
                                <span className="material-icons" style={{ fontSize: 13 }}>{targetIcons[a.targetType]}</span>
                                {a.targetName}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Rego Code */}
            <div style={{
                borderRadius: 10, overflow: 'hidden',
                border: `1px solid ${isDark ? '#30363d' : '#d0d7de'}`,
            }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px',
                    backgroundColor: isDark ? '#161b22' : '#f6f8fa',
                    borderBottom: `1px solid ${isDark ? '#30363d' : '#d0d7de'}`,
                    fontSize: 12, fontWeight: 600,
                    color: isDark ? '#c9d1d9' : '#24292f',
                }}>
                    <span className="material-icons" style={{ fontSize: 14, color: '#f59e0b' }}>code</span>
                    {policy.name.toLowerCase().replace(/\s+/g, '_')}.rego
                </div>
                <pre style={{
                    margin: 0, padding: 16,
                    backgroundColor: isDark ? '#0d1117' : '#ffffff',
                    color: isDark ? '#c9d1d9' : '#24292f',
                    fontSize: 12, lineHeight: 1.6,
                    fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
                    overflowX: 'auto',
                    maxHeight: 320,
                }}>
                    {policy.regoCode}
                </pre>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════
   ASSIGNMENTS  Sub-Tab
   ═══════════════════════════════════════════════ */
function AssignmentsSection() {
    const { isDark } = useTheme();
    const { assignments, policies, removeAssignment } = usePolicies();
    const [filterTarget, setFilterTarget] = useState<PolicyTarget | 'all'>('all');

    const filtered = filterTarget === 'all'
        ? assignments
        : assignments.filter((a) => a.targetType === filterTarget);

    // Group by target type
    const grouped = filtered.reduce<Record<string, typeof assignments>>((acc, a) => {
        const key = `${a.targetType}:${a.targetName}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(a);
        return acc;
    }, {});

    return (
        <div style={s.wrapper}>
            <div>
                <h3 style={s.sectionTitle}>Policy Assignments</h3>
                <p style={s.sectionSub(isDark)}>
                    View and manage which policies are attached to which entities. Policies can be assigned to users, agents, teams, groups, or roles.
                </p>
            </div>

            {/* Target type filter */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280', marginRight: 4 }}>FILTER BY TARGET</span>
                {(['all', 'user', 'agent', 'team', 'group', 'role'] as const).map((t) => {
                    const isActive = filterTarget === t;
                    return (
                        <button
                            key={t}
                            onClick={() => setFilterTarget(t)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 5,
                                padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: isActive ? 600 : 500,
                                cursor: 'pointer', fontFamily: fonts.display,
                                border: `1.5px solid ${isActive ? colors.primary : isDark ? colors.borderDark : colors.borderLight}`,
                                backgroundColor: isActive ? isDark ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.05)' : 'transparent',
                                color: isActive ? colors.primary : isDark ? '#d1d5db' : '#4b5563',
                                transition: 'all 0.15s',
                            }}
                        >
                            {t !== 'all' && (
                                <span className="material-icons" style={{ fontSize: 14 }}>{targetIcons[t]}</span>
                            )}
                            {t === 'all' ? 'All' : targetLabels[t]}
                        </button>
                    );
                })}
            </div>

            {/* Assignment cards grouped by entity */}
            {Object.keys(grouped).length === 0 ? (
                <div style={{ ...s.card(isDark), textAlign: 'center', padding: '40px 24px', color: isDark ? '#6b7280' : '#9ca3af' }}>
                    <span className="material-icons-outlined" style={{ fontSize: 40, display: 'block', marginBottom: 8, opacity: 0.3 }}>link_off</span>
                    No assignments match the current filter
                </div>
            ) : (
                Object.entries(grouped).map(([key, items]) => {
                    const [targetType, targetName] = key.split(':') as [PolicyTarget, string];
                    return (
                        <div key={key} style={s.card(isDark)}>
                            <div style={{
                                ...s.cardHead(isDark),
                                gap: 10,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{
                                        width: 34, height: 34, borderRadius: 8,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        backgroundColor: isDark ? 'rgba(139,92,246,0.1)' : '#f5f3ff',
                                    }}>
                                        <span className="material-icons" style={{ fontSize: 18, color: '#8b5cf6' }}>
                                            {targetIcons[targetType]}
                                        </span>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 14, fontWeight: 600 }}>{targetName}</div>
                                        <div style={{ fontSize: 11, color: isDark ? '#6b7280' : '#9ca3af' }}>
                                            {targetLabels[targetType]} · {items.length} {items.length === 1 ? 'policy' : 'policies'} assigned
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <table style={s.table(isDark)}>
                                <thead>
                                    <tr>
                                        <th style={s.th(isDark)}>Policy</th>
                                        <th style={s.th(isDark)}>Category</th>
                                        <th style={s.th(isDark)}>Status</th>
                                        <th style={s.th(isDark)}>Assigned</th>
                                        <th style={s.th(isDark)}>By</th>
                                        <th style={{ ...s.th(isDark), width: 40 }} />
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((a) => {
                                        const policy = policies.find((p) => p.id === a.policyId);
                                        if (!policy) return null;
                                        const stColor = statusColors[policy.status];
                                        return (
                                            <tr key={a.id}>
                                                <td style={s.td(isDark)}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <span className="material-icons" style={{
                                                            fontSize: 16, color: categoryColors[policy.category],
                                                        }}>
                                                            {categoryIcons[policy.category]}
                                                        </span>
                                                        <span style={{ fontWeight: 500, fontSize: 13 }}>{a.policyName}</span>
                                                    </div>
                                                </td>
                                                <td style={{ ...s.td(isDark), fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280' }}>
                                                    {categoryLabels[policy.category]}
                                                </td>
                                                <td style={s.td(isDark)}>
                                                    <span style={s.badge(isDark ? stColor.bgDark : stColor.bg, isDark ? stColor.textDark : stColor.text)}>
                                                        {policy.status}
                                                    </span>
                                                </td>
                                                <td style={{ ...s.td(isDark), fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280' }}>
                                                    {formatDate(a.assignedAt)}
                                                </td>
                                                <td style={{ ...s.td(isDark), fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280' }}>
                                                    {a.assignedBy}
                                                </td>
                                                <td style={s.td(isDark)}>
                                                    <button
                                                        style={{
                                                            width: 26, height: 26, display: 'flex',
                                                            alignItems: 'center', justifyContent: 'center',
                                                            borderRadius: 6, border: 'none',
                                                            backgroundColor: 'transparent', cursor: 'pointer',
                                                            color: isDark ? '#6b7280' : '#9ca3af',
                                                            transition: 'all 0.15s',
                                                        }}
                                                        onClick={() => removeAssignment(a.id)}
                                                        onMouseEnter={(e) => {
                                                            e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#fee2e2';
                                                            e.currentTarget.style.color = '#ef4444';
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.style.backgroundColor = 'transparent';
                                                            e.currentTarget.style.color = isDark ? '#6b7280' : '#9ca3af';
                                                        }}
                                                        title="Remove assignment"
                                                    >
                                                        <span className="material-icons" style={{ fontSize: 14 }}>close</span>
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    );
                })
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════
   AUDIT LOG  Sub-Tab
   ═══════════════════════════════════════════════ */
function AuditLogSection() {
    const { isDark } = useTheme();
    const { auditLog } = usePolicies();

    const sorted = [...auditLog].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const actionMeta: Record<string, { icon: string; color: string; label: string }> = {
        created: { icon: 'add_circle', color: '#16a34a', label: 'Created' },
        updated: { icon: 'edit', color: '#3b82f6', label: 'Updated' },
        assigned: { icon: 'link', color: '#8b5cf6', label: 'Assigned' },
        unassigned: { icon: 'link_off', color: '#f59e0b', label: 'Unassigned' },
        enabled: { icon: 'toggle_on', color: '#10b981', label: 'Enabled' },
        disabled: { icon: 'toggle_off', color: '#6b7280', label: 'Disabled' },
    };

    return (
        <div style={s.wrapper}>
            <div>
                <h3 style={s.sectionTitle}>Audit Log</h3>
                <p style={s.sectionSub(isDark)}>
                    Full chronological log of all policy changes — creations, updates, assignments, and status changes.
                </p>
            </div>

            <div style={s.card(isDark)}>
                <div style={s.cardHead(isDark)}>
                    <span style={s.cardTitle}>
                        <span className="material-icons" style={{ fontSize: 16, color: colors.primary }}>receipt_long</span>
                        {sorted.length} Events
                    </span>
                </div>
                <table style={s.table(isDark)}>
                    <thead>
                        <tr>
                            <th style={s.th(isDark)}>Action</th>
                            <th style={s.th(isDark)}>Policy</th>
                            <th style={s.th(isDark)}>Details</th>
                            <th style={s.th(isDark)}>Actor</th>
                            <th style={s.th(isDark)}>Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map((entry) => {
                            const meta = actionMeta[entry.action] || { icon: 'info', color: '#6b7280', label: entry.action };
                            return (
                                <tr key={entry.id}>
                                    <td style={s.td(isDark)}>
                                        <span style={s.badge(
                                            isDark ? meta.color + '20' : meta.color + '15',
                                            meta.color,
                                        )}>
                                            <span className="material-icons" style={{ fontSize: 12 }}>{meta.icon}</span>
                                            {meta.label}
                                        </span>
                                    </td>
                                    <td style={{ ...s.td(isDark), fontWeight: 500, fontSize: 13 }}>
                                        {entry.policyName}
                                    </td>
                                    <td style={{ ...s.td(isDark), fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280', maxWidth: 300 }}>
                                        {entry.details}
                                    </td>
                                    <td style={{ ...s.td(isDark), fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280' }}>
                                        {entry.actor}
                                    </td>
                                    <td style={{ ...s.td(isDark), fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af', whiteSpace: 'nowrap' }}>
                                        {formatDateTime(entry.timestamp)}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════
   MAIN EXPORT
   ═══════════════════════════════════════════════ */
const subTabs: { key: SubTab; label: string; icon: string }[] = [
    { key: 'overview', label: 'Overview', icon: 'dashboard' },
    { key: 'policies', label: 'Policies', icon: 'policy' },
    { key: 'assignments', label: 'Assignments', icon: 'link' },
    { key: 'audit', label: 'Audit Log', icon: 'receipt_long' },
];

export default function PolicySettings() {
    const { isDark } = useTheme();
    const [activeTab, setActiveTab] = useState<SubTab>('overview');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* Sub-tab bar */}
            <div style={s.tabBar(isDark)}>
                {subTabs.map((tab) => (
                    <button
                        key={tab.key}
                        style={s.tab(isDark, activeTab === tab.key)}
                        onClick={() => setActiveTab(tab.key)}
                        onMouseEnter={(e) => {
                            if (activeTab !== tab.key) e.currentTarget.style.color = isDark ? '#d1d5db' : '#1f2937';
                        }}
                        onMouseLeave={(e) => {
                            if (activeTab !== tab.key) e.currentTarget.style.color = isDark ? '#9ca3af' : '#6b7280';
                        }}
                    >
                        <span className="material-icons-outlined" style={{ fontSize: 16 }}>{tab.icon}</span>
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content area */}
            <div style={{ padding: '24px 0' }}>
                {activeTab === 'overview' && <OverviewSection />}
                {activeTab === 'policies' && <PoliciesSection />}
                {activeTab === 'assignments' && <AssignmentsSection />}
                {activeTab === 'audit' && <AuditLogSection />}
            </div>
        </div>
    );
}
