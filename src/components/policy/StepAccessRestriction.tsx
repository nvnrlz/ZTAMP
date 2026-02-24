import { useState, useCallback, type CSSProperties } from 'react';
import {
    type AccessMode,
    type WhitelistEntry,
    type WebsiteScanResult,
    type AccessRestrictionConfig,
    type PolicyTarget,
} from '../../context/PolicyContext';
import { colors, shadows, fonts } from '../../theme';

/* ═══════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════ */

interface StepAccessRestrictionProps {
    config: AccessRestrictionConfig;
    setConfig: (config: AccessRestrictionConfig) => void;
    targets: PolicyTarget[];
    isDark: boolean;
}

/* ═══════════════════════════════════════════════════════
   SIMULATED WEBSITE SCANNER
   In production, this would call the backend /api/scan-website endpoint.
   ═══════════════════════════════════════════════════════ */

const KNOWN_SITES: Record<string, WebsiteScanResult> = {
    'docs.aws.com': {
        hasApi: true, hasMcp: false, requiresAuth: false, isPublic: true,
        detectedMethods: ['scrape', 'api'],
        apiEndpoint: 'https://docs.aws.amazon.com/apiref/',
    },
    'aws.amazon.com': {
        hasApi: true, hasMcp: false, requiresAuth: false, isPublic: true,
        detectedMethods: ['scrape', 'api'],
        apiEndpoint: 'https://docs.aws.amazon.com/apiref/',
    },
    'github.com': {
        hasApi: true, hasMcp: true, requiresAuth: true, isPublic: false,
        detectedMethods: ['api', 'mcp', 'authenticated'],
        apiEndpoint: 'https://api.github.com',
        mcpServer: 'github-mcp-server',
        authType: 'oauth',
    },
    'linkedin.com': {
        hasApi: true, hasMcp: false, requiresAuth: true, isPublic: false,
        detectedMethods: ['api', 'authenticated'],
        apiEndpoint: 'https://api.linkedin.com/v2',
        authType: 'oauth',
    },
    'stackoverflow.com': {
        hasApi: true, hasMcp: false, requiresAuth: false, isPublic: true,
        detectedMethods: ['scrape', 'api'],
        apiEndpoint: 'https://api.stackexchange.com/2.3',
    },
    'notion.so': {
        hasApi: true, hasMcp: true, requiresAuth: true, isPublic: false,
        detectedMethods: ['api', 'mcp', 'authenticated'],
        apiEndpoint: 'https://api.notion.com/v1',
        mcpServer: 'notion-mcp-server',
        authType: 'oauth',
    },
    'slack.com': {
        hasApi: true, hasMcp: true, requiresAuth: true, isPublic: false,
        detectedMethods: ['api', 'mcp', 'authenticated'],
        apiEndpoint: 'https://slack.com/api',
        mcpServer: 'slack-mcp-server',
        authType: 'oauth',
    },
    'jira.atlassian.com': {
        hasApi: true, hasMcp: false, requiresAuth: true, isPublic: false,
        detectedMethods: ['api', 'authenticated'],
        apiEndpoint: 'https://your-domain.atlassian.net/rest/api/3',
        authType: 'api_key',
    },
    'google.com': {
        hasApi: true, hasMcp: false, requiresAuth: false, isPublic: true,
        detectedMethods: ['scrape', 'api'],
        apiEndpoint: 'https://www.googleapis.com',
    },
    'wikipedia.org': {
        hasApi: true, hasMcp: false, requiresAuth: false, isPublic: true,
        detectedMethods: ['scrape', 'api'],
        apiEndpoint: 'https://en.wikipedia.org/w/api.php',
    },
};

function simulateScan(domain: string): Promise<WebsiteScanResult> {
    return new Promise((resolve) => {
        const delay = 800 + Math.random() * 1500;
        setTimeout(() => {
            const normalized = domain.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '').toLowerCase();
            if (KNOWN_SITES[normalized]) {
                resolve(KNOWN_SITES[normalized]);
            } else {
                // Default: assume public scrape-able site
                resolve({
                    hasApi: false,
                    hasMcp: false,
                    requiresAuth: false,
                    isPublic: true,
                    detectedMethods: ['scrape'],
                });
            }
        }, delay);
    });
}

/* ═══════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════ */

const st = {
    container: { maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column' as const, gap: 24 },
    card: (isDark: boolean): CSSProperties => ({
        backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight,
        borderRadius: 16, border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
        boxShadow: shadows.sm, overflow: 'hidden',
    }),
    cardHead: (isDark: boolean): CSSProperties => ({
        padding: '16px 24px', borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }),
    cardTitle: { fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 } as CSSProperties,
    cardBody: { padding: 24 } as CSSProperties,
    label: (isDark: boolean): CSSProperties => ({
        fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
        color: isDark ? '#9ca3af' : '#6b7280', marginBottom: 6, display: 'block',
    }),
    input: (isDark: boolean): CSSProperties => ({
        width: '100%', padding: '10px 14px', borderRadius: 10,
        border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
        backgroundColor: isDark ? '#111827' : '#ffffff',
        color: isDark ? '#e5e7eb' : '#1f2937', fontSize: 14, fontFamily: fonts.display,
        outline: 'none', transition: 'border-color 0.15s', boxSizing: 'border-box',
    }),
    toggle: (enabled: boolean, isDark: boolean): CSSProperties => ({
        width: 44, height: 24, borderRadius: 12, cursor: 'pointer', border: 'none',
        backgroundColor: enabled ? '#3b82f6' : isDark ? '#374151' : '#d1d5db',
        position: 'relative', transition: 'background-color 0.2s', flexShrink: 0,
    }),
    toggleDot: (enabled: boolean): CSSProperties => ({
        width: 18, height: 18, borderRadius: '50%', backgroundColor: '#ffffff',
        position: 'absolute', top: 3, left: enabled ? 23 : 3,
        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    }),
    chip: (isDark: boolean, active: boolean): CSSProperties => ({
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 14px', borderRadius: 10, fontSize: 13, fontWeight: active ? 600 : 500,
        cursor: 'pointer', fontFamily: fonts.display,
        border: `1.5px solid ${active ? colors.primary : isDark ? colors.borderDark : colors.borderLight}`,
        backgroundColor: active ? isDark ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.06)' : 'transparent',
        color: active ? colors.primary : isDark ? '#d1d5db' : '#4b5563',
        transition: 'all 0.15s',
    }),
    primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 22px', backgroundColor: colors.primary, color: '#fff', borderRadius: 10, fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: fonts.display, boxShadow: shadows.blueMd, transition: 'background 0.15s' } as CSSProperties,
};

const accessModeInfo: Record<AccessMode, { icon: string; label: string; color: string; description: string }> = {
    scrape: { icon: 'language', label: 'Open Access / Scrape', color: '#22c55e', description: 'No credentials needed — public data, direct HTML parsing' },
    api: { icon: 'api', label: 'API Access', color: '#3b82f6', description: 'Direct API interface available — structured JSON/REST' },
    mcp: { icon: 'hub', label: 'MCP Access', color: '#8b5cf6', description: 'Model Context Protocol server available — standardized connector' },
    authenticated: { icon: 'lock', label: 'Authenticated Access', color: '#f59e0b', description: 'Requires user-specific credentials or OAuth to access' },
};

/* ═══════════════════════════════════════════════════════
   WEBSITE ENTRY CARD
   ═══════════════════════════════════════════════════════ */

function WhitelistEntryCard({
    entry, onRemove, onSelectMode, isDark,
}: {
    entry: WhitelistEntry;
    onRemove: () => void;
    onSelectMode: (mode: AccessMode) => void;
    isDark: boolean;
}) {
    const isScanning = entry.scanStatus === 'scanning';
    const isComplete = entry.scanStatus === 'complete';

    return (
        <div style={{
            borderRadius: 14, overflow: 'hidden',
            border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
            backgroundColor: isDark ? '#111827' : '#fafafa',
            transition: 'all 0.2s',
        }}>
            {/* Header Row */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
                borderBottom: isComplete ? `1px solid ${isDark ? colors.borderDark : colors.borderLight}` : 'none',
            }}>
                {/* Favicon / Status */}
                <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: isScanning ? isDark ? 'rgba(59,130,246,0.15)' : '#eff6ff'
                        : isComplete ? isDark ? 'rgba(34,197,94,0.12)' : '#f0fdf4'
                            : isDark ? '#1f2937' : '#f3f4f6',
                    flexShrink: 0,
                    animation: isScanning ? 'pulse-glow 1.5s ease-in-out infinite' : 'none',
                }}>
                    <span className="material-icons" style={{
                        fontSize: 18,
                        color: isScanning ? colors.primary : isComplete ? '#22c55e' : isDark ? '#6b7280' : '#9ca3af',
                        animation: isScanning ? 'spin 1.5s linear infinite' : 'none',
                    }}>
                        {isScanning ? 'radar' : isComplete ? 'check_circle' : 'public'}
                    </span>
                </div>

                {/* Domain info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {entry.displayName || entry.domain}
                        {entry.selectedAccessMode && (
                            <span style={{
                                fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
                                backgroundColor: accessModeInfo[entry.selectedAccessMode].color + '18',
                                color: accessModeInfo[entry.selectedAccessMode].color,
                                textTransform: 'uppercase',
                            }}>
                                {accessModeInfo[entry.selectedAccessMode].label}
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af', marginTop: 2 }}>
                        {entry.domain}
                        {isScanning && <span style={{ marginLeft: 8, color: colors.primary }}>⟳ Scanning capabilities...</span>}
                    </div>
                </div>

                {/* Remove button */}
                <button
                    onClick={onRemove}
                    style={{
                        width: 30, height: 30, borderRadius: 8, border: 'none',
                        backgroundColor: 'transparent', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: isDark ? '#6b7280' : '#9ca3af', transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#fee2e2';
                        e.currentTarget.style.color = '#ef4444';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = isDark ? '#6b7280' : '#9ca3af';
                    }}
                >
                    <span className="material-icons" style={{ fontSize: 16 }}>close</span>
                </button>
            </div>

            {/* Scan Results */}
            {isScanning && (
                <div style={{ padding: '14px 18px' }}>
                    <div style={{
                        display: 'flex', gap: 8, alignItems: 'center',
                        padding: '12px 16px', borderRadius: 10,
                        backgroundColor: isDark ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.04)',
                        border: `1px solid ${isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)'}`,
                    }}>
                        <div style={{
                            width: 16, height: 16, borderRadius: '50%',
                            border: '2px solid transparent',
                            borderTopColor: colors.primary,
                            animation: 'spin 0.8s linear infinite',
                        }} />
                        <span style={{ fontSize: 13, color: isDark ? '#93c5fd' : '#2563eb' }}>
                            Analyzing website capabilities... Checking API, MCP, and auth requirements
                        </span>
                    </div>
                </div>
            )}

            {isComplete && entry.scanResult && (
                <div style={{ padding: '14px 18px' }}>
                    {/* Capability Detection */}
                    <div style={{
                        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                        color: isDark ? '#4b5563' : '#9ca3af', marginBottom: 10,
                    }}>
                        Detected Capabilities
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                        {[
                            { key: 'isPublic', label: 'Public', icon: 'public', ok: entry.scanResult.isPublic },
                            { key: 'hasApi', label: 'API', icon: 'api', ok: entry.scanResult.hasApi },
                            { key: 'hasMcp', label: 'MCP', icon: 'hub', ok: entry.scanResult.hasMcp },
                            { key: 'requiresAuth', label: 'Auth Required', icon: 'lock', ok: entry.scanResult.requiresAuth },
                        ].map((cap) => (
                            <span key={cap.key} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                                backgroundColor: cap.ok
                                    ? isDark ? 'rgba(34,197,94,0.1)' : '#f0fdf4'
                                    : isDark ? '#1f2937' : '#f9fafb',
                                color: cap.ok
                                    ? isDark ? '#86efac' : '#16a34a'
                                    : isDark ? '#4b5563' : '#d1d5db',
                                border: `1px solid ${cap.ok
                                    ? isDark ? 'rgba(34,197,94,0.2)' : '#bbf7d0'
                                    : isDark ? '#1f2937' : '#f3f4f6'}`,
                            }}>
                                <span className="material-icons" style={{ fontSize: 13 }}>
                                    {cap.ok ? cap.icon : 'remove'}
                                </span>
                                {cap.label}
                            </span>
                        ))}
                    </div>

                    {/* Details line */}
                    {entry.scanResult.apiEndpoint && (
                        <div style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af', marginBottom: 4, display: 'flex', gap: 4, alignItems: 'center' }}>
                            <span className="material-icons" style={{ fontSize: 13 }}>link</span>
                            API: <code style={{ fontSize: 11, backgroundColor: isDark ? '#1f2937' : '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>{entry.scanResult.apiEndpoint}</code>
                        </div>
                    )}
                    {entry.scanResult.mcpServer && (
                        <div style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af', marginBottom: 4, display: 'flex', gap: 4, alignItems: 'center' }}>
                            <span className="material-icons" style={{ fontSize: 13 }}>hub</span>
                            MCP Server: <code style={{ fontSize: 11, backgroundColor: isDark ? '#1f2937' : '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>{entry.scanResult.mcpServer}</code>
                        </div>
                    )}
                    {entry.scanResult.authType && (
                        <div style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af', marginBottom: 10, display: 'flex', gap: 4, alignItems: 'center' }}>
                            <span className="material-icons" style={{ fontSize: 13 }}>vpn_key</span>
                            Auth: <code style={{ fontSize: 11, backgroundColor: isDark ? '#1f2937' : '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>{entry.scanResult.authType.toUpperCase()}</code>
                        </div>
                    )}

                    {/* Access Mode Selection */}
                    <div style={{
                        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                        color: isDark ? '#4b5563' : '#9ca3af', marginBottom: 8, marginTop: 12,
                    }}>
                        Select Access Type
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                        {entry.scanResult.detectedMethods.map((mode) => {
                            const info = accessModeInfo[mode];
                            const isSelected = entry.selectedAccessMode === mode;
                            return (
                                <div
                                    key={mode}
                                    onClick={() => onSelectMode(mode)}
                                    style={{
                                        padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                                        border: `2px solid ${isSelected ? info.color : isDark ? colors.borderDark : colors.borderLight}`,
                                        backgroundColor: isSelected
                                            ? `${info.color}08`
                                            : 'transparent',
                                        transition: 'all 0.2s',
                                        display: 'flex', alignItems: 'center', gap: 10,
                                    }}
                                >
                                    <span className="material-icons" style={{
                                        fontSize: 20, color: isSelected ? info.color : isDark ? '#6b7280' : '#9ca3af',
                                    }}>
                                        {info.icon}
                                    </span>
                                    <div>
                                        <div style={{ fontSize: 13, fontWeight: isSelected ? 600 : 500, color: isSelected ? info.color : undefined }}>
                                            {info.label}
                                        </div>
                                        <div style={{ fontSize: 11, color: isDark ? '#6b7280' : '#9ca3af', lineHeight: 1.3, marginTop: 2 }}>
                                            {info.description}
                                        </div>
                                    </div>
                                    {isSelected && (
                                        <span className="material-icons" style={{ fontSize: 18, color: info.color, marginLeft: 'auto' }}>
                                            check_circle
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════ */

export default function StepAccessRestriction({ config, setConfig, targets, isDark }: StepAccessRestrictionProps) {
    const [newDomain, setNewDomain] = useState('');
    const [isAddingUrl, setIsAddingUrl] = useState(false);

    const targetIcons: Record<PolicyTarget, string> = { user: 'person', agent: 'smart_toy', team: 'group', group: 'groups', role: 'badge' };

    const addWebsite = useCallback(async () => {
        if (!newDomain.trim()) return;
        setIsAddingUrl(true);

        const domain = newDomain.trim().replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '');
        const entryId = `wl-${Date.now()}`;
        const newEntry: WhitelistEntry = {
            id: entryId,
            domain,
            displayName: domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1),
            scanResult: null,
            scanStatus: 'scanning',
            selectedAccessMode: null,
            addedAt: new Date().toISOString(),
            notes: '',
        };

        setConfig({
            ...config,
            whitelistedSites: [...config.whitelistedSites, newEntry],
        });
        setNewDomain('');
        setIsAddingUrl(false);

        // Simulate scanning
        const result = await simulateScan(domain);
        setConfig({
            ...config,
            whitelistedSites: [...config.whitelistedSites.filter(e => e.id !== entryId), {
                ...newEntry,
                scanResult: result,
                scanStatus: 'complete' as const,
            }].sort((a, b) => a.addedAt.localeCompare(b.addedAt)),
        });
    }, [newDomain, config, setConfig]);

    const removeEntry = useCallback((id: string) => {
        setConfig({
            ...config,
            whitelistedSites: config.whitelistedSites.filter(e => e.id !== id),
        });
    }, [config, setConfig]);

    const selectMode = useCallback((id: string, mode: AccessMode) => {
        setConfig({
            ...config,
            whitelistedSites: config.whitelistedSites.map(e =>
                e.id === id ? { ...e, selectedAccessMode: mode } : e
            ),
        });
    }, [config, setConfig]);

    const pendingSites = config.whitelistedSites.filter(e => e.scanStatus === 'complete' && !e.selectedAccessMode);
    const configuredSites = config.whitelistedSites.filter(e => e.selectedAccessMode !== null);

    return (
        <div style={st.container}>
            {/* CSS Animations */}
            <style>{`
                @keyframes pulse-glow {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0.3); }
                    50% { box-shadow: 0 0 0 8px rgba(59,130,246,0); }
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                @keyframes slide-in {
                    from { opacity: 0; transform: translateY(8px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>

            {/* Context Banner */}
            <div style={{
                display: 'flex', gap: 12, padding: 16, borderRadius: 12,
                backgroundColor: isDark ? 'rgba(139,92,246,0.08)' : '#f5f3ff',
                border: `1px solid ${isDark ? 'rgba(139,92,246,0.2)' : '#ddd6fe'}`,
                fontSize: 13, color: isDark ? '#c4b5fd' : '#5b21b6', lineHeight: 1.5,
            }}>
                <span className="material-icons" style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>shield</span>
                <div>
                    <strong>Access Restriction Policy</strong> — Configure which websites the <strong>Planner Agent</strong> can access.
                    Only the Planner Agent has internet access; all other agents are air-gapped.
                    Add websites to the whitelist below and select the preferred access method.
                </div>
            </div>

            {/* Policy Inheritance Info */}
            {targets.length > 0 && (
                <div style={{
                    display: 'flex', gap: 12, padding: 14, borderRadius: 12,
                    backgroundColor: isDark ? 'rgba(16,185,129,0.06)' : '#f0fdf4',
                    border: `1px solid ${isDark ? 'rgba(16,185,129,0.15)' : '#bbf7d0'}`,
                    fontSize: 13, color: isDark ? '#6ee7b7' : '#065f46', lineHeight: 1.5,
                }}>
                    <span className="material-icons" style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>account_tree</span>
                    <div>
                        <strong>Policy Inheritance:</strong> This policy targets
                        {' '}{targets.map(t => (
                            <span key={t} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 3,
                                padding: '1px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                                backgroundColor: isDark ? 'rgba(16,185,129,0.1)' : '#dcfce7',
                                margin: '0 2px',
                            }}>
                                <span className="material-icons" style={{ fontSize: 12 }}>{targetIcons[t]}</span>
                                {t.charAt(0).toUpperCase() + t.slice(1)}
                            </span>
                        ))}.
                        {targets.includes('group') && (
                            <span> All users within the group will <strong>inherit</strong> these restrictions.</span>
                        )}
                        {targets.includes('user') && (
                            <span> The agent will adapt based on each user's <strong>specific credentials and session</strong>.</span>
                        )}
                    </div>
                </div>
            )}

            {/* URL Whitelist Section */}
            <div style={st.card(isDark)}>
                <div style={st.cardHead(isDark)}>
                    <span style={st.cardTitle}>
                        <span className="material-icons" style={{ fontSize: 16, color: '#8b5cf6' }}>playlist_add_check</span>
                        URL Whitelist
                    </span>
                    <span style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af' }}>
                        {config.whitelistedSites.length} site{config.whitelistedSites.length !== 1 ? 's' : ''} added
                        {pendingSites.length > 0 && (
                            <span style={{ color: '#f59e0b', fontWeight: 600, marginLeft: 6 }}>
                                · {pendingSites.length} pending selection
                            </span>
                        )}
                    </span>
                </div>
                <div style={{ ...st.cardBody, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {/* Add URL form */}
                    <div style={{ display: 'flex', gap: 10 }}>
                        <div style={{ flex: 1, position: 'relative' }}>
                            <span className="material-icons" style={{
                                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                                fontSize: 18, color: isDark ? '#4b5563' : '#9ca3af',
                            }}>link</span>
                            <input
                                style={{ ...st.input(isDark), paddingLeft: 38 }}
                                placeholder="Enter domain (e.g. github.com, docs.aws.com)"
                                value={newDomain}
                                onChange={(e) => setNewDomain(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') addWebsite(); }}
                                onFocus={(e) => { e.currentTarget.style.borderColor = colors.primary; }}
                                onBlur={(e) => { e.currentTarget.style.borderColor = isDark ? colors.borderDark : colors.borderLight; }}
                            />
                        </div>
                        <button
                            style={{ ...st.primaryBtn, opacity: newDomain.trim() ? 1 : 0.5, pointerEvents: newDomain.trim() ? 'auto' : 'none' }}
                            onClick={addWebsite}
                            disabled={!newDomain.trim() || isAddingUrl}
                        >
                            <span className="material-icons" style={{ fontSize: 16 }}>add</span>
                            Add & Scan
                        </button>
                    </div>

                    {/* Quick-add suggestions */}
                    {config.whitelistedSites.length === 0 && (
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#4b5563' : '#9ca3af', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Quick Add
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {['docs.aws.com', 'github.com', 'stackoverflow.com', 'notion.so', 'wikipedia.org'].map((domain) => (
                                    <button
                                        key={domain}
                                        onClick={() => { setNewDomain(domain); }}
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                            padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                                            border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                                            backgroundColor: 'transparent', cursor: 'pointer',
                                            color: isDark ? '#d1d5db' : '#4b5563', fontFamily: fonts.display,
                                            transition: 'all 0.15s',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.borderColor = colors.primary;
                                            e.currentTarget.style.color = colors.primary;
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.borderColor = isDark ? colors.borderDark : colors.borderLight;
                                            e.currentTarget.style.color = isDark ? '#d1d5db' : '#4b5563';
                                        }}
                                    >
                                        <span className="material-icons" style={{ fontSize: 13 }}>add</span>
                                        {domain}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Whitelist entries */}
                    {config.whitelistedSites.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {config.whitelistedSites.map((entry) => (
                                <div key={entry.id} style={{ animation: 'slide-in 0.3s ease-out' }}>
                                    <WhitelistEntryCard
                                        entry={entry}
                                        onRemove={() => removeEntry(entry.id)}
                                        onSelectMode={(mode) => selectMode(entry.id, mode)}
                                        isDark={isDark}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Summary Stats */}
            {config.whitelistedSites.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                    {[
                        { icon: 'playlist_add_check', label: 'Whitelisted', value: config.whitelistedSites.length, color: '#8b5cf6' },
                        { icon: 'check_circle', label: 'Configured', value: configuredSites.length, color: '#22c55e' },
                        { icon: 'pending', label: 'Pending', value: pendingSites.length, color: '#f59e0b' },
                        { icon: 'lock', label: 'Auth Required', value: config.whitelistedSites.filter(e => e.scanResult?.requiresAuth).length, color: '#ef4444' },
                    ].map((s) => (
                        <div key={s.label} style={{
                            ...st.card(isDark), padding: 16,
                            display: 'flex', flexDirection: 'column', gap: 6,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span className="material-icons" style={{ fontSize: 16, color: s.color }}>{s.icon}</span>
                                <span style={{ fontSize: 11, fontWeight: 500, color: isDark ? '#9ca3af' : '#6b7280' }}>{s.label}</span>
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 700 }}>{s.value}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Advanced Settings */}
            <div style={st.card(isDark)}>
                <div style={st.cardHead(isDark)}>
                    <span style={st.cardTitle}>
                        <span className="material-icons" style={{ fontSize: 16, color: colors.primary }}>tune</span>
                        Advanced Access Controls
                    </span>
                    <span style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af' }}>Future-Ready</span>
                </div>
                <div style={{ ...st.cardBody, display: 'flex', flexDirection: 'column', gap: 18 }}>
                    {/* Time-Based Access */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 12,
                        backgroundColor: config.enableTimeBasedAccess
                            ? isDark ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.03)'
                            : isDark ? '#111827' : '#fafafa',
                        border: `1px solid ${config.enableTimeBasedAccess
                            ? isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)'
                            : isDark ? '#1f2937' : '#f3f4f6'}`,
                        transition: 'all 0.15s',
                    }}>
                        <span className="material-icons" style={{
                            fontSize: 20,
                            color: config.enableTimeBasedAccess ? '#f59e0b' : isDark ? '#4b5563' : '#9ca3af',
                        }}>schedule</span>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 500 }}>Time-Based Access Windows</div>
                            <div style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af', marginTop: 1 }}>
                                Restrict agent internet access to specific hours of the day
                            </div>
                        </div>
                        <button style={st.toggle(config.enableTimeBasedAccess, isDark)}
                            onClick={() => setConfig({ ...config, enableTimeBasedAccess: !config.enableTimeBasedAccess })}>
                            <div style={st.toggleDot(config.enableTimeBasedAccess)} />
                        </button>
                    </div>

                    {config.enableTimeBasedAccess && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, paddingLeft: 50 }}>
                            <div>
                                <label style={st.label(isDark)}>Start Time</label>
                                <input type="time" style={st.input(isDark)} value={config.timeWindowStart || '09:00'}
                                    onChange={(e) => setConfig({ ...config, timeWindowStart: e.target.value })} />
                            </div>
                            <div>
                                <label style={st.label(isDark)}>End Time</label>
                                <input type="time" style={st.input(isDark)} value={config.timeWindowEnd || '18:00'}
                                    onChange={(e) => setConfig({ ...config, timeWindowEnd: e.target.value })} />
                            </div>
                            <div>
                                <label style={st.label(isDark)}>Timezone</label>
                                <select style={st.input(isDark)} value={config.timeZone || 'UTC'}
                                    onChange={(e) => setConfig({ ...config, timeZone: e.target.value })}>
                                    <option value="UTC">UTC</option>
                                    <option value="America/New_York">Eastern (ET)</option>
                                    <option value="America/Chicago">Central (CT)</option>
                                    <option value="America/Denver">Mountain (MT)</option>
                                    <option value="America/Los_Angeles">Pacific (PT)</option>
                                    <option value="Europe/London">GMT</option>
                                    <option value="Asia/Tokyo">JST</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {/* Data Egress Limits */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 12,
                        backgroundColor: config.enableDataEgressLimits
                            ? isDark ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.03)'
                            : isDark ? '#111827' : '#fafafa',
                        border: `1px solid ${config.enableDataEgressLimits
                            ? isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)'
                            : isDark ? '#1f2937' : '#f3f4f6'}`,
                        transition: 'all 0.15s',
                    }}>
                        <span className="material-icons" style={{
                            fontSize: 20,
                            color: config.enableDataEgressLimits ? '#ef4444' : isDark ? '#4b5563' : '#9ca3af',
                        }}>cloud_upload</span>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 500 }}>Data Egress Limits</div>
                            <div style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af', marginTop: 1 }}>
                                Limit the amount of data the agent can retrieve/send per day
                            </div>
                        </div>
                        <button style={st.toggle(config.enableDataEgressLimits, isDark)}
                            onClick={() => setConfig({ ...config, enableDataEgressLimits: !config.enableDataEgressLimits })}>
                            <div style={st.toggleDot(config.enableDataEgressLimits)} />
                        </button>
                    </div>

                    {config.enableDataEgressLimits && (
                        <div style={{ paddingLeft: 50 }}>
                            <label style={st.label(isDark)}>Max Egress (MB/day)</label>
                            <input type="number" style={{ ...st.input(isDark), maxWidth: 200 }}
                                value={config.maxEgressMbPerDay || 500}
                                onChange={(e) => setConfig({ ...config, maxEgressMbPerDay: parseInt(e.target.value) || 500 })} />
                        </div>
                    )}

                    {/* Session Binding */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 12,
                        backgroundColor: config.enableSessionBinding
                            ? isDark ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.03)'
                            : isDark ? '#111827' : '#fafafa',
                        border: `1px solid ${config.enableSessionBinding
                            ? isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)'
                            : isDark ? '#1f2937' : '#f3f4f6'}`,
                        transition: 'all 0.15s',
                    }}>
                        <span className="material-icons" style={{
                            fontSize: 20,
                            color: config.enableSessionBinding ? '#8b5cf6' : isDark ? '#4b5563' : '#9ca3af',
                        }}>fingerprint</span>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 500 }}>User Session Binding</div>
                            <div style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af', marginTop: 1 }}>
                                Bind agent internet access to the active user's session and credentials
                            </div>
                        </div>
                        <button style={st.toggle(config.enableSessionBinding, isDark)}
                            onClick={() => setConfig({ ...config, enableSessionBinding: !config.enableSessionBinding })}>
                            <div style={st.toggleDot(config.enableSessionBinding)} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Future Use Cases Info */}
            <div style={{
                display: 'flex', gap: 12, padding: 16, borderRadius: 12,
                backgroundColor: isDark ? 'rgba(59,130,246,0.06)' : '#eff6ff',
                border: `1px solid ${isDark ? 'rgba(59,130,246,0.15)' : '#bfdbfe'}`,
                fontSize: 13, color: isDark ? '#93c5fd' : '#1e40af', lineHeight: 1.5,
            }}>
                <span className="material-icons" style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>lightbulb</span>
                <div>
                    <strong>Schema Flexibility:</strong> This Access Control schema supports future extensions:
                    <strong> Data Egress Limits</strong> (cap outbound data volume),
                    <strong> Time-Based Access</strong> (restrict to business hours), and
                    <strong> Session Binding</strong> (per-user credential isolation).
                    Toggle any above to configure.
                </div>
            </div>
        </div>
    );
}
