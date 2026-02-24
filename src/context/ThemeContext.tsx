import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
    mode: ThemeMode;
    toggle: () => void;
    isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
    mode: 'light',
    toggle: () => { },
    isDark: false,
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [mode, setMode] = useState<ThemeMode>('light');
    const toggle = useCallback(() => setMode((m) => (m === 'light' ? 'dark' : 'light')), []);

    return (
        <ThemeContext.Provider value={{ mode, toggle, isDark: mode === 'dark' }}>
            {children}
        </ThemeContext.Provider>
    );
}
