import React, { useState, useRef, useEffect } from 'react';
import { analyzeReceipt } from '../services/geminiService';
import { Transaction } from '../types';
import { ICONS } from '../constants';
import { UPIPaymentModal } from './UPIPaymentModal';
import { useFinMind } from '../context/FinMindContext';
import { diagnoseMediaAccessFailure } from '../utils/mediaPermissions';

interface ReceiptScannerProps {
  onSave: (data: Partial<Transaction>) => void;
  onCancel: () => void;
}

const ReceiptScanner: React.FC<ReceiptScannerProps> = ({ onSave, onCancel }) => {
  const { currencySymbol } = useFinMind();
  const [analyzing, setAnalyzing] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  // Camera integration state
  const [isLiveCameraActive, setIsLiveCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraIframeBlocked, setCameraIframeBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Editable fields
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState('Retail');
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'CARD' | 'CASH'>('UPI');
  const [isUpiModalOpen, setIsUpiModalOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

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

  const handleOpenCamera = async () => {
    setCameraError(null);
    setCameraIframeBlocked(false);
    if (!navigator?.mediaDevices?.getUserMedia) {
      const diag = await diagnoseMediaAccessFailure('camera', new Error('UNSUPPORTED_MEDIA'));
      setCameraError(diag.message);
      setCameraIframeBlocked(diag.isIframeBlocked || diag.isUnsupported);
      return;
    }

    let stream: MediaStream;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
      } catch (innerErr: any) {
        if (
          innerErr?.name === 'NotAllowedError' ||
          innerErr?.name === 'PermissionDeniedError' ||
          innerErr?.name === 'SecurityError'
        ) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        } else {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
      }
      streamRef.current = stream;
      setIsLiveCameraActive(true);
    } catch (err: any) {
      const diag = await diagnoseMediaAccessFailure('camera', err);
      setCameraError(diag.message);
      setCameraIframeBlocked(diag.isIframeBlocked || diag.isUnsupported);
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

    const base64Data = dataUrl.split(',')[1];
    setAnalyzing(true);
    try {
      const data = await analyzeReceipt(base64Data);
      if (data) {
        if (data.merchant) setMerchant(data.merchant);
        if (typeof data.amount === 'number') setAmount(data.amount);
        if (data.date) setDate(data.date);
        if (data.category) setCategory(data.category);
        setHasScanned(true);
      }
    } catch (err) {
      console.warn('OCR error', err);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopCameraStream();
    setValidationError(null);
    setAnalyzing(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result as string;
      setPreview(base64);
      const base64Data = base64.split(',')[1];
      const data = await analyzeReceipt(base64Data);
      if (data) {
        if (data.merchant) setMerchant(data.merchant);
        if (typeof data.amount === 'number') setAmount(data.amount);
        if (data.date) setDate(data.date);
        if (data.category) setCategory(data.category);
        setHasScanned(true);
      }
      setAnalyzing(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!merchant && amount === 0) {
      setValidationError("Please enter a merchant name or amount before saving.");
      return;
    }
    setValidationError(null);
    onSave({
      merchant: merchant || 'Scanned Merchant',
      amount: Number(amount) || 0,
      date: date || new Date().toISOString().split('T')[0],
      category: category || 'General',
      paymentMethod,
      status: 'completed'
    });
  };

  return (
    <div className="h-full flex flex-col space-y-6 animate-enter">
      <div className="flex items-center justify-between pb-4 border-b border-neutral-100 dark:border-neutral-800">
        <div>
          <h3 className="text-2xl font-extrabold text-neutral-900 dark:text-white tracking-tight">
            Receipt & Bill Optical Scanner
          </h3>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            Scan physical or digital paper receipts to extract line totals and merchant data without mock figures.
          </p>
        </div>
        <button 
          onClick={onCancel} 
          className="text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white font-semibold text-xs px-3.5 py-1.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 transition-colors"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1">
        {/* Upload & Camera Area */}
        <div className="group relative w-full h-full min-h-[420px] bg-white dark:bg-neutral-900 rounded-[32px] border-2 border-dashed border-neutral-200 dark:border-neutral-800 hover:border-indigo-500 transition-all duration-300 flex flex-col items-center justify-center overflow-hidden shadow-xs">
          {isLiveCameraActive ? (
            <div className="relative w-full h-full flex flex-col items-center justify-center bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover rounded-[30px]"
              />
              {/* Camera Overlays & Shutter Controls */}
              <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-30">
                <span className="px-3 py-1 rounded-full bg-black/60 backdrop-blur-md text-white text-[11px] font-mono flex items-center gap-1.5 border border-white/20">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  Live Viewfinder
                </span>
                <button
                  type="button"
                  onClick={stopCameraStream}
                  className="px-3 py-1 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md text-white text-xs font-bold border border-white/20 transition-all cursor-pointer"
                >
                  ✕ Close
                </button>
              </div>

              <div className="absolute bottom-6 z-30 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCaptureFromCamera}
                  className="px-6 py-3 rounded-full bg-white text-neutral-900 font-extrabold text-xs shadow-2xl flex items-center gap-2 hover:bg-neutral-100 transition-all active:scale-95 cursor-pointer border-2 border-indigo-500"
                >
                  <span className="w-3.5 h-3.5 rounded-full bg-indigo-600"></span>
                  <span>Snap Receipt Photo</span>
                </button>
              </div>
            </div>
          ) : preview ? (
            <div className="relative w-full h-full flex items-center justify-center">
              <img src={preview} alt="Receipt" className="w-full h-full object-contain p-4" />
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setHasScanned(false);
                }}
                className="absolute top-4 right-4 px-3 py-1.5 rounded-xl bg-black/60 hover:bg-black/80 text-white text-xs font-bold backdrop-blur-md transition-all cursor-pointer z-30"
              >
                ✕ Retake
              </button>
            </div>
          ) : (
            <div className="text-center p-8 flex flex-col items-center justify-center">
              <div className="w-16 h-16 bg-neutral-50 dark:bg-neutral-800 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:bg-indigo-50 dark:group-hover:bg-neutral-700 group-hover:shadow-md transition-all">
                <ICONS.Receipt className="w-8 h-8 text-neutral-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400" />
              </div>
              <p className="font-bold text-neutral-900 dark:text-white text-sm">Select or Snap Receipt / Bill Photo</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">Camera & file access • Supports PNG, JPG, WebP</p>
              
              {/* Dual Action Triggers: Camera & File Upload */}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3 z-30">
                <button
                  type="button"
                  onClick={handleOpenCamera}
                  className="px-4 py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95"
                >
                  <svg className="w-4 h-4 text-emerald-400 dark:text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Open Camera</span>
                </button>

                <label className="px-4 py-2.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-95">
                  <svg className="w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <span>Upload Image</span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleFileChange} 
                    className="sr-only" 
                  />
                </label>
              </div>

              {cameraError && (
                <div className="mt-4 text-left text-xs text-rose-700 dark:text-rose-200 bg-rose-500/10 border border-rose-500/25 rounded-2xl p-3.5 max-w-sm space-y-2.5">
                  <p className="leading-relaxed">{cameraError}</p>
                  {cameraIframeBlocked && (
                    <a
                      href="/workspace/scanner"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block px-3.5 py-1.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 font-bold text-xs whitespace-nowrap"
                    >
                      Open Scanner in Full Tab &rarr;
                    </a>
                  )}
                </div>
              )}

              <span className="inline-block mt-4 px-2.5 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-[10px] font-mono text-neutral-500 dark:text-neutral-400">
                🔒 Transient in-memory processing
              </span>
            </div>
          )}
          
          {analyzing && (
            <div className="absolute inset-0 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-sm z-30 flex flex-col items-center justify-center">
              <div className="w-10 h-10 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3"></div>
              <p className="font-bold text-neutral-900 dark:text-white text-xs">Extracting receipt data and merchant details...</p>
            </div>
          )}
        </div>

        {/* Results Area */}
        <div className="flex flex-col h-full">
          {hasScanned ? (
            <div className="glass-card dark:bg-neutral-900/80 dark:border-neutral-800 p-8 rounded-[32px] h-full flex flex-col border border-neutral-100 shadow-xs animate-enter">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center text-sm font-bold">
                    ✓
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-neutral-900 dark:text-white">Telemetry Extracted</h3>
                    <p className="text-xs text-neutral-400">Review or adjust details before saving</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsUpiModalOpen(true)}
                  className="px-3.5 py-1.5 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                >
                  <span>⚡ Pay via UPI</span>
                </button>
              </div>
              
              <div className="space-y-4 flex-1">
                <div className="space-y-1">
                  <label className="text-neutral-500 dark:text-neutral-400 text-xs font-bold uppercase tracking-wider font-mono">
                    Merchant / Store Name
                  </label>
                  <input 
                    type="text" 
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                    placeholder="Store or Vendor Name"
                    className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 font-bold text-neutral-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-neutral-500 dark:text-neutral-400 text-xs font-bold uppercase tracking-wider font-mono">
                    Amount ({currencySymbol})
                  </label>
                  <div className="relative">
                    <input 
                      type="number" 
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                      className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 font-mono font-bold text-neutral-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-neutral-400 font-mono text-xs font-bold">
                      {currencySymbol}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-neutral-500 dark:text-neutral-400 text-xs font-bold uppercase tracking-wider font-mono">Date</label>
                    <input 
                      type="date" 
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 text-neutral-900 dark:text-white font-mono focus:ring-2 focus:ring-indigo-500 outline-none text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-neutral-500 dark:text-neutral-400 text-xs font-bold uppercase tracking-wider font-mono">Payment Method</label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as any)}
                      className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 text-neutral-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none text-xs font-bold"
                    >
                      <option value="UPI">UPI</option>
                      <option value="CARD">Card</option>
                      <option value="CASH">Cash</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-neutral-500 dark:text-neutral-400 text-xs font-bold uppercase tracking-wider font-mono">Category</label>
                  <input 
                    type="text" 
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="e.g. Groceries, Tech, Dining"
                    className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 text-neutral-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none text-xs"
                  />
                </div>
              </div>

              <div className="pt-6 border-t border-neutral-100 dark:border-neutral-800 mt-auto space-y-3">
                {validationError && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2">
                    <span>⚠️</span>
                    <span>{validationError}</span>
                  </div>
                )}
                <button 
                  onClick={handleSave}
                  className="w-full py-3.5 bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-xl font-bold text-xs transition-all shadow-sm active:scale-95"
                >
                  Record into Real Ledger &rarr;
                </button>
              </div>
            </div>
          ) : (
            <div className="glass-card dark:bg-neutral-900/80 dark:border-neutral-800 p-8 rounded-[32px] h-full flex flex-col justify-center items-center text-center border border-white/70 shadow-xs">
              <div className="w-16 h-16 rounded-3xl bg-neutral-50 dark:bg-neutral-800 flex items-center justify-center text-neutral-400 mb-4">
                📷
              </div>
              <h4 className="text-base font-bold text-neutral-900 dark:text-white">Awaiting Receipt Photo</h4>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 max-w-xs leading-relaxed">
                Upload or snap a paper receipt on the left. The optical engine will immediately parse the figures and let you confirm before recording.
              </p>
            </div>
          )}
        </div>
      </div>

      {isUpiModalOpen && (
        <UPIPaymentModal
          isOpen={isUpiModalOpen}
          onClose={() => setIsUpiModalOpen(false)}
          amount={amount}
          currency={currencySymbol}
          defaultPayeeName={merchant || 'Store Merchant'}
          invoiceNumber={`RCPT-${Date.now().toString().slice(-4)}`}
          onPaymentSuccess={(_method, upiRef) => {
            onSave({
              merchant: merchant || 'Scanned Merchant',
              amount: Number(amount) || 0,
              date,
              category,
              paymentMethod: 'UPI',
              upiReference: upiRef,
              status: 'completed'
            });
          }}
        />
      )}
    </div>
  );
};

export default ReceiptScanner;