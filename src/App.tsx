import type { CSSProperties } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useTheme } from './context/ThemeContext';
import { colors, fonts } from './theme';
import Header from './components/Header';
import CreationStudioPage from './pages/CreationStudioPage';
import SettingsPage from './pages/SettingsPage';
import WorkflowsPage from './pages/WorkflowsPage';
import AuditLogPage from './pages/AuditLogPage';
import PolicyCreatorPage from './pages/PolicyCreatorPage';
import AdminConsolePage from './pages/AdminConsolePage';

const appStyle = (isDark: boolean): CSSProperties => ({
  backgroundColor: isDark ? colors.backgroundDark : colors.backgroundLight,
  color: isDark ? '#e5e7eb' : '#1f2937',
  fontFamily: fonts.display,
  height: '100vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  transition: 'background-color 0.2s, color 0.2s',
});

export default function App() {
  const { isDark } = useTheme();

  return (
    <div style={appStyle(isDark)}>
      <Header />
      <Routes>
        <Route path="/" element={<CreationStudioPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/audit-log" element={<AuditLogPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/policy-creator" element={<PolicyCreatorPage />} />
        <Route path="/admin" element={<AdminConsolePage />} />
      </Routes>
    </div>
  );
}
