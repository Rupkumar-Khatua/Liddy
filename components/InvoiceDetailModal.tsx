import React, { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { Invoice, InvoicePaperFormat, InvoiceTemplateStyle } from '../types';
import { useFinMind } from '../context/FinMindContext';
import { UPIPaymentModal } from './UPIPaymentModal';
import {
  buildPrintableInvoiceHtml,
  PAPER_FORMAT_SPECS,
  printFormattedInvoiceViaIframe,
  TEMPLATE_LABELS,
} from '../utils/invoicePrint';
import {
  connectGmailForReceipts,
  getGmailAccessToken,
  getGmailTokenEmail,
  hasGmailAccessToken,
} from '../firebase';
import {
  dispatchInvoiceViaGmailApi,
  generateEmailReceiptPayload,
  triggerFileDownload,
} from '../services/emailReceiptService';

interface InvoiceDetailModalProps {
  invoice: Invoice | null;
  onClose: () => void;
  initialPreviewMode?: boolean;
}

export const InvoiceDetailModal: React.FC<InvoiceDetailModalProps> = ({
  invoice,
  onClose,
  initialPreviewMode = false,
}) => {
  const { markInvoicePaid, deleteInvoice, updateInvoice, payoutConfig } = useFinMind();
  const [qrUrl, setQrUrl] = useState<string>('');
  const [copiedUri, setCopiedUri] = useState(false);
  const [isUpiOpen, setIsUpiOpen] = useState(false);
  const [showManualSettle, setShowManualSettle] = useState(false);
  const [manualMethod, setManualMethod] = useState<'UPI' | 'CARD' | 'CASH'>('UPI');
  const [manualRef, setManualRef] = useState('');

  // Preview & Print Format Controls
  const [isPreviewMode, setIsPreviewMode] = useState(initialPreviewMode);
  const [previewTemplate, setPreviewTemplate] = useState<InvoiceTemplateStyle>('classic');
  const [previewPaper, setPreviewPaper] = useState<InvoicePaperFormat>('a4');

  // Gmail / Email Delivery State
  const [recipientEmail, setRecipientEmail] = useState('');
  const [gmailConnected, setGmailConnected] = useState(hasGmailAccessToken());
  const [gmailSender, setGmailSender] = useState(getGmailTokenEmail() || '');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    if (!invoice) return;
    setShowManualSettle(false);
    setManualRef('');
    setCopiedUri(false);
    setIsPreviewMode(initialPreviewMode);
    setPreviewTemplate(invoice.templateStyle || 'classic');
    setPreviewPaper(invoice.paperFormat || 'a4');
    setRecipientEmail(invoice.clientEmail || '');
    setEmailStatus(null);
    setEmailError(null);
    setGmailConnected(hasGmailAccessToken());
    setGmailSender(getGmailTokenEmail() || '');

    const activeUpi = invoice.upiId?.trim() || payoutConfig.upiId?.trim() || '';
    if (!activeUpi) {
      setQrUrl('');
      return;
    }
    const activePayee = invoice.payeeName?.trim() || invoice.senderName?.trim() || payoutConfig.payeeName || 'Billing Desk';
    const uri = `upi://pay?pa=${encodeURIComponent(activeUpi)}&pn=${encodeURIComponent(activePayee)}&am=${(Number(invoice.grandTotal) || 0).toFixed(2)}&tn=${encodeURIComponent(invoice.invoiceNumber)}&cu=INR`;

    QRCode.toDataURL(uri, { width: 180, margin: 1 })
      .then((url) => setQrUrl(url))
      .catch(() => setQrUrl(''));
  }, [invoice, initialPreviewMode, payoutConfig.upiId, payoutConfig.payeeName]);

  useEffect(() => {
    if (!invoice) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [invoice]);

  const printableHtml = useMemo(() => {
    if (!invoice) return '';
    return buildPrintableInvoiceHtml(invoice, qrUrl, previewTemplate, previewPaper);
  }, [invoice, qrUrl, previewTemplate, previewPaper]);

  if (!invoice) return null;

  const isPaid = invoice.paymentStatus === 'paid';
  const isOverdue =
    !isPaid &&
    Boolean(invoice.dueDate) &&
    new Date(invoice.dueDate!).getTime() < new Date(new Date().toISOString().split('T')[0]).getTime();

  const cur = invoice.currency || '₹';
  const resolvedUpiId = invoice.upiId?.trim() || payoutConfig.upiId?.trim() || '';
  const resolvedPayee = invoice.payeeName?.trim() || invoice.senderName?.trim() || payoutConfig.payeeName || 'Billing Desk';
  const upiLink = resolvedUpiId
    ? `upi://pay?pa=${encodeURIComponent(resolvedUpiId)}&pn=${encodeURIComponent(resolvedPayee)}&am=${(Number(invoice.grandTotal) || 0).toFixed(2)}&tn=${encodeURIComponent(invoice.invoiceNumber)}&cu=INR`
    : '';

  const handleCopyUpiLink = () => {
    navigator.clipboard.writeText(upiLink).catch(() => {});
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 2000);
  };

  const handleConfirmManualSettle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualRef.trim() && manualMethod !== 'CASH') {
      setEmailError('Enter a payment reference number to confirm settlement.');
      return;
    }
    markInvoicePaid(invoice.id, manualMethod, manualRef.trim() || undefined);
    setShowManualSettle(false);
    onClose();
  };

  const handleDelete = () => {
    deleteInvoice(invoice.id);
    onClose();
  };

  const handleFormatPersist = (tpl: InvoiceTemplateStyle, paper: InvoicePaperFormat) => {
    setPreviewTemplate(tpl);
    setPreviewPaper(paper);
    updateInvoice(invoice.id, { templateStyle: tpl, paperFormat: paper });
  };

  const handleDownloadPdfPrint = () => {
    printFormattedInvoiceViaIframe(printableHtml);
  };

  const handleDownloadHtml = () => {
    const safeNum = (invoice.invoiceNumber || 'invoice').replace(/[^a-zA-Z0-9_-]/g, '-');
    triggerFileDownload(printableHtml, `${safeNum}-${previewPaper}.html`, 'text/html');
  };

  const handleDownloadEml = async () => {
    setEmailError(null);
    const targetEmail = recipientEmail.trim() || 'client@example.com';
    try {
      const payload = await generateEmailReceiptPayload({
        recipientEmail: targetEmail,
        buyerName: invoice.clientName,
        referenceCode: invoice.invoiceNumber,
        invoiceNumber: invoice.invoiceNumber,
        date: invoice.date,
        items: (invoice.items || []).map((i) => ({
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          total: i.total,
        })),
        subtotal: invoice.subtotal,
        taxTotal: invoice.taxTotal,
        discountTotal: invoice.discountTotal,
        grandTotal: invoice.grandTotal,
        currency: invoice.currency || '₹',
        paymentRail: isPaid ? 'SETTLED' : 'INVOICE_DUE',
        senderName: invoice.senderName,
        senderTaxId: invoice.senderTaxId,
        clientTaxId: invoice.clientTaxId,
        notes: invoice.notes,
      });
      const safeNum = (invoice.invoiceNumber || 'invoice').replace(/[^a-zA-Z0-9_-]/g, '-');
      triggerFileDownload(payload.emlContent, `${safeNum}.eml`, 'message/rfc822');
      setEmailStatus(`Downloaded email draft (${safeNum}.eml).`);
    } catch (err: any) {
      setEmailError(err?.message || 'Could not generate .eml invoice.');
    }
  };

  const handleSendViaGmail = async () => {
    setEmailError(null);
    setEmailStatus(null);
    const cleanTo = recipientEmail.trim();
    if (!cleanTo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanTo)) {
      setEmailError('Enter a valid recipient email address first.');
      return;
    }

    let token = getGmailAccessToken();
    let sender = gmailSender;
    if (!token) {
      try {
        const res = await connectGmailForReceipts();
        token = res.accessToken;
        sender = res.email;
        setGmailConnected(true);
        setGmailSender(res.email);
      } catch (err: any) {
        setEmailError(err?.message || 'Google authorization was cancelled.');
        return;
      }
    }

    setSendingEmail(true);
    try {
      const payload = await generateEmailReceiptPayload({
        recipientEmail: cleanTo,
        buyerName: invoice.clientName,
        referenceCode: invoice.invoiceNumber,
        invoiceNumber: invoice.invoiceNumber,
        date: invoice.date,
        items: (invoice.items || []).map((i) => ({
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          total: i.total,
        })),
        subtotal: invoice.subtotal,
        taxTotal: invoice.taxTotal,
        discountTotal: invoice.discountTotal,
        grandTotal: invoice.grandTotal,
        currency: invoice.currency || '₹',
        paymentRail: isPaid ? 'SETTLED' : 'INVOICE_DUE',
        senderName: invoice.senderName,
        senderTaxId: invoice.senderTaxId,
        clientTaxId: invoice.clientTaxId,
        notes: invoice.notes,
      });
      await dispatchInvoiceViaGmailApi({
        accessToken: token,
        senderEmail: sender || 'me',
        recipientEmail: cleanTo,
        subject: payload.subject,
        htmlBody: payload.htmlBody,
      });
      setEmailStatus(`Invoice sent cleanly to ${cleanTo} via Gmail.`);
    } catch (err: any) {
      setEmailError(err?.message || 'Could not send via Gmail right now. Download the email draft file instead.');
    } finally {
      setSendingEmail(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[9990] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto animate-enter"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#121216] border border-neutral-200 dark:border-neutral-800 rounded-[28px] max-w-4xl w-full p-6 sm:p-8 shadow-2xl text-neutral-900 dark:text-neutral-100 my-auto space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-neutral-200/80 dark:border-neutral-800">
          <div className="space-y-1">
            <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
              {invoice.industry} · Invoice #{invoice.invoiceNumber}
            </p>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-900 dark:text-white">
              {invoice.clientName}
            </h2>
            <p
              className={`text-xs font-mono font-semibold ${
                isPaid
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : isOverdue
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {isPaid
                ? `Settled · Paid on ${invoice.paidAt ? new Date(invoice.paidAt).toLocaleDateString() : invoice.date}`
                : isOverdue
                ? `Overdue · Due ${invoice.dueDate}`
                : `Pending Payment · Due ${invoice.dueDate || 'Upon Receipt'}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsPreviewMode((p) => !p)}
              className={`px-3.5 py-2 rounded-xl border text-xs font-bold cursor-pointer whitespace-nowrap ${
                isPreviewMode
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 border-neutral-900 dark:border-white'
                  : 'border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              {isPreviewMode ? 'Edit / Details View' : 'Preview PDF Layout'}
            </button>
            <button
              type="button"
              onClick={handleDownloadPdfPrint}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              Export PDF ({PAPER_FORMAT_SPECS[previewPaper].badge})
            </button>
            <button
              type="button"
              onClick={handleDownloadHtml}
              className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              Save .HTML
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close invoice details"
              className="w-9 h-9 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 flex items-center justify-center text-xs font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Design Template & Print Paper Format Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900/70 border border-neutral-200/70 dark:border-neutral-800">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
              Invoice Design Theme
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(TEMPLATE_LABELS) as InvoiceTemplateStyle[]).map((tpl) => (
                <button
                  key={tpl}
                  type="button"
                  onClick={() => handleFormatPersist(tpl, previewPaper)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    previewTemplate === tpl
                      ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950'
                      : 'bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  {TEMPLATE_LABELS[tpl].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
              Print / Export Paper Size
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(PAPER_FORMAT_SPECS) as InvoicePaperFormat[]).map((pf) => (
                <button
                  key={pf}
                  type="button"
                  onClick={() => handleFormatPersist(previewTemplate, pf)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                    previewPaper === pf
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  {PAPER_FORMAT_SPECS[pf].badge}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live PDF / Paper Format Preview Overlay View */}
        {isPreviewMode ? (
          <div className="rounded-2xl bg-neutral-200/80 dark:bg-neutral-950 p-4 sm:p-6 border border-neutral-300 dark:border-neutral-800 overflow-x-auto">
            <div className="mx-auto transition-all duration-200" style={{ maxWidth: `${PAPER_FORMAT_SPECS[previewPaper].widthPx}px` }}>
              <iframe
                title={`Invoice Preview ${invoice.invoiceNumber}`}
                srcDoc={printableHtml}
                className="w-full bg-white rounded-xl shadow-lg border border-neutral-300"
                style={{ height: previewPaper === 'thermal80' ? '480px' : '540px' }}
              />
            </div>
          </div>
        ) : (
          <>
            {/* Parties & Date Metadata */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 text-xs">
              <div className="space-y-1">
                <p className="font-mono uppercase tracking-wider text-neutral-400 text-[10px]">From (Issuer)</p>
                <p className="font-bold text-sm text-neutral-900 dark:text-white">{invoice.senderName || 'Self / Merchant'}</p>
                {invoice.senderTaxId && (
                  <p className="font-mono text-[11px] text-neutral-500">Tax ID: {invoice.senderTaxId}</p>
                )}
                {invoice.senderDetails && (
                  <p className="text-neutral-600 dark:text-neutral-300 whitespace-pre-line leading-relaxed">
                    {invoice.senderDetails}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <p className="font-mono uppercase tracking-wider text-neutral-400 text-[10px]">Billed To (Client)</p>
                <p className="font-bold text-sm text-neutral-900 dark:text-white">{invoice.clientName}</p>
                {invoice.clientEmail && (
                  <p className="font-mono text-[11px] text-neutral-500">{invoice.clientEmail}</p>
                )}
                {invoice.clientTaxId && (
                  <p className="font-mono text-[11px] text-neutral-500">Tax ID: {invoice.clientTaxId}</p>
                )}
                {invoice.clientDetails && (
                  <p className="text-neutral-600 dark:text-neutral-300 whitespace-pre-line leading-relaxed">
                    {invoice.clientDetails}
                  </p>
                )}
              </div>

              <div className="space-y-2 font-mono">
                <div className="flex justify-between sm:block">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-400 block">Issued</span>
                  <span className="font-semibold text-neutral-900 dark:text-white">{invoice.date}</span>
                </div>
                <div className="flex justify-between sm:block">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-400 block">Due Date</span>
                  <span className="font-semibold text-neutral-900 dark:text-white">{invoice.dueDate || 'On Receipt'}</span>
                </div>
              </div>
            </div>

            {/* Itemized Line Items */}
            <div className="border border-neutral-200/80 dark:border-neutral-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-neutral-50 dark:bg-neutral-900/90 border-b border-neutral-200/80 dark:border-neutral-800 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="py-2.5 px-4">Item / Service</th>
                      <th className="py-2.5 px-3 text-right">Qty</th>
                      <th className="py-2.5 px-3 text-right">Rate</th>
                      <th className="py-2.5 px-3 text-right">Disc</th>
                      <th className="py-2.5 px-3 text-right">Tax</th>
                      <th className="py-2.5 px-4 text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80">
                    {(invoice.items || []).map((item, idx) => (
                      <tr key={item.id || idx}>
                        <td className="py-3 px-4 font-medium text-neutral-900 dark:text-white">
                          {item.description || 'Service Item'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">{item.quantity}</td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          {(Number(item.unitPrice) || 0).toFixed(2)} {cur}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-neutral-500">
                          {item.discountPercent || 0}%
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-neutral-500">
                          {item.taxPercent || 0}%
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold tabular-nums text-neutral-900 dark:text-white">
                          {(Number(item.total) || 0).toFixed(2)} {cur}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Totals + Dynamic UPI QR */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start pt-1">
              <div className="p-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/60 flex items-center gap-4">
                <div className="p-2 bg-white rounded-xl border border-neutral-200 shrink-0">
                  {qrUrl ? (
                    <img src={qrUrl} alt={`UPI QR for ${invoice.invoiceNumber}`} className="w-24 h-24 object-contain" />
                  ) : (
                    <div className="w-24 h-24 flex items-center justify-center text-[10px] text-neutral-400 font-mono">QR</div>
                  )}
                </div>
                <div className="space-y-1.5 text-xs min-w-0">
                  <p className="font-bold text-neutral-900 dark:text-white">Payment Receiver Details</p>
                  <p className="font-mono text-[11px] text-neutral-600 dark:text-neutral-300 truncate">
                    UPI ID: {resolvedUpiId || 'Not configured in Settings'}
                  </p>
                  <p className="text-[11px] text-neutral-500 truncate">
                    Payee: {resolvedPayee}
                  </p>
                  {upiLink && (
                    <button
                      type="button"
                      onClick={handleCopyUpiLink}
                      className="text-xs font-bold text-indigo-600 dark:text-sky-400 hover:underline cursor-pointer pt-0.5"
                    >
                      {copiedUri ? '✓ UPI Link Copied' : 'Copy UPI Payment Link'}
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-neutral-500 dark:text-neutral-400">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums font-semibold text-neutral-900 dark:text-white">
                    {(Number(invoice.subtotal) || 0).toFixed(2)} {cur}
                  </span>
                </div>
                {(Number(invoice.discountTotal) || 0) > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                    <span>Discount</span>
                    <span className="font-mono tabular-nums font-semibold">
                      -{(Number(invoice.discountTotal) || 0).toFixed(2)} {cur}
                    </span>
                  </div>
                )}
                {(Number(invoice.taxTotal) || 0) > 0 && (
                  <div className="flex justify-between text-neutral-500 dark:text-neutral-400">
                    <span>Taxes (GST / VAT)</span>
                    <span className="font-mono tabular-nums font-semibold text-neutral-900 dark:text-white">
                      +{(Number(invoice.taxTotal) || 0).toFixed(2)} {cur}
                    </span>
                  </div>
                )}
                <div className="pt-2.5 border-t border-neutral-200 dark:border-neutral-800 flex justify-between items-baseline">
                  <span className="font-bold text-sm text-neutral-900 dark:text-white">Grand Total</span>
                  <span className="text-2xl font-extrabold font-mono tabular-nums text-neutral-900 dark:text-white">
                    {(Number(invoice.grandTotal) || 0).toFixed(2)} {cur}
                  </span>
                </div>
                {invoice.notes && (
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 pt-2 leading-relaxed">
                    Terms: {invoice.notes}
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        {/* Email Invoice Delivery Box (Gmail API + .EML) */}
        <div className="p-4 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/50 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold">Dispatch Invoice by Email</span>
            {gmailConnected && gmailSender && (
              <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                Gmail Ready ({gmailSender})
              </span>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="Recipient email (client@example.com)"
              className="flex-1 bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3.5 py-2 text-xs outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              disabled={sendingEmail}
              onClick={handleSendViaGmail}
              className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              {sendingEmail
                ? 'Sending...'
                : gmailConnected
                ? 'Confirm & Send via Gmail'
                : 'Connect Gmail & Send'}
            </button>
            <button
              type="button"
              onClick={handleDownloadEml}
              className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-white dark:hover:bg-neutral-800 text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              Download .EML
            </button>
          </div>
          {emailError && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{emailError}</p>}
          {emailStatus && <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">✓ {emailStatus}</p>}
        </div>

        {/* Manual Offline Settlement Form (if expanded) */}
        {!isPaid && showManualSettle && (
          <form
            onSubmit={handleConfirmManualSettle}
            className="p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                Confirm Direct Settlement &amp; Record to Cashflow Ledger
              </p>
              <button
                type="button"
                onClick={() => setShowManualSettle(false)}
                className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
              >
                Cancel
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select
                value={manualMethod}
                onChange={(e) => setManualMethod(e.target.value as 'UPI' | 'CARD' | 'CASH')}
                className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-bold"
              >
                <option value="UPI">UPI / Instant Transfer</option>
                <option value="CARD">Bank Wire / Card</option>
                <option value="CASH">Cash Settled</option>
              </select>
              <input
                type="text"
                value={manualRef}
                onChange={(e) => setManualRef(e.target.value)}
                placeholder={manualMethod === 'CASH' ? 'Receipt / Note (optional)' : 'Payment Reference Number (required)'}
                className="sm:col-span-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono"
              />
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
            >
              Confirm Payment Received &rarr;
            </button>
          </form>
        )}

        {/* Action Footer */}
        <div className="pt-4 border-t border-neutral-200/80 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleDelete}
            className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:border-rose-400 text-xs font-semibold text-neutral-500 hover:text-rose-600 cursor-pointer transition-colors"
          >
            Delete Invoice
          </button>

          {!isPaid ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setShowManualSettle((prev) => !prev)}
                className="px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:border-emerald-500 text-xs font-bold text-neutral-800 dark:text-neutral-200 cursor-pointer whitespace-nowrap"
              >
                Mark Paid (Bank / Cash / Ref)
              </button>
              <button
                type="button"
                onClick={() => setIsUpiOpen(true)}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer whitespace-nowrap shadow-xs"
              >
                Pay via UPI QR &rarr;
              </button>
            </div>
          ) : (
            <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
              ✓ Payment Recorded in Cashflow Ledger
            </span>
          )}
        </div>
      </div>

      {isUpiOpen && (
        <UPIPaymentModal
          isOpen={isUpiOpen}
          onClose={() => setIsUpiOpen(false)}
          amount={Number(invoice.grandTotal) || 0}
          currency={cur}
          defaultUpiId={resolvedUpiId}
          defaultPayeeName={resolvedPayee}
          invoiceNumber={invoice.invoiceNumber}
          onPaymentSuccess={(method, upiRef) => {
            markInvoicePaid(invoice.id, method, upiRef);
            setIsUpiOpen(false);
            onClose();
          }}
        />
      )}
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default InvoiceDetailModal;
