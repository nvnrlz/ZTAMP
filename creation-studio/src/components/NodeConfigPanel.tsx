import type { CSSProperties } from 'react';
import { useTheme } from '../context/ThemeContext';
import {
    useWorkflow,
    type NodeConfig,
    type ConditionRule,
    type ContextBlockConfig,
    type ConditionalBlockConfig,
    type ResultBlockConfig,
    type NotificationBlockConfig,
    type CodeBlockConfig,
    type ParameterBlockConfig,
    type RetryPolicy,
} from '../context/WorkflowContext';
import { colors, shadows, fonts } from '../theme';

/* ─── Node type → friendly labels & icons ─── */
const NODE_TYPE_META: Record<string, { label: string; icon: string; color: string }> = {
    actionNode: { label: 'Context Block', icon: 'search', color: colors.nodeBlue },
    conditionalNode: { label: 'Conditional', icon: 'call_split', color: colors.nodeYellow },
    resultNode: { label: 'Result Block', icon: 'description', color: colors.nodeGreen },
    notifyNode: { label: 'Notification', icon: 'notifications', color: colors.nodePurple },
    codeNode: { label: 'Code Block', icon: 'terminal', color: colors.nodeGrey },
    paramNode: { label: 'Parameter', icon: 'tune', color: colors.nodeOrange },
    selectedNode: { label: 'Python Logic', icon: 'code', color: colors.primary },
};

const OPERATOR_OPTIONS = ['>', '<', '>=', '<=', '==', '!=', 'contains', 'starts_with'];
const FORMAT_OPTIONS = ['Excel', 'JSON', 'PDF', 'CSV'];
const SERVICE_OPTIONS = ['Slack', 'Email', 'PagerDuty', 'Webhook'];
const LIBRARY_OPTIONS = ['pandas', 'numpy', 'scipy', 'requests', 'beautifulsoup4', 'openpyxl', 'xlsxwriter', 'matplotlib', 'seaborn', 'scikit-learn'];

/* ══════════════════════════════════════════════
   Shared Styles
   ══════════════════════════════════════════════ */

const panel = (isDark: boolean): CSSProperties => ({
    width: 520,
    display: 'flex',
    flexDirection: 'column',
    borderLeft: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight,
    flexShrink: 0,
    boxShadow: shadows.overlay,
    zIndex: 15,
    animation: 'slideInRight 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
    fontFamily: fonts.display,
    overflow: 'hidden',
});

const panelHeader = (isDark: boolean): CSSProperties => ({
    padding: '20px 24px',
    borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
});

const panelTitle: CSSProperties = {
    fontWeight: 600,
    fontSize: 16,
    letterSpacing: '-0.01em',
};

const closeBtn = (isDark: boolean): CSSProperties => ({
    width: 28,
    height: 28,
    borderRadius: 6,
    border: 'none',
    background: isDark ? '#374151' : '#f3f4f6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: isDark ? '#d1d5db' : '#6b7280',
    transition: 'background 0.15s',
});

const typeBadge = (bgColor: string): CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    color: '#ffffff',
    backgroundColor: bgColor,
    padding: '3px 10px',
    borderRadius: 6,
    marginLeft: 10,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
});

const body: CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
};

const sectionLabel = (isDark: boolean): CSSProperties => ({
    display: 'block',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: isDark ? colors.textMutedLight : colors.textMuted,
    marginBottom: 8,
});

const sectionDivider = (isDark: boolean): CSSProperties => ({
    borderTop: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
    margin: '4px 0',
});

const inputStyle = (isDark: boolean): CSSProperties => ({
    width: '100%',
    padding: 12,
    backgroundColor: isDark ? '#111827' : '#ffffff',
    border: `1px solid ${isDark ? '#374151' : '#d1d5db'}`,
    borderRadius: 12,
    fontSize: 14,
    color: isDark ? '#d1d5db' : '#374151',
    boxShadow: shadows.sm,
    outline: 'none',
    fontFamily: fonts.display,
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
});

const textareaStyle = (isDark: boolean): CSSProperties => ({
    ...inputStyle(isDark),
    minHeight: 80,
    lineHeight: 1.6,
    resize: 'vertical',
});

const selectStyle = (isDark: boolean): CSSProperties => ({
    ...inputStyle(isDark),
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%236b7280' stroke-width='1.5' fill='none'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
    paddingRight: 36,
});

const editorWrap = (isDark: boolean): CSSProperties => ({
    width: '100%',
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    overflow: 'hidden',
    border: `1px solid ${isDark ? '#374151' : '#4b5563'}`,
    boxShadow: shadows.lg,
    display: 'flex',
    flexDirection: 'column',
});

const editorBar: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 16px',
    backgroundColor: '#2d2d2d',
    borderBottom: '1px solid #374151',
    gap: 8,
    flexShrink: 0,
};

const dot = (color: string): CSSProperties => ({
    width: 10, height: 10, borderRadius: '50%', backgroundColor: color,
});

const fileNameStyle: CSSProperties = {
    marginLeft: 'auto', fontSize: 11, color: '#9ca3af', fontFamily: fonts.mono,
};

const codeTextarea: CSSProperties = {
    flex: 1, padding: 16, fontSize: 12, fontFamily: fonts.mono,
    color: '#d1d5db', backgroundColor: 'transparent',
    border: 'none', outline: 'none', resize: 'none',
    lineHeight: 1.6, minHeight: 180, width: '100%', boxSizing: 'border-box',
};

const schemaGrid: CSSProperties = {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
};

const schemaCard = (isDark: boolean): CSSProperties => ({
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    borderRadius: 12, backgroundColor: isDark ? '#111827' : '#ffffff',
    overflow: 'hidden', boxShadow: shadows.sm,
});

const schemaCardHeader = (isDark: boolean): CSSProperties => ({
    padding: '8px 12px',
    backgroundColor: isDark ? '#1f2937' : '#f9fafb',
    borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
});

const schemaTitle = (isDark: boolean): CSSProperties => ({
    fontSize: 11, fontWeight: 600, color: isDark ? '#d1d5db' : '#4b5563',
});

const schemaBadge = (isDark: boolean): CSSProperties => ({
    fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em',
    color: isDark ? '#9ca3af' : '#9ca3af',
    backgroundColor: isDark ? '#374151' : '#f3f4f6',
    padding: '2px 6px', borderRadius: 4,
});

const schemaTextarea = (color: string): CSSProperties => ({
    padding: 12, fontFamily: fonts.mono, fontSize: 12, color,
    border: 'none', outline: 'none', backgroundColor: 'transparent',
    width: '100%', minHeight: 48, resize: 'vertical', boxSizing: 'border-box',
});

const settingsContainer = (isDark: boolean): CSSProperties => ({
    backgroundColor: isDark ? 'rgba(17,24,39,0.5)' : '#f9fafb',
    borderRadius: 12, padding: 12,
    border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    display: 'flex', flexDirection: 'column', gap: 12,
});

const settingsRow: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
};

const settingsLabel = (isDark: boolean): CSSProperties => ({
    fontSize: 14, fontWeight: 500, color: isDark ? '#d1d5db' : '#374151',
});

const numInput = (isDark: boolean): CSSProperties => ({
    width: 80, height: 32, textAlign: 'right', fontSize: 14,
    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
    backgroundColor: isDark ? '#1f2937' : '#ffffff',
    borderRadius: 8, color: isDark ? '#ffffff' : '#1f2937',
    outline: 'none', paddingRight: 8, fontFamily: fonts.display,
});

const toggleTrack = (on: boolean, isDark: boolean): CSSProperties => ({
    width: 44, height: 24, borderRadius: 9999,
    backgroundColor: on ? colors.primary : isDark ? '#4b5563' : '#d1d5db',
    position: 'relative', cursor: 'pointer', transition: 'background-color 0.3s',
    border: 'none', padding: 0,
});

const toggleThumb = (on: boolean): CSSProperties => ({
    width: 20, height: 20, borderRadius: '50%',
    backgroundColor: '#ffffff', position: 'absolute',
    top: 2, left: on ? 22 : 2, transition: 'left 0.3s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
});

const footer = (isDark: boolean): CSSProperties => ({
    padding: 24,
    borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: isDark ? '#111827' : '#f9fafb',
    display: 'flex', gap: 12,
});

const saveBtn: CSSProperties = {
    flex: 1, padding: '10px 16px', backgroundColor: colors.primary,
    color: '#ffffff', borderRadius: 12, fontSize: 14, fontWeight: 600,
    border: 'none', cursor: 'pointer', boxShadow: shadows.blueMd,
    transition: 'box-shadow 0.2s, background-color 0.15s', fontFamily: fonts.display,
};

const deleteBtnStyle = (isDark: boolean): CSSProperties => ({
    padding: '10px 16px',
    backgroundColor: isDark ? '#7f1d1d' : '#fee2e2',
    border: `1px solid ${isDark ? '#991b1b' : '#fca5a5'}`,
    color: isDark ? '#fca5a5' : '#dc2626',
    borderRadius: 12, fontSize: 14, fontWeight: 600,
    cursor: 'pointer', boxShadow: shadows.sm,
    transition: 'background-color 0.15s', fontFamily: fonts.display,
    display: 'flex', alignItems: 'center', gap: 6,
});

const testBtn = (isDark: boolean): CSSProperties => ({
    padding: '10px 24px',
    backgroundColor: isDark ? '#1f2937' : '#ffffff',
    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
    color: isDark ? '#d1d5db' : '#374151',
    borderRadius: 12, fontSize: 14, fontWeight: 600,
    cursor: 'pointer', boxShadow: shadows.sm,
    transition: 'background-color 0.15s', fontFamily: fonts.display,
});

/* ─── Rule builder row style ─── */
const ruleRow = (isDark: boolean): CSSProperties => ({
    display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8,
    padding: 10, borderRadius: 10,
    backgroundColor: isDark ? '#111827' : '#f9fafb',
    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
});

const ruleInput = (isDark: boolean, width: number): CSSProperties => ({
    width, padding: '6px 8px', fontSize: 12, borderRadius: 8,
    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
    backgroundColor: isDark ? '#1f2937' : '#ffffff',
    color: isDark ? '#d1d5db' : '#374151',
    outline: 'none', fontFamily: fonts.display, boxSizing: 'border-box',
});

const ruleSelect = (isDark: boolean): CSSProperties => ({
    ...ruleInput(isDark, 80),
    cursor: 'pointer', appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath d='M2 3L4 5L6 3' stroke='%236b7280' stroke-width='1' fill='none'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center',
    paddingRight: 20,
});

const tagChip = (isDark: boolean, active: boolean): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 500,
    cursor: 'pointer', transition: 'all 0.15s',
    border: active
        ? `1px solid ${colors.primary}`
        : `1px solid ${isDark ? '#374151' : '#d1d5db'}`,
    backgroundColor: active
        ? isDark ? 'rgba(59,130,246,0.15)' : '#eff6ff'
        : isDark ? '#1f2937' : '#ffffff',
    color: active
        ? colors.primary
        : isDark ? '#9ca3af' : '#6b7280',
    fontFamily: fonts.display,
});

const smallBtn = (isDark: boolean): CSSProperties => ({
    padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
    backgroundColor: isDark ? '#1f2937' : '#ffffff',
    color: isDark ? '#d1d5db' : '#4b5563',
    cursor: 'pointer', fontFamily: fonts.display,
    display: 'flex', alignItems: 'center', gap: 4,
    transition: 'background-color 0.15s',
});

const paramRow = (isDark: boolean): CSSProperties => ({
    display: 'grid', gridTemplateColumns: '1fr 80px 1fr 28px', gap: 6,
    alignItems: 'center', marginBottom: 6,
    padding: '6px 8px', borderRadius: 8,
    backgroundColor: isDark ? '#111827' : '#f9fafb',
    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
});

const sourceChip = (isDark: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 12px', borderRadius: 10,
    backgroundColor: isDark ? '#111827' : '#f0f9ff',
    border: `1px solid ${isDark ? '#374151' : '#bae6fd'}`,
    marginBottom: 6,
});

/* ══════════════════════════════════════════════
   Type-Specific Property Editors
   ══════════════════════════════════════════════ */

/** A. Context Block Properties */
function ContextProperties({
    cfg, isDark, update,
}: { cfg: NodeConfig; isDark: boolean; update: (u: Partial<NodeConfig>) => void }) {
    const config: ContextBlockConfig = cfg.contextConfig || { contextSources: [], query: '' };

    const addSource = () => {
        update({ contextConfig: { ...config, contextSources: [...config.contextSources, ''] } });
    };
    const removeSource = (idx: number) => {
        const next = config.contextSources.filter((_, i) => i !== idx);
        update({ contextConfig: { ...config, contextSources: next } });
    };
    const updateSource = (idx: number, val: string) => {
        const next = [...config.contextSources];
        next[idx] = val;
        update({ contextConfig: { ...config, contextSources: next } });
    };

    return (
        <>
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={sectionLabel(isDark)}>Context Sources</label>
                    <button style={smallBtn(isDark)} onClick={addSource}>
                        <span className="material-icons" style={{ fontSize: 14 }}>add</span> Add Source
                    </button>
                </div>
                {config.contextSources.length === 0 && (
                    <div style={{ ...sourceChip(isDark), justifyContent: 'center', color: isDark ? '#6b7280' : '#9ca3af', fontStyle: 'italic', fontSize: 13 }}>
                        No sources added yet — click "Add Source"
                    </div>
                )}
                {config.contextSources.map((src, i) => (
                    <div key={i} style={sourceChip(isDark)}>
                        <span className="material-icons" style={{ fontSize: 16, color: colors.nodeBlue }}>source</span>
                        <input
                            style={{ ...inputStyle(isDark), border: 'none', boxShadow: 'none', padding: '4px 0', flex: 1, backgroundColor: 'transparent' }}
                            value={src}
                            onChange={(e) => updateSource(i, e.target.value)}
                            placeholder={`Document / DB source ${i + 1}`}
                        />
                        <button
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}
                            onClick={() => removeSource(i)}
                        >
                            <span className="material-icons" style={{ fontSize: 16, color: '#ef4444' }}>close</span>
                        </button>
                    </div>
                ))}
            </div>
            <div>
                <label style={sectionLabel(isDark)}>Research Query</label>
                <textarea
                    style={textareaStyle(isDark)}
                    value={config.query}
                    onChange={(e) => update({ contextConfig: { ...config, query: e.target.value } })}
                    placeholder="e.g., Fetch all sales data from Q4 2024 for the APAC region..."
                />
            </div>
        </>
    );
}

/** B. Conditional Block Properties */
function ConditionalProperties({
    cfg, isDark, update,
}: { cfg: NodeConfig; isDark: boolean; update: (u: Partial<NodeConfig>) => void }) {
    const config: ConditionalBlockConfig = cfg.conditionalConfig || {
        rules: [{ id: 'rule-1', field: '', operator: '>', value: '', branchLabel: 'True' }],
        defaultBranch: 'Default',
    };

    const addRule = () => {
        if (config.rules.length >= 10) return;
        const id = `rule-${Date.now()}`;
        update({
            conditionalConfig: {
                ...config,
                rules: [...config.rules, { id, field: '', operator: '>' as const, value: '', branchLabel: `Branch ${config.rules.length + 1}` }],
            },
        });
    };

    const updateRule = (idx: number, updates: Partial<ConditionRule>) => {
        const next = config.rules.map((r, i) => i === idx ? { ...r, ...updates } : r);
        update({ conditionalConfig: { ...config, rules: next } });
    };

    const removeRule = (idx: number) => {
        const next = config.rules.filter((_, i) => i !== idx);
        update({ conditionalConfig: { ...config, rules: next } });
    };

    return (
        <>
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={sectionLabel(isDark)}>
                        Condition Builder
                        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6, fontSize: 10, color: isDark ? '#6b7280' : '#9ca3af' }}>
                            ({config.rules.length}/10 branches)
                        </span>
                    </label>
                    <button
                        style={{ ...smallBtn(isDark), opacity: config.rules.length >= 10 ? 0.4 : 1 }}
                        onClick={addRule}
                        disabled={config.rules.length >= 10}
                    >
                        <span className="material-icons" style={{ fontSize: 14 }}>add</span> Add Branch
                    </button>
                </div>

                {config.rules.map((rule, i) => (
                    <div key={rule.id} style={ruleRow(isDark)}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: colors.nodeYellow, minWidth: 16 }}>
                            {i + 1}.
                        </span>
                        <input
                            style={ruleInput(isDark, 90)}
                            value={rule.field}
                            onChange={(e) => updateRule(i, { field: e.target.value })}
                            placeholder="Field"
                        />
                        <select
                            style={ruleSelect(isDark)}
                            value={rule.operator}
                            onChange={(e) => updateRule(i, { operator: e.target.value as ConditionRule['operator'] })}
                        >
                            {OPERATOR_OPTIONS.map((op) => (
                                <option key={op} value={op}>{op}</option>
                            ))}
                        </select>
                        <input
                            style={ruleInput(isDark, 80)}
                            value={rule.value}
                            onChange={(e) => updateRule(i, { value: e.target.value })}
                            placeholder="Value"
                        />
                        <input
                            style={{ ...ruleInput(isDark, 80), fontSize: 11, fontWeight: 600 }}
                            value={rule.branchLabel}
                            onChange={(e) => updateRule(i, { branchLabel: e.target.value })}
                            placeholder="Label"
                        />
                        <button
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}
                            onClick={() => removeRule(i)}
                        >
                            <span className="material-icons" style={{ fontSize: 14, color: '#ef4444' }}>delete</span>
                        </button>
                    </div>
                ))}
            </div>

            <div>
                <label style={sectionLabel(isDark)}>Default Branch Label</label>
                <input
                    style={inputStyle(isDark)}
                    value={config.defaultBranch}
                    onChange={(e) => update({ conditionalConfig: { ...config, defaultBranch: e.target.value } })}
                    placeholder="Default"
                />
            </div>
        </>
    );
}

/** C. Result Block Properties */
function ResultProperties({
    cfg, isDark, update,
}: { cfg: NodeConfig; isDark: boolean; update: (u: Partial<NodeConfig>) => void }) {
    const config: ResultBlockConfig = cfg.resultConfig || { outputFormat: 'Excel', template: '' };

    return (
        <>
            <div>
                <label style={sectionLabel(isDark)}>Output Format</label>
                <select
                    style={selectStyle(isDark)}
                    value={config.outputFormat}
                    onChange={(e) => update({ resultConfig: { ...config, outputFormat: e.target.value as ResultBlockConfig['outputFormat'] } })}
                >
                    {FORMAT_OPTIONS.map((f) => (
                        <option key={f} value={f}>{f}</option>
                    ))}
                </select>
            </div>
            <div>
                <label style={sectionLabel(isDark)}>Report Template</label>
                <textarea
                    style={{ ...textareaStyle(isDark), minHeight: 140 }}
                    value={config.template}
                    onChange={(e) => update({ resultConfig: { ...config, template: e.target.value } })}
                    placeholder={`Define the structure of your ${config.outputFormat} report...\n\ne.g.:\nColumns: Name, Region, Revenue, Status\nSorting: Revenue DESC\nFilter: Status = "Active"`}
                />
            </div>
        </>
    );
}

/** D. Notification Block Properties */
function NotificationProperties({
    cfg, isDark, update,
}: { cfg: NodeConfig; isDark: boolean; update: (u: Partial<NodeConfig>) => void }) {
    const config: NotificationBlockConfig = cfg.notificationConfig || { service: 'Email', recipient: '', messageTemplate: '' };

    const serviceIcons: Record<string, string> = {
        Slack: 'tag', Email: 'email', PagerDuty: 'warning', Webhook: 'webhook',
    };

    return (
        <>
            <div>
                <label style={sectionLabel(isDark)}>Service</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {SERVICE_OPTIONS.map((svc) => (
                        <button
                            key={svc}
                            style={tagChip(isDark, config.service === svc)}
                            onClick={() => update({ notificationConfig: { ...config, service: svc as NotificationBlockConfig['service'] } })}
                        >
                            <span className="material-icons" style={{ fontSize: 14 }}>{serviceIcons[svc]}</span>
                            {svc}
                        </button>
                    ))}
                </div>
            </div>
            <div>
                <label style={sectionLabel(isDark)}>
                    {config.service === 'Email' ? 'Email Address' : config.service === 'Slack' ? 'Channel ID' : 'Recipient / Endpoint'}
                </label>
                <input
                    style={inputStyle(isDark)}
                    value={config.recipient}
                    onChange={(e) => update({ notificationConfig: { ...config, recipient: e.target.value } })}
                    placeholder={config.service === 'Email' ? 'team@company.com' : config.service === 'Slack' ? '#alerts-channel' : 'Enter recipient...'}
                />
            </div>
            <div>
                <label style={sectionLabel(isDark)}>Message Template</label>
                <textarea
                    style={{ ...textareaStyle(isDark), minHeight: 120 }}
                    value={config.messageTemplate}
                    onChange={(e) => update({ notificationConfig: { ...config, messageTemplate: e.target.value } })}
                    placeholder="Use {{variables}} for dynamic content.\n\ne.g., Alert: {{workflow_name}} completed with {{result_count}} results."
                />
            </div>
        </>
    );
}

/** E. Code Block Properties */
function CodeProperties({
    cfg, isDark, update,
}: { cfg: NodeConfig; isDark: boolean; update: (u: Partial<NodeConfig>) => void }) {
    const config: CodeBlockConfig = cfg.codeConfig || { code: '', codeFile: 'untitled.py', libraryImports: [] };

    const toggleLib = (lib: string) => {
        const has = config.libraryImports.includes(lib);
        const next = has
            ? config.libraryImports.filter((l) => l !== lib)
            : [...config.libraryImports, lib];
        update({ codeConfig: { ...config, libraryImports: next } });
    };

    return (
        <>
            <div>
                <label style={sectionLabel(isDark)}>Library Imports</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {LIBRARY_OPTIONS.map((lib) => (
                        <button
                            key={lib}
                            style={tagChip(isDark, config.libraryImports.includes(lib))}
                            onClick={() => toggleLib(lib)}
                        >
                            {config.libraryImports.includes(lib) && (
                                <span className="material-icons" style={{ fontSize: 12 }}>check</span>
                            )}
                            {lib}
                        </button>
                    ))}
                </div>
            </div>
            <div style={{ flex: 1, minHeight: 250, display: 'flex', flexDirection: 'column' }}>
                <label style={sectionLabel(isDark)}>Python Editor</label>
                <div style={editorWrap(isDark)}>
                    <div style={editorBar}>
                        <div style={dot('#ef4444')} />
                        <div style={dot('#eab308')} />
                        <div style={dot('#22c55e')} />
                        <span style={fileNameStyle}>{config.codeFile}</span>
                    </div>
                    <textarea
                        style={codeTextarea}
                        value={config.code}
                        onChange={(e) => update({ codeConfig: { ...config, code: e.target.value } })}
                        placeholder="# Python 3.11 — Write your transformation logic here...\nimport pandas as pd\n\ndef process(data):\n    return data"
                        spellCheck={false}
                    />
                </div>
            </div>
        </>
    );
}

/** F. Parameter Block Properties */
function ParameterProperties({
    cfg, isDark, update,
}: { cfg: NodeConfig; isDark: boolean; update: (u: Partial<NodeConfig>) => void }) {
    const config: ParameterBlockConfig = cfg.parameterConfig || { parameters: [] };

    const addParam = () => {
        update({
            parameterConfig: {
                parameters: [...config.parameters, { name: '', type: 'string', defaultValue: '' }],
            },
        });
    };

    const updateParam = (idx: number, updates: Partial<{ name: string; type: string; defaultValue: string }>) => {
        const next = config.parameters.map((p, i) => i === idx ? { ...p, ...updates } : p);
        update({ parameterConfig: { parameters: next } });
    };

    const removeParam = (idx: number) => {
        const next = config.parameters.filter((_, i) => i !== idx);
        update({ parameterConfig: { parameters: next } });
    };

    const typeOptions = ['string', 'number', 'boolean', 'date', 'json', 'file'];

    return (
        <>
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={sectionLabel(isDark)}>Global Variables</label>
                    <button style={smallBtn(isDark)} onClick={addParam}>
                        <span className="material-icons" style={{ fontSize: 14 }}>add</span> Add Variable
                    </button>
                </div>

                {/* Column headers */}
                {config.parameters.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr 28px', gap: 6, padding: '0 8px', marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: isDark ? '#6b7280' : '#9ca3af', textTransform: 'uppercase' }}>Name</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: isDark ? '#6b7280' : '#9ca3af', textTransform: 'uppercase' }}>Type</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: isDark ? '#6b7280' : '#9ca3af', textTransform: 'uppercase' }}>Default</span>
                        <span />
                    </div>
                )}

                {config.parameters.map((p, i) => (
                    <div key={i} style={paramRow(isDark)}>
                        <input
                            style={ruleInput(isDark, 0)}
                            value={p.name}
                            onChange={(e) => updateParam(i, { name: e.target.value })}
                            placeholder="Variable name"
                        />
                        <select
                            style={{ ...ruleSelect(isDark), width: '100%' }}
                            value={p.type}
                            onChange={(e) => updateParam(i, { type: e.target.value })}
                        >
                            {typeOptions.map((t) => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                        <input
                            style={ruleInput(isDark, 0)}
                            value={p.defaultValue}
                            onChange={(e) => updateParam(i, { defaultValue: e.target.value })}
                            placeholder="Default value"
                        />
                        <button
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }}
                            onClick={() => removeParam(i)}
                        >
                            <span className="material-icons" style={{ fontSize: 14, color: '#ef4444' }}>delete</span>
                        </button>
                    </div>
                ))}

                {config.parameters.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 20, color: isDark ? '#6b7280' : '#9ca3af', fontSize: 13, fontStyle: 'italic' }}>
                        No variables defined — click "Add Variable" to create one
                    </div>
                )}
            </div>
        </>
    );
}

/* ══════════════════════════════════════════════
   Retry Policy Section (shared across all types)
   ══════════════════════════════════════════════ */
function RetryPolicySection({
    cfg, isDark, update,
}: { cfg: NodeConfig; isDark: boolean; update: (u: Partial<NodeConfig>) => void }) {
    const policy: RetryPolicy = cfg.retryPolicy || { enabled: false, maxRetries: 3, retryDelay: 5, timeout: 30 };

    const updatePolicy = (updates: Partial<RetryPolicy>) => {
        update({ retryPolicy: { ...policy, ...updates } });
    };

    return (
        <div>
            <label style={sectionLabel(isDark)}>Retry Policy Config</label>
            <div style={settingsContainer(isDark)}>
                <div style={settingsRow}>
                    <span style={settingsLabel(isDark)}>Enable Retry</span>
                    <button
                        style={toggleTrack(policy.enabled, isDark)}
                        onClick={() => updatePolicy({ enabled: !policy.enabled })}
                        aria-label="Toggle retry"
                    >
                        <div style={toggleThumb(policy.enabled)} />
                    </button>
                </div>

                {policy.enabled && (
                    <>
                        <div style={{ ...sectionDivider(isDark) }} />
                        <div style={settingsRow}>
                            <span style={settingsLabel(isDark)}>Max Retries</span>
                            <input
                                type="number"
                                value={policy.maxRetries}
                                onChange={(e) => updatePolicy({ maxRetries: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) })}
                                style={numInput(isDark)}
                                min={1}
                                max={10}
                            />
                        </div>
                        <div style={settingsRow}>
                            <span style={settingsLabel(isDark)}>Retry Delay (sec)</span>
                            <input
                                type="number"
                                value={policy.retryDelay}
                                onChange={(e) => updatePolicy({ retryDelay: parseInt(e.target.value) || 5 })}
                                style={numInput(isDark)}
                            />
                        </div>
                    </>
                )}

                <div style={{ ...sectionDivider(isDark) }} />
                <div style={settingsRow}>
                    <span style={settingsLabel(isDark)}>Timeout (sec)</span>
                    <input
                        type="number"
                        value={policy.timeout}
                        onChange={(e) => updatePolicy({ timeout: parseInt(e.target.value) || 30 })}
                        style={numInput(isDark)}
                    />
                </div>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════
   Main NodeConfigPanel Component
   ══════════════════════════════════════════════ */
export default function NodeConfigPanel() {
    const { isDark } = useTheme();
    const { selectedConfig, closePanel, updateNodeConfig, deleteNode, selectedNodeId } =
        useWorkflow();

    if (!selectedConfig || !selectedNodeId) return null;

    const cfg = selectedConfig;
    const meta = NODE_TYPE_META[cfg.nodeType] || { label: cfg.nodeType, icon: 'widgets', color: '#6b7280' };

    const update = (updates: Partial<NodeConfig>) => {
        updateNodeConfig(cfg.id, updates);
    };

    /* ─── Determine which type-specific panel to show ─── */
    const renderTypeProperties = () => {
        switch (cfg.nodeType) {
            case 'actionNode':
                return <ContextProperties cfg={cfg} isDark={isDark} update={update} />;
            case 'conditionalNode':
                return <ConditionalProperties cfg={cfg} isDark={isDark} update={update} />;
            case 'resultNode':
                return <ResultProperties cfg={cfg} isDark={isDark} update={update} />;
            case 'notifyNode':
                return <NotificationProperties cfg={cfg} isDark={isDark} update={update} />;
            case 'codeNode':
            case 'selectedNode':
                return <CodeProperties cfg={cfg} isDark={isDark} update={update} />;
            case 'paramNode':
                return <ParameterProperties cfg={cfg} isDark={isDark} update={update} />;
            default:
                return <CodeProperties cfg={cfg} isDark={isDark} update={update} />;
        }
    };

    return (
        <aside style={panel(isDark)}>
            {/* Header */}
            <div style={panelHeader(isDark)}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={panelTitle}>{cfg.label}</span>
                    <span style={typeBadge(meta.color)}>
                        <span className="material-icons" style={{ fontSize: 12 }}>{meta.icon}</span>
                        {meta.label}
                    </span>
                </div>
                <button
                    style={closeBtn(isDark)}
                    onClick={closePanel}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = isDark ? '#4b5563' : '#e5e7eb';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#f3f4f6';
                    }}
                >
                    <span className="material-icons" style={{ fontSize: 16 }}>close</span>
                </button>
            </div>

            {/* Body */}
            <div style={body}>
                {/* ─── Common: Node Name ─── */}
                <div>
                    <label style={sectionLabel(isDark)}>Node Name</label>
                    <input
                        style={inputStyle(isDark)}
                        value={cfg.label}
                        onChange={(e) => update({ label: e.target.value })}
                        placeholder="Enter node name..."
                    />
                </div>

                {/* ─── Common: Description ─── */}
                <div>
                    <label style={sectionLabel(isDark)}>Description</label>
                    <textarea
                        style={textareaStyle(isDark)}
                        value={cfg.description}
                        onChange={(e) => update({ description: e.target.value })}
                        placeholder="Describe what this node does..."
                    />
                </div>

                <div style={sectionDivider(isDark)} />

                {/* ─── Type-Specific Properties ─── */}
                {renderTypeProperties()}

                <div style={sectionDivider(isDark)} />

                {/* ─── Common: I/O Schema (hidden for Param blocks) ─── */}
                {cfg.nodeType !== 'paramNode' && (
                    <div>
                        <label style={sectionLabel(isDark)}>Input / Output Schema</label>
                        <div style={schemaGrid}>
                            <div style={schemaCard(isDark)}>
                                <div style={schemaCardHeader(isDark)}>
                                    <span style={schemaTitle(isDark)}>Input JSON</span>
                                    <span style={schemaBadge(isDark)}>Editable</span>
                                </div>
                                <textarea
                                    style={schemaTextarea(isDark ? '#4ade80' : '#16a34a')}
                                    value={cfg.inputSchema}
                                    onChange={(e) => update({ inputSchema: e.target.value })}
                                />
                            </div>
                            <div style={schemaCard(isDark)}>
                                <div style={schemaCardHeader(isDark)}>
                                    <span style={schemaTitle(isDark)}>Output JSON</span>
                                    <span style={schemaBadge(isDark)}>Editable</span>
                                </div>
                                <textarea
                                    style={schemaTextarea(isDark ? '#60a5fa' : '#2563eb')}
                                    value={cfg.outputSchema}
                                    onChange={(e) => update({ outputSchema: e.target.value })}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* ─── Common: Retry Policy ─── */}
                <RetryPolicySection cfg={cfg} isDark={isDark} update={update} />
            </div>

            {/* Footer */}
            <div style={footer(isDark)}>
                <button
                    style={saveBtn}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = colors.primaryHover;
                        e.currentTarget.style.boxShadow = shadows.blueLg;
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = colors.primary;
                        e.currentTarget.style.boxShadow = shadows.blueMd;
                    }}
                >
                    Save Configuration
                </button>
                <button
                    style={deleteBtnStyle(isDark)}
                    onClick={() => deleteNode(cfg.id)}
                    title="Delete this node"
                >
                    <span className="material-icons" style={{ fontSize: 16 }}>delete</span>
                    Delete
                </button>
                <button style={testBtn(isDark)}>Test</button>
            </div>
        </aside>
    );
}
