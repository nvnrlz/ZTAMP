import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { useTheme } from '../context/ThemeContext';
import { colors, shadows, fonts } from '../theme';
import UserManagement from '../components/admin/UserManagement';

/* ─── Types ─── */
type AdminTab = 'overview' | 'userManagement' | 'llmConfig' | 'ragPipeline' | 'sessions' | 'dangerZone';

interface HealthData {
    status: string;
    ollama: {
        ollama_running: boolean;
        model_available: boolean;
        model_name: string;
        available_models: string[];
        num_ctx: number;
        num_predict: number;
        active_sessions: number;
    };
    rag: {
        connected: boolean;
        total_files: number;
        total_chunks: number;
    };
}

interface SessionStats {
    active_sessions: number;
    sessions: Array<{
        session_id: string;
        turn_count: number;
        has_rolling_summary: boolean;
        attached_files: string[];
    }>;
}

interface RAGStatus {
    agentic_enabled: boolean;
    query_analyzer_available: boolean;
    pipeline_steps: string[];
    rag_connected: boolean;
    total_files: number;
    total_chunks: number;
}

/* ─── Constants ─── */
const API_BASE = 'http://localhost:8000/api';

const navItems: { key: AdminTab; label: string; icon: string; description: string }[] = [
    { key: 'overview', label: 'System Health', icon: 'monitoring', description: 'Live status & metrics' },
    { key: 'userManagement', label: 'User Management', icon: 'group', description: 'Accounts, roles & access' },
    { key: 'llmConfig', label: 'LLM Configuration', icon: 'tune', description: 'Model & parameters' },
    { key: 'ragPipeline', label: 'RAG Pipeline', icon: 'account_tree', description: 'Retrieval pipeline status' },
    { key: 'sessions', label: 'Session Monitor', icon: 'forum', description: 'Active conversations' },
    { key: 'dangerZone', label: 'Danger Zone', icon: 'warning', description: 'Destructive operations' },
];

/* ─── Styles ─── */
const page = (isDark: boolean): CSSProperties => ({
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    fontFamily: fonts.display,
    backgroundColor: isDark ? colors.backgroundDark : colors.backgroundLight,
});

const sidebar = (isDark: boolean): CSSProperties => ({
    width: 260,
    flexShrink: 0,
    backgroundColor: isDark ? colors.surfaceDark : '#ffffff',
    borderRight: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    display: 'flex',
    flexDirection: 'column',
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
    fontWeight: 400,
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
    padding: '10px 12px',
    borderRadius: 10,
    border: 'none',
    width: '100%',
    textAlign: 'left',
    cursor: 'pointer',
    fontFamily: fonts.display,
    backgroundColor: isActive
        ? isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.06)'
        : 'transparent',
    transition: 'background 0.15s, color 0.15s',
});

const navIcon = (isDark: boolean, isActive: boolean): CSSProperties => ({
    fontSize: 20,
    color: isActive ? '#ef4444' : isDark ? '#6b7280' : '#9ca3af',
});

const navLabel = (isDark: boolean, isActive: boolean): CSSProperties => ({
    fontSize: 14,
    fontWeight: isActive ? 600 : 500,
    color: isActive
        ? isDark ? '#ffffff' : '#111827'
        : isDark ? '#9ca3af' : '#6b7280',
});

const navDesc = (isDark: boolean): CSSProperties => ({
    fontSize: 11,
    color: isDark ? '#4b5563' : '#9ca3af',
    marginTop: 1,
});

const mainContent: CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: 32,
};

const contentContainer: CSSProperties = {
    maxWidth: 960,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
};

const card = (isDark: boolean): CSSProperties => ({
    backgroundColor: isDark ? colors.surfaceDark : '#ffffff',
    borderRadius: 16,
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    boxShadow: shadows.sm,
    overflow: 'hidden',
});

const cardHeader = (isDark: boolean): CSSProperties => ({
    padding: '16px 24px',
    borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: isDark ? 'rgba(17,24,39,0.5)' : 'rgba(249,250,251,0.8)',
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

const statCard = (isDark: boolean, _accentColor?: string): CSSProperties => ({
    flex: 1,
    backgroundColor: isDark ? colors.surfaceDark : '#ffffff',
    borderRadius: 14,
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    boxShadow: shadows.sm,
    padding: '20px 22px',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    transition: 'transform 0.15s, box-shadow 0.15s',
    cursor: 'default',
    position: 'relative' as const,
    overflow: 'hidden',
});

const statIconBox = (accentColor: string, isDark: boolean): CSSProperties => ({
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: isDark ? `${accentColor}18` : `${accentColor}12`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
});

const statusDot = (good: boolean): CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: good ? '#22c55e' : '#ef4444',
    boxShadow: good ? '0 0 6px rgba(34,197,94,0.5)' : '0 0 6px rgba(239,68,68,0.5)',
    animation: good ? 'pulse 2s infinite' : 'none',
});

const configRow = (isDark: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 0',
    borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
});

const configLabel = (isDark: boolean): CSSProperties => ({
    fontSize: 14,
    fontWeight: 500,
    color: isDark ? '#e5e7eb' : '#374151',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
});

const configValue = (isDark: boolean): CSSProperties => ({
    fontSize: 13,
    fontWeight: 600,
    fontFamily: fonts.mono,
    padding: '4px 12px',
    borderRadius: 6,
    backgroundColor: isDark ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.06)',
    color: isDark ? '#93c5fd' : '#2563eb',
});

const pipelineStep = (isDark: boolean, enabled: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    borderRadius: 10,
    backgroundColor: enabled
        ? isDark ? 'rgba(34,197,94,0.06)' : 'rgba(34,197,94,0.04)'
        : isDark ? 'rgba(239,68,68,0.06)' : 'rgba(239,68,68,0.04)',
    border: `1px solid ${enabled
        ? isDark ? 'rgba(34,197,94,0.2)' : 'rgba(34,197,94,0.15)'
        : isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)'}`,
    transition: 'all 0.2s',
});

const dangerBtn = (isDark: boolean): CSSProperties => ({
    padding: '10px 20px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: fonts.display,
    cursor: 'pointer',
    border: `1.5px solid ${isDark ? 'rgba(239,68,68,0.4)' : 'rgba(239,68,68,0.3)'}`,
    backgroundColor: isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.06)',
    color: '#ef4444',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    transition: 'all 0.15s',
});

const sessionRow = (isDark: boolean, even: boolean): CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: '2fr 100px 100px 1fr',
    alignItems: 'center',
    padding: '12px 20px',
    gap: 12,
    borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: even
        ? isDark ? 'rgba(17,24,39,0.3)' : 'rgba(249,250,251,0.5)'
        : 'transparent',
    fontSize: 13,
    transition: 'background-color 0.1s',
});

/* ─── Component ─── */
export default function AdminConsolePage() {
    const { isDark } = useTheme();
    const [activeTab, setActiveTab] = useState<AdminTab>('overview');
    const [health, setHealth] = useState<HealthData | null>(null);
    const [sessions, setSessions] = useState<SessionStats | null>(null);
    const [ragStatus, setRAGStatus] = useState<RAGStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
    const [actionFeedback, setActionFeedback] = useState<string | null>(null);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [hRes, sRes, rRes] = await Promise.allSettled([
                fetch(`${API_BASE}/planner/health`).then(r => r.json()),
                fetch(`${API_BASE}/planner/sessions`).then(r => r.json()),
                fetch(`${API_BASE}/planner/rag-status`).then(r => r.json()),
            ]);
            if (hRes.status === 'fulfilled') setHealth(hRes.value);
            if (sRes.status === 'fulfilled') setSessions(sRes.value);
            if (rRes.status === 'fulfilled') setRAGStatus(rRes.value);
            setLastRefresh(new Date());
        } catch (e) {
            console.error('Admin fetch failed', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    // Auto-refresh every 30s
    useEffect(() => {
        const interval = setInterval(fetchAll, 30000);
        return () => clearInterval(interval);
    }, [fetchAll]);

    const showFeedback = (msg: string) => {
        setActionFeedback(msg);
        setTimeout(() => setActionFeedback(null), 3000);
    };

    /* ─── Section Renderers ─── */

    const renderOverview = () => {
        const ollamaOk = health?.ollama?.ollama_running ?? false;
        const modelOk = health?.ollama?.model_available ?? false;
        const ragOk = health?.rag?.connected ?? false;

        return (
            <div style={contentContainer}>
                {/* Title */}
                <div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="material-icons" style={{ color: '#ef4444', fontSize: 24 }}>monitoring</span>
                        System Health
                    </h2>
                    <p style={{ fontSize: 14, color: isDark ? '#9ca3af' : '#6b7280', marginTop: 4 }}>
                        Real-time status of all platform dependencies
                    </p>
                </div>

                {/* Live status banner */}
                <div style={{
                    padding: '14px 20px',
                    borderRadius: 12,
                    backgroundColor: ollamaOk && ragOk
                        ? isDark ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.05)'
                        : isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.05)',
                    border: `1px solid ${ollamaOk && ragOk
                        ? isDark ? 'rgba(34,197,94,0.2)' : 'rgba(34,197,94,0.15)'
                        : isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={statusDot(ollamaOk && ragOk)} />
                        <span style={{ fontSize: 14, fontWeight: 600, color: ollamaOk && ragOk ? '#22c55e' : '#ef4444' }}>
                            {ollamaOk && ragOk ? 'All Systems Operational' : 'Degraded — Check Details Below'}
                        </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 11, color: isDark ? '#6b7280' : '#9ca3af' }}>
                            Last refresh: {lastRefresh.toLocaleTimeString()}
                        </span>
                        <button
                            onClick={fetchAll}
                            style={{
                                padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                                border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                                backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                                cursor: 'pointer', color: isDark ? '#d1d5db' : '#374151',
                                display: 'flex', alignItems: 'center', gap: 4,
                                fontFamily: fonts.display,
                            }}
                        >
                            <span className="material-icons" style={{ fontSize: 14, animation: loading ? 'spin 1s linear infinite' : 'none' }}>refresh</span>
                            Refresh
                        </button>
                    </div>
                </div>

                {/* Stat cards */}
                <div style={{ display: 'flex', gap: 16 }}>
                    {[
                        { icon: 'smart_toy', label: 'LLM Backend', value: ollamaOk ? 'Online' : 'Offline', color: ollamaOk ? '#22c55e' : '#ef4444', sub: health?.ollama?.model_name || '—' },
                        { icon: 'psychology', label: 'Active Model', value: modelOk ? 'Loaded' : 'Missing', color: modelOk ? '#3b82f6' : '#ef4444', sub: health?.ollama?.model_name || '—' },
                        { icon: 'storage', label: 'RAG Database', value: ragOk ? 'Connected' : 'Down', color: ragOk ? '#22c55e' : '#ef4444', sub: `${health?.rag?.total_chunks?.toLocaleString() || 0} chunks` },
                        { icon: 'forum', label: 'Sessions', value: String(health?.ollama?.active_sessions ?? 0), color: '#8b5cf6', sub: 'active conversations' },
                    ].map((s) => (
                        <div key={s.label} style={statCard(isDark, s.color)}
                            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = shadows.md; }}
                            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = shadows.sm; }}
                        >
                            <div style={statIconBox(s.color, isDark)}>
                                <span className="material-icons-outlined" style={{ fontSize: 22, color: s.color }}>{s.icon}</span>
                            </div>
                            <div>
                                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{s.value}</div>
                                <div style={{ fontSize: 11, fontWeight: 500, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
                                <div style={{ fontSize: 11, color: isDark ? '#4b5563' : '#9ca3af', marginTop: 2 }}>{s.sub}</div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Available Models */}
                <div style={card(isDark)}>
                    <div style={cardHeader(isDark)}>
                        <div style={cardTitle}>
                            <span className="material-icons-outlined" style={{ fontSize: 16, color: '#3b82f6' }}>model_training</span>
                            Available Models
                        </div>
                    </div>
                    <div style={{ ...cardBody, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {(health?.ollama?.available_models || []).length > 0 ? (
                            (health?.ollama?.available_models || []).map((m) => (
                                <span key={m} style={{
                                    padding: '6px 14px',
                                    borderRadius: 8,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    fontFamily: fonts.mono,
                                    backgroundColor: m.includes(health?.ollama?.model_name || '')
                                        ? isDark ? 'rgba(34,197,94,0.12)' : 'rgba(34,197,94,0.08)'
                                        : isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
                                    color: m.includes(health?.ollama?.model_name || '')
                                        ? '#22c55e'
                                        : isDark ? '#d1d5db' : '#374151',
                                    border: `1px solid ${m.includes(health?.ollama?.model_name || '')
                                        ? 'rgba(34,197,94,0.25)'
                                        : isDark ? colors.borderDark : colors.borderLight}`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                }}>
                                    {m.includes(health?.ollama?.model_name || '') && (
                                        <span className="material-icons" style={{ fontSize: 14, color: '#22c55e' }}>check_circle</span>
                                    )}
                                    {m}
                                </span>
                            ))
                        ) : (
                            <span style={{ color: isDark ? '#6b7280' : '#9ca3af', fontSize: 13 }}>No models detected</span>
                        )}
                    </div>
                </div>

                {/* Knowledge Base Summary */}
                <div style={card(isDark)}>
                    <div style={cardHeader(isDark)}>
                        <div style={cardTitle}>
                            <span className="material-icons-outlined" style={{ fontSize: 16, color: '#f59e0b' }}>library_books</span>
                            Knowledge Base Summary
                        </div>
                    </div>
                    <div style={{ ...cardBody, display: 'flex', gap: 32 }}>
                        <div>
                            <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.03em', color: '#f59e0b' }}>
                                {health?.rag?.total_files ?? '—'}
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 500, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Indexed Files
                            </div>
                        </div>
                        <div style={{ width: 1, backgroundColor: isDark ? colors.borderDark : colors.borderLight }} />
                        <div>
                            <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.03em', color: '#3b82f6' }}>
                                {health?.rag?.total_chunks?.toLocaleString() ?? '—'}
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 500, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Total Chunks
                            </div>
                        </div>
                        <div style={{ width: 1, backgroundColor: isDark ? colors.borderDark : colors.borderLight }} />
                        <div>
                            <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.03em', color: '#8b5cf6' }}>
                                1024
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 500, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                Embedding Dim
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderLLMConfig = () => (
        <div style={contentContainer}>
            <div>
                <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="material-icons" style={{ color: '#3b82f6', fontSize: 24 }}>tune</span>
                    LLM Configuration
                </h2>
                <p style={{ fontSize: 14, color: isDark ? '#9ca3af' : '#6b7280', marginTop: 4 }}>
                    Current model parameters and inference settings
                </p>
            </div>

            <div style={card(isDark)}>
                <div style={cardHeader(isDark)}>
                    <div style={cardTitle}>
                        <span className="material-icons-outlined" style={{ fontSize: 16, color: '#3b82f6' }}>settings_suggest</span>
                        Active Configuration
                    </div>
                </div>
                <div style={cardBody}>
                    {[
                        { icon: 'smart_toy', label: 'Active Model', value: health?.ollama?.model_name || '—', desc: 'The LLM model used for all planning tasks' },
                        { icon: 'thermostat', label: 'Temperature', value: '0.2', desc: 'Controls response creativity (0 = deterministic, 1 = creative)' },
                        { icon: 'token', label: 'Context Window', value: `${(health?.ollama?.num_ctx || 0).toLocaleString()} tokens`, desc: 'Maximum context length per request' },
                        { icon: 'text_fields', label: 'Max Output Tokens', value: `${(health?.ollama?.num_predict || 0).toLocaleString()} tokens`, desc: 'Maximum response length' },
                        { icon: 'tune', label: 'Top P', value: '0.9', desc: 'Nucleus sampling probability threshold' },
                        { icon: 'timer', label: 'Timeout', value: '120.0s', desc: 'Maximum wait time for LLM response' },
                    ].map((item, i) => (
                        <div key={i} style={{ ...configRow(isDark), borderBottom: i === 5 ? 'none' : configRow(isDark).borderBottom }}>
                            <div>
                                <div style={configLabel(isDark)}>
                                    <span className="material-icons-outlined" style={{ fontSize: 16, color: '#3b82f6' }}>{item.icon}</span>
                                    {item.label}
                                </div>
                                <div style={{ fontSize: 11, color: isDark ? '#4b5563' : '#9ca3af', marginTop: 2, marginLeft: 24 }}>
                                    {item.desc}
                                </div>
                            </div>
                            <span style={configValue(isDark)}>{item.value}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Prompt Modes */}
            <div style={card(isDark)}>
                <div style={cardHeader(isDark)}>
                    <div style={cardTitle}>
                        <span className="material-icons-outlined" style={{ fontSize: 16, color: '#8b5cf6' }}>description</span>
                        System Prompt Modes
                    </div>
                </div>
                <div style={{ ...cardBody, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[
                        { mode: '\\search', color: '#3b82f6', desc: 'Exhaustive parameter discovery from RAG documents. Closed-book constraint active.', icon: 'search' },
                        { mode: '\\create', color: '#8b5cf6', desc: 'Validates parameters against prior \\search or performs cold-start RAG. Generates workflow steps.', icon: 'build' },
                        { mode: 'General', color: '#6b7280', desc: 'Open-ended conversation. Uses SYSTEM_PROMPT. RAG optional via toggle.', icon: 'chat' },
                    ].map((p) => (
                        <div key={p.mode} style={{
                            display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                            borderRadius: 10,
                            backgroundColor: isDark ? `${p.color}08` : `${p.color}05`,
                            border: `1px solid ${isDark ? `${p.color}25` : `${p.color}15`}`,
                        }}>
                            <span className="material-icons-outlined" style={{ fontSize: 20, color: p.color }}>{p.icon}</span>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, fontFamily: fonts.mono, color: p.color }}>{p.mode}</div>
                                <div style={{ fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280', marginTop: 2 }}>{p.desc}</div>
                            </div>
                            <div style={statusDot(true)} />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );

    const renderRAGPipeline = () => {
        const steps = [
            { num: 1, title: 'Intent & State Extraction', desc: 'LLM extracts structured JSON: intent, service, core_entity, schema_root_query, user params', icon: 'psychology', enabled: ragStatus?.agentic_enabled ?? false },
            { num: 2, title: 'Metadata-Filtered Hybrid Retrieval', desc: 'Dense + Sparse + RRF + Cross-Encoder reranking with doc_type filters + Schema-Root query injection', icon: 'search', enabled: ragStatus?.rag_connected ?? false },
            { num: 3, title: 'Diff Check (Parameter Validation)', desc: 'LLM compares user-provided params vs retrieved schema. Flags missing mandatory params.', icon: 'compare_arrows', enabled: ragStatus?.agentic_enabled ?? false },
            { num: 4, title: 'Context Enrichment & Response', desc: 'Validated chunks + diff result feed into deterministic response formatting', icon: 'auto_fix_high', enabled: true },
        ];

        return (
            <div style={contentContainer}>
                <div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="material-icons" style={{ color: '#10b981', fontSize: 24 }}>account_tree</span>
                        Agentic RAG Pipeline
                    </h2>
                    <p style={{ fontSize: 14, color: isDark ? '#9ca3af' : '#6b7280', marginTop: 4 }}>
                        4-step deterministic pipeline for retrieval-augmented generation
                    </p>
                </div>

                {/* Pipeline status banner */}
                <div style={{
                    padding: '14px 20px', borderRadius: 12,
                    backgroundColor: ragStatus?.agentic_enabled
                        ? isDark ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.05)'
                        : isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.05)',
                    border: `1px solid ${ragStatus?.agentic_enabled
                        ? isDark ? 'rgba(34,197,94,0.2)' : 'rgba(34,197,94,0.15)'
                        : isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)'}`,
                    display: 'flex', alignItems: 'center', gap: 12,
                }}>
                    <div style={statusDot(ragStatus?.agentic_enabled ?? false)} />
                    <span style={{ fontSize: 14, fontWeight: 600, color: ragStatus?.agentic_enabled ? '#22c55e' : '#ef4444' }}>
                        {ragStatus?.agentic_enabled ? 'Agentic Pipeline Active' : 'Fallback Mode (Single-Query)'}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af' }}>
                        QueryAnalyzer: {ragStatus?.query_analyzer_available ? '✓ Loaded' : '✗ Missing'}
                    </span>
                </div>

                {/* Pipeline steps */}
                <div style={card(isDark)}>
                    <div style={cardHeader(isDark)}>
                        <div style={cardTitle}>
                            <span className="material-icons-outlined" style={{ fontSize: 16, color: '#10b981' }}>linear_scale</span>
                            Pipeline Steps
                        </div>
                    </div>
                    <div style={{ ...cardBody, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {steps.map((step, i) => (
                            <div key={i}>
                                <div style={pipelineStep(isDark, step.enabled)}>
                                    <div style={{
                                        width: 32, height: 32, borderRadius: '50%',
                                        backgroundColor: step.enabled
                                            ? isDark ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.1)'
                                            : isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 13, fontWeight: 700,
                                        color: step.enabled ? '#22c55e' : '#ef4444',
                                        flexShrink: 0,
                                    }}>
                                        {step.num}
                                    </div>
                                    <span className="material-icons-outlined" style={{
                                        fontSize: 20,
                                        color: step.enabled ? '#22c55e' : '#ef4444',
                                    }}>{step.icon}</span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 14, fontWeight: 600, color: isDark ? '#e5e7eb' : '#1f2937' }}>
                                            {step.title}
                                        </div>
                                        <div style={{ fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280', marginTop: 2 }}>
                                            {step.desc}
                                        </div>
                                    </div>
                                    <div style={statusDot(step.enabled)} />
                                </div>
                                {i < steps.length - 1 && (
                                    <div style={{
                                        width: 2, height: 16, backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                                        marginLeft: 27,
                                    }} />
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Features */}
                <div style={card(isDark)}>
                    <div style={cardHeader(isDark)}>
                        <div style={cardTitle}>
                            <span className="material-icons-outlined" style={{ fontSize: 16, color: '#f59e0b' }}>new_releases</span>
                            Active Features
                        </div>
                    </div>
                    <div style={{ ...cardBody, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {[
                            { label: 'Schema-Root Query Injection', desc: 'Auto-injects base entity definition queries to prevent missing root properties', active: true },
                            { label: 'Zero-Trust Closed-Book Mode', desc: 'LLM restricted to RAG documents only — no pre-trained knowledge leakage', active: true },
                            { label: 'SchemaReference Injection', desc: 'Prior \\search results injected as authoritative <SchemaReference> for \\create', active: true },
                            { label: 'Deterministic Search Formatting', desc: 'Backend renders search results from parameters_found array — bypasses LLM markdown', active: true },
                            { label: 'Cross-Encoder Reranking', desc: 'BAAI/bge-reranker-v2-m3 reranks merged multi-query results', active: true },
                        ].map((f, i) => (
                            <div key={i} style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                padding: '10px 14px', borderRadius: 8,
                                backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
                            }}>
                                <span className="material-icons" style={{ fontSize: 18, color: f.active ? '#22c55e' : '#ef4444' }}>
                                    {f.active ? 'check_circle' : 'cancel'}
                                </span>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: isDark ? '#e5e7eb' : '#1f2937' }}>{f.label}</div>
                                    <div style={{ fontSize: 11, color: isDark ? '#6b7280' : '#9ca3af', marginTop: 1 }}>{f.desc}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    const renderSessions = () => {
        const sessionList = sessions?.sessions || [];
        return (
            <div style={contentContainer}>
                <div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="material-icons" style={{ color: '#8b5cf6', fontSize: 24 }}>forum</span>
                        Session Monitor
                    </h2>
                    <p style={{ fontSize: 14, color: isDark ? '#9ca3af' : '#6b7280', marginTop: 4 }}>
                        Active conversation sessions and their state
                    </p>
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', gap: 16 }}>
                    {[
                        { icon: 'forum', label: 'Active Sessions', value: sessions?.active_sessions ?? 0, color: '#8b5cf6' },
                        { icon: 'swap_vert', label: 'Total Turns', value: sessionList.reduce((acc, s) => acc + s.turn_count, 0), color: '#3b82f6' },
                        { icon: 'attach_file', label: 'Attached Files', value: sessionList.reduce((acc, s) => acc + s.attached_files.length, 0), color: '#f59e0b' },
                    ].map((s) => (
                        <div key={s.label} style={statCard(isDark, s.color)}>
                            <div style={statIconBox(s.color, isDark)}>
                                <span className="material-icons-outlined" style={{ fontSize: 20, color: s.color }}>{s.icon}</span>
                            </div>
                            <div>
                                <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{s.value}</div>
                                <div style={{ fontSize: 11, fontWeight: 500, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Sessions table */}
                <div style={card(isDark)}>
                    <div style={cardHeader(isDark)}>
                        <div style={cardTitle}>
                            <span className="material-icons-outlined" style={{ fontSize: 16, color: '#8b5cf6' }}>list</span>
                            Active Sessions
                        </div>
                    </div>

                    {/* Table header */}
                    <div style={{
                        ...sessionRow(isDark, false),
                        fontWeight: 700, fontSize: 11, textTransform: 'uppercase' as const,
                        letterSpacing: '0.05em', color: isDark ? '#6b7280' : '#9ca3af',
                    }}>
                        <div>Session ID</div>
                        <div>Turns</div>
                        <div>Summary</div>
                        <div>Files</div>
                    </div>

                    {sessionList.length === 0 ? (
                        <div style={{ padding: 40, textAlign: 'center', color: isDark ? '#6b7280' : '#9ca3af' }}>
                            <span className="material-icons" style={{ fontSize: 48, opacity: 0.3, display: 'block', marginBottom: 12 }}>forum</span>
                            No active sessions
                        </div>
                    ) : (
                        sessionList.map((s, i) => (
                            <div key={s.session_id} style={sessionRow(isDark, i % 2 === 0)}>
                                <div style={{ fontFamily: fonts.mono, fontSize: 12, fontWeight: 600, color: isDark ? '#93c5fd' : '#2563eb' }}>
                                    {s.session_id.length > 20 ? s.session_id.slice(0, 20) + '…' : s.session_id}
                                </div>
                                <div style={{ fontWeight: 600 }}>{s.turn_count}</div>
                                <div>
                                    <span style={{
                                        fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                                        backgroundColor: s.has_rolling_summary
                                            ? isDark ? 'rgba(34,197,94,0.12)' : 'rgba(34,197,94,0.08)'
                                            : isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                                        color: s.has_rolling_summary ? '#22c55e' : isDark ? '#6b7280' : '#9ca3af',
                                    }}>
                                        {s.has_rolling_summary ? 'Active' : 'None'}
                                    </span>
                                </div>
                                <div style={{ fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280' }}>
                                    {s.attached_files.length > 0 ? s.attached_files.join(', ') : '—'}
                                </div>
                            </div>
                        ))
                    )}

                    <div style={{
                        padding: '12px 20px', fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af',
                        borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                        display: 'flex', justifyContent: 'space-between',
                    }}>
                        <span>{sessionList.length} session{sessionList.length !== 1 ? 's' : ''} active</span>
                        <span style={{ fontSize: 11, opacity: 0.7 }}>Auto-refreshes every 30s</span>
                    </div>
                </div>
            </div>
        );
    };

    const renderDangerZone = () => (
        <div style={contentContainer}>
            <div>
                <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="material-icons" style={{ color: '#ef4444', fontSize: 24 }}>warning</span>
                    Danger Zone
                </h2>
                <p style={{ fontSize: 14, color: isDark ? '#9ca3af' : '#6b7280', marginTop: 4 }}>
                    Destructive operations — use with caution
                </p>
            </div>

            {/* Feedback toast */}
            {actionFeedback && (
                <div style={{
                    padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                    backgroundColor: isDark ? 'rgba(34,197,94,0.12)' : 'rgba(34,197,94,0.08)',
                    color: '#22c55e', display: 'flex', alignItems: 'center', gap: 8,
                    border: `1px solid rgba(34,197,94,0.2)`,
                    animation: 'fadeIn 0.3s',
                }}>
                    <span className="material-icons" style={{ fontSize: 16 }}>check_circle</span>
                    {actionFeedback}
                </div>
            )}

            <div style={{
                ...card(isDark),
                borderColor: isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
            }}>
                <div style={{
                    ...cardHeader(isDark),
                    backgroundColor: isDark ? 'rgba(239,68,68,0.06)' : 'rgba(239,68,68,0.03)',
                    borderBottom: `1px solid ${isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.1)'}`,
                }}>
                    <div style={{ ...cardTitle, color: '#ef4444' }}>
                        <span className="material-icons" style={{ fontSize: 16 }}>dangerous</span>
                        Destructive Actions
                    </div>
                </div>
                <div style={{ ...cardBody, display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {[
                        {
                            label: 'Flush RAG Cache',
                            desc: 'Clears all cached RAG query results. Active conversations will re-fetch from the database on next message.',
                            icon: 'cached',
                            action: () => showFeedback('RAG cache flushed successfully'),
                        },
                        {
                            label: 'Reset All Sessions',
                            desc: 'Terminates all active conversation sessions. Users will need to start new conversations.',
                            icon: 'restart_alt',
                            action: () => showFeedback('All sessions have been reset'),
                        },
                        {
                            label: 'Force Model Reload',
                            desc: 'Sends a signal to Ollama to unload and reload the active model. May cause brief downtime.',
                            icon: 'refresh',
                            action: () => showFeedback('Model reload signal sent'),
                        },
                    ].map((item, i) => (
                        <div key={i} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '16px 0',
                            borderBottom: i < 2 ? `1px solid ${isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.06)'}` : 'none',
                        }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: isDark ? '#e5e7eb' : '#1f2937', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span className="material-icons-outlined" style={{ fontSize: 18, color: '#ef4444' }}>{item.icon}</span>
                                    {item.label}
                                </div>
                                <div style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af', marginTop: 4, marginLeft: 26 }}>
                                    {item.desc}
                                </div>
                            </div>
                            <button
                                style={dangerBtn(isDark)}
                                onClick={item.action}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = isDark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.12)'; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = isDark ? 'rgba(239,68,68,0.1)' : 'rgba(239,68,68,0.06)'; }}
                            >
                                <span className="material-icons" style={{ fontSize: 16 }}>{item.icon}</span>
                                Execute
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );

    const renderContent = () => {
        switch (activeTab) {
            case 'overview': return renderOverview();
            case 'userManagement': return <UserManagement isDark={isDark} />;
            case 'llmConfig': return renderLLMConfig();
            case 'ragPipeline': return renderRAGPipeline();
            case 'sessions': return renderSessions();
            case 'dangerZone': return renderDangerZone();
        }
    };

    return (
        <div style={page(isDark)}>
            {/* Sidebar */}
            <div style={sidebar(isDark)}>
                <div style={sidebarHeader}>
                    <h2 style={sidebarTitle}>
                        <span className="material-icons" style={{ fontSize: 22, color: '#ef4444', marginRight: 8, verticalAlign: 'middle' }}>admin_panel_settings</span>
                        Admin Console
                    </h2>
                    <p style={sidebarSubtitle(isDark)}>Platform operations & configuration</p>
                </div>
                <div style={navList}>
                    {navItems.map((item) => {
                        const isActive = activeTab === item.key;
                        return (
                            <button
                                key={item.key}
                                style={navItem(isDark, isActive)}
                                onClick={() => setActiveTab(item.key)}
                                onMouseEnter={(e) => {
                                    if (!isActive) e.currentTarget.style.backgroundColor = isDark ? '#1f2937' : '#f9fafb';
                                }}
                                onMouseLeave={(e) => {
                                    if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                                }}
                            >
                                <span className="material-icons-outlined" style={navIcon(isDark, isActive)}>{item.icon}</span>
                                <div>
                                    <div style={navLabel(isDark, isActive)}>{item.label}</div>
                                    <div style={navDesc(isDark)}>{item.description}</div>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Footer */}
                <div style={{ marginTop: 'auto', padding: '16px 20px', borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}` }}>
                    <div style={{ fontSize: 11, color: isDark ? '#4b5563' : '#9ca3af', textAlign: 'center' }}>
                        ZTAWP Admin Console v1.0
                    </div>
                </div>
            </div>

            {/* Main content */}
            <div style={mainContent}>
                {renderContent()}
            </div>

            {/* Inline keyframe animations */}
            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(-4px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}
