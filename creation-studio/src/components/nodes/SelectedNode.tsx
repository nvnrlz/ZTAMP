import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { colors, shadows } from '../../theme';
import type { WorkflowNodeData } from '../../data/workflowData';

const nodeStyle = (isDark: boolean): CSSProperties => ({
    border: `2px solid ${colors.primary}`,
    backgroundColor: isDark ? '#1f2937' : '#eff6ff',
    width: 140,
    height: 72,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    borderRadius: 6,
    padding: 4,
    boxShadow: shadows.glow,
    transform: 'scale(1.05)',
    transition: 'all 0.2s ease',
    position: 'relative',
    zIndex: 30,
});

const badgeStyle: CSSProperties = {
    position: 'absolute',
    top: -14,
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: colors.primary,
    color: '#ffffff',
    fontSize: 10,
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 2,
    paddingBottom: 2,
    borderRadius: 9999,
    fontWeight: 700,
    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
    whiteSpace: 'nowrap',
    zIndex: 40,
};

const labelStyle = (isDark: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 700,
    color: isDark ? '#60a5fa' : colors.primary,
    fontFamily: "'Inter', sans-serif",
});

const subLabelStyle: CSSProperties = {
    fontSize: 9,
    color: colors.textMuted,
    marginTop: 4,
};

export default function SelectedNode({ data }: NodeProps) {
    const { isDark } = useTheme();
    const d = data as WorkflowNodeData;
    return (
        <div style={nodeStyle(isDark)}>
            <div style={badgeStyle}>Selected</div>
            <Handle type="target" position={Position.Top} style={{ background: colors.primary }} />
            <Handle type="target" position={Position.Left} id="left" style={{ background: colors.primary }} />
            <span style={labelStyle(isDark)}>{d.label}</span>
            {d.subLabel && <span style={subLabelStyle}>{d.subLabel}</span>}
            <Handle type="source" position={Position.Right} style={{ background: colors.primary }} />
            <Handle type="source" position={Position.Bottom} id="bottom" style={{ background: colors.primary }} />
        </div>
    );
}
