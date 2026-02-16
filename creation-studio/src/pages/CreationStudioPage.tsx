import { useEffect, useState, type CSSProperties } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { WorkflowProvider, useWorkflow, type SavedWorkflow } from '../context/WorkflowContext';
import PlannerSidebar from '../components/PlannerSidebar';
import WorkflowCanvas from '../components/WorkflowCanvas';
import NodeConfigPanel from '../components/NodeConfigPanel';
import { colors, shadows, fonts } from '../theme';
import { useTheme } from '../context/ThemeContext';

const mainStyle: CSSProperties = {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
    position: 'relative',
};

/* ─── Unsaved changes modal styles ─── */
const unsavedOverlay: CSSProperties = {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    backdropFilter: 'blur(4px)',
    zIndex: 2000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'fadeIn 0.2s ease-out',
};

const unsavedModal = (isDark: boolean): CSSProperties => ({
    width: 440,
    backgroundColor: isDark ? '#1f2937' : '#ffffff',
    borderRadius: 20,
    padding: 32,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
    border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
    fontFamily: fonts.display,
    animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
});

/* Inner component that can access workflow context */
function CreationStudioInner() {
    const [searchParams, setSearchParams] = useSearchParams();
    const location = useLocation();
    const { loadWorkflow, hasUnsavedChanges, saveWorkflow, workflowName, workflowDescription, nodes, markSaved } = useWorkflow();
    const { isDark } = useTheme();

    const [showUnsavedModal, setShowUnsavedModal] = useState(false);
    const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);

    useEffect(() => {
        const wfId = searchParams.get('load');
        if (wfId) {
            fetch(`http://localhost:4000/api/workflows/${wfId}`)
                .then((res) => res.json())
                .then((data: SavedWorkflow) => {
                    loadWorkflow(data);
                    // Clear the query param so a refresh doesn't reload
                    setSearchParams({}, { replace: true });
                })
                .catch((err) => console.error('Failed to load workflow:', err));
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    /* ─── Intercept navigation links ─── */
    useEffect(() => {
        // Listen for clicks on nav items. We intercept link clicks globally
        const handleClick = (e: MouseEvent) => {
            if (!hasUnsavedChanges) return;
            // Only intercept nav sidebar buttons that navigate
            const target = e.target as HTMLElement;
            const button = target.closest('button');
            if (!button) return;

            // Check if the click is within the nav sidebar drawer
            const drawer = target.closest('nav');
            if (!drawer) return;

            // Get text content to determine destination
            const text = button.textContent?.trim() || '';
            let targetPath = '';
            if (text.includes('Workflow Library')) targetPath = '/workflows';
            else if (text.includes('Settings')) targetPath = '/settings';
            else if (text.includes('Creation Studio')) return; // Already here

            if (targetPath && targetPath !== location.pathname) {
                e.preventDefault();
                e.stopPropagation();
                setPendingNavigation(targetPath);
                setShowUnsavedModal(true);
            }
        };

        document.addEventListener('click', handleClick, true);
        return () => document.removeEventListener('click', handleClick, true);
    }, [hasUnsavedChanges, location.pathname]);

    const handleDiscard = () => {
        setShowUnsavedModal(false);
        markSaved(); // Clear unsaved flag
        if (pendingNavigation) {
            // Use window.location to navigate directly
            window.location.href = pendingNavigation;
        }
    };

    const handleSaveAndLeave = async () => {
        if (nodes.length > 0) {
            const name = workflowName || 'Untitled Workflow';
            const desc = workflowDescription || '';
            await saveWorkflow(name, desc);
        }
        setShowUnsavedModal(false);
        markSaved();
        if (pendingNavigation) {
            window.location.href = pendingNavigation;
        }
    };

    const handleStay = () => {
        setShowUnsavedModal(false);
        setPendingNavigation(null);
    };

    return (
        <>
            <div style={mainStyle}>
                <PlannerSidebar />
                <WorkflowCanvas />
                <NodeConfigPanel />
            </div>

            {/* Unsaved Changes Modal */}
            {showUnsavedModal && (
                <div style={unsavedOverlay}>
                    <div style={unsavedModal(isDark)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                            <div style={{
                                width: 48, height: 48, borderRadius: 14,
                                backgroundColor: isDark ? '#78350f' : '#fef3c7',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <span className="material-icons" style={{ fontSize: 24, color: '#f59e0b' }}>warning</span>
                            </div>
                            <div>
                                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
                                    Unsaved Changes
                                </div>
                                <div style={{ fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280' }}>
                                    Your workflow has unsaved changes
                                </div>
                            </div>
                        </div>

                        <div style={{
                            padding: 16, borderRadius: 12,
                            backgroundColor: isDark ? '#111827' : '#f9fafb',
                            border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                            marginBottom: 24,
                            fontSize: 14,
                            lineHeight: 1.6,
                            color: isDark ? '#d1d5db' : '#4b5563',
                        }}>
                            You have {nodes.length} node{nodes.length !== 1 ? 's' : ''} in your current workflow.
                            Would you like to save before leaving?
                        </div>

                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                            <button
                                style={{
                                    padding: '10px 18px', borderRadius: 12, fontSize: 14, fontWeight: 600,
                                    border: `1px solid ${isDark ? '#374151' : '#d1d5db'}`,
                                    backgroundColor: isDark ? '#374151' : '#f3f4f6',
                                    color: isDark ? '#d1d5db' : '#4b5563',
                                    cursor: 'pointer', fontFamily: fonts.display,
                                }}
                                onClick={handleStay}
                            >
                                Stay Here
                            </button>
                            <button
                                style={{
                                    padding: '10px 18px', borderRadius: 12, fontSize: 14, fontWeight: 600,
                                    border: 'none',
                                    backgroundColor: '#ef4444',
                                    color: '#ffffff',
                                    cursor: 'pointer', fontFamily: fonts.display,
                                    display: 'flex', alignItems: 'center', gap: 6,
                                }}
                                onClick={handleDiscard}
                            >
                                <span className="material-icons" style={{ fontSize: 16 }}>delete_outline</span>
                                Discard & Leave
                            </button>
                            <button
                                style={{
                                    padding: '10px 18px', borderRadius: 12, fontSize: 14, fontWeight: 600,
                                    border: 'none',
                                    backgroundColor: colors.primary,
                                    color: '#ffffff',
                                    cursor: 'pointer', fontFamily: fonts.display,
                                    boxShadow: shadows.blueMd,
                                    display: 'flex', alignItems: 'center', gap: 6,
                                }}
                                onClick={handleSaveAndLeave}
                            >
                                <span className="material-icons" style={{ fontSize: 16 }}>save</span>
                                Save & Leave
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default function CreationStudioPage() {
    return (
        <WorkflowProvider>
            <CreationStudioInner />
        </WorkflowProvider>
    );
}
