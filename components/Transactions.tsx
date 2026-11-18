import React, { useState, useMemo } from 'react';
import { useFinMind } from '../context/FinMindContext';
import ReceiptScanner from './ReceiptScanner';
import { InvoiceGenerator } from './InvoiceGenerator';
import { InvoicesHub } from './InvoicesHub';
import TransactionModal from './TransactionModal';
import { ICONS } from '../constants';
import { Transaction } from '../types';

type ActiveTab = 'LIST' | 'INVOICE';
type InvoiceSubView = 'HUB' | 'CREATE' | 'SCAN_BILL';

interface TransactionsProps {
  initialTab?: ActiveTab;
  initialInvoiceView?: InvoiceSubView;
}

const DEFAULT_EXPENSE_CATEGORIES = [
  'Groceries',
  'Dining',
  'Transport',
  'Utilities',
  'Shopping',
  'Subscriptions',
  'Healthcare',
  'Other',
];

const Transactions: React.FC<TransactionsProps> = ({
  initialTab = 'LIST',
  initialInvoiceView = 'HUB',
}) => {
  const {
    transactions,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    clearAllTransactions,
    formatAmount,
    currencySymbol,
    paymentRegion,
  } = useFinMind();

  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);
  const [invoiceSubView, setInvoiceSubView] = useState<InvoiceSubView>(initialInvoiceView);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  React.useEffect(() => {
    setActiveTab(initialTab);
    if (initialTab === 'INVOICE') {
      setInvoiceSubView(initialInvoiceView || 'HUB');
    }
  }, [initialTab, initialInvoiceView]);

  // Manual Daily Expense Form State (Always open & free)
  const [isAddExpenseOpen, setIsAddExpenseOpen] = useState(false);
  const [newMerchant, setNewMerchant] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCategory, setNewCategory] = useState('Groceries');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newMethod, setNewMethod] = useState<'UPI' | 'PAYPAL' | 'CARD' | 'CASH'>(() =>
    paymentRegion === 'IN' ? 'UPI' : 'PAYPAL'
  );
  const [newNotes, setNewNotes] = useState('');

  React.useEffect(() => {
    setNewMethod((prev) => {
      if (paymentRegion === 'IN' && prev === 'PAYPAL') return 'UPI';
      if (paymentRegion === 'INTL' && prev === 'UPI') return 'PAYPAL';
      return prev;
    });
  }, [paymentRegion]);

  // Search and Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedMethod, setSelectedMethod] = useState('All');
  const [confirmPurgeAll, setConfirmPurgeAll] = useState(false);

  const handleSaveManualExpense = (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseFloat(newAmount);
    if (!newMerchant.trim() || !numericAmount || numericAmount <= 0) return;

    addTransaction({
      merchant: newMerchant.trim(),
      amount: numericAmount,
      category: newCategory.trim() || 'Other',
      date: newDate || new Date().toISOString().split('T')[0],
      paymentMethod: newMethod,
      notes: newNotes.trim() || undefined,
    });

    setNewMerchant('');
    setNewAmount('');
    setNewNotes('');
    setIsAddExpenseOpen(false);
  };

  const handleSaveReceiptExpense = (data: Partial<Transaction>) => {
    if (data.merchant && typeof data.amount === 'number') {
      addTransaction({
        merchant: data.merchant,
        amount: data.amount,
        category: data.category || 'General',
        date: data.date || new Date().toISOString().split('T')[0],
        paymentMethod: data.paymentMethod || 'SCAN_RECEIPT',
        upiReference: data.upiReference,
        notes: data.notes,
      });
    }
  };

  const handleUpdateTransaction = (id: string, updates: Partial<Transaction>) => {
    updateTransaction(id, updates);
  };

  const handleExecuteSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAppliedSearch(searchQuery.trim().toLowerCase());
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setAppliedSearch('');
  };

  // Filtered transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (selectedCategory !== 'All' && t.category.toLowerCase() !== selectedCategory.toLowerCase()) {
        return false;
      }
      if (selectedMethod !== 'All' && t.paymentMethod !== selectedMethod) {
        return false;
      }
      if (appliedSearch) {
        const matchMerchant = t.merchant.toLowerCase().includes(appliedSearch);
        const matchCategory = t.category.toLowerCase().includes(appliedSearch);
        const matchAmount = t.amount.toString().includes(appliedSearch);
        const matchNotes = t.notes ? t.notes.toLowerCase().includes(appliedSearch) : false;
        const matchMethod = t.paymentMethod ? t.paymentMethod.toLowerCase().includes(appliedSearch) : false;
        if (!matchMerchant && !matchCategory && !matchAmount && !matchNotes && !matchMethod) {
          return false;
        }
      }
      return true;
    });
  }, [transactions, selectedCategory, selectedMethod, appliedSearch]);

  // Category Breakdown ("Where You Spent What")
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { category: string; total: number; count: number }>();
    let grand = 0;
    transactions.forEach((t) => {
      const cat = (t.category || 'Other').trim() || 'Other';
      const amt = Number(t.amount) || 0;
      grand += amt;
      const existing = map.get(cat) || { category: cat, total: 0, count: 0 };
      existing.total += amt;
      existing.count += 1;
      map.set(cat, existing);
    });
    const list = Array.from(map.values()).sort((a, b) => b.total - a.total);
    return { list, grand };
  }, [transactions]);

  const availableCategories = useMemo(() => {
    const set = new Set<string>(DEFAULT_EXPENSE_CATEGORIES);
    transactions.forEach((t) => {
      if (t.category) set.add(t.category);
    });
    return Array.from(set);
  }, [transactions]);

  const filteredTotal = useMemo(() => {
    return filteredTransactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }, [filteredTransactions]);

  if (activeTab === 'INVOICE') {
    return (
      <div className="space-y-6 animate-enter">
        {/* Clean Swiss Invoice Workspace Header & Unified 3-Mode Switcher */}
        <div className="rounded-3xl border border-[#E5E5E5] dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-neutral-500 font-semibold">
              Invoicing &amp; Paper-to-Digital Studio
            </p>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 dark:text-white tracking-tight mt-0.5">
              Invoices &amp; Digital Bills
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'HUB' as const, label: 'Saved Invoices' },
              { id: 'CREATE' as const, label: '+ New Invoice' },
              { id: 'SCAN_BILL' as const, label: 'Scan Paper Bill -> Digital' },
            ].map((tab) => {
              const active = invoiceSubView === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setInvoiceSubView(tab.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950'
                      : 'bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-neutral-900'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setActiveTab('LIST')}
              className="px-3.5 py-2 rounded-xl border border-[#E5E5E5] dark:border-neutral-700 text-xs font-semibold text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer whitespace-nowrap"
            >
              Daily Expenses
            </button>
          </div>
        </div>

        {invoiceSubView === 'CREATE' && (
          <InvoiceGenerator
            onSaved={() => setInvoiceSubView('HUB')}
            onCancel={() => setInvoiceSubView('HUB')}
          />
        )}

        {invoiceSubView === 'SCAN_BILL' && (
          <ReceiptScanner
            onSave={handleSaveReceiptExpense}
            onSavedInvoice={() => setInvoiceSubView('HUB')}
            onCancel={() => setInvoiceSubView('HUB')}
          />
        )}

        {invoiceSubView === 'HUB' && (
          <InvoicesHub
            onCreateNew={() => setInvoiceSubView('CREATE')}
            onScanPaperBill={() => setInvoiceSubView('SCAN_BILL')}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-2 h-full flex flex-col relative animate-enter">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-neutral-500 font-semibold">
            Personal Spending &amp; Categories
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 dark:text-white tracking-tight mt-0.5">
            Where I Spent What
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Inspect spending categories and log daily expenses anytime.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsAddExpenseOpen((p) => !p)}
            className="bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            {isAddExpenseOpen ? 'Close Entry Form' : '+ Log Expense'}
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('INVOICE');
              setInvoiceSubView('HUB');
            }}
            className="px-4 py-2.5 rounded-xl border border-[#E5E5E5] dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-xs font-bold text-neutral-800 dark:text-neutral-200 cursor-pointer"
          >
            Invoices &amp; Bills &rarr;
          </button>
        </div>
      </header>

      {/* Inline Manual Daily Spend Entry Form */}
      {isAddExpenseOpen && (
        <form
          onSubmit={handleSaveManualExpense}
          className="rounded-3xl border border-[#E5E5E5] dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 sm:p-6 space-y-4 animate-enter"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-neutral-900 dark:text-white">Log Daily Expense</h2>
            <button
              type="button"
              onClick={() => setIsAddExpenseOpen(false)}
              className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
            >
              Cancel
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="lg:col-span-2">
              <label className="text-[10px] font-mono uppercase text-neutral-500 font-bold">Merchant / Item *</label>
              <input
                type="text"
                required
                value={newMerchant}
                onChange={(e) => setNewMerchant(e.target.value)}
                placeholder="e.g. Neighborhood Grocery, Metro Pass"
                className="w-full mt-1 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-neutral-500 font-bold">
                Amount ({currencySymbol}) *
              </label>
              <input
                type="number"
                required
                step="0.01"
                min="0.01"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                placeholder="0.00"
                className="w-full mt-1 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono font-bold outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-neutral-500 font-bold">Category</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-full mt-1 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
              >
                {availableCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-neutral-500 font-bold">Date</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full mt-1 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div>
              <label className="text-[10px] font-mono uppercase text-neutral-500 font-bold">Method</label>
              <select
                value={newMethod}
                onChange={(e) => setNewMethod(e.target.value as 'UPI' | 'PAYPAL' | 'CARD' | 'CASH')}
                className="w-full mt-1 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-semibold outline-none"
              >
                {paymentRegion === 'IN' ? (
                  <option value="UPI">UPI</option>
                ) : (
                  <option value="PAYPAL">PayPal</option>
                )}
                <option value="CARD">Card</option>
                <option value="CASH">Cash</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] font-mono uppercase text-neutral-500 font-bold">Notes (Optional)</label>
              <input
                type="text"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Context or tag"
                className="w-full mt-1 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-xl px-3 py-2 text-xs outline-none"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer"
            >
              Save Expense
            </button>
          </div>
        </form>
      )}

      {/* Category Spending Breakdown */}
      {categoryBreakdown.list.length > 0 && (
        <div className="rounded-3xl border border-[#E5E5E5] dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-mono uppercase tracking-wider text-neutral-500 font-bold">
              Spending by Category
            </h2>
            {selectedCategory !== 'All' && (
              <button
                type="button"
                onClick={() => setSelectedCategory('All')}
                className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 hover:underline cursor-pointer"
              >
                Show All Categories
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {categoryBreakdown.list.slice(0, 8).map((item) => {
              const pct =
                categoryBreakdown.grand > 0
                  ? Math.round((item.total / categoryBreakdown.grand) * 100)
                  : 0;
              const isSelected = selectedCategory.toLowerCase() === item.category.toLowerCase();
              return (
                <button
                  key={item.category}
                  type="button"
                  onClick={() =>
                    setSelectedCategory(isSelected ? 'All' : item.category)
                  }
                  className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer space-y-2 ${
                    isSelected
                      ? 'border-neutral-900 dark:border-white bg-[#FAFAFA] dark:bg-white/10'
                      : 'border-[#E5E5E5] dark:border-neutral-800 hover:border-neutral-400'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-neutral-900 dark:text-white truncate">{item.category}</span>
                    <span className="font-mono text-[11px] text-neutral-500">{pct}%</span>
                  </div>
                  <div className="text-base font-extrabold font-mono tabular-nums text-neutral-900 dark:text-white">
                    {formatAmount(item.total)}
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                    <div
                      className="h-full bg-neutral-900 dark:bg-white rounded-full"
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Transactions Ledger Table */}
      <div className="flex-1 bg-white dark:bg-neutral-900/90 rounded-3xl overflow-hidden flex flex-col border border-[#E5E5E5] dark:border-neutral-800">
        <div className="p-4 sm:p-5 border-b border-[#E5E5E5] dark:border-neutral-800 flex flex-col md:flex-row gap-3">
          <form onSubmit={handleExecuteSearch} className="flex-1 flex items-center gap-2">
            <div className="relative flex-1">
              <ICONS.Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search merchant, category or notes..."
                className="w-full bg-[#FAFAFA] dark:bg-neutral-800 pl-10 pr-8 py-2.5 rounded-xl border border-[#E5E5E5] dark:border-neutral-700 text-xs font-medium outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 text-xs font-bold cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold rounded-xl cursor-pointer shrink-0"
            >
              Search
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-[#FAFAFA] dark:bg-neutral-800 px-3 py-2.5 rounded-xl border border-[#E5E5E5] dark:border-neutral-700 text-xs font-semibold outline-none"
            >
              <option value="All">All Categories</option>
              {availableCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <select
              value={selectedMethod}
              onChange={(e) => setSelectedMethod(e.target.value)}
              className="bg-[#FAFAFA] dark:bg-neutral-800 px-3 py-2.5 rounded-xl border border-[#E5E5E5] dark:border-neutral-700 text-xs font-semibold outline-none"
            >
              <option value="All">All Methods</option>
              {paymentRegion === 'IN' ? (
                <option value="UPI">UPI</option>
              ) : (
                <option value="PAYPAL">PayPal</option>
              )}
              <option value="CARD">Card</option>
              <option value="CASH">Cash</option>
              <option value="INVOICE">Digital Invoice</option>
              <option value="SCAN_RECEIPT">Receipt Scan</option>
            </select>

            {transactions.length > 0 &&
              (confirmPurgeAll ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      clearAllTransactions();
                      setConfirmPurgeAll(false);
                    }}
                    className="px-3 py-2 bg-rose-600 text-white rounded-xl text-xs font-bold cursor-pointer"
                  >
                    Confirm Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmPurgeAll(false)}
                    className="px-2.5 py-2 bg-neutral-100 dark:bg-neutral-800 border border-[#E5E5E5] rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmPurgeAll(true)}
                  className="px-3 py-2.5 text-neutral-500 hover:text-rose-600 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Clear All
                </button>
              ))}
          </div>
        </div>

        <div className="px-5 py-2.5 bg-[#FAFAFA] dark:bg-neutral-800/40 border-b border-[#E5E5E5] dark:border-neutral-800 flex items-center justify-between text-xs text-neutral-500 font-mono">
          <div>
            <span>Entries: </span>
            <span className="font-bold text-neutral-900 dark:text-white">{filteredTransactions.length}</span>
          </div>
          <div>
            <span>Total: </span>
            <span className="font-bold text-neutral-900 dark:text-white tabular-nums">
              {formatAmount(filteredTotal)}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredTransactions.length > 0 ? (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-white dark:bg-neutral-900 z-10 border-b border-[#E5E5E5] dark:border-neutral-800">
                <tr>
                  <th className="p-4 text-[11px] font-bold text-neutral-400 uppercase tracking-wider pl-6 font-mono">
                    Merchant
                  </th>
                  <th className="p-4 text-[11px] font-bold text-neutral-400 uppercase tracking-wider font-mono">
                    Date
                  </th>
                  <th className="p-4 text-[11px] font-bold text-neutral-400 uppercase tracking-wider font-mono">
                    Category
                  </th>
                  <th className="p-4 text-[11px] font-bold text-neutral-400 uppercase tracking-wider font-mono">
                    Method
                  </th>
                  <th className="p-4 text-[11px] font-bold text-neutral-400 uppercase tracking-wider text-right pr-6 font-mono">
                    Amount
                  </th>
                  <th className="p-4 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F0F0] dark:divide-neutral-800">
                {filteredTransactions.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedTransaction(t)}
                    className="group hover:bg-[#FAFAFA] dark:hover:bg-neutral-800/60 transition-colors cursor-pointer"
                  >
                    <td className="p-4 pl-6">
                      <span className="font-bold text-neutral-900 dark:text-white text-sm block">
                        {t.merchant}
                      </span>
                      {t.notes && (
                        <span className="text-[11px] text-neutral-400 block truncate max-w-xs">{t.notes}</span>
                      )}
                    </td>
                    <td className="p-4 text-xs text-neutral-500 font-mono">{t.date}</td>
                    <td className="p-4">
                      <span className="px-2.5 py-1 rounded-lg bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 text-[11px] font-semibold text-neutral-700 dark:text-neutral-300">
                        {t.category}
                      </span>
                    </td>
                    <td className="p-4 text-[11px] font-mono text-neutral-500">{t.paymentMethod || 'CASH'}</td>
                    <td className="p-4 text-right pr-6 font-bold text-neutral-900 dark:text-white font-mono text-sm tabular-nums">
                      {formatAmount(t.amount)}
                    </td>
                    <td className="p-4">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTransaction(t.id);
                        }}
                        className="p-1.5 text-neutral-300 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100 rounded-lg cursor-pointer"
                        title="Delete record"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-16 px-6 max-w-md mx-auto space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 flex items-center justify-center mx-auto text-neutral-400">
                <ICONS.Receipt className="w-7 h-7" />
              </div>
              <div>
                <h4 className="text-base font-bold text-neutral-900 dark:text-white">No Expenses Recorded Yet</h4>
                <p className="text-xs text-neutral-500 mt-1">
                  Log your daily spends to track spending categories automatically.
                </p>
              </div>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsAddExpenseOpen(true)}
                  className="px-4 py-2 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-xl text-xs font-bold cursor-pointer"
                >
                  + Log First Expense
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('INVOICE');
                    setInvoiceSubView('SCAN_BILL');
                  }}
                  className="px-4 py-2 border border-[#E5E5E5] dark:border-neutral-700 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Scan Bill in Invoices
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedTransaction && (
        <TransactionModal
          transaction={selectedTransaction}
          onClose={() => setSelectedTransaction(null)}
          onUpdate={handleUpdateTransaction}
        />
      )}
    </div>
  );
};

export default Transactions;