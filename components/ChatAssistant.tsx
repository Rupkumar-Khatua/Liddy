import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { auth, db, OperationType, handleFirestoreError } from '../firebase';
import {
  ChatMessage,
  ChatSessionRecord,
  AgentChartSpec,
  AgentCsvExportSpec,
  AgentPdfReportSpec,
  AiSkillRecord,
  McpConnectorRecord,
  SkillsShCatalogItem,
} from '../types';
import {
  queryFinanceAgent,
  AgentMode,
  AgentAttachment,
  inspectMcpConnector,
} from '../services/geminiService';
import {
  buildDefaultSkills,
  buildDefaultConnectors,
  MCP_CONNECTOR_TEMPLATES,
} from '../services/agentExtensionsData';
import { AgentStudioDrawers, AgentStudioDrawerMode } from './AgentStudioDrawers';
import { triggerFileDownload } from '../services/emailReceiptService';
import { downloadAgentPdfReport } from '../utils/agentPdfBuilder';
import LiveAdvisor from './LiveAdvisor';
import { Logo } from './Logo';
import { useFinMind } from '../context/FinMindContext';
import { FormattedMessage } from './FormattedMessage';

const LOCAL_CHAT_SESSIONS_KEY = 'liddy_chat_sessions_v1';
const LOCAL_SKILLS_KEY = 'liddy_ai_skills_v1';
const LOCAL_CONNECTORS_KEY = 'liddy_mcp_connectors_v1';
const CHART_PALETTE = ['#0F766E', '#2563EB', '#D97706', '#111827', '#4F46E5', '#059669'];

const QUICK_AUTOMATIONS = [
  {
    id: 'visual_csv_pdf',
    label: 'Visual Dashboard + CSV & PDF',
    mode: 'agent' as AgentMode,
    prompt: 'Analyze my attached bill or current ledger data, visualize the category breakdown with charts, and generate both a downloadable CSV dashboard file and an executive PDF report.',
  },
  {
    id: 'cleanse_ledger',
    label: 'Cleanse Ledger',
    mode: 'agent' as AgentMode,
    prompt: 'Cleanse my ledger automatically: remove duplicates, normalize merchant names, standardize generic categories and report what changed.',
  },
  {
    id: 'balance_sheet',
    label: 'Balance Sheet',
    mode: 'agent' as AgentMode,
    prompt: 'Compile a balance sheet for my current asset portfolio and liabilities with equity commentary and generate a PDF summary.',
  },
  {
    id: 'cash_flow_audit',
    label: 'Cash Flow Audit',
    mode: 'agent' as AgentMode,
    prompt: 'Run a thorough cash flow analysis identifying burn rate, runway and liquidity optimization with charts and CSV export.',
  },
  {
    id: 'ratios_analysis',
    label: 'Financial Ratios',
    mode: 'agent' as AgentMode,
    prompt: 'Compute debt-to-equity, current ratio, operating margin and overall financial health score.',
  },
];

const MODES: Array<{
  id: AgentMode;
  label: string;
  badge: string;
  description: string;
  icon: string;
}> = [
  {
    id: 'chat',
    label: 'Chat Mode',
    badge: 'Fast Advisory',
    description: 'Instant conversational financial guidance and portfolio coaching.',
    icon: '💬',
  },
  {
    id: 'web',
    label: 'Web Search',
    badge: 'Live Grounding',
    description: 'Real-time quotes, central bank updates and verified market news.',
    icon: '🌐',
  },
  {
    id: 'agent',
    label: 'Agent Mode',
    badge: 'CFO Copilot',
    description: 'Auto-activates tools for charts, CSV dashboards, PDF reports & ledger audits.',
    icon: '⚡',
  },
  {
    id: 'ocr',
    label: 'Receipt Reader',
    badge: 'Doc Vision',
    description: 'Clear visual reading of receipts, invoices and bank statements.',
    icon: '🔍',
  },
];

interface ChatMessageExtended extends ChatMessage {
  attachmentName?: string;
  attachmentType?: string;
  attachmentData?: string;
}

interface ChatAssistantProps {
  initialVoiceMode?: boolean;
}

function createSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createWelcomeMessage(): ChatMessageExtended {
  return {
    id: `welcome_${Date.now()}`,
    role: 'model',
    text: 'Hello, I am Liddy. Ask me about your spending, cashflow, or portfolio — or switch to **Agent Mode** and upload a bill PDF or CSV to generate inline analytics charts, a CSV dashboard file, and an executive PDF report.',
    timestamp: new Date(),
  };
}

function stripUndefinedDeep<T>(val: T): T {
  if (val === null || val === undefined) return val;
  if (val instanceof Date) return val.toISOString() as unknown as T;
  if (Array.isArray(val)) {
    return val
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return val;
}

function serializeMessagesForStorage(
  msgs: ChatMessageExtended[]
): ChatSessionRecord['messages'] {
  return msgs.slice(-80).map((m) => {
    const safeCsv = m.csvExport
      ? {
          filename: String(m.csvExport.filename || 'liddy-dashboard.csv').slice(0, 120),
          title: String(m.csvExport.title || 'CSV Dashboard').slice(0, 160),
          headers: (m.csvExport.headers || []).slice(0, 16),
          rows: (m.csvExport.rows || []).slice(0, 80),
          csvContent: String(m.csvExport.csvContent || '').slice(0, 120000),
        }
      : undefined;

    return stripUndefinedDeep({
      id: m.id,
      role: m.role,
      text: String(m.text || '').slice(0, 18000),
      timestamp:
        m.timestamp instanceof Date
          ? m.timestamp.toISOString()
          : new Date(m.timestamp || Date.now()).toISOString(),
      attachmentName: m.attachmentName,
      groundingUrls: m.groundingUrls?.slice(0, 12),
      activatedTools: m.activatedTools?.slice(0, 16),
      appliedSummary: m.appliedSummary,
      charts: m.charts?.slice(0, 4),
      csvExport: safeCsv,
      pdfReport: m.pdfReport,
    });
  });
}

function hydrateSessionMessages(
  rawMsgs: ChatSessionRecord['messages'] | undefined
): ChatMessageExtended[] {
  if (!Array.isArray(rawMsgs) || rawMsgs.length === 0) {
    return [createWelcomeMessage()];
  }
  return rawMsgs.map((m) => ({
    ...m,
    timestamp: new Date(m.timestamp || Date.now()),
  }));
}

function deriveSessionTitle(msgs: ChatMessageExtended[]): string {
  const firstUser = msgs.find((m) => m.role === 'user');
  if (!firstUser) return 'New Advisory Session';
  const clean = firstUser.text.replace(/^\[Uploaded Document:\s*([^\]]+)\]/i, '$1').trim();
  return (clean || firstUser.attachmentName || 'Financial Analysis').slice(0, 120);
}

function deriveSessionPreview(msgs: ChatMessageExtended[]): string {
  const last = msgs[msgs.length - 1];
  if (!last) return '';
  return String(last.text || '')
    .replace(/[#*`>_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (val && typeof (val as any).toDate === 'function') {
    return (val as any).toDate().toISOString();
  }
  if (typeof val === 'string' && val) return val;
  return new Date().toISOString();
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'Just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const AgentChartCard: React.FC<{ spec: AgentChartSpec; fallbackCurrency: string }> = ({
  spec,
  fallbackCurrency,
}) => {
  const cur = spec.currencySymbol ?? fallbackCurrency;
  const chartData = useMemo(
    () =>
      (spec.data || []).map((d) => ({
        name: String(d.label || '').slice(0, 22),
        value: Number(d.value) || 0,
        secondaryValue: d.secondaryValue !== undefined ? Number(d.secondaryValue) || 0 : undefined,
      })),
    [spec.data]
  );

  if (chartData.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[#E5E5E5] dark:border-neutral-800 bg-[#FAFAFA] dark:bg-neutral-950/70 p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h4 className="text-xs font-bold text-neutral-900 dark:text-white tracking-tight">
            {spec.title}
          </h4>
          {spec.subtitle && (
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
              {spec.subtitle}
            </p>
          )}
        </div>
        <span className="text-[10px] font-mono uppercase font-semibold px-2 py-0.5 rounded-md bg-white dark:bg-neutral-900 border border-[#E5E5E5] dark:border-neutral-800 text-neutral-600 dark:text-neutral-300">
          {spec.chartType}
        </span>
      </div>

      <div className="w-full h-56">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          {spec.chartType === 'pie' ? (
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={42}
                outerRadius={76}
                paddingAngle={2}
              >
                {chartData.map((_, idx) => (
                  <Cell key={idx} fill={CHART_PALETTE[idx % CHART_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(val: unknown) => `${cur}${Number(val || 0).toLocaleString()}`}
                contentStyle={{
                  backgroundColor: '#111114',
                  borderColor: '#27272A',
                  borderRadius: '10px',
                  fontSize: '12px',
                  color: '#F4F4F5',
                }}
              />
            </PieChart>
          ) : spec.chartType === 'trend' ? (
            <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id={`grad_${spec.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563EB" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#2563EB" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" strokeOpacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717A' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#71717A' }} axisLine={false} tickLine={false} width={54} />
              <Tooltip
                formatter={(val: unknown) => `${cur}${Number(val || 0).toLocaleString()}`}
                contentStyle={{
                  backgroundColor: '#111114',
                  borderColor: '#27272A',
                  borderRadius: '10px',
                  fontSize: '12px',
                  color: '#F4F4F5',
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#2563EB"
                strokeWidth={2}
                fillOpacity={1}
                fill={`url(#grad_${spec.id})`}
              />
            </AreaChart>
          ) : (
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" strokeOpacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717A' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#71717A' }} axisLine={false} tickLine={false} width={54} />
              <Tooltip
                formatter={(val: unknown) => `${cur}${Number(val || 0).toLocaleString()}`}
                contentStyle={{
                  backgroundColor: '#111114',
                  borderColor: '#27272A',
                  borderRadius: '10px',
                  fontSize: '12px',
                  color: '#F4F4F5',
                }}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {chartData.map((_, idx) => (
                  <Cell key={idx} fill={CHART_PALETTE[idx % CHART_PALETTE.length]} />
                ))}
              </Bar>
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>

      {spec.chartType === 'pie' && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {chartData.slice(0, 6).map((item, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1.5 text-[11px] font-mono text-neutral-600 dark:text-neutral-300 px-2 py-0.5 rounded-md bg-white dark:bg-neutral-900 border border-[#E5E5E5] dark:border-neutral-800 tabular-nums"
            >
              <span
                className="w-2 h-2 rounded-xs shrink-0"
                style={{ backgroundColor: CHART_PALETTE[idx % CHART_PALETTE.length] }}
              />
              <span className="truncate max-w-[110px]">{item.name}:</span>
              <strong className="text-neutral-900 dark:text-white">
                {cur}
                {item.value.toLocaleString()}
              </strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const AgentCsvCard: React.FC<{ spec: AgentCsvExportSpec }> = ({ spec }) => {
  const safeName = spec.filename.toLowerCase().endsWith('.csv')
    ? spec.filename
    : `${spec.filename}.csv`;
  const previewRows = (spec.rows || []).slice(0, 5);

  return (
    <div className="rounded-2xl border border-[#E5E5E5] dark:border-neutral-800 bg-white dark:bg-neutral-950/70 overflow-hidden">
      <div className="px-4 py-3 border-b border-[#E5E5E5] dark:border-neutral-800 bg-[#FAFAFA] dark:bg-neutral-900/70 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              CSV DASHBOARD
            </span>
            <h4 className="text-xs font-bold text-neutral-900 dark:text-white truncate">
              {spec.title}
            </h4>
          </div>
          <p className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400 mt-0.5 tabular-nums">
            {safeName} · {spec.rows.length} rows × {spec.headers.length} columns
          </p>
        </div>

        <button
          type="button"
          onClick={() => triggerFileDownload(spec.csvContent, safeName, 'text/csv;charset=utf-8;')}
          className="px-3.5 py-1.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-100 text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
          </svg>
          <span>Download .CSV</span>
        </button>
      </div>

      {spec.headers.length > 0 && previewRows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-[#E5E5E5] dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/40">
                {spec.headers.map((h, i) => (
                  <th
                    key={i}
                    className="px-3 py-2 font-mono font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className="border-b last:border-b-0 border-neutral-100 dark:border-neutral-800/70"
                >
                  {spec.headers.map((_, cIdx) => (
                    <td
                      key={cIdx}
                      className="px-3 py-1.5 text-neutral-800 dark:text-neutral-200 font-mono tabular-nums whitespace-nowrap max-w-[180px] truncate"
                    >
                      {row[cIdx] !== undefined ? String(row[cIdx]) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {spec.rows.length > 5 && (
            <div className="px-3 py-1.5 text-[10px] font-mono text-neutral-400 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/40 dark:bg-neutral-900/30">
              Showing first 5 of {spec.rows.length} rows — download full .csv for complete data.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const AgentPdfCard: React.FC<{ spec: AgentPdfReportSpec }> = ({ spec }) => {
  const safeName = spec.filename.toLowerCase().endsWith('.pdf')
    ? spec.filename
    : `${spec.filename}.pdf`;

  return (
    <div className="rounded-2xl border border-[#E5E5E5] dark:border-neutral-800 bg-[#FAFAFA] dark:bg-neutral-950/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              PDF BRIEF
            </span>
            <h4 className="text-xs font-bold text-neutral-900 dark:text-white truncate">
              {spec.title}
            </h4>
          </div>
          {spec.subtitle && (
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1">
              {spec.subtitle}
            </p>
          )}
          <p className="text-[11px] font-mono text-neutral-400 mt-1 tabular-nums">
            {safeName} · {spec.sections?.length || 0} sections
          </p>
        </div>

        <button
          type="button"
          onClick={() => downloadAgentPdfReport(spec)}
          className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 shadow-xs"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 10v6m0 0l-3-3m3 3l3-3M5 20h14a2 2 0 002-2V8.414a1 1 0 00-.293-.707l-4.414-4.414A1 1 0 0015.586 3H5a2 2 0 00-2 2v13a2 2 0 002 2z" />
          </svg>
          <span>Download .PDF</span>
        </button>
      </div>

      {spec.kpis && spec.kpis.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-[#E5E5E5] dark:border-neutral-800">
          {spec.kpis.slice(0, 4).map((kpi, idx) => (
            <div
              key={idx}
              className="rounded-xl bg-white dark:bg-neutral-900 border border-[#E5E5E5] dark:border-neutral-800 px-2.5 py-2"
            >
              <p className="text-[9px] font-mono uppercase tracking-wider text-neutral-400 truncate">
                {kpi.label}
              </p>
              <p className="text-xs font-bold text-neutral-900 dark:text-white font-mono tabular-nums mt-0.5 truncate">
                {kpi.value}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ChatAssistant: React.FC<ChatAssistantProps> = ({ initialVoiceMode = false }) => {
  const {
    currentUser,
    trackEngagement,
    transactions,
    invoices,
    watchlist,
    stockPortfolio,
    goals,
    currencySymbol,
    applyAgentLedgerOperations,
  } = useFinMind();

  const [activeSessionId, setActiveSessionId] = useState<string>(() => createSessionId());
  const [sessions, setSessions] = useState<ChatSessionRecord[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [historySearch, setHistorySearch] = useState<string>('');

  const [messages, setMessages] = useState<ChatMessageExtended[]>(() => [createWelcomeMessage()]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(initialVoiceMode);
  const [activeMode, setActiveMode] = useState<AgentMode>('chat');
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const [attachment, setAttachment] = useState<AgentAttachment | null>(null);

  // Studio Drawer State & Extensions (Skills & MCP Connectors)
  const [studioDrawer, setStudioDrawer] = useState<AgentStudioDrawerMode>('none');
  const [aiSkills, setAiSkills] = useState<AiSkillRecord[]>(() => buildDefaultSkills('guest'));
  const [mcpConnectors, setMcpConnectors] = useState<McpConnectorRecord[]>(() =>
    buildDefaultConnectors('guest')
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);
  const persistedFirestoreIdsRef = useRef<Set<string>>(new Set());
  const persistedSkillIdsRef = useRef<Set<string>>(new Set());
  const persistedConnectorIdsRef = useRef<Set<string>>(new Set());
  const seededExtensionsUidRef = useRef<string | null>(null);

  const authenticatedUid =
    currentUser?.uid &&
    !currentUser.isGuest &&
    auth.currentUser?.uid === currentUser.uid
      ? currentUser.uid
      : null;

  // Subscribe to Firestore chat sessions for signed-in user, or load localStorage for guest
  useEffect(() => {
    if (!authenticatedUid) {
      persistedFirestoreIdsRef.current.clear();
      try {
        const raw = localStorage.getItem(LOCAL_CHAT_SESSIONS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setSessions(parsed);
            return;
          }
        }
      } catch {
        // Ignore storage read failure
      }
      setSessions([]);
      return;
    }

    const sessionsPath = `users/${authenticatedUid}/chat_sessions`;
    const q = query(
      collection(db, 'users', authenticatedUid, 'chat_sessions'),
      orderBy('updatedAt', 'desc'),
      limit(40)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const loaded: ChatSessionRecord[] = [];
        const ids = new Set<string>();
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          const id = String(d.sessionId || docSnap.id);
          ids.add(id);
          loaded.push({
            sessionId: id,
            userId: String(d.userId || authenticatedUid),
            title: String(d.title || 'Financial Advisory'),
            mode: (['chat', 'agent', 'ocr', 'web'].includes(d.mode) ? d.mode : 'chat') as AgentMode,
            preview: typeof d.preview === 'string' ? d.preview : '',
            messages: Array.isArray(d.messages) ? d.messages : [],
            createdAt: toIsoString(d.createdAt),
            updatedAt: toIsoString(d.updatedAt),
          });
        });
        persistedFirestoreIdsRef.current = ids;
        setSessions(loaded);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, sessionsPath);
      }
    );

    return () => unsubscribe();
  }, [authenticatedUid]);

  // Subscribe & sync AI Skills + MCP Connectors (Firestore for signed-in users, localStorage for guests)
  useEffect(() => {
    if (!authenticatedUid) {
      persistedSkillIdsRef.current.clear();
      persistedConnectorIdsRef.current.clear();
      seededExtensionsUidRef.current = null;
      try {
        const rawSkills = localStorage.getItem(LOCAL_SKILLS_KEY);
        if (rawSkills) {
          const parsed = JSON.parse(rawSkills);
          if (Array.isArray(parsed) && parsed.length > 0) setAiSkills(parsed);
        } else {
          const defaults = buildDefaultSkills('guest');
          setAiSkills(defaults);
          localStorage.setItem(LOCAL_SKILLS_KEY, JSON.stringify(defaults));
        }
        const rawConns = localStorage.getItem(LOCAL_CONNECTORS_KEY);
        if (rawConns) {
          const parsed = JSON.parse(rawConns);
          if (Array.isArray(parsed)) {
            const cleaned = parsed.filter(
              (c: any) =>
                c &&
                c.providerType !== 'builtin' &&
                !String(c.connectorId || '').startsWith('mcp_liddy_') &&
                c.connectorId !== 'mcp_cat_workspace'
            );
            const existingIds = new Set(cleaned.map((c: any) => c.connectorId));
            const catalogExtras = buildDefaultConnectors('guest').filter(
              (tpl) => !existingIds.has(tpl.connectorId)
            );
            const merged = [...cleaned, ...catalogExtras];
            setMcpConnectors(merged);
            localStorage.setItem(LOCAL_CONNECTORS_KEY, JSON.stringify(merged));
          }
        } else {
          const defaults = buildDefaultConnectors('guest');
          setMcpConnectors(defaults);
          localStorage.setItem(LOCAL_CONNECTORS_KEY, JSON.stringify(defaults));
        }
      } catch {
        // Ignore storage errors
      }
      return;
    }

    const skillsPath = `users/${authenticatedUid}/ai_skills`;
    const connectorsPath = `users/${authenticatedUid}/mcp_connectors`;

    const unsubSkills = onSnapshot(
      collection(db, 'users', authenticatedUid, 'ai_skills'),
      async (snapshot) => {
        if (snapshot.empty && seededExtensionsUidRef.current !== `${authenticatedUid}_skills`) {
          seededExtensionsUidRef.current = `${authenticatedUid}_skills`;
          const defaults = buildDefaultSkills(authenticatedUid);
          setAiSkills(defaults);
          for (const sk of defaults) {
            persistedSkillIdsRef.current.add(sk.skillId);
            const docPath = `${skillsPath}/${sk.skillId}`;
            try {
              await setDoc(doc(db, 'users', authenticatedUid, 'ai_skills', sk.skillId), {
                skillId: sk.skillId,
                userId: authenticatedUid,
                name: sk.name,
                slug: sk.slug,
                source: sk.source,
                category: sk.category,
                description: sk.description || '',
                triggers: sk.triggers || '',
                instructionsMarkdown: sk.instructionsMarkdown,
                author: sk.author || 'liddy-finance',
                repo: sk.repo || '',
                installs: sk.installs || 0,
                enabled: sk.enabled,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            } catch (err) {
              handleFirestoreError(err, OperationType.CREATE, docPath);
            }
          }
          return;
        }
        const ids = new Set<string>();
        const list: AiSkillRecord[] = [];
        snapshot.forEach((dSnap) => {
          const d = dSnap.data();
          const id = String(d.skillId || dSnap.id);
          ids.add(id);
          list.push({
            skillId: id,
            userId: String(d.userId || authenticatedUid),
            name: String(d.name || 'Skill'),
            slug: String(d.slug || id),
            source: (['builtin', 'skills.sh', 'custom'].includes(d.source) ? d.source : 'custom') as AiSkillRecord['source'],
            category: String(d.category || 'Finance'),
            description: typeof d.description === 'string' ? d.description : '',
            triggers: typeof d.triggers === 'string' ? d.triggers : '',
            instructionsMarkdown: String(d.instructionsMarkdown || ''),
            author: typeof d.author === 'string' ? d.author : undefined,
            repo: typeof d.repo === 'string' ? d.repo : undefined,
            installs: typeof d.installs === 'number' ? d.installs : undefined,
            enabled: Boolean(d.enabled),
            createdAt: toIsoString(d.createdAt),
            updatedAt: toIsoString(d.updatedAt),
          });
        });
        persistedSkillIdsRef.current = ids;
        setAiSkills(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, skillsPath)
    );

    const unsubConnectors = onSnapshot(
      collection(db, 'users', authenticatedUid, 'mcp_connectors'),
      async (snapshot) => {
        if (snapshot.empty && seededExtensionsUidRef.current !== `${authenticatedUid}_conns`) {
          seededExtensionsUidRef.current = `${authenticatedUid}_conns`;
          const defaults = buildDefaultConnectors(authenticatedUid);
          setMcpConnectors(defaults);
          for (const c of defaults) {
            persistedConnectorIdsRef.current.add(c.connectorId);
            const docPath = `${connectorsPath}/${c.connectorId}`;
            try {
              await setDoc(doc(db, 'users', authenticatedUid, 'mcp_connectors', c.connectorId), {
                connectorId: c.connectorId,
                userId: authenticatedUid,
                name: c.name,
                slug: c.slug,
                providerType: c.providerType,
                category: c.category,
                description: c.description || '',
                endpointUrl: c.endpointUrl || '',
                transport: c.transport,
                authType: c.authType || 'none',
                toolsList: c.toolsList || [],
                status: c.status,
                enabled: c.enabled,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            } catch (err) {
              handleFirestoreError(err, OperationType.CREATE, docPath);
            }
          }
          return;
        }
        const ids = new Set<string>();
        const list: McpConnectorRecord[] = [];
        snapshot.forEach((dSnap) => {
          const d = dSnap.data();
          const id = String(d.connectorId || dSnap.id);
          const pType = ['builtin', 'catalog', 'custom'].includes(d.providerType)
            ? (d.providerType as McpConnectorRecord['providerType'])
            : 'custom';
          // Exclude legacy internal Liddy MCP records from the external Connectors directory
          if (pType === 'builtin' || id.startsWith('mcp_liddy_') || id === 'mcp_cat_workspace') {
            return;
          }
          ids.add(id);
          list.push({
            connectorId: id,
            userId: String(d.userId || authenticatedUid),
            name: String(d.name || 'MCP Server'),
            slug: String(d.slug || id),
            providerType: pType,
            category: String(d.category || 'Workspace'),
            description: typeof d.description === 'string' ? d.description : '',
            endpointUrl: typeof d.endpointUrl === 'string' ? d.endpointUrl : '',
            transport: (['http', 'sse'].includes(d.transport) ? d.transport : 'http') as McpConnectorRecord['transport'],
            authType: (['none', 'bearer', 'api_key'].includes(d.authType) ? d.authType : 'none') as McpConnectorRecord['authType'],
            authCredentialMasked: typeof d.authCredentialMasked === 'string' ? d.authCredentialMasked : undefined,
            toolsList: Array.isArray(d.toolsList) ? d.toolsList.map(String) : [],
            status: (['connected', 'disconnected', 'error'].includes(d.status) ? d.status : 'disconnected') as McpConnectorRecord['status'],
            enabled: Boolean(d.enabled),
            createdAt: toIsoString(d.createdAt),
            updatedAt: toIsoString(d.updatedAt),
          });
        });
        const existingIds = new Set(list.map((c) => c.connectorId));
        const catalogBackfill = buildDefaultConnectors(authenticatedUid).filter(
          (tpl) => !existingIds.has(tpl.connectorId)
        );
        persistedConnectorIdsRef.current = ids;
        setMcpConnectors([...list, ...catalogBackfill]);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, connectorsPath)
    );

    return () => {
      unsubSkills();
      unsubConnectors();
    };
  }, [authenticatedUid]);

  const persistSession = useCallback(
    async (
      sessionId: string,
      nextMessages: ChatMessageExtended[],
      mode: AgentMode
    ) => {
      // Only persist sessions once the user has sent at least one prompt
      if (!nextMessages.some((m) => m.role === 'user')) return;

      const nowIso = new Date().toISOString();
      const title = deriveSessionTitle(nextMessages);
      const preview = deriveSessionPreview(nextMessages);
      const serialized = serializeMessagesForStorage(nextMessages);

      const record: ChatSessionRecord = {
        sessionId,
        userId: authenticatedUid || 'guest',
        title,
        mode,
        preview,
        messages: serialized,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      setSessions((prev) => {
        const existingIdx = prev.findIndex((s) => s.sessionId === sessionId);
        const createdAt = existingIdx >= 0 ? prev[existingIdx].createdAt : nowIso;
        const nextRecord = { ...record, createdAt };
        const updated = [nextRecord, ...prev.filter((s) => s.sessionId !== sessionId)].slice(0, 40);
        if (!authenticatedUid) {
          try {
            localStorage.setItem(LOCAL_CHAT_SESSIONS_KEY, JSON.stringify(updated));
          } catch {
            // Ignore quota errors
          }
        }
        return updated;
      });

      if (authenticatedUid) {
        const docPath = `users/${authenticatedUid}/chat_sessions/${sessionId}`;
        const docRef = doc(db, 'users', authenticatedUid, 'chat_sessions', sessionId);
        const alreadyInFirestore = persistedFirestoreIdsRef.current.has(sessionId);
        try {
          if (alreadyInFirestore) {
            await updateDoc(docRef, {
              title,
              mode,
              preview,
              messages: serialized,
              updatedAt: serverTimestamp(),
            });
          } else {
            persistedFirestoreIdsRef.current.add(sessionId);
            await setDoc(docRef, {
              sessionId,
              userId: authenticatedUid,
              title,
              mode,
              preview,
              messages: serialized,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, docPath);
        }
      }
    },
    [authenticatedUid]
  );

  const handleStartNewChat = () => {
    const newId = createSessionId();
    setActiveSessionId(newId);
    setMessages([createWelcomeMessage()]);
    setAttachment(null);
    setInput('');
    setMobileSidebarOpen(false);
  };

  const handleSelectSession = (session: ChatSessionRecord) => {
    setActiveSessionId(session.sessionId);
    setMessages(hydrateSessionMessages(session.messages));
    setActiveMode(session.mode || 'chat');
    setAttachment(null);
    setMobileSidebarOpen(false);
  };

  const handleDeleteSession = async (
    e: React.MouseEvent,
    sessionId: string
  ) => {
    e.stopPropagation();
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.sessionId !== sessionId);
      if (!authenticatedUid) {
        try {
          localStorage.setItem(LOCAL_CHAT_SESSIONS_KEY, JSON.stringify(filtered));
        } catch {
          // Ignore
        }
      }
      return filtered;
    });

    if (sessionId === activeSessionId) {
      setActiveSessionId(createSessionId());
      setMessages([createWelcomeMessage()]);
    }

    if (authenticatedUid && persistedFirestoreIdsRef.current.has(sessionId)) {
      const docPath = `users/${authenticatedUid}/chat_sessions/${sessionId}`;
      try {
        await deleteDoc(doc(db, 'users', authenticatedUid, 'chat_sessions', sessionId));
        persistedFirestoreIdsRef.current.delete(sessionId);
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, docPath);
      }
    }
  };

  const saveSkillsLocal = (next: AiSkillRecord[]) => {
    if (!authenticatedUid) {
      try {
        localStorage.setItem(LOCAL_SKILLS_KEY, JSON.stringify(next));
      } catch {}
    }
  };

  const saveConnectorsLocal = (next: McpConnectorRecord[]) => {
    if (!authenticatedUid) {
      try {
        localStorage.setItem(LOCAL_CONNECTORS_KEY, JSON.stringify(next));
      } catch {}
    }
  };

  const handleToggleSkill = async (skillId: string, enabled: boolean) => {
    const nowIso = new Date().toISOString();
    setAiSkills((prev) => {
      const next = prev.map((s) => (s.skillId === skillId ? { ...s, enabled, updatedAt: nowIso } : s));
      saveSkillsLocal(next);
      return next;
    });
    if (authenticatedUid && persistedSkillIdsRef.current.has(skillId)) {
      const docPath = `users/${authenticatedUid}/ai_skills/${skillId}`;
      try {
        await updateDoc(doc(db, 'users', authenticatedUid, 'ai_skills', skillId), {
          enabled,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, docPath);
      }
    }
  };

  const handleSaveCustomSkill = async (payload: {
    skillId?: string;
    name: string;
    category: string;
    description: string;
    triggers: string;
    instructionsMarkdown: string;
  }) => {
    const nowIso = new Date().toISOString();
    const isEdit = Boolean(payload.skillId && aiSkills.some((s) => s.skillId === payload.skillId));
    const skillId = payload.skillId || `skill_custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const slug = payload.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || 'custom-skill';

    if (isEdit) {
      setAiSkills((prev) => {
        const next = prev.map((s) =>
          s.skillId === skillId
            ? {
                ...s,
                name: payload.name,
                slug,
                category: payload.category,
                description: payload.description,
                triggers: payload.triggers,
                instructionsMarkdown: payload.instructionsMarkdown,
                updatedAt: nowIso,
              }
            : s
        );
        saveSkillsLocal(next);
        return next;
      });
      if (authenticatedUid && persistedSkillIdsRef.current.has(skillId)) {
        const docPath = `users/${authenticatedUid}/ai_skills/${skillId}`;
        try {
          await updateDoc(doc(db, 'users', authenticatedUid, 'ai_skills', skillId), {
            name: payload.name,
            slug,
            category: payload.category,
            description: payload.description,
            triggers: payload.triggers,
            instructionsMarkdown: payload.instructionsMarkdown,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, docPath);
        }
      }
      return;
    }

    const newRec: AiSkillRecord = {
      skillId,
      userId: authenticatedUid || 'guest',
      name: payload.name,
      slug,
      source: 'custom',
      category: payload.category,
      description: payload.description,
      triggers: payload.triggers,
      instructionsMarkdown: payload.instructionsMarkdown,
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setAiSkills((prev) => {
      const next = [newRec, ...prev];
      saveSkillsLocal(next);
      return next;
    });

    if (authenticatedUid) {
      const docPath = `users/${authenticatedUid}/ai_skills/${skillId}`;
      persistedSkillIdsRef.current.add(skillId);
      try {
        await setDoc(doc(db, 'users', authenticatedUid, 'ai_skills', skillId), {
          skillId,
          userId: authenticatedUid,
          name: newRec.name,
          slug: newRec.slug,
          source: 'custom',
          category: newRec.category,
          description: newRec.description || '',
          triggers: newRec.triggers || '',
          instructionsMarkdown: newRec.instructionsMarkdown,
          enabled: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, docPath);
      }
    }
  };

  const handleInstallCatalogSkill = async (item: SkillsShCatalogItem) => {
    const nowIso = new Date().toISOString();
    const skillId = `skill_${item.slug.replace(/[^a-z0-9_-]/gi, '_')}_${Date.now().toString(36)}`;
    const newRec: AiSkillRecord = {
      skillId,
      userId: authenticatedUid || 'guest',
      name: item.name,
      slug: item.slug,
      source: 'skills.sh',
      category: item.category,
      description: item.description,
      triggers: item.triggers,
      instructionsMarkdown: item.instructionsMarkdown,
      author: item.author,
      repo: item.repo,
      installs: item.installs,
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setAiSkills((prev) => {
      if (prev.some((s) => s.slug.toLowerCase() === item.slug.toLowerCase())) return prev;
      const next = [newRec, ...prev];
      saveSkillsLocal(next);
      return next;
    });

    if (authenticatedUid) {
      const docPath = `users/${authenticatedUid}/ai_skills/${skillId}`;
      persistedSkillIdsRef.current.add(skillId);
      try {
        await setDoc(doc(db, 'users', authenticatedUid, 'ai_skills', skillId), {
          skillId,
          userId: authenticatedUid,
          name: newRec.name,
          slug: newRec.slug,
          source: 'skills.sh',
          category: newRec.category,
          description: newRec.description || '',
          triggers: newRec.triggers || '',
          instructionsMarkdown: newRec.instructionsMarkdown,
          author: item.author,
          repo: item.repo,
          installs: item.installs,
          enabled: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, docPath);
      }
    }
  };

  const handleDeleteSkill = async (skillId: string) => {
    setAiSkills((prev) => {
      const next = prev.filter((s) => s.skillId !== skillId);
      saveSkillsLocal(next);
      return next;
    });
    if (authenticatedUid && persistedSkillIdsRef.current.has(skillId)) {
      const docPath = `users/${authenticatedUid}/ai_skills/${skillId}`;
      try {
        await deleteDoc(doc(db, 'users', authenticatedUid, 'ai_skills', skillId));
        persistedSkillIdsRef.current.delete(skillId);
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, docPath);
      }
    }
  };

  const handleToggleConnector = async (connectorId: string, enabled: boolean) => {
    const nowIso = new Date().toISOString();
    const target = mcpConnectors.find((c) => c.connectorId === connectorId);
    setMcpConnectors((prev) => {
      const next = prev.map((c) =>
        c.connectorId === connectorId
          ? { ...c, enabled, status: enabled && c.status === 'disconnected' ? 'connected' : c.status, updatedAt: nowIso }
          : c
      );
      saveConnectorsLocal(next);
      return next;
    });
    if (authenticatedUid && target) {
      const docPath = `users/${authenticatedUid}/mcp_connectors/${connectorId}`;
      try {
        if (persistedConnectorIdsRef.current.has(connectorId)) {
          await updateDoc(doc(db, 'users', authenticatedUid, 'mcp_connectors', connectorId), {
            enabled,
            ...(enabled && target.status === 'disconnected' ? { status: 'connected' } : {}),
            updatedAt: serverTimestamp(),
          });
        } else {
          persistedConnectorIdsRef.current.add(connectorId);
          await setDoc(doc(db, 'users', authenticatedUid, 'mcp_connectors', connectorId), {
            connectorId: target.connectorId,
            userId: authenticatedUid,
            name: target.name,
            slug: target.slug,
            providerType: target.providerType,
            category: target.category,
            description: target.description || '',
            endpointUrl: target.endpointUrl || '',
            transport: target.transport,
            authType: target.authType || 'bearer',
            toolsList: target.toolsList || [],
            status: enabled ? 'connected' : target.status,
            enabled,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, docPath);
      }
    }
  };

  const handleInspectConnector = async (connectorId: string, rawToken?: string) => {
    const target = mcpConnectors.find((c) => c.connectorId === connectorId);
    if (!target) return;
    const result = await inspectMcpConnector({
      endpointUrl: target.endpointUrl || MCP_CONNECTOR_TEMPLATES.find((t) => t.connectorId === connectorId)?.endpointUrl || '',
      transport: target.transport,
      authType: target.authType,
      authToken: rawToken,
    });
    const nextStatus: McpConnectorRecord['status'] = result.ok ? 'connected' : 'error';
    const nextTools = result.tools.length > 0 ? result.tools : target.toolsList || [];
    const nowIso = new Date().toISOString();

    setMcpConnectors((prev) => {
      const next = prev.map((c) =>
        c.connectorId === connectorId
          ? {
              ...c,
              status: nextStatus,
              toolsList: nextTools,
              enabled: result.ok ? true : c.enabled,
              updatedAt: nowIso,
            }
          : c
      );
      saveConnectorsLocal(next);
      return next;
    });

    if (authenticatedUid) {
      const docPath = `users/${authenticatedUid}/mcp_connectors/${connectorId}`;
      try {
        if (persistedConnectorIdsRef.current.has(connectorId)) {
          await updateDoc(doc(db, 'users', authenticatedUid, 'mcp_connectors', connectorId), {
            status: nextStatus,
            toolsList: nextTools,
            enabled: result.ok ? true : target.enabled,
            updatedAt: serverTimestamp(),
          });
        } else {
          persistedConnectorIdsRef.current.add(connectorId);
          await setDoc(doc(db, 'users', authenticatedUid, 'mcp_connectors', connectorId), {
            connectorId: target.connectorId,
            userId: authenticatedUid,
            name: target.name,
            slug: target.slug,
            providerType: target.providerType,
            category: target.category,
            description: target.description || '',
            endpointUrl: target.endpointUrl || '',
            transport: target.transport,
            authType: target.authType || 'bearer',
            toolsList: nextTools,
            status: nextStatus,
            enabled: result.ok ? true : target.enabled,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, docPath);
      }
    }
  };

  const handleAddCustomConnector = async (payload: {
    name: string;
    category: string;
    description: string;
    endpointUrl: string;
    transport: 'http' | 'sse';
    authType: 'none' | 'bearer' | 'api_key';
    authToken?: string;
  }) => {
    const nowIso = new Date().toISOString();
    const connectorId = `mcp_custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const slug = payload.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || 'custom-mcp';

    const maskedCred = payload.authToken
      ? `••••${payload.authToken.slice(-4)}`
      : undefined;

    const inspectRes = await inspectMcpConnector({
      endpointUrl: payload.endpointUrl,
      transport: payload.transport,
      authType: payload.authType,
      authToken: payload.authToken,
    });

    const newRec: McpConnectorRecord = {
      connectorId,
      userId: authenticatedUid || 'guest',
      name: payload.name,
      slug,
      providerType: 'custom',
      category: payload.category,
      description: payload.description,
      endpointUrl: payload.endpointUrl,
      transport: payload.transport,
      authType: payload.authType,
      authCredentialMasked: maskedCred,
      toolsList: inspectRes.tools,
      status: inspectRes.ok ? 'connected' : 'error',
      enabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setMcpConnectors((prev) => {
      const next = [newRec, ...prev];
      saveConnectorsLocal(next);
      return next;
    });

    if (authenticatedUid) {
      const docPath = `users/${authenticatedUid}/mcp_connectors/${connectorId}`;
      persistedConnectorIdsRef.current.add(connectorId);
      try {
        await setDoc(doc(db, 'users', authenticatedUid, 'mcp_connectors', connectorId), {
          connectorId,
          userId: authenticatedUid,
          name: newRec.name,
          slug: newRec.slug,
          providerType: 'custom',
          category: newRec.category,
          description: newRec.description || '',
          endpointUrl: newRec.endpointUrl || '',
          transport: newRec.transport,
          authType: newRec.authType || 'none',
          ...(maskedCred ? { authCredentialMasked: maskedCred } : {}),
          toolsList: newRec.toolsList || [],
          status: newRec.status,
          enabled: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, docPath);
      }
    }
  };

  const handleDeleteConnector = async (connectorId: string) => {
    setMcpConnectors((prev) => {
      const next = prev.filter((c) => c.connectorId !== connectorId);
      saveConnectorsLocal(next);
      return next;
    });
    if (authenticatedUid && persistedConnectorIdsRef.current.has(connectorId)) {
      const docPath = `users/${authenticatedUid}/mcp_connectors/${connectorId}`;
      try {
        await deleteDoc(doc(db, 'users', authenticatedUid, 'mcp_connectors', connectorId));
        persistedConnectorIdsRef.current.delete(connectorId);
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, docPath);
      }
    }
  };

  // Close mode dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(e.target as Node)) {
        setIsModeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    scrollToBottom();
  }, [messages, isLoading]);

  // Handle file attachment selection — keep Agent Mode active if user is already in Agent Mode!
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.includes(',') ? result.split(',')[1] : result;
      setAttachment({
        name: file.name,
        mimeType: file.type || (file.name.endsWith('.csv') ? 'text/csv' : 'application/octet-stream'),
        data: base64Data,
        size: file.size,
      });

      // Only auto-switch to OCR when uploading an image/PDF outside Agent Mode;
      // if already in Agent Mode (or uploading CSV/JSON), keep Agent Mode so charts/CSV/PDF tools stay enabled.
      if (
        activeMode !== 'agent' &&
        (file.type.startsWith('image/') || file.type.includes('pdf'))
      ) {
        setActiveMode('ocr');
      }
    };

    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSendText = async (textToSend: string, forcedMode?: AgentMode) => {
    const modeToUse = forcedMode || activeMode;
    if (forcedMode && forcedMode !== activeMode) {
      setActiveMode(forcedMode);
    }

    const trimmed = textToSend.trim();
    if (!trimmed && !attachment) return;
    if (!trackEngagement('AI Assistant')) return;

    const currentAttachment = attachment;
    const userMsg: ChatMessageExtended = {
      id: Date.now().toString(),
      role: 'user',
      text: trimmed || (currentAttachment ? `[Uploaded Document: ${currentAttachment.name}]` : ''),
      timestamp: new Date(),
      attachmentName: currentAttachment?.name,
      attachmentType: currentAttachment?.mimeType,
      attachmentData: currentAttachment?.mimeType.startsWith('image/')
        ? currentAttachment.data
        : undefined,
    };

    const messagesWithUser = [...messages, userMsg];
    setMessages(messagesWithUser);
    setInput('');
    setAttachment(null);
    setIsLoading(true);

    try {
      const history = messages.slice(-6).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const enabledSkillsPayload = aiSkills
        .filter((s) => s.enabled)
        .map((s) => ({
          name: s.name,
          slug: s.slug,
          category: s.category,
          triggers: s.triggers,
          instructionsMarkdown: s.instructionsMarkdown,
        }));

      const enabledConnectorsPayload = mcpConnectors
        .filter((c) => c.enabled)
        .map((c) => ({
          name: c.name,
          slug: c.slug,
          category: c.category,
          transport: c.transport,
          endpointUrl: c.endpointUrl,
          toolsList: c.toolsList,
        }));

      const result = await queryFinanceAgent(
        trimmed,
        modeToUse,
        currentAttachment,
        history,
        {
          currencySymbol,
          transactions: transactions.slice(0, 180),
          invoices: invoices.slice(0, 60),
          watchlist: watchlist.slice(0, 30),
          stockPortfolio,
          goalsCount: goals.length,
        },
        enabledSkillsPayload,
        enabledConnectorsPayload
      );

      let appliedSummary: string | undefined;
      if (result.ledgerOperations) {
        const stats = applyAgentLedgerOperations(result.ledgerOperations);
        const parts: string[] = [];
        if (stats.added > 0) parts.push(`${stats.added} added`);
        if (stats.updated > 0) parts.push(`${stats.updated} updated`);
        if (stats.deleted > 0) parts.push(`${stats.deleted} removed`);
        if (stats.settledInvoices > 0) parts.push(`${stats.settledInvoices} invoice settled`);
        if (parts.length > 0) {
          appliedSummary = `Applied to workspace ledger: ${parts.join(' · ')}`;
        }
      }

      const modelMsg: ChatMessageExtended = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: result.text,
        timestamp: new Date(),
        groundingUrls: result.groundingUrls,
        activatedTools: result.activatedTools,
        appliedSummary,
        charts: result.charts,
        csvExport: result.csvExport || undefined,
        pdfReport: result.pdfReport || undefined,
      };

      const finalMessages = [...messagesWithUser, modelMsg];
      setMessages(finalMessages);
      void persistSession(activeSessionId, finalMessages, modeToUse);
    } catch (error: any) {
      console.warn('Finance agent communication notice:', error?.message || error);
      const errMsg: ChatMessageExtended = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text:
          error?.message ||
          "Sorry, I wasn't able to proceed with that request right now. Please try again in a moment.",
        timestamp: new Date(),
      };
      const finalMessages = [...messagesWithUser, errMsg];
      setMessages(finalMessages);
      void persistSession(activeSessionId, finalMessages, modeToUse);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAction = async (action: (typeof QUICK_AUTOMATIONS)[0]) => {
    handleSendText(action.prompt, action.mode);
  };

  const filteredSessions = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.preview || '').toLowerCase().includes(q)
    );
  }, [sessions, historySearch]);

  const activeModeObj = MODES.find((m) => m.id === activeMode) || MODES[0];

  const renderSidebarContent = () => {
    const connectedCount = mcpConnectors.filter((c) => c.enabled).length;
    const activeSkillCount = aiSkills.filter((s) => s.enabled).length;

    return (
      <div className="flex flex-col h-full bg-[#F9F9F8] dark:bg-[#111216] select-none">
        {/* Top New Chat + Search */}
        <div className="p-3 space-y-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setStudioDrawer('none');
              handleStartNewChat();
            }}
            className="w-full h-9 px-3 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200/90 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-900 dark:text-neutral-100 text-xs font-semibold flex items-center gap-2.5 transition-colors cursor-pointer shadow-2xs"
          >
            <svg className="w-4 h-4 text-neutral-600 dark:text-neutral-300 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
            </svg>
            <span className="truncate">New chat</span>
          </button>

          <div className="relative">
            <svg
              className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
            </svg>
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search chats..."
              className="w-full h-8 bg-neutral-100/80 dark:bg-neutral-900/90 border border-transparent focus:border-neutral-300 dark:focus:border-neutral-700 rounded-lg pl-8 pr-7 text-xs text-neutral-800 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none transition-colors"
            />
            {historySearch && (
              <button
                type="button"
                onClick={() => setHistorySearch('')}
                aria-label="Clear chat search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-neutral-400 hover:text-neutral-700 dark:hover:text-white cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Middle Chronological Recents */}
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          <div className="px-2.5 pt-1 pb-1.5 flex items-center justify-between text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
            <span>Recents</span>
            <span className="tabular-nums">{filteredSessions.length}</span>
          </div>

          {filteredSessions.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-neutral-400 dark:text-neutral-500 leading-relaxed">
              {sessions.length === 0
                ? 'Your recent finance chats and generated reports will appear here.'
                : 'No matching chats.'}
            </div>
          ) : (
            filteredSessions.map((session) => {
              const isActive = session.sessionId === activeSessionId;
              return (
                <div
                  key={session.sessionId}
                  onClick={() => handleSelectSession(session)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleSelectSession(session);
                  }}
                  title={session.title}
                  className={`group rounded-lg px-2.5 py-2 cursor-pointer transition-colors flex items-center justify-between gap-2 ${
                    isActive
                      ? 'bg-neutral-200/80 dark:bg-neutral-800 text-neutral-950 dark:text-white font-semibold'
                      : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60'
                  }`}
                >
                  <span className="text-[13px] leading-snug truncate flex-1">{session.title}</span>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteSession(e, session.sessionId)}
                    title="Delete chat"
                    aria-label="Delete chat"
                    className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-rose-500 p-0.5 rounded transition-opacity cursor-pointer shrink-0"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Pinned Bottom Connectors & Skills Dock */}
        <div className="p-2.5 border-t border-neutral-200/80 dark:border-neutral-800 space-y-1 shrink-0 bg-[#F4F4F2]/70 dark:bg-[#0D0E12]">
          <button
            type="button"
            onClick={() => {
              setStudioDrawer('connectors');
              setMobileSidebarOpen(false);
            }}
            className={`w-full h-9 px-2.5 rounded-lg text-[13px] font-medium flex items-center justify-between gap-2 transition-colors cursor-pointer ${
              studioDrawer === 'connectors'
                ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-950 dark:text-white font-semibold'
                : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60'
            }`}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <svg className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span className="truncate">Connectors</span>
            </span>
            <span className="text-[11px] font-mono tabular-nums text-neutral-400 dark:text-neutral-500 shrink-0">
              {connectedCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setStudioDrawer('skills');
              setMobileSidebarOpen(false);
            }}
            className={`w-full h-9 px-2.5 rounded-lg text-[13px] font-medium flex items-center justify-between gap-2 transition-colors cursor-pointer ${
              studioDrawer === 'skills'
                ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-950 dark:text-white font-semibold'
                : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60'
            }`}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <svg className="w-4 h-4 text-neutral-500 dark:text-neutral-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <span className="truncate">Skills</span>
            </span>
            <span className="text-[11px] font-mono tabular-nums text-neutral-400 dark:text-neutral-500 shrink-0">
              {activeSkillCount}
            </span>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full bg-white dark:bg-neutral-900 rounded-[32px] shadow-soft overflow-hidden border border-white/60 dark:border-neutral-800 relative">
      {/* Desktop Chat History Sidebar */}
      {sidebarOpen && (
        <aside className="hidden md:flex w-[260px] shrink-0 flex-col border-r border-neutral-100 dark:border-neutral-800 bg-[#FAFAFA]/70 dark:bg-neutral-950/60">
          {renderSidebarContent()}
        </aside>
      )}

      {/* Mobile Slide-Over History Drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] h-full bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 z-10 flex flex-col">
            <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-900 dark:text-white">
                Liddy AI History
              </span>
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="text-xs font-bold text-neutral-500 hover:text-neutral-900 dark:hover:text-white px-2 py-1 cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 min-h-0">{renderSidebarContent()}</div>
          </aside>
        </div>
      )}

      {/* Main Conversation Column */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-neutral-100 dark:border-neutral-800 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-md flex justify-between items-center z-10 sticky top-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => {
                if (window.innerWidth < 768) {
                  setMobileSidebarOpen((v) => !v);
                } else {
                  setSidebarOpen((v) => !v);
                }
              }}
              title="Toggle chat history sidebar"
              className="w-8 h-8 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h16" />
              </svg>
            </button>

            <Logo size="sm" showText={false} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-neutral-900 dark:text-white text-base truncate">
                  Liddy AI CFO
                </h2>
                <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200/50 dark:border-indigo-800/50 px-2 py-0.5 rounded-md font-semibold shrink-0">
                  {activeModeObj.badge}
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 hidden sm:block truncate">
                Personal Cashflow, Document Intelligence, Charts, CSV &amp; PDF Reports
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleStartNewChat}
              className="md:hidden px-2.5 py-1.5 rounded-xl text-xs font-bold bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 cursor-pointer"
            >
              + New
            </button>
            <button
              type="button"
              onClick={() => setIsVoiceMode(true)}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700"
            >
              <span className="flex items-center gap-0.5 h-3.5">
                <span className="w-0.5 h-2 rounded-full bg-cyan-400"></span>
                <span className="w-0.5 h-3.5 rounded-full bg-indigo-400"></span>
                <span className="w-0.5 h-2.5 rounded-full bg-fuchsia-400"></span>
              </span>
              <span>Voice Mode</span>
            </button>
          </div>
        </div>

        {isVoiceMode && (
          <LiveAdvisor autoConnect={true} onClose={() => setIsVoiceMode(false)} />
        )}

        {/* Quick GenAI Automation Chips Bar */}
        <div className="px-4 sm:px-6 py-2.5 bg-neutral-50/70 dark:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-800 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="text-[10px] uppercase font-bold tracking-wider text-neutral-400 font-mono shrink-0">
            Agent Skills:
          </span>
          {QUICK_AUTOMATIONS.map((qa) => (
            <button
              key={qa.id}
              onClick={() => handleQuickAction(qa)}
              disabled={isLoading}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:border-sky-400 dark:hover:border-sky-400 text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-white transition-all shrink-0 whitespace-nowrap shadow-xs disabled:opacity-50 cursor-pointer"
            >
              + {qa.label}
            </button>
          ))}
        </div>

        {/* Messages Feed */}
        <div
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-[#FAF9F6]/40 dark:bg-neutral-950/40"
        >
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[94%] sm:max-w-[88%] rounded-[24px] px-5 sm:px-6 py-4 shadow-xs relative ${
                  msg.role === 'user'
                    ? 'bg-neutral-900 dark:bg-indigo-600 text-white rounded-br-none'
                    : 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 border border-neutral-200/80 dark:border-neutral-800 rounded-bl-none'
                }`}
              >
                {/* User Attachment Display */}
                {msg.attachmentName && (
                  <div className="mb-2.5 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-xs">
                    {msg.attachmentData ? (
                      <img
                        src={`data:${msg.attachmentType || 'image/jpeg'};base64,${msg.attachmentData}`}
                        alt={msg.attachmentName}
                        className="w-8 h-8 rounded-lg object-cover"
                      />
                    ) : (
                      <span className="text-base">📄</span>
                    )}
                    <span className="truncate max-w-[220px] font-mono text-[11px]">
                      {msg.attachmentName}
                    </span>
                  </div>
                )}

                {/* Render Formatted Financial Markdown or Plain User Text */}
                {msg.role === 'model' ? (
                  <FormattedMessage text={msg.text} />
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed font-normal">
                    {msg.text}
                  </p>
                )}

                {/* Inline Agent Visual Charts */}
                {msg.charts && msg.charts.length > 0 && (
                  <div className="mt-4 space-y-3">
                    {msg.charts.map((chart, idx) => (
                      <AgentChartCard
                        key={chart.id || idx}
                        spec={chart}
                        fallbackCurrency={currencySymbol}
                      />
                    ))}
                  </div>
                )}

                {/* Downloadable CSV Dashboard Card */}
                {msg.csvExport && (
                  <div className="mt-4">
                    <AgentCsvCard spec={msg.csvExport} />
                  </div>
                )}

                {/* Downloadable Executive PDF Report Card */}
                {msg.pdfReport && (
                  <div className="mt-4">
                    <AgentPdfCard spec={msg.pdfReport} />
                  </div>
                )}

                {(msg.appliedSummary || (msg.activatedTools && msg.activatedTools.length > 0)) && (
                  <div className="mt-3 pt-2.5 border-t border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center gap-2 text-[11px]">
                    {msg.appliedSummary && (
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300 font-semibold">
                        {msg.appliedSummary}
                      </span>
                    )}
                    {msg.activatedTools &&
                      msg.activatedTools.map((tool, i) => (
                        <span
                          key={i}
                          className="px-2.5 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 font-mono"
                        >
                          ✓ {tool.replace(/_/g, ' ')}
                        </span>
                      ))}
                  </div>
                )}

                {msg.groundingUrls && msg.groundingUrls.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800 text-xs text-neutral-500 dark:text-neutral-400">
                    <p className="font-semibold text-neutral-700 dark:text-neutral-300 mb-1 flex items-center gap-1.5">
                      <span>🌐</span>
                      <span>Verified Live Market Grounding:</span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {msg.groundingUrls.map((url, i) => (
                        <a
                          key={i}
                          href={url.uri}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-mono text-[11px] bg-neutral-100 dark:bg-neutral-800/80 px-2 py-1 rounded-md"
                        >
                          <span>{url.title}</span>
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            />
                          </svg>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <span
                  className={`text-[10px] block mt-2 ${
                    msg.role === 'user' ? 'text-neutral-300' : 'text-neutral-400'
                  }`}
                >
                  {new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-neutral-900 rounded-[24px] rounded-bl-none px-6 py-4 border border-neutral-200/80 dark:border-neutral-800 shadow-xs flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce"></span>
                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.4s]"></span>
                <span className="text-xs text-neutral-600 dark:text-neutral-300 font-medium ml-2">
                  Liddy is executing {activeModeObj.label}...
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area with Attachment (+) and Mode Dropdown */}
        <div className="p-3 sm:p-4 bg-white dark:bg-neutral-900 border-t border-neutral-100 dark:border-neutral-800 space-y-2">
          {/* Active Attachment Preview Chip */}
          {attachment && (
            <div className="flex items-center justify-between p-2.5 px-3 bg-neutral-100 dark:bg-neutral-800/90 rounded-2xl border border-neutral-200 dark:border-neutral-700 animate-enter max-w-md">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0">
                  {attachment.mimeType.startsWith('image/') ? '🖼️' : '📄'}
                </div>
                <div className="truncate">
                  <p className="text-xs font-semibold text-neutral-900 dark:text-white truncate">
                    {attachment.name}
                  </p>
                  <p className="text-[10px] text-neutral-400 font-mono">
                    {attachment.size ? `${(attachment.size / 1024).toFixed(1)} KB` : 'Ready to analyze'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="w-6 h-6 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 hover:text-neutral-900 dark:hover:text-white flex items-center justify-center text-xs font-bold transition-colors cursor-pointer shrink-0 ml-2"
                title="Remove attachment"
              >
                ✕
              </button>
            </div>
          )}

          {/* Hidden Native File Input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.csv,.txt,.json,.docx"
            onChange={handleFileChange}
            className="hidden"
          />

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendText(input);
            }}
            className="flex items-center gap-1.5 sm:gap-2.5 bg-neutral-50 dark:bg-neutral-800/80 border border-neutral-200/80 dark:border-neutral-700/80 rounded-2xl p-1.5 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:bg-white dark:focus-within:bg-neutral-800 transition-all relative"
          >
            {/* + Icon for Uploading Files, Photos, Docs */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Attach bill PDF, CSV, receipt or financial document"
              aria-label="Upload document or photo"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-neutral-200/70 hover:bg-neutral-300 dark:bg-neutral-700/70 dark:hover:bg-neutral-600 text-neutral-700 dark:text-neutral-200 flex items-center justify-center transition-all shrink-0 cursor-pointer active:scale-95 group"
            >
              <svg
                className="w-5 h-5 text-neutral-600 dark:text-neutral-300 group-hover:text-indigo-500 transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 4v16m8-8H4" />
              </svg>
            </button>

            {/* Mode Selector Dropdown Button (Beside + Button) */}
            <div className="relative shrink-0" ref={modeDropdownRef}>
              <button
                type="button"
                onClick={() => setIsModeDropdownOpen(!isModeDropdownOpen)}
                title="Change AI Agent Mode"
                className="h-9 sm:h-10 px-2 sm:px-3 rounded-xl bg-neutral-200/70 hover:bg-neutral-300 dark:bg-neutral-700/70 dark:hover:bg-neutral-600 text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5 transition-all text-xs font-semibold cursor-pointer active:scale-95 border border-transparent hover:border-neutral-300 dark:hover:border-neutral-600"
              >
                <span className="text-sm">{activeModeObj.icon}</span>
                <span className="hidden md:inline whitespace-nowrap">{activeModeObj.label}</span>
                <svg
                  className={`w-3 h-3 text-neutral-400 transition-transform ${
                    isModeDropdownOpen ? 'rotate-180' : ''
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {/* Dropdown Menu Modal */}
              {isModeDropdownOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-72 sm:w-80 rounded-2xl bg-white dark:bg-[#141418] border border-neutral-200 dark:border-neutral-700 shadow-2xl p-2 z-50 animate-enter space-y-1">
                  <div className="px-2.5 py-1.5 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase font-bold tracking-wider text-neutral-400 dark:text-neutral-500">
                      Intelligence Mode
                    </span>
                  </div>

                  {MODES.map((mode) => {
                    const isSelected = activeMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => {
                          setActiveMode(mode.id);
                          setIsModeDropdownOpen(false);
                        }}
                        className={`w-full flex items-start gap-3 p-2.5 rounded-xl text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/80 text-indigo-950 dark:text-white'
                            : 'hover:bg-neutral-100 dark:hover:bg-neutral-800/70 text-neutral-700 dark:text-neutral-300'
                        }`}
                      >
                        <span className="text-lg shrink-0 mt-0.5">{mode.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold leading-tight">{mode.label}</span>
                            <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
                              {mode.badge}
                            </span>
                          </div>
                          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-2">
                            {mode.description}
                          </p>
                        </div>
                        {isSelected && (
                          <span className="text-indigo-600 dark:text-indigo-400 text-xs font-bold shrink-0">
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Chat Input Field */}
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                activeMode === 'web'
                  ? 'Search live market figures, economic news or stock symbols...'
                  : activeMode === 'ocr'
                  ? 'Attach document or ask to parse financial statements...'
                  : activeMode === 'agent'
                  ? 'Upload bill PDF or ask for charts, CSV dashboard & PDF report...'
                  : 'Ask Liddy to audit transactions, run ratio analysis or compute burn rate...'
              }
              className="flex-1 bg-transparent px-2 sm:px-3 py-2 text-xs sm:text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none min-w-0"
            />

            {/* Enter / Send Arrow Button */}
            <button
              type="submit"
              disabled={isLoading || (!input.trim() && !attachment)}
              title="Send instruction (Enter)"
              aria-label="Send message"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 flex items-center justify-center hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors disabled:opacity-30 shadow-xs shrink-0 cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.2}
                  d="M5 12h14M12 5l7 7-7 7"
                />
              </svg>
            </button>

            {/* Integrated Voice Mode Trigger */}
            <button
              type="button"
              onClick={() => setIsVoiceMode(true)}
              title="Switch to Voice Mode"
              aria-label="Switch to Voice Mode"
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-cyan-400 via-indigo-500 to-fuchsia-500 p-[1.5px] hover:scale-105 active:scale-95 transition-all shadow-md shrink-0 cursor-pointer group"
            >
              <div className="w-full h-full bg-neutral-900 dark:bg-neutral-950 rounded-[10px] flex items-center justify-center group-hover:bg-opacity-80 transition-all">
                <div className="flex items-center gap-0.5 h-4.5">
                  <span className="w-0.5 h-2 rounded-full bg-cyan-400"></span>
                  <span className="w-0.5 h-3.5 rounded-full bg-indigo-400"></span>
                  <span className="w-0.5 h-4.5 rounded-full bg-fuchsia-400"></span>
                  <span className="w-0.5 h-3 rounded-full bg-pink-400"></span>
                  <span className="w-0.5 h-1.5 rounded-full bg-cyan-300"></span>
                </div>
              </div>
            </button>
          </form>
        </div>

        {/* Studio Drawer Overlay for MCP Connectors & Skills (preserves active conversation behind) */}
        <AgentStudioDrawers
          mode={studioDrawer}
          onClose={() => setStudioDrawer('none')}
          skills={aiSkills}
          connectors={mcpConnectors}
          onToggleSkill={handleToggleSkill}
          onSaveCustomSkill={handleSaveCustomSkill}
          onInstallCatalogSkill={handleInstallCatalogSkill}
          onDeleteSkill={handleDeleteSkill}
          onToggleConnector={handleToggleConnector}
          onInspectConnector={handleInspectConnector}
          onAddCustomConnector={handleAddCustomConnector}
          onDeleteConnector={handleDeleteConnector}
        />
      </div>
    </div>
  );
};

export default ChatAssistant;