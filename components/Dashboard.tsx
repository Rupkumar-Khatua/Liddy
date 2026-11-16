import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AreaChart, Area, ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { useFinMind } from '../context/FinMindContext';
import { auth } from '../firebase';
import { Invoice, StockHolding, StockPortfolioState, WindowId } from '../types';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import { UPIPaymentModal } from './UPIPaymentModal';

// Non-purple high-clarity financial palette
const COLORS = ['#0F766E', '#0284C7', '#10B981', '#D97706', '#E11D48', '#475569'];

const BROKER_OPTIONS = [
  'Zerodha Kite',
  'Groww',
  'Upstox',
  'Angel One',
  'ICICI Direct',
  'HDFC Sky',
  'Robinhood',
  'Fidelity',
  'Charles Schwab',
  'Interactive Brokers',
  'Other Broker',
];

const GREETING_SETS: Record<'morning' | 'afternoon' | 'evening' | 'night', string[]> = {
  morning: [
    'Good Morning',
    'Fresh Start Today',
    'Morning Money Check',
    'Rise & Plan Ahead',
  ],
  afternoon: [
    'Good Afternoon',
    'Midday Money Pulse',
    'Afternoon Check-In',
    'Steady Focus Today',
  ],
  evening: [
    'Good Evening',
    'Evening Wrap-Up',
    'Closing the Day Cleanly',
    'Evening Financial Snapshot',
  ],
  night: [
    'Quiet Hours, Clear Numbers',
    'Late-Night Check-In',
    'Night Owl Money Brief',
    'Calm Late-Evening View',
  ],
};

const SUBTITLE_OPTIONS = [
  'See where your money goes, track your connected stock broker balance and keep bills settled.',
  'Everyday expenses, manual broking portfolio tracking and clean client invoicing in one place.',
  'Your daily personal cashflow, stock holdings summary and invoice settlements at a glance.',
  'Clear numbers without clutter: daily spending categories, broker balances and pending bills.',
];

interface DashboardProps {
  onNavigateTab?: (tab: string) => void;
  onNavigateWindow?: (windowId: WindowId) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigateTab, onNavigateWindow }) => {
  const {
    transactions,
    invoices,
    markInvoicePaid,
    currentUser,
    formatAmount,
    stockPortfolio,
    updateStockPortfolio,
    currencyPlacement,
    payoutConfig,
  } = useFinMind();

  const [timeframe, setTimeframe] = useState<'daily' | 'weekly'>('daily');
  const [inspectingInvoice, setInspectingInvoice] = useState<Invoice | null>(null);
  const [settlingInvoice, setSettlingInvoice] = useState<Invoice | null>(null);
  const [greetingVariant, setGreetingVariant] = useState<number>(() => Math.floor(Math.random() * 4));

  // Automatically evolve greeting and summary subtitles over time without manual refreshing
  useEffect(() => {
    const timer = window.setInterval(() => {
      setGreetingVariant((v) => v + 1);
    }, 22000);
    return () => window.clearInterval(timer);
  }, []);

  // Stock Portfolio Drawer / Modal State
  const [isPortfolioModalOpen, setIsPortfolioModalOpen] = useState(false);
  const [draftBroker, setDraftBroker] = useState(stockPortfolio.brokerName || 'Zerodha Kite');
  const [draftCurrency, setDraftCurrency] = useState(stockPortfolio.currency || '₹');
  const [draftTotalValue, setDraftTotalValue] = useState(String(stockPortfolio.totalValue || 0));
  const [draftTotalInvested, setDraftTotalInvested] = useState(String(stockPortfolio.totalInvested || 0));
  const [draftNotes, setDraftNotes] = useState(stockPortfolio.notes || '');
  const [draftHoldings, setDraftHoldings] = useState<StockHolding[]>(stockPortfolio.holdings || []);
  const [savingPortfolio, setSavingPortfolio] = useState(false);

  // Add new holding quick inputs
  const [newSymbol, setNewSymbol] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newShares, setNewShares] = useState('');
  const [newAvgPrice, setNewAvgPrice] = useState('');
  const [newCurPrice, setNewCurPrice] = useState('');

  const userName =
    currentUser?.displayName?.split(' ')[0] ||
    auth.currentUser?.displayName?.split(' ')[0] ||
    'Friend';

  const navigate = (winId: WindowId, legacyTab: string) => {
    if (onNavigateWindow) {
      onNavigateWindow(winId);
    } else if (onNavigateTab) {
      onNavigateTab(legacyTab);
    }
  };

  const openPortfolioEditor = () => {
    setDraftBroker(stockPortfolio.brokerName || 'Zerodha Kite');
    setDraftCurrency(stockPortfolio.currency || '₹');
    setDraftTotalValue(String(stockPortfolio.totalValue || 0));
    setDraftTotalInvested(String(stockPortfolio.totalInvested || 0));
    setDraftNotes(stockPortfolio.notes || '');
    setDraftHoldings(stockPortfolio.holdings || []);
    setIsPortfolioModalOpen(true);
  };

  const formatBrokerAmount = (amount: number, sym = stockPortfolio.currency || '₹') => {
    const val = Number(amount || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return currencyPlacement === 'before' ? `${sym}${val}` : `${val} ${sym}`;
  };

  const totalSpent = useMemo(() => {
    return transactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }, [transactions]);

  const paidInvoices = useMemo(() => {
    return (invoices || []).filter((inv) => inv.paymentStatus === 'paid');
  }, [invoices]);

  const settledInvoiceTotal = useMemo(() => {
    return paidInvoices.reduce((sum, inv) => sum + (Number(inv.grandTotal) || 0), 0);
  }, [paidInvoices]);

  const unpaidInvoices = useMemo(() => {
    return (invoices || []).filter((inv) => inv.paymentStatus !== 'paid');
  }, [invoices]);

  const pendingInvoiceTotal = useMemo(() => {
    return unpaidInvoices.reduce((sum, inv) => sum + (Number(inv.grandTotal) || 0), 0);
  }, [unpaidInvoices]);

  const chartData = useMemo(() => {
    if (transactions.length === 0) return [];
    const grouped: Record<string, number> = {};
    [...transactions].reverse().forEach((t) => {
      const day = new Date(t.date).toLocaleDateString('en-US', { weekday: 'short' });
      grouped[day] = (grouped[day] || 0) + (timeframe === 'weekly' ? t.amount * 1.25 : t.amount);
    });
    return Object.keys(grouped).map((key) => ({
      name: key,
      spent: Math.round(grouped[key] * 100) / 100,
    }));
  }, [transactions, timeframe]);

  const pieData = useMemo(() => {
    if (transactions.length === 0) return [];
    const grouped: Record<string, number> = {};
    transactions.forEach((t) => {
      const cat = t.category || 'General';
      grouped[cat] = (grouped[cat] || 0) + (Number(t.amount) || 0);
    });
    return Object.keys(grouped)
      .map((key) => ({
        name: key,
        value: Math.round(grouped[key] * 100) / 100,
      }))
      .sort((a, b) => b.value - a.value);
  }, [transactions]);

  const { greetingTitle, greetingSubtitle } = useMemo(() => {
    const hour = new Date().getHours();
    const bucket: keyof typeof GREETING_SETS =
      hour >= 5 && hour < 12
        ? 'morning'
        : hour >= 12 && hour < 17
        ? 'afternoon'
        : hour >= 17 && hour < 22
        ? 'evening'
        : 'night';
    const phrases = GREETING_SETS[bucket];
    return {
      greetingTitle: phrases[greetingVariant % phrases.length],
      greetingSubtitle: SUBTITLE_OPTIONS[greetingVariant % SUBTITLE_OPTIONS.length],
    };
  }, [greetingVariant]);

  const portfolioGain = (Number(stockPortfolio.totalValue) || 0) - (Number(stockPortfolio.totalInvested) || 0);
  const portfolioGainPct =
    Number(stockPortfolio.totalInvested) > 0
      ? (portfolioGain / Number(stockPortfolio.totalInvested)) * 100
      : 0;

  const handleAddHolding = () => {
    const sym = newSymbol.trim().toUpperCase();
    const sh = Number(newShares) || 0;
    const avg = Number(newAvgPrice) || 0;
    const cur = Number(newCurPrice) || avg;
    if (!sym || sh <= 0) return;

    const item: StockHolding = {
      id: `stk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      symbol: sym,
      name: newCompany.trim() || sym,
      shares: sh,
      avgPrice: avg,
      currentPrice: cur,
    };
    const nextHoldings = [item, ...draftHoldings];
    setDraftHoldings(nextHoldings);

    const sumVal = nextHoldings.reduce((s, h) => s + h.shares * h.currentPrice, 0);
    const sumInv = nextHoldings.reduce((s, h) => s + h.shares * h.avgPrice, 0);
    setDraftTotalValue(sumVal.toFixed(2));
    setDraftTotalInvested(sumInv.toFixed(2));

    setNewSymbol('');
    setNewCompany('');
    setNewShares('');
    setNewAvgPrice('');
    setNewCurPrice('');
  };

  const handleRemoveHolding = (id: string) => {
    const nextHoldings = draftHoldings.filter((h) => h.id !== id);
    setDraftHoldings(nextHoldings);
  };

  const handleRecalculateFromHoldings = () => {
    const sumVal = draftHoldings.reduce((s, h) => s + (Number(h.shares) || 0) * (Number(h.currentPrice) || 0), 0);
    const sumInv = draftHoldings.reduce((s, h) => s + (Number(h.shares) || 0) * (Number(h.avgPrice) || 0), 0);
    setDraftTotalValue(sumVal.toFixed(2));
    setDraftTotalInvested(sumInv.toFixed(2));
  };

  const handleSavePortfolio = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPortfolio(true);
    try {
      const nextState: StockPortfolioState = {
        brokerName: draftBroker.trim() || 'Zerodha Kite',
        totalValue: Math.max(0, Number(draftTotalValue) || 0),
        totalInvested: Math.max(0, Number(draftTotalInvested) || 0),
        currency: draftCurrency || '₹',
        notes: draftNotes.trim(),
        holdings: draftHoldings,
        updatedAt: new Date().toISOString(),
      };
      await updateStockPortfolio(nextState);
      setIsPortfolioModalOpen(false);
    } finally {
      setSavingPortfolio(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header + Everyday Financial Shortcuts */}
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-[0.16em] text-teal-700 dark:text-teal-400 font-semibold">
            Daily Finance Pulse
          </p>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-neutral-900 dark:text-white tracking-tight mt-1">
            {greetingTitle}, {userName}
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
            {greetingSubtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigate('invoices', 'TRANSACTIONS')}
            className="px-4 py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-950 text-xs font-bold cursor-pointer transition-colors"
          >
            + Create Invoice
          </button>
          <button
            type="button"
            onClick={() => navigate('scanner', 'TRANSACTIONS')}
            className="px-4 py-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:border-teal-500 text-neutral-800 dark:text-neutral-200 text-xs font-semibold cursor-pointer transition-colors"
          >
            Log / Scan Expense
          </button>
          <button
            type="button"
            onClick={() => navigate('agent', 'CHAT')}
            className="px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-600 text-white text-xs font-bold cursor-pointer transition-colors"
          >
            Ask Liddy AI
          </button>
        </div>
      </header>

      {/* Primary 3 Focused Cards: Personal Expenses, Stock Portfolio Balance, Invoices */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* CARD 1: Personal Expenses ("Where I Spent What") */}
        <div className="bg-white dark:bg-neutral-900/90 border border-neutral-200/80 dark:border-neutral-800 p-7 rounded-[28px] flex flex-col justify-between min-h-[250px] shadow-xs">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-neutral-500 dark:text-neutral-400 text-xs font-semibold uppercase tracking-wider font-mono">
                Personal Expenses
              </p>
              <button
                type="button"
                onClick={() => navigate('scanner', 'TRANSACTIONS')}
                className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
              >
                Where I Spent What &rarr;
              </button>
            </div>
            <h2 className="text-4xl font-extrabold text-neutral-900 dark:text-white mt-2.5 tracking-tight font-mono tabular-nums">
              {formatAmount(totalSpent)}
            </h2>
          </div>

          <div className="my-3">
            {pieData.length > 0 ? (
              <div className="space-y-2">
                {pieData.slice(0, 3).map((cat, idx) => {
                  const pct = totalSpent > 0 ? Math.round((cat.value / totalSpent) * 100) : 0;
                  return (
                    <div key={cat.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-neutral-700 dark:text-neutral-300 truncate pr-2">
                          {cat.name}
                        </span>
                        <span className="font-mono font-bold text-neutral-900 dark:text-white tabular-nums">
                          {formatAmount(cat.value)} <span className="text-neutral-400 font-normal">({pct}%)</span>
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-sm bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                        <div
                          className="h-full rounded-sm"
                          style={{
                            width: `${Math.max(6, pct)}%`,
                            backgroundColor: COLORS[idx % COLORS.length],
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="w-full h-16 flex items-center text-xs text-neutral-400 dark:text-neutral-500 font-mono">
                Scan receipts or log daily spending to see where your money goes.
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-neutral-100 dark:border-neutral-800 text-xs text-neutral-600 dark:text-neutral-300">
            <span className="truncate pr-2">
              {transactions[0]
                ? `Latest: ${transactions[0].merchant} (${formatAmount(transactions[0].amount)})`
                : 'No expenses recorded yet'}
            </span>
            <span className="font-mono font-semibold text-neutral-500 shrink-0">
              {transactions.length} {transactions.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>
        </div>

        {/* CARD 2: Stock Portfolio Balance (Broker Connected + Manual Edit) */}
        <div className="bg-white dark:bg-neutral-900/90 border border-neutral-200/80 dark:border-neutral-800 p-7 rounded-[28px] flex flex-col justify-between min-h-[250px] shadow-xs">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-neutral-500 dark:text-neutral-400 text-xs font-semibold uppercase tracking-wider font-mono">
                Stock Portfolio · {stockPortfolio.brokerName}
              </p>
              <button
                type="button"
                onClick={openPortfolioEditor}
                className="text-xs font-bold text-sky-700 dark:text-sky-400 hover:underline cursor-pointer shrink-0"
              >
                Update Balance
              </button>
            </div>

            <div className="mt-2.5 flex items-baseline gap-2.5 flex-wrap">
              <h2 className="text-4xl font-extrabold text-neutral-900 dark:text-white tracking-tight font-mono tabular-nums">
                {formatBrokerAmount(stockPortfolio.totalValue)}
              </h2>
              {stockPortfolio.totalInvested > 0 && (
                <span
                  className={`text-xs font-mono font-bold ${
                    portfolioGain >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {portfolioGain >= 0 ? '+' : ''}
                  {formatBrokerAmount(portfolioGain)} ({portfolioGainPct >= 0 ? '+' : ''}
                  {portfolioGainPct.toFixed(1)}%)
                </span>
              )}
            </div>
          </div>

          <div className="my-3 space-y-1.5">
            {stockPortfolio.holdings && stockPortfolio.holdings.length > 0 ? (
              stockPortfolio.holdings.slice(0, 3).map((h) => {
                const posVal = (Number(h.shares) || 0) * (Number(h.currentPrice) || 0);
                return (
                  <div
                    key={h.id}
                    className="flex items-center justify-between text-xs py-1 px-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/60"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-extrabold text-neutral-900 dark:text-white">
                        {h.symbol}
                      </span>
                      <span className="text-neutral-500 truncate">{h.shares} sh</span>
                    </div>
                    <span className="font-mono font-bold text-neutral-900 dark:text-white tabular-nums">
                      {formatBrokerAmount(posVal)}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-neutral-400 dark:text-neutral-500 font-mono py-2">
                Connect your stock broking app ({stockPortfolio.brokerName}) &amp; enter your holdings or current balance.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-neutral-100 dark:border-neutral-800 text-xs">
            <span className="text-neutral-500 font-mono">
              Invested: <strong className="text-neutral-900 dark:text-white">{formatBrokerAmount(stockPortfolio.totalInvested)}</strong>
            </span>
            <button
              type="button"
              onClick={openPortfolioEditor}
              className="px-3 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-950 font-bold cursor-pointer transition-colors"
            >
              Connect / Edit
            </button>
          </div>
        </div>

        {/* CARD 3: Invoices Summary */}
        <div className="bg-neutral-950 p-7 rounded-[28px] flex flex-col justify-between min-h-[250px] text-white shadow-lg border border-neutral-800">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-neutral-400 text-xs font-semibold uppercase tracking-wider font-mono">
                Invoices &amp; Bills
              </p>
              <button
                type="button"
                onClick={() => navigate('invoices', 'TRANSACTIONS')}
                className="text-xs font-semibold text-sky-400 hover:underline cursor-pointer"
              >
                Open Hub &rarr;
              </button>
            </div>
            <div className="mt-2.5 flex items-baseline gap-2 flex-wrap">
              <h2 className="text-4xl font-extrabold tracking-tight font-mono tabular-nums text-white">
                {formatAmount(pendingInvoiceTotal)}
              </h2>
              <span className="text-xs text-neutral-400">pending payment</span>
            </div>
          </div>

          <div className="my-3 space-y-2 text-xs">
            <div className="flex items-center justify-between py-1.5 px-3 rounded-xl bg-white/5 border border-white/10">
              <span className="text-neutral-300">Paid &amp; Collected ({paidInvoices.length})</span>
              <span className="font-mono font-bold text-emerald-400 tabular-nums">
                {formatAmount(settledInvoiceTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between py-1.5 px-3 rounded-xl bg-white/5 border border-white/10">
              <span className="text-neutral-300">Open Unpaid ({unpaidInvoices.length})</span>
              <span className="font-mono font-bold text-amber-400 tabular-nums">
                {formatAmount(pendingInvoiceTotal)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-white/10 text-xs">
            <span className="text-neutral-400 font-mono truncate pr-2">
              {unpaidInvoices[0]
                ? `Next: ${unpaidInvoices[0].invoiceNumber}`
                : `${invoices.length} total invoices`}
            </span>
            <button
              type="button"
              onClick={() => navigate('invoices', 'TRANSACTIONS')}
              className="text-sky-400 hover:text-sky-300 font-bold flex items-center gap-1 cursor-pointer transition-colors shrink-0"
            >
              <span>{unpaidInvoices.length > 0 ? `Settle (${unpaidInvoices.length})` : 'Manage Invoices'}</span>
              <span>&rarr;</span>
            </button>
          </div>
        </div>
      </div>

      {/* Pending Client Invoices Quick Settlement Strip */}
      {unpaidInvoices.length > 0 && (
        <section className="bg-white dark:bg-neutral-900/90 border border-neutral-200/80 dark:border-neutral-800 rounded-[28px] p-6 space-y-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-mono uppercase tracking-wider text-amber-600 dark:text-amber-400 font-semibold">
                Pending Payment Action · {unpaidInvoices.length} Awaiting Settlement
              </p>
              <h3 className="text-lg font-extrabold text-neutral-900 dark:text-white mt-0.5">
                Inspect &amp; Settle Open Invoices
              </h3>
            </div>
            <button
              type="button"
              onClick={() => navigate('invoices', 'TRANSACTIONS')}
              className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold text-neutral-800 dark:text-neutral-200 cursor-pointer whitespace-nowrap"
            >
              Open Full Invoices Register &rarr;
            </button>
          </div>

          <div className="divide-y divide-neutral-100 dark:divide-neutral-800 border border-neutral-200/70 dark:border-neutral-800 rounded-2xl overflow-hidden">
            {unpaidInvoices.slice(0, 4).map((inv) => (
              <div
                key={inv.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 bg-neutral-50/40 dark:bg-neutral-900/50 hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition-colors"
              >
                <div className="min-w-0">
                  <p className="font-bold text-sm text-neutral-900 dark:text-white truncate">
                    {inv.clientName || 'Walk-in Client'} · {inv.invoiceNumber}
                  </p>
                  <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                    Issued {inv.date} {inv.dueDate ? `· Due ${inv.dueDate}` : ''} · {(inv.items || []).length}{' '}
                    {(inv.items || []).length === 1 ? 'item' : 'items'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
                  <span className="font-mono font-extrabold text-sm tabular-nums text-neutral-900 dark:text-white mr-1">
                    {formatAmount(Number(inv.grandTotal) || 0)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setInspectingInvoice(inv)}
                    className="px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-white dark:hover:bg-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-200 cursor-pointer whitespace-nowrap"
                  >
                    Preview / PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => setSettlingInvoice(inv)}
                    className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                  >
                    Pay via UPI
                  </button>
                  <button
                    type="button"
                    onClick={() => markInvoicePaid(inv.id, 'UPI', inv.upiId)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                  >
                    Mark Paid
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Main Analytics Grid (Zero Purple Dots) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 bg-white dark:bg-neutral-900/80 border border-neutral-200/80 dark:border-neutral-800 p-7 rounded-[28px] flex flex-col justify-between shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h3 className="text-lg font-bold text-neutral-900 dark:text-white">
                Spending &amp; Outflow Velocity
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Real-time breakdown of your verified daily receipts and recorded costs.
              </p>
            </div>
            <div className="flex bg-neutral-100 dark:bg-neutral-800 p-1 rounded-xl self-start">
              <button
                type="button"
                onClick={() => setTimeframe('daily')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  timeframe === 'daily'
                    ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-2xs'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
              >
                Daily
              </button>
              <button
                type="button"
                onClick={() => setTimeframe('weekly')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  timeframe === 'weekly'
                    ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-2xs'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
              >
                Weekly
              </button>
            </div>
          </div>

          <div className="w-full h-64 flex items-center justify-center">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorSpentClean" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0F766E" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#0F766E" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip
                    contentStyle={{
                      borderRadius: '14px',
                      background: '#18181B',
                      border: 'none',
                      color: '#FFF',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="spent"
                    stroke="#0F766E"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0, fill: '#0284C7' }}
                    fillOpacity={1}
                    fill="url(#colorSpentClean)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-center py-10 px-6 max-w-sm space-y-3">
                <h4 className="font-bold text-neutral-900 dark:text-white text-sm">
                  Ready for Your First Entry
                </h4>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
                  Your account starts fresh with zero sample entries. Snap a receipt or add an entry to plot live spending.
                </p>
                <div className="pt-2 flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => navigate('scanner', 'TRANSACTIONS')}
                    className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    Capture First Receipt &rarr;
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="lg:col-span-4 bg-white dark:bg-neutral-900/80 border border-neutral-200/80 dark:border-neutral-800 p-7 rounded-[28px] flex flex-col justify-between shadow-xs">
          <div>
            <h3 className="text-lg font-bold text-neutral-900 dark:text-white">
              Expense Allocation
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              Category breakdown across your personal daily spend.
            </p>
          </div>

          <div className="my-auto py-6 flex flex-col items-center justify-center">
            {pieData.length > 0 ? (
              <>
                <div className="w-48 h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={80}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {pieData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-full mt-4 space-y-2 max-h-36 overflow-y-auto no-scrollbar">
                  {pieData.map((item, idx) => (
                    <div key={item.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3 h-1.5 rounded-xs shrink-0"
                          style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                        />
                        <span className="text-neutral-700 dark:text-neutral-300 font-medium">
                          {item.name}
                        </span>
                      </div>
                      <span className="font-mono font-bold text-neutral-900 dark:text-white">
                        {formatAmount(item.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-6 px-4 space-y-2">
                <div className="text-xs font-bold text-neutral-900 dark:text-white">
                  No Categories Tracked Yet
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Groceries, dining, utilities, subscriptions and travel group automatically after your first scan.
                </p>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
            <button
              type="button"
              onClick={() => navigate('markets', 'MARKETS')}
              className="text-xs font-bold text-teal-700 dark:text-teal-400 hover:underline cursor-pointer"
            >
              Live Market Wire &rarr;
            </button>
            <button
              type="button"
              onClick={openPortfolioEditor}
              className="text-xs font-semibold text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
            >
              Stock Broker Setup
            </button>
          </div>
        </div>
      </div>

      {/* Interactive Stock Portfolio & Broker App Editor Modal */}
      {isPortfolioModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[9995] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-enter"
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsPortfolioModalOpen(false);
            }}
          >
            <div className="bg-white dark:bg-[#121216] border border-neutral-200 dark:border-neutral-800 rounded-[28px] max-w-2xl w-full p-6 sm:p-8 shadow-2xl text-neutral-900 dark:text-neutral-100 my-auto space-y-6">
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-neutral-200/80 dark:border-neutral-800">
                <div>
                  <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-sky-600 dark:text-sky-400 font-bold">
                    Stock Broking Connection &amp; Holdings
                  </p>
                  <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight mt-0.5">
                    Update Your Stock Portfolio Balance
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPortfolioModalOpen(false)}
                  aria-label="Close stock portfolio editor"
                  className="w-9 h-9 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 flex items-center justify-center text-xs font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSavePortfolio} className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-mono uppercase text-neutral-500 mb-1">
                      Stock Broking App
                    </label>
                    <select
                      value={draftBroker}
                      onChange={(e) => setDraftBroker(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs sm:text-sm font-bold outline-none focus:border-sky-500"
                    >
                      {BROKER_OPTIONS.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-mono uppercase text-neutral-500 mb-1">
                      Portfolio Currency
                    </label>
                    <select
                      value={draftCurrency}
                      onChange={(e) => setDraftCurrency(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs sm:text-sm font-bold outline-none focus:border-sky-500"
                    >
                      <option value="₹">₹ INR</option>
                      <option value="$">$ USD</option>
                      <option value="€">€ EUR</option>
                      <option value="£">£ GBP</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-mono uppercase text-neutral-500 mb-1">
                      Current Portfolio Balance ({draftCurrency})
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={draftTotalValue}
                      onChange={(e) => setDraftTotalValue(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm font-mono font-extrabold outline-none focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono uppercase text-neutral-500 mb-1">
                      Total Invested Capital ({draftCurrency})
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={draftTotalInvested}
                      onChange={(e) => setDraftTotalInvested(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm font-mono font-extrabold outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                {/* Add Stock Holding Row */}
                <div className="p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/50 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold">Tracked Stock Holdings ({draftHoldings.length})</span>
                    {draftHoldings.length > 0 && (
                      <button
                        type="button"
                        onClick={handleRecalculateFromHoldings}
                        className="text-[11px] font-mono font-bold text-sky-600 dark:text-sky-400 hover:underline cursor-pointer"
                      >
                        Sync Balance from Holdings
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                    <input
                      type="text"
                      value={newSymbol}
                      onChange={(e) => setNewSymbol(e.target.value)}
                      placeholder="Ticker (INFY)"
                      className="px-2.5 py-2 rounded-lg bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 text-xs font-mono uppercase"
                    />
                    <input
                      type="text"
                      value={newCompany}
                      onChange={(e) => setNewCompany(e.target.value)}
                      placeholder="Name"
                      className="px-2.5 py-2 rounded-lg bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 text-xs"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={newShares}
                      onChange={(e) => setNewShares(e.target.value)}
                      placeholder="Shares"
                      className="px-2.5 py-2 rounded-lg bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 text-xs font-mono"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={newAvgPrice}
                      onChange={(e) => setNewAvgPrice(e.target.value)}
                      placeholder="Buy Avg"
                      className="px-2.5 py-2 rounded-lg bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 text-xs font-mono"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={newCurPrice}
                      onChange={(e) => setNewCurPrice(e.target.value)}
                      placeholder="Cur Price"
                      className="px-2.5 py-2 rounded-lg bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 text-xs font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleAddHolding}
                      className="px-3 py-2 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer"
                    >
                      + Add
                    </button>
                  </div>

                  {draftHoldings.length > 0 && (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto pt-1">
                      {draftHoldings.map((h) => {
                        const val = h.shares * h.currentPrice;
                        return (
                          <div
                            key={h.id}
                            className="flex items-center justify-between px-3 py-2 rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200/80 dark:border-neutral-800 text-xs"
                          >
                            <div className="min-w-0">
                              <span className="font-mono font-bold text-neutral-900 dark:text-white mr-2">
                                {h.symbol}
                              </span>
                              <span className="text-neutral-500">
                                {h.shares} sh @ {formatBrokerAmount(h.currentPrice, draftCurrency)}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-mono font-bold tabular-nums">
                                {formatBrokerAmount(val, draftCurrency)}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveHolding(h.id)}
                                className="text-rose-500 font-bold cursor-pointer px-1"
                              >
                                &times;
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-mono uppercase text-neutral-500 mb-1">
                    Broker Account Note (Optional)
                  </label>
                  <input
                    type="text"
                    value={draftNotes}
                    onChange={(e) => setDraftNotes(e.target.value)}
                    placeholder="e.g. Long-term equity DEMAT / retirement brokerage"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none focus:border-sky-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-2 border-t border-neutral-200/80 dark:border-neutral-800">
                  <button
                    type="button"
                    onClick={() => setIsPortfolioModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-bold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingPortfolio}
                    className="px-6 py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer disabled:opacity-60"
                  >
                    {savingPortfolio ? 'Saving...' : 'Save Portfolio Balance'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      <InvoiceDetailModal
        invoice={inspectingInvoice}
        onClose={() => setInspectingInvoice(null)}
      />

      {settlingInvoice && (
        <UPIPaymentModal
          isOpen={Boolean(settlingInvoice)}
          onClose={() => setSettlingInvoice(null)}
          amount={Number(settlingInvoice.grandTotal) || 0}
          currency={settlingInvoice.currency || '₹'}
          defaultUpiId={settlingInvoice.upiId || payoutConfig.upiId || ''}
          defaultPayeeName={settlingInvoice.payeeName || settlingInvoice.senderName || payoutConfig.payeeName || 'Billing Desk'}
          invoiceNumber={settlingInvoice.invoiceNumber}
          onPaymentSuccess={(method, upiRef) => {
            markInvoicePaid(settlingInvoice.id, method, upiRef);
            setSettlingInvoice(null);
          }}
        />
      )}
    </div>
  );
};

export default Dashboard;