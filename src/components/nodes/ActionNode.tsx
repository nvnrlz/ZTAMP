import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { colors } from '../../theme';
import type { WorkflowNodeData, LiveState } from '../../data/workflowData';

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
 * A. Primary Action Block — Blue Rectangle
 * Purpose: Initial action, context gathering, and RAG data injection
 */
const nodeStyle = (isDark: boolean, dimmed?: boolean, liveState: LiveState = 'idle'): CSSProperties => ({
    border: `2px solid ${stateBorderColor[liveState]}`,
    backgroundColor: isDark ? '#1e293b' : '#ffffff',
    width: 160,
    height: 76,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    borderRadius: 10,
    padding: '4px 8px',
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

const subLabelStyle: CSSProperties = {
    fontSize: 9,
    color: '#6b7280',
    marginTop: 2,
    fontFamily: "'Inter', sans-serif",
};

const handleStyle = { background: colors.nodeBlue, width: 8, height: 8 };

export default function ActionNode({ data }: NodeProps) {
    const { isDark } = useTheme();
    const d = data as WorkflowNodeData;
    const state = d.liveState || 'idle';

    return (
        <div style={{ ...nodeStyle(isDark, d.dimmed, state), position: 'relative' }}>
            {/* Type icon badge */}
            <div style={iconBadge}>
                <span className="material-icons" style={{ fontSize: 12, color: '#fff' }}>search</span>
            </div>
            <Handle type="target" position={Position.Left} style={handleStyle} />
            <Handle type="target" position={Position.Top} id="top" style={handleStyle} />
            <span style={labelStyle(isDark)}>{d.label}</span>
            {d.subLabel && <span style={subLabelStyle}>{d.subLabel}</span>}
            <Handle type="source" position={Position.Right} style={handleStyle} />
            <Handle type="source" position={Position.Bottom} id="bottom" style={handleStyle} />
        </div>
    );
}
