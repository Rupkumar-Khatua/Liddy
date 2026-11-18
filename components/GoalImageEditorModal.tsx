import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { editGoalVisualImage } from '../services/geminiService';
import type { VisualAspectRatio } from '../types';

export type EditorFilterPreset = 'original' | 'crisp' | 'warm_gold' | 'cool_slate' | 'mono';
export type EditorFrameStyle = 'none' | 'swiss' | 'mat' | 'obsidian';
export type EditorCropRatio = 'original' | '16:9' | '1:1' | '4:3' | '9:16';

export interface GoalImageEditorModalProps {
  imageUrl: string;
  initialTitle: string;
  aspectRatio?: VisualAspectRatio;
  onClose: () => void;
  onApplyToCurrent?: (editedDataUrl: string, updatedTitle?: string) => void;
  onSaveCopy: (editedDataUrl: string, updatedTitle: string) => void;
}

const FILTER_LABELS: Array<{ id: EditorFilterPreset; label: string }> = [
  { id: 'original', label: 'Original' },
  { id: 'crisp', label: 'Crisp Swiss' },
  { id: 'warm_gold', label: 'Warm Gold' },
  { id: 'cool_slate', label: 'Cool Slate' },
  { id: 'mono', label: 'Monochrome' },
];

const FRAME_LABELS: Array<{ id: EditorFrameStyle; label: string }> = [
  { id: 'none', label: 'Borderless' },
  { id: 'swiss', label: 'Swiss Hairline' },
  { id: 'mat', label: 'Gallery Mat' },
  { id: 'obsidian', label: 'Obsidian Frame' },
];

const CROP_OPTIONS: Array<{ id: EditorCropRatio; label: string }> = [
  { id: 'original', label: 'Original' },
  { id: '16:9', label: '16:9 Wide' },
  { id: '1:1', label: '1:1 Square' },
  { id: '4:3', label: '4:3 Print' },
  { id: '9:16', label: '9:16 Story' },
];

const QUICK_FINANCIAL_EDITS = [
  'Add warm golden-hour sunlight and architectural glass clarity',
  'Convert setting into minimalist Swiss editorial photography',
  'Make lighting dramatic dusk with clean slate and emerald accents',
  'Remove visual clutter and emphasize clean luxury textures',
];

function parseRatio(ratio: EditorCropRatio, naturalW: number, naturalH: number): number {
  if (ratio === '16:9') return 16 / 9;
  if (ratio === '1:1') return 1;
  if (ratio === '4:3') return 4 / 3;
  if (ratio === '9:16') return 9 / 16;
  return naturalH > 0 ? naturalW / naturalH : 16 / 9;
}

export const GoalImageEditorModal: React.FC<GoalImageEditorModalProps> = ({
  imageUrl,
  initialTitle,
  aspectRatio = '16:9',
  onClose,
  onApplyToCurrent,
  onSaveCopy,
}) => {
  const [activeTab, setActiveTab] = useState<'ai' | 'manual'>('ai');
  const [workingImage, setWorkingImage] = useState(imageUrl);
  const [historyStack, setHistoryStack] = useState<string[]>([imageUrl]);

  // AI Prompt Editing State
  const [editPrompt, setEditPrompt] = useState('');
  const [isApplyingAi, setIsApplyingAi] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Manual Canvas Controls State
  const [goalTitleOverlay, setGoalTitleOverlay] = useState(initialTitle || 'Wealth Milestone');
  const [showOverlayText, setShowOverlayText] = useState(false);
  const [metricBadgeText, setMetricBadgeText] = useState('');
  const [overlayPosition, setOverlayPosition] = useState<'bottom' | 'top' | 'center'>('bottom');
  const [filterPreset, setFilterPreset] = useState<EditorFilterPreset>('original');
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [cropRatio, setCropRatio] = useState<EditorCropRatio>('original');
  const [zoomScale, setZoomScale] = useState(1);
  const [frameStyle, setFrameStyle] = useState<EditorFrameStyle>('none');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadedImgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoadTick, setImgLoadTick] = useState(0);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      loadedImgRef.current = img;
      setImgLoadTick((t) => t + 1);
    };
    img.src = workingImage;
  }, [workingImage]);

  const hasManualEdits =
    showOverlayText ||
    filterPreset !== 'original' ||
    brightness !== 100 ||
    contrast !== 100 ||
    cropRatio !== 'original' ||
    zoomScale > 1.01 ||
    frameStyle !== 'none';

  const renderCanvasOutput = () => {
    const canvas = canvasRef.current;
    const img = loadedImgRef.current;
    if (!canvas || !img || !img.naturalWidth || !img.naturalHeight) return null;

    const naturalW = img.naturalWidth;
    const naturalH = img.naturalHeight;
    const targetAspect = parseRatio(cropRatio, naturalW, naturalH);

    // Output resolution capped safely for clean exports & Firestore compatibility
    const maxEdge = 1280;
    let contentW = maxEdge;
    let contentH = Math.round(maxEdge / targetAspect);
    if (contentH > maxEdge) {
      contentH = maxEdge;
      contentW = Math.round(maxEdge * targetAspect);
    }

    const pad = frameStyle === 'mat' ? 48 : frameStyle === 'obsidian' ? 44 : frameStyle === 'swiss' ? 24 : 0;
    const totalW = contentW + pad * 2;
    const totalH = contentH + pad * 2;

    canvas.width = totalW;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Frame Background
    if (frameStyle === 'obsidian') {
      ctx.fillStyle = '#0A0B0E';
      ctx.fillRect(0, 0, totalW, totalH);
    } else if (frameStyle === 'mat' || frameStyle === 'swiss') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, totalW, totalH);
    } else {
      ctx.clearRect(0, 0, totalW, totalH);
    }

    // Clip inner art area
    ctx.save();
    ctx.beginPath();
    ctx.rect(pad, pad, contentW, contentH);
    ctx.clip();

    // Build filter CSS string
    const filterParts: string[] = [`brightness(${brightness}%)`, `contrast(${contrast}%)`];
    if (filterPreset === 'crisp') filterParts.push('saturate(114%)', 'contrast(106%)');
    if (filterPreset === 'warm_gold') filterParts.push('sepia(18%)', 'saturate(116%)');
    if (filterPreset === 'cool_slate') filterParts.push('saturate(85%)', 'hue-rotate(12deg)');
    if (filterPreset === 'mono') filterParts.push('grayscale(100%)', 'contrast(108%)');
    ctx.filter = filterParts.join(' ');

    // Cover-fit + zoom source calculation
    const naturalAspect = naturalW / naturalH;
    let sx = 0;
    let sy = 0;
    let sw = naturalW;
    let sh = naturalH;

    if (naturalAspect > targetAspect) {
      sw = naturalH * targetAspect;
      sx = (naturalW - sw) / 2;
    } else {
      sh = naturalW / targetAspect;
      sy = (naturalH - sh) / 2;
    }

    if (zoomScale > 1) {
      const zoomedW = sw / zoomScale;
      const zoomedH = sh / zoomScale;
      sx += (sw - zoomedW) / 2;
      sy += (sh - zoomedH) / 2;
      sw = zoomedW;
      sh = zoomedH;
    }

    ctx.drawImage(img, sx, sy, sw, sh, pad, pad, contentW, contentH);
    ctx.filter = 'none';

    // Goal Title Overlay
    if (showOverlayText && (goalTitleOverlay.trim() || metricBadgeText.trim())) {
      const stripH = Math.round(contentH * 0.24);
      const yBase =
        overlayPosition === 'top'
          ? pad
          : overlayPosition === 'center'
          ? pad + Math.round((contentH - stripH) / 2)
          : pad + contentH - stripH;

      const grad = ctx.createLinearGradient(0, yBase, 0, yBase + stripH);
      if (overlayPosition === 'top') {
        grad.addColorStop(0, 'rgba(10,11,14,0.82)');
        grad.addColorStop(1, 'rgba(10,11,14,0)');
      } else if (overlayPosition === 'center') {
        grad.addColorStop(0, 'rgba(10,11,14,0.68)');
        grad.addColorStop(1, 'rgba(10,11,14,0.68)');
      } else {
        grad.addColorStop(0, 'rgba(10,11,14,0)');
        grad.addColorStop(1, 'rgba(10,11,14,0.86)');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(pad, yBase, contentW, stripH);

      const textPadX = Math.max(28, Math.round(contentW * 0.045));
      const titleFontPx = Math.max(24, Math.round(contentW * 0.036));
      const badgeFontPx = Math.max(14, Math.round(contentW * 0.019));
      const textAnchorY =
        overlayPosition === 'top'
          ? pad + Math.round(stripH * 0.42)
          : overlayPosition === 'center'
          ? yBase + Math.round(stripH * 0.56)
          : pad + contentH - Math.round(contentH * 0.055);

      if (metricBadgeText.trim()) {
        ctx.font = `700 ${badgeFontPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.fillStyle = '#34D399';
        ctx.fillText(metricBadgeText.trim().toUpperCase(), pad + textPadX, textAnchorY - titleFontPx * 1.05);
      }

      if (goalTitleOverlay.trim()) {
        ctx.font = `800 ${titleFontPx}px -apple-system, BlinkMacSystemFont, Inter, sans-serif`;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(goalTitleOverlay.trim(), pad + textPadX, textAnchorY, contentW - textPadX * 2);
      }
    }

    ctx.restore();

    if (frameStyle === 'swiss') {
      ctx.strokeStyle = '#E5E5E5';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, totalW - 2, totalH - 2);
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 1;
      ctx.strokeRect(pad - 1, pad - 1, contentW + 2, contentH + 2);
    } else if (frameStyle === 'mat') {
      ctx.strokeStyle = '#E5E5E5';
      ctx.lineWidth = 2;
      ctx.strokeRect(pad - 1, pad - 1, contentW + 2, contentH + 2);
    } else if (frameStyle === 'obsidian') {
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 2;
      ctx.strokeRect(pad - 1, pad - 1, contentW + 2, contentH + 2);
    }

    return canvas.toDataURL('image/png', 0.92);
  };

  useEffect(() => {
    renderCanvasOutput();
  }, [
    imgLoadTick,
    activeTab,
    showOverlayText,
    goalTitleOverlay,
    metricBadgeText,
    overlayPosition,
    filterPreset,
    brightness,
    contrast,
    cropRatio,
    zoomScale,
    frameStyle,
  ]);

  const exportFinalDataUrl = (): string => {
    if (hasManualEdits || workingImage !== imageUrl) {
      const rendered = renderCanvasOutput();
      if (rendered) return rendered;
    }
    return workingImage;
  };

  const handleApplyAiEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPrompt.trim() || isApplyingAi) return;
    setIsApplyingAi(true);
    setAiError(null);
    setAiMessage('Refining financial goal visual...');
    try {
      const sourceToEdit = exportFinalDataUrl();
      const targetRatio: VisualAspectRatio = cropRatio !== 'original' ? cropRatio : aspectRatio;
      const updated = await editGoalVisualImage(sourceToEdit, editPrompt.trim(), targetRatio);
      if (updated?.imageUrl) {
        setWorkingImage(updated.imageUrl);
        setHistoryStack((prev) => [...prev, updated.imageUrl!]);
        setEditPrompt('');
        setAiMessage(updated.statusMessage || 'Visual refined cleanly.');
      }
    } catch (err: any) {
      setAiError(err?.message || 'Unable to apply prompt edit. Try adjusting wording or use manual controls.');
    } finally {
      setIsApplyingAi(false);
    }
  };

  const handleUndo = () => {
    if (historyStack.length <= 1) return;
    const next = historyStack.slice(0, -1);
    setHistoryStack(next);
    setWorkingImage(next[next.length - 1]);
    setAiMessage('Reverted to previous revision.');
    setAiError(null);
  };

  const handleDownloadPng = () => {
    const url = exportFinalDataUrl();
    const link = document.createElement('a');
    link.href = url;
    const slug = (goalTitleOverlay || 'financial-goal').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    link.download = `liddy-goal-${slug || 'visual'}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setStatusNotice('Downloaded PNG image.');
    setTimeout(() => setStatusNotice(null), 2500);
  };

  const handleApplyPreview = () => {
    const url = exportFinalDataUrl();
    onApplyToCurrent?.(url, goalTitleOverlay.trim() || initialTitle);
    onClose();
  };

  const handleSaveAsNewGoal = () => {
    const url = exportFinalDataUrl();
    onSaveCopy(url, goalTitleOverlay.trim() || initialTitle || 'Edited Financial Milestone');
    setStatusNotice('Saved edited copy to Financial Vision Gallery.');
    setTimeout(() => {
      onClose();
    }, 500);
  };

  const modal = (
    <div
      className="fixed inset-0 z-[9996] flex items-center justify-center p-3 sm:p-6 bg-neutral-950/45 dark:bg-black/65 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-[#121216] border border-[#E5E5E5] dark:border-neutral-800 rounded-[28px] max-w-5xl w-full p-5 sm:p-7 shadow-2xl my-auto text-neutral-900 dark:text-neutral-100 space-y-5 animate-enter"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#E5E5E5] dark:border-neutral-800">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-500">
              Financial Goal Studio
            </p>
            <h3 className="text-xl font-extrabold tracking-tight text-neutral-900 dark:text-white">
              Inspect &amp; Edit Goal Visual
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {historyStack.length > 1 && (
              <button
                type="button"
                onClick={handleUndo}
                className="px-3 py-1.5 rounded-xl border border-[#E5E5E5] dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                Undo AI Edit ({historyStack.length - 1})
              </button>
            )}
            <button
              type="button"
              onClick={handleDownloadPng}
              className="px-3.5 py-2 rounded-xl border border-[#E5E5E5] dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              Download PNG
            </button>
            {onApplyToCurrent && (
              <button
                type="button"
                onClick={handleApplyPreview}
                className="px-4 py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                Apply to Preview
              </button>
            )}
            <button
              type="button"
              onClick={handleSaveAsNewGoal}
              className="px-4 py-2 rounded-xl bg-neutral-950 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              Save to Gallery
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close image editor"
              className="w-9 h-9 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 flex items-center justify-center text-xs font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Live Rendered Canvas Stage */}
          <div className="lg:col-span-7 bg-[#FAFAFA] dark:bg-neutral-950 border border-[#E5E5E5] dark:border-neutral-800 rounded-2xl p-4 flex items-center justify-center min-h-[340px]">
            <canvas
              ref={canvasRef}
              className="max-w-full max-h-[460px] object-contain rounded-lg shadow-sm"
            />
          </div>

          {/* Right Controls Panel */}
          <div className="lg:col-span-5 space-y-4">
            <div className="grid grid-cols-2 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-800">
              <button
                type="button"
                onClick={() => setActiveTab('ai')}
                className={`py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                  activeTab === 'ai'
                    ? 'bg-white dark:bg-neutral-700 text-neutral-950 dark:text-white shadow-2xs'
                    : 'text-neutral-500 dark:text-neutral-400'
                }`}
              >
                AI Prompt Edit
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('manual')}
                className={`py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                  activeTab === 'manual'
                    ? 'bg-white dark:bg-neutral-700 text-neutral-950 dark:text-white shadow-2xs'
                    : 'text-neutral-500 dark:text-neutral-400'
                }`}
              >
                Manual Controls
              </button>
            </div>

            {activeTab === 'ai' ? (
              <form onSubmit={handleApplyAiEdit} className="space-y-4">
                <div>
                  <label className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 font-bold">
                    Describe Financial Visual Adjustment
                  </label>
                  <textarea
                    rows={4}
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    placeholder="e.g., Shift lighting to calm coastal sunset, add clean architectural lines..."
                    className="w-full mt-1.5 bg-[#FAFAFA] dark:bg-neutral-900 border border-[#E5E5E5] dark:border-neutral-700 rounded-xl p-3 text-xs outline-none focus:border-neutral-900 dark:focus:border-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-500">
                    Quick Refinements
                  </p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {QUICK_FINANCIAL_EDITS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setEditPrompt(preset)}
                        className="text-left px-3 py-2 rounded-xl border border-[#E5E5E5] dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-xs text-neutral-700 dark:text-neutral-300 cursor-pointer"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                {aiError && <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{aiError}</p>}
                {aiMessage && !aiError && (
                  <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{aiMessage}</p>
                )}

                <button
                  type="submit"
                  disabled={isApplyingAi || !editPrompt.trim()}
                  className="w-full py-3 rounded-xl bg-neutral-950 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold disabled:opacity-50 cursor-pointer"
                >
                  {isApplyingAi ? 'Applying AI Edit...' : 'Apply AI Edit'}
                </button>
              </form>
            ) : (
              <div className="space-y-4 max-h-[440px] overflow-y-auto pr-1">
                {/* Goal Title Overlay */}
                <div className="p-3.5 rounded-2xl border border-[#E5E5E5] dark:border-neutral-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">Goal Title Overlay</span>
                    <button
                      type="button"
                      onClick={() => setShowOverlayText((v) => !v)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                        showOverlayText
                          ? 'bg-emerald-600 text-white'
                          : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                      }`}
                    >
                      {showOverlayText ? 'Visible' : 'Enable'}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={goalTitleOverlay}
                    onChange={(e) => {
                      setGoalTitleOverlay(e.target.value);
                      if (!showOverlayText) setShowOverlayText(true);
                    }}
                    placeholder="Milestone title (e.g. Coastal Villa 2029)"
                    className="w-full bg-[#FAFAFA] dark:bg-neutral-900 border border-[#E5E5E5] dark:border-neutral-700 rounded-lg px-3 py-1.5 text-xs"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={metricBadgeText}
                      onChange={(e) => {
                        setMetricBadgeText(e.target.value);
                        if (!showOverlayText) setShowOverlayText(true);
                      }}
                      placeholder="Target (e.g. $250K / ₹50L)"
                      className="bg-[#FAFAFA] dark:bg-neutral-900 border border-[#E5E5E5] dark:border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs font-mono"
                    />
                    <select
                      value={overlayPosition}
                      onChange={(e) => setOverlayPosition(e.target.value as 'bottom' | 'top' | 'center')}
                      className="bg-[#FAFAFA] dark:bg-neutral-900 border border-[#E5E5E5] dark:border-neutral-700 rounded-lg px-2 py-1.5 text-xs font-semibold"
                    >
                      <option value="bottom">Bottom Caption</option>
                      <option value="top">Top Header</option>
                      <option value="center">Center Banner</option>
                    </select>
                  </div>
                </div>

                {/* Filters & Light */}
                <div className="p-3.5 rounded-2xl border border-[#E5E5E5] dark:border-neutral-800 space-y-2.5">
                  <p className="text-xs font-bold">Color Grade &amp; Tone</p>
                  <div className="flex flex-wrap gap-1.5">
                    {FILTER_LABELS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFilterPreset(f.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                          filterPreset === f.id
                            ? 'bg-neutral-950 dark:bg-white text-white dark:text-neutral-950'
                            : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-1 text-[11px] font-mono">
                    <label className="space-y-1">
                      <span className="flex justify-between text-neutral-500">
                        <span>Brightness</span>
                        <span>{brightness}%</span>
                      </span>
                      <input
                        type="range"
                        min={75}
                        max={125}
                        value={brightness}
                        onChange={(e) => setBrightness(Number(e.target.value))}
                        className="w-full"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="flex justify-between text-neutral-500">
                        <span>Contrast</span>
                        <span>{contrast}%</span>
                      </span>
                      <input
                        type="range"
                        min={80}
                        max={130}
                        value={contrast}
                        onChange={(e) => setContrast(Number(e.target.value))}
                        className="w-full"
                      />
                    </label>
                  </div>
                </div>

                {/* Crop & Zoom */}
                <div className="p-3.5 rounded-2xl border border-[#E5E5E5] dark:border-neutral-800 space-y-2.5">
                  <p className="text-xs font-bold">Crop Aspect &amp; Zoom</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CROP_OPTIONS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCropRatio(c.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                          cropRatio === c.id
                            ? 'bg-neutral-950 dark:bg-white text-white dark:text-neutral-950'
                            : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                  <label className="block space-y-1 text-[11px] font-mono">
                    <span className="flex justify-between text-neutral-500">
                      <span>Zoom Focus</span>
                      <span>{zoomScale.toFixed(2)}x</span>
                    </span>
                    <input
                      type="range"
                      min={1}
                      max={1.5}
                      step={0.05}
                      value={zoomScale}
                      onChange={(e) => setZoomScale(Number(e.target.value))}
                      className="w-full"
                    />
                  </label>
                </div>

                {/* Frames */}
                <div className="p-3.5 rounded-2xl border border-[#E5E5E5] dark:border-neutral-800 space-y-2">
                  <p className="text-xs font-bold">Mount Frame</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {FRAME_LABELS.map((fr) => (
                      <button
                        key={fr.id}
                        type="button"
                        onClick={() => setFrameStyle(fr.id)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer ${
                          frameStyle === fr.id
                            ? 'bg-neutral-950 dark:bg-white text-white dark:text-neutral-950'
                            : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                        }`}
                      >
                        {fr.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {statusNotice && (
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">✓ {statusNotice}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

export default GoalImageEditorModal;
