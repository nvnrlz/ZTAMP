import type { CSSProperties } from 'react';
import { useTheme } from '../context/ThemeContext';
import { colors } from '../theme';
import NavSidebar from './NavSidebar';

const headerStyle = (isDark: boolean): CSSProperties => ({
    height: 56,
    backgroundColor: isDark ? colors.surfaceDark : colors.surfaceLight,
    borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    flexShrink: 0,
    zIndex: 20,
    position: 'relative',
    fontFamily: "'Inter', sans-serif",
});

const leftGroup: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
};

const logoBox = (isDark: boolean): CSSProperties => ({
    width: 32,
    height: 32,
    backgroundColor: isDark ? '#ffffff' : '#000000',
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: isDark ? '#000000' : '#ffffff',
});

const titleStyle: CSSProperties = {
    fontWeight: 600,
    fontSize: 18,
    letterSpacing: '-0.025em',
};

const rightGroup: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
};

const docLink = (isDark: boolean): CSSProperties => ({
    fontSize: 14,
    fontWeight: 500,
    color: isDark ? colors.textMutedLight : colors.textMuted,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: "'Inter', sans-serif",
});

const divider = (isDark: boolean): CSSProperties => ({
    width: 1,
    height: 16,
    backgroundColor: isDark ? '#374151' : '#d1d5db',
});

const avatarStyle = (isDark: boolean): CSSProperties => ({
    width: 32,
    height: 32,
    borderRadius: '50%',
    backgroundColor: isDark ? '#1e3a5f' : '#dbeafe',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: isDark ? '#93c5fd' : '#2563eb',
    fontWeight: 700,
    fontSize: 11,
    fontFamily: "'Inter', sans-serif",
});

const iconBtn = (isDark: boolean): CSSProperties => ({
    padding: 8,
    borderRadius: '50%',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: isDark ? colors.textMutedLight : colors.textMuted,
    display: 'flex',
    alignItems: 'center',
    transition: 'background 0.15s',
});

export default function Header() {
    const { isDark, toggle } = useTheme();

    return (
        <header style={headerStyle(isDark)}>
            <div style={leftGroup}>
                <NavSidebar />
                <div style={logoBox(isDark)}>
                    <span className="material-icons-outlined" style={{ fontSize: 20 }}>
                        auto_awesome
                    </span>
                </div>
                <h1 style={titleStyle}>Agentic Studio</h1>
            </div>
            <div style={rightGroup}>
                <button style={docLink(isDark)}>Documentation</button>
                <div style={divider(isDark)} />
                <div style={avatarStyle(isDark)}>JD</div>
                <button
                    style={iconBtn(isDark)}
                    onClick={toggle}
                    onMouseEnter={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.backgroundColor = isDark
                            ? '#374151'
                            : '#f3f4f6';
                    }}
                    onMouseLeave={(e) => {
                        (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                    }}
                >
                    <span className="material-icons-outlined">
                        {isDark ? 'light_mode' : 'dark_mode'}
                    </span>
                </button>
            </div>
        </header>
    );
}
