import type { CSSProperties } from 'react';
import { useTheme } from '../context/ThemeContext';
import {
    useWorkflow,
    type NodeConfig,
    type ActionBlockConfig,
    type ConditionalBlockConfig,
    type ResultBlockConfig,
    type NotificationBlockConfig,
    type CodeBlockConfig,
    type ParameterBlockConfig,
    type RetryPolicy,
} from '../context/WorkflowContext';
import type {
    ActionHeaderEntry,
    ConditionalRule,
    CodeInputBinding,
    OutputMappingEntry,
    ParamNodeParameter,
} from '../data/workflowData';
import { colors, shadows, fonts } from '../theme';

/* ─── Node type → friendly labels & icons ─── */
const NODE_TYPE_META: Record<string, { label: string; icon: string; color: string }> = {
    actionNode: { label: 'Action Block', icon: 'search', color: colors.nodeBlue },
    conditionalNode: { label: 'Conditional', icon: 'call_split', color: colors.nodeYellow },
    resultNode: { label: 'Result Block', icon: 'description', color: colors.nodeGreen },
    notifyNode: { label: 'Notification', icon: 'notifications', color: colors.nodePurple },
    codeNode: { label: 'Code Block', icon: 'terminal', color: colors.nodeGrey },
    paramNode: { label: 'Parameter', icon: 'tune', color: colors.nodeOrange },
    selectedNode: { label: 'Python Logic', icon: 'code', color: colors.primary },
};

const OPERATOR_OPTIONS = ['>', '<', '>=', '<=', '==', '!=', 'contains', 'starts_with', 'in', 'not_in'];
const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const CHANNEL_OPTIONS = ['Email', 'Slack', 'PagerDuty', 'Webhook', 'SNS', 'Teams'];
const LANGUAGE_OPTIONS: Array<'Python' | 'JavaScript'> = ['Python', 'JavaScript'];
const PARAM_TYPE_OPTIONS: Array<'String' | 'Number' | 'Boolean' | 'JSON'> = ['String', 'Number', 'Boolean', 'JSON'];

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

/* ─── Dynamic list row styles ─── */
const listRow = (isDark: boolean): CSSProperties => ({
    display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8,
    padding: 10, borderRadius: 10,
    backgroundColor: isDark ? '#111827' : '#f9fafb',
    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
});

const listInput = (isDark: boolean, width?: number): CSSProperties => ({
    flex: width ? undefined : 1,
    width: width || undefined,
    padding: '6px 8px', fontSize: 12, borderRadius: 8,
    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
    backgroundColor: isDark ? '#1f2937' : '#ffffff',
    color: isDark ? '#d1d5db' : '#374151',
    outline: 'none', fontFamily: fonts.display, boxSizing: 'border-box',
});

const listSelect = (isDark: boolean): CSSProperties => ({
    ...listInput(isDark, 100),
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

const removeBtn: CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex',
};

/* ══════════════════════════════════════════════
   Type-Specific Property Editors
   ══════════════════════════════════════════════ */

/** A. Action Block Properties */
function ActionProperties({
    cfg, isDark, update,
}: { cfg: NodeConfig; isDark: boolean; update: (u: Partial<NodeConfig>) => void }) {
    const config: ActionBlockConfig = cfg.actionConfig || {
        actionType: '', endpointOrTool: '', method: 'GET',
        headers: [], payload: '',
        executionSettings: { timeoutMs: 30000, maxRetries: 3, continueOnError: false },
    };

    const updateConfig = (updates: Partial<ActionBlockConfig>) => {
        update({ actionConfig: { ...config, ...updates } });
    };

    const addHeader = () => {
        updateConfig({ headers: [...config.headers, { key: '', value: '' }] });
    };
    const removeHeader = (idx: number) => {
        updateConfig({ headers: config.headers.filter((_, i) => i !== idx) });
    };
    const updateHeader = (idx: number, updates: Partial<ActionHeaderEntry>) => {
        const next = config.headers.map((h, i) => i === idx ? { ...h, ...updates } : h);
        updateConfig({ headers: next });
    };
    const updateExecSettings = (updates: Partial<typeof config.executionSettings>) => {
        updateConfig({ executionSettings: { ...config.executionSettings, ...updates } });
    };

    return (
        <>
            {/* Action Type */}
            <div>
                <label style={sectionLabel(isDark)}>Action Type</label>
                <input
                    style={inputStyle(isDark)}
                    value={config.actionType}
                    onChange={(e) => updateConfig({ actionType: e.target.value })}
                    placeholder="e.g., create, configure, deploy, validate"
                />
            </div>

            {/* Method & Endpoint */}
            <div>
                <label style={sectionLabel(isDark)}>Method & Endpoint</label>
                <div style={{ display: 'flex', gap: 8 }}>
                    <select
                        style={{ ...selectStyle(isDark), width: 110, flex: 'none' }}
                        value={config.method}
                        onChange={(e) => updateConfig({ method: e.target.value })}
                    >
                        {METHOD_OPTIONS.map((m) => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>
                    <input
                        style={{ ...inputStyle(isDark), flex: 1 }}
                        value={config.endpointOrTool}
                        onChange={(e) => updateConfig({ endpointOrTool: e.target.value })}
                        placeholder="https://api.example.com/{{resource_id}}/action"
                    />
                </div>
            </div>

            {/* Headers — dynamic list */}
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={sectionLabel(isDark)}>
                        Headers
                        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6, fontSize: 10, color: isDark ? '#6b7280' : '#9ca3af' }}>
                            ({config.headers.length})
                        </span>
                    </label>
                    <button style={smallBtn(isDark)} onClick={addHeader}>
                        <span className="material-icons" style={{ fontSize: 14 }}>add</span> Add Row
                    </button>
                </div>
                {config.headers.map((h, i) => (
                    <div key={i} style={listRow(isDark)}>
                        <input
                            style={listInput(isDark)}
                            value={h.key}
                            onChange={(e) => updateHeader(i, { key: e.target.value })}
                            placeholder="Header key"
                        />
                        <input
                            style={listInput(isDark)}
                            value={h.value}
                            onChange={(e) => updateHeader(i, { value: e.target.value })}
                            placeholder="Header value"
                        />
                        <button style={removeBtn} onClick={() => removeHeader(i)}>
                            <span className="material-icons" style={{ fontSize: 14, color: '#ef4444' }}>delete</span>
                        </button>
                    </div>
                ))}
                {config.headers.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 12, color: isDark ? '#6b7280' : '#9ca3af', fontSize: 12, fontStyle: 'italic' }}>
                        No headers — click "Add Row"
                    </div>
                )}
            </div>

            {/* Payload */}
            <div>
                <label style={sectionLabel(isDark)}>Payload / Body</label>
                <textarea
                    style={{ ...textareaStyle(isDark), fontFamily: fonts.mono, minHeight: 120 }}
                    value={config.payload}
                    onChange={(e) => updateConfig({ payload: e.target.value })}
                    placeholder={'{\n  "key": "{{variable}}",\n  "data": { ... }\n}'}
                    spellCheck={false}
                />
            </div>

            {/* Execution Settings */}
            <div>
                <label style={sectionLabel(isDark)}>Execution Settings</label>
                <div style={settingsContainer(isDark)}>
                    <div style={settingsRow}>
                        <span style={settingsLabel(isDark)}>Timeout (ms)</span>
                        <input
                            type="number"
                            value={config.executionSettings.timeoutMs}
                            onChange={(e) => updateExecSettings({ timeoutMs: parseInt(e.target.value) || 30000 })}
                            style={numInput(isDark)}
                        />
                    </div>
                    <div style={{ ...sectionDivider(isDark) }} />
                    <div style={settingsRow}>
                        <span style={settingsLabel(isDark)}>Max Retries</span>
                        <input
                            type="number"
                            value={config.executionSettings.maxRetries}
                            onChange={(e) => updateExecSettings({ maxRetries: Math.min(10, Math.max(0, parseInt(e.target.value) || 0)) })}
                            style={numInput(isDark)}
                            min={0} max={10}
                        />
                    </div>
                    <div style={{ ...sectionDivider(isDark) }} />
                    <div style={settingsRow}>
                        <span style={settingsLabel(isDark)}>Continue on Error</span>
                        <button
                            style={toggleTrack(config.executionSettings.continueOnError, isDark)}
                            onClick={() => updateExecSettings({ continueOnError: !config.executionSettings.continueOnError })}
                            aria-label="Toggle continue on error"
                        >
                            <div style={toggleThumb(config.executionSettings.continueOnError)} />
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

/** B. Conditional Block Properties */
function ConditionalProperties({
    cfg, isDark, update,
}: { cfg: NodeConfig; isDark: boolean; update: (u: Partial<NodeConfig>) => void }) {
    const config: ConditionalBlockConfig = cfg.conditionalConfig || {
        logicalOperator: 'AND',
        rules: [{ variable: '', operator: '==', compareValue: '' }],
    };

    const updateConfig = (updates: Partial<ConditionalBlockConfig>) => {
        update({ conditionalConfig: { ...config, ...updates } });
    };

    const addRule = () => {
        if (config.rules.length >= 10) return;
        updateConfig({
            rules: [...config.rules, { variable: '', operator: '==', compareValue: '' }],
        });
    };

    const updateRule = (idx: number, updates: Partial<ConditionalRule>) => {
        const next = config.rules.map((r, i) => i === idx ? { ...r, ...updates } : r);
        updateConfig({ rules: next });
    };

    const removeRule = (idx: number) => {
        updateConfig({ rules: config.rules.filter((_, i) => i !== idx) });
    };

    return (
        <>
            {/* Logical Operator */}
            <div>
                <label style={sectionLabel(isDark)}>Logic Gate</label>
                <div style={{ display: 'flex', gap: 8 }}>
                    {(['AND', 'OR'] as const).map((op) => (
                        <button
                            key={op}
                            style={tagChip(isDark, config.logicalOperator === op)}
                            onClick={() => updateConfig({ logicalOperator: op })}
                        >
                            {config.logicalOperator === op && (
                                <span className="material-icons" style={{ fontSize: 12 }}>check</span>
                            )}
                            {op}
                        </button>
                    ))}
                </div>
            </div>

            {/* Rules — dynamic list */}
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={sectionLabel(isDark)}>
                        Condition Rules
                        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6, fontSize: 10, color: isDark ? '#6b7280' : '#9ca3af' }}>
                            ({config.rules.length}/10)
                        </span>
                    </label>
                    <button
                        style={{ ...smallBtn(isDark), opacity: config.rules.length >= 10 ? 0.4 : 1 }}
                        onClick={addRule}
                        disabled={config.rules.length >= 10}
                    >
                        <span className="material-icons" style={{ fontSize: 14 }}>add</span> Add Rule
                    </button>
                </div>

                {config.rules.map((rule, i) => (
                    <div key={i} style={listRow(isDark)}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: colors.nodeYellow, minWidth: 16 }}>
                            {i + 1}.
                        </span>
                        <input
                            style={listInput(isDark, 100)}
                            value={rule.variable}
                            onChange={(e) => updateRule(i, { variable: e.target.value })}
                            placeholder="{{variable}}"
                        />
                        <select
                            style={listSelect(isDark)}
                            value={rule.operator}
                            onChange={(e) => updateRule(i, { operator: e.target.value })}
                        >
                            {OPERATOR_OPTIONS.map((op) => (
                                <option key={op} value={op}>{op}</option>
                            ))}
                        </select>
                        <input
                            style={listInput(isDark, 90)}
                            value={rule.compareValue}
                            onChange={(e) => updateRule(i, { compareValue: e.target.value })}
                            placeholder="Value"
                        />
                        <button style={removeBtn} onClick={() => removeRule(i)}>
                            <span className="material-icons" style={{ fontSize: 14, color: '#ef4444' }}>delete</span>
                        </button>
                    </div>
                ))}

                {config.rules.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 16, color: isDark ? '#6b7280' : '#9ca3af', fontSize: 12, fontStyle: 'italic' }}>
                        No rules defined — click "Add Rule"
                    </div>
                )}
            </div>
        </>
    );
}

/** C. Result Block Properties */
function ResultProperties({
    cfg, isDark, update,
}: { cfg: NodeConfig; isDark: boolean; update: (u: Partial<NodeConfig>) => void }) {
    const config: ResultBlockConfig = cfg.resultConfig || {
        status: 'Success', outputMapping: [], terminateExecution: true,
    };

    const updateConfig = (updates: Partial<ResultBlockConfig>) => {
        update({ resultConfig: { ...config, ...updates } });
    };

    const addMapping = () => {
        updateConfig({ outputMapping: [...config.outputMapping, { outputKey: '', mappedValue: '' }] });
    };
    const removeMapping = (idx: number) => {
        updateConfig({ outputMapping: config.outputMapping.filter((_, i) => i !== idx) });
    };
    const updateMapping = (idx: number, updates: Partial<OutputMappingEntry>) => {
        const next = config.outputMapping.map((m, i) => i === idx ? { ...m, ...updates } : m);
        updateConfig({ outputMapping: next });
    };

    return (
        <>
            {/* Status */}
            <div>
                <label style={sectionLabel(isDark)}>Result Status</label>
                <div style={{ display: 'flex', gap: 8 }}>
                    {(['Success', 'Failure'] as const).map((s) => (
                        <button
                            key={s}
                            style={tagChip(isDark, config.status === s)}
                            onClick={() => updateConfig({ status: s })}
                        >
                            <span className="material-icons" style={{ fontSize: 12 }}>
                                {s === 'Success' ? 'check_circle' : 'cancel'}
                            </span>
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            {/* Output Mapping — dynamic list */}
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={sectionLabel(isDark)}>
                        Output Mapping
                        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6, fontSize: 10, color: isDark ? '#6b7280' : '#9ca3af' }}>
                            ({config.outputMapping.length})
                        </span>
                    </label>
                    <button style={smallBtn(isDark)} onClick={addMapping}>
                        <span className="material-icons" style={{ fontSize: 14 }}>add</span> Add Row
                    </button>
                </div>
                {config.outputMapping.map((m, i) => (
                    <div key={i} style={listRow(isDark)}>
                        <input
                            style={listInput(isDark)}
                            value={m.outputKey}
                            onChange={(e) => updateMapping(i, { outputKey: e.target.value })}
                            placeholder="Output key"
                        />
                        <input
                            style={listInput(isDark)}
                            value={m.mappedValue}
                            onChange={(e) => updateMapping(i, { mappedValue: e.target.value })}
                            placeholder="{{node_id.field}}"
                        />
                        <button style={removeBtn} onClick={() => removeMapping(i)}>
                            <span className="material-icons" style={{ fontSize: 14, color: '#ef4444' }}>delete</span>
                        </button>
                    </div>
                ))}
                {config.outputMapping.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 12, color: isDark ? '#6b7280' : '#9ca3af', fontSize: 12, fontStyle: 'italic' }}>
                        No output mappings — click "Add Row"
                    </div>
                )}
            </div>

            {/* Terminate Execution */}
            <div>
                <div style={settingsContainer(isDark)}>
                    <div style={settingsRow}>
                        <span style={settingsLabel(isDark)}>Terminate Execution</span>
                        <button
                            style={toggleTrack(config.terminateExecution, isDark)}
                            onClick={() => updateConfig({ terminateExecution: !config.terminateExecution })}
                            aria-label="Toggle terminate execution"
                        >
                            <div style={toggleThumb(config.terminateExecution)} />
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

/** D. Notification Block Properties */
function NotificationProperties({
    cfg, isDark, update,
}: { cfg: NodeConfig; isDark: boolean; update: (u: Partial<NodeConfig>) => void }) {
    const config: NotificationBlockConfig = cfg.notificationConfig || {
        channel: 'Email', recipients: [], subject: '', messageTemplate: '',
    };

    const channelIcons: Record<string, string> = {
        Slack: 'tag', Email: 'email', PagerDuty: 'warning', Webhook: 'webhook', SNS: 'campaign', Teams: 'groups',
    };

    const updateConfig = (updates: Partial<NotificationBlockConfig>) => {
        update({ notificationConfig: { ...config, ...updates } });
    };

    const addRecipient = () => {
        updateConfig({ recipients: [...config.recipients, ''] });
    };
    const removeRecipient = (idx: number) => {
        updateConfig({ recipients: config.recipients.filter((_, i) => i !== idx) });
    };
    const updateRecipient = (idx: number, val: string) => {
        const next = [...config.recipients];
        next[idx] = val;
        updateConfig({ recipients: next });
    };

    return (
        <>
            {/* Channel */}
            <div>
                <label style={sectionLabel(isDark)}>Channel</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {CHANNEL_OPTIONS.map((ch) => (
                        <button
                            key={ch}
                            style={tagChip(isDark, config.channel === ch)}
                            onClick={() => updateConfig({ channel: ch })}
                        >
                            <span className="material-icons" style={{ fontSize: 14 }}>{channelIcons[ch] || 'send'}</span>
                            {ch}
                        </button>
                    ))}
                </div>
            </div>

            {/* Subject */}
            <div>
                <label style={sectionLabel(isDark)}>Subject</label>
                <input
                    style={inputStyle(isDark)}
                    value={config.subject}
                    onChange={(e) => updateConfig({ subject: e.target.value })}
                    placeholder="Alert: {{workflow_name}} completed"
                />
            </div>

            {/* Recipients — dynamic list */}
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={sectionLabel(isDark)}>
                        Recipients
                        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6, fontSize: 10, color: isDark ? '#6b7280' : '#9ca3af' }}>
                            ({config.recipients.length})
                        </span>
                    </label>
                    <button style={smallBtn(isDark)} onClick={addRecipient}>
                        <span className="material-icons" style={{ fontSize: 14 }}>add</span> Add
                    </button>
                </div>
                {config.recipients.map((r, i) => (
                    <div key={i} style={listRow(isDark)}>
                        <input
                            style={listInput(isDark)}
                            value={r}
                            onChange={(e) => updateRecipient(i, e.target.value)}
                            placeholder={config.channel === 'Email' ? 'user@company.com' : config.channel === 'Slack' ? '#channel' : 'Endpoint / ID'}
                        />
                        <button style={removeBtn} onClick={() => removeRecipient(i)}>
                            <span className="material-icons" style={{ fontSize: 14, color: '#ef4444' }}>close</span>
                        </button>
                    </div>
                ))}
                {config.recipients.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 12, color: isDark ? '#6b7280' : '#9ca3af', fontSize: 12, fontStyle: 'italic' }}>
                        No recipients — click "Add"
                    </div>
                )}
            </div>

            {/* Message Template */}
            <div>
                <label style={sectionLabel(isDark)}>Message Template</label>
                <textarea
                    style={{ ...textareaStyle(isDark), minHeight: 120 }}
                    value={config.messageTemplate}
                    onChange={(e) => updateConfig({ messageTemplate: e.target.value })}
                    placeholder={"Use {{variables}} for dynamic content.\n\ne.g., Alert: {{workflow_name}} completed with status {{node_5.status}}."}
                />
            </div>
        </>
    );
}

/** E. Code Block Properties */
function CodeProperties({
    cfg, isDark, update,
}: { cfg: NodeConfig; isDark: boolean; update: (u: Partial<NodeConfig>) => void }) {
    const config: CodeBlockConfig = cfg.codeConfig || {
        language: 'Python', code: '', inputBindings: [], outputBindings: [],
    };

    const updateConfig = (updates: Partial<CodeBlockConfig>) => {
        update({ codeConfig: { ...config, ...updates } });
    };

    const addInputBinding = () => {
        updateConfig({ inputBindings: [...config.inputBindings, { envKey: '', mappedValue: '' }] });
    };
    const removeInputBinding = (idx: number) => {
        updateConfig({ inputBindings: config.inputBindings.filter((_, i) => i !== idx) });
    };
    const updateInputBinding = (idx: number, updates: Partial<CodeInputBinding>) => {
        const next = config.inputBindings.map((b, i) => i === idx ? { ...b, ...updates } : b);
        updateConfig({ inputBindings: next });
    };

    const addOutputBinding = () => {
        updateConfig({ outputBindings: [...config.outputBindings, ''] });
    };
    const removeOutputBinding = (idx: number) => {
        updateConfig({ outputBindings: config.outputBindings.filter((_, i) => i !== idx) });
    };
    const updateOutputBinding = (idx: number, val: string) => {
        const next = [...config.outputBindings];
        next[idx] = val;
        updateConfig({ outputBindings: next });
    };

    const fileExt = config.language === 'Python' ? 'py' : 'js';

    return (
        <>
            {/* Language */}
            <div>
                <label style={sectionLabel(isDark)}>Language</label>
                <div style={{ display: 'flex', gap: 8 }}>
                    {LANGUAGE_OPTIONS.map((lang) => (
                        <button
                            key={lang}
                            style={tagChip(isDark, config.language === lang)}
                            onClick={() => updateConfig({ language: lang })}
                        >
                            {config.language === lang && (
                                <span className="material-icons" style={{ fontSize: 12 }}>check</span>
                            )}
                            {lang}
                        </button>
                    ))}
                </div>
            </div>

            {/* Input Bindings — dynamic list */}
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={sectionLabel(isDark)}>
                        Input Bindings
                        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6, fontSize: 10, color: isDark ? '#6b7280' : '#9ca3af' }}>
                            ({config.inputBindings.length})
                        </span>
                    </label>
                    <button style={smallBtn(isDark)} onClick={addInputBinding}>
                        <span className="material-icons" style={{ fontSize: 14 }}>add</span> Add Row
                    </button>
                </div>
                {config.inputBindings.map((b, i) => (
                    <div key={i} style={listRow(isDark)}>
                        <input
                            style={listInput(isDark)}
                            value={b.envKey}
                            onChange={(e) => updateInputBinding(i, { envKey: e.target.value })}
                            placeholder="ENV_KEY"
                        />
                        <span style={{ color: isDark ? '#6b7280' : '#9ca3af', fontSize: 12 }}>←</span>
                        <input
                            style={listInput(isDark)}
                            value={b.mappedValue}
                            onChange={(e) => updateInputBinding(i, { mappedValue: e.target.value })}
                            placeholder="{{node_id.output}}"
                        />
                        <button style={removeBtn} onClick={() => removeInputBinding(i)}>
                            <span className="material-icons" style={{ fontSize: 14, color: '#ef4444' }}>delete</span>
                        </button>
                    </div>
                ))}
                {config.inputBindings.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 12, color: isDark ? '#6b7280' : '#9ca3af', fontSize: 12, fontStyle: 'italic' }}>
                        No input bindings
                    </div>
                )}
            </div>

            {/* Code Editor */}
            <div style={{ flex: 1, minHeight: 250, display: 'flex', flexDirection: 'column' }}>
                <label style={sectionLabel(isDark)}>Code Editor</label>
                <div style={editorWrap(isDark)}>
                    <div style={editorBar}>
                        <div style={dot('#ef4444')} />
                        <div style={dot('#eab308')} />
                        <div style={dot('#22c55e')} />
                        <span style={fileNameStyle}>script.{fileExt}</span>
                    </div>
                    <textarea
                        style={codeTextarea}
                        value={config.code}
                        onChange={(e) => updateConfig({ code: e.target.value })}
                        placeholder={config.language === 'Python'
                            ? "# Python 3.11 — Write your transformation logic here...\nimport os\n\ndef process(data):\n    return data"
                            : "// JavaScript — Write your logic here...\nfunction process(data) {\n  return data;\n}"
                        }
                        spellCheck={false}
                    />
                </div>
            </div>

            {/* Output Bindings — dynamic list */}
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={sectionLabel(isDark)}>
                        Output Bindings
                        <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 6, fontSize: 10, color: isDark ? '#6b7280' : '#9ca3af' }}>
                            ({config.outputBindings.length})
                        </span>
                    </label>
                    <button style={smallBtn(isDark)} onClick={addOutputBinding}>
                        <span className="material-icons" style={{ fontSize: 14 }}>add</span> Add
                    </button>
                </div>
                {config.outputBindings.map((ob, i) => (
                    <div key={i} style={listRow(isDark)}>
                        <input
                            style={listInput(isDark)}
                            value={ob}
                            onChange={(e) => updateOutputBinding(i, e.target.value)}
                            placeholder="output_variable_name"
                        />
                        <button style={removeBtn} onClick={() => removeOutputBinding(i)}>
                            <span className="material-icons" style={{ fontSize: 14, color: '#ef4444' }}>close</span>
                        </button>
                    </div>
                ))}
                {config.outputBindings.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 12, color: isDark ? '#6b7280' : '#9ca3af', fontSize: 12, fontStyle: 'italic' }}>
                        No output bindings
                    </div>
                )}
            </div>
        </>
    );
}

/** F. Parameter Block Properties */
function ParameterProperties({
    cfg, isDark, update,
}: { cfg: NodeConfig; isDark: boolean; update: (u: Partial<NodeConfig>) => void }) {
    const config: ParameterBlockConfig = cfg.parameterConfig || { parameters: [] };

    const updateConfig = (updates: Partial<ParameterBlockConfig>) => {
        update({ parameterConfig: { ...config, ...updates } });
    };

    const addParam = () => {
        updateConfig({
            parameters: [...config.parameters, { key: '', type: 'String', defaultValue: '', required: true }],
        });
    };

    const updateParam = (idx: number, updates: Partial<ParamNodeParameter>) => {
        const next = config.parameters.map((p, i) => i === idx ? { ...p, ...updates } : p);
        updateConfig({ parameters: next });
    };

    const removeParam = (idx: number) => {
        updateConfig({ parameters: config.parameters.filter((_, i) => i !== idx) });
    };

    return (
        <>
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={sectionLabel(isDark)}>Parameters</label>
                    <button style={smallBtn(isDark)} onClick={addParam}>
                        <span className="material-icons" style={{ fontSize: 14 }}>add</span> Add Parameter
                    </button>
                </div>

                {/* Column headers */}
                {config.parameters.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr 50px 28px', gap: 6, padding: '0 8px', marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: isDark ? '#6b7280' : '#9ca3af', textTransform: 'uppercase' }}>Key</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: isDark ? '#6b7280' : '#9ca3af', textTransform: 'uppercase' }}>Type</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: isDark ? '#6b7280' : '#9ca3af', textTransform: 'uppercase' }}>Default</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: isDark ? '#6b7280' : '#9ca3af', textTransform: 'uppercase' }}>Req'd</span>
                        <span />
                    </div>
                )}

                {config.parameters.map((p, i) => (
                    <div key={i} style={{ ...listRow(isDark), display: 'grid', gridTemplateColumns: '1fr 80px 1fr 50px 28px', gap: 6 }}>
                        <input
                            style={listInput(isDark)}
                            value={p.key}
                            onChange={(e) => updateParam(i, { key: e.target.value })}
                            placeholder="param_key"
                        />
                        <select
                            style={{ ...listSelect(isDark), width: '100%' }}
                            value={p.type}
                            onChange={(e) => updateParam(i, { type: e.target.value as ParamNodeParameter['type'] })}
                        >
                            {PARAM_TYPE_OPTIONS.map((t) => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                        <input
                            style={listInput(isDark)}
                            value={p.defaultValue ?? ''}
                            onChange={(e) => updateParam(i, { defaultValue: e.target.value })}
                            placeholder="Default"
                        />
                        <button
                            style={{
                                ...tagChip(isDark, p.required),
                                fontSize: 10, padding: '2px 6px', justifyContent: 'center',
                            }}
                            onClick={() => updateParam(i, { required: !p.required })}
                        >
                            {p.required ? '✓' : '○'}
                        </button>
                        <button style={removeBtn} onClick={() => removeParam(i)}>
                            <span className="material-icons" style={{ fontSize: 14, color: '#ef4444' }}>delete</span>
                        </button>
                    </div>
                ))}

                {config.parameters.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 20, color: isDark ? '#6b7280' : '#9ca3af', fontSize: 13, fontStyle: 'italic' }}>
                        No parameters defined — click "Add Parameter"
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
                return <ActionProperties cfg={cfg} isDark={isDark} update={update} />;
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

                {/* ─── Common: I/O Flow (hidden for Param blocks) ─── */}
                {cfg.nodeType !== 'paramNode' && (
                    <div>
                        <label style={sectionLabel(isDark)}>Data Flow</label>
                        <div style={schemaGrid}>
                            <div style={schemaCard(isDark)}>
                                <div style={schemaCardHeader(isDark)}>
                                    <span style={schemaTitle(isDark)}>Receives From</span>
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
                                    <span style={schemaTitle(isDark)}>Passes To</span>
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
