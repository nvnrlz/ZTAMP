import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { colors } from '../../theme';
import type { WorkflowNodeData, LiveState } from '../../data/workflowData';
import { useWorkflow } from '../../context/WorkflowContext';

/* ─── Live state glow colors ─── */
const stateGlow: Record<LiveState, string> = {
    idle: 'none',
    running: '0 0 0 4px rgba(59,130,246,0.4), 0 0 16px rgba(59,130,246,0.2)',
    success: '0 0 0 4px rgba(34,197,94,0.4), 0 0 16px rgba(34,197,94,0.2)',
    fail: '0 0 0 4px rgba(239,68,68,0.4), 0 0 16px rgba(239,68,68,0.2)',
    diagnosing: '0 0 0 4px rgba(251,146,60,0.4), 0 0 16px rgba(251,146,60,0.2)',
};

const stateBorderColor: Record<LiveState, string> = {
    idle: colors.nodeBlue,
    running: '#3b82f6',
    success: '#22c55e',
    fail: '#ef4444',
    diagnosing: '#fb923c',
};

/**
 * A. Action Block — Blue Rectangle
 * Shows: method badge + endpoint summary
 */
const nodeStyle = (isDark: boolean, dimmed?: boolean, liveState: LiveState = 'idle'): CSSProperties => ({
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
    opacity: dimmed ? 0.5 : 1,
    transition: 'box-shadow 0.3s, border-color 0.3s',
});

const iconBadge: CSSProperties = {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 20,
    height: 20,
    borderRadius: '50%',
    backgroundColor: colors.nodeBlue,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
};

const labelStyle = (isDark: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 700,
    color: isDark ? '#93c5fd' : '#2563eb',
    fontFamily: "'Inter', sans-serif",
    lineHeight: 1.2,
});

const methodBadge = (isDark: boolean): CSSProperties => ({
    fontSize: 8,
    fontWeight: 700,
    color: '#ffffff',
    backgroundColor: '#3b82f6',
    padding: '1px 6px',
    borderRadius: 3,
    marginTop: 3,
    fontFamily: "'Inter', sans-serif",
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
});

const endpointTag = (isDark: boolean): CSSProperties => ({
    fontSize: 8,
    fontWeight: 500,
    color: isDark ? '#6b7280' : '#9ca3af',
    marginTop: 2,
    fontFamily: "'Inter', sans-serif",
    maxWidth: 150,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const handleStyle = { background: colors.nodeBlue, width: 8, height: 8 };

export default function ActionNode({ data, id }: NodeProps) {
    const { isDark } = useTheme();
    const { nodeConfigs } = useWorkflow();
    const d = data as WorkflowNodeData;
    const state = d.liveState || 'idle';
    const config = nodeConfigs[id]?.actionConfig;

    const method = config?.method || 'GET';
    const endpoint = config?.endpointOrTool;

    return (
        <div style={{ ...nodeStyle(isDark, d.dimmed, state), position: 'relative' }}>
            {/* Type icon badge */}
            <div style={iconBadge}>
                <span className="material-icons" style={{ fontSize: 12, color: '#fff' }}>search</span>
            </div>
            <Handle type="target" position={Position.Left} style={handleStyle} />
            <Handle type="target" position={Position.Top} id="top" style={handleStyle} />
            <span style={labelStyle(isDark)}>{d.label}</span>
            {method && <span style={methodBadge(isDark)}>{method}</span>}
            {endpoint && <span style={endpointTag(isDark)}>{endpoint}</span>}
            <Handle type="source" position={Position.Right} style={handleStyle} />
            <Handle type="source" position={Position.Bottom} id="bottom" style={handleStyle} />
        </div>
    );
}
