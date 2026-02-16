import { useState, useMemo, type CSSProperties } from 'react';
import { useTheme } from '../context/ThemeContext';
import {
    useAudit,
    domainLabels, domainIcons, domainColors,
    actionLabels, actionColors,
    type AuditDomain, type AuditAction,
} from '../context/AuditContext';
import { colors, shadows, fonts } from '../theme';

/* ─── Helpers ─── */
function formatTimestamp(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
    }) + ' · ' + d.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit',
    });
}

/* ─── Styles ─── */
const pageStyle = (isDark: boolean): CSSProperties => ({
    flex: 1,
    overflow: 'auto',
    padding: '32px 48px',
    fontFamily: fonts.display,
    backgroundColor: isDark ? colors.backgroundDark : colors.backgroundLight,
});

const card = (isDark: boolean): CSSProperties => ({
    backgroundColor: isDark ? colors.surfaceDark : '#ffffff',
    borderRadius: 16,
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    boxShadow: shadows.sm,
    overflow: 'hidden',
});

const filterBar = (isDark: boolean): CSSProperties => ({
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    padding: '16px 20px',
    borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: isDark ? 'rgba(17,24,39,0.5)' : 'rgba(249,250,251,0.8)',
});

const pill = (isDark: boolean, active: boolean, accentColor?: string): CSSProperties => ({
    padding: '6px 14px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    fontFamily: fonts.display,
    cursor: 'pointer',
    border: `1.5px solid ${active ? (accentColor || colors.primary) : isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: active
        ? isDark ? `${accentColor || colors.primary}20` : `${accentColor || colors.primary}10`
        : 'transparent',
    color: active ? (accentColor || colors.primary) : isDark ? '#d1d5db' : '#4b5563',
    transition: 'all 0.15s',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
});

const tableRow = (isDark: boolean, even: boolean): CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: '110px 130px 1fr 2fr 140px 160px',
    alignItems: 'center',
    padding: '14px 20px',
    gap: 12,
    borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: even
        ? isDark ? 'rgba(17,24,39,0.3)' : 'rgba(249,250,251,0.5)'
        : 'transparent',
    fontSize: 13,
    transition: 'background-color 0.1s',
});

const headerRow: CSSProperties = {
    fontWeight: 700,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
};

const badge = (isDark: boolean, bgLight: string, bgDark: string, textLight: string, textDark: string): CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 10px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    backgroundColor: isDark ? bgDark : bgLight,
    color: isDark ? textDark : textLight,
    whiteSpace: 'nowrap',
});

const searchInput = (isDark: boolean): CSSProperties => ({
    padding: '8px 14px',
    borderRadius: 10,
    border: `1.5px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: isDark ? '#111827' : '#ffffff',
    color: isDark ? '#e5e7eb' : '#1f2937',
    fontSize: 13,
    fontFamily: fonts.display,
    outline: 'none',
    width: 240,
    transition: 'border-color 0.15s',
});

/* ─── Governance Banner ─── */
const governanceBanner = (isDark: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '14px 20px',
    borderRadius: 14,
    backgroundColor: isDark ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.05)',
    border: `1px solid ${isDark ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.15)'}`,
    marginBottom: 20,
    fontSize: 13,
    lineHeight: 1.6,
    color: isDark ? '#c4b5fd' : '#6d28d9',
});

/* ─── Component ─── */
export default function AuditLogPage() {
    const { isDark } = useTheme();
    const { entries } = useAudit();

    const [domainFilter, setDomainFilter] = useState<AuditDomain | 'all'>('all');
    const [actionFilter, setActionFilter] = useState<AuditAction | 'all'>('all');
    const [searchQuery, setSearchQuery] = useState('');

    const filteredEntries = useMemo(() => {
        return [...entries]
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .filter((e) => {
                if (domainFilter !== 'all' && e.domain !== domainFilter) return false;
                if (actionFilter !== 'all' && e.action !== actionFilter) return false;
                if (searchQuery) {
                    const q = searchQuery.toLowerCase();
                    return (
                        e.resourceName.toLowerCase().includes(q) ||
                        e.actor.toLowerCase().includes(q) ||
                        e.details.toLowerCase().includes(q)
                    );
                }
                return true;
            });
    }, [entries, domainFilter, actionFilter, searchQuery]);

    // Distinct actions in the data
    const availableActions = useMemo(() => {
        const actions = new Set(entries.map((e) => e.action));
        return Array.from(actions).sort() as AuditAction[];
    }, [entries]);

    // Stats
    const today = new Date().toISOString().split('T')[0];
    const todayCount = entries.filter((e) => e.timestamp.startsWith(today)).length;
    const uniqueActors = new Set(entries.map((e) => e.actor)).size;

    return (
        <div style={pageStyle(isDark)}>
            {/* Page header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
                <div>
                    <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.2 }}>
                        <span className="material-icons" style={{ fontSize: 28, verticalAlign: 'middle', marginRight: 10, color: '#8b5cf6' }}>
                            assignment
                        </span>
                        Audit Log
                    </h1>
                    <p style={{ fontSize: 15, color: isDark ? '#9ca3af' : '#6b7280', marginTop: 6, fontWeight: 400 }}>
                        Complete record of all platform activity — workflows, policies, user actions, and system events.
                    </p>
                </div>
            </div>

            {/* Governance banner */}
            <div style={governanceBanner(isDark)}>
                <span className="material-icons-outlined" style={{ fontSize: 22, opacity: 0.9 }}>verified_user</span>
                <div>
                    <strong>Governance &amp; Compliance</strong> — This audit log is intended for the governance team.
                    Every action taken within the platform is recorded here: <em>who</em> did what,
                    <em> which agents</em> performed actions, and <em>what policies</em> were applied.
                    Only authorized users with governance roles can access this data.
                </div>
            </div>

            {/* Stats row */}
            <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
                {[
                    { icon: 'history', label: 'Total Events', value: entries.length, color: '#3b82f6' },
                    { icon: 'today', label: 'Today', value: todayCount, color: '#10b981' },
                    { icon: 'people', label: 'Unique Actors', value: uniqueActors, color: '#f59e0b' },
                    { icon: 'filter_list', label: 'Filtered', value: filteredEntries.length, color: '#8b5cf6' },
                ].map((stat) => (
                    <div
                        key={stat.label}
                        style={{
                            flex: 1,
                            backgroundColor: isDark ? colors.surfaceDark : '#ffffff',
                            borderRadius: 14,
                            border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                            boxShadow: shadows.sm,
                            padding: '18px 20px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 14,
                        }}
                    >
                        <div style={{
                            width: 40, height: 40, borderRadius: 10,
                            backgroundColor: isDark ? `${stat.color}15` : `${stat.color}10`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <span className="material-icons-outlined" style={{ fontSize: 20, color: stat.color }}>{stat.icon}</span>
                        </div>
                        <div>
                            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{stat.value}</div>
                            <div style={{ fontSize: 11, fontWeight: 500, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{stat.label}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Main table card */}
            <div style={card(isDark)}>
                {/* Filters */}
                <div style={filterBar(isDark)}>
                    {/* Domain pills */}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginRight: 12 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#6b7280' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 4 }}>Domain</span>
                        <button style={pill(isDark, domainFilter === 'all')} onClick={() => setDomainFilter('all')}>All</button>
                        {(['workflow', 'policy', 'system', 'user'] as AuditDomain[]).map((d) => (
                            <button
                                key={d}
                                style={pill(isDark, domainFilter === d, domainColors[d])}
                                onClick={() => setDomainFilter(d)}
                            >
                                <span className="material-icons-outlined" style={{ fontSize: 14 }}>{domainIcons[d]}</span>
                                {domainLabels[d]}
                            </button>
                        ))}
                    </div>

                    {/* Action pills */}
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginRight: 12 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#6b7280' : '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 4 }}>Action</span>
                        <button style={pill(isDark, actionFilter === 'all')} onClick={() => setActionFilter('all')}>All</button>
                        {availableActions.map((a) => (
                            <button key={a} style={pill(isDark, actionFilter === a)} onClick={() => setActionFilter(a)}>
                                {actionLabels[a]}
                            </button>
                        ))}
                    </div>

                    {/* Search */}
                    <div style={{ marginLeft: 'auto' }}>
                        <input
                            style={searchInput(isDark)}
                            placeholder="Search events..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onFocus={(e) => { e.currentTarget.style.borderColor = colors.primary; }}
                            onBlur={(e) => { e.currentTarget.style.borderColor = isDark ? colors.borderDark : colors.borderLight; }}
                        />
                    </div>
                </div>

                {/* Table header */}
                <div style={{ ...tableRow(isDark, false), ...headerRow, color: isDark ? '#6b7280' : '#9ca3af' }}>
                    <div>Domain</div>
                    <div>Action</div>
                    <div>Resource</div>
                    <div>Details</div>
                    <div>Actor</div>
                    <div>Time</div>
                </div>

                {/* Table body */}
                {filteredEntries.length === 0 ? (
                    <div style={{ padding: 40, textAlign: 'center', color: isDark ? '#6b7280' : '#9ca3af' }}>
                        <span className="material-icons" style={{ fontSize: 48, opacity: 0.3, display: 'block', marginBottom: 12 }}>search_off</span>
                        No events match your filters
                    </div>
                ) : (
                    filteredEntries.map((entry, idx) => {
                        const ac = actionColors[entry.action];
                        const dc = domainColors[entry.domain];
                        return (
                            <div
                                key={entry.id}
                                style={tableRow(isDark, idx % 2 === 0)}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isDark ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.03)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = idx % 2 === 0 ? (isDark ? 'rgba(17,24,39,0.3)' : 'rgba(249,250,251,0.5)') : 'transparent'; }}
                            >
                                {/* Domain */}
                                <div>
                                    <span style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 5,
                                        fontSize: 12, fontWeight: 600, color: dc,
                                    }}>
                                        <span className="material-icons-outlined" style={{ fontSize: 15 }}>{domainIcons[entry.domain]}</span>
                                        {domainLabels[entry.domain]}
                                    </span>
                                </div>

                                {/* Action badge */}
                                <div>
                                    <span style={badge(isDark, ac.bg, ac.bgDark, ac.text, ac.textDark)}>
                                        {actionLabels[entry.action]}
                                    </span>
                                </div>

                                {/* Resource */}
                                <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {entry.resourceName}
                                </div>

                                {/* Details */}
                                <div style={{ fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {entry.details}
                                    {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                                        <span style={{ marginLeft: 8 }}>
                                            {Object.entries(entry.metadata).map(([k, v]) => (
                                                <span
                                                    key={k}
                                                    style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: 3,
                                                        padding: '1px 6px', borderRadius: 4, fontSize: 10,
                                                        backgroundColor: isDark ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.06)',
                                                        color: isDark ? '#93c5fd' : '#2563eb',
                                                        marginLeft: 4,
                                                    }}
                                                >
                                                    {k}: {v}
                                                </span>
                                            ))}
                                        </span>
                                    )}
                                </div>

                                {/* Actor */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500 }}>
                                    <div style={{
                                        width: 22, height: 22, borderRadius: '50%',
                                        backgroundColor: isDark ? '#1e3a5f' : '#dbeafe',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 9, fontWeight: 700,
                                        color: isDark ? '#93c5fd' : '#2563eb',
                                    }}>
                                        {entry.actor.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
                                    </div>
                                    {entry.actor}
                                </div>

                                {/* Time */}
                                <div style={{ fontSize: 11, color: isDark ? '#6b7280' : '#9ca3af' }}>
                                    {formatTimestamp(entry.timestamp)}
                                </div>
                            </div>
                        );
                    })
                )}

                {/* Footer */}
                <div style={{
                    padding: '12px 20px',
                    fontSize: 12,
                    color: isDark ? '#6b7280' : '#9ca3af',
                    borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}>
                    <span>Showing {filteredEntries.length} of {entries.length} events</span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>Governance access only</span>
                </div>
            </div>
        </div>
    );
}
