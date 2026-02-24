import { useState, type CSSProperties } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { useAudit } from '../../context/AuditContext';
import { colors, shadows, fonts } from '../../theme';

/* ─── Shared modal styles ─── */
const overlay: CSSProperties = {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
    backdropFilter: 'blur(4px)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const modalBox = (isDark: boolean): CSSProperties => ({
    backgroundColor: isDark ? '#1f2937' : '#ffffff',
    borderRadius: 20, padding: 28, width: 480, maxWidth: '90vw',
    boxShadow: shadows.overlay, border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    fontFamily: fonts.display, maxHeight: '80vh', overflow: 'auto',
});

const modalTitle: CSSProperties = { fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 };
const modalSub = (isDark: boolean): CSSProperties => ({ fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280', marginBottom: 20 });

const inputStyle = (isDark: boolean): CSSProperties => ({
    width: '100%', padding: '10px 14px', borderRadius: 10, fontSize: 13, fontFamily: fonts.display,
    border: `1.5px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    backgroundColor: isDark ? '#111827' : '#f9fafb', color: isDark ? '#e5e7eb' : '#1f2937',
    outline: 'none', transition: 'border-color 0.15s', boxSizing: 'border-box' as const,
});

const selectStyle = (isDark: boolean): CSSProperties => ({ ...inputStyle(isDark), cursor: 'pointer' });

const label = (isDark: boolean): CSSProperties => ({
    fontSize: 12, fontWeight: 600, color: isDark ? '#d1d5db' : '#374151',
    marginBottom: 6, display: 'block', textTransform: 'uppercase' as const, letterSpacing: '0.04em',
});

const btnRow: CSSProperties = { display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 };

const cancelBtn = (isDark: boolean): CSSProperties => ({
    padding: '10px 20px', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer',
    fontFamily: fonts.display, border: `1px solid ${isDark ? '#374151' : '#d1d5db'}`,
    backgroundColor: isDark ? '#374151' : '#f3f4f6', color: isDark ? '#d1d5db' : '#4b5563',
});

const primaryBtn = (accentColor: string): CSSProperties => ({
    padding: '10px 20px', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer',
    fontFamily: fonts.display, border: 'none', backgroundColor: accentColor, color: '#ffffff',
    display: 'flex', alignItems: 'center', gap: 6, boxShadow: `0 4px 14px ${accentColor}40`,
});

const fieldGroup: CSSProperties = { marginBottom: 16 };

interface WfInfo { id: string; name: string; }

/* ═══ SHARE MODAL ═══ */
export function ShareModal({ wf, onClose }: { wf: WfInfo; onClose: () => void }) {
    const { isDark } = useTheme();
    const { addEntry } = useAudit();
    const [recipient, setRecipient] = useState('');
    const [access, setAccess] = useState<'viewer' | 'editor' | 'executor' | 'auditor'>('viewer');
    const [message, setMessage] = useState('');
    const [done, setDone] = useState(false);

    const accessDescriptions: Record<string, string> = {
        viewer: 'Can view but not modify. Suitable for auditing purposes.',
        editor: 'Can view and edit the workflow nodes and configuration.',
        executor: 'Can view and execute the workflow but not modify it.',
        auditor: 'Read-only access for compliance and governance review.',
    };

    const handleShare = () => {
        if (!recipient.trim()) return;
        addEntry({
            domain: 'workflow', action: 'shared', resourceName: wf.name, resourceId: wf.id,
            actor: 'John D.', actorRole: 'developer',
            details: `Shared with ${recipient} as ${access}${message ? ` — "${message}"` : ''}`,
            metadata: { sharedWith: recipient, accessLevel: access },
        });
        setDone(true);
        setTimeout(onClose, 1200);
    };

    return (
        <div style={overlay} onClick={onClose}>
            <div style={modalBox(isDark)} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: isDark ? 'rgba(124,58,237,0.15)' : '#ede9fe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span className="material-icons" style={{ fontSize: 22, color: '#7c3aed' }}>share</span>
                    </div>
                    <div>
                        <div style={modalTitle}>Share Workflow</div>
                        <div style={modalSub(isDark)}>{wf.name}</div>
                    </div>
                </div>

                {done ? (
                    <div style={{ textAlign: 'center', padding: 30 }}>
                        <span className="material-icons" style={{ fontSize: 48, color: '#10b981', display: 'block', marginBottom: 12 }}>check_circle</span>
                        <div style={{ fontSize: 16, fontWeight: 600 }}>Shared successfully!</div>
                        <div style={{ fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280', marginTop: 4 }}>{recipient} now has {access} access</div>
                    </div>
                ) : (
                    <>
                        <div style={fieldGroup}>
                            <span style={label(isDark)}>Share With</span>
                            <input style={inputStyle(isDark)} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Enter name or email..." />
                        </div>
                        <div style={fieldGroup}>
                            <span style={label(isDark)}>Access Level</span>
                            <select style={selectStyle(isDark)} value={access} onChange={(e) => setAccess(e.target.value as typeof access)}>
                                <option value="viewer">👁 Viewer — Read-only</option>
                                <option value="editor">✏️ Editor — Can modify</option>
                                <option value="executor">▶️ Executor — Can run</option>
                                <option value="auditor">🔍 Auditor — Compliance</option>
                            </select>
                            <div style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af', marginTop: 6, fontStyle: 'italic' }}>{accessDescriptions[access]}</div>
                        </div>
                        <div style={fieldGroup}>
                            <span style={label(isDark)}>Message (optional)</span>
                            <textarea style={{ ...inputStyle(isDark), height: 60, resize: 'vertical' as const }} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Add a note for the recipient..." />
                        </div>
                        <div style={btnRow}>
                            <button style={cancelBtn(isDark)} onClick={onClose}>Cancel</button>
                            <button style={primaryBtn('#7c3aed')} onClick={handleShare} disabled={!recipient.trim()}>
                                <span className="material-icons" style={{ fontSize: 16 }}>send</span> Share
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

/* ═══ SCHEDULE MODAL ═══ */
export function ScheduleModal({ wf, onClose }: { wf: WfInfo; onClose: () => void }) {
    const { isDark } = useTheme();
    const { addEntry } = useAudit();
    const [frequency, setFrequency] = useState<'once' | 'daily' | 'weekly' | 'monthly' | 'cron'>('daily');
    const [time, setTime] = useState('08:00');
    const [dayOfWeek, setDayOfWeek] = useState('monday');
    const [cronExpr, setCronExpr] = useState('0 8 * * 1');
    const [timezone, setTimezone] = useState('UTC');
    const [done, setDone] = useState(false);

    const handleSchedule = () => {
        const desc = frequency === 'cron' ? `Cron: ${cronExpr}` : `${frequency} at ${time} ${timezone}`;
        addEntry({
            domain: 'workflow', action: 'scheduled', resourceName: wf.name, resourceId: wf.id,
            actor: 'John D.', actorRole: 'developer', details: `Scheduled — ${desc}`,
            metadata: { frequency, time, timezone },
        });
        setDone(true);
        setTimeout(onClose, 1200);
    };

    return (
        <div style={overlay} onClick={onClose}>
            <div style={modalBox(isDark)} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: isDark ? 'rgba(217,119,6,0.15)' : '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span className="material-icons" style={{ fontSize: 22, color: '#d97706' }}>schedule</span>
                    </div>
                    <div><div style={modalTitle}>Schedule Workflow</div><div style={modalSub(isDark)}>{wf.name}</div></div>
                </div>
                {done ? (
                    <div style={{ textAlign: 'center', padding: 30 }}>
                        <span className="material-icons" style={{ fontSize: 48, color: '#d97706', display: 'block', marginBottom: 12 }}>event_available</span>
                        <div style={{ fontSize: 16, fontWeight: 600 }}>Schedule set!</div>
                    </div>
                ) : (
                    <>
                        <div style={fieldGroup}>
                            <span style={label(isDark)}>Frequency</span>
                            <select style={selectStyle(isDark)} value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
                                <option value="once">Run Once</option><option value="daily">Daily</option>
                                <option value="weekly">Weekly</option><option value="monthly">Monthly</option>
                                <option value="cron">Custom Cron</option>
                            </select>
                        </div>
                        {frequency === 'cron' ? (
                            <div style={fieldGroup}><span style={label(isDark)}>Cron Expression</span><input style={inputStyle(isDark)} value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} placeholder="0 8 * * 1" /></div>
                        ) : (
                            <>
                                <div style={fieldGroup}><span style={label(isDark)}>Time</span><input style={inputStyle(isDark)} type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
                                {frequency === 'weekly' && (
                                    <div style={fieldGroup}><span style={label(isDark)}>Day of Week</span>
                                        <select style={selectStyle(isDark)} value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
                                            {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                                        </select>
                                    </div>
                                )}
                            </>
                        )}
                        <div style={fieldGroup}><span style={label(isDark)}>Timezone</span>
                            <select style={selectStyle(isDark)} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                                {['UTC', 'US/Eastern', 'US/Pacific', 'Europe/London', 'Asia/Tokyo'].map(tz => <option key={tz} value={tz}>{tz}</option>)}
                            </select>
                        </div>
                        <div style={btnRow}><button style={cancelBtn(isDark)} onClick={onClose}>Cancel</button><button style={primaryBtn('#d97706')} onClick={handleSchedule}><span className="material-icons" style={{ fontSize: 16 }}>event</span>Schedule</button></div>
                    </>
                )}
            </div>
        </div>
    );
}

/* ═══ EXECUTE MODAL ═══ */
export function ExecuteModal({ wf, onClose }: { wf: WfInfo; onClose: () => void }) {
    const { isDark } = useTheme();
    const { addEntry } = useAudit();
    const [env, setEnv] = useState<'development' | 'staging' | 'production'>('development');
    const [running, setRunning] = useState(false);
    const [done, setDone] = useState(false);
    const [elapsed, setElapsed] = useState('');

    const handleExecute = () => {
        setRunning(true);
        const dur = (Math.random() * 8 + 2).toFixed(1);
        setTimeout(() => {
            addEntry({
                domain: 'workflow', action: 'executed', resourceName: wf.name, resourceId: wf.id,
                actor: 'John D.', actorRole: 'developer', details: `Manual execution in ${env} — completed in ${dur}s`,
                metadata: { environment: env, duration: `${dur}s`, status: 'success' },
            });
            setElapsed(dur);
            setRunning(false);
            setDone(true);
            setTimeout(onClose, 1500);
        }, 2000);
    };

    return (
        <div style={overlay} onClick={onClose}>
            <div style={modalBox(isDark)} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: isDark ? 'rgba(5,150,105,0.15)' : '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span className="material-icons" style={{ fontSize: 22, color: '#059669' }}>play_arrow</span>
                    </div>
                    <div><div style={modalTitle}>Execute Workflow</div><div style={modalSub(isDark)}>{wf.name}</div></div>
                </div>
                {done ? (
                    <div style={{ textAlign: 'center', padding: 30 }}>
                        <span className="material-icons" style={{ fontSize: 48, color: '#10b981', display: 'block', marginBottom: 12 }}>task_alt</span>
                        <div style={{ fontSize: 16, fontWeight: 600 }}>Execution complete!</div>
                        <div style={{ fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280', marginTop: 4 }}>Finished in {elapsed}s</div>
                    </div>
                ) : running ? (
                    <div style={{ textAlign: 'center', padding: 30 }}>
                        <span className="material-icons" style={{ fontSize: 48, color: colors.primary, animation: 'spin 1s linear infinite', display: 'block', marginBottom: 12 }}>autorenew</span>
                        <div style={{ fontSize: 16, fontWeight: 600 }}>Running...</div>
                        <div style={{ fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280', marginTop: 4 }}>Executing in {env} environment</div>
                    </div>
                ) : (
                    <>
                        <div style={fieldGroup}>
                            <span style={label(isDark)}>Environment</span>
                            <select style={selectStyle(isDark)} value={env} onChange={(e) => setEnv(e.target.value as typeof env)}>
                                <option value="development">🧪 Development</option>
                                <option value="staging">🔶 Staging</option>
                                <option value="production">🔴 Production</option>
                            </select>
                        </div>
                        {env === 'production' && (
                            <div style={{ padding: 12, borderRadius: 10, backgroundColor: isDark ? '#7f1d1d30' : '#fee2e2', border: '1px solid #fca5a5', fontSize: 12, color: isDark ? '#fca5a5' : '#dc2626', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span className="material-icons" style={{ fontSize: 16 }}>warning</span>
                                Production execution requires approval chain. This may be subject to policy review.
                            </div>
                        )}
                        <div style={btnRow}><button style={cancelBtn(isDark)} onClick={onClose}>Cancel</button><button style={primaryBtn('#059669')} onClick={handleExecute}><span className="material-icons" style={{ fontSize: 16 }}>play_arrow</span>Execute</button></div>
                    </>
                )}
            </div>
        </div>
    );
}

/* ═══ VIEW CODE MODAL ═══ */
export function ViewCodeModal({ wf, onClose }: { wf: WfInfo; onClose: () => void }) {
    const { isDark } = useTheme();
    const { addEntry } = useAudit();
    const [copied, setCopied] = useState(false);

    const sampleCode = `// Workflow: ${wf.name}\n// Auto-generated workflow definition\n\nimport { WorkflowEngine } from '@agentic/core';\n\nconst workflow = new WorkflowEngine('${wf.id}');\n\nworkflow.define({\n  name: '${wf.name}',\n  version: 1,\n  steps: [\n    { id: 'step-1', type: 'context', action: 'fetch_data' },\n    { id: 'step-2', type: 'conditional', condition: 'data.valid === true' },\n    { id: 'step-3', type: 'action', action: 'process_results' },\n    { id: 'step-4', type: 'notify', channel: 'slack', template: 'completion' },\n  ],\n  retryPolicy: { maxRetries: 3, backoff: 'exponential' },\n});\n\nexport default workflow;`;

    useState(() => {
        addEntry({ domain: 'workflow', action: 'viewed_code', resourceName: wf.name, resourceId: wf.id, actor: 'John D.', actorRole: 'developer', details: 'Viewed auto-generated workflow code' });
    });

    const handleCopy = () => { navigator.clipboard.writeText(sampleCode); setCopied(true); setTimeout(() => setCopied(false), 2000); };

    return (
        <div style={overlay} onClick={onClose}>
            <div style={{ ...modalBox(isDark), width: 640 }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: isDark ? 'rgba(79,70,229,0.15)' : '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="material-icons" style={{ fontSize: 22, color: '#4f46e5' }}>code</span>
                        </div>
                        <div><div style={modalTitle}>View Code</div><div style={modalSub(isDark)}>{wf.name}</div></div>
                    </div>
                    <button style={{ ...cancelBtn(isDark), padding: '6px 12px', fontSize: 12 }} onClick={handleCopy}>
                        <span className="material-icons" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }}>{copied ? 'check' : 'content_copy'}</span>
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                </div>
                <pre style={{ padding: 16, borderRadius: 12, backgroundColor: isDark ? '#0d1117' : '#f6f8fa', border: `1px solid ${isDark ? '#30363d' : '#d0d7de'}`, fontSize: 12, lineHeight: 1.6, overflow: 'auto', maxHeight: 380, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", color: isDark ? '#c9d1d9' : '#24292f', margin: 0 }}>
                    {sampleCode}
                </pre>
                <div style={{ ...btnRow, marginTop: 16 }}><button style={cancelBtn(isDark)} onClick={onClose}>Close</button></div>
            </div>
        </div>
    );
}

/* ═══ ARCHIVE MODAL ═══ */
export function ArchiveModal({ wf, onClose, onArchive }: { wf: WfInfo; onClose: () => void; onArchive: () => void }) {
    const { isDark } = useTheme();
    const { addEntry } = useAudit();

    const handleArchive = () => {
        addEntry({ domain: 'workflow', action: 'archived', resourceName: wf.name, resourceId: wf.id, actor: 'John D.', actorRole: 'developer', details: 'Archived workflow' });
        onArchive();
        onClose();
    };

    return (
        <div style={overlay} onClick={onClose}>
            <div style={modalBox(isDark)} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: isDark ? 'rgba(107,114,128,0.15)' : '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span className="material-icons" style={{ fontSize: 22, color: '#6b7280' }}>archive</span>
                    </div>
                    <div><div style={modalTitle}>Archive Workflow</div><div style={modalSub(isDark)}>This will move the workflow to archived state</div></div>
                </div>
                <div style={{ padding: 14, borderRadius: 12, backgroundColor: isDark ? '#111827' : '#f9fafb', border: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`, marginBottom: 16 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{wf.name}</div>
                    <div style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af' }}>Archived workflows can be restored later but will not appear in the active library.</div>
                </div>
                <div style={btnRow}><button style={cancelBtn(isDark)} onClick={onClose}>Cancel</button><button style={primaryBtn('#6b7280')} onClick={handleArchive}><span className="material-icons" style={{ fontSize: 16 }}>archive</span>Archive</button></div>
            </div>
        </div>
    );
}
