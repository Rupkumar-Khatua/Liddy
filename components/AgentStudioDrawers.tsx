import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  AiSkillRecord,
  McpConnectorRecord,
  SkillsShCatalogItem,
} from '../types';
import { searchSkillsRegistry } from '../services/geminiService';

export type AgentStudioDrawerMode = 'none' | 'connectors' | 'skills';

interface AgentStudioDrawersProps {
  mode: AgentStudioDrawerMode;
  onClose: () => void;
  skills: AiSkillRecord[];
  connectors: McpConnectorRecord[];
  onToggleSkill: (skillId: string, enabled: boolean) => void;
  onSaveCustomSkill: (payload: {
    skillId?: string;
    name: string;
    category: string;
    description: string;
    triggers: string;
    instructionsMarkdown: string;
  }) => Promise<void> | void;
  onInstallCatalogSkill: (item: SkillsShCatalogItem) => Promise<void> | void;
  onDeleteSkill: (skillId: string) => Promise<void> | void;
  onToggleConnector: (connectorId: string, enabled: boolean) => void;
  onInspectConnector: (connectorId: string, rawToken?: string) => Promise<void> | void;
  onAddCustomConnector: (payload: {
    name: string;
    category: string;
    description: string;
    endpointUrl: string;
    transport: 'http' | 'sse';
    authType: 'none' | 'bearer' | 'api_key';
    authToken?: string;
  }) => Promise<void> | void;
  onDeleteConnector: (connectorId: string) => Promise<void> | void;
}

const SKILL_CATEGORIES = [
  'Treasury',
  'Tax & Compliance',
  'Invoicing',
  'Bookkeeping',
  'Investing',
  'Reporting',
  'Spend Control',
  'Custom',
];

const CUSTOM_CONNECTOR_CATEGORIES = ['Workspace', 'Banking', 'Accounting', 'Custom'];

const SKILL_TEMPLATES: Record<string, { name: string; category: string; triggers: string; description: string; markdown: string }> = {
  treasury: {
    name: 'Monthly Treasury Sweep',
    category: 'Treasury',
    triggers: 'treasury sweep, idle cash, reserve ratio, runway',
    description: 'Identifies excess checking liquidity above 90-day operating buffer and recommends yield sweeps.',
    markdown: `---
name: monthly-treasury-sweep
description: Compute 90-day operating cash reserve and recommend idle liquidity sweeps
triggers: treasury sweep, idle cash, reserve ratio, runway
---

# Monthly Treasury Sweep Playbook

## Workflow
1. Sum trailing 90-day fixed obligations + recurring payroll/SaaS commitments.
2. Flag excess operating cash above 1.25x buffer threshold.
3. Emit a structured allocation table and downloadable CSV cash ladder.`,
  },
  tax: {
    name: 'Quarterly Deduction Readiness',
    category: 'Tax & Compliance',
    triggers: 'quarterly tax, write-off, deduction, gst, vat',
    description: 'Audits categorized transactions and flags missing receipts or tax IDs before filing deadlines.',
    markdown: `---
name: quarterly-deduction-readiness
description: Verify deductible expense categories and missing invoice/receipt metadata
triggers: quarterly tax, write-off, deduction, gst, vat
---

# Quarterly Deduction Readiness

## Checklist
1. Separate deductible software, contractor, hardware, and travel expenses.
2. Flag entries above threshold lacking merchant tax ID or invoice numbers.
3. Produce a clean CPA-ready CSV export and executive PDF brief.`,
  },
  blank: {
    name: 'Custom Finance Playbook',
    category: 'Custom',
    triggers: 'monthly close, audit, variance',
    description: 'Tailored workflow instructions injected automatically when this skill is enabled.',
    markdown: `---
name: my-finance-skill
description: Custom workflow instructions for Liddy AI CFO
triggers: budget review, monthly close, audit
---

# Custom Financial Workflow

## Instructions
1. Review recent transactions, recurring bills, and unpaid receivables in workspace currency.
2. Flag anomalies above 20% month-over-month variance.
3. Produce a concise summary table plus downloadable CSV and PDF deliverables when requested.`,
  },
};

const ConnectorGlyph: React.FC<{ slug: string; category: string }> = ({ slug, category }) => {
  const s = slug.toLowerCase();
  if (s.includes('drive')) {
    return (
      <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200/80 dark:border-amber-800/60 flex items-center justify-center shrink-0">
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
          <path d="M8.5 3.5h7l6 10.4-3.5 6.1H6L2.5 13.9 8.5 3.5z" stroke="#D97706" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M8.5 3.5l7 12.1M2.5 13.9h19" stroke="#2563EB" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
    );
  }
  if (s.includes('gmail')) {
    return (
      <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200/80 dark:border-rose-800/60 flex items-center justify-center shrink-0">
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="#E11D48" strokeWidth="1.8" />
          <path d="M4 7l8 6 8-6" stroke="#E11D48" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  if (s.includes('sheet')) {
    return (
      <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/80 dark:border-emerald-800/60 flex items-center justify-center shrink-0">
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
          <rect x="4" y="3" width="16" height="18" rx="2.5" stroke="#059669" strokeWidth="1.8" />
          <path d="M4 9h16M4 14h16M10 9v12" stroke="#059669" strokeWidth="1.6" />
        </svg>
      </div>
    );
  }
  if (s.includes('notion')) {
    return (
      <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center shrink-0 font-serif font-extrabold text-sm text-neutral-900 dark:text-white">
        N
      </div>
    );
  }
  if (s.includes('slack')) {
    return (
      <div className="w-10 h-10 rounded-xl bg-fuchsia-50 dark:bg-fuchsia-950/40 border border-fuchsia-200/80 dark:border-fuchsia-800/60 flex items-center justify-center shrink-0">
        <svg className="w-5 h-5 text-fuchsia-600 dark:text-fuchsia-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M6 15a2 2 0 110-4h2v2a2 2 0 01-2 2zm3-9a2 2 0 114 0v2h-2a2 2 0 01-2-2zm9 3a2 2 0 110 4h-2v-2a2 2 0 012-2zm-3 9a2 2 0 11-4 0v-2h2a2 2 0 012 2z" />
        </svg>
      </div>
    );
  }
  if (s.includes('github')) {
    return (
      <div className="w-10 h-10 rounded-xl bg-neutral-900 dark:bg-white border border-neutral-800 dark:border-neutral-200 flex items-center justify-center shrink-0 text-white dark:text-neutral-900">
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
        </svg>
      </div>
    );
  }
  if (s.includes('plaid')) {
    return (
      <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-950/50 border border-teal-200/80 dark:border-teal-800/60 flex items-center justify-center shrink-0">
        <svg className="w-5 h-5 text-teal-700 dark:text-teal-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
          <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
          <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
          <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
          <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
        </svg>
      </div>
    );
  }
  if (s.includes('stripe')) {
    return (
      <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/60 flex items-center justify-center shrink-0 font-bold text-base text-indigo-600 dark:text-indigo-300">
        S
      </div>
    );
  }
  if (s.includes('quickbooks')) {
    return (
      <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/80 dark:border-emerald-800/60 flex items-center justify-center shrink-0 font-bold text-xs tracking-tight text-emerald-700 dark:text-emerald-300">
        QB
      </div>
    );
  }
  if (s.includes('xero')) {
    return (
      <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/50 border border-sky-200/80 dark:border-sky-800/60 flex items-center justify-center shrink-0 font-bold text-xs tracking-tight text-sky-600 dark:text-sky-300">
        X
      </div>
    );
  }
  return (
    <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 flex items-center justify-center shrink-0 text-neutral-600 dark:text-neutral-300">
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    </div>
  );
};

export const AgentStudioDrawers: React.FC<AgentStudioDrawersProps> = ({
  mode,
  onClose,
  skills,
  connectors,
  onToggleSkill,
  onSaveCustomSkill,
  onInstallCatalogSkill,
  onDeleteSkill,
  onToggleConnector,
  onInspectConnector,
  onAddCustomConnector,
  onDeleteConnector,
}) => {
  // Connectors state
  const [connCategoryFilter, setConnCategoryFilter] = useState<'all' | 'Workspace' | 'Banking' | 'Accounting' | 'custom'>('all');
  const [connSearch, setConnSearch] = useState('');
  const [showAddConnForm, setShowAddConnForm] = useState(false);
  const [connName, setConnName] = useState('');
  const [connCategory, setConnCategory] = useState('Accounting');
  const [connDesc, setConnDesc] = useState('');
  const [connUrl, setConnUrl] = useState('');
  const [connTransport, setConnTransport] = useState<'http' | 'sse'>('http');
  const [connAuthType, setConnAuthType] = useState<'none' | 'bearer' | 'api_key'>('bearer');
  const [connToken, setConnToken] = useState('');
  const [savingConn, setSavingConn] = useState(false);
  const [connFormError, setConnFormError] = useState<string | null>(null);
  const [testingConnId, setTestingConnId] = useState<string | null>(null);

  // Skills state
  const [skillsTab, setSkillsTab] = useState<'installed' | 'discover' | 'builder'>('installed');
  const [installedSearch, setInstalledSearch] = useState('');
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null);

  // skills.sh discovery state
  const [registryQuery, setRegistryQuery] = useState('');
  const [registryResults, setRegistryResults] = useState<SkillsShCatalogItem[]>([]);
  const [registrySource, setRegistrySource] = useState<string>('curated');
  const [searchingRegistry, setSearchingRegistry] = useState(false);
  const [previewRegistrySlug, setPreviewRegistrySlug] = useState<string | null>(null);

  // Custom Skill Builder state
  const [editingSkillId, setEditingSkillId] = useState<string | undefined>(undefined);
  const [skillName, setSkillName] = useState('');
  const [skillCategory, setSkillCategory] = useState('Treasury');
  const [skillTriggers, setSkillTriggers] = useState('');
  const [skillDesc, setSkillDesc] = useState('');
  const [skillMarkdown, setSkillMarkdown] = useState(SKILL_TEMPLATES.blank.markdown);
  const [savingSkill, setSavingSkill] = useState(false);
  const [skillFormError, setSkillFormError] = useState<string | null>(null);

  const runRegistrySearch = useCallback(async (q: string) => {
    setSearchingRegistry(true);
    try {
      const res = await searchSkillsRegistry(q);
      setRegistryResults(res.skills);
      setRegistrySource(res.source);
    } finally {
      setSearchingRegistry(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'skills' && skillsTab === 'discover' && registryResults.length === 0) {
      void runRegistrySearch('');
    }
  }, [mode, skillsTab, registryResults.length, runRegistrySearch]);

  useEffect(() => {
    if (mode === 'none') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, onClose]);

  if (mode === 'none') return null;

  const filteredConnectors = connectors.filter((c) => {
    if (c.providerType === 'builtin' || c.connectorId.startsWith('mcp_liddy_')) return false;
    if (connCategoryFilter === 'custom' && c.providerType !== 'custom') return false;
    if (
      connCategoryFilter !== 'all' &&
      connCategoryFilter !== 'custom' &&
      c.category !== connCategoryFilter
    ) {
      return false;
    }
    const q = connSearch.trim().toLowerCase();
    if (!q) return true;
    return `${c.name} ${c.category} ${c.description || ''}`.toLowerCase().includes(q);
  });

  const filteredInstalledSkills = skills.filter((s) => {
    const q = installedSearch.trim().toLowerCase();
    if (!q) return true;
    return `${s.name} ${s.slug} ${s.category} ${s.description || ''} ${s.triggers || ''}`
      .toLowerCase()
      .includes(q);
  });

  const installedSlugs = new Set(skills.map((s) => s.slug.toLowerCase()));

  const handleSaveConnectorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnFormError(null);
    if (!connName.trim()) {
      setConnFormError('Provide a display name for the custom MCP server.');
      return;
    }
    if (!/^https?:\/\/.+/i.test(connUrl.trim())) {
      setConnFormError('Enter a valid http:// or https:// MCP endpoint URL.');
      return;
    }
    setSavingConn(true);
    try {
      await onAddCustomConnector({
        name: connName.trim(),
        category: connCategory,
        description: connDesc.trim() || `Custom ${connTransport.toUpperCase()} MCP server`,
        endpointUrl: connUrl.trim(),
        transport: connTransport,
        authType: connAuthType,
        authToken: connToken.trim() || undefined,
      });
      setConnName('');
      setConnDesc('');
      setConnUrl('');
      setConnToken('');
      setShowAddConnForm(false);
    } catch (err: any) {
      setConnFormError(err?.message || 'Could not save MCP connector.');
    } finally {
      setSavingConn(false);
    }
  };

  const handleTestConnector = async (connectorId: string) => {
    setTestingConnId(connectorId);
    try {
      await onInspectConnector(connectorId);
    } finally {
      setTestingConnId(null);
    }
  };

  const applySkillPreset = (key: keyof typeof SKILL_TEMPLATES) => {
    const tpl = SKILL_TEMPLATES[key];
    setEditingSkillId(undefined);
    setSkillName(tpl.name);
    setSkillCategory(tpl.category);
    setSkillTriggers(tpl.triggers);
    setSkillDesc(tpl.description);
    setSkillMarkdown(tpl.markdown);
    setSkillFormError(null);
  };

  const openSkillEditor = (existing?: AiSkillRecord) => {
    if (existing) {
      setEditingSkillId(existing.skillId);
      setSkillName(existing.name);
      setSkillCategory(existing.category || 'Custom');
      setSkillTriggers(existing.triggers || '');
      setSkillDesc(existing.description || '');
      setSkillMarkdown(existing.instructionsMarkdown || SKILL_TEMPLATES.blank.markdown);
    } else {
      setEditingSkillId(undefined);
      setSkillName('');
      setSkillCategory('Treasury');
      setSkillTriggers('');
      setSkillDesc('');
      setSkillMarkdown(SKILL_TEMPLATES.blank.markdown);
    }
    setSkillFormError(null);
    setSkillsTab('builder');
  };

  const handleSaveSkillSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSkillFormError(null);
    if (!skillName.trim()) {
      setSkillFormError('Enter a skill name.');
      return;
    }
    if (!skillMarkdown.trim()) {
      setSkillFormError('Add SKILL.md markdown instructions for Liddy AI.');
      return;
    }
    setSavingSkill(true);
    try {
      await onSaveCustomSkill({
        skillId: editingSkillId,
        name: skillName.trim(),
        category: skillCategory,
        description: skillDesc.trim() || `Custom ${skillCategory} workflow for Liddy AI`,
        triggers: skillTriggers.trim() || skillName.trim().toLowerCase(),
        instructionsMarkdown: skillMarkdown.trim(),
      });
      setEditingSkillId(undefined);
      setSkillsTab('installed');
    } catch (err: any) {
      setSkillFormError(err?.message || 'Unable to save skill.');
    } finally {
      setSavingSkill(false);
    }
  };

  const enabledConnectorsCount = connectors.filter(
    (c) => c.enabled && c.providerType !== 'builtin' && !c.connectorId.startsWith('mcp_liddy_')
  ).length;
  const enabledSkillsCount = skills.filter((s) => s.enabled).length;

  const modal = (
    <div
      className="fixed inset-0 z-[9992] flex items-center justify-center p-3 sm:p-6 bg-neutral-950/45 dark:bg-black/65 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'connectors' ? 'Connectors' : 'Skills'}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-4xl max-h-[88vh] bg-white dark:bg-[#141519] border border-neutral-200 dark:border-neutral-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden my-auto animate-enter text-neutral-900 dark:text-neutral-100"
      >
        {/* Clean Claude/ChatGPT-Style Centered Header */}
        <header className="px-6 py-4 border-b border-neutral-200/80 dark:border-neutral-800 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold tracking-tight text-neutral-900 dark:text-white truncate">
                {mode === 'connectors' ? 'Connectors' : 'Skills'}
              </h2>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums whitespace-nowrap">
                {mode === 'connectors'
                  ? `${enabledConnectorsCount} connected`
                  : `${enabledSkillsCount} active`}
              </span>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">
              {mode === 'connectors'
                ? 'Connect external workspace, banking, accounting apps, or your own MCP server.'
                : 'Enable specialized finance playbooks or author reusable SKILL.md workflows.'}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="w-8 h-8 rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* CONNECTORS MODAL BODY */}
        {mode === 'connectors' && (
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
            {/* Search + Category Filter + Add Custom */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1 bg-neutral-100 dark:bg-neutral-900 p-1 rounded-xl border border-neutral-200/70 dark:border-neutral-800">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'Workspace', label: 'Workspace' },
                    { id: 'Banking', label: 'Banking' },
                    { id: 'Accounting', label: 'Accounting' },
                    { id: 'custom', label: 'Custom MCP' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setConnCategoryFilter(tab.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      connCategoryFilter === tab.id
                        ? 'bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white shadow-2xs'
                        : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={connSearch}
                  onChange={(e) => setConnSearch(e.target.value)}
                  placeholder="Filter apps..."
                  className="w-full sm:w-44 h-9 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-3 text-xs text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowAddConnForm((v) => !v)}
                  className="h-9 px-3.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 hover:bg-neutral-800 dark:hover:bg-neutral-100 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {showAddConnForm ? 'Cancel' : '+ Add custom'}
                </button>
              </div>
            </div>

            {showAddConnForm && (
              <form
                onSubmit={handleSaveConnectorSubmit}
                className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-[#FAFAFA] dark:bg-neutral-900/70 p-4 sm:p-5 space-y-3.5"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
                    Add custom MCP connector
                  </h3>
                  <span className="text-[11px] font-mono text-neutral-400">HTTP / SSE JSON-RPC</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                      Connector name
                    </label>
                    <input
                      type="text"
                      value={connName}
                      onChange={(e) => setConnName(e.target.value)}
                      placeholder="e.g., Snowflake Ledger MCP"
                      className="w-full rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs text-neutral-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                      Category
                    </label>
                    <select
                      value={connCategory}
                      onChange={(e) => setConnCategory(e.target.value)}
                      className="w-full rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs text-neutral-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      {CUSTOM_CONNECTOR_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                    Remote MCP Server URL
                  </label>
                  <input
                    type="url"
                    value={connUrl}
                    onChange={(e) => setConnUrl(e.target.value)}
                    placeholder="https://mcp.your-provider.com/sse"
                    className="w-full rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs font-mono text-neutral-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                      Transport
                    </label>
                    <select
                      value={connTransport}
                      onChange={(e) => setConnTransport(e.target.value as 'http' | 'sse')}
                      className="w-full rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs text-neutral-900 dark:text-white"
                    >
                      <option value="http">Streamable HTTP</option>
                      <option value="sse">SSE</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                      Authentication
                    </label>
                    <select
                      value={connAuthType}
                      onChange={(e) =>
                        setConnAuthType(e.target.value as 'none' | 'bearer' | 'api_key')
                      }
                      className="w-full rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs text-neutral-900 dark:text-white"
                    >
                      <option value="bearer">Bearer token</option>
                      <option value="api_key">x-api-key</option>
                      <option value="none">No auth</option>
                    </select>
                  </div>
                  {connAuthType !== 'none' && (
                    <div>
                      <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                        Credential
                      </label>
                      <input
                        type="password"
                        value={connToken}
                        onChange={(e) => setConnToken(e.target.value)}
                        placeholder="Optional secret token"
                        className="w-full rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs font-mono text-neutral-900 dark:text-white"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={connDesc}
                    onChange={(e) => setConnDesc(e.target.value)}
                    placeholder="What tools or external data does this server provide?"
                    className="w-full rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs text-neutral-900 dark:text-white"
                  />
                </div>

                {connFormError && (
                  <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                    {connFormError}
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={savingConn}
                    className="h-9 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    {savingConn ? 'Connecting...' : 'Save & Test'}
                  </button>
                </div>
              </form>
            )}

            {/* 2-Column Clean Integration Grid */}
            {filteredConnectors.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-neutral-200 dark:border-neutral-800 p-10 text-center space-y-2">
                <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                  No matching connectors
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Try another category filter or click + Add custom to wire any remote MCP server.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {filteredConnectors.map((conn) => {
                  const isTesting = testingConnId === conn.connectorId;
                  const isConnected = conn.enabled || conn.status === 'connected';
                  return (
                    <div
                      key={conn.connectorId}
                      className={`rounded-2xl border p-4 flex flex-col justify-between gap-3 transition-colors ${
                        conn.enabled
                          ? 'border-indigo-500/40 bg-indigo-50/30 dark:bg-indigo-950/15'
                          : 'border-neutral-200/90 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 hover:border-neutral-300 dark:hover:border-neutral-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <ConnectorGlyph slug={conn.slug} category={conn.category} />
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                              {conn.name}
                            </h3>
                            <div className="flex items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
                              <span>{conn.category}</span>
                              <span>·</span>
                              <span
                                className={
                                  conn.status === 'error'
                                    ? 'text-rose-600 dark:text-rose-400 font-medium'
                                    : isConnected
                                    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                                    : ''
                                }
                              >
                                {conn.status === 'error'
                                  ? 'Check URL'
                                  : conn.enabled
                                  ? 'Connected'
                                  : 'Available'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Clean Pill Switch */}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={conn.enabled}
                          aria-label={`Toggle ${conn.name}`}
                          onClick={() => onToggleConnector(conn.connectorId, !conn.enabled)}
                          className={`relative inline-flex h-6 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                            conn.enabled
                              ? 'bg-indigo-600'
                              : 'bg-neutral-200 dark:bg-neutral-700'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-xs transform transition-transform ${
                              conn.enabled ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      {conn.description && (
                        <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed line-clamp-2">
                          {conn.description}
                        </p>
                      )}

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800/80 text-[11px]">
                        <span className="font-mono text-neutral-400 dark:text-neutral-500 truncate">
                          {conn.toolsList?.length ? `${conn.toolsList.length} tools` : conn.transport.toUpperCase()}
                          {conn.authCredentialMasked ? ` · ${conn.authCredentialMasked}` : ''}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          {conn.providerType === 'custom' && (
                            <button
                              type="button"
                              onClick={() => onDeleteConnector(conn.connectorId)}
                              className="text-rose-600 dark:text-rose-400 hover:underline font-medium cursor-pointer whitespace-nowrap"
                            >
                              Remove
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleTestConnector(conn.connectorId)}
                            disabled={isTesting}
                            className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 font-medium cursor-pointer disabled:opacity-50 whitespace-nowrap"
                          >
                            {isTesting ? 'Testing...' : 'Test'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* SKILLS MODAL BODY */}
        {mode === 'skills' && (
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
            {/* Clean Segmented Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-900 p-1 rounded-xl border border-neutral-200/70 dark:border-neutral-800">
                <button
                  type="button"
                  onClick={() => setSkillsTab('installed')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap tabular-nums ${
                    skillsTab === 'installed'
                      ? 'bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white shadow-2xs'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  My Skills ({skills.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSkillsTab('discover')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    skillsTab === 'discover'
                      ? 'bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white shadow-2xs'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  Discover (skills.sh)
                </button>
                <button
                  type="button"
                  onClick={() => openSkillEditor()}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    skillsTab === 'builder'
                      ? 'bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white shadow-2xs'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                  }`}
                >
                  + Create Skill
                </button>
              </div>
            </div>

            {/* MY SKILLS TAB */}
            {skillsTab === 'installed' && (
              <div className="space-y-3.5">
                <input
                  type="text"
                  value={installedSearch}
                  onChange={(e) => setInstalledSearch(e.target.value)}
                  placeholder="Search installed finance skills..."
                  className="w-full h-9 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-3.5 text-xs text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />

                {filteredInstalledSkills.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-neutral-200 dark:border-neutral-800 p-10 text-center space-y-2">
                    <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                      No matching skills found
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Install finance skills from skills.sh or write your own custom SKILL.md playbook.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {filteredInstalledSkills.map((skill) => {
                      const isExpanded = expandedSkillId === skill.skillId;
                      return (
                        <div
                          key={skill.skillId}
                          className={`rounded-2xl border p-4 flex flex-col justify-between gap-3 transition-colors ${
                            skill.enabled
                              ? 'border-indigo-500/40 bg-indigo-50/30 dark:bg-indigo-950/15'
                              : 'border-neutral-200/90 dark:border-neutral-800 bg-white dark:bg-neutral-900/40'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                                {skill.name}
                              </h3>
                              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 truncate">
                                {skill.category} · {skill.source === 'builtin' ? 'Curated' : skill.source}
                              </p>
                            </div>

                            <button
                              type="button"
                              role="switch"
                              aria-checked={skill.enabled}
                              aria-label={`Toggle ${skill.name}`}
                              onClick={() => onToggleSkill(skill.skillId, !skill.enabled)}
                              className={`relative inline-flex h-6 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                                skill.enabled
                                  ? 'bg-indigo-600'
                                  : 'bg-neutral-200 dark:bg-neutral-700'
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-xs transform transition-transform ${
                                  skill.enabled ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>

                          {skill.description && (
                            <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed line-clamp-2">
                              {skill.description}
                            </p>
                          )}

                          <div className="flex items-center justify-between gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800/80 text-[11px]">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedSkillId(isExpanded ? null : skill.skillId)
                              }
                              className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium cursor-pointer whitespace-nowrap"
                            >
                              {isExpanded ? 'Hide SKILL.md' : 'View SKILL.md'}
                            </button>

                            <div className="flex items-center gap-3 shrink-0">
                              <button
                                type="button"
                                onClick={() => openSkillEditor(skill)}
                                className="text-neutral-600 dark:text-neutral-300 hover:text-neutral-950 dark:hover:text-white font-medium cursor-pointer whitespace-nowrap"
                              >
                                Edit
                              </button>
                              {skill.source !== 'builtin' && (
                                <button
                                  type="button"
                                  onClick={() => onDeleteSkill(skill.skillId)}
                                  className="text-rose-600 dark:text-rose-400 hover:underline font-medium cursor-pointer whitespace-nowrap"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>

                          {isExpanded && (
                            <pre className="mt-1 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-[11px] font-mono text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap overflow-x-auto max-h-48">
                              {skill.instructionsMarkdown}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* DISCOVER (SKILLS.SH) TAB */}
            {skillsTab === 'discover' && (
              <div className="space-y-4">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runRegistrySearch(registryQuery);
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={registryQuery}
                    onChange={(e) => setRegistryQuery(e.target.value)}
                    placeholder="Search skills.sh finance playbooks (e.g., tax, dcf, cashflow, invoice)..."
                    className="flex-1 h-9 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-3.5 text-xs text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={searchingRegistry}
                    className="h-9 px-4 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {searchingRegistry ? 'Searching...' : 'Search'}
                  </button>
                </form>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {['All', 'Tax', 'Cashflow', 'Valuation', 'GST', 'Risk'].map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => {
                          const nextQ = chip === 'All' ? '' : chip;
                          setRegistryQuery(nextQ);
                          void runRegistrySearch(nextQ);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800/80 hover:bg-neutral-200 dark:hover:bg-neutral-800 text-[11px] font-medium text-neutral-700 dark:text-neutral-200 cursor-pointer whitespace-nowrap"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                  <span className="font-mono text-[11px] text-neutral-400">{registrySource}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {registryResults.map((item) => {
                    const isInstalled = installedSlugs.has(item.slug.toLowerCase());
                    const isPreview = previewRegistrySlug === item.slug;
                    return (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-neutral-200/90 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 p-4 flex flex-col justify-between gap-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white truncate">
                              {item.name}
                            </h3>
                            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 truncate tabular-nums">
                              {item.author} · {item.category} · {item.installs.toLocaleString()} installs
                            </p>
                          </div>

                          <button
                            type="button"
                            disabled={isInstalled}
                            onClick={() => onInstallCatalogSkill(item)}
                            className={`h-8 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                              isInstalled
                                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 cursor-default'
                                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                            }`}
                          >
                            {isInstalled ? 'Installed' : 'Install'}
                          </button>
                        </div>

                        <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                          {item.description}
                        </p>

                        <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-neutral-800/80 text-[11px]">
                          <span className="font-mono text-neutral-400 truncate max-w-[60%]">{item.repo}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setPreviewRegistrySlug(isPreview ? null : item.slug)
                            }
                            className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium cursor-pointer whitespace-nowrap"
                          >
                            {isPreview ? 'Hide SKILL.md' : 'Preview SKILL.md'}
                          </button>
                        </div>

                        {isPreview && (
                          <pre className="p-3 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-[11px] font-mono text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap overflow-x-auto max-h-48">
                            {item.instructionsMarkdown}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* CUSTOM SKILL BUILDER TAB */}
            {skillsTab === 'builder' && (
              <form
                onSubmit={handleSaveSkillSubmit}
                className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-[#FAFAFA] dark:bg-neutral-900/60 p-4 sm:p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
                      {editingSkillId ? 'Edit Skill Playbook' : 'Create Custom Skill'}
                    </h3>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Enabled skills inject directly into Liddy AI CFO instructions.
                    </p>
                  </div>
                  {!editingSkillId && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => applySkillPreset('treasury')}
                        className="px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-[11px] font-medium text-neutral-700 dark:text-neutral-300 hover:border-indigo-400 cursor-pointer"
                      >
                        Treasury template
                      </button>
                      <button
                        type="button"
                        onClick={() => applySkillPreset('tax')}
                        className="px-2.5 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-[11px] font-medium text-neutral-700 dark:text-neutral-300 hover:border-indigo-400 cursor-pointer"
                      >
                        Tax template
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                      Skill name
                    </label>
                    <input
                      type="text"
                      value={skillName}
                      onChange={(e) => setSkillName(e.target.value)}
                      placeholder="e.g., Monthly Treasury Sweep"
                      className="w-full rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs text-neutral-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                      Category
                    </label>
                    <select
                      value={skillCategory}
                      onChange={(e) => setSkillCategory(e.target.value)}
                      className="w-full rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs text-neutral-900 dark:text-white"
                    >
                      {SKILL_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                      Trigger keywords
                    </label>
                    <input
                      type="text"
                      value={skillTriggers}
                      onChange={(e) => setSkillTriggers(e.target.value)}
                      placeholder="treasury sweep, idle cash, reserve ratio"
                      className="w-full rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs font-mono text-neutral-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                      Short summary
                    </label>
                    <input
                      type="text"
                      value={skillDesc}
                      onChange={(e) => setSkillDesc(e.target.value)}
                      placeholder="Concise description of what this skill automates"
                      className="w-full rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs text-neutral-900 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                      SKILL.md instructions
                    </label>
                    <button
                      type="button"
                      onClick={() => applySkillPreset('blank')}
                      className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                    >
                      Reset starter
                    </button>
                  </div>
                  <textarea
                    rows={9}
                    value={skillMarkdown}
                    onChange={(e) => setSkillMarkdown(e.target.value)}
                    className="w-full rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 p-3 text-xs font-mono text-neutral-900 dark:text-white leading-relaxed focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                {skillFormError && (
                  <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                    {skillFormError}
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setSkillsTab('installed')}
                    className="h-9 px-4 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold text-neutral-700 dark:text-neutral-200 cursor-pointer whitespace-nowrap"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingSkill}
                    className="h-9 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    {savingSkill ? 'Saving...' : editingSkillId ? 'Update Skill' : 'Save & Activate'}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </section>
    </div>
  );

  return createPortal(modal, document.body);
};
