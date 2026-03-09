import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { colors } from '../../theme';
import type { WorkflowNodeData, LiveState } from '../../data/workflowData';
import { useWorkflow } from '../../context/WorkflowContext';

const stateGlow: Record<LiveState, string> = {
    idle: 'none',
    running: '0 0 0 4px rgba(59,130,246,0.4), 0 0 16px rgba(59,130,246,0.2)',
    success: '0 0 0 4px rgba(34,197,94,0.4), 0 0 16px rgba(34,197,94,0.2)',
    fail: '0 0 0 4px rgba(239,68,68,0.4), 0 0 16px rgba(239,68,68,0.2)',
    diagnosing: '0 0 0 4px rgba(251,146,60,0.4), 0 0 16px rgba(251,146,60,0.2)',
};

const stateBorderColor: Record<LiveState, string> = {
    idle: colors.nodePurple,
    running: '#3b82f6',
    success: '#22c55e',
    fail: '#ef4444',
    diagnosing: '#fb923c',
};

/**
 * D. Notification Block — Purple Bell
 * Shows: channel badge + recipient count
 */
const nodeStyle = (isDark: boolean, liveState: LiveState = 'idle'): CSSProperties => ({
    border: `2px solid ${stateBorderColor[liveState]}`,
    backgroundColor: isDark ? '#1e293b' : '#ffffff',
    width: 180,
    minHeight: 76,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    borderRadius: 10,
    padding: '8px 10px',
    boxShadow: liveState !== 'idle'
        ? stateGlow[liveState]
        : '0 2px 8px rgba(0,0,0,0.06)',
    transition: 'box-shadow 0.3s, border-color 0.3s',
    position: 'relative',
});

const iconBadge: CSSProperties = {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 22,
    height: 22,
    borderRadius: '50%',
    backgroundColor: colors.nodePurple,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
};

const labelStyle = (isDark: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 700,
    color: isDark ? '#f9a8d4' : '#be185d',
    fontFamily: "'Inter', sans-serif",
    lineHeight: 1.2,
});

const channelBadge: CSSProperties = {
    fontSize: 8,
    fontWeight: 700,
    color: '#ffffff',
    backgroundColor: '#a855f7',
    padding: '1px 6px',
    borderRadius: 3,
    marginTop: 3,
    fontFamily: "'Inter', sans-serif",
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
};

const recipientTag = (isDark: boolean): CSSProperties => ({
    fontSize: 8,
    fontWeight: 500,
    color: isDark ? '#6b7280' : '#9ca3af',
    marginTop: 2,
    fontFamily: "'Inter', sans-serif",
});

const handleStyle = { background: colors.nodePurple, width: 8, height: 8 };

export default function NotifyNode({ data, id }: NodeProps) {
    const { isDark } = useTheme();
    const { nodeConfigs } = useWorkflow();
    const d = data as WorkflowNodeData;
    const state = d.liveState || 'idle';
    const config = nodeConfigs[id]?.notificationConfig;

    const channel = config?.channel || 'Email';
    const recipientCount = config?.recipients?.length || 0;

    return (
        <div style={nodeStyle(isDark, state)}>
            <div style={iconBadge}>
                <span className="material-icons" style={{ fontSize: 14, color: '#fff' }}>notifications</span>
            </div>
            <Handle type="target" position={Position.Left} style={handleStyle} />
            <Handle type="target" position={Position.Top} id="top" style={handleStyle} />
            <span style={labelStyle(isDark)}>{d.label}</span>
            <span style={channelBadge}>{channel}</span>
            <span style={recipientTag(isDark)}>
                {recipientCount} recipient{recipientCount !== 1 ? 's' : ''}
            </span>
            <Handle type="source" position={Position.Right} style={handleStyle} />
            <Handle type="source" position={Position.Bottom} id="bottom" style={handleStyle} />
        </div>
    );
}
