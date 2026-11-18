import React, { useState, useRef, useEffect, useMemo } from 'react';
import { analyzeReceipt } from '../services/geminiService';
import {
  Invoice,
  InvoiceLineItem,
  InvoicePaperFormat,
  InvoiceTemplateStyle,
  ReceiptExtractionResult,
  Transaction,
} from '../types';
import { ICONS } from '../constants';
import { useFinMind } from '../context/FinMindContext';
import { diagnoseMediaAccessFailure } from '../utils/mediaPermissions';
import {
  buildPrintableInvoiceHtml,
  PAPER_FORMAT_SPECS,
  printFormattedInvoiceViaIframe,
  TEMPLATE_LABELS,
} from '../utils/invoicePrint';
import { triggerFileDownload } from '../services/emailReceiptService';

interface ReceiptScannerProps {
  onSave?: (data: Partial<Transaction>) => void;
  onSavedInvoice?: () => void;
  onCancel?: () => void;
}

const ReceiptScanner: React.FC<ReceiptScannerProps> = ({
  onSave,
  onSavedInvoice,
  onCancel,
}) => {
  const {
    currencySymbol,
    paymentRegion,
    addInvoice,
    addTransaction,
    trackEngagement,
    currentUser,
  } = useFinMind();

  const [analyzing, setAnalyzing] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // Camera integration state
  const [isLiveCameraActive, setIsLiveCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Extracted Paper / Handwritten Bill State
  const [merchant, setMerchant] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState(
    `BILL-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`
  );
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState('Retail');
  const [currency, setCurrency] = useState(currencySymbol || '₹');
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'PAYPAL' | 'CARD' | 'CASH'>('CASH');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<InvoiceLineItem[]>([]);
  const [manualTotalOverride, setManualTotalOverride] = useState<number | null>(null);

  // Digital Bill Template Design Library
  const [templateStyle, setTemplateStyle] = useState<InvoiceTemplateStyle>('swiss');
  const [paperFormat, setPaperFormat] = useState<InvoicePaperFormat>('a4');
  const [alsoLogExpense, setAlsoLogExpense] = useState(true);

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsLiveCameraActive(false);
  };

  useEffect(() => {
    if (isLiveCameraActive && videoRef.current && streamRef.current) {
      const videoEl = videoRef.current;
      videoEl.srcObject = streamRef.current;
      videoEl.play().catch(() => {});
    }
  }, [isLiveCameraActive]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const applyExtraction = (data: ReceiptExtractionResult) => {
    if (data.merchant) setMerchant(data.merchant);
    if (data.invoiceNumber) setInvoiceNumber(data.invoiceNumber);
    if (data.date) setDate(data.date);
    if (data.category) setCategory(data.category);
    if (data.currency) setCurrency(data.currency);
    if (data.notes) setNotes(data.notes);
    if (data.paymentMethod) {
      const upper = data.paymentMethod.toUpperCase();
      if (upper === 'UPI' && paymentRegion === 'IN') {
        setPaymentMethod('UPI');
      } else if (upper === 'PAYPAL' && paymentRegion === 'INTL') {
        setPaymentMethod('PAYPAL');
      } else if (upper === 'CARD' || upper === 'CASH') {
        setPaymentMethod(upper);
      }
    }

    if (Array.isArray(data.items) && data.items.length > 0) {
      setItems(
        data.items.map((it, idx) => ({
          id: `scan-it-${idx}-${Date.now()}`,
          description: it.description || `Item ${idx + 1}`,
          quantity: Number(it.quantity) || 1,
          unitPrice: Number(it.unitPrice) || 0,
          discountPercent: 0,
          taxPercent: Number(it.taxPercent) || 0,
          total:
            Number(it.total) ||
            Math.round((Number(it.quantity) || 1) * (Number(it.unitPrice) || 0) * 100) / 100,
        }))
      );
      setManualTotalOverride(null);
    } else {
      const extractedTotal = Number(data.amount) || 0;
      setItems([
        {
          id: `scan-it-0-${Date.now()}`,
          description: data.merchant ? `Bill from ${data.merchant}` : 'Scanned Bill Total',
          quantity: 1,
          unitPrice: extractedTotal,
          discountPercent: 0,
          taxPercent: 0,
          total: extractedTotal,
        },
      ]);
      setManualTotalOverride(extractedTotal > 0 ? extractedTotal : null);
    }
    setHasScanned(true);
  };

  const handleOpenCamera = async () => {
    setCameraError(null);
    setScanError(null);
    if (!navigator?.mediaDevices?.getUserMedia) {
      const diag = await diagnoseMediaAccessFailure('camera', new Error('UNSUPPORTED_MEDIA'));
      setCameraError(diag.message);
      return;
    }

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      streamRef.current = stream;
      setIsLiveCameraActive(true);
    } catch (err: any) {
      const diag = await diagnoseMediaAccessFailure('camera', err);
      setCameraError(diag.message);
    }
  };

  const runOcrExtraction = async (base64Data: string, mimeType: string) => {
    if (!trackEngagement('Paper Bill OCR Studio')) return;
    setAnalyzing(true);
    setScanError(null);
    try {
      const data = await analyzeReceipt(base64Data, mimeType);
      if (data) {
        applyExtraction(data);
      } else {
        setScanError('Could not read text clearly. You can fill items manually on the right.');
        setHasScanned(true);
      }
    } catch {
      setScanError('Could not scan image cleanly right now. Fill or edit details below.');
      setHasScanned(true);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCaptureFromCamera = async () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    setPreview(dataUrl);
    stopCameraStream();
    await runOcrExtraction(dataUrl.split(',')[1], 'image/jpeg');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopCameraStream();
    setScanError(null);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const dataUrl = reader.result as string;
      setPreview(file.type.startsWith('image/') ? dataUrl : null);
      const base64Data = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      await runOcrExtraction(base64Data, file.type || 'image/jpeg');
    };
    reader.readAsDataURL(file);
  };

  const handleItemChange = (index: number, field: keyof InvoiceLineItem, value: any) => {
    setManualTotalOverride(null);
    setItems((prev) => {
      const next = [...prev];
      const item = { ...next[index], [field]: value };
      const qty = Number(field === 'quantity' ? value : item.quantity) || 0;
      const price = Number(field === 'unitPrice' ? value : item.unitPrice) || 0;
      const tax = Number(field === 'taxPercent' ? value : item.taxPercent || 0);
      item.total = Math.round(qty * price * (1 + tax / 100) * 100) / 100;
      next[index] = item;
      return next;
    });
  };

  const handleAddLineItem = () => {
    setManualTotalOverride(null);
    setItems((prev) => [
      ...prev,
      {
        id: `scan-it-${Date.now()}-${prev.length}`,
        description: '',
        quantity: 1,
        unitPrice: 0,
        discountPercent: 0,
        taxPercent: 0,
        total: 0,
      },
    ]);
  };

  const handleRemoveLineItem = (index: number) => {
    setManualTotalOverride(null);
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const computedSubtotal = useMemo(
    () => items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0),
    [items]
  );

  const computedTaxTotal = useMemo(
    () =>
      items.reduce((s, it) => {
        const base = (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0);
        return s + base * ((Number(it.taxPercent) || 0) / 100);
      }, 0),
    [items]
  );

  const computedGrandTotal = useMemo(
    () => (manualTotalOverride !== null ? manualTotalOverride : computedSubtotal + computedTaxTotal),
    [manualTotalOverride, computedSubtotal, computedTaxTotal]
  );

  const digitalInvoiceObject: Invoice = useMemo(
    () => ({
      id: `bill-${Date.now()}`,
      invoiceNumber: invoiceNumber || `BILL-${Date.now().toString().slice(-4)}`,
      date: date || new Date().toISOString().split('T')[0],
      dueDate: date || new Date().toISOString().split('T')[0],
      senderName: merchant || 'Merchant / Issuer',
      senderDetails: category ? `Category: ${category}` : '',
      clientName: currentUser?.displayName || 'Digital Copy Recipient',
      clientEmail: currentUser?.email || undefined,
      clientDetails: '',
      industry: 'RETAIL',
      templateStyle,
      paperFormat,
      items:
        items.length > 0
          ? items
          : [
              {
                id: 'bill-item-1',
                description: merchant ? `Bill from ${merchant}` : 'Digital Bill Item',
                quantity: 1,
                unitPrice: computedGrandTotal,
                discountPercent: 0,
                taxPercent: 0,
                total: computedGrandTotal,
              },
            ],
      subtotal: computedSubtotal || computedGrandTotal,
      taxTotal: computedTaxTotal,
      discountTotal: 0,
      grandTotal: computedGrandTotal,
      currency,
      notes,
      paymentRegion,
      paymentStatus: 'paid',
      paidAt: new Date().toISOString(),
    }),
    [
      invoiceNumber,
      date,
      merchant,
      category,
      currentUser?.displayName,
      currentUser?.email,
      templateStyle,
      paperFormat,
      items,
      computedGrandTotal,
      computedSubtotal,
      computedTaxTotal,
      currency,
      notes,
      paymentRegion,
    ]
  );

  const digitalPreviewHtml = useMemo(
    () => buildPrintableInvoiceHtml(digitalInvoiceObject, undefined, templateStyle, paperFormat),
    [digitalInvoiceObject, templateStyle, paperFormat]
  );

  const handleSaveDigitalBill = () => {
    if (!merchant.trim() && computedGrandTotal <= 0) {
      setScanError('Enter vendor name or an item amount before saving.');
      return;
    }

    addInvoice({
      invoiceNumber: digitalInvoiceObject.invoiceNumber,
      date: digitalInvoiceObject.date,
      dueDate: digitalInvoiceObject.dueDate,
      senderName: digitalInvoiceObject.senderName,
      senderDetails: digitalInvoiceObject.senderDetails,
      clientName: digitalInvoiceObject.clientName,
      clientEmail: digitalInvoiceObject.clientEmail,
      industry: 'RETAIL',
      templateStyle,
      paperFormat,
      items: digitalInvoiceObject.items,
      subtotal: digitalInvoiceObject.subtotal,
      taxTotal: digitalInvoiceObject.taxTotal,
      discountTotal: 0,
      grandTotal: digitalInvoiceObject.grandTotal,
      currency,
      notes,
      paymentRegion,
      paymentStatus: 'paid',
      paidAt: new Date().toISOString(),
    });

    if (alsoLogExpense) {
      const expensePayload: Partial<Transaction> = {
        merchant: merchant || 'Digitized Bill',
        amount: computedGrandTotal,
        category: category || 'General',
        date: digitalInvoiceObject.date,
        paymentMethod,
        notes: `Digitized bill #${digitalInvoiceObject.invoiceNumber}`,
        status: 'completed',
      };
      if (onSave) {
        onSave(expensePayload);
      } else {
        addTransaction({
          merchant: expensePayload.merchant!,
          amount: Number(expensePayload.amount) || 0,
          category: expensePayload.category!,
          date: expensePayload.date!,
          paymentMethod: expensePayload.paymentMethod,
          notes: expensePayload.notes,
        });
      }
    }

    setStatusMsg('Saved digital bill to Invoices.');
    window.setTimeout(() => {
      setStatusMsg(null);
      onSavedInvoice?.();
    }, 900);
  };

  return (
    <div className="space-y-6 animate-enter">
      {/* Header */}
      <div className="rounded-3xl border border-[#E5E5E5] dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-neutral-500">
            Paper or Handwritten Bill &rarr; Digital Studio
          </span>
          <h2 className="text-xl sm:text-2xl font-extrabold text-neutral-900 dark:text-white tracking-tight mt-0.5">
            Scan Bill, Pick Swiss Template &amp; Download Digital Copy
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!hasScanned && (
            <button
              type="button"
              onClick={() => {
                setHasScanned(true);
                handleAddLineItem();
              }}
              className="px-3.5 py-2 rounded-xl border border-[#E5E5E5] dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-xs font-semibold cursor-pointer"
            >
              Enter Manually
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-3.5 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-xs font-semibold cursor-pointer"
            >
              Back to Saved Invoices
            </button>
          )}
        </div>
      </div>

      {statusMsg && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-200 text-xs font-bold">
          {statusMsg}
        </div>
      )}

      {/* Top Split: Capture Left / OCR Details Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Camera / Upload Zone */}
        <div className="lg:col-span-5 rounded-3xl border border-[#E5E5E5] dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden relative min-h-[360px] flex flex-col items-center justify-center">
          {isLiveCameraActive ? (
            <div className="relative w-full h-full min-h-[360px] flex flex-col items-center justify-center bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <div className="absolute top-4 inset-x-4 flex justify-between items-center z-20">
                <span className="px-3 py-1 rounded-full bg-black/70 text-white text-[11px] font-mono">
                  Camera Ready
                </span>
                <button
                  type="button"
                  onClick={stopCameraStream}
                  className="px-3 py-1 rounded-full bg-black/70 text-white text-xs font-bold cursor-pointer"
                >
                  Close
                </button>
              </div>
              <button
                type="button"
                onClick={handleCaptureFromCamera}
                className="absolute bottom-5 z-20 px-6 py-2.5 rounded-full bg-white text-neutral-900 text-xs font-bold shadow-lg cursor-pointer"
              >
                Capture Bill Photo
              </button>
            </div>
          ) : preview ? (
            <div className="relative w-full h-full min-h-[360px] flex items-center justify-center bg-[#FAFAFA] dark:bg-neutral-950 p-4">
              <img src={preview} alt="Captured paper bill" className="max-h-[420px] w-auto object-contain rounded-xl" />
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                }}
                className="absolute top-4 right-4 px-3 py-1.5 rounded-xl bg-neutral-900/80 text-white text-xs font-semibold cursor-pointer"
              >
                Replace Image
              </button>
            </div>
          ) : (
            <div className="p-8 text-center flex flex-col items-center justify-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 flex items-center justify-center text-neutral-500">
                <ICONS.Receipt className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-neutral-900 dark:text-white">
                  Snap Printed or Handwritten Bill
                </p>
                <p className="text-xs text-neutral-500 max-w-xs">
                  Extracts vendor, line items, taxes and date cleanly into editable digital bill templates.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={handleOpenCamera}
                  className="px-4 py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer"
                >
                  Open Camera
                </button>
                <label className="px-4 py-2.5 rounded-xl border border-[#E5E5E5] dark:border-neutral-700 bg-[#FAFAFA] dark:bg-neutral-800 text-xs font-bold cursor-pointer">
                  Upload Bill Image / PDF
                  <input type="file" accept="image/*,.pdf" onChange={handleFileChange} className="sr-only" />
                </label>
              </div>
              {cameraError && (
                <p className="text-xs text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 rounded-xl px-3 py-2 max-w-xs">
                  {cameraError}
                </p>
              )}
            </div>
          )}

          {analyzing && (
            <div className="absolute inset-0 bg-white/92 dark:bg-neutral-900/92 backdrop-blur-sm z-30 flex flex-col items-center justify-center gap-3">
              <div className="w-9 h-9 border-2 border-neutral-900 dark:border-white border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                Reading line items from bill...
              </p>
            </div>
          )}
        </div>

        {/* Right: Extracted Structured Data Editor */}
        <div className="lg:col-span-7 rounded-3xl border border-[#E5E5E5] dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-[#E5E5E5] dark:border-neutral-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-neutral-900 dark:text-white">
                {hasScanned ? 'Extracted Digital Bill Details' : 'Bill Details (Auto-Filled by OCR)'}
              </h3>
            </div>
            <button
              type="button"
              onClick={handleAddLineItem}
              className="px-3 py-1.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer"
            >
              + Add Item
            </button>
          </div>

          {scanError && (
            <div className="px-3.5 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs">
              {scanError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="text-[10px] font-mono uppercase text-neutral-500 font-bold">Vendor / Issuer</label>
              <input
                type="text"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="Merchant or store name"
                className="w-full mt-1 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-bold outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-neutral-500 font-bold">Bill #</label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full mt-1 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono font-bold outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] font-mono uppercase text-neutral-500 font-bold">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full mt-1 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-neutral-500 font-bold">Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full mt-1 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-xl px-3 py-2 text-xs outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-neutral-500 font-bold">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full mt-1 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-bold outline-none"
              >
                <option value="₹">₹ (INR)</option>
                <option value="$">$ (USD)</option>
                <option value="€">€ (EUR)</option>
                <option value="£">£ (GBP)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase text-neutral-500 font-bold">Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as 'UPI' | 'PAYPAL' | 'CARD' | 'CASH')}
                className="w-full mt-1 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-xl px-3 py-2 text-xs font-bold outline-none"
              >
                <option value="CASH">Cash</option>
                {paymentRegion === 'IN' ? (
                  <option value="UPI">UPI</option>
                ) : (
                  <option value="PAYPAL">PayPal</option>
                )}
                <option value="CARD">Card</option>
              </select>
            </div>
          </div>

          {/* Itemized Table */}
          <div className="space-y-2 max-h-[210px] overflow-y-auto pr-1">
            {items.length === 0 ? (
              <div className="p-4 rounded-2xl border border-dashed border-[#E5E5E5] dark:border-neutral-800 text-center text-xs text-neutral-500">
                Upload or capture a paper bill on the left to extract line items automatically.
              </div>
            ) : (
              items.map((item, idx) => (
                <div key={item.id} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => handleItemChange(idx, 'description', e.target.value)}
                    placeholder="Item description"
                    className="col-span-5 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs outline-none"
                  />
                  <input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                    className="col-span-2 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-lg px-2 py-1.5 text-xs font-mono outline-none"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={item.unitPrice}
                    onChange={(e) => handleItemChange(idx, 'unitPrice', e.target.value)}
                    className="col-span-2 bg-[#FAFAFA] dark:bg-neutral-800 border border-[#E5E5E5] dark:border-neutral-700 rounded-lg px-2 py-1.5 text-xs font-mono outline-none"
                  />
                  <div className="col-span-2 text-right font-mono text-xs font-bold tabular-nums">
                    {currency}
                    {item.total.toFixed(2)}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveLineItem(idx)}
                    className="col-span-1 text-center text-neutral-400 hover:text-rose-500 text-xs cursor-pointer"
                  >
                    &times;
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#E5E5E5] dark:border-neutral-800">
            <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300 cursor-pointer">
              <input
                type="checkbox"
                checked={alsoLogExpense}
                onChange={(e) => setAlsoLogExpense(e.target.checked)}
                className="rounded border-neutral-300"
              />
              <span>Also log this bill to Daily Expenses</span>
            </label>
            <div className="text-right">
              <span className="text-[10px] font-mono uppercase text-neutral-500 mr-2">Digital Bill Total</span>
              <span className="text-lg font-extrabold font-mono tabular-nums text-neutral-900 dark:text-white">
                {currency}
                {computedGrandTotal.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Split: Template Design Library + Live Swiss Paper Digital Bill Preview */}
      <div className="rounded-3xl border border-[#E5E5E5] dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-extrabold text-neutral-900 dark:text-white tracking-tight">
              Digital Bill Template Library &amp; Live Output
            </h3>
            <p className="text-xs text-neutral-500">
              Select a template layout and paper format, then download or save to Invoices.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => printFormattedInvoiceViaIframe(digitalPreviewHtml)}
              className="px-4 py-2 rounded-xl border border-[#E5E5E5] dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-xs font-bold cursor-pointer"
            >
              Print / Save PDF
            </button>
            <button
              type="button"
              onClick={() =>
                triggerFileDownload(
                  digitalPreviewHtml,
                  `${digitalInvoiceObject.invoiceNumber}-digital-bill.html`,
                  'text/html'
                )
              }
              className="px-4 py-2 rounded-xl border border-[#E5E5E5] dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-xs font-bold cursor-pointer"
            >
              Download Digital (.html)
            </button>
            <button
              type="button"
              onClick={handleSaveDigitalBill}
              className="px-5 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer"
            >
              Save to Invoices
            </button>
          </div>
        </div>

        {/* 5-Template Card Library + Paper Format Selector */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-9 grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {(Object.keys(TEMPLATE_LABELS) as InvoiceTemplateStyle[]).map((tpl) => {
              const info = TEMPLATE_LABELS[tpl];
              const selected = templateStyle === tpl;
              return (
                <button
                  key={tpl}
                  type="button"
                  onClick={() => setTemplateStyle(tpl)}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer space-y-2 ${
                    selected
                      ? 'border-neutral-900 dark:border-white bg-[#FAFAFA] dark:bg-white/10 shadow-xs'
                      : 'border-[#E5E5E5] dark:border-neutral-800 hover:border-neutral-400'
                  }`}
                >
                  <div
                    className="h-5 rounded-md border border-[#E5E5E5] flex items-center px-1.5"
                    style={{ backgroundColor: info.swatchBg }}
                  >
                    <span className="w-4 h-1 rounded-full" style={{ backgroundColor: info.swatchAccent }} />
                  </div>
                  <p className="text-xs font-bold text-neutral-900 dark:text-white leading-tight">{info.label}</p>
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-3 grid grid-cols-3 lg:grid-cols-1 gap-2">
            {(Object.keys(PAPER_FORMAT_SPECS) as InvoicePaperFormat[]).map((pf) => (
              <button
                key={pf}
                type="button"
                onClick={() => setPaperFormat(pf)}
                className={`px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                  paperFormat === pf
                    ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 border-neutral-900 dark:border-white'
                    : 'bg-[#FAFAFA] dark:bg-neutral-950 border-[#E5E5E5] dark:border-neutral-800 text-neutral-600 dark:text-neutral-300'
                }`}
              >
                {PAPER_FORMAT_SPECS[pf].badge}
              </button>
            ))}
          </div>
        </div>

        {/* Live Swiss Preview Frame */}
        <div className="rounded-2xl bg-[#F4F4F5] dark:bg-neutral-950 p-4 border border-[#E5E5E5] dark:border-neutral-800 overflow-x-auto">
          <div className="mx-auto" style={{ maxWidth: `${PAPER_FORMAT_SPECS[paperFormat].widthPx}px` }}>
            <iframe
              title="Digital Bill Template Preview"
              srcDoc={digitalPreviewHtml}
              className="w-full h-[500px] bg-white rounded-xl border border-[#E5E5E5]"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReceiptScanner;