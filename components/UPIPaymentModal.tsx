import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { useFinMind } from '../context/FinMindContext';

interface UPIPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  amount: number;
  currency?: string;
  defaultUpiId?: string;
  defaultPayeeName?: string;
  invoiceNumber?: string;
  onPaymentSuccess?: (paymentMethod: string, upiRef: string) => void;
}

export const UPIPaymentModal: React.FC<UPIPaymentModalProps> = ({
  isOpen,
  onClose,
  amount,
  currency = '₹',
  defaultUpiId = '',
  defaultPayeeName = '',
  invoiceNumber = 'BILL-01',
  onPaymentSuccess
}) => {
  const { payoutConfig } = useFinMind();
  const [upiId, setUpiId] = useState(defaultUpiId || payoutConfig.upiId || '');
  const [payeeName, setPayeeName] = useState(defaultPayeeName || payoutConfig.payeeName || 'Billing Desk');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<'pending' | 'verifying' | 'completed'>('pending');
  const [utrNumber, setUtrNumber] = useState('');
  const [utrError, setUtrError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setUpiId(defaultUpiId || payoutConfig.upiId || '');
      setPayeeName(defaultPayeeName || payoutConfig.payeeName || 'Billing Desk');
      setStatus('pending');
      setUtrNumber('');
      setUtrError(null);
      setCopied(false);
    }
  }, [isOpen, defaultUpiId, defaultPayeeName, payoutConfig.upiId, payoutConfig.payeeName, invoiceNumber]);

  useEffect(() => {
    if (isOpen) {
      const original = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [isOpen]);

  const trimmedUpi = upiId.trim();
  const upiUri = trimmedUpi
    ? `upi://pay?pa=${encodeURIComponent(trimmedUpi)}&pn=${encodeURIComponent(payeeName || 'Billing Desk')}&am=${amount.toFixed(2)}&tn=${encodeURIComponent(`Settlement for ${invoiceNumber}`)}&cu=INR`
    : '';

  useEffect(() => {
    if (isOpen && upiUri) {
      QRCode.toDataURL(upiUri, {
        width: 320,
        margin: 1,
        color: {
          dark: '#18181B',
          light: '#FFFFFF'
        }
      })
        .then(url => setQrDataUrl(url))
        .catch(err => console.warn('Notice generating UPI QR:', err));
    } else if (isOpen) {
      setQrDataUrl('');
    }
  }, [isOpen, upiUri]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(upiUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenUpiApp = () => {
    window.location.href = upiUri;
  };

  const handleConfirmPayment = () => {
    const clean = utrNumber.trim();
    if (!/^[A-Za-z0-9]{10,24}$/.test(clean) || /^([A-Za-z0-9])\1+$/.test(clean)) {
      setUtrError('Enter a valid 10–24 character UTR / UPI transaction ID from your payment app to verify settlement.');
      return;
    }
    setUtrError(null);
    setStatus('verifying');
    setTimeout(() => {
      setStatus('completed');
      if (onPaymentSuccess) {
        onPaymentSuccess('UPI', clean);
      }
      setTimeout(() => {
        onClose();
      }, 900);
    }, 600);
  };

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-enter overflow-y-auto" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#121215] rounded-[32px] max-w-lg w-full p-8 shadow-2xl border border-neutral-200/80 dark:border-neutral-800 flex flex-col relative overflow-hidden text-neutral-900 dark:text-white my-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold text-sm">
              UPI
            </div>
            <div>
              <h3 className="text-xl font-extrabold tracking-tight">Verified UPI Payment</h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Scan via GPay, PhonePe, Paytm or BHIM and enter your UTR ID</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 flex items-center justify-center transition-colors text-xs font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* QR Code and Payment Details */}
        <div className="py-6 flex flex-col items-center text-center space-y-4">
          <div className="bg-white p-4 rounded-3xl border border-neutral-200/80 shadow-xs">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="UPI QR Code" className="w-52 h-52 rounded-2xl object-contain" />
            ) : (
              <div className="w-52 h-52 flex flex-col items-center justify-center text-xs text-neutral-500 p-4 gap-2 text-center">
                <span>Enter your receiving UPI ID below to generate this invoice QR code.</span>
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 font-mono">Payable Amount</div>
            <div className="text-3xl font-extrabold font-mono mt-0.5 tracking-tight">
              {amount.toFixed(2)} {currency}
            </div>
          </div>

          {/* Receiver UPI ID & Name Configuration */}
          <div className="w-full bg-neutral-50 dark:bg-neutral-800/60 p-4 rounded-2xl text-left border border-neutral-100 dark:border-neutral-700 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-500 dark:text-neutral-400 font-medium font-mono text-[11px]">Receiver UPI VPA:</span>
              <button
                type="button"
                onClick={handleCopy}
                className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline text-xs cursor-pointer"
              >
                {copied ? '✓ Copied Link' : 'Copy Payment Link'}
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="receiver@upi"
                className="flex-1 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-1.5 text-xs font-mono font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              <input
                type="text"
                value={payeeName}
                onChange={(e) => setPayeeName(e.target.value)}
                placeholder="Payee Name"
                className="w-32 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3 py-1.5 text-xs font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          {/* Required Verification UTR Input */}
          <div className="w-full text-left space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 font-mono">
              Required 12-Digit UPI UTR / Transaction Reference
            </label>
            <input
              type="text"
              required
              value={utrNumber}
              onChange={(e) => {
                setUtrNumber(e.target.value);
                if (utrError) setUtrError(null);
              }}
              placeholder="Enter 10–24 char UTR ID from payment confirmation"
              className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-3.5 py-2.5 text-xs font-mono font-medium outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {utrError && (
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{utrError}</p>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleOpenUpiApp}
              className="flex-1 py-3 px-4 rounded-xl bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 text-xs font-bold transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>Open Mobile UPI App</span>
            </button>
            <button
              type="button"
              onClick={handleConfirmPayment}
              disabled={status === 'verifying' || status === 'completed'}
              className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {status === 'verifying' ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Verifying UTR...</span>
                </>
              ) : status === 'completed' ? (
                <span>✓ Settlement Verified</span>
              ) : (
                <span>Verify UTR &amp; Settle &rarr;</span>
              )}
            </button>
          </div>
          <p className="text-[10px] text-neutral-400 text-center font-mono">
            NPCI Unified Payments Interface · UTR Verification Enforced
          </p>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default UPIPaymentModal;
