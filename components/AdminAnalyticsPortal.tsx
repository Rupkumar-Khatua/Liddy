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
} from '../types';
import { Logo } from './Logo';

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

type AdminTab = 'overview' | 'payments' | 'users' | 'security';

interface AdminAnalyticsPortalProps {
  onExitAdmin: () => void;
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
    transactions,
    invoices,
  } = useFinMind();

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [summary, setSummary] = useState<AnalyticsSummaryResponse | null>(null);
  const [paymentsList, setPaymentsList] = useState<HyperswitchPaymentRecord[]>([]);
  const [usersList, setUsersList] = useState<AdminUserRow[]>([]);
  const [paymentRegionFilter, setPaymentRegionFilter] = useState<'ALL' | 'IN' | 'INTL'>('ALL');
  const [loading, setLoading] = useState(false);

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

  const loadConsoleData = useCallback(async () => {
    setLoading(true);
    try {
      const [, summaryResp, loadedPayments, loadedUsers] = await Promise.all([
        refreshOrganizations(),
        fetch('/api/analytics/summary').catch(() => null),
        fetchAdminPayments().catch(() => [] as HyperswitchPaymentRecord[]),
        fetchAdminUsers().catch(() => [] as AdminUserRow[]),
      ]);

      if (summaryResp && summaryResp.ok) {
        const json = await summaryResp.json();
        setSummary(json);
      }
      setPaymentsList(loadedPayments);
      setUsersList(loadedUsers);
    } finally {
      setLoading(false);
    }
  }, [refreshOrganizations, fetchAdminPayments, fetchAdminUsers]);

  useEffect(() => {
    if (isAdminUser) {
      loadConsoleData();
    }
  }, [isAdminUser, loadConsoleData]);

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

  // Strict Access Gate outside the consumer app
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
              Restricted to verified platform owner ({PLATFORM_OWNER_EMAIL}) and Firebase{' '}
              <span className="font-mono text-neutral-300">/admins</span> allowlist.
              {currentUser?.email ? ` Signed in as ${currentUser.email}.` : ' Sign in to unlock business metrics, payments, users, and security controls.'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={() => openAuthModal('Sign In for Admin Console')}
              className="flex-1 py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer transition-colors"
            >
              Sign In as Owner &rarr;
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

  const securityEvents = useMemo(() => {
    const events = summary?.recentEvents || [];
    return events.filter(
      (e) =>
        e.eventType === 'org_created' ||
        e.eventType === 'pro_upgrade' ||
        e.featureWindow === 'admin' ||
        e.featureWindow === 'pricing'
    );
  }, [summary?.recentEvents]);

  return (
    <div className="min-h-screen w-full bg-[#06070B] text-white">
      {/* Standalone Admin Command Bar — Completely Isolated from Consumer Navigation */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#06070B]/95 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Logo size="sm" showText={true} />
            <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-white/10">
              <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-emerald-400 font-bold">
                Admin Command Console
              </span>
              <span className="text-xs font-mono text-neutral-400 truncate max-w-[200px]">
                · {currentUser?.email}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={loadConsoleData}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold cursor-pointer disabled:opacity-50 transition-colors"
            >
              {loading ? 'Syncing...' : 'Sync Metrics'}
            </button>
            <button
              type="button"
              onClick={logoutUser}
              className="px-3.5 py-2 rounded-xl border border-white/15 hover:bg-white/10 text-xs font-semibold text-neutral-300 cursor-pointer transition-colors"
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
              { id: 'payments', label: `Payments & Gateway (${paymentsList.length})` },
              { id: 'users', label: `Users & Orgs (${usersList.length} / ${organizations.length})` },
              { id: 'security', label: 'Security & Audit' },
            ] as Array<{ id: AdminTab; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* ================= OVERVIEW & ANALYTICS TAB ================= */}
        {activeTab === 'overview' && (
          <>
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <p className="text-xs font-mono uppercase tracking-[0.18em] text-sky-400 font-semibold">
                  Executive Operations Telemetry
                </p>
                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mt-1">
                  Revenue, Engagement &amp; Monetization
                </h1>
              </div>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('users');
                  setIsAddingOrg(true);
                }}
                className="px-5 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer self-start"
              >
                + Register Organization
              </button>
            </div>

            {/* KPI Row */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">Organizations</p>
                <p className="text-3xl font-extrabold font-mono tabular-nums mt-2">{organizations.length}</p>
                <p className="text-xs text-neutral-500 mt-1">Cloud accounts</p>
              </div>

              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">Org MRR</p>
                <p className="text-3xl font-extrabold font-mono tabular-nums text-emerald-400 mt-2">
                  ${orgActiveMrr.toLocaleString()}
                </p>
                <p className="text-xs text-neutral-500 mt-1">Active subscriptions</p>
              </div>

              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">Gateway Settled</p>
                <p className="text-3xl font-extrabold font-mono tabular-nums text-indigo-400 mt-2">
                  ${paymentStats.totalUsdEq.toLocaleString()}
                </p>
                <p className="text-xs text-neutral-500 mt-1">{paymentStats.succeededCount} confirmed orders</p>
              </div>

              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">Events Logged</p>
                <p className="text-3xl font-extrabold font-mono tabular-nums mt-2">
                  {summary?.totalEvents ?? 0}
                </p>
                <p className="text-xs text-neutral-500 mt-1">{summary?.uniqueUsers ?? 0} unique sessions</p>
              </div>

              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">AdSense Views</p>
                <p className="text-3xl font-extrabold font-mono tabular-nums text-sky-400 mt-2">
                  {summary?.adImpressions ?? 0}
                </p>
                <p className="text-xs text-neutral-500 mt-1">Starter Free tier</p>
              </div>

              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-400">Partner Clicks</p>
                <p className="text-3xl font-extrabold font-mono tabular-nums text-amber-400 mt-2">
                  {summary?.affiliateClicks ?? 0}
                </p>
                <p className="text-xs text-neutral-500 mt-1">Est. ${summary?.trackedAffiliateEstUsd ?? 0}</p>
              </div>
            </div>

            {/* Feature Usage Chart + Revenue Split */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 rounded-3xl bg-neutral-900 border border-white/10 p-6">
                <h2 className="text-base font-bold">Workspace Feature Engagement</h2>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Real-time module usage across Cashflow, Invoices, Vision Studio, Markets &amp; AI Agent
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
                  <h2 className="text-base font-bold">Regional Revenue &amp; System Pulse</h2>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between py-2 border-b border-white/10">
                      <span className="text-neutral-400">India UPI / RuPay Settled</span>
                      <span className="font-mono font-bold tabular-nums text-emerald-400">
                        &#8377;{paymentStats.indiaInr.toLocaleString()} ({paymentStats.indiaCount})
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-white/10">
                      <span className="text-neutral-400">International Cards / Wallets</span>
                      <span className="font-mono font-bold tabular-nums text-sky-400">
                        ${paymentStats.intlUsd.toLocaleString()} ({paymentStats.intlCount})
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-white/10">
                      <span className="text-neutral-400">Pro / Team Plan Conversions</span>
                      <span className="font-mono font-bold tabular-nums">{summary?.proUpgrades ?? 0}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-white/10">
                      <span className="text-neutral-400">Tracked Cloud Users</span>
                      <span className="font-mono font-bold tabular-nums">{usersList.length}</span>
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
                        {evt.metadata && <span className="text-neutral-500">· {evt.metadata}</span>}
                      </div>
                      <div className="flex items-center gap-4 font-mono text-neutral-400">
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
                  Live platform events stream here as users open workspace tools, settle invoices, or complete checkouts.
                </p>
              )}
            </div>
          </>
        )}

        {/* ================= PAYMENTS & HYPERSWITCH LEDGER TAB ================= */}
        {activeTab === 'payments' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <p className="text-xs font-mono uppercase tracking-[0.18em] text-emerald-400 font-semibold">
                  Juspay Hyperswitch Open-Source Router
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-1">
                  India &amp; Global Payments Ledger
                </h1>
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
                <p className="text-[11px] font-mono uppercase text-neutral-400">India UPI / Cards Volume</p>
                <p className="text-2xl font-extrabold font-mono text-emerald-400 mt-1">
                  &#8377;{paymentStats.indiaInr.toLocaleString()}
                </p>
                <p className="text-xs text-neutral-500 mt-1">{paymentStats.indiaCount} settled India checkouts</p>
              </div>
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono uppercase text-neutral-400">International Cards / Wallets</p>
                <p className="text-2xl font-extrabold font-mono text-sky-400 mt-1">
                  ${paymentStats.intlUsd.toLocaleString()}
                </p>
                <p className="text-xs text-neutral-500 mt-1">{paymentStats.intlCount} settled global checkouts</p>
              </div>
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5">
                <p className="text-[11px] font-mono uppercase text-neutral-400">Consolidated USD Equivalent</p>
                <p className="text-2xl font-extrabold font-mono text-white mt-1">
                  ${paymentStats.totalUsdEq.toLocaleString()}
                </p>
                <p className="text-xs text-neutral-500 mt-1">Synced via Hyperswitch + Firestore</p>
              </div>
            </div>

            <div className="rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] font-mono uppercase text-neutral-400">
                      <th className="py-3.5 px-6">Reference / ID</th>
                      <th className="py-3.5 px-4">Customer</th>
                      <th className="py-3.5 px-4">Plan &amp; Cycle</th>
                      <th className="py-3.5 px-4">Region</th>
                      <th className="py-3.5 px-4">Rail / Connector</th>
                      <th className="py-3.5 px-4">Amount</th>
                      <th className="py-3.5 px-6">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 text-sm">
                    {filteredPayments.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 px-6 text-center text-xs text-neutral-500 font-mono">
                          No gateway checkout records yet. Any plan upgrade completed via Hyperswitch appears here live.
                        </td>
                      </tr>
                    ) : (
                      filteredPayments.map((p) => (
                        <tr key={p.paymentId} className="hover:bg-white/[0.03]">
                          <td className="py-4 px-6 font-mono text-xs">
                            <div className="text-white font-semibold">{p.referenceCode}</div>
                            <div className="text-neutral-500 text-[11px]">{p.paymentId}</div>
                          </td>
                          <td className="py-4 px-4 text-xs">
                            <div className="font-semibold text-neutral-200">{p.userName || 'Member'}</div>
                            <div className="text-neutral-500 font-mono">{p.userEmail || p.userId}</div>
                          </td>
                          <td className="py-4 px-4 font-mono text-xs uppercase text-indigo-400">
                            {p.planTier} · {p.billingCycle}
                          </td>
                          <td className="py-4 px-4 font-mono text-xs">
                            {p.region === 'IN' ? 'India (INR)' : 'Global (USD)'}
                          </td>
                          <td className="py-4 px-4 font-mono text-xs text-neutral-300">
                            {p.paymentRail} · {p.connector}
                          </td>
                          <td className="py-4 px-4 font-mono font-bold tabular-nums text-emerald-400">
                            {p.currency === 'INR' ? `₹${p.amount.toLocaleString()}` : `$${p.amount.toLocaleString()}`}
                          </td>
                          <td className="py-4 px-6">
                            <span
                              className={`inline-block px-2.5 py-1 rounded-lg text-[11px] font-mono uppercase font-bold ${
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

        {/* ================= USERS & ORGANIZATIONS TAB ================= */}
        {activeTab === 'users' && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <p className="text-xs font-mono uppercase tracking-[0.18em] text-sky-400 font-semibold">
                  Directory &amp; Account Provisioning
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-1">
                  Users &amp; Organizations
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

            {/* Create Organization Form */}
            {isAddingOrg && (
              <form
                onSubmit={handleCreateOrg}
                className="rounded-3xl bg-neutral-900 border border-indigo-500/40 p-6 space-y-4 animate-enter"
              >
                <h2 className="text-lg font-bold">Register Organization / Agency Account</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1">
                      Organization Name
                    </label>
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
                    <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1">
                      Niche / Industry
                    </label>
                    <input
                      type="text"
                      value={orgIndustry}
                      onChange={(e) => setOrgIndustry(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-sm text-white outline-none focus:border-sky-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1">
                      Plan Tier
                    </label>
                    <select
                      value={orgPlan}
                      onChange={(e) => {
                        const next = e.target.value as 'free' | 'pro' | 'team' | 'enterprise';
                        setOrgPlan(next);
                        setOrgMrr(next === 'free' ? 0 : next === 'pro' ? 12 : next === 'team' ? 29 : 99);
                      }}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-sm text-white outline-none focus:border-sky-400"
                    >
                      <option value="free">Starter Free ($0)</option>
                      <option value="pro">Liddy Pro ($12)</option>
                      <option value="team">Team Workspace ($29)</option>
                      <option value="enterprise">Enterprise ($99+)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1">Seats</label>
                      <input
                        type="number"
                        min={1}
                        value={orgSeats}
                        onChange={(e) => setOrgSeats(Number(e.target.value) || 1)}
                        className="w-full px-3 py-2.5 rounded-xl bg-neutral-950 border border-white/15 text-sm text-white outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono uppercase text-neutral-400 mb-1">MRR ($)</label>
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

            {/* Registered Users Directory */}
            <div className="rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden">
              <div className="p-6 border-b border-white/10">
                <h2 className="text-base font-bold">Registered Cloud Users</h2>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Firebase-authenticated founder and team accounts
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] font-mono uppercase text-neutral-400">
                      <th className="py-3.5 px-6">User Name</th>
                      <th className="py-3.5 px-4">Email</th>
                      <th className="py-3.5 px-4">UID</th>
                      <th className="py-3.5 px-6">Last Active</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 text-sm">
                    {usersList.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-10 px-6 text-center text-xs text-neutral-500 font-mono">
                          No user profiles returned yet. Signed-in Firebase users sync automatically.
                        </td>
                      </tr>
                    ) : (
                      usersList.map((u) => (
                        <tr key={u.userId} className="hover:bg-white/[0.03]">
                          <td className="py-3.5 px-6 font-semibold">{u.displayName}</td>
                          <td className="py-3.5 px-4 font-mono text-xs text-sky-400">{u.email || '—'}</td>
                          <td className="py-3.5 px-4 font-mono text-xs text-neutral-400">{u.userId}</td>
                          <td className="py-3.5 px-6 font-mono text-xs text-neutral-400">
                            {u.updatedAt ? new Date(u.updatedAt).toLocaleString() : 'Active'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Organizations Registry Table */}
            <div className="rounded-3xl bg-neutral-900 border border-white/10 overflow-hidden">
              <div className="p-6 border-b border-white/10">
                <h2 className="text-base font-bold">Organizations Registry</h2>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Synced across Firestore and admin billing telemetry
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] font-mono uppercase text-neutral-400">
                      <th className="py-3.5 px-6">Organization</th>
                      <th className="py-3.5 px-4">Industry</th>
                      <th className="py-3.5 px-4">Plan</th>
                      <th className="py-3.5 px-4">Seats</th>
                      <th className="py-3.5 px-4">MRR</th>
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
                          <td className="py-4 px-6 font-semibold">
                            <div>{org.name}</div>
                            {org.billingEmail && (
                              <div className="text-xs text-neutral-500 font-mono">{org.billingEmail}</div>
                            )}
                          </td>
                          <td className="py-4 px-4 text-neutral-300 text-xs">{org.industry}</td>
                          <td className="py-4 px-4 font-mono text-xs uppercase text-sky-400">{org.planTier}</td>
                          <td className="py-4 px-4 font-mono tabular-nums">{org.seatCount}</td>
                          <td className="py-4 px-4 font-mono tabular-nums text-emerald-400">
                            ${org.monthlyRevenueUsd}
                          </td>
                          <td className="py-4 px-4">
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
                          <td className="py-4 px-6 text-right">
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
          </div>
        )}

        {/* ================= SECURITY & AUDIT TAB ================= */}
        {activeTab === 'security' && (
          <div className="space-y-6">
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.18em] text-amber-400 font-semibold">
                Zero-Trust Access &amp; Compliance
              </p>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-1">
                Security Posture &amp; Audit Stream
              </h1>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5 space-y-2">
                <p className="text-[11px] font-mono uppercase text-neutral-400">RBAC Isolation</p>
                <p className="text-lg font-bold text-emerald-400">Enforced</p>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Admin console is detached from all consumer routes and restricted to verified owner{' '}
                  <span className="font-mono text-white">{PLATFORM_OWNER_EMAIL}</span> or Firestore{' '}
                  <span className="font-mono text-white">/admins/{'{uid}'}</span>.
                </p>
              </div>

              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5 space-y-2">
                <p className="text-[11px] font-mono uppercase text-neutral-400">Firestore Rules Schema</p>
                <p className="text-lg font-bold text-emerald-400">Strict Field Validation</p>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Immutable ownership enforcement on <span className="font-mono text-white">/users</span>,{' '}
                  <span className="font-mono text-white">/payments</span>,{' '}
                  <span className="font-mono text-white">/organizations</span>, and{' '}
                  <span className="font-mono text-white">/ideation_boards</span>.
                </p>
              </div>

              <div className="rounded-2xl bg-neutral-900 border border-white/10 p-5 space-y-2">
                <p className="text-[11px] font-mono uppercase text-neutral-400">Realtime Socket &amp; API Surface</p>
                <p className="text-lg font-bold text-sky-400">Authenticated &amp; Scoped</p>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Active WebSockets: <span className="font-mono text-white">/api/live</span>,{' '}
                  <span className="font-mono text-white">/api/market-stream</span>, and{' '}
                  <span className="font-mono text-white">/api/collab-room</span>. Server-side Gemini keys never leave Node.
                </p>
              </div>
            </div>

            <div className="rounded-3xl bg-neutral-900 border border-white/10 p-6">
              <h2 className="text-base font-bold mb-4">Billing, Org &amp; Security Audit Trail</h2>
              {securityEvents.length > 0 ? (
                <div className="divide-y divide-white/10 max-h-96 overflow-y-auto">
                  {securityEvents.map((evt) => (
                    <div key={evt.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-amber-400">{evt.eventType}</span>
                        <span className="text-neutral-300">scope: {evt.featureWindow}</span>
                        <span className="text-neutral-500">uid: {evt.userId}</span>
                        {evt.metadata && <span className="text-neutral-400">· {evt.metadata}</span>}
                      </div>
                      <span className="font-mono text-neutral-400">
                        {new Date(evt.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-neutral-500 font-mono">
                  No sensitive billing or organization mutation events recorded in the current server window yet.
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminAnalyticsPortal;
