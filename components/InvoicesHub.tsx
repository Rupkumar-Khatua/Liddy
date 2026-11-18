import React, { useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Invoice, InvoicePaperFormat, InvoiceTemplateStyle } from '../types';
import { useFinMind } from '../context/FinMindContext';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import { UPIPaymentModal } from './UPIPaymentModal';
import {
  buildPrintableInvoiceHtml,
  PAPER_FORMAT_SPECS,
  printFormattedInvoiceViaIframe,
} from '../utils/invoicePrint';
import { triggerFileDownload } from '../services/emailReceiptService';

interface InvoicesHubProps {
  onCreateNew: () => void;
  onScanPaperBill?: () => void;
}

type StatusFilter = 'ALL' | 'UNPAID' | 'PAID';

export const InvoicesHub: React.FC<InvoicesHubProps> = ({ onCreateNew, onScanPaperBill }) => {
  const { invoices, markInvoicePaid, deleteInvoice, formatAmount, payoutConfig, paymentRegion } = useFinMind();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<{
    inv: Invoice;
    previewMode: boolean;
  } | null>(null);
  const [upiTargetInvoice, setUpiTargetInvoice] = useState<Invoice | null>(null);
  const defaultPaperFormat: InvoicePaperFormat = 'a4';
  const defaultTemplateStyle: InvoiceTemplateStyle = 'swiss';

  const metrics = useMemo(() => {
    const unpaid = invoices.filter((inv) => inv.paymentStatus !== 'paid');
    const paid = invoices.filter((inv) => inv.paymentStatus === 'paid');
    return {
      pendingCount: unpaid.length,
      pendingTotal: unpaid.reduce((s, i) => s + (Number(i.grandTotal) || 0), 0),
      settledCount: paid.length,
      settledTotal: paid.reduce((s, i) => s + (Number(i.grandTotal) || 0), 0),
    };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (statusFilter === 'UNPAID' && inv.paymentStatus === 'paid') return false;
      if (statusFilter === 'PAID' && inv.paymentStatus !== 'paid') return false;
      if (q) {
        const hay = `${inv.invoiceNumber} ${inv.clientName} ${inv.senderName} ${inv.notes || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [invoices, statusFilter, searchQuery]);

  const isOverdue = (inv: Invoice): boolean => {
    if (inv.paymentStatus === 'paid' || !inv.dueDate) return false;
    const todayStr = new Date().toISOString().split('T')[0];
    return inv.dueDate < todayStr;
  };

  const handleQuickPdfExport = async (inv: Invoice) => {
    let qr = '';
    try {
      if (paymentRegion === 'IN') {
        const activeUpi = inv.upiId?.trim() || payoutConfig.upiId?.trim() || '';
        if (activeUpi) {
          const activePayee = inv.payeeName?.trim() || inv.senderName?.trim() || payoutConfig.payeeName || 'Billing Desk';
          const uri = `upi://pay?pa=${encodeURIComponent(activeUpi)}&pn=${encodeURIComponent(activePayee)}&am=${(Number(inv.grandTotal) || 0).toFixed(2)}&tn=${encodeURIComponent(inv.invoiceNumber)}&cu=INR`;
          qr = await QRCode.toDataURL(uri, { width: 160, margin: 1 });
        }
      }
    } catch {}

    const html = buildPrintableInvoiceHtml(
      inv,
      qr,
      inv.templateStyle || defaultTemplateStyle,
      inv.paperFormat || defaultPaperFormat,
      paymentRegion
    );
    printFormattedInvoiceViaIframe(html);
  };

  const handleExportRegisterCsv = () => {
    const headers = ['Invoice Number', 'Date', 'Due Date', 'Sender', 'Client', 'Status', 'Currency', 'Subtotal', 'Tax', 'Grand Total'];
    const escapeCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = filteredInvoices.map((i) =>
      [
        i.invoiceNumber,
        i.date,
        i.dueDate || '',
        i.senderName,
        i.clientName,
        i.paymentStatus,
        i.currency || '₹',
        i.subtotal,
        i.taxTotal,
        i.grandTotal,
      ]
        .map(escapeCell)
        .join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    triggerFileDownload(csv, `liddy-invoices-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
  };

  return (
    <div className="space-y-6 animate-enter">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-neutral-900/80 border border-neutral-200/80 dark:border-neutral-800 rounded-2xl p-5">
          <p className="text-xs font-mono uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Pending Bills
          </p>
          <p className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1.5">
            {formatAmount(metrics.pendingTotal)}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            {metrics.pendingCount} {metrics.pendingCount === 1 ? 'invoice' : 'invoices'} awaiting payment
          </p>
        </div>

        <div className="bg-white dark:bg-neutral-900/80 border border-neutral-200/80 dark:border-neutral-800 rounded-2xl p-5">
          <p className="text-xs font-mono uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Settled &amp; Paid
          </p>
          <p className="text-2xl sm:text-3xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1.5">
            {formatAmount(metrics.settledTotal)}
          </p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            {metrics.settledCount} {metrics.settledCount === 1 ? 'invoice' : 'invoices'} recorded
          </p>
        </div>

        <div className="bg-neutral-950 text-white border border-neutral-800 rounded-2xl p-5 flex flex-col justify-between gap-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-neutral-400">Swiss Digital Studio</p>
            <p className="text-sm text-neutral-200 mt-1">
              Build crisp bills or convert paper receipts into digital templates.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onCreateNew}
              className="py-2.5 px-3 rounded-xl bg-white text-neutral-950 hover:bg-neutral-100 text-xs font-bold cursor-pointer transition-colors whitespace-nowrap"
            >
              + New Invoice
            </button>
            {onScanPaperBill && (
              <button
                type="button"
                onClick={onScanPaperBill}
                className="py-2.5 px-3 rounded-xl border border-white/25 hover:bg-white/10 text-white text-xs font-bold cursor-pointer transition-colors whitespace-nowrap"
              >
                Scan Paper Bill
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Filter & Register Container */}
      <div className="bg-white dark:bg-neutral-900/80 border border-neutral-200/80 dark:border-neutral-800 rounded-[28px] overflow-hidden">
        <div className="p-5 border-b border-neutral-100 dark:border-neutral-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-800 self-start">
            {([
              { id: 'ALL', label: `All (${invoices.length})` },
              { id: 'UNPAID', label: `Pending (${metrics.pendingCount})` },
              { id: 'PAID', label: `Paid (${metrics.settledCount})` },
            ] as Array<{ id: StatusFilter; label: string }>).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap transition-colors ${
                  statusFilter === tab.id
                    ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-white shadow-2xs'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search invoice #, recipient or notes..."
              className="flex-1 md:w-64 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200/80 dark:border-neutral-700 rounded-xl px-3.5 py-2 text-xs text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {filteredInvoices.length > 0 && (
              <button
                type="button"
                onClick={handleExportRegisterCsv}
                className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
              >
                Export .CSV
              </button>
            )}
          </div>
        </div>

        {filteredInvoices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[780px]">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800 text-[11px] font-mono uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  <th className="py-3.5 px-5">Invoice &amp; Recipient</th>
                  <th className="py-3.5 px-4">Issued / Due</th>
                  <th className="py-3.5 px-4">Format</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Amount</th>
                  <th className="py-3.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800 text-xs">
                {filteredInvoices.map((inv) => {
                  const paid = inv.paymentStatus === 'paid';
                  const overdue = isOverdue(inv);
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => setSelectedInvoice({ inv, previewMode: false })}
                      className="hover:bg-neutral-50/80 dark:hover:bg-neutral-800/50 transition-colors cursor-pointer"
                    >
                      <td className="py-4 px-5">
                        <p className="font-bold text-sm text-neutral-900 dark:text-white">
                          {inv.clientName || 'Walk-in Client'}
                        </p>
                        <p className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400 mt-0.5">
                          {inv.invoiceNumber} · {inv.industry}
                        </p>
                      </td>
                      <td className="py-4 px-4 font-mono text-neutral-600 dark:text-neutral-300">
                        <div>{inv.date}</div>
                        {inv.dueDate && <div className="text-[11px] text-neutral-400">Due {inv.dueDate}</div>}
                      </td>
                      <td className="py-4 px-4 font-mono text-neutral-500">
                        {PAPER_FORMAT_SPECS[inv.paperFormat || defaultPaperFormat].badge} ·{' '}
                        {inv.templateStyle || defaultTemplateStyle}
                      </td>
                      <td className="py-4 px-4">
                        <span
                          className={`font-mono font-bold text-xs ${
                            paid
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : overdue
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {paid ? 'Paid' : overdue ? 'Overdue' : 'Pending'}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right font-mono font-extrabold text-sm tabular-nums text-neutral-900 dark:text-white">
                        {formatAmount(Number(inv.grandTotal) || 0)}
                      </td>
                      <td className="py-4 px-5 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedInvoice({ inv, previewMode: true })}
                            className="px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold cursor-pointer whitespace-nowrap"
                          >
                            Preview
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickPdfExport(inv)}
                            className="px-2.5 py-1.5 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer whitespace-nowrap"
                          >
                            Download PDF
                          </button>
                          {!paid && (
                            paymentRegion === 'IN' ? (
                              <button
                                type="button"
                                onClick={() => setUpiTargetInvoice(inv)}
                                className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
                              >
                                Pay UPI
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setSelectedInvoice({ inv, previewMode: false })}
                                className="px-2.5 py-1.5 rounded-lg bg-[#003087] hover:bg-[#002569] text-white text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
                              >
                                PayPal
                              </button>
                            )
                          )}
                          <button
                            type="button"
                            onClick={() => deleteInvoice(inv.id)}
                            aria-label={`Delete invoice ${inv.invoiceNumber}`}
                            className="px-2 py-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-16 px-6 max-w-md mx-auto space-y-3">
            <h3 className="text-base font-bold text-neutral-900 dark:text-white">
              {invoices.length === 0 ? 'No Invoices Created Yet' : 'No Matching Invoices'}
            </h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
              {invoices.length === 0
                ? paymentRegion === 'IN'
                  ? 'Build itemized A4, Letter or 80mm POS invoices with embedded UPI QR and one-click PDF export.'
                  : 'Build itemized A4, Letter or 80mm POS invoices with PayPal settlement and one-click PDF export.'
                : 'Try clearing your filter or search query to inspect other bills.'}
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={onCreateNew}
                className="px-5 py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-950 text-xs font-bold cursor-pointer"
              >
                + Create First Invoice
              </button>
            </div>
          </div>
        )}
      </div>

      <InvoiceDetailModal
        invoice={selectedInvoice?.inv || null}
        initialPreviewMode={Boolean(selectedInvoice?.previewMode)}
        onClose={() => setSelectedInvoice(null)}
      />

      {paymentRegion === 'IN' && upiTargetInvoice && (
        <UPIPaymentModal
          isOpen={Boolean(upiTargetInvoice)}
          onClose={() => setUpiTargetInvoice(null)}
          amount={Number(upiTargetInvoice.grandTotal) || 0}
          currency={upiTargetInvoice.currency || '₹'}
          defaultUpiId={upiTargetInvoice.upiId || payoutConfig.upiId || ''}
          defaultPayeeName={upiTargetInvoice.payeeName || upiTargetInvoice.senderName || payoutConfig.payeeName || 'Billing Desk'}
          invoiceNumber={upiTargetInvoice.invoiceNumber}
          onPaymentSuccess={(method, upiRef) => {
            markInvoicePaid(upiTargetInvoice.id, method, upiRef);
            setUpiTargetInvoice(null);
          }}
        />
      )}
    </div>
  );
};

export default InvoicesHub;
