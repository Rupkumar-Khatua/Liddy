import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useFinMind, PLATFORM_OWNER_EMAIL } from '../context/FinMindContext';
import {
  OrganizationRecord,
  AnalyticsEventRecord,
  HyperswitchPaymentRecord,
  IdeationBoardRecord,
  UserAccessRecord,
} from '../types';
import { triggerFileDownload } from '../services/emailReceiptService';
import { Logo } from './Logo';
import { AdminAssetsShowcase } from './AdminAssetsShowcase';

interface AnalyticsSummaryResponse {
  totalEvents: number;
  uniqueUsers: number;
  organizationCount: number;
  orgMrrUsd: number;
  adImpressions: number;
  affiliateClicks: number;
  trackedAffiliateEstUsd: number;
  proUpgrades: number;
  voiceSessions: number;
  featureCounts: Record<string, number>;
  eventCounts: Record<string, number>;
  recentEvents: AnalyticsEventRecord[];
}

interface AdminUserRow {
  userId: string;
  displayName: string;
  email?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AdminAllowlistRow {
  userId: string;
  email: string;
  role: 'owner' | 'admin';
  createdAt?: string;
}

interface ApiEndpointMetricRow {
  routeKey: string;
  method: string;
  path: string;
  subsystem: string;
  totalCalls: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  lastLatencyMs: number;
  lastStatus: number | null;
  lastCalledAt: string | null;
  lastError: string | null;
}

interface ServiceControlsState {
  aiVision: boolean;
  aiAssistant: boolean;
  paymentsGateway: boolean;
  marketStream: boolean;
  collabRooms: boolean;
  liveVoice: boolean;
  maintenanceBanner: string;
  updatedAt: string;
}

interface CollabRoomRow {
  roomCode: string;
  participantCount: number;
  nodeCount: number;
  slideCount: number;
  noteCount: number;
  participants: Array<{
    clientId: string;
    name: string;
    role: string;
    micOn: boolean;
    camOn: boolean;
    screenOn: boolean;
    joinedAt: string;
  }>;
}

interface ServerIncidentRow {
  id: string;
  timestamp: string;
  severity: 'critical' | 'error' | 'warning';
  subsystem: string;
  source: string;
  statusCode: number;
  message: string;
  status: 'open' | 'acknowledged' | 'resolved';
  occurrences: number;
}

interface SystemStateResponse {
  server: {
    uptimeSec: number;
    nodeVersion: string;
    memoryRssMb: number;
    heapUsedMb: number;
    aiKeyConfigured: boolean;
    firebaseKeyConfigured: boolean;
    quotaCooldownRemainingSec: number;
    marketLastFetchAt: string | null;
    marketSourceStatus: string;
  };
  serviceControls: ServiceControlsState;
  apiMetrics: ApiEndpointMetricRow[];
  webSockets: {
    liveVoiceClients: number;
    marketStreamClients: number;
    collabTotalClients: number;
    activeCollabRooms: CollabRoomRow[];
  };
  runtimeStores: {
    paymentIntentsCount: number;
    paymentsLedgerCount: number;
    analyticsEventsCount: number;
    organizationsCount: number;
    marketCompaniesCached: number;
    marketNewsCached: number;
    payoutConfigured: boolean;
    payoutPayeeName: string | null;
    payoutUpiId: string | null;
  };
  incidents: ServerIncidentRow[];
}

type AdminTab = 'overview' | 'payments' | 'users' | 'apis' | 'sockets' | 'database' | 'assets';
type DbCollectionKey = 'users' | 'organizations' | 'payments' | 'ideation_boards' | 'admins' | 'platform_config';

interface AdminAnalyticsPortalProps {
  onExitAdmin: () => void;
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${rem}s`;
  return `${rem}s`;
}

export const AdminAnalyticsPortal: React.FC<AdminAnalyticsPortalProps> = ({
  onExitAdmin,
}) => {
  const {
    currentUser,
    isAdminUser,
    openAuthModal,
    logoutUser,
    organizations,
    createOrganization,
    updateOrganization,
    deleteOrganization,
    refreshOrganizations,
    fetchAdminUsers,
    fetchAdminPayments,
    getAdminAuthHeaders,
    fetchAdminIdeationBoards,
    deleteAdminIdeationBoard,
    fetchAdminAllowlist,
    addAdminAllowlistEntry,
    removeAdminAllowlistEntry,
    fetchAdminUserAccess,
    updateAdminUserAccess,
    payoutConfig,
    updatePayoutConfig,
    aiImageConfig,
    updateAiImageConfig,
    transactions,
    invoices,
  } = useFinMind();

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [summary, setSummary] = useState<AnalyticsSummaryResponse | null>(null);
  const [paymentsList, setPaymentsList] = useState<HyperswitchPaymentRecord[]>([]);
  const [usersList, setUsersList] = useState<AdminUserRow[]>([]);
  const [userAccessList, setUserAccessList] = useState<UserAccessRecord[]>([]);
  const [boardsList, setBoardsList] = useState<IdeationBoardRecord[]>([]);
  const [adminAllowlist, setAdminAllowlist] = useState<AdminAllowlistRow[]>([]);
  const [systemState, setSystemState] = useState<SystemStateResponse | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [accessTargetInput, setAccessTargetInput] = useState('');
  const [accessReasonInput, setAccessReasonInput] = useState('');
  const [accessUpdatingKey, setAccessUpdatingKey] = useState<string | null>(null);

  const [paymentRegionFilter, setPaymentRegionFilter] = useState<'ALL' | 'IN' | 'INTL'>('ALL');
  const [apiSearch, setApiSearch] = useState('');
  const [apiSubsystemFilter, setApiSubsystemFilter] = useState<string>('ALL');
  const [dbCollection, setDbCollection] = useState<DbCollectionKey>('organizations');
  const [incidentFilter, setIncidentFilter] = useState<'ALL' | 'open' | 'resolved'>('ALL');
  const [loading, setLoading] = useState(false);
  const [opsBanner, setOpsBanner] = useState<string | null>(null);

  // Receiving Payout, UPI & PayPal Configuration (Admin Only)
  const [payoutUpiId, setPayoutUpiId] = useState(payoutConfig.upiId || '');
  const [payoutPayeeName, setPayoutPayeeName] = useState(payoutConfig.payeeName || '');
  const [payoutBankName, setPayoutBankName] = useState(payoutConfig.bankName || '');
  const [payoutAccountHolder, setPayoutAccountHolder] = useState(payoutConfig.accountHolder || '');
  const [payoutAccountNumber, setPayoutAccountNumber] = useState(payoutConfig.accountNumber || '');
  const [payoutIfscCode, setPayoutIfscCode] = useState(payoutConfig.ifscCode || '');
  const [paypalEnabled, setPaypalEnabled] = useState(Boolean(payoutConfig.paypalEnabled));
  const [paypalEnvironment, setPaypalEnvironment] = useState<'sandbox' | 'live'>(
    payoutConfig.paypalEnvironment === 'live' ? 'live' : 'sandbox'
  );
  const [paypalClientId, setPaypalClientId] = useState(payoutConfig.paypalClientId || '');
  const [paypalClientSecret, setPaypalClientSecret] = useState(payoutConfig.paypalClientSecret || '');
  const [paypalMerchantEmail, setPaypalMerchantEmail] = useState(payoutConfig.paypalMerchantEmail || '');
  const [showPaypalSecret, setShowPaypalSecret] = useState(false);
  const [savingPayout, setSavingPayout] = useState(false);
  const [payoutFeedback, setPayoutFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setPayoutUpiId(payoutConfig.upiId || '');
    setPayoutPayeeName(payoutConfig.payeeName || '');
    setPayoutBankName(payoutConfig.bankName || '');
    setPayoutAccountHolder(payoutConfig.accountHolder || '');
    setPayoutAccountNumber(payoutConfig.accountNumber || '');
    setPayoutIfscCode(payoutConfig.ifscCode || '');
    setPaypalEnabled(Boolean(payoutConfig.paypalEnabled));
    setPaypalEnvironment(payoutConfig.paypalEnvironment === 'live' ? 'live' : 'sandbox');
    setPaypalClientId(payoutConfig.paypalClientId || '');
    setPaypalClientSecret(payoutConfig.paypalClientSecret || '');
    setPaypalMerchantEmail(payoutConfig.paypalMerchantEmail || '');
  }, [payoutConfig]);

  // Free AI Image Engines Configuration (Admin Only)
  const [aiHordeEnabled, setAiHordeEnabled] = useState(aiImageConfig.aiHordeEnabled !== false);
  const [aiHordeApiKey, setAiHordeApiKey] = useState(aiImageConfig.aiHordeApiKey || '');
  const [cfEnabled, setCfEnabled] = useState(Boolean(aiImageConfig.cloudflareEnabled));
  const [cfAccountId, setCfAccountId] = useState(aiImageConfig.cloudflareAccountId || '');
  const [cfApiToken, setCfApiToken] = useState(aiImageConfig.cloudflareApiToken || '');
  const [hfEnabled, setHfEnabled] = useState(Boolean(aiImageConfig.huggingfaceEnabled));
  const [hfToken, setHfToken] = useState(aiImageConfig.huggingfaceToken || '');
  const [queueTimeoutSec, setQueueTimeoutSec] = useState(aiImageConfig.queueTimeoutSec || 45);
  const [showImageSecrets, setShowImageSecrets] = useState(false);
  const [savingAiImage, setSavingAiImage] = useState(false);
  const [aiImageFeedback, setAiImageFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [probingAiImage, setProbingAiImage] = useState(false);
  const [aiProbeReport, setAiProbeReport] = useState<any | null>(null);

  useEffect(() => {
    setAiHordeEnabled(aiImageConfig.aiHordeEnabled !== false);
    setAiHordeApiKey(aiImageConfig.aiHordeApiKey || '');
    setCfEnabled(Boolean(aiImageConfig.cloudflareEnabled));
    setCfAccountId(aiImageConfig.cloudflareAccountId || '');
    setCfApiToken(aiImageConfig.cloudflareApiToken || '');
    setHfEnabled(Boolean(aiImageConfig.huggingfaceEnabled));
    setHfToken(aiImageConfig.huggingfaceToken || '');
    setQueueTimeoutSec(aiImageConfig.queueTimeoutSec || 45);
  }, [aiImageConfig]);

  // Add Organization Form
  const [isAddingOrg, setIsAddingOrg] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgIndustry, setOrgIndustry] = useState('Solo Design & Product Studio');
  const [orgPlan, setOrgPlan] = useState<'free' | 'pro' | 'team' | 'enterprise'>('pro');
  const [orgSeats, setOrgSeats] = useState(1);
  const [orgMrr, setOrgMrr] = useState(12);
  const [orgEmail, setOrgEmail] = useState('');
  const [orgNotes, setOrgNotes] = useState('');
  const [savingOrg, setSavingOrg] = useState(false);

  // Admin Allowlist Form
  const [newAdminUid, setNewAdminUid] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [addingAdmin, setAddingAdmin] = useState(false);

  // Broadcast & Maintenance inputs
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastRoomTarget, setBroadcastRoomTarget] = useState('ALL');
  const [maintenanceBannerInput, setMaintenanceBannerInput] = useState('');

  const showOpsToast = useCallback((msg: string) => {
    setOpsBanner(msg);
    window.setTimeout(() => setOpsBanner((prev) => (prev === msg ? null : prev)), 4000);
  }, []);

  const loadConsoleData = useCallback(async () => {
    setLoading(true);
    setSystemError(null);
    try {
      const headers = await getAdminAuthHeaders();
      const [, summaryResp, loadedPayments, loadedUsers, loadedBoards, loadedAdmins, loadedAccess, sysResp] = await Promise.all([
        refreshOrganizations(),
        fetch('/api/analytics/summary').catch(() => null),
        fetchAdminPayments().catch(() => [] as HyperswitchPaymentRecord[]),
        fetchAdminUsers().catch(() => [] as AdminUserRow[]),
        fetchAdminIdeationBoards().catch(() => [] as IdeationBoardRecord[]),
        fetchAdminAllowlist().catch(() => [] as AdminAllowlistRow[]),
        fetchAdminUserAccess().catch(() => [] as UserAccessRecord[]),
        fetch('/api/admin/system-state', { headers }).catch(() => null),
      ]);

      if (summaryResp && summaryResp.ok) {
        setSummary(await summaryResp.json());
      }
      setPaymentsList(loadedPayments);
      setUsersList(loadedUsers);
      setBoardsList(loadedBoards);
      setAdminAllowlist(loadedAdmins);
      setUserAccessList(loadedAccess);

      if (sysResp) {
        if (sysResp.ok) {
          const sysJson: SystemStateResponse = await sysResp.json();
          setSystemState(sysJson);
          setMaintenanceBannerInput(sysJson.serviceControls?.maintenanceBanner || '');
        } else {
          const errJson = await sysResp.json().catch(() => ({}));
          setSystemError(errJson.error || `System telemetry unavailable (${sysResp.status})`);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [
    getAdminAuthHeaders,
    refreshOrganizations,
    fetchAdminPayments,
    fetchAdminUsers,
    fetchAdminIdeationBoards,
    fetchAdminAllowlist,
    fetchAdminUserAccess,
  ]);

  useEffect(() => {
    if (isAdminUser) {
      loadConsoleData();
    }
  }, [isAdminUser, loadConsoleData]);

  const handleSavePayoutDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayoutFeedback(null);
    setSavingPayout(true);
    try {
      const res = await updatePayoutConfig({
        upiId: payoutUpiId,
        payeeName: payoutPayeeName,
        bankName: payoutBankName,
        accountHolder: payoutAccountHolder,
        accountNumber: payoutAccountNumber,
        ifscCode: payoutIfscCode,
        paypalEnabled,
        paypalEnvironment,
        paypalClientId,
        paypalClientSecret,
        paypalMerchantEmail,
      });
      if (!res.ok) {
        setPayoutFeedback({ type: 'err', text: res.error || 'Please check your payout details.' });
      } else {
        setPayoutFeedback({
          type: 'ok',
          text: res.error
            ? `Saved on server (${res.error})`
            : 'UPI and PayPal receiving credentials synced to Firestore and checkout gateway.',
        });
        await loadConsoleData();
      }
    } finally {
      setSavingPayout(false);
    }
  };

  const handleSaveAiImageConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setAiImageFeedback(null);
    setSavingAiImage(true);
    try {
      const res = await updateAiImageConfig({
        aiHordeEnabled,
        aiHordeApiKey,
        cloudflareEnabled: cfEnabled,
        cloudflareAccountId: cfAccountId,
        cloudflareApiToken: cfApiToken,
        huggingfaceEnabled: hfEnabled,
        huggingfaceToken: hfToken,
        queueTimeoutSec,
      });
      if (!res.ok) {
        setAiImageFeedback({ type: 'err', text: res.error || 'Could not update image engine settings.' });
      } else {
        setAiImageFeedback({
          type: 'ok',
          text: res.error
            ? `Saved on server (${res.error})`
            : 'Free AI image engine configuration synced to Firestore and server runtime.',
        });
        await loadConsoleData();
      }
    } finally {
      setSavingAiImage(false);
    }
  };

  const handleProbeAiImageEngines = async () => {
    setProbingAiImage(true);
    try {
      const headers = await getAdminAuthHeaders();
      const resp = await fetch('/api/admin/ai-image-probe', {
        method: 'POST',
        headers,
      });
      const json = await resp.json().catch(() => ({}));
      if (resp.ok) {
        setAiProbeReport(json);
        showOpsToast('Completed live AI image engine health probe.');
      } else {
        showOpsToast(json.error || 'Could not probe AI image engines.');
      }
    } finally {
      setProbingAiImage(false);
    }
  };

  const handleToggleService = async (
    key: keyof Omit<ServiceControlsState, 'maintenanceBanner' | 'updatedAt'>,
    nextValue: boolean
  ) => {
    const headers = await getAdminAuthHeaders();
    const resp = await fetch('/api/admin/service-controls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ [key]: nextValue }),
    });
    if (resp.ok) {
      const data = await resp.json();
      setSystemState((prev) => (prev ? { ...prev, serviceControls: data.serviceControls } : prev));
      showOpsToast(`${key} ${nextValue ? 'enabled' : 'paused'}.`);
    } else {
      const err = await resp.json().catch(() => ({}));
      showOpsToast(err.error || 'Could not update service control.');
    }
  };

  const handleSaveMaintenanceBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    const headers = await getAdminAuthHeaders();
    const resp = await fetch('/api/admin/service-controls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ maintenanceBanner: maintenanceBannerInput }),
    });
    if (resp.ok) {
      const data = await resp.json();
      setSystemState((prev) => (prev ? { ...prev, serviceControls: data.serviceControls } : prev));
      showOpsToast('Maintenance notice updated.');
    }
  };

  const runAdminAction = async (payload: Record<string, any>) => {
    const headers = await getAdminAuthHeaders();
    const resp = await fetch('/api/admin/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok) {
      if (data.message) showOpsToast(data.message);
      await loadConsoleData();
    } else {
      showOpsToast(data.error || 'Action failed.');
    }
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) return;
    setSavingOrg(true);
    try {
      await createOrganization({
        name: orgName.trim(),
        industry: orgIndustry.trim() || 'Independent Studio',
        planTier: orgPlan,
        seatCount: Math.max(1, Number(orgSeats) || 1),
        monthlyRevenueUsd: Math.max(0, Number(orgMrr) || 0),
        status: 'active',
        billingEmail: orgEmail.trim() || undefined,
        notes: orgNotes.trim() || undefined,
      });
      setOrgName('');
      setOrgEmail('');
      setOrgNotes('');
      setIsAddingOrg(false);
      await loadConsoleData();
    } finally {
      setSavingOrg(false);
    }
  };

  const handleAddAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminUid.trim() || !newAdminEmail.trim()) return;
    setAddingAdmin(true);
    try {
      await addAdminAllowlistEntry(newAdminUid.trim(), newAdminEmail.trim(), 'admin');
      setNewAdminUid('');
      setNewAdminEmail('');
      showOpsToast('Added administrator to Firestore /admins allowlist.');
      await loadConsoleData();
    } catch (err: any) {
      showOpsToast(err?.message || 'Could not add administrator.');
    } finally {
      setAddingAdmin(false);
    }
  };

  const handleUserAccessAction = async (
    action: 'block' | 'unblock' | 'revoke',
    target: { userId?: string; email?: string; displayName?: string; reason?: string }
  ) => {
    const busyKey = target.userId || target.email || 'manual';
    setAccessUpdatingKey(busyKey);
    try {
      const res = await updateAdminUserAccess({
        action,
        userId: target.userId,
        email: target.email,
        displayName: target.displayName,
        reason: target.reason,
      });
      if (res.ok) {
        showOpsToast(res.message || `Updated access (${action}).`);
        await loadConsoleData();
      } else {
        showOpsToast(res.error || 'Could not update user access.');
      }
    } finally {
      setAccessUpdatingKey(null);
    }
  };

  const userAccessMap = useMemo(() => {
    const byKey = new Map<string, UserAccessRecord>();
    userAccessList.forEach((rec) => {
      if (rec.userId) byKey.set(rec.userId, rec);
      if (rec.email) byKey.set(rec.email.toLowerCase(), rec);
    });
    return byKey;
  }, [userAccessList]);

  const handleExportSnapshot = () => {
    const snapshot = {
      exportedAt: new Date().toISOString(),
      systemState,
      analyticsSummary: summary,
      organizationsCount: organizations.length,
      usersCount: usersList.length,
      paymentsCount: paymentsList.length,
      boardsCount: boardsList.length,
    };
    triggerFileDownload(`liddy-ops-snapshot-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(snapshot, null, 2), 'application/json');
    showOpsToast('Exported operations snapshot JSON.');
  };

  const featureChartData = useMemo(
    () =>
      Object.entries(summary?.featureCounts || {}).map(([feature, count]) => ({
        name: feature,
        events: count,
      })),
    [summary?.featureCounts]
  );

  const orgActiveMrr = useMemo(
    () =>
      organizations
        .filter((o) => o.status === 'active')
        .reduce((sum, o) => sum + (Number(o.monthlyRevenueUsd) || 0), 0),
    [organizations]
  );

  const paymentStats = useMemo(() => {
    const succeeded = paymentsList.filter((p) => p.status === 'succeeded');
    const indiaPayments = succeeded.filter((p) => p.region === 'IN');
    const intlPayments = succeeded.filter((p) => p.region === 'INTL');
    const totalUsdEq = succeeded.reduce((sum, p) => sum + (Number(p.amountUsdEquivalent) || 0), 0);
    const indiaInr = indiaPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const intlUsd = intlPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    return {
      totalCount: paymentsList.length,
      succeededCount: succeeded.length,
      totalUsdEq,
      indiaCount: indiaPayments.length,
      indiaInr,
      intlCount: intlPayments.length,
      intlUsd,
    };
  }, [paymentsList]);

  const filteredPayments = useMemo(() => {
    if (paymentRegionFilter === 'ALL') return paymentsList;
    return paymentsList.filter((p) => p.region === paymentRegionFilter);
  }, [paymentsList, paymentRegionFilter]);

  const filteredApis = useMemo(() => {
    const rows = systemState?.apiMetrics || [];
    return rows.filter((r) => {
      if (apiSubsystemFilter !== 'ALL' && r.subsystem !== apiSubsystemFilter) return false;
      if (apiSearch.trim()) {
        const q = apiSearch.toLowerCase().trim();
        return r.path.toLowerCase().includes(q) || r.method.toLowerCase().includes(q) || r.subsystem.toLowerCase().includes(q);
      }
      return true;
    });
  }, [systemState?.apiMetrics, apiSubsystemFilter, apiSearch]);

  const openIncidentsCount = useMemo(
    () => (systemState?.incidents || []).filter((i) => i.status !== 'resolved').length,
    [systemState?.incidents]
  );

  const filteredIncidents = useMemo(() => {
    const list = systemState?.incidents || [];
    if (incidentFilter === 'open') return list.filter((i) => i.status !== 'resolved');
    if (incidentFilter === 'resolved') return list.filter((i) => i.status === 'resolved');
    return list;
  }, [systemState?.incidents, incidentFilter]);

  if (!isAdminUser) {
    return (
      <div className="min-h-screen w-full bg-[#05060B] text-white flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full rounded-3xl bg-neutral-900/95 border border-white/10 p-8 space-y-6 text-center shadow-2xl">
          <div className="flex justify-center">
            <Logo size="md" showText={true} />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-mono uppercase tracking-[0.18em] text-amber-400 font-semibold">
              Isolated Admin Portal
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight">
              Liddy Command Console
            </h1>
            <p className="text-sm text-neutral-400 leading-relaxed">
              {currentUser?.email
                ? `Signed in as ${currentUser.email}. Administrator authorization is required to access this console.`
                : 'Sign in with authorized administrator credentials to manage systems, payouts, databases and telemetry.'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={() => openAuthModal('Administrator Sign In')}
              className="flex-1 py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer transition-colors"
            >
              Sign In to Continue &rarr;
            </button>
            <button
              type="button"
              onClick={onExitAdmin}
              className="flex-1 py-3 px-4 rounded-2xl bg-white/10 hover:bg-white/15 text-neutral-200 text-xs font-bold cursor-pointer transition-colors"
            >
              &larr; Return Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#06070B] text-white">
      {/* Standalone Admin Command Bar */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#06070B]/95 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Logo size="sm" showText={true} />
            <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-white/10 text-xs">
              <span className="font-semibold text-emerald-400 whitespace-nowrap">
                Operations Console
              </span>
              <span className="text-neutral-500">&middot;</span>
              <span className="font-mono text-neutral-400 truncate max-w-[220px]">
                {currentUser?.email}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={loadConsoleData}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold cursor-pointer disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              {loading ? 'Syncing...' : 'Sync All'}
            </button>
            <button
              type="button"
              onClick={onExitAdmin}
              className="px-3.5 py-2 rounded-xl border border-white/15 hover:bg-white/10 text-xs font-semibold text-neutral-300 cursor-pointer transition-colors whitespace-nowrap shrink-0"
            >
              Exit Console
            </button>
            <button
              type="button"
              onClick={logoutUser}
              className="px-3.5 py-2 rounded-xl border border-white/15 hover:bg-white/10 text-xs font-semibold text-neutral-300 cursor-pointer transition-colors whitespace-nowrap shrink-0"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Sub-navigation tabs */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center gap-2 pb-3 overflow-x-auto no-scrollbar">
          {(
            [
              { id: 'overview', label: 'Business Analytics' },
              { id: 'payments', label: `Payments & Payouts (${paymentsList.length})` },
              { id: 'users', label: `Users & Orgs (${usersList.length} / ${organizations.length})` },
              { id: 'apis', label: `APIs & Controls (${systemState?.apiMetrics.length ?? 0})` },
              {
                id: 'sockets',
                label: `WebSockets (${
                  (systemState?.webSockets.liveVoiceClients ?? 0) +
                  (systemState?.webSockets.marketStreamClients ?? 0) +
                  (systemState?.webSockets.collabTotalClients ?? 0)
                })`,
              },
              {
                id: 'database',
                label: `Database & Failures${openIncidentsCount > 0 ? ` (${openIncidentsCount})` : ''}`,
              },
              {
                id: 'assets',
                label: 'Assets',
              },
            ] as Array<{ id: AdminTab; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white/[0.06] text-neutral-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {opsBanner && (
          <div className="px-4 py-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-between gap-3">
            <span>{opsBanner}</span>
            <button type="button" onClick={() => setOpsBanner(null)} className="text-xs font-bold cursor-pointer">
              Dismiss
            </button>
          </div>
        )}

        {systemError && (
          <div className="px-4 py-3 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-semibold flex items-center justify-between gap-3">
            <span>Telemetry notice: {systemError}</span>
            <button type="button" onClick={loadConsoleData} className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-xs font-bold cursor-pointer">
              Retry Sync
            </button>
          </div>
        )}

        {/* ================= 1. OVERVIEW & ANALYTICS TAB ================= */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <p className="text-xs font-mono text-sky-400 font-semibold">
                  Executive Operations &amp; Health
                </p>
                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mt-1">
                  Revenue, Engagement &amp; Infrastructure
                </h1>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('payments')}
                  className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  Configure Payouts
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('users');
                    setIsAddingOrg(true);
                  }}
                  className="px-5 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  + Register Organization
                </button>
              </div>
            </div>

            {/* KPI Row */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono text-neutral-400">Organizations</p>
                <p className="text-3xl font-extrabold font-mono tabular-nums mt-2">{organizations.length}</p>
                <p className="text-xs text-neutral-500 mt-1">Cloud accounts</p>
              </div>

              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono text-neutral-400">Org MRR</p>
                <p className="text-3xl font-extrabold font-mono tabular-nums text-emerald-400 mt-2">
                  ${orgActiveMrr.toLocaleString()}
                </p>
                <p className="text-xs text-neutral-500 mt-1">Active subscriptions</p>
              </div>

              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono text-neutral-400">Gateway Settled</p>
                <p className="text-3xl font-extrabold font-mono tabular-nums text-indigo-400 mt-2">
                  ${paymentStats.totalUsdEq.toLocaleString()}
                </p>
                <p className="text-xs text-neutral-500 mt-1">{paymentStats.succeededCount} confirmed orders</p>
              </div>

              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono text-neutral-400">Server Uptime</p>
                <p className="text-3xl font-extrabold font-mono tabular-nums mt-2">
                  {systemState ? formatDuration(systemState.server.uptimeSec) : '—'}
                </p>
                <p className="text-xs text-neutral-500 mt-1">
                  {systemState ? `${systemState.server.memoryRssMb} MB RSS` : 'Node process'}
                </p>
              </div>

              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono text-neutral-400">Open Incidents</p>
                <p className={`text-3xl font-extrabold font-mono tabular-nums mt-2 ${openIncidentsCount > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {openIncidentsCount}
                </p>
                <p className="text-xs text-neutral-500 mt-1">
                  <button type="button" onClick={() => setActiveTab('database')} className="hover:underline cursor-pointer">
                    Inspect failure log
                  </button>
                </p>
              </div>

              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono text-neutral-400">Owner Payout</p>
                <p className={`text-lg font-extrabold mt-2 truncate ${payoutConfig.upiId || payoutConfig.accountNumber ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {payoutConfig.upiId ? 'Configured' : payoutConfig.accountNumber ? 'Bank Set' : 'Pending'}
                </p>
                <p className="text-xs text-neutral-500 mt-1 truncate">
                  {payoutConfig.upiId || 'Set up in Payments tab'}
                </p>
              </div>
            </div>

            {/* Feature Usage Chart + Revenue & Runtime Pulse */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 rounded-3xl bg-neutral-900 border border-white/10 p-6">
                <h2 className="text-base font-bold">Workspace Feature Engagement</h2>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Real-time module usage across Dashboard, Invoices, Vision Studio, Markets &amp; AI Agent
                </p>
                <div className="h-64 mt-4">
                  {featureChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={featureChartData}>
                        <XAxis dataKey="name" stroke="#71717A" fontSize={11} />
                        <YAxis stroke="#71717A" fontSize={11} allowDecimals={false} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#18181B',
                            borderColor: 'rgba(255,255,255,0.1)',
                            borderRadius: '12px',
                            fontSize: '12px',
                          }}
                        />
                        <Bar dataKey="events" fill="#6366F1" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-neutral-500 font-mono">
                      Activity metrics appear automatically as users interact with workspace modules.
                    </div>
                  )}
                </div>
              </div>

              <div className="lg:col-span-5 rounded-3xl bg-neutral-900 border border-white/10 p-6 flex flex-col justify-between">
                <div className="space-y-4">
                  <h2 className="text-base font-bold">Regional Revenue &amp; Subsystem Status</h2>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between py-2 border-b border-white/10">
                      <span className="text-neutral-400">India UPI Settled</span>
                      <span className="font-mono font-bold tabular-nums text-emerald-400">
                        &#8377;{paymentStats.indiaInr.toLocaleString()} ({paymentStats.indiaCount})
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-white/10">
                      <span className="text-neutral-400">International PayPal</span>
                      <span className="font-mono font-bold tabular-nums text-sky-400">
                        ${paymentStats.intlUsd.toLocaleString()} ({paymentStats.intlCount})
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-white/10">
                      <span className="text-neutral-400">AI Service Key / Cooldown</span>
                      <span className={`font-mono font-bold ${systemState?.server.aiKeyConfigured ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {systemState?.server.aiKeyConfigured ? 'Key Loaded' : 'Key Missing'} &middot;{' '}
                        {systemState?.server.quotaCooldownRemainingSec ? `${systemState.server.quotaCooldownRemainingSec}s cooldown` : 'Ready'}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-white/10">
                      <span className="text-neutral-400">Active Collab Rooms / Sockets</span>
                      <span className="font-mono font-bold tabular-nums">
                        {systemState?.webSockets.activeCollabRooms.length ?? 0} rooms /{' '}
                        {(systemState?.webSockets.liveVoiceClients ?? 0) +
                          (systemState?.webSockets.marketStreamClients ?? 0) +
                          (systemState?.webSockets.collabTotalClients ?? 0)}{' '}
                        sockets
                      </span>
                    </div>
                    <div className="flex justify-between py-2">
                      <span className="text-neutral-400">Owner Ledger / Invoices</span>
                      <span className="font-mono font-bold tabular-nums">
                        {transactions.length} tx / {invoices.length} inv
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Live Platform Activity Feed */}
            <div className="rounded-3xl bg-neutral-900 border border-white/10 p-6">
              <h2 className="text-base font-bold mb-4">Recent Platform Activity</h2>
              {summary?.recentEvents && summary.recentEvents.length > 0 ? (
                <div className="divide-y divide-white/10 max-h-80 overflow-y-auto">
                  {summary.recentEvents.map((evt) => (
                    <div key={evt.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-sky-400">{evt.eventType}</span>
                        <span className="text-neutral-300">{evt.featureWindow}</span>
                        {evt.metadata && <span className="text-neutral-500">&middot; {evt.metadata}</span>}
                      </div>
                      <div className="flex items-center gap-4 font-mono tabular-nums text-neutral-400">
                        {evt.revenueImpactUsd ? (
                          <span className="text-emerald-400">+${evt.revenueImpactUsd}</span>
                        ) : null}
                        <span>{new Date(evt.createdAt).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-500 font-mono">
                  Live platform events stream here as users open workspace tools, settle invoices or complete checkouts.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ================= 2. PAYMENTS & OWNER PAYOUT CREDENTIALS TAB ================= */}
        {activeTab === 'payments' && (
          <div className="space-y-8">
            {/* Owner Receiving Bank & UPI Configuration (Admin Exclusive) */}
            <form onSubmit={handleSavePayoutDetails} className="rounded-3xl bg-neutral-900 border border-indigo-500/30 p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-mono text-indigo-400 font-semibold">
                    Platform Owner Settlement Account
                  </p>
                  <h2 className="text-xl font-extrabold tracking-tight mt-0.5">
                    Receiving Payout, UPI &amp; PayPal Credentials
                  </h2>
                  <p className="text-xs text-neutral-400 mt-1">
                    Configure where customer subscription payments arrive. India routes to your UPI details and International routes through PayPal Orders v2. Saved to Firestore (<span className="font-mono text-neutral-300">/platform_config/payout</span>) while keeping private secrets off public endpoints.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 self-start">
                  <span className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold ${
                    payoutConfig.upiId || payoutConfig.accountNumber
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-amber-500/15 text-amber-300'
                  }`}>
                    {payoutConfig.upiId || payoutConfig.accountNumber ? 'India UPI Active' : 'UPI Pending'}
                  </span>
                  <span className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold ${
                    payoutConfig.hasPaypalConfigured || (payoutConfig.paypalClientId && payoutConfig.paypalClientSecret)
                      ? 'bg-sky-500/15 text-sky-400'
                      : 'bg-amber-500/15 text-amber-300'
                  }`}>
                    {payoutConfig.hasPaypalConfigured || (payoutConfig.paypalClientId && payoutConfig.paypalClientSecret)
                      ? `PayPal ${payoutConfig.paypalEnvironment === 'live' ? 'Live' : 'Sandbox'}`
                      : 'PayPal Pending'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-mono text-neutral-400 mb-1.5">
                    Receiving UPI ID *
                  </label>
                  <input
                    type="text"
                    value={payoutUpiId}
                    onChange={(e) => setPayoutUpiId(e.target.value)}
                    placeholder="ownername@okicici"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-xs font-semibold text-white outline-none focus:border-indigo-400"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-neutral-400 mb-1.5">
                    Payee / Business Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={payoutPayeeName}
                    onChange={(e) => setPayoutPayeeName(e.target.value)}
                    placeholder="Liddy Financial Technologies"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-xs font-semibold text-white outline-none focus:border-indigo-400"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-neutral-400 mb-1.5">
                    Settlement Bank Name
                  </label>
                  <input
                    type="text"
                    value={payoutBankName}
                    onChange={(e) => setPayoutBankName(e.target.value)}
                    placeholder="HDFC Bank / ICICI / SBI"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-xs font-semibold text-white outline-none focus:border-indigo-400"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-neutral-400 mb-1.5">
                    Account Holder Name
                  </label>
                  <input
                    type="text"
                    value={payoutAccountHolder}
                    onChange={(e) => setPayoutAccountHolder(e.target.value)}
                    placeholder="Legal account holder name"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-xs font-semibold text-white outline-none focus:border-indigo-400"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-neutral-400 mb-1.5">
                    Bank Account Number
                  </label>
                  <input
                    type="text"
                    value={payoutAccountNumber}
                    onChange={(e) => setPayoutAccountNumber(e.target.value)}
                    placeholder="Private account number"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-xs font-mono font-semibold text-white outline-none focus:border-indigo-400"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-neutral-400 mb-1.5">
                    IFSC / Routing Code
                  </label>
                  <input
                    type="text"
                    value={payoutIfscCode}
                    onChange={(e) => setPayoutIfscCode(e.target.value.toUpperCase())}
                    placeholder="HDFC0001234"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-xs font-mono uppercase font-semibold text-white outline-none focus:border-indigo-400"
                  />
                </div>
              </div>

              {/* PayPal International Receiving Credentials */}
              <div className="pt-4 border-t border-white/10 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white">PayPal International Checkout Credentials</h3>
                    <p className="text-xs text-neutral-400">
                      Used on International USD checkouts via PayPal Smart Buttons and Orders v2 Capture. Client Secret stays server-side and admin-only.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={paypalEnabled}
                      onChange={(e) => setPaypalEnabled(e.target.checked)}
                      className="w-4 h-4 accent-indigo-500 cursor-pointer"
                    />
                    <span className="text-neutral-200">Enable PayPal Checkout</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-[11px] font-mono text-neutral-400 mb-1.5">
                      PayPal Environment
                    </label>
                    <select
                      value={paypalEnvironment}
                      onChange={(e) => setPaypalEnvironment(e.target.value === 'live' ? 'live' : 'sandbox')}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-xs font-mono font-semibold text-white outline-none focus:border-indigo-400"
                    >
                      <option value="sandbox">Sandbox (Testing)</option>
                      <option value="live">Live (Production)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-neutral-400 mb-1.5">
                      PayPal Business / Merchant Email
                    </label>
                    <input
                      type="email"
                      value={paypalMerchantEmail}
                      onChange={(e) => setPaypalMerchantEmail(e.target.value)}
                      placeholder="merchant@business.com"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-xs font-semibold text-white outline-none focus:border-indigo-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono text-neutral-400 mb-1.5">
                      PayPal Client ID
                    </label>
                    <input
                      type="text"
                      value={paypalClientId}
                      onChange={(e) => setPaypalClientId(e.target.value)}
                      placeholder="AeA1QIZXiflr..."
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-xs font-mono font-semibold text-white outline-none focus:border-indigo-400"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-[11px] font-mono text-neutral-400">
                        PayPal Client Secret
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowPaypalSecret((v) => !v)}
                        className="text-[10px] font-mono text-sky-400 hover:underline cursor-pointer"
                      >
                        {showPaypalSecret ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <input
                      type={showPaypalSecret ? 'text' : 'password'}
                      value={paypalClientSecret}
                      onChange={(e) => setPaypalClientSecret(e.target.value)}
                      placeholder="Private PayPal REST secret"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-xs font-mono font-semibold text-white outline-none focus:border-indigo-400"
                    />
                  </div>
                </div>
              </div>

              {payoutFeedback && (
                <div
                  className={`p-3 rounded-xl text-xs font-semibold border ${
                    payoutFeedback.type === 'ok'
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                  }`}
                >
                  {payoutFeedback.text}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <span className="text-xs font-mono text-neutral-400">
                  {payoutConfig.updatedAt
                    ? `Last synced: ${new Date(payoutConfig.updatedAt).toLocaleString()}`
                    : 'Not saved to cloud yet.'}
                </span>
                <button
                  type="submit"
                  disabled={savingPayout}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {savingPayout ? 'Saving & Syncing...' : 'Save Receiving Credentials'}
                </button>
              </div>
            </form>

            {/* Payments Ledger */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <p className="text-xs font-mono text-emerald-400 font-semibold">
                  Checkout Orchestration Ledger
                </p>
                <h2 className="text-2xl font-extrabold tracking-tight mt-1">
                  India &amp; Global Payments
                </h2>
              </div>

              <div className="inline-flex rounded-xl bg-neutral-900 border border-white/10 p-1">
                {(['ALL', 'IN', 'INTL'] as const).map((reg) => (
                  <button
                    key={reg}
                    type="button"
                    onClick={() => setPaymentRegionFilter(reg)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      paymentRegionFilter === reg
                        ? 'bg-indigo-600 text-white'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {reg === 'ALL' ? 'All Regions' : reg === 'IN' ? 'India (INR / UPI)' : 'International (USD)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono text-neutral-400">India UPI Volume</p>
                <p className="text-2xl font-extrabold font-mono tabular-nums text-emerald-400 mt-1">
                  &#8377;{paymentStats.indiaInr.toLocaleString()}
                </p>
                <p className="text-xs text-neutral-500 mt-1">{paymentStats.indiaCount} settled India checkouts</p>
              </div>
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono text-neutral-400">International PayPal</p>
                <p className="text-2xl font-extrabold font-mono tabular-nums text-sky-400 mt-1">
                  ${paymentStats.intlUsd.toLocaleString()}
                </p>
                <p className="text-xs text-neutral-500 mt-1">{paymentStats.intlCount} settled global checkouts</p>
              </div>
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono text-neutral-400">Consolidated USD Equivalent</p>
                <p className="text-2xl font-extrabold font-mono tabular-nums text-white mt-1">
                  ${paymentStats.totalUsdEq.toLocaleString()}
                </p>
                <p className="text-xs text-neutral-500 mt-1">Synced via Gateway + Firestore</p>
              </div>
            </div>

            <div className="rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] font-mono text-neutral-400">
                      <th className="py-3.5 px-6">Reference / ID</th>
                      <th className="py-3.5 px-4">Customer</th>
                      <th className="py-3.5 px-4">Plan &amp; Cycle</th>
                      <th className="py-3.5 px-4">Region</th>
                      <th className="py-3.5 px-4">Rail / Connector</th>
                      <th className="py-3.5 px-4 text-right">Amount</th>
                      <th className="py-3.5 px-6">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 text-sm">
                    {filteredPayments.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 px-6 text-center text-xs text-neutral-500 font-mono">
                          No gateway checkout records yet. Any customer upgrade completed appears here live.
                        </td>
                      </tr>
                    ) : (
                      filteredPayments.map((p) => (
                        <tr key={p.paymentId} className="hover:bg-white/[0.03]">
                          <td className="py-3.5 px-6 font-mono text-xs">
                            <div className="text-white font-semibold">{p.referenceCode}</div>
                            <div className="text-neutral-500 text-[11px]">{p.paymentId}</div>
                          </td>
                          <td className="py-3.5 px-4 text-xs">
                            <div className="font-semibold text-neutral-200">{p.userName || 'Member'}</div>
                            <div className="text-neutral-500 font-mono">{p.userEmail || p.userId}</div>
                          </td>
                          <td className="py-3.5 px-4 font-mono text-xs text-indigo-400">
                            {p.planTier} &middot; {p.billingCycle}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-xs">
                            {p.region === 'IN' ? 'India (INR)' : 'Global (USD)'}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-xs text-neutral-300">
                            {p.paymentRail} &middot; {p.connector}
                          </td>
                          <td className="py-3.5 px-4 font-mono font-bold tabular-nums text-right text-emerald-400">
                            {p.currency === 'INR' ? `₹${p.amount.toLocaleString()}` : `$${p.amount.toLocaleString()}`}
                          </td>
                          <td className="py-3.5 px-6">
                            <span
                              className={`inline-block px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold ${
                                p.status === 'succeeded'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : p.status === 'failed'
                                  ? 'bg-rose-500/15 text-rose-400'
                                  : 'bg-amber-500/15 text-amber-400'
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================= 3. USERS, ORGS & ADMINS TAB ================= */}
        {activeTab === 'users' && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <p className="text-xs font-mono text-sky-400 font-semibold">
                  Directory &amp; Account Provisioning
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-1">
                  Users, Organizations &amp; Admin Access
                </h1>
              </div>

              <button
                type="button"
                onClick={() => setIsAddingOrg((v) => !v)}
                className="px-5 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer self-start"
              >
                {isAddingOrg ? 'Cancel Form' : '+ Add Organization'}
              </button>
            </div>

            {isAddingOrg && (
              <form
                onSubmit={handleCreateOrg}
                className="rounded-3xl bg-neutral-900 border border-indigo-500/40 p-6 space-y-4 animate-enter"
              >
                <h2 className="text-lg font-bold">Register Organization Account</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-[11px] font-mono text-neutral-400 mb-1">Organization Name</label>
                    <input
                      type="text"
                      required
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      placeholder="e.g. Northstar Creative LLC"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-sm text-white outline-none focus:border-sky-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono text-neutral-400 mb-1">Industry</label>
                    <input
                      type="text"
                      value={orgIndustry}
                      onChange={(e) => setOrgIndustry(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-sm text-white outline-none focus:border-sky-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono text-neutral-400 mb-1">Plan Tier</label>
                    <select
                      value={orgPlan}
                      onChange={(e) => {
                        const next = e.target.value as 'free' | 'pro' | 'team' | 'enterprise';
                        setOrgPlan(next);
                        setOrgMrr(next === 'free' ? 0 : next === 'pro' ? 9 : next === 'team' ? 20 : 99);
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-sm text-white outline-none focus:border-sky-400"
                    >
                      <option value="free">Starter Free ($0)</option>
                      <option value="pro">Liddy Pro ($9/mo)</option>
                      <option value="team">Annual Pro ($20/yr)</option>
                      <option value="enterprise">Enterprise ($99+)</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-mono text-neutral-400 mb-1">Seats</label>
                      <input
                        type="number"
                        min={1}
                        value={orgSeats}
                        onChange={(e) => setOrgSeats(Number(e.target.value) || 1)}
                        className="w-full px-3 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-sm text-white outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono text-neutral-400 mb-1">MRR ($)</label>
                      <input
                        type="number"
                        min={0}
                        value={orgMrr}
                        onChange={(e) => setOrgMrr(Number(e.target.value) || 0)}
                        className="w-full px-3 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-sm text-white outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <input
                    type="email"
                    value={orgEmail}
                    onChange={(e) => setOrgEmail(e.target.value)}
                    placeholder="Billing email (optional)"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-sm text-white outline-none focus:border-sky-400"
                  />
                  <input
                    type="text"
                    value={orgNotes}
                    onChange={(e) => setOrgNotes(e.target.value)}
                    placeholder="Account notes or onboarding source"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-sm text-white outline-none focus:border-sky-400"
                  />
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsAddingOrg(false)}
                    className="px-4 py-2 rounded-xl border border-white/15 text-xs font-bold text-neutral-300 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingOrg}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    {savingOrg ? 'Saving...' : 'Save Organization'}
                  </button>
                </div>
              </form>
            )}

            {/* Organizations Registry */}
            <div className="rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden">
              <div className="p-6 border-b border-white/10">
                <h2 className="text-base font-bold">Organizations Registry</h2>
                <p className="text-xs text-neutral-400 mt-0.5">Synced across Firestore and admin billing telemetry</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] font-mono text-neutral-400">
                      <th className="py-3.5 px-6">Organization</th>
                      <th className="py-3.5 px-4">Industry</th>
                      <th className="py-3.5 px-4">Plan</th>
                      <th className="py-3.5 px-4 text-right">Seats</th>
                      <th className="py-3.5 px-4 text-right">MRR</th>
                      <th className="py-3.5 px-4">Status</th>
                      <th className="py-3.5 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 text-sm">
                    {organizations.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-10 px-6 text-center text-xs text-neutral-500 font-mono">
                          No organizations registered yet. Click "+ Add Organization" above to create one.
                        </td>
                      </tr>
                    ) : (
                      organizations.map((org: OrganizationRecord) => (
                        <tr key={org.orgId} className="hover:bg-white/[0.03]">
                          <td className="py-3.5 px-6 font-semibold">
                            <div>{org.name}</div>
                            {org.billingEmail && (
                              <div className="text-xs text-neutral-500 font-mono">{org.billingEmail}</div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-neutral-300 text-xs">{org.industry}</td>
                          <td className="py-3.5 px-4 font-mono text-xs text-sky-400">{org.planTier}</td>
                          <td className="py-3.5 px-4 font-mono tabular-nums text-right">{org.seatCount}</td>
                          <td className="py-3.5 px-4 font-mono tabular-nums text-right text-emerald-400">
                            ${org.monthlyRevenueUsd}
                          </td>
                          <td className="py-3.5 px-4">
                            <select
                              value={org.status}
                              onChange={(e) =>
                                updateOrganization(org.orgId, {
                                  status: e.target.value as OrganizationRecord['status'],
                                })
                              }
                              className="px-2.5 py-1 rounded-lg bg-neutral-950 border border-white/15 text-xs font-mono text-white"
                            >
                              <option value="active">active</option>
                              <option value="trial">trial</option>
                              <option value="paused">paused</option>
                              <option value="churned">churned</option>
                            </select>
                          </td>
                          <td className="py-3.5 px-6 text-right">
                            <button
                              type="button"
                              onClick={() => deleteOrganization(org.orgId)}
                              className="text-xs font-semibold text-rose-400 hover:text-rose-300 cursor-pointer"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Registered Users Directory & Access Controls */}
            <div className="rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden">
              <div className="p-6 border-b border-white/10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold">Registered Cloud Users &amp; Access Controls</h2>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Revoke active user sessions immediately or block accounts from accessing the application.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={accessTargetInput}
                    onChange={(e) => setAccessTargetInput(e.target.value)}
                    placeholder="User Email or UID"
                    className="px-3 py-2 rounded-xl bg-neutral-950 border border-white/15 text-xs text-white outline-none focus:border-indigo-400 w-48"
                  />
                  <input
                    type="text"
                    value={accessReasonInput}
                    onChange={(e) => setAccessReasonInput(e.target.value)}
                    placeholder="Optional reason"
                    className="px-3 py-2 rounded-xl bg-neutral-950 border border-white/15 text-xs text-white outline-none focus:border-indigo-400 w-44"
                  />
                  <button
                    type="button"
                    disabled={!accessTargetInput.trim() || accessUpdatingKey === 'manual'}
                    onClick={async () => {
                      const val = accessTargetInput.trim();
                      const isEmail = val.includes('@');
                      await handleUserAccessAction('revoke', {
                        userId: isEmail ? undefined : val,
                        email: isEmail ? val : undefined,
                        reason: accessReasonInput.trim() || undefined,
                      });
                      setAccessTargetInput('');
                      setAccessReasonInput('');
                    }}
                    className="px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/30 text-amber-300 text-xs font-bold cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    Revoke Session
                  </button>
                  <button
                    type="button"
                    disabled={!accessTargetInput.trim() || accessUpdatingKey === 'manual'}
                    onClick={async () => {
                      const val = accessTargetInput.trim();
                      const isEmail = val.includes('@');
                      await handleUserAccessAction('block', {
                        userId: isEmail ? undefined : val,
                        email: isEmail ? val : undefined,
                        reason: accessReasonInput.trim() || undefined,
                      });
                      setAccessTargetInput('');
                      setAccessReasonInput('');
                    }}
                    className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    Block User
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] font-mono text-neutral-400">
                      <th className="py-3.5 px-6">User Name</th>
                      <th className="py-3.5 px-4">Email</th>
                      <th className="py-3.5 px-4">UID</th>
                      <th className="py-3.5 px-4">Status</th>
                      <th className="py-3.5 px-4">Last Active</th>
                      <th className="py-3.5 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 text-sm">
                    {usersList.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-10 px-6 text-center text-xs text-neutral-500 font-mono">
                          No user profiles returned yet. Signed-in users sync automatically.
                        </td>
                      </tr>
                    ) : (
                      usersList.map((u) => {
                        const accessRec =
                          userAccessMap.get(u.userId) ||
                          (u.email ? userAccessMap.get(u.email.toLowerCase()) : undefined);
                        const status = accessRec?.status || 'active';
                        const isProtectedOwner =
                          u.email?.toLowerCase() === PLATFORM_OWNER_EMAIL || u.userId === currentUser?.uid;
                        const busy = accessUpdatingKey === u.userId;

                        return (
                          <tr key={u.userId} className="hover:bg-white/[0.03]">
                            <td className="py-3.5 px-6 font-semibold">{u.displayName}</td>
                            <td className="py-3.5 px-4 font-mono text-xs text-sky-400">{u.email || '—'}</td>
                            <td className="py-3.5 px-4 font-mono text-xs text-neutral-400">{u.userId}</td>
                            <td className="py-3.5 px-4 font-mono text-xs">
                              {status === 'blocked' ? (
                                <span className="text-rose-400 font-bold">Blocked</span>
                              ) : status === 'revoked' ? (
                                <span className="text-amber-400 font-bold">Revoked</span>
                              ) : (
                                <span className="text-emerald-400 font-semibold">Active</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 font-mono text-xs text-neutral-400 tabular-nums">
                              {u.updatedAt ? new Date(u.updatedAt).toLocaleString() : 'Active'}
                            </td>
                            <td className="py-3.5 px-6 text-right">
                              {isProtectedOwner ? (
                                <span className="text-[11px] font-mono text-neutral-500">Protected Owner</span>
                              ) : (
                                <div className="inline-flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      handleUserAccessAction('revoke', {
                                        userId: u.userId,
                                        email: u.email,
                                        displayName: u.displayName,
                                      })
                                    }
                                    className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-300 text-xs font-semibold cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                                  >
                                    Revoke
                                  </button>
                                  {status === 'blocked' ? (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        handleUserAccessAction('unblock', {
                                          userId: u.userId,
                                          email: u.email,
                                          displayName: u.displayName,
                                        })
                                      }
                                      className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-400/30 text-emerald-300 text-xs font-semibold cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                                    >
                                      Unblock
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        handleUserAccessAction('block', {
                                          userId: u.userId,
                                          email: u.email,
                                          displayName: u.displayName,
                                        })
                                      }
                                      className="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/35 border border-rose-500/30 text-rose-300 text-xs font-semibold cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                                    >
                                      Block
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {userAccessList.filter((r) => r.status !== 'active').length > 0 && (
                <div className="p-5 border-t border-white/10 bg-neutral-950/60 space-y-2">
                  <p className="text-xs font-mono text-neutral-400">
                    Active Restrictions ({userAccessList.filter((r) => r.status !== 'active').length})
                  </p>
                  <div className="divide-y divide-white/10 text-xs">
                    {userAccessList
                      .filter((r) => r.status !== 'active')
                      .map((r) => (
                        <div key={r.userId} className="py-2 flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <span className={r.status === 'blocked' ? 'text-rose-400 font-bold mr-2' : 'text-amber-400 font-bold mr-2'}>
                              {r.status.toUpperCase()}
                            </span>
                            <span className="font-mono text-white">{r.email || r.userId}</span>
                            {r.reason && <span className="text-neutral-400 ml-2">&middot; {r.reason}</span>}
                          </div>
                          <button
                            type="button"
                            disabled={accessUpdatingKey === r.userId}
                            onClick={() =>
                              handleUserAccessAction('unblock', {
                                userId: r.userId,
                                email: r.email,
                                displayName: r.displayName,
                              })
                            }
                            className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white font-semibold cursor-pointer whitespace-nowrap shrink-0"
                          >
                            Restore Access
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>

            {/* Admin Allowlist Provisioning */}
            <div className="rounded-3xl bg-neutral-900 border border-white/10 p-6 space-y-4">
              <div>
                <h2 className="text-base font-bold">Admin Allowlist (/admins)</h2>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Owner ({PLATFORM_OWNER_EMAIL}) always retains root access. Grant or revoke secondary admin UIDs here.
                </p>
              </div>
              <form onSubmit={handleAddAdmin} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  required
                  value={newAdminUid}
                  onChange={(e) => setNewAdminUid(e.target.value)}
                  placeholder="Firebase User UID"
                  className="px-3.5 py-2 rounded-xl bg-neutral-950 border border-white/15 text-xs font-mono text-white outline-none focus:border-indigo-400"
                />
                <input
                  type="email"
                  required
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  placeholder="Admin Email Address"
                  className="px-3.5 py-2 rounded-xl bg-neutral-950 border border-white/15 text-xs text-white outline-none focus:border-indigo-400"
                />
                <button
                  type="submit"
                  disabled={addingAdmin}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {addingAdmin ? 'Adding...' : 'Grant Admin Access'}
                </button>
              </form>

              {adminAllowlist.length > 0 && (
                <div className="divide-y divide-white/10 text-xs pt-2">
                  {adminAllowlist.map((a) => (
                    <div key={a.userId} className="py-2.5 flex items-center justify-between gap-4">
                      <div className="font-mono">
                        <span className="text-white font-semibold">{a.email}</span>{' '}
                        <span className="text-neutral-500">({a.userId}) &middot; {a.role}</span>
                      </div>
                      {a.userId !== currentUser?.uid && (
                        <button
                          type="button"
                          onClick={async () => {
                            await removeAdminAllowlistEntry(a.userId);
                            await loadConsoleData();
                          }}
                          className="text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= 4. APIS & SERVICE CONTROLS TAB ================= */}
        {activeTab === 'apis' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <p className="text-xs font-mono text-sky-400 font-semibold">
                  Runtime Service Controls &amp; API Surface
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-1">
                  APIs, Rate Guards &amp; Circuit Breakers
                </h1>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => runAdminAction({ action: 'reset_ai_cooldown' })}
                  className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold cursor-pointer"
                >
                  Reset AI Cooldown
                </button>
                <button
                  type="button"
                  onClick={() => runAdminAction({ action: 'flush_market_cache' })}
                  className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold cursor-pointer"
                >
                  Refresh Market Cache
                </button>
                <button
                  type="button"
                  onClick={() => runAdminAction({ action: 'clear_expired_intents' })}
                  className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold cursor-pointer"
                >
                  Prune Old Payment Intents
                </button>
              </div>
            </div>

            {/* Live Service Switches */}
            <div className="rounded-3xl bg-neutral-900 border border-white/10 p-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {(
                  [
                    { key: 'aiVision', label: 'Vision Studio AI (Images, Maps, Slides)' },
                    { key: 'aiAssistant', label: 'AI Agent, OCR, Voice & Invoices' },
                    { key: 'paymentsGateway', label: 'Hyperswitch Customer Checkout' },
                    { key: 'marketStream', label: 'Live Stock & News Feeds' },
                    { key: 'collabRooms', label: 'Vision Video Room WebSocket' },
                    { key: 'liveVoice', label: 'Live Audio WebSocket Stream' },
                  ] as const
                ).map((item) => {
                  const enabled = systemState ? systemState.serviceControls[item.key] : true;
                  return (
                    <div
                      key={item.key}
                      className="flex items-center justify-between gap-3 p-4 rounded-2xl bg-neutral-950 border border-white/10"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">{item.label}</p>
                        <p className={`text-[11px] font-mono mt-0.5 ${enabled ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {enabled ? 'Active' : 'Paused (503)'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleToggleService(item.key, !enabled)}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer shrink-0 transition-colors ${
                          enabled
                            ? 'bg-emerald-600/20 text-emerald-300 hover:bg-rose-600/20 hover:text-rose-300'
                            : 'bg-rose-600/25 text-rose-300 hover:bg-emerald-600/25 hover:text-emerald-300'
                        }`}
                      >
                        {enabled ? 'Pause' : 'Resume'}
                      </button>
                    </div>
                  );
                })}
              </div>

              <form onSubmit={handleSaveMaintenanceBanner} className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-white/10">
                <input
                  type="text"
                  value={maintenanceBannerInput}
                  onChange={(e) => setMaintenanceBannerInput(e.target.value)}
                  placeholder="Optional custom maintenance error message returned when a service is paused..."
                  className="flex-1 px-4 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-xs text-white outline-none focus:border-indigo-400"
                />
                <button
                  type="submit"
                  className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer shrink-0"
                >
                  Save Notice
                </button>
              </form>
            </div>

            {/* Free AI Image Engines & Speed Keys */}
            <form onSubmit={handleSaveAiImageConfig} className="rounded-3xl bg-neutral-900 border border-indigo-500/30 p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-mono text-indigo-400 font-semibold">
                    Vision Studio Image Cascade
                  </p>
                  <h2 className="text-xl font-extrabold tracking-tight mt-0.5">
                    Free AI Image Engines &amp; Optional FLUX Speed Keys
                  </h2>
                  <p className="text-xs text-neutral-400 mt-1">
                    AI Horde works at zero cost out of the box. Add optional free Cloudflare Workers AI or Hugging Face tokens below for 2-second FLUX.1-schnell generation. Keys stay server-side in <span className="font-mono text-neutral-300">/platform_config/ai_image</span>.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 self-start">
                  <span className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold ${
                    aiHordeEnabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-neutral-800 text-neutral-400'
                  }`}>
                    {aiHordeEnabled ? 'AI Horde Active' : 'AI Horde Off'}
                  </span>
                  <span className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold ${
                    (cfEnabled && cfAccountId && cfApiToken) || (hfEnabled && hfToken)
                      ? 'bg-sky-500/15 text-sky-400'
                      : 'bg-white/[0.06] text-neutral-400'
                  }`}>
                    {(cfEnabled && cfAccountId && cfApiToken) || (hfEnabled && hfToken) ? 'FLUX Turbo Ready' : 'FLUX Optional'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* AI Horde Card */}
                <div className="p-4 rounded-2xl bg-neutral-950 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-white">1. AI Horde Crowd GPUs</p>
                    <label className="inline-flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={aiHordeEnabled}
                        onChange={(e) => setAiHordeEnabled(e.target.checked)}
                        className="w-4 h-4 accent-indigo-500 cursor-pointer"
                      />
                      <span className="text-neutral-300">Enabled</span>
                    </label>
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono text-neutral-400 mb-1">
                      Optional AI Horde Key (Free)
                    </label>
                    <input
                      type={showImageSecrets ? 'text' : 'password'}
                      value={aiHordeApiKey}
                      onChange={(e) => setAiHordeApiKey(e.target.value)}
                      placeholder="Leave blank for anonymous free tier"
                      className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-white/15 text-xs font-mono text-white outline-none focus:border-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono text-neutral-400 mb-1">
                      Queue Timeout Before Fast Match (sec)
                    </label>
                    <input
                      type="number"
                      min={15}
                      max={90}
                      value={queueTimeoutSec}
                      onChange={(e) => setQueueTimeoutSec(Number(e.target.value) || 45)}
                      className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-white/15 text-xs font-mono tabular-nums text-white outline-none focus:border-indigo-400"
                    />
                  </div>
                </div>

                {/* Cloudflare Workers AI Card */}
                <div className="p-4 rounded-2xl bg-neutral-950 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-white">2. Cloudflare FLUX.1-schnell</p>
                    <label className="inline-flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={cfEnabled}
                        onChange={(e) => setCfEnabled(e.target.checked)}
                        className="w-4 h-4 accent-indigo-500 cursor-pointer"
                      />
                      <span className="text-neutral-300">Enabled</span>
                    </label>
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono text-neutral-400 mb-1">
                      Cloudflare Account ID
                    </label>
                    <input
                      type="text"
                      value={cfAccountId}
                      onChange={(e) => setCfAccountId(e.target.value)}
                      placeholder="32-char Cloudflare Account ID"
                      className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-white/15 text-xs font-mono text-white outline-none focus:border-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono text-neutral-400 mb-1">
                      Workers AI API Token
                    </label>
                    <input
                      type={showImageSecrets ? 'text' : 'password'}
                      value={cfApiToken}
                      onChange={(e) => setCfApiToken(e.target.value)}
                      placeholder="Optional free Workers AI token"
                      className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-white/15 text-xs font-mono text-white outline-none focus:border-indigo-400"
                    />
                  </div>
                </div>

                {/* Hugging Face Inference Card */}
                <div className="p-4 rounded-2xl bg-neutral-950 border border-white/10 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-white">3. Hugging Face FLUX.1</p>
                    <label className="inline-flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hfEnabled}
                        onChange={(e) => setHfEnabled(e.target.checked)}
                        className="w-4 h-4 accent-indigo-500 cursor-pointer"
                      />
                      <span className="text-neutral-300">Enabled</span>
                    </label>
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono text-neutral-400 mb-1">
                      Hugging Face Access Token
                    </label>
                    <input
                      type={showImageSecrets ? 'text' : 'password'}
                      value={hfToken}
                      onChange={(e) => setHfToken(e.target.value)}
                      placeholder="hf_..."
                      className="w-full px-3 py-2 rounded-xl bg-neutral-900 border border-white/15 text-xs font-mono text-white outline-none focus:border-indigo-400"
                    />
                  </div>
                  <div className="pt-1 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setShowImageSecrets((v) => !v)}
                      className="text-[11px] font-mono text-sky-400 hover:underline cursor-pointer"
                    >
                      {showImageSecrets ? 'Hide Keys' : 'Show Keys'}
                    </button>
                    <span className="text-[11px] font-mono text-neutral-500">Free tier supported</span>
                  </div>
                </div>
              </div>

              {aiProbeReport && (
                <div className="p-4 rounded-2xl bg-neutral-950 border border-white/10 text-xs font-mono space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-emerald-400 font-bold">
                      AI Horde Live Workers: {aiProbeReport.aiHorde?.ok ? `${aiProbeReport.aiHorde.totalWorkerSlots} online (${aiProbeReport.aiHorde.activeModelsCount} models)` : 'Offline'}
                    </span>
                    <span className="text-neutral-400 tabular-nums">
                      Checked {new Date(aiProbeReport.checkedAt).toLocaleTimeString()}
                    </span>
                  </div>
                  {Array.isArray(aiProbeReport.aiHorde?.topModels) && aiProbeReport.aiHorde.topModels.length > 0 && (
                    <p className="text-neutral-300">
                      Top workers: {aiProbeReport.aiHorde.topModels.join(' | ')}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-4 text-neutral-400">
                    <span>
                      Cloudflare Probe: {aiProbeReport.cloudflare?.configured === false ? 'Not Configured' : aiProbeReport.cloudflare?.ok ? 'Verified OK' : `Failed (${aiProbeReport.cloudflare?.status || 'err'})`}
                    </span>
                    <span>
                      Hugging Face Probe: {aiProbeReport.huggingface?.configured === false ? 'Not Configured' : aiProbeReport.huggingface?.ok ? `Verified (${aiProbeReport.huggingface.account || 'OK'})` : `Failed (${aiProbeReport.huggingface?.status || 'err'})`}
                    </span>
                  </div>
                </div>
              )}

              {aiImageFeedback && (
                <div
                  className={`p-3 rounded-xl text-xs font-semibold border ${
                    aiImageFeedback.type === 'ok'
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                  }`}
                >
                  {aiImageFeedback.text}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleProbeAiImageEngines}
                  disabled={probingAiImage}
                  className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {probingAiImage ? 'Probing Workers...' : 'Test Image Engines'}
                </button>
                <button
                  type="submit"
                  disabled={savingAiImage}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {savingAiImage ? 'Saving & Syncing...' : 'Save Image Engine Settings'}
                </button>
              </div>
            </form>

            {/* API Endpoint Telemetry Table */}
            <div className="rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden">
              <div className="p-5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {['ALL', 'AI', 'Payments', 'Markets', 'Analytics', 'Admin'].map((sub) => (
                    <button
                      key={sub}
                      type="button"
                      onClick={() => setApiSubsystemFilter(sub)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                        apiSubsystemFilter === sub ? 'bg-indigo-600 text-white' : 'bg-white/[0.06] text-neutral-400 hover:text-white'
                      }`}
                    >
                      {sub}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={apiSearch}
                  onChange={(e) => setApiSearch(e.target.value)}
                  placeholder="Filter endpoint path..."
                  className="px-3.5 py-2 rounded-xl bg-neutral-950 border border-white/15 text-xs text-white outline-none w-full sm:w-64"
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] font-mono text-neutral-400">
                      <th className="py-3 px-5">Endpoint</th>
                      <th className="py-3 px-4">Subsystem</th>
                      <th className="py-3 px-4 text-right">Calls</th>
                      <th className="py-3 px-4 text-right">Errors</th>
                      <th className="py-3 px-4 text-right">Avg Latency</th>
                      <th className="py-3 px-4">Last Status</th>
                      <th className="py-3 px-5">Last Called</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 text-xs">
                    {filteredApis.map((api) => (
                      <tr key={api.routeKey} className="hover:bg-white/[0.03]">
                        <td className="py-3 px-5 font-mono">
                          <span className="font-bold text-sky-400 mr-2">{api.method}</span>
                          <span className="text-neutral-200">{api.path}</span>
                        </td>
                        <td className="py-3 px-4 text-neutral-400">{api.subsystem}</td>
                        <td className="py-3 px-4 font-mono tabular-nums text-right">{api.totalCalls}</td>
                        <td className={`py-3 px-4 font-mono tabular-nums text-right ${api.errorCount > 0 ? 'text-rose-400 font-bold' : 'text-neutral-400'}`}>
                          {api.errorCount}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-right text-neutral-300">
                          {api.avgLatencyMs} ms
                        </td>
                        <td className="py-3 px-4 font-mono">
                          {api.lastStatus ? (
                            <span className={api.lastStatus >= 400 ? 'text-rose-400 font-bold' : 'text-emerald-400'}>
                              HTTP {api.lastStatus}
                            </span>
                          ) : (
                            <span className="text-neutral-500">Idle</span>
                          )}
                        </td>
                        <td className="py-3 px-5 font-mono text-neutral-400">
                          {api.lastCalledAt ? new Date(api.lastCalledAt).toLocaleTimeString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================= 5. WEBSOCKETS & LIVE ROOMS TAB ================= */}
        {activeTab === 'sockets' && (
          <div className="space-y-6">
            <div>
              <p className="text-xs font-mono text-sky-400 font-semibold">
                Real-Time Channels &amp; WebRTC Signaling
              </p>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-1">
                WebSockets &amp; Active Vision Rooms
              </h1>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5 space-y-2">
                <p className="text-xs font-mono text-neutral-400">/api/live (Voice Studio)</p>
                <p className="text-3xl font-extrabold font-mono tabular-nums text-emerald-400">
                  {systemState?.webSockets.liveVoiceClients ?? 0}
                </p>
                <p className="text-xs text-neutral-500">
                  Connected audio sessions &middot; {systemState?.serviceControls.liveVoice ? 'Accepting' : 'Paused'}
                </p>
              </div>
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5 space-y-2">
                <p className="text-xs font-mono text-neutral-400">/api/market-stream (Ticker Feed)</p>
                <p className="text-3xl font-extrabold font-mono tabular-nums text-sky-400">
                  {systemState?.webSockets.marketStreamClients ?? 0}
                </p>
                <p className="text-xs text-neutral-500">
                  Live market subscribers &middot; {systemState?.serviceControls.marketStream ? 'Accepting' : 'Paused'}
                </p>
              </div>
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5 space-y-2">
                <p className="text-xs font-mono text-neutral-400">/api/collab-room (Vision Rooms)</p>
                <p className="text-3xl font-extrabold font-mono tabular-nums text-indigo-400">
                  {systemState?.webSockets.collabTotalClients ?? 0}
                </p>
                <p className="text-xs text-neutral-500">
                  Across {systemState?.webSockets.activeCollabRooms.length ?? 0} active room(s)
                </p>
              </div>
            </div>

            {/* Room Broadcast Bar */}
            <div className="rounded-3xl bg-neutral-900 border border-white/10 p-6 space-y-3">
              <h2 className="text-base font-bold">Broadcast Notice to Live Rooms</h2>
              <div className="flex flex-col sm:flex-row gap-3">
                <select
                  value={broadcastRoomTarget}
                  onChange={(e) => setBroadcastRoomTarget(e.target.value)}
                  className="px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-xs font-mono text-white outline-none"
                >
                  <option value="ALL">All Active Rooms</option>
                  {(systemState?.webSockets.activeCollabRooms || []).map((r) => (
                    <option key={r.roomCode} value={r.roomCode}>
                      Room {r.roomCode} ({r.participantCount})
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={broadcastText}
                  onChange={(e) => setBroadcastText(e.target.value)}
                  placeholder="Type announcement delivered instantly to connected Vision rooms..."
                  className="flex-1 px-4 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-xs text-white outline-none focus:border-indigo-400"
                />
                <button
                  type="button"
                  disabled={!broadcastText.trim()}
                  onClick={async () => {
                    await runAdminAction({
                      action: 'broadcast_room_message',
                      roomCode: broadcastRoomTarget,
                      message: broadcastText.trim(),
                    });
                    setBroadcastText('');
                  }}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer disabled:opacity-40 shrink-0"
                >
                  Send Notice
                </button>
              </div>
            </div>

            {/* Active Rooms List */}
            <div className="rounded-3xl bg-neutral-900 border border-white/10 p-6 space-y-4">
              <h2 className="text-base font-bold">Active Vision Collaboration Rooms</h2>
              {!systemState || systemState.webSockets.activeCollabRooms.length === 0 ? (
                <p className="text-xs text-neutral-500 font-mono py-6 text-center">
                  No active collaborative meeting rooms are connected right now.
                </p>
              ) : (
                <div className="space-y-4">
                  {systemState.webSockets.activeCollabRooms.map((room) => (
                    <div key={room.roomCode} className="rounded-2xl bg-neutral-950 border border-white/10 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="font-mono text-xs">
                          <span className="text-white font-bold text-sm">{room.roomCode}</span>
                          <span className="text-neutral-400 ml-3">
                            {room.participantCount} online &middot; {room.nodeCount} nodes &middot; {room.slideCount} slides &middot; {room.noteCount} notes
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => runAdminAction({ action: 'close_collab_room', roomCode: room.roomCode })}
                          className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/35 text-rose-300 text-xs font-bold cursor-pointer"
                        >
                          Force Close Room
                        </button>
                      </div>

                      <div className="divide-y divide-white/10 text-xs">
                        {room.participants.map((p) => (
                          <div key={p.clientId} className="py-2 flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <span className="font-semibold text-white">{p.name}</span>
                              <span className="text-neutral-500 font-mono ml-2">
                                {p.role} &middot; {p.micOn ? 'Mic On' : 'Muted'} &middot; {p.camOn ? 'Cam On' : 'Cam Off'}
                                {p.screenOn ? ' · Screen Sharing' : ''}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                runAdminAction({
                                  action: 'kick_room_participant',
                                  roomCode: room.roomCode,
                                  clientId: p.clientId,
                                })
                              }
                              className="text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= 6. DATABASES & FAILURE MONITOR TAB ================= */}
        {activeTab === 'database' && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <p className="text-xs font-mono text-amber-400 font-semibold">
                  Cloud Firestore, Runtime Stores &amp; Incident Triage
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-1">
                  Database Explorer &amp; Failure Monitor
                </h1>
              </div>

              <button
                type="button"
                onClick={handleExportSnapshot}
                className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/15 text-xs font-bold cursor-pointer self-start"
              >
                Export Ops Snapshot JSON
              </button>
            </div>

            {/* Server Runtime Memory Stores */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-4">
                <p className="text-[11px] font-mono text-neutral-400">Payment Intents</p>
                <p className="text-2xl font-extrabold font-mono tabular-nums mt-1">
                  {systemState?.runtimeStores.paymentIntentsCount ?? 0}
                </p>
              </div>
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-4">
                <p className="text-[11px] font-mono text-neutral-400">Ledger Records</p>
                <p className="text-2xl font-extrabold font-mono tabular-nums mt-1">
                  {systemState?.runtimeStores.paymentsLedgerCount ?? 0}
                </p>
              </div>
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-4">
                <p className="text-[11px] font-mono text-neutral-400">Cached Equities</p>
                <p className="text-2xl font-extrabold font-mono tabular-nums mt-1">
                  {systemState?.runtimeStores.marketCompaniesCached ?? 0}
                </p>
              </div>
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-4">
                <p className="text-[11px] font-mono text-neutral-400">Cached News</p>
                <p className="text-2xl font-extrabold font-mono tabular-nums mt-1">
                  {systemState?.runtimeStores.marketNewsCached ?? 0}
                </p>
              </div>
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-4">
                <p className="text-[11px] font-mono text-neutral-400">Vision Boards (DB)</p>
                <p className="text-2xl font-extrabold font-mono tabular-nums mt-1">{boardsList.length}</p>
              </div>
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-4">
                <p className="text-[11px] font-mono text-neutral-400">Analytics Buffer</p>
                <p className="text-2xl font-extrabold font-mono tabular-nums mt-1">
                  {systemState?.runtimeStores.analyticsEventsCount ?? 0}
                </p>
              </div>
            </div>

            {/* Firestore Collections Explorer */}
            <div className="rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden">
              <div className="p-5 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold">Cloud Firestore Browser</h2>
                  <p className="text-xs text-neutral-400">Inspect live synced documents across collections and remove stale items.</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: 'organizations', label: `organizations (${organizations.length})` },
                      { id: 'users', label: `users (${usersList.length})` },
                      { id: 'payments', label: `payments (${paymentsList.length})` },
                      { id: 'ideation_boards', label: `ideation_boards (${boardsList.length})` },
                      { id: 'admins', label: `admins (${adminAllowlist.length})` },
                      { id: 'platform_config', label: 'platform_config' },
                    ] as Array<{ id: DbCollectionKey; label: string }>
                  ).map((col) => (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => setDbCollection(col.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold cursor-pointer ${
                        dbCollection === col.id ? 'bg-indigo-600 text-white' : 'bg-white/[0.06] text-neutral-400 hover:text-white'
                      }`}
                    >
                      {col.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-5 overflow-x-auto text-xs font-mono">
                {dbCollection === 'ideation_boards' && (
                  <div className="divide-y divide-white/10">
                    {boardsList.length === 0 ? (
                      <p className="text-neutral-500 py-6 text-center">No Vision ideation boards found in Firestore.</p>
                    ) : (
                      boardsList.map((b) => (
                        <div key={b.boardId} className="py-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <span className="text-white font-bold">{b.title}</span>
                            <span className="text-neutral-400 ml-3">
                              id: {b.boardId} &middot; room: {b.roomCode} &middot; {b.nodes.length} nodes &middot; {b.slides.length} slides
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              await deleteAdminIdeationBoard(b.boardId);
                              showOpsToast(`Deleted board ${b.boardId}.`);
                              await loadConsoleData();
                            }}
                            className="text-rose-400 hover:text-rose-300 font-bold cursor-pointer"
                          >
                            Delete Board
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {dbCollection === 'platform_config' && (
                  <pre className="p-4 rounded-2xl bg-neutral-950 border border-white/10 text-neutral-200 overflow-x-auto">
                    {JSON.stringify(
                      {
                        payout: {
                          ...payoutConfig,
                          accountNumber: payoutConfig.accountNumber ? `••••${payoutConfig.accountNumber.slice(-4)}` : '',
                          paypalClientSecret: payoutConfig.paypalClientSecret ? '•••••••• (saved)' : '',
                        },
                        publicRoutingPreview: {
                          upiId: payoutConfig.upiId || null,
                          payeeName: payoutConfig.payeeName || null,
                          bankName: payoutConfig.bankName || null,
                          accountNumberLast4: payoutConfig.accountNumber ? payoutConfig.accountNumber.slice(-4) : null,
                          paypalEnabled: Boolean(payoutConfig.paypalEnabled),
                          paypalEnvironment: payoutConfig.paypalEnvironment || 'sandbox',
                          paypalClientId: payoutConfig.paypalClientId || null,
                          paypalMerchantEmail: payoutConfig.paypalMerchantEmail || null,
                        },
                        ai_image: {
                          aiHordeEnabled: aiImageConfig.aiHordeEnabled,
                          aiHordeApiKey: aiImageConfig.aiHordeApiKey ? '•••••••• (saved)' : '',
                          cloudflareEnabled: aiImageConfig.cloudflareEnabled,
                          cloudflareAccountId: aiImageConfig.cloudflareAccountId || '',
                          cloudflareApiToken: aiImageConfig.cloudflareApiToken ? '•••••••• (saved)' : '',
                          huggingfaceEnabled: aiImageConfig.huggingfaceEnabled,
                          huggingfaceToken: aiImageConfig.huggingfaceToken ? '•••••••• (saved)' : '',
                          queueTimeoutSec: aiImageConfig.queueTimeoutSec,
                        },
                      },
                      null,
                      2
                    )}
                  </pre>
                )}

                {dbCollection === 'organizations' && (
                  <pre className="p-4 rounded-2xl bg-neutral-950 border border-white/10 text-neutral-200 max-h-72 overflow-auto">
                    {JSON.stringify(organizations, null, 2)}
                  </pre>
                )}

                {dbCollection === 'users' && (
                  <pre className="p-4 rounded-2xl bg-neutral-950 border border-white/10 text-neutral-200 max-h-72 overflow-auto">
                    {JSON.stringify(usersList, null, 2)}
                  </pre>
                )}

                {dbCollection === 'payments' && (
                  <pre className="p-4 rounded-2xl bg-neutral-950 border border-white/10 text-neutral-200 max-h-72 overflow-auto">
                    {JSON.stringify(paymentsList.slice(0, 25), null, 2)}
                  </pre>
                )}

                {dbCollection === 'admins' && (
                  <pre className="p-4 rounded-2xl bg-neutral-950 border border-white/10 text-neutral-200 max-h-72 overflow-auto">
                    {JSON.stringify(adminAllowlist, null, 2)}
                  </pre>
                )}
              </div>
            </div>

            {/* Incident & Failure Monitor */}
            <div className="rounded-3xl bg-neutral-900 border border-white/10 p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold">Live Incident &amp; Failure Monitor</h2>
                  <p className="text-xs text-neutral-400">
                    Captures HTTP 5xx, AI quota/key errors, payment validation drops and socket errors in real time.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(['ALL', 'open', 'resolved'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setIncidentFilter(f)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                        incidentFilter === f ? 'bg-indigo-600 text-white' : 'bg-white/[0.06] text-neutral-400'
                      }`}
                    >
                      {f === 'ALL' ? 'All' : f === 'open' ? 'Open / Active' : 'Resolved'}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => runAdminAction({ action: 'clear_resolved_incidents' })}
                    className="px-3 py-1.5 rounded-lg border border-white/15 text-xs font-semibold text-neutral-300 hover:text-white cursor-pointer"
                  >
                    Clear Resolved
                  </button>
                </div>
              </div>

              {filteredIncidents.length === 0 ? (
                <p className="text-xs text-neutral-500 font-mono py-8 text-center">
                  No failure incidents recorded in this filter. All subsystems operating nominally.
                </p>
              ) : (
                <div className="divide-y divide-white/10 max-h-96 overflow-y-auto">
                  {filteredIncidents.map((inc) => (
                    <div key={inc.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 font-mono">
                          <span
                            className={`font-bold ${
                              inc.severity === 'critical' || inc.severity === 'error'
                                ? 'text-rose-400'
                                : 'text-amber-400'
                            }`}
                          >
                            [{inc.severity.toUpperCase()}] {inc.subsystem}
                          </span>
                          <span className="text-neutral-300">{inc.source}</span>
                          {inc.statusCode > 0 && <span className="text-neutral-500">HTTP {inc.statusCode}</span>}
                          {inc.occurrences > 1 && <span className="text-amber-300">&times;{inc.occurrences}</span>}
                          <span className="text-neutral-500">{new Date(inc.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-neutral-200 break-words">{inc.message}</p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-[11px] text-neutral-400 mr-1">{inc.status}</span>
                        {inc.status === 'open' && (
                          <button
                            type="button"
                            onClick={() => runAdminAction({ action: 'ack_incident', incidentId: inc.id })}
                            className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-bold cursor-pointer"
                          >
                            Ack
                          </button>
                        )}
                        {inc.status !== 'resolved' && (
                          <button
                            type="button"
                            onClick={() => runAdminAction({ action: 'resolve_incident', incidentId: inc.id })}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 font-bold cursor-pointer"
                          >
                            Resolve
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'assets' && <AdminAssetsShowcase />}
      </main>
    </div>
  );
};

export default AdminAnalyticsPortal;
