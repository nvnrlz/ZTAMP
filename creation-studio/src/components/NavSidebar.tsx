import { useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { colors, shadows, fonts } from '../theme';

const navItems = [
    { path: '/', label: 'Creation Studio', icon: 'auto_awesome' },
    { path: '/workflows', label: 'Workflow Library', icon: 'library_books' },
    { path: '/policy-creator', label: 'Policy Creator', icon: 'add_moderator' },
    { path: '/audit-log', label: 'Audit Log', icon: 'assignment' },
    { path: '/settings', label: 'Settings & Upload', icon: 'settings' },
];

/* ─── Style factories ─── */
const hamburger = (isDark: boolean): CSSProperties => ({
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    color: isDark ? '#d1d5db' : '#4b5563',
    transition: 'background 0.15s',
    flexShrink: 0,
});

const overlay: CSSProperties = {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 90,
    transition: 'opacity 0.3s',
};

const drawer = (isDark: boolean, open: boolean): CSSProperties => ({
    position: 'fixed',
    top: 0,
    left: 0,
    bottom: 0,
    width: 260,
    backgroundColor: isDark ? '#111827' : '#ffffff',
    borderRight: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    boxShadow: open ? shadows.overlay : 'none',
    transform: open ? 'translateX(0)' : 'translateX(-100%)',
    transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: fonts.display,
});

const drawerHeader = (isDark: boolean): CSSProperties => ({
    height: 56,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    borderBottom: `1px solid ${isDark ? colors.borderDark : colors.borderLight}`,
    flexShrink: 0,
});

const drawerTitle: CSSProperties = {
    fontWeight: 600,
    fontSize: 15,
    letterSpacing: '-0.01em',
};

const navList: CSSProperties = {
    padding: '12px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
};

const navItemStyle = (isDark: boolean, active: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 12px',
    borderRadius: 8,
    border: 'none',
    width: '100%',
    textAlign: 'left',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: active ? 600 : 500,
    fontFamily: fonts.display,
    color: active
        ? isDark ? '#ffffff' : '#111827'
        : isDark ? '#9ca3af' : '#6b7280',
    backgroundColor: active
        ? isDark ? 'rgba(59,130,246,0.15)' : '#eff6ff'
        : 'transparent',
    transition: 'background 0.15s, color 0.15s',
});

const navIcon = (active: boolean): CSSProperties => ({
    fontSize: 20,
    color: active ? colors.primary : 'inherit',
});

export default function NavSidebar() {
    const [open, setOpen] = useState(false);
    const { isDark } = useTheme();
    const location = useLocation();
    const navigate = useNavigate();

    return (
        <>
            {/* Hamburger button — exported to be placed in Header */}
            <button
                id="nav-hamburger"
                style={hamburger(isDark)}
                onClick={() => setOpen(true)}
                onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = isDark ? '#374151' : '#f3f4f6';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                }}
                aria-label="Open navigation"
            >
                <span className="material-icons" style={{ fontSize: 22 }}>menu</span>
            </button>

            {/* Overlay */}
            {open && <div style={overlay} onClick={() => setOpen(false)} />}

            {/* Drawer */}
            <nav style={drawer(isDark, open)}>
                <div style={drawerHeader(isDark)}>
                    <span style={drawerTitle}>Navigation</span>
                    <button
                        style={{ ...hamburger(isDark) }}
                        onClick={() => setOpen(false)}
                        aria-label="Close navigation"
                    >
                        <span className="material-icons" style={{ fontSize: 20 }}>close</span>
                    </button>
                </div>
                <div style={navList}>
                    {navItems.map((item) => {
                        const active = location.pathname === item.path;
                        return (
                            <button
                                key={item.path}
                                style={navItemStyle(isDark, active)}
                                onClick={() => {
                                    navigate(item.path);
                                    setOpen(false);
                                }}
                                onMouseEnter={(e) => {
                                    if (!active) {
                                        e.currentTarget.style.backgroundColor = isDark ? '#1f2937' : '#f9fafb';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!active) {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }
                                }}
                            >
                                <span className="material-icons-outlined" style={navIcon(active)}>
                                    {item.icon}
                                </span>
                                {item.label}
                            </button>
                        );
                    })}
                </div>
            </nav>
        </>
    );
}
