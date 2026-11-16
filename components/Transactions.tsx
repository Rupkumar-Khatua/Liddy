import React, { useState, useMemo } from 'react';
import { useFinMind } from '../context/FinMindContext';
import ReceiptScanner from './ReceiptScanner';
import { InvoiceGenerator } from './InvoiceGenerator';
import { InvoicesHub } from './InvoicesHub';
import TransactionModal from './TransactionModal';
import { ICONS } from '../constants';
import { Transaction } from '../types';

type ActiveTab = 'LIST' | 'SCAN' | 'INVOICE';

interface TransactionsProps {
  initialTab?: ActiveTab;
}

const Transactions: React.FC<TransactionsProps> = ({ initialTab = 'LIST' }) => {
  const { 
    transactions, 
    addTransaction, 
    updateTransaction, 
    deleteTransaction, 
    clearAllTransactions,
    formatAmount,
  } = useFinMind();

  const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);
  const [invoiceSubView, setInvoiceSubView] = useState<'HUB' | 'CREATE'>('HUB');
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  React.useEffect(() => {
    setActiveTab(initialTab);
    if (initialTab === 'INVOICE') {
      setInvoiceSubView('HUB');
    }
  }, [initialTab]);

  // Search and Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedMethod, setSelectedMethod] = useState('All');
  const [confirmPurgeAll, setConfirmPurgeAll] = useState(false);

  const handleSaveReceipt = (data: Partial<Transaction>) => {
    if (data.merchant && typeof data.amount === 'number') {
      addTransaction({
        merchant: data.merchant,
        amount: data.amount,
        category: data.category || 'General',
        date: data.date || new Date().toISOString().split('T')[0],
        paymentMethod: data.paymentMethod || 'SCAN_RECEIPT',
        upiReference: data.upiReference,
        notes: data.notes
      });
      setActiveTab('LIST');
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

  // Filtered transactions (Real-time strictly verified)
  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      // Category filter
      if (selectedCategory !== 'All' && t.category.toLowerCase() !== selectedCategory.toLowerCase()) {
        return false;
      }
      // Payment method filter
      if (selectedMethod !== 'All' && t.paymentMethod !== selectedMethod) {
        return false;
      }
      // Text search query
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

  // Unique categories list
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    transactions.forEach(t => {
      if (t.category) set.add(t.category);
    });
    return Array.from(set);
  }, [transactions]);

  // Total calculated strictly from filtered set
  const filteredTotal = useMemo(() => {
    return filteredTransactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  }, [filteredTransactions]);

  if (activeTab === 'SCAN') {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-400 font-semibold">
              Instant Receipt Capture
            </p>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 dark:text-white tracking-tight">
              Snap Receipts, Auto-Log Expenses
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('LIST')}
              className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900 cursor-pointer"
            >
              View Ledger ({transactions.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('INVOICE')}
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
            >
              Switch to Invoices
            </button>
          </div>
        </div>
        <ReceiptScanner
          onSave={handleSaveReceipt}
          onCancel={() => setActiveTab('LIST')}
        />
      </div>
    );
  }

  if (activeTab === 'INVOICE') {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-400 font-semibold">
              Get Paid Faster
            </p>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-neutral-900 dark:text-white tracking-tight">
              {invoiceSubView === 'CREATE'
                ? 'Create Client Invoice & UPI QR'
                : 'Client Invoices & Pending Settlements'}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {invoiceSubView === 'CREATE' ? (
              <button
                type="button"
                onClick={() => setInvoiceSubView('HUB')}
                className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900 cursor-pointer whitespace-nowrap shrink-0"
              >
                &larr; Saved Invoices
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setInvoiceSubView('CREATE')}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
              >
                + New Invoice
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('LIST')}
              className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900 cursor-pointer whitespace-nowrap shrink-0"
            >
              Expense Ledger
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('SCAN')}
              className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900 cursor-pointer whitespace-nowrap shrink-0"
            >
              Scan Receipt
            </button>
          </div>
        </div>
        {invoiceSubView === 'CREATE' ? (
          <InvoiceGenerator
            onSaved={() => setInvoiceSubView('HUB')}
            onCancel={() => setInvoiceSubView('HUB')}
          />
        ) : (
          <InvoicesHub onCreateNew={() => setInvoiceSubView('CREATE')} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-2 h-full flex flex-col relative animate-enter">
      {/* Top Header with Tab Switcher & Actions */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-400 font-semibold">
            Cashflow &amp; Tax Ledger
          </p>
          <h1 className="text-3xl font-extrabold text-neutral-900 dark:text-white tracking-tight mt-0.5">
            Receipts, Expenses &amp; Client Bills
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Every receipt scanned and invoice issued syncs automatically across your workspace.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setActiveTab('SCAN')}
            className="bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 active:scale-95 cursor-pointer"
          >
            <ICONS.Receipt className="w-4 h-4" />
            <span>Scan Receipt</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('INVOICE')}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 active:scale-95 cursor-pointer"
          >
            <span>+ Create Client Invoice</span>
          </button>
        </div>
      </header>

      {/* Main Transactions Container */}
      <div className="flex-1 glass-card dark:bg-neutral-900/80 dark:border-neutral-800 rounded-[32px] overflow-hidden flex flex-col border border-white/70 shadow-xs">
        {/* Search, Button & Filters Toolbar */}
        <div className="p-5 border-b border-neutral-100 dark:border-neutral-800 flex flex-col md:flex-row gap-3 bg-white/40 dark:bg-neutral-800/40">
          <form onSubmit={handleExecuteSearch} className="flex-1 flex items-center gap-2">
            <div className="relative flex-1">
              <ICONS.Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by merchant, category, amount or notes..." 
                className="w-full bg-neutral-50 dark:bg-neutral-800 hover:bg-neutral-100/60 focus:bg-white dark:focus:bg-neutral-900 pl-10 pr-8 py-2.5 rounded-xl border border-neutral-200/80 dark:border-neutral-700 focus:ring-2 focus:ring-indigo-500 text-xs font-medium outline-none transition-all text-neutral-900 dark:text-white" 
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Explicit Search Button as Requested */}
            <button
              type="submit"
              className="px-5 py-2.5 bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 shrink-0 active:scale-95"
            >
              <ICONS.Search className="w-3.5 h-3.5" />
              <span>Search</span>
            </button>
          </form>

          <div className="flex items-center gap-2">
            <select 
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-neutral-50 dark:bg-neutral-800 px-3.5 py-2.5 rounded-xl border border-neutral-200/80 dark:border-neutral-700 text-xs font-bold text-neutral-700 dark:text-neutral-300 focus:ring-0 outline-none"
            >
              <option value="All">All Categories</option>
              {availableCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>

            <select 
              value={selectedMethod}
              onChange={(e) => setSelectedMethod(e.target.value)}
              className="bg-neutral-50 dark:bg-neutral-800 px-3.5 py-2.5 rounded-xl border border-neutral-200/80 dark:border-neutral-700 text-xs font-bold text-neutral-700 dark:text-neutral-300 focus:ring-0 outline-none"
            >
              <option value="All">All Methods</option>
              <option value="UPI">UPI</option>
              <option value="CARD">Card</option>
              <option value="CASH">Cash</option>
              <option value="INVOICE">Digital Invoice</option>
              <option value="SCAN_RECEIPT">Receipt Scan</option>
            </select>

            {transactions.length > 0 && (
              confirmPurgeAll ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      clearAllTransactions();
                      setConfirmPurgeAll(false);
                    }}
                    className="px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold cursor-pointer"
                  >
                    Confirm Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmPurgeAll(false)}
                    className="px-2.5 py-2 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmPurgeAll(true)}
                  className="px-3 py-2.5 text-neutral-500 hover:text-red-600 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200/80 dark:border-neutral-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  title="Reset all records to zero"
                >
                  Purge All
                </button>
              )
            )}
          </div>
        </div>

        {/* Live Filter Summary Header */}
        <div className="px-6 py-2.5 bg-neutral-50/70 dark:bg-neutral-800/40 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 font-mono">
          <div>
            <span>Recorded entries: </span>
            <span className="font-bold text-neutral-900 dark:text-white">{filteredTransactions.length}</span>
            {appliedSearch && <span> (filtered by "{appliedSearch}")</span>}
          </div>
          <div>
            <span>Total: </span>
            <span className="font-bold text-neutral-900 dark:text-white font-mono tabular-nums">
              {formatAmount(filteredTotal)}
            </span>
          </div>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-y-auto p-2">
          {filteredTransactions.length > 0 ? (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-sm z-10">
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className="p-4 text-xs font-bold text-neutral-400 uppercase tracking-wider pl-6 font-mono">Merchant / Recipient</th>
                  <th className="p-4 text-xs font-bold text-neutral-400 uppercase tracking-wider font-mono">Date</th>
                  <th className="p-4 text-xs font-bold text-neutral-400 uppercase tracking-wider font-mono">Category</th>
                  <th className="p-4 text-xs font-bold text-neutral-400 uppercase tracking-wider font-mono">Method</th>
                  <th className="p-4 text-xs font-bold text-neutral-400 uppercase tracking-wider text-right pr-6 font-mono">Amount</th>
                  <th className="p-4 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50 dark:divide-neutral-800">
                {filteredTransactions.map((t) => (
                  <tr 
                    key={t.id} 
                    onClick={() => setSelectedTransaction(t)}
                    className="group hover:bg-neutral-50/80 dark:hover:bg-neutral-800/60 transition-colors cursor-pointer"
                  >
                    <td className="p-4 pl-6">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-sm font-bold text-neutral-700 dark:text-neutral-200">
                          {t.merchant.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span className="font-bold text-neutral-900 dark:text-white text-sm block">{t.merchant}</span>
                          {t.notes && <span className="text-[11px] text-neutral-400 block truncate max-w-xs">{t.notes}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-xs text-neutral-500 dark:text-neutral-400 font-medium font-mono">{t.date}</td>
                    <td className="p-4">
                      <span className="px-3 py-1 rounded-full bg-white dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700 text-[11px] font-bold text-neutral-600 dark:text-neutral-300 shadow-2xs">
                        {t.category}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold tracking-wider ${
                        t.paymentMethod === 'UPI' ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300' :
                        t.paymentMethod === 'INVOICE' ? 'bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300' :
                        'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                      }`}>
                        {t.paymentMethod || 'VERIFIED'}
                      </span>
                    </td>
                    <td className="p-4 text-right pr-6 font-bold text-neutral-900 dark:text-white font-mono text-sm tabular-nums">
                      {formatAmount(t.amount)}
                    </td>
                    <td className="p-4">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTransaction(t.id);
                        }}
                        className="p-1.5 text-neutral-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        title="Delete record"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-20 px-6 max-w-md mx-auto space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200/80 dark:border-neutral-700 flex items-center justify-center mx-auto text-neutral-400">
                <ICONS.Receipt className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-neutral-900 dark:text-white">No Expenses Recorded Yet</h4>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 leading-relaxed">
                  Snap any paper or PDF receipt to log daily expenses automatically or issue your first invoice.
                </p>
              </div>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('SCAN')}
                  className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
                >
                  Scan Receipt
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('INVOICE')}
                  className="px-4 py-2 bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-xl text-xs font-bold hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-all cursor-pointer"
                >
                  Create Client Invoice
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