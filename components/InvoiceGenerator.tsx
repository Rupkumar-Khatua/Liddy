import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import {
  Invoice,
  InvoiceLineItem,
  IndustryTheme,
  InvoiceTemplateStyle,
  InvoicePaperFormat,
} from '../types';
import { useFinMind } from '../context/FinMindContext';
import { generateInvoiceFromPrompt, perfectInvoiceWithAI } from '../services/geminiService';
import { UPIPaymentModal } from './UPIPaymentModal';
import {
  buildPrintableInvoiceHtml,
  PAPER_FORMAT_SPECS,
  printFormattedInvoiceViaIframe,
  TEMPLATE_LABELS,
} from '../utils/invoicePrint';
import { triggerFileDownload } from '../services/emailReceiptService';

interface InvoiceGeneratorProps {
  onSaved?: () => void;
  onCancel?: () => void;
}

const INDUSTRY_CONFIGS: Record<IndustryTheme, { label: string; sampleNotes: string }> = {
  RETAIL: {
    label: 'Retail & Storefront',
    sampleNotes: 'Goods once sold are returnable within 7 days with original tag and receipt.',
  },
  TECH: {
    label: 'Tech & Digital',
    sampleNotes: 'Payment due within 14 calendar days. Thank you for your business.',
  },
  DINING: {
    label: 'Dining & Hospitality',
    sampleNotes: 'Thank you for visiting! All applicable taxes are itemized above.',
  },
  HEALTHCARE: {
    label: 'Healthcare & Clinic',
    sampleNotes: 'Summary valid for 30 days. Reach our desk for billing questions.',
  },
  SERVICES: {
    label: 'Professional Services',
    sampleNotes: 'Net 15 terms. Please include the invoice reference on your transfer.',
  },
};

export const InvoiceGenerator: React.FC<InvoiceGeneratorProps> = ({ onSaved, onCancel }) => {
  const { addInvoice, addTransaction, currencySymbol } = useFinMind();

  const [industry, setIndustry] = useState<IndustryTheme>('SERVICES');
  const [templateStyle, setTemplateStyle] = useState<InvoiceTemplateStyle>('classic');
  const [paperFormat, setPaperFormat] = useState<InvoicePaperFormat>('a4');

  const [invoiceNumber, setInvoiceNumber] = useState(
    `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
  );
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]);
  const [currency, setCurrency] = useState(currencySymbol || '₹');

  const [senderName, setSenderName] = useState('');
  const [senderDetails, setSenderDetails] = useState('');
  const [senderTaxId, setSenderTaxId] = useState('');

  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientTaxId, setClientTaxId] = useState('');
  const [clientDetails, setClientDetails] = useState('');

  const [upiId, setUpiId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [notes, setNotes] = useState(INDUSTRY_CONFIGS['SERVICES'].sampleNotes);
  const [items, setItems] = useState<InvoiceLineItem[]>([]);

  const [aiPrompt, setAiPrompt] = useState('');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [aiStatusMessage, setAiStatusMessage] = useState<string | null>(null);

  const [isUpiModalOpen, setIsUpiModalOpen] = useState(false);
  const [isPreviewOverlayOpen, setIsPreviewOverlayOpen] = useState(false);
  const [embeddedQr, setEmbeddedQr] = useState<string>('');
  const [savedSuccessMsg, setSavedSuccessMsg] = useState<string | null>(null);

  const subtotal = useMemo(() => {
    return items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  }, [items]);

  const discountTotal = useMemo(() => {
    return items.reduce((sum, item) => {
      const lineBase = item.quantity * item.unitPrice;
      return sum + lineBase * ((item.discountPercent || 0) / 100);
    }, 0);
  }, [items]);

  const taxTotal = useMemo(() => {
    return items.reduce((sum, item) => {
      const lineBase = item.quantity * item.unitPrice;
      const discounted = lineBase * (1 - (item.discountPercent || 0) / 100);
      return sum + discounted * ((item.taxPercent || 0) / 100);
    }, 0);
  }, [items]);

  const grandTotal = useMemo(() => {
    return subtotal - discountTotal + taxTotal;
  }, [subtotal, discountTotal, taxTotal]);

  useEffect(() => {
    const activeUpi = upiId.trim() || 'merchant@upi';
    const activePayee = payeeName.trim() || senderName.trim() || 'Billing Desk';
    const uri = `upi://pay?pa=${encodeURIComponent(activeUpi)}&pn=${encodeURIComponent(activePayee)}&am=${grandTotal.toFixed(2)}&tn=${encodeURIComponent(invoiceNumber)}&cu=INR`;
    QRCode.toDataURL(uri, { width: 140, margin: 1 })
      .then((url) => setEmbeddedQr(url))
      .catch(() => {});
  }, [upiId, payeeName, senderName, grandTotal, invoiceNumber]);

  const draftInvoiceObject: Invoice = useMemo(
    () => ({
      id: 'draft-preview',
      invoiceNumber,
      date,
      dueDate,
      senderName: senderName || 'Your Name / Business',
      senderDetails,
      senderTaxId: senderTaxId || undefined,
      clientName: clientName || 'Recipient / Customer',
      clientEmail: clientEmail || undefined,
      clientTaxId: clientTaxId || undefined,
      clientDetails,
      industry,
      templateStyle,
      paperFormat,
      items:
        items.length > 0
          ? items
          : [
              {
                id: 'preview-1',
                description: clientName ? `Services for ${clientName}` : 'Line Item Description',
                quantity: 1,
                unitPrice: grandTotal,
                discountPercent: 0,
                taxPercent: 0,
                total: grandTotal,
              },
            ],
      subtotal,
      taxTotal,
      discountTotal,
      grandTotal,
      currency,
      notes,
      upiId: upiId || undefined,
      payeeName: payeeName || undefined,
      paymentStatus: 'unpaid',
    }),
    [
      invoiceNumber,
      date,
      dueDate,
      senderName,
      senderDetails,
      senderTaxId,
      clientName,
      clientEmail,
      clientTaxId,
      clientDetails,
      industry,
      templateStyle,
      paperFormat,
      items,
      subtotal,
      taxTotal,
      discountTotal,
      grandTotal,
      currency,
      notes,
      upiId,
      payeeName,
    ]
  );

  const previewHtml = useMemo(
    () => buildPrintableInvoiceHtml(draftInvoiceObject, embeddedQr, templateStyle, paperFormat),
    [draftInvoiceObject, embeddedQr, templateStyle, paperFormat]
  );

  const handleIndustryChange = (newIndustry: IndustryTheme) => {
    setIndustry(newIndustry);
    setNotes(INDUSTRY_CONFIGS[newIndustry].sampleNotes);
  };

  const handleItemChange = (index: number, field: keyof InvoiceLineItem, value: any) => {
    setItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[index], [field]: value };
      const qty = Number(field === 'quantity' ? value : item.quantity) || 0;
      const price = Number(field === 'unitPrice' ? value : item.unitPrice) || 0;
      const disc = Number(field === 'discountPercent' ? value : item.discountPercent || 0);
      const tax = Number(field === 'taxPercent' ? value : item.taxPercent || 0);
      const base = qty * price;
      const discounted = base * (1 - disc / 100);
      item.total = Math.round(discounted * (1 + tax / 100) * 100) / 100;
      updated[index] = item;
      return updated;
    });
  };

  const handleAddItem = () => {
    const newItem: InvoiceLineItem = {
      id: 'item-' + Date.now().toString(),
      description: '',
      quantity: 1,
      unitPrice: 0,
      discountPercent: 0,
      taxPercent: 0,
      total: 0,
    };
    setItems((prev) => [...prev, newItem]);
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleGenerateWithAi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    setIsGeneratingAi(true);
    setAiStatusMessage('Drafting itemized invoice...');
    try {
      const result = await generateInvoiceFromPrompt(aiPrompt, industry);
      if (result) {
        if (result.invoiceNumber) setInvoiceNumber(result.invoiceNumber);
        if (result.senderName) setSenderName(result.senderName);
        if (result.senderDetails) setSenderDetails(result.senderDetails);
        if (result.clientName) setClientName(result.clientName);
        if (result.clientDetails) setClientDetails(result.clientDetails);
        if (result.industry && INDUSTRY_CONFIGS[result.industry as IndustryTheme]) {
          setIndustry(result.industry as IndustryTheme);
        }
        if (result.upiId) setUpiId(result.upiId);
        if (result.payeeName) setPayeeName(result.payeeName);
        if (result.notes) setNotes(result.notes);
        if (result.items && Array.isArray(result.items) && result.items.length > 0) {
          setItems(
            result.items.map((it: any, idx: number) => ({
              id: `item-ai-${idx}-${Date.now()}`,
              description: it.description || 'Line Item',
              quantity: Number(it.quantity) || 1,
              unitPrice: Number(it.unitPrice) || 0,
              discountPercent: Number(it.discountPercent) || 0,
              taxPercent: Number(it.taxPercent) || 0,
              total: Number(it.total) || (Number(it.quantity) || 1) * (Number(it.unitPrice) || 0),
            }))
          );
        }
        setAiStatusMessage('✓ Invoice drafted cleanly.');
      }
    } catch {
      setAiStatusMessage('Generation failed. Please try again.');
    } finally {
      setIsGeneratingAi(false);
      setTimeout(() => setAiStatusMessage(null), 3000);
    }
  };

  const handlePerfectWithAi = async () => {
    if (items.length === 0) {
      setAiStatusMessage('Add at least one line item before auditing.');
      setTimeout(() => setAiStatusMessage(null), 3000);
      return;
    }
    setIsGeneratingAi(true);
    setAiStatusMessage('Auditing items & taxes...');
    try {
      const perfected = await perfectInvoiceWithAI(draftInvoiceObject);
      if (perfected) {
        if (perfected.notes) setNotes(perfected.notes);
        if (perfected.items && Array.isArray(perfected.items)) {
          setItems(
            perfected.items.map((it: any, idx: number) => ({
              id: `item-perf-${idx}-${Date.now()}`,
              description: it.description || 'Line Item',
              quantity: Number(it.quantity) || 1,
              unitPrice: Number(it.unitPrice) || 0,
              discountPercent: Number(it.discountPercent) || 0,
              taxPercent: Number(it.taxPercent) || 0,
              total: Number(it.total) || 0,
            }))
          );
        }
        setAiStatusMessage('✓ Line items audited.');
      }
    } catch {
      setAiStatusMessage('Retained current invoice values.');
    } finally {
      setIsGeneratingAi(false);
      setTimeout(() => setAiStatusMessage(null), 3000);
    }
  };

  const handleSaveInvoice = (settlement?: { method: string; upiRef: string }) => {
    if (!senderName.trim() && !clientName.trim() && items.length === 0) {
      setAiStatusMessage('Enter recipient name or add a line item to save this invoice.');
      setTimeout(() => setAiStatusMessage(null), 3000);
      return;
    }

    const sanitizedItems: InvoiceLineItem[] =
      items.length > 0
        ? items
        : [
            {
              id: 'item-' + Date.now().toString(),
              description: clientName ? `Services for ${clientName}` : 'General Services',
              quantity: 1,
              unitPrice: grandTotal,
              discountPercent: 0,
              taxPercent: 0,
              total: grandTotal,
            },
          ];

    const isSettled = Boolean(settlement);
    const paidAt = isSettled ? new Date().toISOString() : undefined;

    const created = addInvoice({
      invoiceNumber,
      date,
      dueDate,
      senderName: senderName || 'Self / Merchant',
      senderDetails,
      senderTaxId: senderTaxId || undefined,
      clientName: clientName || 'Walk-in Customer',
      clientDetails,
      clientEmail: clientEmail || undefined,
      clientTaxId: clientTaxId || undefined,
      industry,
      templateStyle,
      paperFormat,
      items: sanitizedItems,
      subtotal,
      taxTotal,
      discountTotal,
      grandTotal,
      currency,
      notes,
      upiId: upiId || undefined,
      payeeName: payeeName || undefined,
      paymentStatus: isSettled ? 'paid' : 'unpaid',
      paidAt,
    });

    if (settlement) {
      addTransaction({
        merchant: clientName || senderName || 'Settled Bill',
        amount: grandTotal,
        category: industry || 'Billing',
        date: (paidAt || new Date().toISOString()).split('T')[0],
        status: 'completed',
        invoiceId: created.id,
        upiReference: settlement.upiRef || upiId || undefined,
        paymentMethod: 'UPI',
        notes: `Settled ${invoiceNumber} via ${settlement.method}`,
      });
    }

    setSavedSuccessMsg(
      isSettled
        ? '✓ Invoice settled and recorded into your ledger.'
        : '✓ Invoice saved cleanly. Preview, export PDF, or collect payment anytime.'
    );
    setTimeout(() => {
      setSavedSuccessMsg(null);
      if (onSaved) onSaved();
    }, 800);
  };

  return (
    <div className="space-y-6 pt-2 pb-12 animate-enter">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-neutral-900 dark:text-white tracking-tight">
            Structured Invoice Builder
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Create clean bills with GST/Tax IDs, A4 / US Letter / 80mm POS sizing, live preview overlay, and UPI QR.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsPreviewOverlayOpen(true)}
            className="px-4 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold cursor-pointer"
          >
            Preview Print / PDF
          </button>
          <button
            type="button"
            onClick={() => handleSaveInvoice()}
            className="px-6 py-2.5 bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer"
          >
            Save Invoice
          </button>
        </div>
      </header>

      {savedSuccessMsg && (
        <div className="p-4 bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-2xl text-xs font-bold animate-enter">
          {savedSuccessMsg}
        </div>
      )}

      {/* Design Style + Print Paper Size + Industry Controls */}
      <div className="glass-card dark:bg-neutral-900/80 dark:border-neutral-800 p-5 rounded-3xl border border-neutral-200/80 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 font-bold mb-2">
              Design Format Style
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(TEMPLATE_LABELS) as InvoiceTemplateStyle[]).map((tpl) => (
                <button
                  key={tpl}
                  type="button"
                  onClick={() => setTemplateStyle(tpl)}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    templateStyle === tpl
                      ? 'border-neutral-900 dark:border-white bg-neutral-900 dark:bg-white text-white dark:text-neutral-950'
                      : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  <div className="text-xs font-bold">{TEMPLATE_LABELS[tpl].label}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 font-bold mb-2">
              Printing Paper Format
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(PAPER_FORMAT_SPECS) as InvoicePaperFormat[]).map((pf) => (
                <button
                  key={pf}
                  type="button"
                  onClick={() => setPaperFormat(pf)}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    paperFormat === pf
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  <div className="text-xs font-bold">{PAPER_FORMAT_SPECS[pf].badge}</div>
                  <div className="text-[10px] opacity-75 truncate">{PAPER_FORMAT_SPECS[pf].label}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 mr-1">Category:</span>
          {(Object.keys(INDUSTRY_CONFIGS) as IndustryTheme[]).map((themeKey) => (
            <button
              key={themeKey}
              type="button"
              onClick={() => handleIndustryChange(themeKey)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all ${
                industry === themeKey
                  ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
              }`}
            >
              {INDUSTRY_CONFIGS[themeKey].label}
            </button>
          ))}
        </div>
      </div>

      {/* AI Copilot Bar */}
      <div className="p-5 rounded-3xl bg-neutral-950 text-white shadow-lg border border-neutral-800 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-sky-400 font-mono">
            Quick Bill Drafting Assistant
          </span>
          {aiStatusMessage && (
            <span className="text-xs font-mono text-sky-200 bg-white/10 px-3 py-1 rounded-xl">
              {aiStatusMessage}
            </span>
          )}
        </div>

        <form onSubmit={handleGenerateWithAi} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="Describe your invoice (e.g. 'Web design milestone 25000 with 18% GST for Riya')..."
            className="flex-1 bg-white/10 border border-white/20 rounded-2xl px-4 py-3 text-xs text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isGeneratingAi || !aiPrompt.trim()}
              className="px-5 py-3 bg-sky-600 hover:bg-sky-500 text-white rounded-2xl text-xs font-bold transition-all disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              {isGeneratingAi ? 'Drafting...' : 'Auto-Draft'}
            </button>
            {items.length > 0 && (
              <button
                type="button"
                onClick={handlePerfectWithAi}
                disabled={isGeneratingAi}
                className="px-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-2xl text-xs font-bold border border-white/20 whitespace-nowrap cursor-pointer"
              >
                Audit Tax &amp; Copy
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Main Structured Invoice Sheet */}
      <div className="glass-card dark:bg-neutral-900/80 dark:border-neutral-800 p-6 sm:p-8 rounded-[32px] border border-neutral-200/80 shadow-md space-y-7">
        {/* Top Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pb-6 border-b border-neutral-100 dark:border-neutral-800">
          {/* Sender */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-400 font-mono">
              From (Issuer)
            </label>
            <input
              type="text"
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="Your Name or Store Name"
              className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 text-sm font-bold text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="text"
              value={senderTaxId}
              onChange={(e) => setSenderTaxId(e.target.value)}
              placeholder="GSTIN / Tax ID / PAN (optional)"
              className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono text-neutral-800 dark:text-neutral-200 outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <textarea
              rows={2}
              value={senderDetails}
              onChange={(e) => setSenderDetails(e.target.value)}
              placeholder="Address, phone, support email (optional)"
              className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 text-xs text-neutral-700 dark:text-neutral-300 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Client */}
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-neutral-400 font-mono">
              Billed To (Customer)
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Customer or Organization Name"
              className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 text-sm font-bold text-neutral-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="Customer Email (for Gmail send)"
                className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs text-neutral-800 dark:text-neutral-200 outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="text"
                value={clientTaxId}
                onChange={(e) => setClientTaxId(e.target.value)}
                placeholder="Customer Tax ID / GSTIN"
                className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono text-neutral-800 dark:text-neutral-200 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <textarea
              rows={2}
              value={clientDetails}
              onChange={(e) => setClientDetails(e.target.value)}
              placeholder="Billing address or notes (optional)"
              className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 text-xs text-neutral-700 dark:text-neutral-300 outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Invoice Meta Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-6 border-b border-neutral-100 dark:border-neutral-800">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 font-mono">Invoice Number</label>
            <input
              type="text"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="w-full mt-1 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono font-bold text-neutral-900 dark:text-white"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 font-mono">Issue Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full mt-1 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono font-medium text-neutral-900 dark:text-white"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 font-mono">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full mt-1 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono font-medium text-neutral-900 dark:text-white"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 font-mono">Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full mt-1 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-bold text-neutral-900 dark:text-white"
            >
              <option value="₹">₹ (INR)</option>
              <option value="$">$ (USD)</option>
              <option value="€">€ (EUR)</option>
              <option value="£">£ (GBP)</option>
            </select>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-base font-bold text-neutral-900 dark:text-white">Line Items &amp; Tax Breakdown</h4>
            <button
              type="button"
              onClick={handleAddItem}
              className="px-4 py-2 bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 rounded-xl text-xs font-bold hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors cursor-pointer"
            >
              + Add Line Item
            </button>
          </div>

          {items.length === 0 ? (
            <div className="p-8 text-center rounded-2xl bg-neutral-50 dark:bg-neutral-800/50 border border-dashed border-neutral-200 dark:border-neutral-700 space-y-2">
              <p className="text-xs font-bold text-neutral-700 dark:text-neutral-300">No items added yet</p>
              <p className="text-[11px] text-neutral-400">
                Click &ldquo;+ Add Line Item&rdquo; above or use Auto-Draft to populate items with GST/discounts.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full text-left border-collapse min-w-[650px]">
                <thead>
                  <tr className="border-b border-neutral-100 dark:border-neutral-800 text-[10px] font-bold text-neutral-400 uppercase tracking-wider font-mono">
                    <th className="py-2 px-3">Description</th>
                    <th className="py-2 px-3 w-20">Qty</th>
                    <th className="py-2 px-3 w-28">Unit Rate</th>
                    <th className="py-2 px-3 w-20">Disc %</th>
                    <th className="py-2 px-3 w-20">Tax %</th>
                    <th className="py-2 px-3 w-32 text-right">Line Total</th>
                    <th className="py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800 text-xs">
                  {items.map((item, idx) => (
                    <tr key={item.id || idx}>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => handleItemChange(idx, 'description', e.target.value)}
                          placeholder="Item or service description"
                          className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-neutral-900 dark:text-white"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                          className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-neutral-900 dark:text-white"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(e) => handleItemChange(idx, 'unitPrice', e.target.value)}
                          className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-neutral-900 dark:text-white"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={item.discountPercent || 0}
                          onChange={(e) => handleItemChange(idx, 'discountPercent', e.target.value)}
                          className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-neutral-900 dark:text-white"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={item.taxPercent || 0}
                          onChange={(e) => handleItemChange(idx, 'taxPercent', e.target.value)}
                          className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-neutral-900 dark:text-white"
                        />
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-neutral-900 dark:text-white tabular-nums">
                        {item.total.toFixed(2)} {currency}
                      </td>
                      <td className="py-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="text-neutral-400 hover:text-red-500 transition-colors p-1 cursor-pointer"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Bottom Split: UPI QR & Totals Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 border-t border-neutral-100 dark:border-neutral-800">
          <div className="p-5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 font-bold flex items-center justify-center text-xs">
                  UPI
                </span>
                <div>
                  <h5 className="text-xs font-bold text-neutral-900 dark:text-white">Dynamic UPI QR</h5>
                  <p className="text-[10px] text-neutral-400">Embedded directly on printed PDF</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsUpiModalOpen(true)}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
              >
                Collect UPI &amp; Settle
              </button>
            </div>

            <div className="flex items-center gap-4">
              <div className="p-2 bg-white rounded-xl border border-neutral-200/80 shadow-2xs shrink-0">
                {embeddedQr ? (
                  <img src={embeddedQr} alt="UPI QR" className="w-24 h-24 object-contain mix-blend-multiply" />
                ) : (
                  <div className="w-24 h-24 flex items-center justify-center text-[10px] text-neutral-400">QR</div>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <div>
                  <label className="text-[10px] font-bold text-neutral-400 uppercase font-mono">Receiver VPA (UPI ID)</label>
                  <input
                    type="text"
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    placeholder="merchant@okhdfcbank"
                    className="w-full mt-0.5 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-2.5 py-1 text-xs font-mono font-medium text-neutral-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-neutral-400 uppercase font-mono">Payee Name</label>
                  <input
                    type="text"
                    value={payeeName}
                    onChange={(e) => setPayeeName(e.target.value)}
                    placeholder="Billing Name"
                    className="w-full mt-0.5 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg px-2.5 py-1 text-xs font-medium text-neutral-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3 flex flex-col justify-between">
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-neutral-500 dark:text-neutral-400">
                <span>Subtotal:</span>
                <span className="font-mono font-bold text-neutral-900 dark:text-white">{subtotal.toFixed(2)} {currency}</span>
              </div>
              {discountTotal > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>Discounts Applied:</span>
                  <span className="font-mono font-bold">-{discountTotal.toFixed(2)} {currency}</span>
                </div>
              )}
              {taxTotal > 0 && (
                <div className="flex justify-between text-neutral-500 dark:text-neutral-400">
                  <span>Taxes (GST / VAT):</span>
                  <span className="font-mono font-bold text-neutral-900 dark:text-white">+{taxTotal.toFixed(2)} {currency}</span>
                </div>
              )}
              <div className="pt-2 border-t border-neutral-200 dark:border-neutral-700 flex justify-between items-baseline">
                <span className="text-sm font-extrabold text-neutral-900 dark:text-white">Grand Total:</span>
                <span className="text-2xl font-extrabold text-neutral-900 dark:text-white font-mono tabular-nums">
                  {grandTotal.toFixed(2)} {currency}
                </span>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 font-mono">Notes &amp; Payment Terms</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full mt-1 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-2.5 text-xs text-neutral-700 dark:text-neutral-300"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Live Preview Overlay Modal before Finalizing or Downloading */}
      {isPreviewOverlayOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[9995] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-enter"
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsPreviewOverlayOpen(false);
            }}
          >
            <div className="bg-white dark:bg-[#121216] border border-neutral-200 dark:border-neutral-800 rounded-[28px] max-w-4xl w-full p-6 shadow-2xl my-auto space-y-4 text-neutral-900 dark:text-white">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-neutral-200 dark:border-neutral-800">
                <div>
                  <h3 className="text-lg font-extrabold">
                    Live Invoice Preview · {TEMPLATE_LABELS[templateStyle].label} ({PAPER_FORMAT_SPECS[paperFormat].badge})
                  </h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => printFormattedInvoiceViaIframe(previewHtml)}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
                  >
                    Print / Save PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => triggerFileDownload(previewHtml, `${invoiceNumber}.html`, 'text/html')}
                    className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-bold cursor-pointer"
                  >
                    Download .HTML
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPreviewOverlayOpen(false)}
                    className="px-3.5 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-xs font-bold cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(TEMPLATE_LABELS) as InvoiceTemplateStyle[]).map((tpl) => (
                    <button
                      key={tpl}
                      type="button"
                      onClick={() => setTemplateStyle(tpl)}
                      className={`px-3 py-1 rounded-lg font-bold cursor-pointer ${
                        templateStyle === tpl
                          ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-950'
                          : 'bg-neutral-100 dark:bg-neutral-800'
                      }`}
                    >
                      {TEMPLATE_LABELS[tpl].label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(PAPER_FORMAT_SPECS) as InvoicePaperFormat[]).map((pf) => (
                    <button
                      key={pf}
                      type="button"
                      onClick={() => setPaperFormat(pf)}
                      className={`px-3 py-1 rounded-lg font-bold cursor-pointer ${
                        paperFormat === pf
                          ? 'bg-indigo-600 text-white'
                          : 'bg-neutral-100 dark:bg-neutral-800'
                      }`}
                    >
                      {PAPER_FORMAT_SPECS[pf].badge}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl bg-neutral-200/80 dark:bg-neutral-950 p-4 overflow-x-auto">
                <div className="mx-auto" style={{ maxWidth: `${PAPER_FORMAT_SPECS[paperFormat].widthPx}px` }}>
                  <iframe
                    title="Invoice Draft Preview"
                    srcDoc={previewHtml}
                    className="w-full h-[520px] bg-white rounded-xl shadow-lg border border-neutral-300"
                  />
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* UPI Payment Modal */}
      {isUpiModalOpen && (
        <UPIPaymentModal
          isOpen={isUpiModalOpen}
          onClose={() => setIsUpiModalOpen(false)}
          amount={grandTotal}
          currency="₹"
          defaultUpiId={upiId || 'merchant@upi'}
          defaultPayeeName={payeeName || senderName || 'Store Billing'}
          invoiceNumber={invoiceNumber}
          onPaymentSuccess={(method, upiRef) => {
            handleSaveInvoice({ method, upiRef });
          }}
        />
      )}
    </div>
  );
};

export default InvoiceGenerator;
