import { useState, useCallback, type CSSProperties } from 'react';
import { useTheme } from '../context/ThemeContext';
import { usePolicies, type PolicyCategory, type PolicyTarget, categoryLabels, categoryIcons, categoryColors } from '../context/PolicyContext';
import { colors, shadows, fonts } from '../theme';

/* ═══════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════ */

type CreatorStep = 'define' | 'permissions' | 'review' | 'generated';

interface AgentPermission {
    id: string;
    label: string;
    description: string;
    icon: string;
    enabled: boolean;
    category: 'execution' | 'data' | 'network' | 'workflow';
}

interface PolicyFormData {
    name: string;
    description: string;
    category: PolicyCategory;
    severity: 'critical' | 'high' | 'medium' | 'low';
    targets: PolicyTarget[];
    permissions: AgentPermission[];
    maxExecutionTime: number;
    maxMemory: string;
    maxRetries: number;
    allowExternalNetwork: boolean;
    allowFileSystem: boolean;
    requireApproval: boolean;
    approvalThreshold: number;
    dataClassification: string[];
    rateLimit: number;
    sandboxMode: 'strict' | 'standard' | 'permissive';
}

/* ═══════════════════════════════════════════════════════
   DEFAULT PERMISSIONS (for Creation Studio agent interactions)
   ═══════════════════════════════════════════════════════ */

const defaultPermissions: AgentPermission[] = [
    { id: 'exec_code', label: 'Execute Code', description: 'Allow agents to run code in sandboxed environments', icon: 'code', enabled: true, category: 'execution' },
    { id: 'exec_shell', label: 'Shell Commands', description: 'Allow agents to execute shell/terminal commands', icon: 'terminal', enabled: false, category: 'execution' },
    { id: 'exec_install', label: 'Install Packages', description: 'Allow agents to install pip/npm packages', icon: 'download', enabled: false, category: 'execution' },
    { id: 'exec_spawn', label: 'Spawn Sub-Agents', description: 'Allow agents to create and orchestrate child agents', icon: 'account_tree', enabled: true, category: 'execution' },
    { id: 'data_read', label: 'Read Files', description: 'Allow agents to read uploaded files and documents', icon: 'folder_open', enabled: true, category: 'data' },
    { id: 'data_write', label: 'Write Files', description: 'Allow agents to create or modify files', icon: 'save', enabled: true, category: 'data' },
    { id: 'data_pii', label: 'Access PII Data', description: 'Allow agents to process personally identifiable information', icon: 'fingerprint', enabled: false, category: 'data' },
    { id: 'data_export', label: 'Export Data', description: 'Allow agents to export data outside the platform', icon: 'cloud_upload', enabled: false, category: 'data' },
    { id: 'net_internal', label: 'Internal APIs', description: 'Allow agents to call internal service APIs', icon: 'lan', enabled: true, category: 'network' },
    { id: 'net_external', label: 'External APIs', description: 'Allow agents to make external HTTP requests', icon: 'public', enabled: false, category: 'network' },
    { id: 'net_websocket', label: 'WebSocket Connections', description: 'Allow agents to maintain persistent connections', icon: 'sync_alt', enabled: false, category: 'network' },
    { id: 'wf_create', label: 'Create Workflows', description: 'Allow users to design and save workflows', icon: 'add_circle', enabled: true, category: 'workflow' },
    { id: 'wf_execute', label: 'Execute Workflows', description: 'Allow users to trigger workflow execution', icon: 'play_arrow', enabled: true, category: 'workflow' },
    { id: 'wf_schedule', label: 'Schedule Workflows', description: 'Allow users to schedule recurring workflows', icon: 'schedule', enabled: false, category: 'workflow' },
    { id: 'wf_deploy', label: 'Deploy to Production', description: 'Allow users to deploy workflows to production', icon: 'rocket_launch', enabled: false, category: 'workflow' },
];

const defaultForm: PolicyFormData = {
    name: '',
    description: '',
    category: 'access',
    severity: 'medium',
    targets: ['user'],
    permissions: defaultPermissions.map((p) => ({ ...p })),
    maxExecutionTime: 30,
    maxMemory: '2Gi',
    maxRetries: 3,
    allowExternalNetwork: false,
    allowFileSystem: true,
    requireApproval: false,
    approvalThreshold: 1,
    dataClassification: ['public', 'internal'],
    rateLimit: 60,
    sandboxMode: 'standard',
};

/* ═══════════════════════════════════════════════════════
   REGO CODE GENERATOR
   ═══════════════════════════════════════════════════════ */

function generateRegoCode(form: PolicyFormData): string {
    const pkg = form.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '') || 'custom_policy';
    const enabledPerms = form.permissions.filter((p) => p.enabled);
    const disabledPerms = form.permissions.filter((p) => !p.enabled);

    let rego = `package agentic.${form.category}.${pkg}\n\n`;
    rego += `# ${form.name}\n`;
    rego += `# ${form.description}\n`;
    rego += `# Category: ${categoryLabels[form.category]} | Severity: ${form.severity}\n`;
    rego += `# Auto-generated by Policy Creator Agent\n`;
    rego += `# Generated: ${new Date().toISOString()}\n\n`;
    rego += `import future.keywords.in\n\n`;

    // Default deny
    rego += `# Default deny all actions\ndefault allow = false\n\n`;

    // Sandbox mode
    rego += `# Sandbox enforcement mode: ${form.sandboxMode}\n`;
    rego += `sandbox_mode := "${form.sandboxMode}"\n\n`;

    // Allowed permissions
    rego += `# ─── Allowed Permissions ───\n`;
    for (const p of enabledPerms) {
        rego += `allow {\n    input.action == "${p.id}"\n    input.context.sandbox_mode == sandbox_mode\n}\n\n`;
    }

    // Explicit denials for disabled permissions
    if (disabledPerms.length > 0) {
        rego += `# ─── Explicitly Denied Permissions ───\n`;
        for (const p of disabledPerms) {
            rego += `deny[msg] {\n    input.action == "${p.id}"\n    msg := sprintf("Action '%s' is not permitted by policy '${form.name}'", [input.action])\n}\n\n`;
        }
    }

    // Resource limits
    rego += `# ─── Resource Limits ───\n`;
    rego += `max_execution_seconds := ${form.maxExecutionTime}\n`;
    rego += `max_memory := "${form.maxMemory}"\n`;
    rego += `max_retries := ${form.maxRetries}\n`;
    rego += `rate_limit_per_minute := ${form.rateLimit}\n\n`;

    rego += `deny[msg] {\n    input.execution.duration_seconds > max_execution_seconds\n    msg := sprintf("Execution exceeded %d second limit", [max_execution_seconds])\n}\n\n`;

    rego += `deny[msg] {\n    input.agent.requests_last_minute > rate_limit_per_minute\n    msg := sprintf("Rate limit exceeded: %d/%d requests per minute",\n        [input.agent.requests_last_minute, rate_limit_per_minute])\n}\n\n`;

    // Network policy
    if (!form.allowExternalNetwork) {
        rego += `# ─── Network Isolation ───\ndeny[msg] {\n    input.destination.type == "external"\n    msg := sprintf("External network access denied for agent '%s'", [input.agent.name])\n}\n\n`;
    }

    // Data classification
    if (form.dataClassification.length > 0) {
        rego += `# ─── Data Classification ───\n`;
        rego += `allowed_classifications := {${form.dataClassification.map((c) => `"${c}"`).join(', ')}}\n\n`;
        rego += `deny[msg] {\n    not input.data.classification in allowed_classifications\n    msg := sprintf("Data classification '%s' is not permitted", [input.data.classification])\n}\n\n`;
    }

    // Approval chain
    if (form.requireApproval) {
        rego += `# ─── Approval Requirements ───\napproval_required := true\napproval_threshold := ${form.approvalThreshold}\n\n`;
        rego += `deny[msg] {\n    approval_required\n    input.workflow.risk_level == "high"\n    count(input.workflow.approvals) < approval_threshold\n    msg := sprintf("High-risk workflow requires %d approval(s), got %d",\n        [approval_threshold, count(input.workflow.approvals)])\n}\n\n`;
    }

    // Target enforcement
    rego += `# ─── Target Enforcement ───\n`;
    rego += `applicable_targets := {${form.targets.map((t) => `"${t}"`).join(', ')}}\n\n`;
    rego += `applies_to_target {\n    input.target.type in applicable_targets\n}\n`;

    return rego;
}

function generateJsonPolicy(form: PolicyFormData): object {
    return {
        apiVersion: 'agentic.io/v1',
        kind: 'Policy',
        metadata: {
            name: form.name,
            category: form.category,
            severity: form.severity,
            generatedBy: 'PolicyCreatorAgent',
            generatedAt: new Date().toISOString(),
        },
        spec: {
            targets: form.targets,
            sandbox: {
                mode: form.sandboxMode,
                maxExecutionTime: `${form.maxExecutionTime}s`,
                maxMemory: form.maxMemory,
                maxRetries: form.maxRetries,
            },
            permissions: {
                allowed: form.permissions.filter((p) => p.enabled).map((p) => ({
                    action: p.id,
                    label: p.label,
                    category: p.category,
                })),
                denied: form.permissions.filter((p) => !p.enabled).map((p) => ({
                    action: p.id,
                    label: p.label,
                    category: p.category,
                })),
            },
            network: {
                allowExternal: form.allowExternalNetwork,
                allowFileSystem: form.allowFileSystem,
                rateLimit: { requestsPerMinute: form.rateLimit },
            },
            data: {
                allowedClassifications: form.dataClassification,
            },
            approval: {
                required: form.requireApproval,
                threshold: form.approvalThreshold,
            },
        },
    };
}

/* ═══════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════ */

const st = {
    page: (isDark: boolean): CSSProperties => ({
        flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        backgroundColor: isDark ? colors.backgroundDark : colors.backgroundLight,
        fontFamily: fonts.display,
    }),
    topBar: (isDark: boolean): CSSProperties => ({
        padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
        backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight, flexShrink: 0,
    }),
    body: { flex: 1, overflowY: 'auto' as const, padding: 32 },
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
    textarea: (isDark: boolean): CSSProperties => ({
        width: '100%', padding: '10px 14px', borderRadius: 10, minHeight: 80, resize: 'vertical' as const,
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
    stepIndicator: (isDark: boolean, active: boolean, completed: boolean): CSSProperties => ({
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 10,
        fontSize: 13, fontWeight: active ? 600 : 500,
        color: active ? colors.primary : completed ? '#16a34a' : isDark ? '#6b7280' : '#9ca3af',
        backgroundColor: active ? isDark ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.05)' : 'transparent',
        border: `1px solid ${active ? isDark ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.15)' : 'transparent'}`,
        transition: 'all 0.2s',
    }),
    primaryBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 22px', backgroundColor: colors.primary, color: '#fff', borderRadius: 10, fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: fonts.display, boxShadow: shadows.blueMd, transition: 'background 0.15s' } as CSSProperties,
    secondaryBtn: (isDark: boolean): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 22px', backgroundColor: 'transparent', color: isDark ? '#d1d5db' : '#4b5563', borderRadius: 10, fontSize: 14, fontWeight: 500, border: `1.5px solid ${isDark ? colors.borderDark : colors.borderLight}`, cursor: 'pointer', fontFamily: fonts.display, transition: 'all 0.15s' }),
    permCard: (isDark: boolean, enabled: boolean): CSSProperties => ({
        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 12,
        backgroundColor: enabled
            ? isDark ? 'rgba(59,130,246,0.06)' : 'rgba(59,130,246,0.03)'
            : isDark ? '#111827' : '#fafafa',
        border: `1px solid ${enabled ? isDark ? 'rgba(59,130,246,0.15)' : 'rgba(59,130,246,0.1)' : isDark ? '#1f2937' : '#f3f4f6'}`,
        transition: 'all 0.15s',
    }),
};

/* ═══════════════════════════════════════════════════════
   STEP 1: DEFINE POLICY
   ═══════════════════════════════════════════════════════ */

function StepDefine({ form, setForm, isDark }: { form: PolicyFormData; setForm: React.Dispatch<React.SetStateAction<PolicyFormData>>; isDark: boolean }) {
    const categories: PolicyCategory[] = ['access', 'execution', 'data', 'workflow', 'network'];
    const severities: Array<'critical' | 'high' | 'medium' | 'low'> = ['critical', 'high', 'medium', 'low'];
    const targets: PolicyTarget[] = ['user', 'agent', 'team', 'group', 'role'];
    const sevColors: Record<string, string> = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#22c55e' };
    const targetIcons: Record<PolicyTarget, string> = { user: 'person', agent: 'smart_toy', team: 'group', group: 'groups', role: 'badge' };
    const sandboxModes: Array<'strict' | 'standard' | 'permissive'> = ['strict', 'standard', 'permissive'];
    const sandboxDesc: Record<string, string> = { strict: 'Maximum isolation, limited capabilities', standard: 'Balanced security and functionality', permissive: 'Minimal restrictions, full agent access' };
    const sandboxIcons: Record<string, string> = { strict: 'lock', standard: 'security', permissive: 'lock_open' };

    return (
        <div style={st.container}>
            {/* Info Banner */}
            <div style={{
                display: 'flex', gap: 12, padding: 16, borderRadius: 12,
                backgroundColor: isDark ? 'rgba(139,92,246,0.08)' : '#f5f3ff',
                border: `1px solid ${isDark ? 'rgba(139,92,246,0.2)' : '#ddd6fe'}`,
                fontSize: 13, color: isDark ? '#c4b5fd' : '#5b21b6', lineHeight: 1.5,
            }}>
                <span className="material-icons" style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>auto_awesome</span>
                <div>
                    Define a <strong>user-level policy</strong> that controls how agents in <strong>Creation Studio</strong> behave.
                    This policy will be compiled into OPA Rego code for enforcement.
                </div>
            </div>

            {/* Name & Description */}
            <div style={st.card(isDark)}>
                <div style={st.cardHead(isDark)}>
                    <span style={st.cardTitle}>
                        <span className="material-icons" style={{ fontSize: 16, color: colors.primary }}>edit</span>
                        Policy Identity
                    </span>
                </div>
                <div style={{ ...st.cardBody, display: 'flex', flexDirection: 'column', gap: 18 }}>
                    <div>
                        <label style={st.label(isDark)}>Policy Name</label>
                        <input style={st.input(isDark)} placeholder="e.g. Developer Agent Policy" value={form.name}
                            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            onFocus={(e) => { e.currentTarget.style.borderColor = colors.primary; }}
                            onBlur={(e) => { e.currentTarget.style.borderColor = isDark ? colors.borderDark : colors.borderLight; }}
                        />
                    </div>
                    <div>
                        <label style={st.label(isDark)}>Description</label>
                        <textarea style={st.textarea(isDark)} placeholder="Describe what this policy controls..."
                            value={form.description}
                            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                            onFocus={(e) => { e.currentTarget.style.borderColor = colors.primary; }}
                            onBlur={(e) => { e.currentTarget.style.borderColor = isDark ? colors.borderDark : colors.borderLight; }}
                        />
                    </div>
                </div>
            </div>

            {/* Category & Severity */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={st.card(isDark)}>
                    <div style={st.cardHead(isDark)}>
                        <span style={st.cardTitle}>
                            <span className="material-icons" style={{ fontSize: 16, color: colors.primary }}>category</span>
                            Category
                        </span>
                    </div>
                    <div style={{ ...st.cardBody, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {categories.map((cat) => (
                            <div key={cat} style={st.chip(isDark, form.category === cat)}
                                onClick={() => setForm((f) => ({ ...f, category: cat }))}>
                                <span className="material-icons" style={{ fontSize: 16, color: form.category === cat ? categoryColors[cat] : 'inherit' }}>
                                    {categoryIcons[cat]}
                                </span>
                                {categoryLabels[cat]}
                            </div>
                        ))}
                    </div>
                </div>
                <div style={st.card(isDark)}>
                    <div style={st.cardHead(isDark)}>
                        <span style={st.cardTitle}>
                            <span className="material-icons" style={{ fontSize: 16, color: colors.primary }}>warning</span>
                            Severity
                        </span>
                    </div>
                    <div style={{ ...st.cardBody, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {severities.map((sev) => (
                            <div key={sev} style={{ ...st.chip(isDark, form.severity === sev), borderColor: form.severity === sev ? sevColors[sev] : undefined, color: form.severity === sev ? sevColors[sev] : undefined, backgroundColor: form.severity === sev ? sevColors[sev] + '12' : undefined }}
                                onClick={() => setForm((f) => ({ ...f, severity: sev }))}>
                                {sev.charAt(0).toUpperCase() + sev.slice(1)}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Targets */}
            <div style={st.card(isDark)}>
                <div style={st.cardHead(isDark)}>
                    <span style={st.cardTitle}>
                        <span className="material-icons" style={{ fontSize: 16, color: colors.primary }}>hub</span>
                        Apply To (Targets)
                    </span>
                    <span style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af' }}>Select one or more</span>
                </div>
                <div style={{ ...st.cardBody, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {targets.map((t) => {
                        const active = form.targets.includes(t);
                        return (
                            <div key={t} style={st.chip(isDark, active)}
                                onClick={() => setForm((f) => ({
                                    ...f,
                                    targets: active ? f.targets.filter((x) => x !== t) : [...f.targets, t],
                                }))}>
                                <span className="material-icons" style={{ fontSize: 16 }}>{targetIcons[t]}</span>
                                {t.charAt(0).toUpperCase() + t.slice(1)}
                                {active && <span className="material-icons" style={{ fontSize: 14, marginLeft: 2 }}>check</span>}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Sandbox Mode */}
            <div style={st.card(isDark)}>
                <div style={st.cardHead(isDark)}>
                    <span style={st.cardTitle}>
                        <span className="material-icons" style={{ fontSize: 16, color: colors.primary }}>security</span>
                        Sandbox Mode
                    </span>
                </div>
                <div style={{ ...st.cardBody, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    {sandboxModes.map((mode) => {
                        const active = form.sandboxMode === mode;
                        return (
                            <div key={mode} style={{
                                padding: '16px', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                                border: `2px solid ${active ? colors.primary : isDark ? colors.borderDark : colors.borderLight}`,
                                backgroundColor: active ? isDark ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.04)' : 'transparent',
                                transition: 'all 0.2s',
                            }} onClick={() => setForm((f) => ({ ...f, sandboxMode: mode }))}>
                                <span className="material-icons" style={{ fontSize: 28, color: active ? colors.primary : isDark ? '#6b7280' : '#9ca3af', display: 'block', marginBottom: 8 }}>
                                    {sandboxIcons[mode]}
                                </span>
                                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: active ? colors.primary : undefined, textTransform: 'capitalize' }}>{mode}</div>
                                <div style={{ fontSize: 11, color: isDark ? '#6b7280' : '#9ca3af', lineHeight: 1.4 }}>{sandboxDesc[mode]}</div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════
   STEP 2: PERMISSIONS & LIMITS
   ═══════════════════════════════════════════════════════ */

function StepPermissions({ form, setForm, isDark }: { form: PolicyFormData; setForm: React.Dispatch<React.SetStateAction<PolicyFormData>>; isDark: boolean }) {
    const permCategories = ['execution', 'data', 'network', 'workflow'] as const;
    const permCatLabels: Record<string, string> = { execution: 'Execution', data: 'Data Access', network: 'Network', workflow: 'Workflow' };
    const permCatIcons: Record<string, string> = { execution: 'memory', data: 'storage', network: 'cloud', workflow: 'account_tree' };
    const classifications = ['public', 'internal', 'confidential', 'restricted'];

    const togglePerm = (id: string) => {
        setForm((f) => ({
            ...f,
            permissions: f.permissions.map((p) => p.id === id ? { ...p, enabled: !p.enabled } : p),
        }));
    };

    const toggleClassification = (c: string) => {
        setForm((f) => ({
            ...f,
            dataClassification: f.dataClassification.includes(c)
                ? f.dataClassification.filter((x) => x !== c)
                : [...f.dataClassification, c],
        }));
    };

    return (
        <div style={st.container}>
            {/* Permission toggles by category */}
            {permCategories.map((cat) => {
                const perms = form.permissions.filter((p) => p.category === cat);
                const enabledCount = perms.filter((p) => p.enabled).length;
                return (
                    <div key={cat} style={st.card(isDark)}>
                        <div style={st.cardHead(isDark)}>
                            <span style={st.cardTitle}>
                                <span className="material-icons" style={{ fontSize: 16, color: colors.primary }}>{permCatIcons[cat]}</span>
                                {permCatLabels[cat]} Permissions
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: isDark ? '#6b7280' : '#9ca3af' }}>
                                {enabledCount}/{perms.length} enabled
                            </span>
                        </div>
                        <div style={{ ...st.cardBody, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {perms.map((perm) => (
                                <div key={perm.id} style={st.permCard(isDark, perm.enabled)}>
                                    <span className="material-icons" style={{ fontSize: 20, color: perm.enabled ? colors.primary : isDark ? '#4b5563' : '#9ca3af' }}>
                                        {perm.icon}
                                    </span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 14, fontWeight: 500, color: perm.enabled ? undefined : isDark ? '#6b7280' : '#9ca3af' }}>{perm.label}</div>
                                        <div style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af', marginTop: 1 }}>{perm.description}</div>
                                    </div>
                                    <button style={st.toggle(perm.enabled, isDark)} onClick={() => togglePerm(perm.id)}>
                                        <div style={st.toggleDot(perm.enabled)} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}

            {/* Resource Limits */}
            <div style={st.card(isDark)}>
                <div style={st.cardHead(isDark)}>
                    <span style={st.cardTitle}>
                        <span className="material-icons" style={{ fontSize: 16, color: colors.primary }}>tune</span>
                        Resource Limits
                    </span>
                </div>
                <div style={{ ...st.cardBody, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                    <div>
                        <label style={st.label(isDark)}>Max Execution Time (seconds)</label>
                        <input type="number" style={st.input(isDark)} value={form.maxExecutionTime}
                            onChange={(e) => setForm((f) => ({ ...f, maxExecutionTime: parseInt(e.target.value) || 30 }))}
                        />
                    </div>
                    <div>
                        <label style={st.label(isDark)}>Max Memory</label>
                        <select style={st.input(isDark)} value={form.maxMemory}
                            onChange={(e) => setForm((f) => ({ ...f, maxMemory: e.target.value }))}>
                            <option value="512Mi">512 MB</option>
                            <option value="1Gi">1 GB</option>
                            <option value="2Gi">2 GB</option>
                            <option value="4Gi">4 GB</option>
                            <option value="8Gi">8 GB</option>
                        </select>
                    </div>
                    <div>
                        <label style={st.label(isDark)}>Max Retries</label>
                        <input type="number" style={st.input(isDark)} value={form.maxRetries}
                            onChange={(e) => setForm((f) => ({ ...f, maxRetries: parseInt(e.target.value) || 3 }))}
                        />
                    </div>
                    <div>
                        <label style={st.label(isDark)}>Rate Limit (requests/min)</label>
                        <input type="number" style={st.input(isDark)} value={form.rateLimit}
                            onChange={(e) => setForm((f) => ({ ...f, rateLimit: parseInt(e.target.value) || 60 }))}
                        />
                    </div>
                </div>
            </div>

            {/* Data Classification */}
            <div style={st.card(isDark)}>
                <div style={st.cardHead(isDark)}>
                    <span style={st.cardTitle}>
                        <span className="material-icons" style={{ fontSize: 16, color: colors.primary }}>shield</span>
                        Data Classification Access
                    </span>
                </div>
                <div style={{ ...st.cardBody, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {classifications.map((c) => {
                        const active = form.dataClassification.includes(c);
                        const cColors: Record<string, string> = { public: '#22c55e', internal: '#3b82f6', confidential: '#f59e0b', restricted: '#ef4444' };
                        return (
                            <div key={c} style={{ ...st.chip(isDark, active), borderColor: active ? cColors[c] : undefined, color: active ? cColors[c] : undefined, backgroundColor: active ? cColors[c] + '12' : undefined }}
                                onClick={() => toggleClassification(c)}>
                                <span className="material-icons" style={{ fontSize: 14 }}>{active ? 'check_circle' : 'radio_button_unchecked'}</span>
                                {c.charAt(0).toUpperCase() + c.slice(1)}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Approval */}
            <div style={st.card(isDark)}>
                <div style={st.cardHead(isDark)}>
                    <span style={st.cardTitle}>
                        <span className="material-icons" style={{ fontSize: 16, color: colors.primary }}>approval</span>
                        Approval Requirements
                    </span>
                    <button style={st.toggle(form.requireApproval, isDark)}
                        onClick={() => setForm((f) => ({ ...f, requireApproval: !f.requireApproval }))}>
                        <div style={st.toggleDot(form.requireApproval)} />
                    </button>
                </div>
                {form.requireApproval && (
                    <div style={{ ...st.cardBody, display: 'flex', gap: 18, alignItems: 'flex-end' }}>
                        <div style={{ flex: 1 }}>
                            <label style={st.label(isDark)}>Approval Threshold (# of approvals needed)</label>
                            <input type="number" style={st.input(isDark)} value={form.approvalThreshold} min={1} max={5}
                                onChange={(e) => setForm((f) => ({ ...f, approvalThreshold: parseInt(e.target.value) || 1 }))}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════
   STEP 3: REVIEW JSON & REGO
   ═══════════════════════════════════════════════════════ */

function StepReview({ form, isDark }: { form: PolicyFormData; isDark: boolean }) {
    const [viewMode, setViewMode] = useState<'json' | 'rego'>('json');
    const jsonPolicy = generateJsonPolicy(form);
    const regoCode = generateRegoCode(form);

    return (
        <div style={st.container}>
            {/* Generation banner */}
            <div style={{
                display: 'flex', gap: 12, padding: 16, borderRadius: 12,
                backgroundColor: isDark ? 'rgba(16,185,129,0.08)' : '#ecfdf5',
                border: `1px solid ${isDark ? 'rgba(16,185,129,0.2)' : '#a7f3d0'}`,
                fontSize: 13, color: isDark ? '#6ee7b7' : '#065f46', lineHeight: 1.5,
            }}>
                <span className="material-icons" style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>check_circle</span>
                <div>
                    <strong>Policy Generated!</strong> Review the JSON definition and Rego code below.
                    Once confirmed, click <strong>"Create Policy"</strong> to add it to your policy library.
                </div>
            </div>

            {/* Toggle JSON / Rego */}
            <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12, backgroundColor: isDark ? '#111827' : '#f3f4f6', width: 'fit-content' }}>
                {(['json', 'rego'] as const).map((mode) => (
                    <button key={mode} onClick={() => setViewMode(mode)} style={{
                        padding: '8px 20px', borderRadius: 10, fontSize: 13, fontWeight: viewMode === mode ? 600 : 500,
                        border: 'none', cursor: 'pointer', fontFamily: fonts.display,
                        backgroundColor: viewMode === mode ? colors.primary : 'transparent',
                        color: viewMode === mode ? '#fff' : isDark ? '#9ca3af' : '#6b7280',
                        transition: 'all 0.15s',
                    }}>
                        <span className="material-icons" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }}>
                            {mode === 'json' ? 'data_object' : 'code'}
                        </span>
                        {mode === 'json' ? 'JSON Definition' : 'Rego Code (OPA)'}
                    </button>
                ))}
            </div>

            {/* Code block */}
            <div style={st.card(isDark)}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px',
                    backgroundColor: isDark ? '#161b22' : '#f6f8fa',
                    borderBottom: `1px solid ${isDark ? '#30363d' : '#d0d7de'}`,
                    fontSize: 12, fontWeight: 600, color: isDark ? '#c9d1d9' : '#24292f',
                }}>
                    <span className="material-icons" style={{ fontSize: 14, color: '#f59e0b' }}>
                        {viewMode === 'json' ? 'data_object' : 'code'}
                    </span>
                    {viewMode === 'json'
                        ? `${(form.name || 'policy').toLowerCase().replace(/\s+/g, '_')}.json`
                        : `${(form.name || 'policy').toLowerCase().replace(/\s+/g, '_')}.rego`}
                </div>
                <pre style={{
                    margin: 0, padding: 20,
                    backgroundColor: isDark ? '#0d1117' : '#ffffff',
                    color: isDark ? '#c9d1d9' : '#24292f',
                    fontSize: 12, lineHeight: 1.6,
                    fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
                    overflowX: 'auto', maxHeight: 500,
                }}>
                    {viewMode === 'json' ? JSON.stringify(jsonPolicy, null, 2) : regoCode}
                </pre>
            </div>

            {/* Summary stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {[
                    { icon: 'check_circle', label: 'Allowed', value: form.permissions.filter((p) => p.enabled).length, color: '#16a34a' },
                    { icon: 'block', label: 'Denied', value: form.permissions.filter((p) => !p.enabled).length, color: '#ef4444' },
                    { icon: 'hub', label: 'Targets', value: form.targets.length, color: '#8b5cf6' },
                    { icon: 'security', label: 'Sandbox', value: form.sandboxMode, color: colors.primary },
                ].map((s2) => (
                    <div key={s2.label} style={{
                        ...st.card(isDark), padding: 16,
                        display: 'flex', flexDirection: 'column', gap: 6,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="material-icons" style={{ fontSize: 16, color: s2.color }}>{s2.icon}</span>
                            <span style={{ fontSize: 11, fontWeight: 500, color: isDark ? '#9ca3af' : '#6b7280' }}>{s2.label}</span>
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, textTransform: 'capitalize' }}>{s2.value}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
   ═══════════════════════════════════════════════════════ */

const steps: { key: CreatorStep; label: string; icon: string }[] = [
    { key: 'define', label: 'Define Policy', icon: 'edit' },
    { key: 'permissions', label: 'Permissions & Limits', icon: 'toggle_on' },
    { key: 'review', label: 'Review & Generate', icon: 'code' },
];

export default function PolicyCreatorPage() {
    const { isDark } = useTheme();
    const { addPolicy } = usePolicies();
    const [currentStep, setCurrentStep] = useState<CreatorStep>('define');
    const [form, setForm] = useState<PolicyFormData>({ ...defaultForm, permissions: defaultPermissions.map((p) => ({ ...p })) });
    const [created, setCreated] = useState(false);

    const stepIndex = steps.findIndex((s) => s.key === currentStep);
    const canProceed = currentStep === 'define' ? form.name.trim().length > 0 && form.targets.length > 0 : true;

    const handleNext = useCallback(() => {
        if (currentStep === 'define') setCurrentStep('permissions');
        else if (currentStep === 'permissions') setCurrentStep('review');
    }, [currentStep]);

    const handleBack = useCallback(() => {
        if (currentStep === 'permissions') setCurrentStep('define');
        else if (currentStep === 'review') setCurrentStep('permissions');
    }, [currentStep]);

    const handleCreate = useCallback(() => {
        const regoCode = generateRegoCode(form);
        addPolicy({
            name: form.name,
            description: form.description,
            category: form.category,
            status: 'draft',
            targets: form.targets,
            regoCode,
            createdBy: 'Policy Creator Agent',
            severity: form.severity,
        });
        setCreated(true);
    }, [form, addPolicy]);

    if (created) {
        return (
            <div style={st.page(isDark)}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ textAlign: 'center', maxWidth: 480 }}>
                        <div style={{
                            width: 72, height: 72, borderRadius: '50%', margin: '0 auto 20px',
                            backgroundColor: isDark ? 'rgba(16,185,129,0.1)' : '#ecfdf5',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <span className="material-icons" style={{ fontSize: 36, color: '#10b981' }}>check_circle</span>
                        </div>
                        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Policy Created!</h2>
                        <p style={{ fontSize: 14, color: isDark ? '#9ca3af' : '#6b7280', lineHeight: 1.6, marginBottom: 24 }}>
                            <strong>{form.name}</strong> has been added to your policy library as a <strong>Draft</strong>.
                            You can activate it and assign it to users from the Policy Settings page.
                        </p>
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                            <button style={st.primaryBtn} onClick={() => { setForm({ ...defaultForm, permissions: defaultPermissions.map((p) => ({ ...p })) }); setCreated(false); setCurrentStep('define'); }}>
                                <span className="material-icons" style={{ fontSize: 16 }}>add</span>
                                Create Another
                            </button>
                            <button style={st.secondaryBtn(isDark)} onClick={() => window.location.href = '/settings'}>
                                <span className="material-icons" style={{ fontSize: 16 }}>policy</span>
                                View Policies
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={st.page(isDark)}>
            {/* Top Bar */}
            <div style={st.topBar(isDark)}>
                <div>
                    <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                        <span className="material-icons" style={{ fontSize: 22, verticalAlign: 'middle', marginRight: 8, color: colors.primary }}>add_moderator</span>
                        Policy Creator
                    </h2>
                    <p style={{ fontSize: 13, color: isDark ? '#6b7280' : '#9ca3af', margin: '4px 0 0 30px' }}>
                        Create user-level agent policies for Creation Studio
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    {steps.map((s, i) => (
                        <div key={s.key} style={st.stepIndicator(isDark, currentStep === s.key, i < stepIndex)}>
                            <span className="material-icons" style={{ fontSize: 16 }}>
                                {i < stepIndex ? 'check_circle' : s.icon}
                            </span>
                            {s.label}
                        </div>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div style={st.body}>
                {currentStep === 'define' && <StepDefine form={form} setForm={setForm} isDark={isDark} />}
                {currentStep === 'permissions' && <StepPermissions form={form} setForm={setForm} isDark={isDark} />}
                {currentStep === 'review' && <StepReview form={form} isDark={isDark} />}
            </div>

            {/* Bottom Actions */}
            <div style={{
                padding: '16px 32px', borderTop: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight, flexShrink: 0,
            }}>
                <div>
                    {stepIndex > 0 && (
                        <button style={st.secondaryBtn(isDark)} onClick={handleBack}>
                            <span className="material-icons" style={{ fontSize: 16 }}>arrow_back</span>
                            Back
                        </button>
                    )}
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                    {currentStep === 'review' ? (
                        <button style={{ ...st.primaryBtn, backgroundColor: '#16a34a', boxShadow: '0 4px 6px -1px rgba(22,163,106,0.25)' }} onClick={handleCreate}>
                            <span className="material-icons" style={{ fontSize: 16 }}>add_moderator</span>
                            Create Policy
                        </button>
                    ) : (
                        <button style={{ ...st.primaryBtn, opacity: canProceed ? 1 : 0.5, pointerEvents: canProceed ? 'auto' : 'none' }} onClick={handleNext}>
                            Next
                            <span className="material-icons" style={{ fontSize: 16 }}>arrow_forward</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
