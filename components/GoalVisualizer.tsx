import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  enhanceFinancialPrompt,
  startImageRenderJob,
  pollImageRenderJob,
  cancelImageRenderJob,
} from '../services/geminiService';
import { triggerFileDownload } from '../services/emailReceiptService';
import {
  exportSlidesAsPdf,
  exportSlidesAsPptx,
  exportSlidesAsMarkdown,
  exportSlidesAsJson,
} from '../utils/slideDeckExporter';
import { useFinMind } from '../context/FinMindContext';
import {
  MindMapNode,
  MindMapShape,
  SlideItem,
  SlideTheme,
  SlideFontStyle,
  SlideContentStyle,
  SlideGraphicsStyle,
  CollabNote,
  CollabParticipant,
  CollabWaitingPeer,
  CollabDeniedEntry,
  CollabChatMessage,
  IdeationBoardRecord,
  VisualStylePreset,
  VisualAspectRatio,
  ImageRenderJobState,
} from '../types';
import { GoalImageEditorModal } from './GoalImageEditorModal';

type VisionStudioTab = 'mindmap' | 'slides' | 'room' | 'visuals';
const VISION_TABS: VisionStudioTab[] = ['mindmap', 'slides', 'room', 'visuals'];

function isTouchInsideNoSwipeZone(target: EventTarget | null): boolean {
  let el = target as HTMLElement | null;
  while (el) {
    if (
      el.dataset?.noSwipe === 'true' ||
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.getAttribute('role') === 'slider'
    ) {
      return true;
    }
    const style = window.getComputedStyle(el);
    if (
      (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
      el.scrollWidth > el.clientWidth + 8
    ) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

const DEFAULT_NODES: MindMapNode[] = [
  {
    id: 'n-root',
    label: 'Core Product Vision',
    notes: 'Clear everyday value proposition & customer problem solved cleanly.',
    x: 340,
    y: 205,
    color: 'indigo',
    shape: 'hub',
    metricTag: 'North Star',
    parentId: null,
  },
  {
    id: 'n-1',
    label: 'Audience & Daily Pain',
    notes: 'Busy households, builders & teams needing clarity in one view.',
    x: 60,
    y: 55,
    color: 'sky',
    shape: 'insight',
    metricTag: 'Discovery',
    parentId: 'n-root',
  },
  {
    id: 'n-2',
    label: 'Target Revenue Model',
    notes: 'Free starter tier paired with transparent Pro & Team upgrades.',
    x: 640,
    y: 55,
    color: 'emerald',
    shape: 'metric',
    metricTag: '75% Margin',
    parentId: 'n-root',
  },
  {
    id: 'n-3',
    label: '90-Day Release Plan',
    notes: 'Beta validation, onboarding polish and public launch sprint.',
    x: 60,
    y: 365,
    color: 'amber',
    shape: 'step',
    metricTag: 'Phase 01',
    parentId: 'n-root',
  },
  {
    id: 'n-4',
    label: 'Next Weekly Actions',
    notes: 'Share interactive board with collaborators & finalize Q1 deck.',
    x: 640,
    y: 365,
    color: 'rose',
    shape: 'action',
    metricTag: 'Due Fri',
    parentId: 'n-root',
  },
];

const DEFAULT_SLIDES: SlideItem[] = [
  {
    id: 's-1',
    title: 'Product Blueprint & Launch Strategy',
    subtitle: 'Executive summary aligned across design, growth and economics',
    bullets: [
      'Clarify core customer value and repeatable daily habit loop',
      'Align product milestones, transparent pricing and launch timeline',
      'Share live deliverables cleanly with stakeholders and partners',
    ],
    layout: 'cover',
    theme: 'ivory',
    metricHighlight: 'Q1 Launch',
  },
  {
    id: 's-2',
    title: 'Key Economics & Traction Targets',
    subtitle: '90-Day Operating Scorecard',
    bullets: [
      '100+ active collaborating households & teams in early cohorts',
      'Automated onboarding with multi-currency receipt delivery',
      '75% target gross margin with disciplined operating spend',
    ],
    layout: 'metrics',
    theme: 'ivory',
    metricHighlight: '75% Margin',
  },
  {
    id: 's-3',
    title: 'Three-Phase Execution Roadmap',
    subtitle: 'From prototype validation to full scale',
    bullets: [
      'Phase 1 · Validate core workflows with 25 active design partners',
      'Phase 2 · Launch interactive HTML decks and live shared video rooms',
      'Phase 3 · Scale organic referrals and daily workspace adoption',
    ],
    layout: 'roadmap',
    theme: 'ivory',
    metricHighlight: '90 Days',
  },
];

const NODE_COLORS: Record<
  MindMapNode['color'],
  { accentHex: string; pill: string; ring: string; surface: string }
> = {
  indigo: {
    accentHex: '#4F46E5',
    pill: 'bg-indigo-600 text-white',
    ring: 'border-indigo-500/70',
    surface: 'bg-indigo-50/90 dark:bg-indigo-950/60',
  },
  emerald: {
    accentHex: '#059669',
    pill: 'bg-emerald-600 text-white',
    ring: 'border-emerald-500/70',
    surface: 'bg-emerald-50/90 dark:bg-emerald-950/60',
  },
  sky: {
    accentHex: '#0284C7',
    pill: 'bg-sky-600 text-white',
    ring: 'border-sky-500/70',
    surface: 'bg-sky-50/90 dark:bg-sky-950/60',
  },
  amber: {
    accentHex: '#D97706',
    pill: 'bg-amber-500 text-neutral-950',
    ring: 'border-amber-500/70',
    surface: 'bg-amber-50/90 dark:bg-amber-950/50',
  },
  rose: {
    accentHex: '#E11D48',
    pill: 'bg-rose-600 text-white',
    ring: 'border-rose-500/70',
    surface: 'bg-rose-50/90 dark:bg-rose-950/60',
  },
  neutral: {
    accentHex: '#3F3F46',
    pill: 'bg-neutral-800 text-white',
    ring: 'border-neutral-500/60',
    surface: 'bg-neutral-100 dark:bg-neutral-900',
  },
};

const SHAPE_OPTIONS: Array<{ id: MindMapShape; label: string }> = [
  { id: 'hub', label: 'Core Hub' },
  { id: 'step', label: 'Milestone Step' },
  { id: 'insight', label: 'Key Insight' },
  { id: 'metric', label: 'Metric Card' },
  { id: 'action', label: 'Action Item' },
];

const SLIDE_THEMES: Record<
  SlideTheme,
  {
    label: string;
    bgClass: string;
    textClass: string;
    mutedClass: string;
    accentText: string;
    cardClass: string;
    bgHex: string;
    textHex: string;
    mutedHex: string;
    accentHex: string;
    cardHex: string;
    borderHex: string;
  }
> = {
  ivory: {
    label: 'Swiss Paper',
    bgClass: 'bg-[#FFFFFF] border border-[#E5E5E5]',
    textClass: 'text-[#111111]',
    mutedClass: 'text-[#525252]',
    accentText: 'text-[#1D4ED8]',
    cardClass: 'bg-[#FAFAFA] border border-[#E5E5E5]',
    bgHex: '#FFFFFF',
    textHex: '#111111',
    mutedHex: '#525252',
    accentHex: '#1D4ED8',
    cardHex: '#FAFAFA',
    borderHex: '#E5E5E5',
  },
  midnight: {
    label: 'Obsidian Swiss',
    bgClass: 'bg-[#0F1115] border border-[#232732]',
    textClass: 'text-[#F8FAFC]',
    mutedClass: 'text-[#94A3B8]',
    accentText: 'text-[#38BDF8]',
    cardClass: 'bg-[#161922] border border-[#262B38]',
    bgHex: '#0F1115',
    textHex: '#F8FAFC',
    mutedHex: '#94A3B8',
    accentHex: '#38BDF8',
    cardHex: '#161922',
    borderHex: '#262B38',
  },
  emerald: {
    label: 'Sage Studio',
    bgClass: 'bg-[#F6FAF8] border border-[#D1E3DA]',
    textClass: 'text-[#0F241B]',
    mutedClass: 'text-[#3E5C4E]',
    accentText: 'text-[#047857]',
    cardClass: 'bg-[#FFFFFF] border border-[#DCEADF]',
    bgHex: '#F6FAF8',
    textHex: '#0F241B',
    mutedHex: '#3E5C4E',
    accentHex: '#047857',
    cardHex: '#FFFFFF',
    borderHex: '#DCEADF',
  },
  cobalt: {
    label: 'Cobalt Brief',
    bgClass: 'bg-[#F5F8FF] border border-[#D5E0FA]',
    textClass: 'text-[#0F172A]',
    mutedClass: 'text-[#475569]',
    accentText: 'text-[#1E40AF]',
    cardClass: 'bg-[#FFFFFF] border border-[#DCE5FA]',
    bgHex: '#F5F8FF',
    textHex: '#0F172A',
    mutedHex: '#475569',
    accentHex: '#1E40AF',
    cardHex: '#FFFFFF',
    borderHex: '#DCE5FA',
  },
  ledger: {
    label: 'Warm Ledger',
    bgClass: 'bg-[#FCFBF7] border border-[#E6DFD1]',
    textClass: 'text-[#1C1917]',
    mutedClass: 'text-[#57534E]',
    accentText: 'text-[#B45309]',
    cardClass: 'bg-[#FFFFFF] border border-[#EAE4D7]',
    bgHex: '#FCFBF7',
    textHex: '#1C1917',
    mutedHex: '#57534E',
    accentHex: '#B45309',
    cardHex: '#FFFFFF',
    borderHex: '#EAE4D7',
  },
  navy: {
    label: 'Institutional Navy',
    bgClass: 'bg-[#0B1528] border border-[#1E2E4A]',
    textClass: 'text-[#F1F5F9]',
    mutedClass: 'text-[#94A3B8]',
    accentText: 'text-[#60A5FA]',
    cardClass: 'bg-[#12203B] border border-[#243758]',
    bgHex: '#0B1528',
    textHex: '#F1F5F9',
    mutedHex: '#94A3B8',
    accentHex: '#60A5FA',
    cardHex: '#12203B',
    borderHex: '#243758',
  },
  charcoal: {
    label: 'Monochrome Slate',
    bgClass: 'bg-[#18181B] border border-[#27272A]',
    textClass: 'text-[#FAFAFA]',
    mutedClass: 'text-[#A1A1AA]',
    accentText: 'text-[#E4E4E7]',
    cardClass: 'bg-[#202024] border border-[#2E2E33]',
    bgHex: '#18181B',
    textHex: '#FAFAFA',
    mutedHex: '#A1A1AA',
    accentHex: '#E4E4E7',
    cardHex: '#202024',
    borderHex: '#2E2E33',
  },
  growth: {
    label: 'Wealth Emerald',
    bgClass: 'bg-[#06241B] border border-[#0E3F30]',
    textClass: 'text-[#ECFDF5]',
    mutedClass: 'text-[#A7F3D0]',
    accentText: 'text-[#34D399]',
    cardClass: 'bg-[#0A3025] border border-[#144B3A]',
    bgHex: '#06241B',
    textHex: '#ECFDF5',
    mutedHex: '#A7F3D0',
    accentHex: '#34D399',
    cardHex: '#0A3025',
    borderHex: '#144B3A',
  },
};

const SLIDE_FONTS: Record<SlideFontStyle, { label: string; sample: string; cssFamily: string }> = {
  swiss_sans: {
    label: 'Swiss Modern Sans',
    sample: 'Inter Clean Sans',
    cssFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
  },
  editorial_serif: {
    label: 'Editorial Serif',
    sample: 'Classic Financial Broadsheet',
    cssFamily: "Georgia, 'Times New Roman', serif",
  },
  mono_quant: {
    label: 'Quant Terminal',
    sample: 'Monospace Precision Figures',
    cssFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  executive_geometric: {
    label: 'Executive Geometric',
    sample: 'Boardroom Clarity',
    cssFamily: "'Plus Jakarta Sans', 'Avenir Next', -apple-system, sans-serif",
  },
};

const SLIDE_CONTENT_DENSITY: Array<{ id: SlideContentStyle; label: string; desc: string }> = [
  { id: 'short', label: 'Short', desc: 'High-impact headlines & 2 KPI bullets' },
  { id: 'brief', label: 'Brief', desc: 'Concise 3 crisp executive bullets' },
  { id: 'medium', label: 'Medium', desc: 'Balanced insights & context figures' },
  { id: 'detailed', label: 'Detailed', desc: 'Analytical depth for deep reviews' },
];

const SLIDE_GRAPHICS_OPTIONS: Array<{ id: SlideGraphicsStyle; label: string; desc: string }> = [
  { id: 'charts', label: 'Financial Charts', desc: 'Bar plots & quarterly return visuals' },
  { id: 'diagrams', label: 'Allocation Flows', desc: 'Capital split diagrams & callouts' },
  { id: 'cards', label: 'Metric Cards', desc: 'Structured Swiss KPI grid tiles' },
  { id: 'roadmap', label: 'Timeline Roadmap', desc: 'Phased quarterly milestones' },
];

const SLIDE_COUNT_PRESETS = [4, 6, 8, 10, 12, 15];

const SLIDE_AUDIENCE_PRESETS = [
  'Personal Wealth Plan',
  'Household Budget Review',
  'Investor / LP Brief',
  'CFO & Board Review',
];

const MAP_PROMPT_IDEAS = [
  'Launch a family budget and weekly savings system',
  'Plan a debt-free payoff & emergency reserve architecture',
  'Organize my 5-year investment allocation & compounding roadmap',
];

const SLIDE_PROMPT_IDEAS = [
  'Q4 Portfolio Allocation, CAGR Targets & Risk Review',
  'Annual Household Cashflow, Savings Rate & Runway Brief',
  '5-Year Debt Payoff, Index SIP & Tax Optimization Plan',
];

const VISUAL_PROMPT_IDEAS = [
  'Sunlit coastal villa representing my 5-year mortgage-free milestone',
  'Minimalist architect desk with compounding wealth ledger at sunrise',
  'Electric grand tourer parked at dusk symbolizing my paid-in-full vehicle goal',
  'Calm Nordic timber cabin in pine mountains representing financial independence',
];

const VISUAL_STYLE_PRESETS: Array<{ id: VisualStylePreset; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'photorealistic', label: 'Photorealistic' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'editorial_3d', label: 'Editorial 3D' },
  { id: 'illustration', label: 'Illustration' },
  { id: 'watercolor', label: 'Watercolor' },
];

const VISUAL_ASPECT_RATIOS: Array<{ id: VisualAspectRatio; label: string; frameClass: string }> = [
  { id: '16:9', label: '16:9 Wide', frameClass: 'aspect-video w-full' },
  { id: '1:1', label: '1:1 Square', frameClass: 'aspect-square max-w-lg w-full mx-auto' },
  { id: '4:3', label: '4:3 Slide', frameClass: 'aspect-[4/3] max-w-2xl w-full mx-auto' },
  { id: '9:16', label: '9:16 Portrait', frameClass: 'aspect-[9/16] max-w-sm w-full mx-auto' },
];

async function ensureFirestoreSafeDataUrl(dataUrl: string, maxChars = 650000): Promise<string> {
  if (!dataUrl || dataUrl.length <= maxChars || dataUrl.startsWith('data:image/svg')) {
    return dataUrl;
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 960;
        const scale = Math.min(1, maxDim / Math.max(img.width || maxDim, img.height || maxDim));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(64, Math.round((img.width || 800) * scale));
        canvas.height = Math.max(64, Math.round((img.height || 600) * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(dataUrl.slice(0, maxChars));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', 0.84);
        resolve(compressed.length <= maxChars ? compressed : canvas.toDataURL('image/jpeg', 0.68));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function generateUniqueSessionCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let part1 = '';
  let part2 = '';
  for (let i = 0; i < 4; i++) {
    part1 += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  for (let i = 0; i < 2; i++) {
    part2 += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return `MEET-${part1}-${part2}`;
}

interface GoalVisualizerProps {
  initialRoomCode?: string | null;
  onRoomCodeChange?: (code: string) => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function escapeHtmlText(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCallDuration(totalSec: number): string {
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

interface RemoteVideoTileProps {
  participant: CollabParticipant;
  stream?: MediaStream;
  isPinned?: boolean;
  isLarge?: boolean;
  onTogglePin?: () => void;
}

const RemoteVideoTile: React.FC<RemoteVideoTileProps> = ({
  participant,
  stream,
  isPinned = false,
  isLarge = false,
  onTogglePin,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hasVideo = Boolean(stream && stream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled));

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream) {
      el.srcObject = stream;
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [stream, participant.camOn, participant.screenOn]);

  const initials =
    participant.name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('') || 'M';

  return (
    <div
      className={`group relative rounded-2xl overflow-hidden bg-[#181A20] border transition-colors flex items-center justify-center ${
        isPinned
          ? 'border-sky-400/80 ring-1 ring-sky-400/40'
          : participant.micOn
          ? 'border-emerald-500/45'
          : 'border-white/10'
      } ${isLarge ? 'w-full h-full min-h-[260px] sm:min-h-[380px]' : 'aspect-video'}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={`w-full h-full object-cover ${hasVideo && (participant.camOn || participant.screenOn) ? 'block' : 'hidden'}`}
      />
      {(!hasVideo || (!participant.camOn && !participant.screenOn)) && (
        <div className="flex flex-col items-center justify-center gap-2.5 p-4 text-center">
          <div
            className={`${isLarge ? 'w-20 h-20 text-2xl' : 'w-14 h-14 text-lg'} rounded-full flex items-center justify-center text-white font-extrabold shadow-lg`}
            style={{ backgroundColor: participant.color || '#0284C7' }}
          >
            {initials}
          </div>
          <p className="text-xs font-medium text-neutral-400">Camera off</p>
        </div>
      )}

      {/* Top Overlay: Raised Hand & Pin Spotlight Action */}
      <div className="absolute top-3 inset-x-3 flex items-center justify-between gap-2 pointer-events-none">
        {participant.handRaised ? (
          <span className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-400 text-neutral-950 text-[11px] font-bold shadow-md">
            <span aria-hidden="true">&#9995;</span>
            <span>Hand raised</span>
          </span>
        ) : (
          <span />
        )}

        {onTogglePin && (
          <button
            type="button"
            onClick={onTogglePin}
            className={`pointer-events-auto px-2.5 py-1 rounded-lg text-[11px] font-semibold backdrop-blur-md border transition-opacity cursor-pointer ${
              isPinned
                ? 'bg-sky-500/90 border-sky-400 text-white opacity-100'
                : 'bg-black/60 border-white/15 text-neutral-200 opacity-0 group-hover:opacity-100'
            }`}
          >
            {isPinned ? 'Unpin' : 'Pin'}
          </button>
        )}
      </div>

      {/* Measured Scrim Bottom Nametag & Audio State */}
      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/85 via-black/45 to-transparent flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-white truncate">{participant.name}</p>
          <p className="text-[10px] font-mono text-neutral-300 truncate">{participant.role}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {participant.screenOn && (
            <span className="px-2 py-0.5 rounded-md bg-sky-600/95 text-[10px] font-mono font-bold text-white">
              Sharing
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold ${
              participant.micOn ? 'bg-emerald-600/90 text-white' : 'bg-black/70 text-neutral-300 border border-white/10'
            }`}
          >
            {participant.micOn ? 'Mic on' : 'Muted'}
          </span>
        </div>
      </div>
    </div>
  );
};

const GoalVisualizer: React.FC<GoalVisualizerProps> = ({ initialRoomCode, onRoomCodeChange }) => {
  const {
    goals,
    addGoal,
    deleteGoal,
    trackEngagement,
    currentUser,
    saveIdeationBoard,
    loadIdeationBoards,
    deleteIdeationBoard,
    logAnalyticsEvent,
  } = useFinMind();

  const [activeTab, setActiveTab] = useState<VisionStudioTab>(() => (initialRoomCode ? 'room' : 'mindmap'));
  const [boardId, setBoardId] = useState<string>(() => `board-${Date.now().toString(36)}`);
  const [boardTitle, setBoardTitle] = useState('Untitled Strategy Board');
  const [roomCode, setRoomCode] = useState(() =>
    initialRoomCode ? initialRoomCode.toUpperCase() : generateUniqueSessionCode()
  );
  const autoJoinedInitialRef = useRef<string | null>(null);
  const [savedBoards, setSavedBoards] = useState<IdeationBoardRecord[]>([]);
  const [savingBoard, setSavingBoard] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Per-tab progressive disclosure flags (hide canvas/export/delete until user generates or loads)
  const [hasMapOutput, setHasMapOutput] = useState(false);
  const [hasSlidesOutput, setHasSlidesOutput] = useState(false);

  // Per-tab Export Menus
  const [mapExportMenuOpen, setMapExportMenuOpen] = useState(false);
  const mapExportMenuRef = useRef<HTMLDivElement>(null);
  const [slideExportMenuOpen, setSlideExportMenuOpen] = useState(false);
  const [exportingPptx, setExportingPptx] = useState(false);
  const slideExportMenuRef = useRef<HTMLDivElement>(null);

  // Separate Per-Tab Prompts & Generation States
  const [mapPrompt, setMapPrompt] = useState('');
  const [enhancingMap, setEnhancingMap] = useState(false);
  const [generatingMap, setGeneratingMap] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const [slidePrompt, setSlidePrompt] = useState('');
  const [enhancingSlides, setEnhancingSlides] = useState(false);
  const [generatingSlides, setGeneratingSlides] = useState(false);
  const [slideError, setSlideError] = useState<string | null>(null);
  const [deckTheme, setDeckTheme] = useState<SlideTheme>('ivory');
  const [slideCount, setSlideCount] = useState<number>(6);
  const [slideFontStyle, setSlideFontStyle] = useState<SlideFontStyle>('swiss_sans');
  const [slideContentStyle, setSlideContentStyle] = useState<SlideContentStyle>('brief');
  const [slideGraphicsStyle, setSlideGraphicsStyle] = useState<SlideGraphicsStyle>('charts');
  const [deckAudience, setDeckAudience] = useState<string>('Personal Wealth Plan');
  const [isSlideConfigOpen, setIsSlideConfigOpen] = useState<boolean>(false);
  const [configStep, setConfigStep] = useState<1 | 2 | 3>(1);

  // Full-Size Auto-Expanding Mind Map State (Zoom, Pan, Fullscreen, Hover Card & Inline Editing)
  const [nodes, setNodes] = useState<MindMapNode[]>(DEFAULT_NODES);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('n-root');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const [mapZoom, setMapZoom] = useState<number>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 0.72 : 1
  );
  const [isMapFullscreen, setIsMapFullscreen] = useState(false);
  const [isPanningMap, setIsPanningMap] = useState(false);
  const [inlineEditingNodeId, setInlineEditingNodeId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);
  const didDragMoveRef = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const visionTouchSwipeRef = useRef<{ x: number; y: number; time: number; blocked: boolean } | null>(null);

  const mapBounds = useMemo(() => {
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(0, ...(xs.length ? xs : [0])) - 240;
    const minY = Math.min(0, ...(ys.length ? ys : [0])) - 180;
    const maxX = Math.max(1200, ...(xs.length ? xs.map((x) => x + 320) : [1200])) + 320;
    const maxY = Math.max(720, ...(ys.length ? ys.map((y) => y + 200) : [720])) + 280;
    return {
      minX,
      minY,
      width: Math.max(1440, maxX - minX),
      height: Math.max(900, maxY - minY),
    };
  }, [nodes]);

  useEffect(() => {
    if (!isMapFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMapFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMapFullscreen]);

  const handleVisionTouchStart = (e: React.TouchEvent) => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) return;
    if (e.touches.length !== 1) {
      visionTouchSwipeRef.current = null;
      return;
    }
    const t = e.touches[0];
    visionTouchSwipeRef.current = {
      x: t.clientX,
      y: t.clientY,
      time: Date.now(),
      blocked: isTouchInsideNoSwipeZone(e.target),
    };
  };

  const handleVisionTouchEnd = (e: React.TouchEvent) => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) return;
    const start = visionTouchSwipeRef.current;
    visionTouchSwipeRef.current = null;
    if (!start) return;
    if (start.blocked) {
      (e.nativeEvent as any).__consumedByNestedSwipe = true;
      return;
    }
    if (e.changedTouches.length !== 1) return;
    const endTouch = e.changedTouches[0];
    const dx = endTouch.clientX - start.x;
    const dy = endTouch.clientY - start.y;
    const elapsed = Date.now() - start.time;

    if (elapsed > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) {
      return;
    }

    const currIdx = VISION_TABS.indexOf(activeTab);
    if (currIdx < 0) return;
    const nextIdx = dx < 0 ? currIdx + 1 : currIdx - 1;
    if (nextIdx >= 0 && nextIdx < VISION_TABS.length) {
      (e.nativeEvent as any).__consumedByNestedSwipe = true;
      setActiveTab(VISION_TABS[nextIdx]);
    }
  };

  // Slide Deck Builder State
  const [slides, setSlides] = useState<SlideItem[]>(DEFAULT_SLIDES);
  const [activeSlideId, setActiveSlideId] = useState<string>(DEFAULT_SLIDES[0].id);

  // Live Team Room Conferencing State
  const [collabName, setCollabName] = useState(
    currentUser?.displayName || (initialRoomCode ? 'Guest' : 'Host')
  );
  const [collabRole, setCollabRole] = useState(() => (initialRoomCode ? 'Invited Guest' : 'Team Host'));
  const [guestKey] = useState<string>(() => {
    try {
      const existing = localStorage.getItem('liddy_video_guest_key');
      if (existing) return existing;
      const created = `gk_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      localStorage.setItem('liddy_video_guest_key', created);
      return created;
    } catch {
      return `gk_${Math.random().toString(36).slice(2, 10)}`;
    }
  });
  const [isInviteMode, setIsInviteMode] = useState<boolean>(() => Boolean(initialRoomCode));
  const [roomJoinState, setRoomJoinState] = useState<'idle' | 'waiting' | 'connected' | 'denied'>('idle');
  const [isRoomHost, setIsRoomHost] = useState(false);
  const [waitingStatusMessage, setWaitingStatusMessage] = useState('');
  const [waitingRequests, setWaitingRequests] = useState<CollabWaitingPeer[]>([]);
  const [deniedEntries, setDeniedEntries] = useState<CollabDeniedEntry[]>([]);
  const [isRoomConnected, setIsRoomConnected] = useState(false);
  const [participants, setParticipants] = useState<CollabParticipant[]>([]);
  const [meetingNotes, setMeetingNotes] = useState<CollabNote[]>([]);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNoteKind, setNewNoteKind] = useState<CollabNote['kind']>('note');

  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [videoBlurOn, setVideoBlurOn] = useState(false);
  const [layoutMode, setLayoutMode] = useState<'gallery' | 'spotlight'>('gallery');
  const [pinnedPeerId, setPinnedPeerId] = useState<string | null>(null);
  const [sidePanel, setSidePanel] = useState<'none' | 'chat' | 'people' | 'notes'>('none');
  const [chatMessages, setChatMessages] = useState<CollabChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [reactionMenuOpen, setReactionMenuOpen] = useState(false);
  const [reactionsFeed, setReactionsFeed] = useState<Array<{ id: string; senderName: string; emoji: string }>>([]);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState<'mic' | 'cam' | null>(null);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>('');
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState<string>('');
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('user');
  const [callElapsedSec, setCallElapsedSec] = useState(0);
  const [isStageFullscreen, setIsStageFullscreen] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  const collabWsRef = useRef<WebSocket | null>(null);
  const myPeerIdRef = useRef<string>('');
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const sidePanelRef = useRef(sidePanel);
  sidePanelRef.current = sidePanel;
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map<string, RTCPeerConnection>());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map<string, RTCIceCandidateInit[]>());

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const slidesRef = useRef(slides);
  slidesRef.current = slides;

  // Concept Visuals Tab State
  const [visualPrompt, setVisualPrompt] = useState('');
  const [visualStyle, setVisualStyle] = useState<VisualStylePreset>('auto');
  const [visualRatio, setVisualRatio] = useState<VisualAspectRatio>('16:9');
  const [resultRatio, setResultRatio] = useState<VisualAspectRatio>('16:9');
  const [visualLoading, setVisualLoading] = useState(false);
  const [activeRenderJob, setActiveRenderJob] = useState<ImageRenderJobState | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const [isEnhancingVisual, setIsEnhancingVisual] = useState(false);
  const [visualError, setVisualError] = useState<string | null>(null);
  const [currentVisualResult, setCurrentVisualResult] = useState<string | null>(null);
  const [editorTarget, setEditorTarget] = useState<{
    imageUrl: string;
    title: string;
    targetType: 'preview' | 'gallery';
    aspectRatio: VisualAspectRatio;
  } | null>(null);
  const visualInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
      }
      if (activeJobIdRef.current) {
        void cancelImageRenderJob(activeJobIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    loadIdeationBoards().then((list) => setSavedBoards(list));
  }, [loadIdeationBoards]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (mapExportMenuRef.current && !mapExportMenuRef.current.contains(e.target as Node)) {
        setMapExportMenuOpen(false);
      }
      if (slideExportMenuRef.current && !slideExportMenuRef.current.contains(e.target as Node)) {
        setSlideExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const showToast = useCallback((msg: string) => {
    setStatusBanner(msg);
    window.setTimeout(() => setStatusBanner((prev) => (prev === msg ? null : prev)), 4200);
  }, []);

  // Attach active local video/screen stream
  const refreshLocalPreview = useCallback(() => {
    const el = localVideoRef.current;
    if (!el) return;
    if (screenStreamRef.current) {
      el.srcObject = screenStreamRef.current;
      el.play().catch(() => {});
    } else if (localStreamRef.current && camOn) {
      el.srcObject = localStreamRef.current;
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [camOn]);

  useEffect(() => {
    refreshLocalPreview();
  }, [camOn, screenOn, activeTab, isRoomConnected, refreshLocalPreview]);

  useEffect(() => {
    if (!isRoomConnected) {
      setCallElapsedSec(0);
      return;
    }
    const timer = window.setInterval(() => {
      setCallElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRoomConnected]);

  useEffect(() => {
    const onFsChange = () => {
      setIsStageFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const refreshMediaDeviceList = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter((d) => d.kind === 'audioinput');
      const cams = devices.filter((d) => d.kind === 'videoinput');
      setAudioInputs(mics);
      setVideoInputs(cams);
      if (!selectedAudioDeviceId && mics[0]?.deviceId) setSelectedAudioDeviceId(mics[0].deviceId);
      if (!selectedVideoDeviceId && cams[0]?.deviceId) setSelectedVideoDeviceId(cams[0].deviceId);
    } catch {}
  }, [selectedAudioDeviceId, selectedVideoDeviceId]);

  useEffect(() => {
    if (activeTab === 'room') {
      void refreshMediaDeviceList();
    }
  }, [activeTab, refreshMediaDeviceList]);

  const sendWs = useCallback((payload: unknown) => {
    if (collabWsRef.current && collabWsRef.current.readyState === WebSocket.OPEN) {
      collabWsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const broadcastMediaState = useCallback(
    (nextMic: boolean, nextCam: boolean, nextScreen: boolean) => {
      sendWs({ type: 'media_state', micOn: nextMic, camOn: nextCam, screenOn: nextScreen });
    },
    [sendWs]
  );

  const syncLocalTracksToPeer = useCallback((pc: RTCPeerConnection) => {
    const activeVideoTrack =
      screenStreamRef.current?.getVideoTracks()[0] || localStreamRef.current?.getVideoTracks()[0] || null;
    const activeAudioTrack = localStreamRef.current?.getAudioTracks()[0] || null;

    const senders = pc.getSenders();
    const transceivers = pc.getTransceivers ? pc.getTransceivers() : [];
    const videoSender =
      senders.find((s) => s.track?.kind === 'video') ||
      transceivers.find((t) => t.receiver.track?.kind === 'video')?.sender;
    const audioSender =
      senders.find((s) => s.track?.kind === 'audio') ||
      transceivers.find((t) => t.receiver.track?.kind === 'audio')?.sender;

    if (activeVideoTrack) {
      if (videoSender) {
        videoSender.replaceTrack(activeVideoTrack).catch(() => {});
      } else {
        const stream = screenStreamRef.current || localStreamRef.current;
        if (stream) pc.addTrack(activeVideoTrack, stream);
      }
    }

    if (activeAudioTrack) {
      if (audioSender) {
        audioSender.replaceTrack(activeAudioTrack).catch(() => {});
      } else if (localStreamRef.current) {
        pc.addTrack(activeAudioTrack, localStreamRef.current);
      }
    }
  }, []);

  const closePeerConnection = useCallback((peerId: string) => {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      try {
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.close();
      } catch {}
      peerConnectionsRef.current.delete(peerId);
    }
    pendingIceRef.current.delete(peerId);
    setRemoteStreams((prev) => {
      if (!prev[peerId]) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const getOrCreatePeerConnection = useCallback(
    (remotePeerId: string) => {
      const existing = peerConnectionsRef.current.get(remotePeerId);
      if (existing) {
        syncLocalTracksToPeer(existing);
        return existing;
      }

      const pc = new RTCPeerConnection(RTC_CONFIG);
      peerConnectionsRef.current.set(remotePeerId, pc);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendWs({
            type: 'rtc_ice',
            targetPeerId: remotePeerId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        const incomingStream = event.streams[0] || new MediaStream([event.track]);
        setRemoteStreams((prev) => ({
          ...prev,
          [remotePeerId]: incomingStream,
        }));
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          closePeerConnection(remotePeerId);
        }
      };

      syncLocalTracksToPeer(pc);
      return pc;
    },
    [closePeerConnection, sendWs, syncLocalTracksToPeer]
  );

  const flushPendingIce = useCallback(async (remotePeerId: string, pc: RTCPeerConnection) => {
    const queue = pendingIceRef.current.get(remotePeerId);
    if (!queue || queue.length === 0) return;
    pendingIceRef.current.delete(remotePeerId);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    }
  }, []);

  const initiateOfferToPeer = useCallback(
    async (remotePeerId: string) => {
      try {
        const pc = getOrCreatePeerConnection(remotePeerId);
        if (pc.getTransceivers().length === 0) {
          pc.addTransceiver('video', { direction: 'sendrecv' });
          pc.addTransceiver('audio', { direction: 'sendrecv' });
        }
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendWs({
          type: 'rtc_offer',
          targetPeerId: remotePeerId,
          sdp: pc.localDescription,
        });
      } catch {}
    },
    [getOrCreatePeerConnection, sendWs]
  );

  const renegotiateAllPeers = useCallback(async () => {
    const jobs: Promise<void>[] = [];
    peerConnectionsRef.current.forEach((pc, remotePeerId) => {
      jobs.push(
        (async () => {
          try {
            syncLocalTracksToPeer(pc);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendWs({
              type: 'rtc_offer',
              targetPeerId: remotePeerId,
              sdp: pc.localDescription,
            });
          } catch {}
        })()
      );
    });
    await Promise.all(jobs);
  }, [sendWs, syncLocalTracksToPeer]);

  const broadcastNodes = useCallback(
    (nextNodes: MindMapNode[]) => {
      sendWs({ type: 'sync_nodes', nodes: nextNodes });
    },
    [sendWs]
  );

  const broadcastSlides = useCallback(
    (nextSlides: SlideItem[]) => {
      sendWs({ type: 'sync_slides', slides: nextSlides });
    },
    [sendWs]
  );

  const stopAllMedia = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    setMicOn(false);
    setCamOn(false);
    setScreenOn(false);
  }, []);

  const disconnectRoom = useCallback(
    (preserveDeniedState = false) => {
      peerConnectionsRef.current.forEach((pc) => {
        try {
          pc.close();
        } catch {}
      });
      peerConnectionsRef.current.clear();
      pendingIceRef.current.clear();
      setRemoteStreams({});

      if (collabWsRef.current) {
        collabWsRef.current.close();
        collabWsRef.current = null;
      }
      stopAllMedia();
      myPeerIdRef.current = '';
      setIsRoomConnected(false);
      setIsRoomHost(false);
      setWaitingRequests([]);
      setDeniedEntries([]);
      setWaitingStatusMessage('');
      if (!preserveDeniedState) {
        setRoomJoinState('idle');
      }
      setHandRaised(false);
      setDeviceMenuOpen(null);
      setReactionMenuOpen(false);
      setPinnedPeerId(null);
      setParticipants([]);
    },
    [stopAllMedia]
  );

  const reconcilePeers = useCallback(
    (nextParticipants: CollabParticipant[]) => {
      const myId = myPeerIdRef.current;
      if (!myId) return;

      const activeRemoteIds = new Set(
        nextParticipants.map((p) => p.peerId || p.clientId).filter((id) => id && id !== myId)
      );

      const toClose: string[] = [];
      peerConnectionsRef.current.forEach((_pc, existingId) => {
        if (!activeRemoteIds.has(existingId)) {
          toClose.push(existingId);
        }
      });
      toClose.forEach((existingId) => closePeerConnection(existingId));

      activeRemoteIds.forEach((remoteId) => {
        if (!peerConnectionsRef.current.has(remoteId) && myId < remoteId) {
          void initiateOfferToPeer(remoteId);
        }
      });
    },
    [closePeerConnection, initiateOfferToPeer]
  );

  const connectToRoom = useCallback(
    (requestedMode?: 'host' | 'knock') => {
      if (!trackEngagement('Live Video Room')) return;
      const cleanCode = roomCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      if (!cleanCode || cleanCode.length < 3) {
        setMediaError('Enter a valid meeting room code to continue.');
        return;
      }
      const cleanName = collabName.trim();
      if (!cleanName) {
        setMediaError('Enter your name so the host knows who is asking to join.');
        return;
      }

      if (collabWsRef.current) {
        collabWsRef.current.close();
        collabWsRef.current = null;
      }
      setMediaError(null);

      const joinMode: 'host' | 'knock' = requestedMode || (isInviteMode ? 'knock' : 'host');
      const roleValue = collabRole.trim() || (joinMode === 'host' ? 'Host' : 'Guest');
      onRoomCodeChange?.(cleanCode);
      setRoomCode(cleanCode);
      setWaitingStatusMessage(
        joinMode === 'knock'
          ? 'Sending join request to the host...'
          : 'Opening meeting room as host...'
      );
      setRoomJoinState('waiting');

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const uidParam = currentUser?.uid ? `&uid=${encodeURIComponent(currentUser.uid)}` : '';
      const emailParam = currentUser?.email ? `&email=${encodeURIComponent(currentUser.email)}` : '';
      const wsUrl = `${protocol}//${window.location.host}/api/collab-room?room=${encodeURIComponent(
        cleanCode
      )}&name=${encodeURIComponent(cleanName)}&role=${encodeURIComponent(
        roleValue
      )}&mode=${joinMode}&guestKey=${encodeURIComponent(guestKey)}${uidParam}${emailParam}`;

      const ws = new WebSocket(wsUrl);
      collabWsRef.current = ws;

      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'waiting_approval') {
            setIsRoomConnected(false);
            setIsRoomHost(false);
            setRoomJoinState('waiting');
            setWaitingStatusMessage(msg.message || 'Asking the host for permission to join...');
          } else if (msg.type === 'admitted') {
            setWaitingStatusMessage('');
            showToast(`Joined meeting room ${cleanCode}.`);
          } else if (msg.type === 'room_state') {
            if (msg.peerId || msg.clientId) {
              myPeerIdRef.current = msg.peerId || msg.clientId;
            }
            const hostFlag = Boolean(msg.isHost);
            setIsRoomHost(hostFlag);
            setRoomJoinState('connected');
            setIsRoomConnected(true);
            setWaitingStatusMessage('');
            if (Array.isArray(msg.waitingRequests)) setWaitingRequests(msg.waitingRequests);
            if (Array.isArray(msg.deniedList)) setDeniedEntries(msg.deniedList);
            if (Array.isArray(msg.participants)) {
              setParticipants(msg.participants);
              reconcilePeers(msg.participants);
            }
            if (Array.isArray(msg.nodes) && msg.nodes.length > 0) setNodes(msg.nodes);
            else if (hostFlag) ws.send(JSON.stringify({ type: 'sync_nodes', nodes: nodesRef.current }));

            if (Array.isArray(msg.slides) && msg.slides.length > 0) {
              setSlides(msg.slides);
              setActiveSlideId(msg.slides[0].id);
            } else if (hostFlag) {
              ws.send(JSON.stringify({ type: 'sync_slides', slides: slidesRef.current }));
            }
            if (Array.isArray(msg.meetingNotes)) setMeetingNotes(msg.meetingNotes);
            if (Array.isArray(msg.chatMessages)) setChatMessages(msg.chatMessages);
            ws.send(JSON.stringify({ type: 'media_state', micOn, camOn, screenOn, handRaised }));
            logAnalyticsEvent('vision_collab', 'vision', `join_room:${cleanCode}:${joinMode}`);
            showToast(`Connected to meeting room ${cleanCode}.`);
          } else if (msg.type === 'waiting_requests' && Array.isArray(msg.waitingRequests)) {
            setWaitingRequests(msg.waitingRequests);
          } else if (msg.type === 'denied_list' && Array.isArray(msg.deniedList)) {
            setDeniedEntries(msg.deniedList);
          } else if (msg.type === 'join_denied' || msg.type === 'removed_from_room') {
            setMediaError(
              msg.message ||
                'The host declined your request or removed you from this room. Re-entry is blocked unless allowed again by the host.'
            );
            setRoomJoinState('denied');
            setIsRoomConnected(false);
            setIsRoomHost(false);
            disconnectRoom(true);
          } else if (msg.type === 'account_blocked' || msg.type === 'account_revoked') {
            setMediaError(msg.message || 'Your session was terminated by an administrator.');
            disconnectRoom(false);
          } else if (msg.type === 'admin_notice' && msg.message) {
            showToast(`Admin Notice: ${msg.message}`);
          } else if (msg.type === 'admin_room_closed' && msg.message) {
            setMediaError(msg.message);
            disconnectRoom(false);
          } else if (msg.type === 'presence' && Array.isArray(msg.participants)) {
            setParticipants(msg.participants);
            reconcilePeers(msg.participants);
          } else if (msg.type === 'peer_left' && msg.peerId) {
            closePeerConnection(msg.peerId);
          } else if (msg.type === 'nodes_update' && Array.isArray(msg.nodes)) {
            setNodes(msg.nodes);
          } else if (msg.type === 'slides_update' && Array.isArray(msg.slides)) {
            setSlides(msg.slides);
          } else if (msg.type === 'notes_update' && Array.isArray(msg.meetingNotes)) {
            setMeetingNotes(msg.meetingNotes);
          } else if (msg.type === 'room_chat_message' && msg.message) {
            setChatMessages((prev) => [...prev.filter((m) => m.id !== msg.message.id), msg.message].slice(-100));
            if (sidePanelRef.current !== 'chat') {
              setUnreadChatCount((c) => c + 1);
            }
          } else if (msg.type === 'room_reaction' && msg.emoji) {
            const item = {
              id: msg.id || `react_${Date.now()}`,
              senderName: msg.senderName || 'Member',
              emoji: msg.emoji,
            };
            setReactionsFeed((prev) => [...prev.slice(-7), item]);
            window.setTimeout(() => {
              setReactionsFeed((prev) => prev.filter((r) => r.id !== item.id));
            }, 3200);
          } else if (msg.type === 'rtc_offer' && msg.fromPeerId && msg.sdp) {
            const pc = getOrCreatePeerConnection(msg.fromPeerId);
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            await flushPendingIce(msg.fromPeerId, pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendWs({ type: 'rtc_answer', targetPeerId: msg.fromPeerId, sdp: pc.localDescription });
          } else if (msg.type === 'rtc_answer' && msg.fromPeerId && msg.sdp) {
            const pc = peerConnectionsRef.current.get(msg.fromPeerId);
            if (pc) {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
              await flushPendingIce(msg.fromPeerId, pc);
            }
          } else if (msg.type === 'rtc_ice' && msg.fromPeerId && msg.candidate) {
            const pc = peerConnectionsRef.current.get(msg.fromPeerId);
            if (pc && pc.remoteDescription) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
              } catch {}
            } else {
              const list = pendingIceRef.current.get(msg.fromPeerId) || [];
              list.push(msg.candidate);
              pendingIceRef.current.set(msg.fromPeerId, list);
            }
          }
        } catch {}
      };

      ws.onclose = () => {
        setIsRoomConnected(false);
        setRoomJoinState((prev) => (prev === 'denied' ? 'denied' : 'idle'));
      };
      ws.onerror = () => {
        setIsRoomConnected(false);
        setRoomJoinState((prev) => (prev === 'denied' ? 'denied' : 'idle'));
      };
    },
    [
      trackEngagement,
      roomCode,
      collabName,
      collabRole,
      isInviteMode,
      guestKey,
      currentUser?.uid,
      currentUser?.email,
      micOn,
      camOn,
      screenOn,
      handRaised,
      logAnalyticsEvent,
      onRoomCodeChange,
      showToast,
      disconnectRoom,
      reconcilePeers,
      closePeerConnection,
      getOrCreatePeerConnection,
      flushPendingIce,
      sendWs,
    ]
  );

  const handleHostAdmitPeer = (targetClientId: string) => {
    sendWs({ type: 'host_admit', targetClientId });
  };

  const handleHostDenyPeer = (targetClientId: string) => {
    sendWs({ type: 'host_deny', targetClientId });
  };

  const handleHostRemovePeer = (targetClientId: string) => {
    sendWs({ type: 'host_remove_participant', targetClientId });
  };

  const handleHostUnblockDenied = (entryGuestKey: string) => {
    sendWs({ type: 'host_unblock_denied', guestKey: entryGuestKey });
  };

  // If opened directly via a shared invite link (?room=XYZ or /join/XYZ), pre-fill code and default to Guest knock mode
  useEffect(() => {
    if (initialRoomCode && autoJoinedInitialRef.current !== initialRoomCode.toUpperCase()) {
      const target = initialRoomCode.toUpperCase();
      autoJoinedInitialRef.current = target;
      setRoomCode(target);
      setIsInviteMode(true);
      setCollabRole((prev) => (prev === 'Team Host' ? 'Invited Guest' : prev));
      setCollabName((prev) => (prev === 'Host' ? currentUser?.displayName || 'Guest' : prev));
      setActiveTab('room');
    }
  }, [initialRoomCode, currentUser?.displayName]);

  useEffect(() => {
    return () => disconnectRoom();
  }, [disconnectRoom]);

  const handleToggleMic = async () => {
    setMediaError(null);
    if (!localStreamRef.current || localStreamRef.current.getAudioTracks().length === 0) {
      try {
        const audioConstraint: boolean | MediaTrackConstraints = selectedAudioDeviceId
          ? { deviceId: { exact: selectedAudioDeviceId } }
          : true;
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
        const track = audioStream.getAudioTracks()[0];
        if (!localStreamRef.current) localStreamRef.current = new MediaStream([track]);
        else localStreamRef.current.addTrack(track);
        setMicOn(true);
        broadcastMediaState(true, camOn, screenOn);
        void refreshMediaDeviceList();
        await renegotiateAllPeers();
      } catch (err: any) {
        setMediaError(err?.message || 'Microphone permission was declined or unavailable.');
      }
      return;
    }
    const nextMic = !micOn;
    localStreamRef.current.getAudioTracks().forEach((t) => {
      t.enabled = nextMic;
    });
    setMicOn(nextMic);
    broadcastMediaState(nextMic, camOn, screenOn);
  };

  const handleSelectAudioDevice = async (deviceId: string) => {
    setSelectedAudioDeviceId(deviceId);
    setDeviceMenuOpen(null);
    if (!micOn && (!localStreamRef.current || localStreamRef.current.getAudioTracks().length === 0)) return;
    try {
      const nextAudio = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      const newTrack = nextAudio.getAudioTracks()[0];
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((t) => {
          t.stop();
          localStreamRef.current?.removeTrack(t);
        });
        localStreamRef.current.addTrack(newTrack);
      } else {
        localStreamRef.current = new MediaStream([newTrack]);
      }
      newTrack.enabled = micOn;
      await renegotiateAllPeers();
    } catch (err: any) {
      setMediaError(err?.message || 'Unable to switch microphone device.');
    }
  };

  const handleToggleCamera = async () => {
    setMediaError(null);
    if (!localStreamRef.current || localStreamRef.current.getVideoTracks().length === 0) {
      try {
        const videoConstraint: MediaTrackConstraints = {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(selectedVideoDeviceId
            ? { deviceId: { exact: selectedVideoDeviceId } }
            : { facingMode: { ideal: cameraFacingMode } }),
        };
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraint });
        const track = videoStream.getVideoTracks()[0];
        const settings = track?.getSettings?.();
        if (settings?.facingMode === 'user' || settings?.facingMode === 'environment') {
          setCameraFacingMode(settings.facingMode);
        }
        if (settings?.deviceId) setSelectedVideoDeviceId(settings.deviceId);

        if (!localStreamRef.current) localStreamRef.current = new MediaStream([track]);
        else localStreamRef.current.addTrack(track);
        setCamOn(true);
        broadcastMediaState(micOn, true, screenOn);
        refreshLocalPreview();
        void refreshMediaDeviceList();
        await renegotiateAllPeers();
      } catch (err: any) {
        setMediaError(err?.message || 'Camera permission was declined or no camera detected.');
      }
      return;
    }
    const nextCam = !camOn;
    localStreamRef.current.getVideoTracks().forEach((t) => {
      t.enabled = nextCam;
    });
    setCamOn(nextCam);
    broadcastMediaState(micOn, nextCam, screenOn);
    refreshLocalPreview();
  };

  const handleSwitchCameraFacing = async (explicitFacing?: 'user' | 'environment') => {
    const nextFacing: 'user' | 'environment' =
      explicitFacing || (cameraFacingMode === 'user' ? 'environment' : 'user');
    setMediaError(null);
    setDeviceMenuOpen(null);
    setCameraFacingMode(nextFacing);

    const hasExistingCam = camOn || Boolean(localStreamRef.current?.getVideoTracks().length);
    if (!hasExistingCam) return;

    try {
      // Release active camera hardware BEFORE opening the rear/front sensor (critical for iOS & Android)
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((t) => {
          t.stop();
          localStreamRef.current?.removeTrack(t);
        });
      }
      await new Promise((r) => window.setTimeout(r, 85));

      let nextVideo: MediaStream;
      try {
        nextVideo = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { exact: nextFacing },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch {
        const matched = videoInputs.find((d) =>
          nextFacing === 'environment'
            ? /back|rear|environment|world|trasera/i.test(d.label)
            : /front|user|facetime|selfie/i.test(d.label)
        );
        nextVideo = await navigator.mediaDevices.getUserMedia({
          video: matched?.deviceId
            ? { deviceId: { exact: matched.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: { ideal: nextFacing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      }

      const newTrack = nextVideo.getVideoTracks()[0];
      if (!newTrack) {
        throw new Error('No video track returned from camera.');
      }
      const settings = newTrack.getSettings?.();
      if (settings?.deviceId) setSelectedVideoDeviceId(settings.deviceId);
      if (settings?.facingMode === 'user' || settings?.facingMode === 'environment') {
        setCameraFacingMode(settings.facingMode);
      }

      if (localStreamRef.current) {
        localStreamRef.current.addTrack(newTrack);
      } else {
        localStreamRef.current = new MediaStream([newTrack]);
      }
      newTrack.enabled = true;
      setCamOn(true);
      broadcastMediaState(micOn, true, screenOn);
      refreshLocalPreview();
      void refreshMediaDeviceList();
      await renegotiateAllPeers();
      showToast(nextFacing === 'environment' ? 'Switched to rear camera.' : 'Switched to front camera.');
    } catch (err: any) {
      setMediaError(err?.message || 'Unable to switch front/rear camera on this device.');
    }
  };

  const handleSelectVideoDevice = async (deviceId: string) => {
    setSelectedVideoDeviceId(deviceId);
    setDeviceMenuOpen(null);
    const matchedMeta = videoInputs.find((d) => d.deviceId === deviceId);
    if (matchedMeta && /back|rear|environment|world/i.test(matchedMeta.label)) {
      setCameraFacingMode('environment');
    } else if (matchedMeta && /front|user|facetime|selfie/i.test(matchedMeta.label)) {
      setCameraFacingMode('user');
    }

    if (!camOn && (!localStreamRef.current || localStreamRef.current.getVideoTracks().length === 0)) return;
    try {
      // Stop existing camera track first so mobile OS camera lock is released
      if (localStreamRef.current) {
        localStreamRef.current.getVideoTracks().forEach((t) => {
          t.stop();
          localStreamRef.current?.removeTrack(t);
        });
      }
      await new Promise((r) => window.setTimeout(r, 85));

      const nextVideo = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: cameraFacingMode } }),
        },
      });
      const newTrack = nextVideo.getVideoTracks()[0];
      const settings = newTrack?.getSettings?.();
      if (settings?.facingMode === 'user' || settings?.facingMode === 'environment') {
        setCameraFacingMode(settings.facingMode);
      }

      if (localStreamRef.current) {
        localStreamRef.current.addTrack(newTrack);
      } else {
        localStreamRef.current = new MediaStream([newTrack]);
      }
      newTrack.enabled = true;
      setCamOn(true);
      broadcastMediaState(micOn, true, screenOn);
      refreshLocalPreview();
      await renegotiateAllPeers();
    } catch (err: any) {
      setMediaError(err?.message || 'Unable to switch camera device.');
    }
  };

  const handleToggleScreenShare = async () => {
    setMediaError(null);
    if (screenOn && screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setScreenOn(false);
      broadcastMediaState(micOn, camOn, false);
      refreshLocalPreview();
      await renegotiateAllPeers();
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = displayStream;
      setScreenOn(true);
      setLayoutMode('spotlight');
      setPinnedPeerId('local');
      broadcastMediaState(micOn, camOn, true);
      refreshLocalPreview();
      await renegotiateAllPeers();

      const track = displayStream.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          screenStreamRef.current = null;
          setScreenOn(false);
          broadcastMediaState(micOn, camOn, false);
          refreshLocalPreview();
          void renegotiateAllPeers();
        };
      }
    } catch (err: any) {
      setMediaError(err?.message || 'Screen sharing was cancelled or blocked.');
    }
  };

  const handleToggleHand = () => {
    const next = !handRaised;
    setHandRaised(next);
    sendWs({ type: 'hand_state', handRaised: next });
  };

  const handleSendReaction = (emoji: string) => {
    setReactionMenuOpen(false);
    if (isRoomConnected) {
      sendWs({ type: 'room_reaction', emoji });
    } else {
      const id = `local_react_${Date.now()}`;
      setReactionsFeed((prev) => [...prev.slice(-7), { id, senderName: collabName || 'You', emoji }]);
      window.setTimeout(() => {
        setReactionsFeed((prev) => prev.filter((r) => r.id !== id));
      }, 3200);
    }
  };

  const handleSendChatMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed) return;
    if (isRoomConnected) {
      sendWs({ type: 'room_chat', text: trimmed });
    } else {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `local_chat_${Date.now()}`,
          clientId: 'local',
          senderName: collabName.trim() || 'You',
          senderColor: '#4F46E5',
          text: trimmed,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
    setChatInput('');
  };

  const handleToggleSidePanel = (target: 'chat' | 'people' | 'notes') => {
    setSidePanel((curr) => {
      const next = curr === target ? 'none' : target;
      if (next === 'chat') setUnreadChatCount(0);
      return next;
    });
  };

  const handleToggleStageFullscreen = async () => {
    const el = stageContainerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (el.requestFullscreen) {
        await el.requestFullscreen();
      }
    } catch {}
  };

  const meetingShareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?room=${encodeURIComponent(roomCode.trim().toUpperCase())}`
      : '';

  const handleCopyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      showToast(`Room code ${roomCode} copied.`);
    } catch {
      showToast(`Share room code: ${roomCode}`);
    }
  };

  const handleCopyMeetingLink = async () => {
    try {
      await navigator.clipboard.writeText(meetingShareUrl);
      showToast('Invite link copied. Guests will confirm the room code and ask permission to join.');
    } catch {
      showToast(`Meeting link: ${meetingShareUrl}`);
    }
  };

  const handleNewSessionRoom = () => {
    const nextCode = generateUniqueSessionCode();
    disconnectRoom(false);
    setRoomCode(nextCode);
    setIsInviteMode(false);
    onRoomCodeChange?.(nextCode);
    showToast(`Created fresh meeting session ${nextCode}.`);
  };

  // ================= PER-TAB GENERATION & ENHANCE PROMPT =================
  const handleEnhanceMapPrompt = async () => {
    if (!mapPrompt.trim()) return;
    setEnhancingMap(true);
    setMapError(null);
    try {
      const improved = await enhanceFinancialPrompt(mapPrompt.trim());
      setMapPrompt(improved);
    } finally {
      setEnhancingMap(false);
    }
  };

  const handleGenerateMindMap = async () => {
    if (!mapPrompt.trim()) return;
    if (!trackEngagement('Mind Map Studio')) return;
    setGeneratingMap(true);
    setMapError(null);
    try {
      const resp = await fetch('/api/gemini/vision-mindmap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: mapPrompt.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok || !Array.isArray(data.nodes)) {
        throw new Error(data.error || 'Could not generate mind map right now.');
      }
      if (data.title) setBoardTitle(data.title);
      setNodes(data.nodes);
      setSelectedNodeId(data.nodes[0]?.id || '');
      setInlineEditingNodeId(null);
      setHoveredNodeId(null);
      setHasMapOutput(true);
      broadcastNodes(data.nodes);
      logAnalyticsEvent('vision_collab', 'vision', `ai_mindmap:${mapPrompt.slice(0, 40)}`);
      showToast('Created visual mind map.');
    } catch (err: any) {
      setMapError(err?.message || 'Unable to generate mind map right now.');
    } finally {
      setGeneratingMap(false);
    }
  };

  const handleEnhanceSlidePrompt = async () => {
    if (!slidePrompt.trim()) return;
    setEnhancingSlides(true);
    setSlideError(null);
    try {
      const improved = await enhanceFinancialPrompt(slidePrompt.trim());
      setSlidePrompt(improved);
    } finally {
      setEnhancingSlides(false);
    }
  };

  const handleOpenSlideConfigurator = () => {
    if (!slidePrompt.trim()) {
      setSlideError('Describe your financial presentation topic first.');
      return;
    }
    setSlideError(null);
    setConfigStep(1);
    setIsSlideConfigOpen(true);
  };

  const handleGenerateSlides = async (overrideCount?: number) => {
    const cleanTopic = slidePrompt.trim();
    if (!cleanTopic) {
      setSlideError('Enter a financial topic before generating slides.');
      return;
    }
    if (!trackEngagement('Slide Deck Creator')) return;
    const requestedCount = Math.max(4, Math.min(15, Number(overrideCount ?? slideCount) || 6));
    setGeneratingSlides(true);
    setSlideError(null);
    try {
      const resp = await fetch('/api/gemini/vision-slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: cleanTopic,
          theme: deckTheme,
          slideCount: requestedCount,
          fontStyle: slideFontStyle,
          contentStyle: slideContentStyle,
          graphicsStyle: slideGraphicsStyle,
          audience: deckAudience,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !Array.isArray(data.slides)) {
        throw new Error(data.error || 'Could not generate slides right now.');
      }
      if (data.title) setBoardTitle(data.title);
      const themed: SlideItem[] = data.slides.slice(0, requestedCount).map((s: SlideItem) => ({
        ...s,
        theme: s.theme || deckTheme,
        fontStyle: s.fontStyle || slideFontStyle,
        contentStyle: s.contentStyle || slideContentStyle,
        graphicsStyle: s.graphicsStyle || slideGraphicsStyle,
      }));
      setSlides(themed);
      setActiveSlideId(themed[0]?.id || '');
      setHasSlidesOutput(true);
      setIsSlideConfigOpen(false);
      broadcastSlides(themed);
      logAnalyticsEvent('vision_collab', 'vision', `ai_slides:${themed.length}:${cleanTopic.slice(0, 40)}`);
      showToast(`Generated ${themed.length} financial slides.`);
    } catch (err: any) {
      setSlideError(err?.message || 'Unable to generate presentation slides right now.');
    } finally {
      setGeneratingSlides(false);
    }
  };

  // ================= BOARD MANAGEMENT (SAVE, LOAD & DELETE) =================
  const handleSaveBoard = async () => {
    setSavingBoard(true);
    try {
      const board: IdeationBoardRecord = {
        boardId,
        title: boardTitle.trim() || 'Strategy Workspace',
        roomCode,
        ownerUserId: currentUser?.uid || 'local-user',
        nodes,
        slides,
        meetingNotes,
        updatedAt: new Date().toISOString(),
      };
      const result = await saveIdeationBoard(board);
      const updated = await loadIdeationBoards();
      setSavedBoards(updated);
      if (result.syncedToCloud) {
        showToast('Saved to cloud workspace.');
      } else if (result.ok) {
        showToast(
          result.error
            ? `Saved on this device (${result.error})`
            : 'Saved on this device.'
        );
      } else {
        showToast(result.error || 'Could not save right now.');
      }
    } finally {
      setSavingBoard(false);
    }
  };

  const handleLoadBoard = (b: IdeationBoardRecord, target?: 'mindmap' | 'slides') => {
    setBoardId(b.boardId);
    setBoardTitle(b.title);
    setRoomCode(b.roomCode);
    if (b.nodes.length > 0) {
      setNodes(b.nodes);
      setSelectedNodeId(b.nodes[0].id);
      setInlineEditingNodeId(null);
      if (!target || target === 'mindmap') setHasMapOutput(true);
    }
    if (b.slides.length > 0) {
      setSlides(b.slides);
      setActiveSlideId(b.slides[0].id);
      if (b.slides[0].theme) setDeckTheme(b.slides[0].theme);
      if (!target || target === 'slides') setHasSlidesOutput(true);
    }
    setMeetingNotes(b.meetingNotes || []);
    showToast(`Opened "${b.title}".`);
  };

  const handleDeleteCurrentMindMap = async () => {
    const isSaved = savedBoards.some((b) => b.boardId === boardId);
    if (isSaved) {
      await deleteIdeationBoard(boardId);
      setSavedBoards(await loadIdeationBoards());
    }
    setNodes(DEFAULT_NODES);
    setSelectedNodeId('n-root');
    setInlineEditingNodeId(null);
    setHoveredNodeId(null);
    setMapZoom(1);
    setHasMapOutput(false);
    setMapExportMenuOpen(false);
    showToast('Deleted mind map generation.');
  };

  const handleDeleteCurrentDeck = async () => {
    const isSaved = savedBoards.some((b) => b.boardId === boardId);
    if (isSaved) {
      await deleteIdeationBoard(boardId);
      setSavedBoards(await loadIdeationBoards());
    }
    setSlides(DEFAULT_SLIDES);
    setActiveSlideId(DEFAULT_SLIDES[0].id);
    setHasSlidesOutput(false);
    showToast('Deleted presentation deck.');
  };

  // ================= PER-TAB ISOLATED EXPORTS (.html ONLY) =================
  const buildSlidesDocumentHtml = () => {
    const slidesHtml = slides
      .map((s, idx) => {
        const t = SLIDE_THEMES[s.theme || deckTheme] || SLIDE_THEMES.ivory;
        const fontSpec = SLIDE_FONTS[s.fontStyle || slideFontStyle] || SLIDE_FONTS.swiss_sans;
        const bullets = (s.bullets || []).filter(Boolean);
        const bars = Array.isArray(s.chartBars) && s.chartBars.length > 0 ? s.chartBars.slice(0, 5) : [];
        const maxBarVal = Math.max(1, ...bars.map((b) => Number(b.value) || 0));
        const chartHtml = bars.length
          ? `<div class="chart-box" style="background:${t.cardHex};border-color:${t.borderHex}">
              <div class="chart-caption" style="color:${t.mutedHex}">Quantitative Breakdown</div>
              <div class="bar-list">
                ${bars
                  .map((bar) => {
                    const pct = Math.max(12, Math.min(100, Math.round(((Number(bar.value) || 0) / maxBarVal) * 100)));
                    return `<div class="bar-row">
                      <div class="bar-meta"><span>${escapeHtmlText(bar.label)}</span><span style="color:${t.accentHex}">${escapeHtmlText(String(bar.value))}${escapeHtmlText(bar.unit || '')}</span></div>
                      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${t.accentHex}"></div></div>
                    </div>`;
                  })
                  .join('')}
              </div>
            </div>`
          : '';
        return `
          <section class="deck-slide${idx === 0 ? ' is-active' : ''}" data-index="${idx}" style="background:${t.bgHex};color:${t.textHex};border-color:${t.borderHex};font-family:${fontSpec.cssFamily}">
            <div class="slide-head">
              <span class="slide-kicker" style="color:${t.accentHex}">${escapeHtmlText(boardTitle)}</span>
              <span class="slide-count" style="color:${t.mutedHex}">${String(idx + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}</span>
            </div>
            <div class="slide-main">
              <div class="slide-copy">
                <h2>${escapeHtmlText(s.title || 'Untitled Slide')}</h2>
                ${s.subtitle ? `<p class="slide-subtitle" style="color:${t.mutedHex}">${escapeHtmlText(s.subtitle)}</p>` : ''}
                <div class="card-grid">
                  ${bullets
                    .map(
                      (b, bi) => `
                    <div class="swiss-card" style="background:${t.cardHex};border-color:${t.borderHex}">
                      <span class="card-num" style="color:${t.accentHex}">0${bi + 1}</span>
                      <p>${escapeHtmlText(b)}</p>
                    </div>`
                    )
                    .join('')}
                </div>
              </div>
              <div class="side-panels">
                ${
                  s.metricHighlight
                    ? `<aside class="metric-panel" style="background:${t.cardHex};border-color:${t.borderHex}">
                        <span class="metric-label" style="color:${t.mutedHex}">Key Figure</span>
                        <div class="metric-value" style="color:${t.accentHex}">${escapeHtmlText(s.metricHighlight)}</div>
                      </aside>`
                    : ''
                }
                ${chartHtml}
              </div>
            </div>
            <div class="slide-foot" style="color:${t.mutedHex};border-color:${t.borderHex}">
              <span>${escapeHtmlText(currentUser?.displayName || collabName || 'Workspace Member')}</span>
              <span>${escapeHtmlText(t.label)} · ${escapeHtmlText(fontSpec.label)}</span>
            </div>
          </section>`;
      })
      .join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtmlText(boardTitle || 'Financial Presentation')} — Interactive HTML Deck</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ${(SLIDE_FONTS[slideFontStyle] || SLIDE_FONTS.swiss_sans).cssFamily};
      background: #F4F4F5;
      color: #111111;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px 84px;
    }
    .deck-viewport { width: 100%; max-width: 1080px; }
    .deck-slide {
      display: none;
      width: 100%;
      aspect-ratio: 16 / 9;
      min-height: 460px;
      border-radius: 20px;
      border: 1px solid #E5E5E5;
      padding: clamp(24px, 4vw, 48px);
      flex-direction: column;
      justify-content: space-between;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.06);
    }
    .deck-slide.is-active { display: flex; }
    .slide-head { display: flex; justify-content: space-between; align-items: center; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 700; }
    .slide-main { display: grid; grid-template-columns: 1fr; gap: 24px; margin: auto 0; align-items: center; }
    @media (min-width: 780px) { .slide-main { grid-template-columns: 1fr auto; } }
    h2 { font-size: clamp(24px, 3.2vw, 38px); line-height: 1.12; letter-spacing: -0.025em; margin: 0 0 10px; font-weight: 800; }
    .slide-subtitle { font-size: 15px; line-height: 1.5; margin: 0 0 22px; max-width: 680px; }
    .card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
    .swiss-card { border-radius: 14px; border: 1px solid #E5E5E5; padding: 14px 16px; }
    .card-num { display: block; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; margin-bottom: 6px; }
    .swiss-card p { margin: 0; font-size: 13.5px; line-height: 1.45; font-weight: 500; }
    .metric-panel { min-width: 220px; border-radius: 16px; border: 1px solid #E5E5E5; padding: 20px; text-align: left; }
    .metric-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 600; margin-bottom: 8px; }
    .metric-value { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; }
    .side-panels { display: flex; flex-direction: column; gap: 12px; min-width: 225px; }
    .chart-box { border-radius: 16px; border: 1px solid #E5E5E5; padding: 14px 16px; }
    .chart-caption { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; margin-bottom: 10px; font-family: ui-monospace, Menlo, monospace; }
    .bar-list { display: flex; flex-direction: column; gap: 8px; }
    .bar-meta { display: flex; justify-content: space-between; font-size: 11px; font-weight: 600; margin-bottom: 3px; }
    .bar-track { width: 100%; height: 6px; border-radius: 999px; background: rgba(120,120,140,0.16); overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 999px; }
    .slide-foot { display: flex; justify-content: space-between; font-size: 11px; padding-top: 14px; border-top: 1px solid #E5E5E5; }
    .controls {
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 12px;
      background: #111111; color: #FFFFFF; padding: 8px 14px; border-radius: 14px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.18); font-size: 12px;
    }
    .controls button {
      background: rgba(255,255,255,0.14); border: none; color: #FFFFFF;
      padding: 6px 12px; border-radius: 9px; font-weight: 600; cursor: pointer;
    }
    .controls button:hover { background: rgba(255,255,255,0.24); }
    @media print {
      body { background: #FFFFFF; padding: 0; }
      .controls { display: none; }
      .deck-slide { display: flex !important; box-shadow: none; page-break-after: always; margin-bottom: 16px; }
    }
  </style>
</head>
<body>
  <main class="deck-viewport" id="deck">${slidesHtml}</main>
  <nav class="controls" aria-label="Slide controls">
    <button type="button" id="prevBtn">Prev</button>
    <span id="pager">1 / ${slides.length}</span>
    <button type="button" id="nextBtn">Next</button>
  </nav>
  <script>
    (function () {
      var slides = Array.prototype.slice.call(document.querySelectorAll('.deck-slide'));
      var idx = 0;
      var pager = document.getElementById('pager');
      function show(n) {
        idx = Math.max(0, Math.min(slides.length - 1, n));
        slides.forEach(function (el, i) { el.classList.toggle('is-active', i === idx); });
        if (pager) pager.textContent = (idx + 1) + ' / ' + slides.length;
      }
      document.getElementById('prevBtn').addEventListener('click', function () { show(idx - 1); });
      document.getElementById('nextBtn').addEventListener('click', function () { show(idx + 1); });
      window.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === ' ') show(idx + 1);
        if (e.key === 'ArrowLeft') show(idx - 1);
      });
      var touchX = null;
      document.getElementById('deck').addEventListener('touchstart', function (e) {
        touchX = e.touches && e.touches[0] ? e.touches[0].clientX : null;
      }, { passive: true });
      document.getElementById('deck').addEventListener('touchend', function (e) {
        if (touchX === null || !e.changedTouches || !e.changedTouches[0]) return;
        var dx = e.changedTouches[0].clientX - touchX;
        touchX = null;
        if (Math.abs(dx) > 45) show(dx < 0 ? idx + 1 : idx - 1);
      }, { passive: true });
    })();
  </script>
</body>
</html>`;
  };

  const handleDownloadSlidesHtml = () => {
    setSlideExportMenuOpen(false);
    const safeName = (boardTitle || 'presentation').replace(/[^a-zA-Z0-9_-]/g, '-');
    triggerFileDownload(buildSlidesDocumentHtml(), `${safeName}-presentation.html`, 'text/html');
    logAnalyticsEvent('vision_collab', 'vision', `export_html:${slides.length}_slides`);
    showToast('Downloaded interactive HTML presentation (.html).');
  };

  const handleDownloadSlidesPdf = () => {
    setSlideExportMenuOpen(false);
    exportSlidesAsPdf(
      slides,
      boardTitle,
      deckTheme,
      slideFontStyle,
      SLIDE_THEMES,
      currentUser?.displayName || collabName || 'Workspace Member'
    );
    logAnalyticsEvent('vision_collab', 'vision', `export_pdf:${slides.length}_slides`);
    showToast('Downloaded widescreen PDF deck (.pdf).');
  };

  const handleDownloadSlidesPptx = async () => {
    setSlideExportMenuOpen(false);
    setExportingPptx(true);
    try {
      await exportSlidesAsPptx(
        slides,
        boardTitle,
        deckTheme,
        slideFontStyle,
        SLIDE_THEMES,
        currentUser?.displayName || collabName || 'Workspace Member'
      );
      logAnalyticsEvent('vision_collab', 'vision', `export_pptx:${slides.length}_slides`);
      showToast('Downloaded PowerPoint deck (.pptx).');
    } catch {
      showToast('Could not compile PowerPoint export. Try PDF or HTML.');
    } finally {
      setExportingPptx(false);
    }
  };

  const handleDownloadSlidesMarkdown = () => {
    setSlideExportMenuOpen(false);
    exportSlidesAsMarkdown(slides, boardTitle);
    logAnalyticsEvent('vision_collab', 'vision', `export_md:${slides.length}_slides`);
    showToast('Downloaded presentation outline (.md).');
  };

  const handleDownloadSlidesJson = () => {
    setSlideExportMenuOpen(false);
    exportSlidesAsJson(slides, boardTitle, deckTheme, slideFontStyle);
    logAnalyticsEvent('vision_collab', 'vision', `export_json:${slides.length}_slides`);
    showToast('Downloaded structured deck JSON (.json).');
  };

  // Mind Map ONLY Vector SVG Export (Dynamic bounding box so stretched nodes never clip)
  const handleExportMindMapSvg = () => {
    setMapExportMenuOpen(false);
    const minX = (nodes.length ? Math.min(...nodes.map((n) => n.x)) : 0) - 60;
    const minY = (nodes.length ? Math.min(...nodes.map((n) => n.y)) : 0) - 60;
    const maxX = (nodes.length ? Math.max(...nodes.map((n) => n.x + 260)) : 980) + 60;
    const maxY = (nodes.length ? Math.max(...nodes.map((n) => n.y + 140)) : 580) + 60;
    const width = Math.max(980, Math.round(maxX - minX));
    const height = Math.max(580, Math.round(maxY - minY));
    const edgesSvg = nodes
      .map((node) => {
        if (!node.parentId) return '';
        const parent = nodes.find((p) => p.id === node.parentId);
        if (!parent) return '';
        const x1 = parent.x - minX + 224;
        const y1 = parent.y - minY + 44;
        const x2 = node.x - minX;
        const y2 = node.y - minY + 44;
        const mx = (x1 + x2) / 2;
        const stroke = NODE_COLORS[node.color]?.accentHex || '#6366F1';
        return `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="2.4" stroke-opacity="0.7" />`;
      })
      .join('\n');

    const nodesSvg = nodes
      .map((node) => {
        const accent = NODE_COLORS[node.color]?.accentHex || '#4F46E5';
        const title = escapeHtmlText((node.label || '').slice(0, 34));
        const note = escapeHtmlText((node.notes || '').slice(0, 56));
        const tag = escapeHtmlText((node.metricTag || node.shape || 'Node').slice(0, 18));
        return `
        <g transform="translate(${node.x - minX}, ${node.y - minY})">
          <rect x="0" y="0" width="224" height="94" rx="14" fill="#FFFFFF" stroke="${accent}" stroke-width="2" />
          <rect x="0" y="0" width="224" height="6" rx="3" fill="${accent}" />
          <text x="14" y="24" font-family="monospace" font-size="10" font-weight="700" fill="${accent}">${tag}</text>
          <text x="14" y="45" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#111827">${title}</text>
          <text x="14" y="68" font-family="system-ui, sans-serif" font-size="10.5" fill="#4B5563">${note}</text>
        </g>`;
      })
      .join('\n');

    const svgDoc = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#F8FAFC" />
  ${edgesSvg}
  ${nodesSvg}
</svg>`;
    const safeName = (boardTitle || 'mind-map').replace(/[^a-zA-Z0-9_-]/g, '-');
    triggerFileDownload(svgDoc, `${safeName}-mindmap.svg`, 'image/svg+xml');
    showToast('Downloaded Mind Map diagram (.svg).');
  };

  // Mind Map ONLY Markdown Export
  const handleExportMindMapMarkdown = () => {
    setMapExportMenuOpen(false);
    const mdLines: string[] = [
      `# ${boardTitle || 'Mind Map'}`,
      `Exported: ${new Date().toLocaleString()}`,
      '',
      ...nodes.map(
        (n) => `- **${n.label}**${n.metricTag ? ` [${n.metricTag}]` : ''}${n.notes ? ` — ${n.notes}` : ''}`
      ),
    ];
    const safeName = (boardTitle || 'mind-map').replace(/[^a-zA-Z0-9_-]/g, '-');
    triggerFileDownload(mdLines.join('\n'), `${safeName}-mindmap.md`, 'text/markdown');
    showToast('Downloaded Mind Map outline (.md).');
  };

  // Mind Map ONLY JSON Export
  const handleExportMindMapJson = () => {
    setMapExportMenuOpen(false);
    const payload = {
      title: boardTitle,
      exportedAt: new Date().toISOString(),
      nodes,
    };
    const safeName = (boardTitle || 'mind-map').replace(/[^a-zA-Z0-9_-]/g, '-');
    triggerFileDownload(JSON.stringify(payload, null, 2), `${safeName}-mindmap.json`, 'application/json');
    showToast('Downloaded Mind Map nodes (.json).');
  };

  // Concept Visual Download Helper (Handles PNG/JPG/WebP/SVG cleanly)
  const handleDownloadVisualAsset = (url: string, label: string) => {
    const safeName = (label || 'concept-visual').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'concept-visual';
    let ext = 'png';
    if (url.startsWith('data:image/jpeg') || url.startsWith('data:image/jpg')) ext = 'jpg';
    else if (url.startsWith('data:image/webp')) ext = 'webp';
    else if (url.startsWith('data:image/svg')) ext = 'svg';
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeName}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Downloaded ${safeName}.${ext}.`);
  };

  // ================= MIND MAP INTERACTION (UNBOUNDED AUTO-EXPANDING GRAPH + PAN + FIT) =================
  const handleNodePointerDown = (e: React.PointerEvent, node: MindMapNode) => {
    if ((e.target as HTMLElement).closest('input, textarea, select, button')) return;
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {}
    setSelectedNodeId(node.id);
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const worldX = (e.clientX - rect.left) / mapZoom + mapBounds.minX;
    const worldY = (e.clientY - rect.top) / mapZoom + mapBounds.minY;
    dragOffsetRef.current = {
      dx: worldX - node.x,
      dy: worldY - node.y,
    };
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    didDragMoveRef.current = false;
    setDraggingId(node.id);
    setHoveredNodeId(null);
  };

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    const viewport = mapViewportRef.current;
    if (!viewport) return;
    if (e.target !== e.currentTarget && (e.target as HTMLElement)?.tagName !== 'svg') return;
    setIsPanningMap(true);
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
  };

  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    if (draggingId && canvasRef.current) {
      const moveDist = Math.hypot(e.clientX - dragStartRef.current.x, e.clientY - dragStartRef.current.y);
      if (moveDist > 5) {
        didDragMoveRef.current = true;
      }
      const rect = canvasRef.current.getBoundingClientRect();
      const nextX = (e.clientX - rect.left) / mapZoom + mapBounds.minX - dragOffsetRef.current.dx;
      const nextY = (e.clientY - rect.top) / mapZoom + mapBounds.minY - dragOffsetRef.current.dy;
      setNodes((prev) =>
        prev.map((n) => (n.id === draggingId ? { ...n, x: Math.round(nextX), y: Math.round(nextY) } : n))
      );
      return;
    }

    if (panStartRef.current && mapViewportRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      mapViewportRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
      mapViewportRef.current.scrollTop = panStartRef.current.scrollTop - dy;
    }
  };

  const handleCanvasPointerUp = () => {
    if (panStartRef.current) {
      panStartRef.current = null;
      setIsPanningMap(false);
    }
    if (draggingId) {
      const releasedId = draggingId;
      setDraggingId(null);
      if (didDragMoveRef.current) {
        broadcastNodes(nodes);
      } else {
        setInlineEditingNodeId((curr) => (curr === releasedId ? curr : releasedId));
      }
    }
  };

  const handleFitMindMap = useCallback(() => {
    const viewport = mapViewportRef.current;
    if (!viewport || nodes.length === 0) {
      setMapZoom(1);
      return;
    }
    const minX = Math.min(...nodes.map((n) => n.x)) - 48;
    const minY = Math.min(...nodes.map((n) => n.y)) - 48;
    const maxX = Math.max(...nodes.map((n) => n.x + 250)) + 48;
    const maxY = Math.max(...nodes.map((n) => n.y + 120)) + 48;
    const contentW = Math.max(400, maxX - minX);
    const contentH = Math.max(300, maxY - minY);
    const viewW = viewport.clientWidth || 720;
    const viewH = viewport.clientHeight || 480;
    const fitZoom = Math.min(1.15, Math.max(0.4, Number(Math.min(viewW / contentW, viewH / contentH).toFixed(2))));
    setMapZoom(fitZoom);

    window.requestAnimationFrame(() => {
      if (!mapViewportRef.current) return;
      const targetCenterX = ((minX + maxX) / 2 - mapBounds.minX) * fitZoom;
      const targetCenterY = ((minY + maxY) / 2 - mapBounds.minY) * fitZoom;
      mapViewportRef.current.scrollTo({
        left: Math.max(0, targetCenterX - viewW / 2),
        top: Math.max(0, targetCenterY - viewH / 2),
        behavior: 'smooth',
      });
    });
  }, [nodes, mapBounds.minX, mapBounds.minY]);

  const handleAutoArrangeNodes = () => {
    const root = nodes.find((n) => !n.parentId) || nodes[0];
    if (!root) return;
    const children = nodes.filter((n) => n.id !== root.id);
    const total = children.length;
    const cx = 420;
    const cy = 260;
    const rx = Math.max(300, total * 34);
    const ry = Math.max(185, total * 22);
    const nextNodes = nodes.map((n) => {
      if (n.id === root.id) {
        return { ...n, x: cx, y: cy, shape: n.shape || 'hub' };
      }
      const idx = children.findIndex((c) => c.id === n.id);
      const angle = (idx / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
      return {
        ...n,
        x: Math.round(cx + Math.cos(angle) * rx),
        y: Math.round(cy + Math.sin(angle) * ry),
      };
    });
    setNodes(nextNodes);
    broadcastNodes(nextNodes);
    showToast('Arranged branches cleanly across the canvas.');
  };

  const addChildNode = (explicitParentId?: string) => {
    const parent = nodes.find((n) => n.id === (explicitParentId || selectedNodeId)) || nodes[0];
    const id = `n-${Date.now().toString(36)}`;
    const colors: MindMapNode['color'][] = ['sky', 'emerald', 'amber', 'rose', 'indigo'];
    const shapes: MindMapShape[] = ['insight', 'metric', 'step', 'action'];
    const offsetSign = nodes.length % 2 === 0 ? 1 : -1;
    const newNode: MindMapNode = {
      id,
      label: 'New Idea Branch',
      notes: 'Tap Edit to write details or metrics.',
      x: Math.round((parent?.x || 400) + offsetSign * 260),
      y: Math.round((parent?.y || 220) + ((nodes.length % 3) - 1) * 120 + 70),
      color: colors[nodes.length % colors.length],
      shape: shapes[nodes.length % shapes.length],
      metricTag: 'Draft',
      parentId: parent?.id || null,
      author: collabName || 'Host',
    };
    const next = [...nodes, newNode];
    setNodes(next);
    setSelectedNodeId(id);
    setInlineEditingNodeId(id);
    broadcastNodes(next);
  };

  const updateNodeById = (nodeId: string, patch: Partial<MindMapNode>) => {
    const next = nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n));
    setNodes(next);
    broadcastNodes(next);
  };

  const deleteNodeById = (nodeId: string) => {
    if (nodeId === 'n-root' || nodes.length <= 1) return;
    const next = nodes.filter((n) => n.id !== nodeId && n.parentId !== nodeId);
    setNodes(next);
    if (selectedNodeId === nodeId) setSelectedNodeId(next[0]?.id || '');
    if (inlineEditingNodeId === nodeId) setInlineEditingNodeId(null);
    broadcastNodes(next);
  };

  // ================= SLIDE OPERATIONS =================
  const activeSlide = slides.find((s) => s.id === activeSlideId) || slides[0];
  const currentThemeSpec = SLIDE_THEMES[activeSlide?.theme || deckTheme] || SLIDE_THEMES.ivory;

  const updateActiveSlide = (patch: Partial<SlideItem>) => {
    if (!activeSlide) return;
    const next = slides.map((s) => (s.id === activeSlide.id ? { ...s, ...patch } : s));
    setSlides(next);
    broadcastSlides(next);
  };

  const applyThemeToDeck = (theme: SlideTheme) => {
    setDeckTheme(theme);
    const next = slides.map((s) => ({ ...s, theme }));
    setSlides(next);
    broadcastSlides(next);
  };

  const addNewSlide = () => {
    const id = `s-${Date.now().toString(36)}`;
    const nextSlide: SlideItem = {
      id,
      title: 'Key Priorities & Outcomes',
      subtitle: 'Structured talking points for your team or stakeholders',
      bullets: ['Core focus area', 'Measurable milestone', 'Owner & next review'],
      layout: 'two-col',
      theme: deckTheme,
      metricHighlight: 'Key Focus',
    };
    const next = [...slides, nextSlide];
    setSlides(next);
    setActiveSlideId(id);
    broadcastSlides(next);
  };

  const moveSlide = (id: string, direction: -1 | 1) => {
    const idx = slides.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= slides.length) return;
    const next = [...slides];
    const [removed] = next.splice(idx, 1);
    next.splice(targetIdx, 0, removed);
    setSlides(next);
    broadcastSlides(next);
  };

  const deleteSlide = (id: string) => {
    if (slides.length <= 1) return;
    const next = slides.filter((s) => s.id !== id);
    setSlides(next);
    if (activeSlideId === id) setActiveSlideId(next[0].id);
    broadcastSlides(next);
  };

  // ================= MEETING NOTES =================
  const handleAddMeetingNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim()) return;
    const note: CollabNote = {
      id: `note-${Date.now().toString(36)}`,
      author: collabName.trim() || 'Member',
      text: newNoteText.trim(),
      kind: newNoteKind,
      createdAt: new Date().toISOString(),
    };
    setMeetingNotes((prev) => [note, ...prev]);
    sendWs({ type: 'add_note', note });
    setNewNoteText('');
  };

  // ================= CONCEPT VISUALS =================
  const stopVisualPolling = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const handleEnhanceVisual = async () => {
    if (!visualPrompt.trim()) {
      setVisualError('Type a short visual idea first so Enhance Prompt can expand it.');
      visualInputRef.current?.focus();
      return;
    }
    setIsEnhancingVisual(true);
    setVisualError(null);
    try {
      const enhanced = await enhanceFinancialPrompt(visualPrompt, visualStyle);
      setVisualPrompt(enhanced);
    } finally {
      setIsEnhancingVisual(false);
    }
  };

  const applyCompletedJob = useCallback((job: ImageRenderJobState, ratioUsed: VisualAspectRatio) => {
    stopVisualPolling();
    activeJobIdRef.current = null;
    setActiveRenderJob(null);
    setVisualLoading(false);

    if (job.result?.imageUrl) {
      setResultRatio(ratioUsed);
      setCurrentVisualResult(job.result.imageUrl);
    } else {
      setVisualError(job.error || 'Could not generate an image for that description. Try adjusting your wording.');
    }
  }, [stopVisualPolling]);

  const handleGenerateVisual = async () => {
    if (!visualPrompt.trim()) {
      setVisualError('Describe what image you want to generate above or choose a sample below.');
      visualInputRef.current?.focus();
      return;
    }
    if (!trackEngagement('Concept Visual Render')) return;

    stopVisualPolling();
    if (activeJobIdRef.current) {
      void cancelImageRenderJob(activeJobIdRef.current);
      activeJobIdRef.current = null;
    }

    const ratioAtSubmit = visualRatio;
    setVisualLoading(true);
    setVisualError(null);
    setCurrentVisualResult(null);

    try {
      const initialJob = await startImageRenderJob(visualPrompt.trim(), visualStyle, ratioAtSubmit);
      if (initialJob.status === 'completed' && initialJob.result?.imageUrl) {
        applyCompletedJob(initialJob, ratioAtSubmit);
        return;
      }

      activeJobIdRef.current = initialJob.jobId;
      setActiveRenderJob(initialJob);

      pollTimerRef.current = window.setInterval(async () => {
        const currentId = activeJobIdRef.current;
        if (!currentId) {
          stopVisualPolling();
          return;
        }
        try {
          const latest = await pollImageRenderJob(currentId);
          setActiveRenderJob(latest);
          if (latest.status === 'completed') {
            applyCompletedJob(latest, ratioAtSubmit);
          } else if (latest.status === 'failed' || latest.status === 'cancelled') {
            stopVisualPolling();
            activeJobIdRef.current = null;
            setActiveRenderJob(null);
            setVisualLoading(false);
            if (latest.error) setVisualError(latest.error);
          }
        } catch (pollErr: any) {
          stopVisualPolling();
          activeJobIdRef.current = null;
          setActiveRenderJob(null);
          setVisualLoading(false);
          setVisualError(pollErr?.message || 'Unable to finish rendering. Please try again.');
        }
      }, 1800);
    } catch (err: any) {
      setVisualLoading(false);
      setActiveRenderJob(null);
      setVisualError(err?.message || 'Image creation encountered an issue. Please try again.');
    }
  };

  const handleCancelVisualRender = async () => {
    stopVisualPolling();
    const jobId = activeJobIdRef.current;
    activeJobIdRef.current = null;
    setActiveRenderJob(null);
    setVisualLoading(false);
    if (jobId) {
      await cancelImageRenderJob(jobId);
    }
  };

  const handleSaveVisual = async () => {
    if (!currentVisualResult || !visualPrompt.trim()) return;
    const safeUrl = await ensureFirestoreSafeDataUrl(currentVisualResult, 650000);
    addGoal({ title: visualPrompt.trim(), visualUrl: safeUrl, type: 'IMAGE' });
    setVisualPrompt('');
    setCurrentVisualResult(null);
    showToast('Saved visual concept to gallery.');
  };

  const remoteParticipants = participants.filter((p) => (p.peerId || p.clientId) !== myPeerIdRef.current);
  const localInitials =
    (collabName || 'H')
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || '')
      .join('') || 'H';

  const hoveredNode = hoveredNodeId ? nodes.find((n) => n.id === hoveredNodeId) : null;

  return (
    <div
      onTouchStart={handleVisionTouchStart}
      onTouchEnd={handleVisionTouchEnd}
      className="space-y-6 animate-enter"
    >
      {/* Minimalist Editorial Header — Times New Roman "Vision Studio" + Capability Subtitle + Mode Tabs */}
      <div className="rounded-3xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900/95 px-5 py-5 sm:px-7 sm:py-6 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1
              style={{ fontFamily: "'Times New Roman', Times, Georgia, serif" }}
              className="text-3xl sm:text-4xl font-bold tracking-tight text-neutral-900 dark:text-white"
            >
              Vision Studio
            </h1>
            <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 font-normal leading-relaxed max-w-xl">
              Map wealth roadmaps, build financial slide decks with exact card counts, host live team reviews and visualize financial goals.
            </p>
          </div>

          {/* Mode Navigation Tabs */}
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'mindmap' as const, label: 'Mind Map' },
              { id: 'slides' as const, label: 'Slide Deck Creator' },
              { id: 'room' as const, label: isRoomConnected ? `Live Video (${participants.length})` : 'Live Video Room' },
              { id: 'visuals' as const, label: 'Concept Visuals' },
            ].map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    active
                      ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 shadow-xs'
                      : 'bg-neutral-100 dark:bg-neutral-800/80 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {statusBanner && (
          <div className="px-4 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-200 text-xs font-semibold flex items-center justify-between gap-2">
            <span>{statusBanner}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-[11px] font-bold opacity-70 hover:opacity-100 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* ================= TAB 1: N8N-STYLE MIND MAP + NAPKIN HOVER DETAILS ================= */}
      {activeTab === 'mindmap' && (
        <div className="space-y-4">
          {/* Prompt Bar */}
          <div className="rounded-3xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900/90 p-5 space-y-3 shadow-xs">
            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
              <input
                type="text"
                value={mapPrompt}
                onChange={(e) => setMapPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGenerateMindMap()}
                placeholder="Describe a goal, project or topic to turn into a mind map..."
                className="flex-1 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200/90 dark:border-neutral-800 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleEnhanceMapPrompt}
                  disabled={enhancingMap || !mapPrompt.trim()}
                  className="px-4 py-3 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-xs font-bold cursor-pointer disabled:opacity-40"
                >
                  {enhancingMap ? 'Enhancing...' : 'Enhance Prompt'}
                </button>
                <button
                  type="button"
                  onClick={handleGenerateMindMap}
                  disabled={generatingMap || !mapPrompt.trim()}
                  className="px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {generatingMap ? 'Mapping Ideas...' : 'Create Mind Map'}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {MAP_PROMPT_IDEAS.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => setMapPrompt(idea)}
                    className="text-xs px-3 py-1 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 hover:border-indigo-400 cursor-pointer"
                  >
                    {idea}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                {savedBoards.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const match = savedBoards.find((b) => b.boardId === e.target.value);
                      if (match) handleLoadBoard(match, 'mindmap');
                    }}
                    aria-label="Open saved mind map"
                    className="px-3 py-1.5 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-xs font-semibold outline-none max-w-[190px]"
                  >
                    <option value="">Open Saved ({savedBoards.length})</option>
                    {savedBoards.map((b) => (
                      <option key={b.boardId} value={b.boardId}>
                        {b.title}
                      </option>
                    ))}
                  </select>
                )}
                {!hasMapOutput && (
                  <button
                    type="button"
                    onClick={() => setHasMapOutput(true)}
                    className="px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold cursor-pointer"
                  >
                    Blank Canvas
                  </button>
                )}
              </div>
            </div>

            {mapError && (
              <div className="px-3.5 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs font-semibold">
                {mapError}
              </div>
            )}
          </div>

          {/* Full-Size Auto-Expanding Mind Map Canvas + Zoom/Pan/Fullscreen */}
          {hasMapOutput && (
            <div
              className={
                isMapFullscreen
                  ? 'fixed inset-0 z-[75] w-screen h-[100dvh] bg-white dark:bg-[#0B0C10] p-3 sm:p-5 flex flex-col gap-3'
                  : 'rounded-3xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-4 sm:p-5 space-y-3 shadow-xs animate-enter'
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2.5 shrink-0">
                <input
                  type="text"
                  value={boardTitle}
                  onChange={(e) => setBoardTitle(e.target.value)}
                  aria-label="Mind map title"
                  className="bg-transparent text-base sm:text-lg font-extrabold tracking-tight text-neutral-900 dark:text-white border-b border-transparent focus:border-indigo-500 outline-none px-1 py-0.5 min-w-[170px] flex-1 max-w-md"
                />

                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  {/* Zoom & Fit Controls */}
                  <div className="inline-flex items-center rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 p-0.5">
                    <button
                      type="button"
                      onClick={() => setMapZoom((z) => Math.max(0.35, Number((z - 0.1).toFixed(2))))}
                      className="px-2.5 py-1 text-xs font-bold hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-lg cursor-pointer"
                      aria-label="Zoom out"
                    >
                      &minus;
                    </button>
                    <span className="px-2 text-[11px] font-mono font-bold tabular-nums min-w-[44px] text-center">
                      {Math.round(mapZoom * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setMapZoom((z) => Math.min(2.0, Number((z + 0.1).toFixed(2))))}
                      className="px-2.5 py-1 text-xs font-bold hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-lg cursor-pointer"
                      aria-label="Zoom in"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={handleFitMindMap}
                      className="px-2 py-1 text-[11px] font-mono hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-lg cursor-pointer"
                    >
                      Fit
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsMapFullscreen((f) => !f)}
                    className={`px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                      isMapFullscreen
                        ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 border-transparent'
                        : 'border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    {isMapFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  </button>

                  <button
                    type="button"
                    onClick={handleAutoArrangeNodes}
                    className="px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold cursor-pointer"
                  >
                    Auto Arrange
                  </button>
                  <button
                    type="button"
                    onClick={() => addChildNode()}
                    className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
                  >
                    + Branch
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveBoard}
                    disabled={savingBoard}
                    className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:border-indigo-500 text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    {savingBoard ? 'Saving...' : 'Save'}
                  </button>

                  {/* Isolated Mind Map Download Menu */}
                  <div className="relative" ref={mapExportMenuRef}>
                    <button
                      type="button"
                      onClick={() => setMapExportMenuOpen((p) => !p)}
                      className="px-3.5 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer flex items-center gap-1.5"
                    >
                      <span>Download</span>
                      <span className="text-[10px]">&#9662;</span>
                    </button>
                    {mapExportMenuOpen && (
                      <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white dark:bg-[#16171F] border border-neutral-200 dark:border-white/15 shadow-2xl p-1.5 z-50 space-y-1">
                        <button
                          type="button"
                          onClick={handleExportMindMapSvg}
                          className="w-full text-left px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <p className="text-xs font-bold text-neutral-900 dark:text-white">Vector Diagram (.svg)</p>
                          <p className="text-[10px] text-neutral-500">Scalable visual node graph</p>
                        </button>
                        <button
                          type="button"
                          onClick={handleExportMindMapMarkdown}
                          className="w-full text-left px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <p className="text-xs font-bold text-neutral-900 dark:text-white">Mind Map Outline (.md)</p>
                          <p className="text-[10px] text-neutral-500">Nodes &amp; hierarchy only</p>
                        </button>
                        <button
                          type="button"
                          onClick={handleExportMindMapJson}
                          className="w-full text-left px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <p className="text-xs font-bold text-neutral-900 dark:text-white">Mind Map Data (.json)</p>
                          <p className="text-[10px] text-neutral-500">Portable mind map JSON</p>
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleDeleteCurrentMindMap}
                    className="px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950 text-xs font-bold cursor-pointer"
                  >
                    Delete Map
                  </button>
                </div>
              </div>

              {/* Scrollable, Pannable, Auto-Expanding n8n Canvas Viewport */}
              <div className={`relative ${isMapFullscreen ? 'flex-1 min-h-0' : ''}`}>
                <div
                  ref={mapViewportRef}
                  data-no-swipe="true"
                  onWheel={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      e.preventDefault();
                      setMapZoom((z) => {
                        const delta = e.deltaY > 0 ? -0.08 : 0.08;
                        return Math.min(2.0, Math.max(0.35, Number((z + delta).toFixed(2))));
                      });
                    }
                  }}
                  className={`overflow-auto rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-[#F8FAFC] dark:bg-[#0B0C10] ${
                    isMapFullscreen ? 'w-full h-full' : 'w-full h-[66vh] min-h-[480px] sm:min-h-[600px]'
                  } ${isPanningMap ? 'cursor-grabbing' : 'cursor-grab'}`}
                >
                  <div
                    style={{
                      width: `${Math.round(mapBounds.width * mapZoom)}px`,
                      height: `${Math.round(mapBounds.height * mapZoom)}px`,
                    }}
                    className="relative"
                  >
                    <div
                      ref={canvasRef}
                      onPointerDown={handleCanvasPointerDown}
                      onPointerMove={handleCanvasPointerMove}
                      onPointerUp={handleCanvasPointerUp}
                      onPointerCancel={handleCanvasPointerUp}
                      onPointerLeave={() => {
                        handleCanvasPointerUp();
                      }}
                      onClick={(e) => {
                        if (e.target === e.currentTarget) {
                          setInlineEditingNodeId(null);
                          setHoveredNodeId(null);
                        }
                      }}
                      style={{
                        width: `${mapBounds.width}px`,
                        height: `${mapBounds.height}px`,
                        transform: `scale(${mapZoom})`,
                        transformOrigin: 'top left',
                      }}
                      className="relative bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] dark:bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:20px_20px] select-none"
                    >
                      <svg className="absolute inset-0 w-full h-full pointer-events-none">
                        <defs>
                          <marker
                            id="vision-arrow"
                            viewBox="0 0 10 10"
                            refX="8"
                            refY="5"
                            markerWidth="5"
                            markerHeight="5"
                            orient="auto-start-reverse"
                          >
                            <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#6366F1" fillOpacity="0.65" />
                          </marker>
                        </defs>
                        {nodes.map((node) => {
                          if (!node.parentId) return null;
                          const parent = nodes.find((p) => p.id === node.parentId);
                          if (!parent) return null;
                          const x1 = parent.x - mapBounds.minX + 224;
                          const y1 = parent.y - mapBounds.minY + 44;
                          const x2 = node.x - mapBounds.minX;
                          const y2 = node.y - mapBounds.minY + 44;
                          const cx = Math.abs(x2 - x1) * 0.45 + 40;
                          return (
                            <path
                              key={`edge-${node.id}`}
                              d={`M ${x1} ${y1} C ${x1 + cx} ${y1}, ${x2 - cx} ${y2}, ${x2} ${y2}`}
                              fill="none"
                              stroke={NODE_COLORS[node.color]?.accentHex || '#6366F1'}
                              strokeOpacity="0.55"
                              strokeWidth="2.2"
                              strokeDasharray={node.shape === 'insight' ? '5 4' : undefined}
                              markerEnd="url(#vision-arrow)"
                            />
                          );
                        })}
                      </svg>

                      {nodes.map((node) => {
                        const style = NODE_COLORS[node.color] || NODE_COLORS.indigo;
                        const shape: MindMapShape = node.shape || (node.parentId === null ? 'hub' : 'step');
                        const isSelected = node.id === selectedNodeId;
                        const isEditing = node.id === inlineEditingNodeId;
                        const hasChildren = nodes.some((c) => c.parentId === node.id);

                        return (
                          <div
                            key={node.id}
                            onPointerDown={(e) => handleNodePointerDown(e, node)}
                            onMouseEnter={() => {
                              if (hoverCloseTimerRef.current) {
                                window.clearTimeout(hoverCloseTimerRef.current);
                                hoverCloseTimerRef.current = null;
                              }
                              if (!draggingId && !isEditing) {
                                setHoveredNodeId(node.id);
                              }
                            }}
                            onMouseLeave={() => {
                              hoverCloseTimerRef.current = window.setTimeout(() => {
                                setHoveredNodeId((curr) => (curr === node.id ? null : curr));
                              }, 130);
                            }}
                            style={{ left: node.x - mapBounds.minX, top: node.y - mapBounds.minY }}
                            className={`absolute touch-none transition-shadow rounded-2xl bg-white dark:bg-[#14161D] text-neutral-900 dark:text-white border ${
                              isEditing
                                ? 'w-[300px] z-40 border-2 border-indigo-500 shadow-2xl p-4'
                                : `w-[224px] z-10 p-3.5 cursor-grab active:cursor-grabbing shadow-md hover:shadow-lg ${
                                    isSelected
                                      ? 'border-indigo-500 ring-2 ring-indigo-500/30 z-20'
                                      : 'border-neutral-200 dark:border-neutral-800'
                                  }`
                            }`}
                          >
                            {/* n8n Left Input Connector Port */}
                            {node.parentId && !isEditing && (
                              <span
                                className="absolute -left-1.5 top-[40px] w-3 h-3 rounded-full bg-white dark:bg-neutral-900 border-2 pointer-events-none"
                                style={{ borderColor: style.accentHex }}
                              />
                            )}
                            {/* n8n Right Output Connector Port */}
                            {!isEditing && (
                              <span
                                className="absolute -right-1.5 top-[40px] w-3 h-3 rounded-full border-2 pointer-events-none"
                                style={{
                                  borderColor: style.accentHex,
                                  backgroundColor: hasChildren ? style.accentHex : '#FFFFFF',
                                }}
                              />
                            )}

                            {!isEditing ? (
                              <div className="space-y-1.5">
                                <div
                                  className="h-1 -mx-3.5 -mt-3.5 mb-2 rounded-t-2xl"
                                  style={{ backgroundColor: style.accentHex }}
                                />
                                <div className="flex items-center justify-between gap-2">
                                  <span
                                    className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
                                    style={{
                                      backgroundColor: `${style.accentHex}18`,
                                      color: style.accentHex,
                                    }}
                                  >
                                    {node.metricTag || SHAPE_OPTIONS.find((s) => s.id === shape)?.label || 'Node'}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setHoveredNodeId(null);
                                        setSelectedNodeId(node.id);
                                        setInlineEditingNodeId(node.id);
                                      }}
                                      className="text-[10px] font-bold px-1.5 py-0.5 rounded text-indigo-600 dark:text-sky-400 hover:bg-indigo-50 dark:hover:bg-neutral-800 cursor-pointer"
                                    >
                                      Edit
                                    </button>
                                    {node.id !== 'n-root' && nodes.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          deleteNodeById(node.id);
                                        }}
                                        aria-label="Delete node"
                                        className="text-xs font-bold px-1 rounded text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/60 cursor-pointer"
                                      >
                                        &times;
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <p className="font-display text-sm font-extrabold leading-snug">{node.label}</p>
                                {node.notes && (
                                  <p className="text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-300 line-clamp-2">
                                    {node.notes}
                                  </p>
                                )}
                              </div>
                            ) : (
                              /* Inline Node Editor Directly Inside Canvas */
                              <div className="space-y-2.5" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-mono uppercase font-bold text-indigo-600 dark:text-sky-400">
                                    Editing Node
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setInlineEditingNodeId(null)}
                                    className="text-xs font-bold text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
                                  >
                                    Done &#10003;
                                  </button>
                                </div>

                                <input
                                  type="text"
                                  autoFocus
                                  value={node.label}
                                  onChange={(e) => updateNodeById(node.id, { label: e.target.value })}
                                  placeholder="Node title"
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 text-xs font-bold outline-none focus:border-indigo-500"
                                />

                                <textarea
                                  rows={3}
                                  value={node.notes}
                                  onChange={(e) => updateNodeById(node.id, { notes: e.target.value })}
                                  placeholder="Write details, milestones or ideas..."
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 text-xs outline-none focus:border-indigo-500 resize-none"
                                />

                                <div className="grid grid-cols-2 gap-2">
                                  <input
                                    type="text"
                                    value={node.metricTag || ''}
                                    onChange={(e) => updateNodeById(node.id, { metricTag: e.target.value })}
                                    placeholder="Badge (e.g. Phase 1)"
                                    className="px-2 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 text-[11px] font-mono outline-none"
                                  />
                                  <select
                                    value={shape}
                                    onChange={(e) => updateNodeById(node.id, { shape: e.target.value as MindMapShape })}
                                    className="px-2 py-1.5 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 text-[11px] font-semibold outline-none"
                                  >
                                    {SHAPE_OPTIONS.map((opt) => (
                                      <option key={opt.id} value={opt.id}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                <div className="flex items-center justify-between pt-1">
                                  <div className="flex gap-1.5">
                                    {(Object.keys(NODE_COLORS) as MindMapNode['color'][]).map((clr) => (
                                      <button
                                        key={clr}
                                        type="button"
                                        onClick={() => updateNodeById(node.id, { color: clr })}
                                        aria-label={`Color ${clr}`}
                                        className={`w-5 h-5 rounded-full cursor-pointer transition-transform ${
                                          node.color === clr
                                            ? 'scale-110 ring-2 ring-neutral-900 dark:ring-white'
                                            : 'opacity-70 hover:opacity-100'
                                        }`}
                                        style={{ backgroundColor: NODE_COLORS[clr].accentHex }}
                                      />
                                    ))}
                                  </div>

                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => addChildNode(node.id)}
                                      className="px-2 py-1 rounded-md bg-indigo-600 text-white text-[10px] font-bold cursor-pointer"
                                    >
                                      + Branch
                                    </button>
                                    {node.id !== 'n-root' && nodes.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => deleteNodeById(node.id)}
                                        className="px-2 py-1 rounded-md bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 text-[10px] font-bold cursor-pointer"
                                      >
                                        Delete
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Napkin-Style Floating Hover Detail Card */}
                      {hoveredNode && !draggingId && inlineEditingNodeId !== hoveredNode.id && (
                        <div
                          onMouseEnter={() => {
                            if (hoverCloseTimerRef.current) {
                              window.clearTimeout(hoverCloseTimerRef.current);
                              hoverCloseTimerRef.current = null;
                            }
                          }}
                          onMouseLeave={() => setHoveredNodeId(null)}
                          style={{
                            left: Math.max(
                              16,
                              hoveredNode.x - mapBounds.minX + (hoveredNode.x - mapBounds.minX > mapBounds.width * 0.65 ? -276 : 236)
                            ),
                            top: Math.max(16, hoveredNode.y - mapBounds.minY),
                          }}
                          className="hidden md:block absolute w-[264px] z-50 rounded-2xl bg-white dark:bg-[#171923] border border-neutral-200 dark:border-white/15 shadow-2xl p-4 space-y-2.5 animate-enter"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className="text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded-md"
                              style={{
                                backgroundColor: `${(NODE_COLORS[hoveredNode.color] || NODE_COLORS.indigo).accentHex}20`,
                                color: (NODE_COLORS[hoveredNode.color] || NODE_COLORS.indigo).accentHex,
                              }}
                            >
                              {hoveredNode.metricTag || hoveredNode.shape || 'Details'}
                            </span>
                            <span className="text-[10px] font-mono text-neutral-400">
                              {nodes.filter((c) => c.parentId === hoveredNode.id).length} branches
                            </span>
                          </div>
                          <p className="text-sm font-extrabold text-neutral-900 dark:text-white leading-snug">
                            {hoveredNode.label}
                          </p>
                          <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                            {hoveredNode.notes || 'No detailed notes added yet.'}
                          </p>
                          {hoveredNode.parentId && (
                            <p className="text-[10px] font-mono text-neutral-400 truncate">
                              Connected to: {nodes.find((p) => p.id === hoveredNode.parentId)?.label || 'Root'}
                            </p>
                          )}
                          <div className="flex items-center gap-1.5 pt-1 border-t border-neutral-100 dark:border-white/10">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedNodeId(hoveredNode.id);
                                setInlineEditingNodeId(hoveredNode.id);
                                setHoveredNodeId(null);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-[11px] font-bold cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                addChildNode(hoveredNode.id);
                                setHoveredNodeId(null);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-bold cursor-pointer"
                            >
                              + Branch
                            </button>
                            {hoveredNode.id !== 'n-root' && nodes.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  deleteNodeById(hoveredNode.id);
                                  setHoveredNodeId(null);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 text-[11px] font-bold cursor-pointer ml-auto"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Mobile/Tablet Selected Node Floating Quick Bar */}
                {(() => {
                  const sel = nodes.find((n) => n.id === selectedNodeId);
                  if (!sel || inlineEditingNodeId === sel.id) return null;
                  return (
                    <div className="lg:hidden mt-2.5 px-3.5 py-2.5 rounded-2xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-2 shrink-0">
                      <div className="min-w-0">
                        <p className="text-[10px] font-mono uppercase text-neutral-400">Selected Node</p>
                        <p className="text-xs font-bold text-neutral-900 dark:text-white truncate">{sel.label}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setInlineEditingNodeId(sel.id)}
                          className="px-2.5 py-1.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-[11px] font-bold cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => addChildNode(sel.id)}
                          className="px-2.5 py-1.5 rounded-xl bg-indigo-600 text-white text-[11px] font-bold cursor-pointer"
                        >
                          + Branch
                        </button>
                        {sel.id !== 'n-root' && nodes.length > 1 && (
                          <button
                            type="button"
                            onClick={() => deleteNodeById(sel.id)}
                            className="px-2.5 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-300 text-[11px] font-bold cursor-pointer"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 2: GAMMA-INSPIRED FINANCIAL PRESENTATION STUDIO (.HTML ONLY) ================= */}
      {activeTab === 'slides' && (
        <div className="space-y-5">
          {/* Prompt Bar & Configurator Trigger */}
          <div className="rounded-3xl border border-[#E5E5E5] dark:border-white/10 bg-white dark:bg-neutral-900/90 p-5 space-y-4 shadow-xs">
            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
              <input
                type="text"
                value={slidePrompt}
                onChange={(e) => {
                  setSlidePrompt(e.target.value);
                  if (slideError) setSlideError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleOpenSlideConfigurator()}
                placeholder="Describe your financial presentation (e.g. Q4 portfolio performance, savings plan, debt payoff)..."
                className="flex-1 bg-[#FAFAFA] dark:bg-neutral-950 border border-[#E5E5E5] dark:border-neutral-800 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-white"
              />
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleEnhanceSlidePrompt}
                  disabled={enhancingSlides || !slidePrompt.trim()}
                  className="px-4 py-3 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-xs font-semibold cursor-pointer disabled:opacity-40 whitespace-nowrap"
                >
                  {enhancingSlides ? 'Refining...' : 'Refine Topic'}
                </button>
                <button
                  type="button"
                  onClick={handleOpenSlideConfigurator}
                  disabled={generatingSlides || !slidePrompt.trim()}
                  className="px-5 py-3 rounded-2xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  Configure &amp; Build ({slideCount} Slides)
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {SLIDE_PROMPT_IDEAS.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => {
                      setSlidePrompt(idea);
                      setSlideError(null);
                    }}
                    className="text-xs px-3 py-1.5 rounded-xl bg-[#FAFAFA] dark:bg-neutral-950 border border-[#E5E5E5] dark:border-neutral-800 hover:border-neutral-900 dark:hover:border-white cursor-pointer text-left"
                  >
                    {idea}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsSlideConfigOpen((prev) => !prev)}
                  className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-bold cursor-pointer whitespace-nowrap"
                >
                  {isSlideConfigOpen ? 'Hide Deck Setup' : `Deck Options · ${slideCount} Slides · ${SLIDE_THEMES[deckTheme].label}`}
                </button>
                {savedBoards.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const match = savedBoards.find((b) => b.boardId === e.target.value);
                      if (match) handleLoadBoard(match, 'slides');
                    }}
                    aria-label="Open saved slide deck"
                    className="px-2.5 py-1.5 rounded-lg bg-[#FAFAFA] dark:bg-neutral-950 border border-[#E5E5E5] dark:border-neutral-800 text-[11px] font-semibold outline-none max-w-[160px]"
                  >
                    <option value="">Open Saved ({savedBoards.length})</option>
                    {savedBoards.map((b) => (
                      <option key={b.boardId} value={b.boardId}>
                        {b.title}
                      </option>
                    ))}
                  </select>
                )}
                {!hasSlidesOutput && (
                  <button
                    type="button"
                    onClick={() => setHasSlidesOutput(true)}
                    className="px-3 py-1.5 rounded-lg border border-[#E5E5E5] dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold cursor-pointer"
                  >
                    Starter Deck
                  </button>
                )}
              </div>
            </div>

            {/* Interactive Step-by-Step Financial Deck Configurator */}
            {isSlideConfigOpen && (
              <div className="mt-2 p-5 rounded-2xl bg-[#FAFAFA] dark:bg-neutral-950 border border-[#E5E5E5] dark:border-neutral-800 space-y-5 animate-enter">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#E5E5E5] dark:border-neutral-800">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[
                      { step: 1 as const, label: '1. Slides & Audience' },
                      { step: 2 as const, label: '2. Financial Theme & Font' },
                      { step: 3 as const, label: '3. Density & Visuals' },
                    ].map((st) => (
                      <button
                        key={st.step}
                        type="button"
                        onClick={() => setConfigStep(st.step)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                          configStep === st.step
                            ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950'
                            : 'bg-white dark:bg-neutral-900 border border-[#E5E5E5] dark:border-neutral-800 text-neutral-600 dark:text-neutral-300'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11px] font-mono text-neutral-500">
                    Exact count: <strong className="text-neutral-900 dark:text-white">{slideCount} slides</strong>
                  </span>
                </div>

                {configStep === 1 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-2.5">
                      <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 font-bold">
                        How Many Slides? (Exact Guarantee)
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {SLIDE_COUNT_PRESETS.map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setSlideCount(n)}
                            className={`px-3.5 py-2 rounded-xl text-xs font-mono font-bold cursor-pointer border transition-colors ${
                              slideCount === n
                                ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 border-neutral-900 dark:border-white'
                                : 'bg-white dark:bg-neutral-900 border-[#E5E5E5] dark:border-neutral-800 text-neutral-700 dark:text-neutral-300'
                            }`}
                          >
                            {n}
                          </button>
                        ))}
                        <div className="flex items-center gap-1.5 ml-1">
                          <input
                            type="number"
                            min={4}
                            max={15}
                            value={slideCount}
                            onChange={(e) =>
                              setSlideCount(Math.max(4, Math.min(15, Number(e.target.value) || 6)))
                            }
                            aria-label="Exact number of slides"
                            className="w-16 px-2.5 py-1.5 rounded-xl bg-white dark:bg-neutral-900 border border-[#E5E5E5] dark:border-neutral-800 text-xs font-mono font-bold text-center"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 font-bold">
                        Financial Audience
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {SLIDE_AUDIENCE_PRESETS.map((aud) => (
                          <button
                            key={aud}
                            type="button"
                            onClick={() => setDeckAudience(aud)}
                            className={`px-3 py-2 rounded-xl text-xs font-semibold text-left cursor-pointer border transition-colors ${
                              deckAudience === aud
                                ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 border-neutral-900 dark:border-white'
                                : 'bg-white dark:bg-neutral-900 border-[#E5E5E5] dark:border-neutral-800 text-neutral-700 dark:text-neutral-300'
                            }`}
                          >
                            {aud}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {configStep === 2 && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 font-bold mb-2">
                        Financial Design Theme Library (8 Palettes)
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        {(Object.keys(SLIDE_THEMES) as SlideTheme[]).map((themeKey) => {
                          const tSpec = SLIDE_THEMES[themeKey];
                          const active = deckTheme === themeKey;
                          return (
                            <button
                              key={themeKey}
                              type="button"
                              onClick={() => applyThemeToDeck(themeKey)}
                              className={`p-3 rounded-xl border text-left cursor-pointer transition-all space-y-2 ${
                                active
                                  ? 'border-neutral-900 dark:border-white ring-1 ring-neutral-900 dark:ring-white'
                                  : 'border-[#E5E5E5] dark:border-neutral-800'
                              }`}
                              style={{ backgroundColor: tSpec.bgHex, color: tSpec.textHex }}
                            >
                              <div className="flex items-center justify-between">
                                <span
                                  className="w-5 h-1.5 rounded-full"
                                  style={{ backgroundColor: tSpec.accentHex }}
                                />
                                {active && <span className="text-[10px] font-mono font-bold">Active</span>}
                              </div>
                              <div className="text-xs font-bold leading-tight">{tSpec.label}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 font-bold mb-2">
                        Typography Pairing
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        {(Object.keys(SLIDE_FONTS) as SlideFontStyle[]).map((fk) => {
                          const fs = SLIDE_FONTS[fk];
                          return (
                            <button
                              key={fk}
                              type="button"
                              onClick={() => setSlideFontStyle(fk)}
                              className={`p-3 rounded-xl border text-left cursor-pointer transition-colors ${
                                slideFontStyle === fk
                                  ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 border-neutral-900 dark:border-white'
                                  : 'bg-white dark:bg-neutral-900 border-[#E5E5E5] dark:border-neutral-800 text-neutral-800 dark:text-neutral-200'
                              }`}
                            >
                              <div className="text-xs font-bold" style={{ fontFamily: fs.cssFamily }}>
                                {fs.label}
                              </div>
                              <div className="text-[10px] opacity-70 mt-0.5">{fs.sample}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {configStep === 3 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 font-bold">
                        Slide Text Density
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {SLIDE_CONTENT_DENSITY.map((cd) => (
                          <button
                            key={cd.id}
                            type="button"
                            onClick={() => setSlideContentStyle(cd.id)}
                            className={`p-3 rounded-xl border text-left cursor-pointer transition-colors ${
                              slideContentStyle === cd.id
                                ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 border-neutral-900 dark:border-white'
                                : 'bg-white dark:bg-neutral-900 border-[#E5E5E5] dark:border-neutral-800 text-neutral-800 dark:text-neutral-200'
                            }`}
                          >
                            <div className="text-xs font-bold">{cd.label}</div>
                            <div className="text-[10px] opacity-75 mt-0.5 leading-snug">{cd.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 font-bold">
                        Financial Visuals Style
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {SLIDE_GRAPHICS_OPTIONS.map((gr) => (
                          <button
                            key={gr.id}
                            type="button"
                            onClick={() => setSlideGraphicsStyle(gr.id)}
                            className={`p-3 rounded-xl border text-left cursor-pointer transition-colors ${
                              slideGraphicsStyle === gr.id
                                ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 border-neutral-900 dark:border-white'
                                : 'bg-white dark:bg-neutral-900 border-[#E5E5E5] dark:border-neutral-800 text-neutral-800 dark:text-neutral-200'
                            }`}
                          >
                            <div className="text-xs font-bold">{gr.label}</div>
                            <div className="text-[10px] opacity-75 mt-0.5 leading-snug">{gr.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-[#E5E5E5] dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {configStep > 1 && (
                      <button
                        type="button"
                        onClick={() => setConfigStep((prev) => (prev === 3 ? 2 : 1))}
                        className="px-3.5 py-2 rounded-xl border border-[#E5E5E5] dark:border-neutral-700 text-xs font-semibold cursor-pointer"
                      >
                        &larr; Back
                      </button>
                    )}
                    {configStep < 3 && (
                      <button
                        type="button"
                        onClick={() => setConfigStep((prev) => (prev === 1 ? 2 : 3))}
                        className="px-4 py-2 rounded-xl bg-neutral-200 dark:bg-neutral-800 text-xs font-bold cursor-pointer"
                      >
                        Next Step &rarr;
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleGenerateSlides(slideCount)}
                    disabled={generatingSlides || !slidePrompt.trim()}
                    className="px-5 py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    {generatingSlides ? `Building ${slideCount} Slides...` : `Generate ${slideCount} Financial Slides`}
                  </button>
                </div>
              </div>
            )}

            {slideError && (
              <div className="px-3.5 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs font-semibold">
                {slideError}
              </div>
            )}
          </div>

          {hasSlidesOutput && (
            <div className="space-y-4 animate-enter">
              {/* Clean Swiss Deck Action Bar — Multi-Format Presentation Exports */}
              <div className="rounded-2xl border border-[#E5E5E5] dark:border-white/10 bg-white dark:bg-neutral-900 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <input
                  type="text"
                  value={boardTitle}
                  onChange={(e) => setBoardTitle(e.target.value)}
                  aria-label="Presentation title"
                  className="bg-transparent text-base font-bold tracking-tight text-neutral-900 dark:text-white border-b border-transparent focus:border-neutral-900 dark:focus:border-white outline-none px-1 py-0.5 flex-1 min-w-[180px] max-w-md"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveBoard}
                    disabled={savingBoard}
                    className="px-3.5 py-2 rounded-xl border border-[#E5E5E5] dark:border-neutral-700 hover:border-neutral-900 text-xs font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    {savingBoard ? 'Saving...' : 'Save Deck'}
                  </button>

                  <div className="relative" ref={slideExportMenuRef}>
                    <button
                      type="button"
                      onClick={() => setSlideExportMenuOpen((p) => !p)}
                      disabled={exportingPptx}
                      className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer hover:opacity-90 flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                    >
                      <span>{exportingPptx ? 'Exporting PPTX...' : 'Download Deck'}</span>
                      <span className="text-[10px]">&#9662;</span>
                    </button>

                    {slideExportMenuOpen && (
                      <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white dark:bg-[#16171F] border border-neutral-200 dark:border-white/15 shadow-2xl p-1.5 z-50 space-y-1">
                        <button
                          type="button"
                          onClick={handleDownloadSlidesPdf}
                          className="w-full text-left px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <p className="text-xs font-bold text-neutral-900 dark:text-white">PDF Presentation (.pdf)</p>
                          <p className="text-[10px] text-neutral-500">Widescreen 16:9 print-ready deck</p>
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadSlidesPptx}
                          className="w-full text-left px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <p className="text-xs font-bold text-neutral-900 dark:text-white">PowerPoint Deck (.pptx)</p>
                          <p className="text-[10px] text-neutral-500">Editable slides &amp; native charts</p>
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadSlidesHtml}
                          className="w-full text-left px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <p className="text-xs font-bold text-neutral-900 dark:text-white">Interactive HTML (.html)</p>
                          <p className="text-[10px] text-neutral-500">Standalone browser slideshow</p>
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadSlidesMarkdown}
                          className="w-full text-left px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <p className="text-xs font-bold text-neutral-900 dark:text-white">Markdown Outline (.md)</p>
                          <p className="text-[10px] text-neutral-500">Slides &amp; tables for docs</p>
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadSlidesJson}
                          className="w-full text-left px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <p className="text-xs font-bold text-neutral-900 dark:text-white">Structured JSON (.json)</p>
                          <p className="text-[10px] text-neutral-500">Portable open presentation data</p>
                        </button>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleDeleteCurrentDeck}
                    className="px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950 text-xs font-semibold cursor-pointer whitespace-nowrap"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Card Rail (Gamma-style compact outline) */}
                <div className="lg:col-span-3 rounded-3xl border border-[#E5E5E5] dark:border-white/10 bg-white dark:bg-neutral-900 p-4 space-y-3 h-fit">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-mono uppercase tracking-wider text-neutral-500 font-bold">
                      Cards ({slides.length})
                    </h2>
                    <button
                      type="button"
                      onClick={addNewSlide}
                      className="px-2.5 py-1 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer"
                    >
                      + Card
                    </button>
                  </div>

                  <div className="space-y-2 max-h-[520px] overflow-y-auto">
                    {slides.map((s, idx) => {
                      const active = s.id === activeSlide?.id;
                      return (
                        <div
                          key={s.id}
                          onClick={() => setActiveSlideId(s.id)}
                          className={`p-3 rounded-2xl border cursor-pointer transition-all space-y-1.5 ${
                            active
                              ? 'border-neutral-900 dark:border-white bg-[#FAFAFA] dark:bg-white/[0.06] shadow-xs'
                              : 'border-[#E5E5E5] dark:border-neutral-800 hover:border-neutral-400'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 text-[10px] font-mono text-neutral-500">
                            <span>
                              {String(idx + 1).padStart(2, '0')} · {s.layout}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveSlide(s.id, -1);
                                }}
                                className="px-1 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
                                title="Move up"
                              >
                                &uarr;
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveSlide(s.id, 1);
                                }}
                                className="px-1 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
                                title="Move down"
                              >
                                &darr;
                              </button>
                              {slides.length > 1 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    deleteSlide(s.id);
                                  }}
                                  className="px-1 text-rose-500 hover:text-rose-400 cursor-pointer"
                                  title="Remove slide"
                                >
                                  &times;
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="text-xs font-semibold line-clamp-2">{s.title || 'Untitled Slide'}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right: Gamma-Inspired Clean Swiss Paper 16:9 Slide Stage & Editor */}
                {activeSlide && (
                  <div className="lg:col-span-9 space-y-4">
                    <div
                      style={{
                        fontFamily: (SLIDE_FONTS[activeSlide.fontStyle || slideFontStyle] || SLIDE_FONTS.swiss_sans).cssFamily,
                      }}
                      className={`rounded-3xl p-7 sm:p-11 aspect-[16/9] flex flex-col justify-between shadow-sm relative overflow-hidden ${currentThemeSpec.bgClass} ${currentThemeSpec.textClass}`}
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-[0.16em] relative z-10">
                        <span className={`font-bold ${currentThemeSpec.accentText}`}>{boardTitle}</span>
                        <span className={currentThemeSpec.mutedClass}>
                          {String(slides.findIndex((s) => s.id === activeSlide.id) + 1).padStart(2, '0')} /{' '}
                          {String(slides.length).padStart(2, '0')}
                        </span>
                      </div>

                      {activeSlide.layout === 'cover' && (
                        <div className="my-auto grid grid-cols-1 md:grid-cols-12 gap-6 items-center relative z-10">
                          <div className="md:col-span-8 space-y-3">
                            <h3 className="text-2xl sm:text-4xl font-extrabold tracking-tight leading-[1.1]">
                              {activeSlide.title}
                            </h3>
                            {activeSlide.subtitle && (
                              <p className={`text-sm sm:text-base max-w-xl leading-relaxed ${currentThemeSpec.mutedClass}`}>
                                {activeSlide.subtitle}
                              </p>
                            )}
                          </div>
                          <div className={`md:col-span-4 rounded-2xl p-5 space-y-3 ${currentThemeSpec.cardClass}`}>
                            {activeSlide.metricHighlight && (
                              <div className="pb-3 border-b border-current/10">
                                <p className={`text-[10px] font-mono uppercase ${currentThemeSpec.mutedClass}`}>Highlight</p>
                                <p className={`text-2xl font-extrabold tracking-tight tabular-nums ${currentThemeSpec.accentText}`}>
                                  {activeSlide.metricHighlight}
                                </p>
                              </div>
                            )}
                            <ul className="space-y-2 text-xs">
                              {(activeSlide.bullets || []).filter(Boolean).slice(0, 3).map((b, i) => (
                                <li key={i} className="flex items-start gap-2 leading-snug">
                                  <span className={`font-mono font-bold ${currentThemeSpec.accentText}`}>0{i + 1}</span>
                                  <span>{b}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}

                      {activeSlide.layout === 'metrics' && (
                        <div className="my-auto space-y-5 relative z-10">
                          <div className="flex flex-wrap items-end justify-between gap-4">
                            <div>
                              <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{activeSlide.title}</h3>
                              {activeSlide.subtitle && (
                                <p className={`text-sm mt-1 ${currentThemeSpec.mutedClass}`}>{activeSlide.subtitle}</p>
                              )}
                            </div>
                            {activeSlide.metricHighlight && (
                              <div className={`px-4 py-2 rounded-xl ${currentThemeSpec.cardClass}`}>
                                <span className={`text-[10px] font-mono uppercase block ${currentThemeSpec.mutedClass}`}>Target</span>
                                <span className={`text-xl font-extrabold tabular-nums ${currentThemeSpec.accentText}`}>
                                  {activeSlide.metricHighlight}
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-stretch">
                            <div className={`${Array.isArray(activeSlide.chartBars) && activeSlide.chartBars.length > 0 ? 'md:col-span-7' : 'md:col-span-12'} grid grid-cols-1 sm:grid-cols-3 gap-3`}>
                              {(activeSlide.bullets || []).filter(Boolean).slice(0, 3).map((b, i) => (
                                <div key={i} className={`rounded-2xl p-4 flex flex-col justify-between ${currentThemeSpec.cardClass}`}>
                                  <span className={`text-[11px] font-mono font-bold ${currentThemeSpec.accentText}`}>
                                    0{i + 1}
                                  </span>
                                  <p className="text-xs sm:text-sm font-medium leading-snug mt-2">{b}</p>
                                </div>
                              ))}
                            </div>
                            {Array.isArray(activeSlide.chartBars) && activeSlide.chartBars.length > 0 && (
                              <div className={`md:col-span-5 rounded-2xl p-4 space-y-2.5 ${currentThemeSpec.cardClass}`}>
                                <p className={`text-[10px] font-mono uppercase tracking-wider font-bold ${currentThemeSpec.mutedClass}`}>
                                  Financial Mix
                                </p>
                                {(() => {
                                  const bars = activeSlide.chartBars!.slice(0, 4);
                                  const maxV = Math.max(1, ...bars.map((x) => Number(x.value) || 0));
                                  return bars.map((bar, bi) => {
                                    const pct = Math.max(10, Math.min(100, Math.round(((Number(bar.value) || 0) / maxV) * 100)));
                                    return (
                                      <div key={bi} className="space-y-1">
                                        <div className="flex justify-between text-[11px] font-mono">
                                          <span className="truncate">{bar.label}</span>
                                          <span className={`font-bold tabular-nums ${currentThemeSpec.accentText}`}>
                                            {bar.value}{bar.unit || ''}
                                          </span>
                                        </div>
                                        <div className="w-full h-1.5 rounded-full bg-current/10 overflow-hidden">
                                          <div
                                            className="h-full rounded-full"
                                            style={{ width: `${pct}%`, backgroundColor: currentThemeSpec.accentHex }}
                                          />
                                        </div>
                                      </div>
                                    );
                                  });
                                })()}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {activeSlide.layout === 'roadmap' && (
                        <div className="my-auto space-y-6 relative z-10">
                          <div>
                            <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{activeSlide.title}</h3>
                            {activeSlide.subtitle && (
                              <p className={`text-sm mt-1 ${currentThemeSpec.mutedClass}`}>{activeSlide.subtitle}</p>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {(activeSlide.bullets || []).filter(Boolean).slice(0, 3).map((b, i) => (
                              <div key={i} className={`rounded-2xl p-4 space-y-2.5 ${currentThemeSpec.cardClass}`}>
                                <div className="flex items-center justify-between">
                                  <span className={`text-xs font-mono font-bold ${currentThemeSpec.accentText}`}>
                                    Phase 0{i + 1}
                                  </span>
                                </div>
                                <p className="text-xs sm:text-sm font-medium leading-snug">{b}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {activeSlide.layout === 'two-col' && (
                        <div className="my-auto grid grid-cols-1 md:grid-cols-12 gap-6 items-center relative z-10">
                          <div className="md:col-span-5 space-y-2">
                            <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight">
                              {activeSlide.title}
                            </h3>
                            {activeSlide.subtitle && (
                              <p className={`text-sm leading-relaxed ${currentThemeSpec.mutedClass}`}>{activeSlide.subtitle}</p>
                            )}
                            {Array.isArray(activeSlide.chartBars) && activeSlide.chartBars.length > 0 && (
                              <div className={`mt-3 rounded-xl p-3 space-y-1.5 ${currentThemeSpec.cardClass}`}>
                                {(() => {
                                  const bars = activeSlide.chartBars!.slice(0, 3);
                                  const maxV = Math.max(1, ...bars.map((x) => Number(x.value) || 0));
                                  return bars.map((bar, bi) => {
                                    const pct = Math.max(10, Math.min(100, Math.round(((Number(bar.value) || 0) / maxV) * 100)));
                                    return (
                                      <div key={bi} className="space-y-0.5">
                                        <div className="flex justify-between text-[10px] font-mono">
                                          <span>{bar.label}</span>
                                          <span className="font-bold tabular-nums">{bar.value}{bar.unit || ''}</span>
                                        </div>
                                        <div className="w-full h-1 rounded-full bg-current/10 overflow-hidden">
                                          <div
                                            className="h-full rounded-full"
                                            style={{ width: `${pct}%`, backgroundColor: currentThemeSpec.accentHex }}
                                          />
                                        </div>
                                      </div>
                                    );
                                  });
                                })()}
                              </div>
                            )}
                          </div>
                          <div className="md:col-span-7 grid grid-cols-1 gap-2.5">
                            {(activeSlide.bullets || []).filter(Boolean).map((b, i) => (
                              <div key={i} className={`rounded-xl px-4 py-3 flex items-start gap-3 ${currentThemeSpec.cardClass}`}>
                                <span className={`text-xs font-mono font-bold mt-0.5 ${currentThemeSpec.accentText}`}>
                                  0{i + 1}
                                </span>
                                <span className="text-xs sm:text-sm leading-snug">{b}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className={`flex items-center justify-between text-[11px] font-mono pt-3 border-t border-current/10 relative z-10 ${currentThemeSpec.mutedClass}`}>
                        <span>{currentUser?.displayName || collabName || 'Workspace Member'}</span>
                        <span>{currentThemeSpec.label}</span>
                      </div>
                    </div>

                    {/* Quick Stage Stepper */}
                    <div className="flex items-center justify-between px-1">
                      <button
                        type="button"
                        onClick={() => {
                          const idx = slides.findIndex((s) => s.id === activeSlide.id);
                          if (idx > 0) setActiveSlideId(slides[idx - 1].id);
                        }}
                        disabled={slides.findIndex((s) => s.id === activeSlide.id) <= 0}
                        className="px-3.5 py-1.5 rounded-xl border border-[#E5E5E5] dark:border-neutral-800 text-xs font-semibold disabled:opacity-35 cursor-pointer"
                      >
                        &larr; Previous Card
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const idx = slides.findIndex((s) => s.id === activeSlide.id);
                          if (idx >= 0 && idx < slides.length - 1) setActiveSlideId(slides[idx + 1].id);
                        }}
                        disabled={slides.findIndex((s) => s.id === activeSlide.id) >= slides.length - 1}
                        className="px-3.5 py-1.5 rounded-xl border border-[#E5E5E5] dark:border-neutral-800 text-xs font-semibold disabled:opacity-35 cursor-pointer"
                      >
                        Next Card &rarr;
                      </button>
                    </div>

                {/* Slide Property Editor */}
                <div className="rounded-3xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-mono uppercase text-neutral-500 mb-1">
                        Slide Title
                      </label>
                      <input
                        type="text"
                        value={activeSlide.title}
                        onChange={(e) => updateActiveSlide({ title: e.target.value })}
                        className="w-full px-3.5 py-2 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-white/10 text-sm font-bold outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono uppercase text-neutral-500 mb-1">
                        Visual Layout
                      </label>
                      <select
                        value={activeSlide.layout}
                        onChange={(e) => updateActiveSlide({ layout: e.target.value as SlideItem['layout'] })}
                        className="w-full px-3 py-2 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-white/10 text-xs font-bold outline-none"
                      >
                        <option value="cover">Editorial Cover</option>
                        <option value="metrics">KPI Scorecard Grid</option>
                        <option value="roadmap">3-Phase Roadmap</option>
                        <option value="two-col">Split Columns</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-mono uppercase text-neutral-500 mb-1">
                        Highlight Badge
                      </label>
                      <input
                        type="text"
                        value={activeSlide.metricHighlight || ''}
                        onChange={(e) => updateActiveSlide({ metricHighlight: e.target.value })}
                        placeholder="e.g. Q1 Launch"
                        className="w-full px-3 py-2 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-white/10 text-xs font-mono outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-mono uppercase text-neutral-500 mb-1">
                        Subtitle / Context
                      </label>
                      <input
                        type="text"
                        value={activeSlide.subtitle || ''}
                        onChange={(e) => updateActiveSlide({ subtitle: e.target.value })}
                        placeholder="Short slide subtitle"
                        className="w-full px-3.5 py-2 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-white/10 text-xs sm:text-sm outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-mono uppercase text-neutral-500 mb-1">
                        Key Points / Milestones (one per line)
                      </label>
                      <textarea
                        rows={3}
                        value={(activeSlide.bullets || []).join('\n')}
                        onChange={(e) => updateActiveSlide({ bullets: e.target.value.split('\n') })}
                        className="w-full px-3.5 py-2 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-white/10 text-xs sm:text-sm outline-none focus:border-indigo-500 resize-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 3: GOOGLE MEET & ZOOM INSPIRED LIVE CONFERENCING ROOM ================= */}
      {activeTab === 'room' && (
        <div className="space-y-4">
          {!isRoomConnected ? (
            /* Idle Pre-Join Lobby (stays idle until user clicks Join Call) */
            <div className="rounded-3xl border border-neutral-200 dark:border-white/10 bg-[#111318] text-white p-5 sm:p-8 shadow-xl">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                {/* Left: Google Meet Style Self-View Camera & Device Check Stage */}
                <div className="lg:col-span-7 flex flex-col justify-between gap-4">
                  <div className="relative aspect-video rounded-2xl overflow-hidden bg-[#181A20] border border-white/10 flex items-center justify-center">
                    <video
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      style={videoBlurOn && !screenOn ? { filter: 'blur(0.4px) saturate(1.06)' } : undefined}
                      className={`w-full h-full object-cover ${camOn || screenOn ? 'block' : 'hidden'} ${
                        camOn && !screenOn && cameraFacingMode === 'user' ? '-scale-x-100' : ''
                      }`}
                    />
                    {!camOn && !screenOn && (
                      <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                        <div className="w-20 h-20 rounded-full bg-indigo-600 flex items-center justify-center text-white text-2xl font-extrabold shadow-lg">
                          {localInitials}
                        </div>
                        <p className="text-sm font-medium text-neutral-300">Camera is off</p>
                      </div>
                    )}

                    {/* Preview Controls Overlay */}
                    <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/85 via-black/40 to-transparent flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-neutral-200 truncate">
                        {collabName || 'You'}
                      </span>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleToggleMic}
                          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                            micOn
                              ? 'bg-white/15 hover:bg-white/25 text-white border border-white/20'
                              : 'bg-rose-600 hover:bg-rose-500 text-white'
                          }`}
                          title={micOn ? 'Mute microphone' : 'Unmute microphone'}
                          aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            {micOn ? (
                              <>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
                              </>
                            ) : (
                              <>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23M12 19v4M8 23h8M1 1l22 22" />
                              </>
                            )}
                          </svg>
                        </button>

                        <button
                          type="button"
                          onClick={handleToggleCamera}
                          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                            camOn
                              ? 'bg-white/15 hover:bg-white/25 text-white border border-white/20'
                              : 'bg-rose-600 hover:bg-rose-500 text-white'
                          }`}
                          title={camOn ? 'Turn off camera' : 'Turn on camera'}
                          aria-label={camOn ? 'Turn off camera' : 'Turn on camera'}
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            {camOn ? (
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v-4zM3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                            ) : (
                              <>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16 16v1a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34l1 .56L21 8.6v6.8l-3-1.5" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M1 1l22 22" />
                              </>
                            )}
                          </svg>
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleSwitchCameraFacing()}
                          className="px-3 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white border border-white/20 text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                          title="Switch between front and rear camera"
                        >
                          <span>{cameraFacingMode === 'user' ? 'Rear Cam' : 'Front Cam'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Quick Hardware Selector Row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <select
                      value={selectedAudioDeviceId}
                      onChange={(e) => void handleSelectAudioDevice(e.target.value)}
                      aria-label="Select microphone"
                      className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-neutral-200 outline-none focus:border-sky-400 truncate"
                    >
                      <option value="" className="bg-[#181A20]">
                        Default Microphone
                      </option>
                      {audioInputs.map((d, i) => (
                        <option key={d.deviceId || i} value={d.deviceId} className="bg-[#181A20]">
                          {d.label || `Microphone ${i + 1}`}
                        </option>
                      ))}
                    </select>

                    <select
                      value={selectedVideoDeviceId}
                      onChange={(e) => void handleSelectVideoDevice(e.target.value)}
                      aria-label="Select camera"
                      className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-neutral-200 outline-none focus:border-sky-400 truncate"
                    >
                      <option value="" className="bg-[#181A20]">
                        Default Camera
                      </option>
                      {videoInputs.map((d, i) => (
                        <option key={d.deviceId || i} value={d.deviceId} className="bg-[#181A20]">
                          {d.label || `Camera ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Right: Pre-Join Room Code Confirmation, Waiting Room & Host Permission Flow */}
                <div className="lg:col-span-5 flex flex-col justify-between gap-5 rounded-2xl bg-white/[0.04] border border-white/10 p-5 sm:p-6">
                  {roomJoinState === 'waiting' ? (
                    <div className="flex-1 flex flex-col justify-between gap-6 py-2">
                      <div className="space-y-4">
                        <div className="w-11 h-11 rounded-2xl border-2 border-sky-400/40 border-t-sky-400 animate-spin" />
                        <div>
                          <p className="text-xs font-mono uppercase tracking-wider text-sky-400 font-semibold">
                            Waiting Room &middot; {roomCode}
                          </p>
                          <h2 className="text-xl font-bold tracking-tight text-white mt-1">
                            Asking host for permission
                          </h2>
                          <p className="text-xs text-neutral-300 mt-1.5 leading-relaxed">
                            {waitingStatusMessage || 'Your request has been sent to the host. You will enter automatically as soon as they admit you.'}
                          </p>
                        </div>

                        <div className="p-3.5 rounded-xl bg-black/40 border border-white/10 space-y-1 text-xs">
                          <div className="flex justify-between">
                            <span className="text-neutral-400">Meeting Code</span>
                            <span className="font-mono font-bold text-white">{roomCode}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-neutral-400">Joining As</span>
                            <span className="font-semibold text-white">{collabName}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => disconnectRoom(false)}
                        className="w-full py-3 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 text-white text-xs font-bold cursor-pointer transition-colors"
                      >
                        Cancel Request
                      </button>
                    </div>
                  ) : roomJoinState === 'denied' ? (
                    <div className="flex-1 flex flex-col justify-between gap-6 py-2">
                      <div className="space-y-3">
                        <div className="w-11 h-11 rounded-2xl bg-rose-500/15 border border-rose-500/35 text-rose-400 flex items-center justify-center font-mono text-lg font-bold">
                          !
                        </div>
                        <div>
                          <p className="text-xs font-mono uppercase tracking-wider text-rose-400 font-semibold">
                            Room Access Declined &middot; {roomCode}
                          </p>
                          <h2 className="text-xl font-bold tracking-tight text-white mt-1">
                            You cannot join this meeting
                          </h2>
                          <p className="text-xs text-neutral-300 mt-1.5 leading-relaxed">
                            {mediaError || 'The host declined your join request or removed you from this room.'}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            setRoomJoinState('idle');
                            setMediaError(null);
                          }}
                          className="w-full py-3 rounded-2xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold cursor-pointer transition-colors"
                        >
                          Enter Another Room Code
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-4">
                        <div>
                          <h2 className="text-lg font-bold tracking-tight text-white">
                            {isInviteMode ? 'Confirm Room & Ask to Join' : 'Ready to join?'}
                          </h2>
                          <p className="text-xs text-neutral-400 mt-1">
                            {isInviteMode
                              ? 'Confirm your name and meeting code below, then ask the host for permission to join.'
                              : 'Preview audio and video before hosting or asking to join a meeting.'}
                          </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-mono text-neutral-400 mb-1">Your Name *</label>
                            <input
                              type="text"
                              value={collabName}
                              onChange={(e) => setCollabName(e.target.value)}
                              placeholder="Enter your name"
                              className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-white outline-none focus:border-sky-400"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-mono text-neutral-400 mb-1">Role</label>
                            <input
                              type="text"
                              value={collabRole}
                              onChange={(e) => setCollabRole(e.target.value)}
                              className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-white outline-none focus:border-sky-400"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[11px] font-mono text-neutral-400 mb-1">
                            Meeting Code *
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={roomCode}
                              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                              placeholder="MEET-XXXX-XX"
                              className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs font-mono uppercase text-white outline-none focus:border-sky-400"
                            />
                            <button
                              type="button"
                              onClick={handleNewSessionRoom}
                              className="px-3 py-2 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-xs font-semibold cursor-pointer shrink-0 whitespace-nowrap"
                            >
                              New Code
                            </button>
                          </div>
                        </div>

                        <div className="p-3 rounded-xl bg-black/35 border border-white/10 flex items-center justify-between gap-2">
                          <span className="text-[11px] font-mono text-sky-300 truncate">{meetingShareUrl}</span>
                          <button
                            type="button"
                            onClick={handleCopyMeetingLink}
                            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-semibold text-white shrink-0 cursor-pointer whitespace-nowrap"
                          >
                            Copy Link
                          </button>
                        </div>

                        {mediaError && (
                          <div className="px-3.5 py-2.5 rounded-xl bg-rose-950/70 border border-rose-500/40 text-rose-200 text-xs flex items-center justify-between gap-2">
                            <span>{mediaError}</span>
                            <button type="button" onClick={() => setMediaError(null)} className="font-bold cursor-pointer">
                              Dismiss
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-2.5 pt-2">
                        {isInviteMode ? (
                          <>
                            <button
                              type="button"
                              onClick={() => connectToRoom('knock')}
                              className="w-full py-3.5 rounded-2xl bg-sky-500 hover:bg-sky-400 text-neutral-950 text-sm font-bold cursor-pointer transition-colors"
                            >
                              Ask Host to Join
                            </button>
                            <button
                              type="button"
                              onClick={() => connectToRoom('host')}
                              className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer transition-colors"
                            >
                              Start Room as Host
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => connectToRoom('host')}
                              className="w-full py-3.5 rounded-2xl bg-sky-500 hover:bg-sky-400 text-neutral-950 text-sm font-bold cursor-pointer transition-colors"
                            >
                              Start Room as Host
                            </button>
                            <button
                              type="button"
                              onClick={() => connectToRoom('knock')}
                              className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer transition-colors"
                            >
                              Ask Host to Join Room
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={handleCopyRoomCode}
                          className="w-full py-2 rounded-xl border border-white/10 hover:bg-white/5 text-xs font-semibold text-neutral-300 cursor-pointer transition-colors"
                        >
                          Copy Code Only ({roomCode})
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Active Zoom & Google Meet Conferencing Stage */
            <div
              ref={stageContainerRef}
              className="rounded-3xl border border-neutral-800 bg-[#0E1015] text-white overflow-hidden shadow-2xl flex flex-col min-h-[600px]"
            >
              {/* Top Minimal Meeting Header Bar */}
              <div className="px-4 sm:px-6 py-3 border-b border-white/10 bg-[#14171F] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm font-bold text-white tracking-tight truncate">{roomCode}</span>
                  {isRoomHost && (
                    <span className="text-[11px] font-mono text-sky-400 font-semibold">Host</span>
                  )}
                  <span className="text-white/20" aria-hidden="true">|</span>
                  <span className="text-xs font-mono tabular-nums text-neutral-300">
                    {formatCallDuration(callElapsedSec)}
                  </span>
                  <span className="text-white/20 hidden sm:inline" aria-hidden="true">|</span>
                  <span className="text-xs text-neutral-400 hidden sm:inline">
                    {participants.length || 1} participant{(participants.length || 1) === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Gallery vs Spotlight Layout Switcher */}
                  <div className="inline-flex items-center p-0.5 rounded-xl bg-black/40 border border-white/10">
                    <button
                      type="button"
                      onClick={() => setLayoutMode('gallery')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                        layoutMode === 'gallery' ? 'bg-white text-neutral-950' : 'text-neutral-300 hover:text-white'
                      }`}
                    >
                      Gallery
                    </button>
                    <button
                      type="button"
                      onClick={() => setLayoutMode('spotlight')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                        layoutMode === 'spotlight' ? 'bg-white text-neutral-950' : 'text-neutral-300 hover:text-white'
                      }`}
                    >
                      Speaker
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyMeetingLink}
                    className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white cursor-pointer"
                  >
                    Invite Link
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleToggleStageFullscreen()}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 text-neutral-300 hover:text-white cursor-pointer"
                    title={isStageFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                    aria-label="Toggle stage fullscreen"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {isStageFullscreen ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              {mediaError && (
                <div className="mx-4 mt-3 px-4 py-2 rounded-xl bg-rose-950/80 border border-rose-500/40 text-rose-200 text-xs flex items-center justify-between gap-3">
                  <span>{mediaError}</span>
                  <button type="button" onClick={() => setMediaError(null)} className="font-bold cursor-pointer">
                    Dismiss
                  </button>
                </div>
              )}

              {isRoomHost && waitingRequests.length > 0 && (
                <div className="mx-4 mt-3 px-4 py-3 rounded-2xl bg-[#192030] border border-sky-400/35 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-white">
                      {waitingRequests.length === 1
                        ? `${waitingRequests[0].name} wants to join this room`
                        : `${waitingRequests.length} people waiting to join this room`}
                    </p>
                    <p className="text-[11px] text-neutral-300 truncate">
                      {waitingRequests.map((w) => w.name).join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleHostDenyPeer(waitingRequests[0].clientId)}
                      className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-rose-600/30 border border-white/15 text-xs font-semibold text-neutral-100 cursor-pointer whitespace-nowrap"
                    >
                      Deny
                    </button>
                    <button
                      type="button"
                      onClick={() => handleHostAdmitPeer(waitingRequests[0].clientId)}
                      className="px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-neutral-950 text-xs font-bold cursor-pointer whitespace-nowrap"
                    >
                      Admit
                    </button>
                    {waitingRequests.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setSidePanel('people')}
                        className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-sky-300 cursor-pointer whitespace-nowrap"
                      >
                        View All
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Center Stage + Optional Collapsible Side Drawer */}
              <div className="flex-1 flex flex-col lg:flex-row min-h-[440px] relative">
                {/* Floating Transient Emoji Reactions Layer */}
                {reactionsFeed.length > 0 && (
                  <div className="pointer-events-none absolute bottom-4 left-5 z-30 flex flex-col gap-1.5">
                    {reactionsFeed.map((r) => (
                      <div
                        key={r.id}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/75 border border-white/15 backdrop-blur-md text-xs text-white shadow-lg animate-enter"
                      >
                        <span className="text-base leading-none">{r.emoji}</span>
                        <span className="font-medium text-neutral-200">{r.senderName}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Video Stage Area */}
                <div className="flex-1 p-4 sm:p-5 flex flex-col justify-center">
                  {(() => {
                    const effectiveSpotlightPeer =
                      layoutMode === 'spotlight'
                        ? remoteParticipants.find((p) => (p.peerId || p.clientId) === pinnedPeerId) ||
                          remoteParticipants.find((p) => p.screenOn) ||
                          (pinnedPeerId !== 'local' ? remoteParticipants[0] : undefined)
                        : undefined;
                    const showLocalMainSpotlight =
                      layoutMode === 'spotlight' && (!effectiveSpotlightPeer || pinnedPeerId === 'local' || screenOn);

                    if (layoutMode === 'spotlight' && effectiveSpotlightPeer && !showLocalMainSpotlight) {
                      const mainPid = effectiveSpotlightPeer.peerId || effectiveSpotlightPeer.clientId;
                      const otherRemotes = remoteParticipants.filter((p) => (p.peerId || p.clientId) !== mainPid);
                      return (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 h-full">
                          <div className="lg:col-span-9">
                            <RemoteVideoTile
                              participant={effectiveSpotlightPeer}
                              stream={remoteStreams[mainPid]}
                              isPinned={true}
                              isLarge={true}
                              onTogglePin={() => {
                                setPinnedPeerId(null);
                                setLayoutMode('gallery');
                              }}
                            />
                          </div>
                          <div className="lg:col-span-3 flex lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto max-h-[460px]">
                            {/* Local Self Tile */}
                            <div
                              onClick={() => setPinnedPeerId('local')}
                              className="group relative aspect-video w-48 lg:w-full shrink-0 rounded-2xl overflow-hidden bg-[#181A20] border border-white/15 cursor-pointer flex items-center justify-center"
                            >
                              <video
                                ref={localVideoRef}
                                autoPlay
                                playsInline
                                muted
                                style={videoBlurOn && !screenOn ? { filter: 'blur(0.4px) saturate(1.06)' } : undefined}
                                className={`w-full h-full object-cover ${camOn || screenOn ? 'block' : 'hidden'} ${
                                  camOn && !screenOn && cameraFacingMode === 'user' ? '-scale-x-100' : ''
                                }`}
                              />
                              {!camOn && !screenOn && (
                                <div className="w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-extrabold">
                                  {localInitials}
                                </div>
                              )}
                              {handRaised && (
                                <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-amber-400 text-neutral-950 text-[10px] font-bold">
                                  &#9995;
                                </span>
                              )}
                              <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/85 to-transparent flex items-center justify-between text-[11px]">
                                <span className="font-bold truncate">{collabName || 'You'} (You)</span>
                                <span className="font-mono text-[10px] text-neutral-300">{micOn ? 'Mic' : 'Muted'}</span>
                              </div>
                            </div>

                            {otherRemotes.map((p) => {
                              const pid = p.peerId || p.clientId;
                              return (
                                <div key={pid} className="w-48 lg:w-full shrink-0">
                                  <RemoteVideoTile
                                    participant={p}
                                    stream={remoteStreams[pid]}
                                    onTogglePin={() => setPinnedPeerId(pid)}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }

                    if (layoutMode === 'spotlight' && showLocalMainSpotlight) {
                      return (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 h-full">
                          <div className="lg:col-span-9 relative rounded-2xl overflow-hidden bg-[#181A20] border border-sky-400/70 min-h-[260px] sm:min-h-[400px] flex items-center justify-center">
                            <video
                              ref={localVideoRef}
                              autoPlay
                              playsInline
                              muted
                              style={videoBlurOn && !screenOn ? { filter: 'blur(0.4px) saturate(1.06)' } : undefined}
                              className={`w-full h-full object-cover ${camOn || screenOn ? 'block' : 'hidden'} ${
                                camOn && !screenOn && cameraFacingMode === 'user' ? '-scale-x-100' : ''
                              }`}
                            />
                            {!camOn && !screenOn && (
                              <div className="flex flex-col items-center gap-2.5 text-center p-6">
                                <div className="w-20 h-20 rounded-full bg-indigo-600 flex items-center justify-center text-white text-2xl font-extrabold shadow-lg">
                                  {localInitials}
                                </div>
                                <p className="text-xs text-neutral-400">Turn on camera or share screen below</p>
                              </div>
                            )}
                            {handRaised && (
                              <span className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-amber-400 text-neutral-950 text-[11px] font-bold">
                                &#9995; Hand raised
                              </span>
                            )}
                            <div className="absolute inset-x-0 bottom-0 p-3.5 bg-gradient-to-t from-black/85 via-black/40 to-transparent flex items-center justify-between">
                              <div>
                                <p className="text-xs font-bold text-white">{collabName || 'You'} (You)</p>
                                <p className="text-[10px] font-mono text-neutral-300">{collabRole}</p>
                              </div>
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold ${
                                  micOn ? 'bg-emerald-600 text-white' : 'bg-black/70 text-neutral-300'
                                }`}
                              >
                                {micOn ? 'Mic on' : 'Muted'}
                              </span>
                            </div>
                          </div>

                          <div className="lg:col-span-3 flex lg:flex-col gap-3 overflow-x-auto lg:overflow-y-auto max-h-[460px]">
                            {remoteParticipants.length === 0 ? (
                              <div className="rounded-2xl border border-dashed border-white/10 p-4 text-center text-xs text-neutral-400 my-auto">
                                Share the invite link to bring teammates onto the call.
                              </div>
                            ) : (
                              remoteParticipants.map((p) => {
                                const pid = p.peerId || p.clientId;
                                return (
                                  <div key={pid} className="w-48 lg:w-full shrink-0">
                                    <RemoteVideoTile
                                      participant={p}
                                      stream={remoteStreams[pid]}
                                      onTogglePin={() => setPinnedPeerId(pid)}
                                    />
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    }

                    /* Gallery Grid Mode */
                    const totalTiles = 1 + remoteParticipants.length;
                    const gridColsClass =
                      totalTiles === 1
                        ? 'grid-cols-1 max-w-4xl mx-auto w-full'
                        : totalTiles === 2
                        ? 'grid-cols-1 sm:grid-cols-2'
                        : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3';

                    return (
                      <div className={`grid gap-3.5 ${gridColsClass}`}>
                        <div
                          className={`group relative aspect-video rounded-2xl overflow-hidden bg-[#181A20] border flex items-center justify-center ${
                            micOn ? 'border-emerald-500/45' : 'border-white/10'
                          }`}
                        >
                          <video
                            ref={localVideoRef}
                            autoPlay
                            playsInline
                            muted
                            style={videoBlurOn && !screenOn ? { filter: 'blur(0.4px) saturate(1.06)' } : undefined}
                            className={`w-full h-full object-cover ${camOn || screenOn ? 'block' : 'hidden'} ${
                              camOn && !screenOn && cameraFacingMode === 'user' ? '-scale-x-100' : ''
                            }`}
                          />
                          {!camOn && !screenOn && (
                            <div className="flex flex-col items-center justify-center gap-2.5 p-4 text-center">
                              <div className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xl font-extrabold shadow-lg">
                                {localInitials}
                              </div>
                              <p className="text-xs text-neutral-400">Camera off</p>
                            </div>
                          )}

                          <div className="absolute top-3 inset-x-3 flex items-center justify-between gap-2">
                            {handRaised ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-400 text-neutral-950 text-[11px] font-bold shadow-md">
                                <span aria-hidden="true">&#9995;</span>
                                <span>Hand raised</span>
                              </span>
                            ) : (
                              <span />
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setPinnedPeerId('local');
                                setLayoutMode('spotlight');
                              }}
                              className="px-2.5 py-1 rounded-lg bg-black/60 border border-white/15 text-[11px] font-semibold text-neutral-200 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            >
                              Spotlight
                            </button>
                          </div>

                          <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/85 via-black/45 to-transparent flex items-end justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-white truncate">{collabName || 'You'} (You)</p>
                              <p className="text-[10px] font-mono text-neutral-300 truncate">{collabRole}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {screenOn && (
                                <span className="px-2 py-0.5 rounded-md bg-sky-600 text-[10px] font-mono font-bold">
                                  Screen
                                </span>
                              )}
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold ${
                                  micOn ? 'bg-emerald-600 text-white' : 'bg-black/70 text-neutral-300 border border-white/10'
                                }`}
                              >
                                {micOn ? 'Mic on' : 'Muted'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {remoteParticipants.map((p) => {
                          const pid = p.peerId || p.clientId;
                          return (
                            <RemoteVideoTile
                              key={pid}
                              participant={p}
                              stream={remoteStreams[pid]}
                              onTogglePin={() => {
                                setPinnedPeerId(pid);
                                setLayoutMode('spotlight');
                              }}
                            />
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                {/* Collapsible Meet & Zoom Style Right Drawer (Chat / People / Notes) */}
                {sidePanel !== 'none' && (
                  <aside className="w-full lg:w-[340px] border-t lg:border-t-0 lg:border-l border-white/10 bg-[#14171F] flex flex-col max-h-[520px] lg:max-h-none">
                    <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        {[
                          { id: 'chat' as const, label: 'Chat' },
                          { id: 'people' as const, label: `People (${participants.length || 1})` },
                          { id: 'notes' as const, label: 'Notes' },
                        ].map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleToggleSidePanel(item.id)}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                              sidePanel === item.id
                                ? 'bg-white text-neutral-950'
                                : 'text-neutral-300 hover:bg-white/10'
                            }`}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setSidePanel('none')}
                        className="w-7 h-7 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white text-xs font-bold cursor-pointer"
                        aria-label="Close drawer"
                      >
                        &times;
                      </button>
                    </div>

                    {sidePanel === 'chat' && (
                      <div className="flex-1 flex flex-col p-4 gap-3 min-h-[300px]">
                        <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[360px] pr-1">
                          {chatMessages.length === 0 ? (
                            <p className="text-xs text-neutral-400 text-center py-8">
                              In-call messages appear here for everyone in {roomCode}.
                            </p>
                          ) : (
                            chatMessages.map((m) => (
                              <div key={m.id} className="rounded-xl bg-white/[0.05] border border-white/10 px-3 py-2 space-y-0.5">
                                <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400">
                                  <span className="font-bold text-sky-300">{m.senderName}</span>
                                  <span>
                                    {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                <p className="text-xs text-neutral-100 leading-snug break-words">{m.text}</p>
                              </div>
                            ))
                          )}
                        </div>
                        <form onSubmit={handleSendChatMessage} className="flex gap-2">
                          <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            placeholder="Send a message to everyone..."
                            className="flex-1 px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white outline-none focus:border-sky-400"
                          />
                          <button
                            type="submit"
                            className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-neutral-950 text-xs font-bold cursor-pointer"
                          >
                            Send
                          </button>
                        </form>
                      </div>
                    )}

                    {sidePanel === 'people' && (
                      <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[420px]">
                        {isRoomHost && waitingRequests.length > 0 && (
                          <div className="space-y-2 pb-3 border-b border-white/10">
                            <p className="text-[11px] font-mono uppercase tracking-wider text-sky-400 font-bold">
                              Waiting for Approval ({waitingRequests.length})
                            </p>
                            {waitingRequests.map((w) => (
                              <div
                                key={w.clientId}
                                className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-sky-500/10 border border-sky-400/25"
                              >
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-white truncate">{w.name}</p>
                                  <p className="text-[10px] font-mono text-neutral-300 truncate">{w.role}</p>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleHostDenyPeer(w.clientId)}
                                    className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-rose-600/35 text-[11px] font-semibold text-neutral-200 cursor-pointer whitespace-nowrap"
                                  >
                                    Deny
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleHostAdmitPeer(w.clientId)}
                                    className="px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-neutral-950 text-[11px] font-bold cursor-pointer whitespace-nowrap"
                                  >
                                    Admit
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="space-y-2">
                          <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-400 font-bold">
                            In Call ({participants.length || 1})
                          </p>
                          {(participants.length > 0
                            ? participants
                            : [
                                {
                                  clientId: 'local',
                                  name: collabName || 'You',
                                  role: collabRole || 'Host',
                                  color: '#4F46E5',
                                  joinedAt: '',
                                  isHost: isRoomHost,
                                  micOn,
                                  camOn,
                                  screenOn,
                                  handRaised,
                                },
                              ]
                          ).map((p) => {
                            const pid = p.peerId || p.clientId;
                            const isSelf = pid === myPeerIdRef.current || pid === 'local';
                            return (
                              <div
                                key={p.clientId}
                                className="flex items-center justify-between gap-2.5 p-2.5 rounded-xl bg-white/[0.04] border border-white/10"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                                    style={{ backgroundColor: p.color || '#4F46E5' }}
                                  >
                                    {(p.name || 'M').charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold text-white truncate">
                                      {p.name} {isSelf ? '(You)' : ''} {p.isHost ? '· Host' : ''}
                                    </p>
                                    <p className="text-[10px] font-mono text-neutral-400 truncate">{p.role}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 text-[10px] font-mono shrink-0">
                                  {p.handRaised && <span title="Hand raised">&#9995;</span>}
                                  <span className={p.micOn ? 'text-emerald-400' : 'text-neutral-500'}>
                                    {p.micOn ? 'Mic' : 'Muted'}
                                  </span>
                                  {isRoomHost && !isSelf && (
                                    <button
                                      type="button"
                                      onClick={() => handleHostRemovePeer(p.clientId)}
                                      className="px-2 py-0.5 rounded-md bg-rose-600/20 hover:bg-rose-600/35 text-rose-300 font-sans text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                                    >
                                      Remove
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {isRoomHost && deniedEntries.length > 0 && (
                          <div className="space-y-2 pt-3 border-t border-white/10">
                            <p className="text-[11px] font-mono uppercase tracking-wider text-rose-400 font-bold">
                              Blocked from Room ({deniedEntries.length})
                            </p>
                            {deniedEntries.map((entry) => (
                              <div
                                key={entry.guestKey}
                                className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-rose-950/30 border border-rose-500/20"
                              >
                                <span className="text-xs text-neutral-200 truncate">{entry.name}</span>
                                <button
                                  type="button"
                                  onClick={() => handleHostUnblockDenied(entry.guestKey)}
                                  className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-semibold text-white cursor-pointer whitespace-nowrap shrink-0"
                                >
                                  Allow Again
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {sidePanel === 'notes' && (
                      <div className="flex-1 flex flex-col p-4 gap-3 min-h-[300px]">
                        <form onSubmit={handleAddMeetingNote} className="space-y-2">
                          <div className="flex gap-1.5">
                            <select
                              value={newNoteKind}
                              onChange={(e) => setNewNoteKind(e.target.value as CollabNote['kind'])}
                              className="px-2.5 py-2 rounded-xl bg-black/40 border border-white/10 text-[11px] font-bold text-white outline-none"
                            >
                              <option value="note">Note</option>
                              <option value="decision">Decision</option>
                              <option value="action">Action</option>
                            </select>
                            <input
                              type="text"
                              value={newNoteText}
                              onChange={(e) => setNewNoteText(e.target.value)}
                              placeholder="Log note or action item..."
                              className="flex-1 px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white outline-none focus:border-sky-400"
                            />
                            <button
                              type="submit"
                              className="px-3 py-2 rounded-xl bg-white text-neutral-950 text-xs font-bold cursor-pointer"
                            >
                              Post
                            </button>
                          </div>
                        </form>
                        <div className="flex-1 space-y-2 overflow-y-auto max-h-[340px]">
                          {meetingNotes.length === 0 ? (
                            <p className="text-xs text-neutral-400 text-center py-8">
                              No meeting notes yet.
                            </p>
                          ) : (
                            meetingNotes.map((n) => (
                              <div key={n.id} className="p-3 rounded-xl bg-white/[0.04] border border-white/10 space-y-1">
                                <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400">
                                  <span className="text-sky-300 font-bold uppercase">
                                    {n.kind} &bull; {n.author}
                                  </span>
                                  <span>
                                    {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                <p className="text-xs text-neutral-200">{n.text}</p>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </aside>
                )}
              </div>

              {/* Bottom Floating Google Meet & Zoom Glass Control Dock */}
              <div className="px-4 py-3.5 border-t border-white/10 bg-[#14171F]/95 backdrop-blur-xl flex flex-wrap items-center justify-between gap-3">
                {/* Left: Audio & Video Toggles + Hardware Picker Popovers */}
                <div className="flex items-center gap-2 relative">
                  {/* Mic + Device Chevron */}
                  <div className="inline-flex items-center rounded-2xl bg-white/10 border border-white/10 relative">
                    <button
                      type="button"
                      onClick={handleToggleMic}
                      className={`px-3.5 py-2.5 rounded-l-2xl flex items-center gap-2 text-xs font-semibold cursor-pointer transition-colors ${
                        micOn ? 'text-white hover:bg-white/10' : 'bg-rose-600 hover:bg-rose-500 text-white'
                      }`}
                    >
                      <span>{micOn ? 'Mute' : 'Unmute'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeviceMenuOpen((curr) => (curr === 'mic' ? null : 'mic'))}
                      className="px-2 py-2.5 border-l border-white/10 hover:bg-white/10 rounded-r-2xl text-[10px] cursor-pointer"
                      aria-label="Audio input options"
                    >
                      &#9652;
                    </button>
                    {deviceMenuOpen === 'mic' && (
                      <div className="absolute bottom-full left-0 mb-2 w-60 rounded-2xl bg-[#1A1D26] border border-white/15 shadow-2xl p-2 z-50 space-y-1">
                        <p className="text-[10px] font-mono uppercase text-neutral-400 px-2 py-1">Microphone</p>
                        {audioInputs.length === 0 ? (
                          <p className="text-xs text-neutral-400 px-2 py-1">Default microphone active</p>
                        ) : (
                          audioInputs.map((d, i) => (
                            <button
                              key={d.deviceId || i}
                              type="button"
                              onClick={() => void handleSelectAudioDevice(d.deviceId)}
                              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs truncate cursor-pointer ${
                                selectedAudioDeviceId === d.deviceId
                                  ? 'bg-sky-500/20 text-sky-300 font-semibold'
                                  : 'text-neutral-200 hover:bg-white/10'
                              }`}
                            >
                              {d.label || `Microphone ${i + 1}`}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* Camera + Device & Soft Studio Blur Popover */}
                  <div className="inline-flex items-center rounded-2xl bg-white/10 border border-white/10 relative">
                    <button
                      type="button"
                      onClick={handleToggleCamera}
                      className={`px-3.5 py-2.5 rounded-l-2xl flex items-center gap-2 text-xs font-semibold cursor-pointer transition-colors ${
                        camOn ? 'text-white hover:bg-white/10' : 'bg-rose-600 hover:bg-rose-500 text-white'
                      }`}
                    >
                      <span>{camOn ? 'Stop Video' : 'Start Video'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeviceMenuOpen((curr) => (curr === 'cam' ? null : 'cam'))}
                      className="px-2 py-2.5 border-l border-white/10 hover:bg-white/10 rounded-r-2xl text-[10px] cursor-pointer"
                      aria-label="Camera options"
                    >
                      &#9652;
                    </button>
                    {deviceMenuOpen === 'cam' && (
                      <div className="absolute bottom-full left-0 mb-2 w-60 rounded-2xl bg-[#1A1D26] border border-white/15 shadow-2xl p-2 z-50 space-y-1">
                        <p className="text-[10px] font-mono uppercase text-neutral-400 px-2 py-1">Camera</p>
                        <button
                          type="button"
                          onClick={() => void handleSwitchCameraFacing()}
                          className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-sky-300 font-semibold hover:bg-white/10 flex items-center justify-between cursor-pointer"
                        >
                          <span>Flip Camera ({cameraFacingMode === 'user' ? 'Front -> Rear' : 'Rear -> Front'})</span>
                        </button>
                        {videoInputs.map((d, i) => (
                          <button
                            key={d.deviceId || i}
                            type="button"
                            onClick={() => void handleSelectVideoDevice(d.deviceId)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs truncate cursor-pointer ${
                              selectedVideoDeviceId === d.deviceId
                                ? 'bg-sky-500/20 text-sky-300 font-semibold'
                                : 'text-neutral-200 hover:bg-white/10'
                            }`}
                          >
                            {d.label || `Camera ${i + 1}`}
                          </button>
                        ))}
                        <div className="border-t border-white/10 pt-1 mt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setVideoBlurOn((v) => !v);
                              setDeviceMenuOpen(null);
                            }}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-neutral-200 hover:bg-white/10 flex items-center justify-between cursor-pointer"
                          >
                            <span>Soft focus filter</span>
                            <span className="font-mono text-[10px] text-sky-300">{videoBlurOn ? 'On' : 'Off'}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Quick Flip Camera Button for Mobile & Tablet */}
                  <button
                    type="button"
                    onClick={() => void handleSwitchCameraFacing()}
                    className="px-3 py-2.5 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 text-xs font-semibold text-neutral-100 cursor-pointer transition-colors"
                    title="Switch between front and rear camera"
                  >
                    {cameraFacingMode === 'user' ? 'Rear Cam' : 'Front Cam'}
                  </button>
                </div>

                {/* Center: Screen Share, Hand Raise, Reactions, Chat, People, Notes */}
                <div className="flex flex-wrap items-center gap-2 relative">
                  <button
                    type="button"
                    onClick={handleToggleScreenShare}
                    className={`px-3.5 py-2.5 rounded-2xl text-xs font-semibold cursor-pointer transition-colors border ${
                      screenOn
                        ? 'bg-emerald-600 border-emerald-500 text-white'
                        : 'bg-white/10 hover:bg-white/15 border-white/10 text-neutral-100'
                    }`}
                  >
                    {screenOn ? 'Stop Share' : 'Share Screen'}
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleHand}
                    className={`px-3.5 py-2.5 rounded-2xl text-xs font-semibold cursor-pointer transition-colors border ${
                      handRaised
                        ? 'bg-amber-400 border-amber-300 text-neutral-950'
                        : 'bg-white/10 hover:bg-white/15 border-white/10 text-neutral-100'
                    }`}
                  >
                    {handRaised ? 'Lower Hand' : 'Raise Hand'}
                  </button>

                  {/* Reactions Popover */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setReactionMenuOpen((p) => !p)}
                      className="px-3.5 py-2.5 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 text-xs font-semibold text-neutral-100 cursor-pointer"
                    >
                      React
                    </button>
                    {reactionMenuOpen && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1.5 rounded-2xl bg-[#1A1D26] border border-white/15 shadow-2xl flex items-center gap-1 z-50">
                        {['👍', '👏', '❤️', '🎉', '🚀'].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => handleSendReaction(emoji)}
                            className="w-9 h-9 rounded-xl hover:bg-white/10 text-lg flex items-center justify-center cursor-pointer transition-transform hover:scale-110"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleSidePanel('chat')}
                    className={`px-3.5 py-2.5 rounded-2xl text-xs font-semibold cursor-pointer transition-colors border ${
                      sidePanel === 'chat'
                        ? 'bg-sky-500 border-sky-400 text-neutral-950'
                        : 'bg-white/10 hover:bg-white/15 border-white/10 text-neutral-100'
                    }`}
                  >
                    Chat{unreadChatCount > 0 ? ` (${unreadChatCount})` : ''}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleToggleSidePanel('people')}
                    className={`px-3.5 py-2.5 rounded-2xl text-xs font-semibold cursor-pointer transition-colors border whitespace-nowrap ${
                      sidePanel === 'people'
                        ? 'bg-sky-500 border-sky-400 text-neutral-950'
                        : 'bg-white/10 hover:bg-white/15 border-white/10 text-neutral-100'
                    }`}
                  >
                    Participants{isRoomHost && waitingRequests.length > 0 ? ` (${waitingRequests.length} waiting)` : ''}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleToggleSidePanel('notes')}
                    className={`px-3.5 py-2.5 rounded-2xl text-xs font-semibold cursor-pointer transition-colors border ${
                      sidePanel === 'notes'
                        ? 'bg-sky-500 border-sky-400 text-neutral-950'
                        : 'bg-white/10 hover:bg-white/15 border-white/10 text-neutral-100'
                    }`}
                  >
                    Notes ({meetingNotes.length})
                  </button>
                </div>

                {/* Right: Leave Call Button */}
                <button
                  type="button"
                  onClick={() => disconnectRoom(false)}
                  className="px-5 py-2.5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer shrink-0 transition-colors"
                >
                  Leave Call
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 4: FINANCIAL GOAL VISUALS + CLICK-TO-EDIT ================= */}
      {activeTab === 'visuals' && (
        <div className="space-y-6">
          <div className="glass-card dark:bg-neutral-900/90 dark:border-neutral-800 p-5 rounded-3xl border border-neutral-200/80 space-y-4">
            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
              <input
                ref={visualInputRef}
                type="text"
                value={visualPrompt}
                onChange={(e) => {
                  setVisualPrompt(e.target.value);
                  if (visualError) setVisualError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleGenerateVisual()}
                placeholder="Describe a financial goal or wealth milestone to visualize (home, savings, retirement, vehicle)..."
                className="flex-1 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200/80 dark:border-neutral-800 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-sky-400"
              />
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleEnhanceVisual}
                  disabled={isEnhancingVisual}
                  className="px-4 py-3 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-xs font-bold cursor-pointer disabled:opacity-40 whitespace-nowrap"
                >
                  {isEnhancingVisual ? 'Enhancing...' : 'Enhance Goal'}
                </button>
                <button
                  type="button"
                  onClick={handleGenerateVisual}
                  disabled={visualLoading}
                  className="px-5 py-3 rounded-2xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  {visualLoading ? 'Creating...' : 'Render Goal Visual'}
                </button>
              </div>
            </div>

            {/* Compact Style Presets + Aspect Ratio Bar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400 mr-1.5">
                  Style
                </span>
                {VISUAL_STYLE_PRESETS.map((preset) => {
                  const selected = visualStyle === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setVisualStyle(preset.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                        selected
                          ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950'
                          : 'bg-neutral-100 dark:bg-neutral-800/90 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-400 mr-1.5">
                  Ratio
                </span>
                {VISUAL_ASPECT_RATIOS.map((ratio) => {
                  const selected = visualRatio === ratio.id;
                  return (
                    <button
                      key={ratio.id}
                      type="button"
                      onClick={() => setVisualRatio(ratio.id)}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-mono font-bold transition-colors cursor-pointer ${
                        selected
                          ? 'bg-indigo-600 text-white'
                          : 'bg-neutral-100 dark:bg-neutral-800/90 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                      }`}
                    >
                      {ratio.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {VISUAL_PROMPT_IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => {
                    setVisualPrompt(idea);
                    setVisualError(null);
                  }}
                  className="text-xs px-3 py-1.5 rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 hover:border-sky-400 cursor-pointer text-left"
                >
                  {idea}
                </button>
              ))}
            </div>

            {visualError && (
              <div className="px-4 py-3 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs font-semibold flex items-center justify-between gap-3">
                <span>{visualError}</span>
                <button
                  type="button"
                  onClick={handleGenerateVisual}
                  className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer shrink-0"
                >
                  Retry
                </button>
              </div>
            )}
          </div>

          {visualLoading && (
            <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 sm:p-6">
              <div
                className={`${
                  (VISUAL_ASPECT_RATIOS.find((r) => r.id === visualRatio) || VISUAL_ASPECT_RATIOS[0]).frameClass
                } rounded-2xl bg-neutral-100 dark:bg-neutral-950 relative overflow-hidden flex flex-col items-center justify-center p-6 max-h-[520px]`}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-neutral-200/70 via-transparent to-neutral-300/60 dark:from-white/[0.04] dark:via-transparent dark:to-white/[0.03] animate-pulse" />
                <div className="relative z-10 flex flex-col items-center gap-4 w-full max-w-xs text-center">
                  <div className="w-10 h-10 rounded-full border-2 border-neutral-300 dark:border-neutral-700 border-t-neutral-900 dark:border-t-white animate-spin" />
                  <p className="text-xs font-medium text-neutral-600 dark:text-neutral-300 tracking-wide">
                    Creating goal visual...
                  </p>
                  <div className="w-full h-1 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                    <div
                      className="h-full bg-neutral-900 dark:bg-white transition-all duration-700 rounded-full"
                      style={{ width: `${Math.max(12, Math.min(96, activeRenderJob?.progressPercent || 20))}%` }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCancelVisualRender}
                    className="px-4 py-1.5 rounded-xl text-xs font-semibold text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {currentVisualResult && (
            <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4 animate-enter">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-bold truncate flex-1 min-w-[180px]">{visualPrompt}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setEditorTarget({
                        imageUrl: currentVisualResult,
                        title: visualPrompt || 'Financial Goal Visual',
                        targetType: 'preview',
                        aspectRatio: resultRatio,
                      })
                    }
                    className="px-3.5 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold cursor-pointer whitespace-nowrap"
                  >
                    View &amp; Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadVisualAsset(currentVisualResult, visualPrompt)}
                    className="px-3.5 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer whitespace-nowrap"
                  >
                    Download Image
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveVisual}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                  >
                    Save to Gallery
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentVisualResult(null)}
                    className="px-3.5 py-2 rounded-xl text-xs font-bold bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-300 cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setEditorTarget({
                    imageUrl: currentVisualResult,
                    title: visualPrompt || 'Financial Goal Visual',
                    targetType: 'preview',
                    aspectRatio: resultRatio,
                  })
                }
                aria-label="Click to inspect or edit generated financial goal visual"
                className={`${
                  (VISUAL_ASPECT_RATIOS.find((r) => r.id === resultRatio) || VISUAL_ASPECT_RATIOS[0]).frameClass
                } block rounded-2xl overflow-hidden bg-neutral-950 max-h-[540px] relative group cursor-pointer`}
              >
                <img
                  src={currentVisualResult}
                  alt={visualPrompt}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.01]"
                />
                <span className="absolute bottom-3 right-3 px-3 py-1.5 rounded-xl bg-black/75 text-white text-xs font-bold opacity-90 group-hover:opacity-100 transition-opacity">
                  Click to Inspect &amp; Edit
                </span>
              </button>
            </div>
          )}

          {goals.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {goals.map((g) => (
                <div
                  key={g.id}
                  className="rounded-3xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setEditorTarget({
                        imageUrl: g.visualUrl,
                        title: g.title || 'Financial Milestone',
                        targetType: 'gallery',
                        aspectRatio: '16:9',
                      })
                    }
                    className="relative aspect-video bg-neutral-950 overflow-hidden group cursor-pointer text-left"
                  >
                    <img
                      src={g.visualUrl}
                      alt={g.title}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                    <span className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-lg bg-black/75 text-white text-[11px] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                      Inspect &amp; Edit
                    </span>
                  </button>
                  <div className="p-4 flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold line-clamp-2 flex-1">{g.title}</p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setEditorTarget({
                            imageUrl: g.visualUrl,
                            title: g.title || 'Financial Milestone',
                            targetType: 'gallery',
                            aspectRatio: '16:9',
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-bold cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadVisualAsset(g.visualUrl, g.title)}
                        className="px-2.5 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-[11px] font-bold cursor-pointer"
                      >
                        Download
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteGoal(g.id)}
                        className="px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-300 hover:bg-rose-100 text-[11px] font-bold cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {editorTarget && (
            <GoalImageEditorModal
              imageUrl={editorTarget.imageUrl}
              initialTitle={editorTarget.title}
              aspectRatio={editorTarget.aspectRatio}
              onClose={() => setEditorTarget(null)}
              onApplyToCurrent={
                editorTarget.targetType === 'preview'
                  ? (editedDataUrl, updatedTitle) => {
                      setCurrentVisualResult(editedDataUrl);
                      if (updatedTitle) setVisualPrompt(updatedTitle);
                    }
                  : undefined
              }
              onSaveCopy={async (editedDataUrl, updatedTitle) => {
                const safeUrl = await ensureFirestoreSafeDataUrl(editedDataUrl, 650000);
                addGoal({ title: updatedTitle, visualUrl: safeUrl, type: 'IMAGE' });
                showToast('Saved edited financial goal visual to gallery.');
              }}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default GoalVisualizer;