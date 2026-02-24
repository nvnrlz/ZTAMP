import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

/* ─── Type Definitions ─── */
export type PolicyCategory = 'access' | 'execution' | 'data' | 'workflow' | 'network';
export type PolicyTarget = 'user' | 'agent' | 'team' | 'group' | 'role';
export type PolicyStatus = 'active' | 'draft' | 'disabled';

/* ─── Access Restriction Types ─── */
export type AccessMode = 'scrape' | 'api' | 'mcp' | 'authenticated';

export interface WebsiteScanResult {
    hasApi: boolean;
    hasMcp: boolean;
    requiresAuth: boolean;
    isPublic: boolean;
    detectedMethods: AccessMode[];
    apiEndpoint?: string;
    mcpServer?: string;
    authType?: 'oauth' | 'api_key' | 'basic' | 'saml';
}

export interface WhitelistEntry {
    id: string;
    domain: string;
    displayName: string;
    scanResult: WebsiteScanResult | null;
    scanStatus: 'pending' | 'scanning' | 'complete' | 'error';
    selectedAccessMode: AccessMode | null;
    addedAt: string;
    notes: string;
}

export interface AccessRestrictionConfig {
    whitelistedSites: WhitelistEntry[];
    enableTimeBasedAccess: boolean;
    timeWindowStart?: string;   // HH:mm
    timeWindowEnd?: string;     // HH:mm
    timeZone?: string;
    enableDataEgressLimits: boolean;
    maxEgressMbPerDay?: number;
    enableSessionBinding: boolean; // bind to user's active session
}

export interface Policy {
    id: string;
    name: string;
    description: string;
    category: PolicyCategory;
    status: PolicyStatus;
    targets: PolicyTarget[];      // which entity types this CAN be assigned to
    regoCode: string;
    createdAt: string;
    updatedAt: string;
    createdBy: string;
    version: number;
    severity: 'critical' | 'high' | 'medium' | 'low';
    accessRestriction?: AccessRestrictionConfig;
}

export interface PolicyAssignment {
    id: string;
    policyId: string;
    policyName: string;
    targetType: PolicyTarget;
    targetName: string;
    assignedAt: string;
    assignedBy: string;
}

export interface AuditEntry {
    id: string;
    action: 'created' | 'updated' | 'assigned' | 'unassigned' | 'enabled' | 'disabled';
    policyName: string;
    actor: string;
    details: string;
    timestamp: string;
}

/* ─── Label maps ─── */
export const categoryLabels: Record<PolicyCategory, string> = {
    access: 'Access Control',
    execution: 'Execution',
    data: 'Data Governance',
    workflow: 'Workflow',
    network: 'Network & API',
};

export const categoryIcons: Record<PolicyCategory, string> = {
    access: 'lock',
    execution: 'play_circle',
    data: 'shield',
    workflow: 'account_tree',
    network: 'language',
};

export const categoryColors: Record<PolicyCategory, string> = {
    access: '#8b5cf6',
    execution: '#f59e0b',
    data: '#ef4444',
    workflow: '#3b82f6',
    network: '#10b981',
};

export const targetLabels: Record<PolicyTarget, string> = {
    user: 'Users',
    agent: 'Agents',
    team: 'Teams',
    group: 'Groups',
    role: 'Roles',
};

export const targetIcons: Record<PolicyTarget, string> = {
    user: 'person',
    agent: 'smart_toy',
    team: 'group',
    group: 'groups',
    role: 'admin_panel_settings',
};

export const statusColors: Record<PolicyStatus, { bg: string; bgDark: string; text: string; textDark: string }> = {
    active: { bg: '#dcfce7', bgDark: '#14532d', text: '#16a34a', textDark: '#86efac' },
    draft: { bg: '#fef9c3', bgDark: '#713f12', text: '#ca8a04', textDark: '#fde047' },
    disabled: { bg: '#f3f4f6', bgDark: '#374151', text: '#6b7280', textDark: '#9ca3af' },
};

export const severityColors: Record<string, { bg: string; bgDark: string; text: string; textDark: string }> = {
    critical: { bg: '#fee2e2', bgDark: '#7f1d1d', text: '#dc2626', textDark: '#fca5a5' },
    high: { bg: '#ffedd5', bgDark: '#7c2d12', text: '#ea580c', textDark: '#fdba74' },
    medium: { bg: '#fef9c3', bgDark: '#713f12', text: '#ca8a04', textDark: '#fde047' },
    low: { bg: '#e0e7ff', bgDark: '#312e81', text: '#4f46e5', textDark: '#a5b4fc' },
};

/* ─── Seed Rego Policies ─── */
const regoSandbox = `package agentic.execution.sandbox

# Agents must execute code in sandboxed environments
default allow_execution = false

allow_execution {
    input.agent.sandbox_enabled == true
    input.environment.type == "containerized"
    input.resource.cpu_limit <= 2
    input.resource.memory_limit <= "4Gi"
}

# Deny access to host filesystem
deny[msg] {
    input.agent.filesystem_access == "host"
    msg := "Agents cannot access host filesystem"
}

# Deny privilege escalation
deny[msg] {
    input.agent.privileges == "root"
    msg := "Root privileges not allowed for agents"
}`;

const regoDataClassification = `package agentic.data.classification

# Enforce data classification labels on all documents
default compliant = false

compliant {
    input.document.classification != ""
    valid_classification[input.document.classification]
}

valid_classification["public"]
valid_classification["internal"]
valid_classification["confidential"]
valid_classification["restricted"]

# PII documents must be classified as confidential or higher
deny[msg] {
    input.document.contains_pii == true
    not input.document.classification == "confidential"
    not input.document.classification == "restricted"
    msg := "PII documents must be classified as confidential or restricted"
}`;

const regoWorkflowApproval = `package agentic.workflow.approval

# Require approval chain for production workflows
default approved = false

approved {
    input.workflow.environment != "production"
}

approved {
    input.workflow.environment == "production"
    count(input.workflow.approvals) >= required_approvals
}

required_approvals = 2 {
    input.workflow.risk_level == "high"
} else = 1 {
    input.workflow.risk_level == "medium"
}

deny[msg] {
    input.workflow.environment == "production"
    count(input.workflow.approvals) < 1
    msg := sprintf("Production workflow '%s' requires at least 1 approval", [input.workflow.name])
}`;

const regoRateLimit = `package agentic.network.ratelimit

# Rate limiting for external API calls
default allow_request = false

allow_request {
    input.request.type == "internal"
}

allow_request {
    input.request.type == "external"
    rate_under_limit
}

rate_under_limit {
    input.agent.requests_last_minute < max_rpm
}

max_rpm = 100 {
    input.agent.tier == "premium"
} else = 30 {
    input.agent.tier == "standard"
} else = 10`;

const regoRBAC = `package agentic.access.rbac

# Role-Based Access Control
default allow = false

allow {
    some role in input.user.roles
    role_permissions[role][input.action]
}

role_permissions["admin"]["read"] = true
role_permissions["admin"]["write"] = true
role_permissions["admin"]["delete"] = true
role_permissions["admin"]["manage_policies"] = true

role_permissions["developer"]["read"] = true
role_permissions["developer"]["write"] = true
role_permissions["developer"]["execute_workflow"] = true

role_permissions["analyst"]["read"] = true
role_permissions["analyst"]["execute_workflow"] = true

role_permissions["viewer"]["read"] = true`;

const regoNetworkIsolation = `package agentic.execution.network

# Agent network isolation policy
default allow_network = false

allow_network {
    input.destination.type == "internal"
    allowed_internal_hosts[input.destination.host]
}

allowed_internal_hosts["api.internal.company.com"]
allowed_internal_hosts["db.internal.company.com"]
allowed_internal_hosts["cache.internal.company.com"]

# Block all external network access by default
deny[msg] {
    input.destination.type == "external"
    msg := sprintf("Agent '%s' denied external access to %s", 
        [input.agent.name, input.destination.host])
}`;

const regoPII = `package agentic.data.pii

# PII data handling policy
import future.keywords.in

default allow_access = false

allow_access {
    not contains_pii(input.data)
}

allow_access {
    contains_pii(input.data)
    input.user.pii_certified == true
    input.purpose in allowed_purposes
}

contains_pii(data) {
    data.fields[_].type == "pii"
}

allowed_purposes := {"customer_support", "compliance_audit", "authorized_analysis"}

# Require encryption for PII at rest
deny[msg] {
    contains_pii(input.data)
    input.data.encryption != "AES-256"
    msg := "PII data must be encrypted with AES-256"
}`;

const regoResourceQuota = `package agentic.access.quota

# Team resource quota enforcement
default within_quota = false

within_quota {
    input.team.current_usage.compute <= team_limits[input.team.tier].compute
    input.team.current_usage.storage <= team_limits[input.team.tier].storage
    input.team.current_usage.agents <= team_limits[input.team.tier].agents
}

team_limits["enterprise"] = {
    "compute": 1000,
    "storage": "500GB",
    "agents": 50
}

team_limits["business"] = {
    "compute": 200,
    "storage": "100GB",
    "agents": 10
}

team_limits["starter"] = {
    "compute": 50,
    "storage": "10GB",
    "agents": 3
}`;

/* ─── Seed Data ─── */
const seedPolicies: Policy[] = [
    {
        id: 'pol-1',
        name: 'Agent Execution Sandbox',
        description: 'Restricts all agent code execution to containerized sandbox environments with CPU and memory limits. Prevents host filesystem access and privilege escalation.',
        category: 'execution',
        status: 'active',
        targets: ['agent'],
        regoCode: regoSandbox,
        createdAt: '2026-01-10T09:00:00Z',
        updatedAt: '2026-02-05T14:30:00Z',
        createdBy: 'Admin',
        version: 3,
        severity: 'critical',
    },
    {
        id: 'pol-2',
        name: 'Data Classification Enforcement',
        description: 'Requires all documents to carry a valid classification label. PII-containing documents must be classified as confidential or restricted.',
        category: 'data',
        status: 'active',
        targets: ['team', 'user'],
        regoCode: regoDataClassification,
        createdAt: '2026-01-12T10:00:00Z',
        updatedAt: '2026-01-28T11:00:00Z',
        createdBy: 'Compliance Team',
        version: 2,
        severity: 'high',
    },
    {
        id: 'pol-3',
        name: 'Workflow Approval Chain',
        description: 'Production workflows require manager approval. High-risk workflows need 2 approvals, medium-risk needs 1.',
        category: 'workflow',
        status: 'active',
        targets: ['role', 'user'],
        regoCode: regoWorkflowApproval,
        createdAt: '2026-01-15T08:00:00Z',
        updatedAt: '2026-02-10T16:00:00Z',
        createdBy: 'Admin',
        version: 4,
        severity: 'high',
    },
    {
        id: 'pol-4',
        name: 'API Rate Limiting',
        description: 'Enforces per-agent rate limits on external API calls based on agent tier (premium: 100 RPM, standard: 30 RPM, basic: 10 RPM).',
        category: 'network',
        status: 'draft',
        targets: ['agent', 'team'],
        regoCode: regoRateLimit,
        createdAt: '2026-02-01T13:00:00Z',
        updatedAt: '2026-02-14T09:00:00Z',
        createdBy: 'Platform Team',
        version: 1,
        severity: 'medium',
    },
    {
        id: 'pol-5',
        name: 'Role-Based Access Control',
        description: 'Defines RBAC permissions across the platform. Admin, Developer, Analyst, and Viewer roles with tiered permissions.',
        category: 'access',
        status: 'active',
        targets: ['user', 'role', 'group'],
        regoCode: regoRBAC,
        createdAt: '2026-01-05T10:00:00Z',
        updatedAt: '2026-02-12T15:00:00Z',
        createdBy: 'Admin',
        version: 5,
        severity: 'critical',
    },
    {
        id: 'pol-6',
        name: 'Agent Network Isolation',
        description: 'Prevents agents from making external network calls. Only whitelisted internal hosts are accessible.',
        category: 'execution',
        status: 'active',
        targets: ['agent'],
        regoCode: regoNetworkIsolation,
        createdAt: '2026-01-20T11:00:00Z',
        updatedAt: '2026-02-08T10:00:00Z',
        createdBy: 'Security Team',
        version: 2,
        severity: 'critical',
    },
    {
        id: 'pol-7',
        name: 'PII Data Handling',
        description: 'Special handling requirements for personally identifiable information. Requires PII certification, valid purpose, and AES-256 encryption.',
        category: 'data',
        status: 'draft',
        targets: ['user', 'agent', 'team'],
        regoCode: regoPII,
        createdAt: '2026-02-05T09:00:00Z',
        updatedAt: '2026-02-15T14:00:00Z',
        createdBy: 'Compliance Team',
        version: 1,
        severity: 'critical',
    },
    {
        id: 'pol-8',
        name: 'Team Resource Quotas',
        description: 'Enforces compute, storage, and agent count limits based on team tier (enterprise, business, starter).',
        category: 'access',
        status: 'disabled',
        targets: ['team', 'group'],
        regoCode: regoResourceQuota,
        createdAt: '2026-01-25T16:00:00Z',
        updatedAt: '2026-02-01T09:00:00Z',
        createdBy: 'Platform Team',
        version: 1,
        severity: 'medium',
    },
];

const seedAssignments: PolicyAssignment[] = [
    { id: 'asgn-1', policyId: 'pol-1', policyName: 'Agent Execution Sandbox', targetType: 'agent', targetName: 'Planner Agent', assignedAt: '2026-01-15T10:00:00Z', assignedBy: 'Admin' },
    { id: 'asgn-2', policyId: 'pol-1', policyName: 'Agent Execution Sandbox', targetType: 'agent', targetName: 'Code Agent', assignedAt: '2026-01-15T10:05:00Z', assignedBy: 'Admin' },
    { id: 'asgn-3', policyId: 'pol-2', policyName: 'Data Classification Enforcement', targetType: 'team', targetName: 'Engineering', assignedAt: '2026-01-18T14:00:00Z', assignedBy: 'Compliance Team' },
    { id: 'asgn-4', policyId: 'pol-2', policyName: 'Data Classification Enforcement', targetType: 'team', targetName: 'Data Science', assignedAt: '2026-01-18T14:05:00Z', assignedBy: 'Compliance Team' },
    { id: 'asgn-5', policyId: 'pol-3', policyName: 'Workflow Approval Chain', targetType: 'role', targetName: 'Developer', assignedAt: '2026-01-20T09:00:00Z', assignedBy: 'Admin' },
    { id: 'asgn-6', policyId: 'pol-3', policyName: 'Workflow Approval Chain', targetType: 'role', targetName: 'Analyst', assignedAt: '2026-01-20T09:05:00Z', assignedBy: 'Admin' },
    { id: 'asgn-7', policyId: 'pol-5', policyName: 'Role-Based Access Control', targetType: 'group', targetName: 'All Users', assignedAt: '2026-01-10T08:00:00Z', assignedBy: 'Admin' },
    { id: 'asgn-8', policyId: 'pol-6', policyName: 'Agent Network Isolation', targetType: 'agent', targetName: 'Planner Agent', assignedAt: '2026-01-22T11:00:00Z', assignedBy: 'Security Team' },
    { id: 'asgn-9', policyId: 'pol-6', policyName: 'Agent Network Isolation', targetType: 'agent', targetName: 'Data Agent', assignedAt: '2026-01-22T11:10:00Z', assignedBy: 'Security Team' },
    { id: 'asgn-10', policyId: 'pol-5', policyName: 'Role-Based Access Control', targetType: 'role', targetName: 'Admin', assignedAt: '2026-01-10T08:10:00Z', assignedBy: 'Admin' },
];

const seedAuditLog: AuditEntry[] = [
    { id: 'aud-1', action: 'created', policyName: 'Role-Based Access Control', actor: 'Admin', details: 'Created initial RBAC policy with 4 role definitions', timestamp: '2026-01-05T10:00:00Z' },
    { id: 'aud-2', action: 'assigned', policyName: 'Role-Based Access Control', actor: 'Admin', details: 'Assigned to group "All Users"', timestamp: '2026-01-10T08:00:00Z' },
    { id: 'aud-3', action: 'created', policyName: 'Agent Execution Sandbox', actor: 'Admin', details: 'Created sandbox enforcement policy for agents', timestamp: '2026-01-10T09:00:00Z' },
    { id: 'aud-4', action: 'created', policyName: 'Data Classification Enforcement', actor: 'Compliance Team', details: 'Initial data classification policy for document handling', timestamp: '2026-01-12T10:00:00Z' },
    { id: 'aud-5', action: 'assigned', policyName: 'Agent Execution Sandbox', actor: 'Admin', details: 'Assigned to Planner Agent and Code Agent', timestamp: '2026-01-15T10:00:00Z' },
    { id: 'aud-6', action: 'created', policyName: 'Workflow Approval Chain', actor: 'Admin', details: 'Created multi-tier approval chain for production workflows', timestamp: '2026-01-15T08:00:00Z' },
    { id: 'aud-7', action: 'assigned', policyName: 'Data Classification Enforcement', actor: 'Compliance Team', details: 'Assigned to Engineering and Data Science teams', timestamp: '2026-01-18T14:00:00Z' },
    { id: 'aud-8', action: 'created', policyName: 'Agent Network Isolation', actor: 'Security Team', details: 'Created network isolation policy with internal host whitelist', timestamp: '2026-01-20T11:00:00Z' },
    { id: 'aud-9', action: 'assigned', policyName: 'Agent Network Isolation', actor: 'Security Team', details: 'Assigned to Planner Agent and Data Agent', timestamp: '2026-01-22T11:00:00Z' },
    { id: 'aud-10', action: 'updated', policyName: 'Agent Execution Sandbox', actor: 'Admin', details: 'Updated memory limit from 2Gi to 4Gi, bumped to v3', timestamp: '2026-02-05T14:30:00Z' },
    { id: 'aud-11', action: 'created', policyName: 'PII Data Handling', actor: 'Compliance Team', details: 'Draft policy for PII handling with encryption requirements', timestamp: '2026-02-05T09:00:00Z' },
    { id: 'aud-12', action: 'updated', policyName: 'Role-Based Access Control', actor: 'Admin', details: 'Added execute_workflow permission to Developer role, v5', timestamp: '2026-02-12T15:00:00Z' },
    { id: 'aud-13', action: 'updated', policyName: 'Workflow Approval Chain', actor: 'Admin', details: 'Changed high-risk approval count from 3 to 2, v4', timestamp: '2026-02-10T16:00:00Z' },
    { id: 'aud-14', action: 'disabled', policyName: 'Team Resource Quotas', actor: 'Platform Team', details: 'Temporarily disabled while reviewing tier limits', timestamp: '2026-02-01T09:00:00Z' },
];

/* ─── Context ─── */
export interface PolicyContextValue {
    policies: Policy[];
    assignments: PolicyAssignment[];
    auditLog: AuditEntry[];
    addPolicy: (p: Omit<Policy, 'id' | 'createdAt' | 'updatedAt' | 'version'>) => Policy;
    updatePolicyStatus: (id: string, status: PolicyStatus) => void;
    addAssignment: (a: Omit<PolicyAssignment, 'id' | 'assignedAt'>) => void;
    removeAssignment: (id: string) => void;
    getAssignmentsForPolicy: (policyId: string) => PolicyAssignment[];
}

const PolicyContext = createContext<PolicyContextValue | null>(null);

export function usePolicies() {
    const ctx = useContext(PolicyContext);
    if (!ctx) throw new Error('usePolicies must be inside PolicyProvider');
    return ctx;
}

export function PolicyProvider({ children }: { children: ReactNode }) {
    const [policies, setPolicies] = useState<Policy[]>(seedPolicies);
    const [assignments, setAssignments] = useState<PolicyAssignment[]>(seedAssignments);
    const [auditLog] = useState<AuditEntry[]>(seedAuditLog);

    const addPolicy = useCallback((p: Omit<Policy, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Policy => {
        const now = new Date().toISOString();
        const newPolicy: Policy = {
            ...p,
            id: `pol-${Date.now()}`,
            createdAt: now,
            updatedAt: now,
            version: 1,
        };
        setPolicies((prev) => [newPolicy, ...prev]);
        return newPolicy;
    }, []);

    const updatePolicyStatus = useCallback((id: string, status: PolicyStatus) => {
        setPolicies((prev) =>
            prev.map((p) => (p.id === id ? { ...p, status, updatedAt: new Date().toISOString() } : p)),
        );
    }, []);

    const addAssignment = useCallback((a: Omit<PolicyAssignment, 'id' | 'assignedAt'>) => {
        const newA: PolicyAssignment = {
            ...a,
            id: `asgn-${Date.now()}`,
            assignedAt: new Date().toISOString(),
        };
        setAssignments((prev) => [...prev, newA]);
    }, []);

    const removeAssignment = useCallback((id: string) => {
        setAssignments((prev) => prev.filter((a) => a.id !== id));
    }, []);

    const getAssignmentsForPolicy = useCallback(
        (policyId: string) => assignments.filter((a) => a.policyId === policyId),
        [assignments],
    );

    return (
        <PolicyContext.Provider
            value={{
                policies, assignments, auditLog,
                addPolicy, updatePolicyStatus,
                addAssignment, removeAssignment, getAssignmentsForPolicy,
            }}
        >
            {children}
        </PolicyContext.Provider>
    );
}
