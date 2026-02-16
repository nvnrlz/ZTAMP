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
    idle: colors.nodeGrey,
    running: '#3b82f6',
    success: '#22c55e',
    fail: '#ef4444',
    diagnosing: '#fb923c',
};

/**
 * E. Code Block — Grey Rectangle
 * Purpose: Custom logic and data transformation using Python 3.11
 */
const nodeStyle = (isDark: boolean, liveState: LiveState = 'idle'): CSSProperties => ({
    border: `2px solid ${stateBorderColor[liveState]}`,
    backgroundColor: isDark ? '#1e293b' : '#f9fafb',
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
    transition: 'box-shadow 0.3s, border-color 0.3s',
    position: 'relative',
});

const iconBadge: CSSProperties = {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: colors.nodeGrey,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
};

const labelStyle = (isDark: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 700,
    color: isDark ? '#d1d5db' : '#374151',
    fontFamily: "'Inter', sans-serif",
    lineHeight: 1.2,
});

const pythonTag = (isDark: boolean): CSSProperties => ({
    fontSize: 8,
    fontWeight: 600,
    color: isDark ? '#9ca3af' : '#6b7280',
    backgroundColor: isDark ? '#374151' : '#e5e7eb',
    padding: '1px 6px',
    borderRadius: 3,
    marginTop: 3,
    fontFamily: "'Inter', sans-serif",
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
});

const handleStyle = { background: colors.nodeGrey, width: 8, height: 8 };

export default function CodeNode({ data }: NodeProps) {
    const { isDark } = useTheme();
    const d = data as WorkflowNodeData;
    const state = d.liveState || 'idle';

    return (
        <div style={nodeStyle(isDark, state)}>
            <div style={iconBadge}>
                <span className="material-icons" style={{ fontSize: 14, color: '#fff' }}>terminal</span>
            </div>
            <Handle type="target" position={Position.Left} style={handleStyle} />
            <Handle type="target" position={Position.Top} id="top" style={handleStyle} />
            <span style={labelStyle(isDark)}>{d.label}</span>
            <span style={pythonTag(isDark)}>Python 3.11</span>
            <Handle type="source" position={Position.Right} style={handleStyle} />
            <Handle type="source" position={Position.Bottom} id="bottom" style={handleStyle} />
        </div>
    );
}
