import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import PptxGenJS from 'pptxgenjs';
import { generateGoalImage, enhanceFinancialPrompt } from '../services/geminiService';
import { triggerFileDownload } from '../services/emailReceiptService';
import { useFinMind } from '../context/FinMindContext';
import {
  MindMapNode,
  MindMapShape,
  SlideItem,
  SlideTheme,
  CollabNote,
  CollabParticipant,
  IdeationBoardRecord,
} from '../types';

type VisionStudioTab = 'mindmap' | 'slides' | 'room' | 'visuals';

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
    notes: 'Beta validation, onboarding polish, and public launch sprint.',
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
    subtitle: 'Executive summary aligned across design, growth, and economics',
    bullets: [
      'Clarify core customer value and repeatable daily habit loop',
      'Align product milestones, transparent pricing, and launch timeline',
      'Share live deliverables cleanly with stakeholders and partners',
    ],
    layout: 'cover',
    theme: 'midnight',
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
    theme: 'midnight',
    metricHighlight: '75% Margin',
  },
  {
    id: 's-3',
    title: 'Three-Phase Execution Roadmap',
    subtitle: 'From prototype validation to full scale',
    bullets: [
      'Phase 1 · Validate core workflows with 25 active design partners',
      'Phase 2 · Launch multi-format exports and live shared video rooms',
      'Phase 3 · Scale organic referrals and team workspace adoption',
    ],
    layout: 'roadmap',
    theme: 'midnight',
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
    pptxBg: string;
    pptxText: string;
    pptxAccent: string;
    pptxCard: string;
  }
> = {
  midnight: {
    label: 'Midnight Slate',
    bgClass: 'bg-gradient-to-br from-[#0B1120] via-[#0F172A] to-[#172554]',
    textClass: 'text-white',
    mutedClass: 'text-slate-300',
    accentText: 'text-sky-400',
    cardClass: 'bg-white/[0.06] border border-white/12',
    pptxBg: '0F172A',
    pptxText: 'F8FAFC',
    pptxAccent: '38BDF8',
    pptxCard: '1E293B',
  },
  ivory: {
    label: 'Editorial Ivory',
    bgClass: 'bg-gradient-to-br from-[#FAF8F4] via-[#FFFFFF] to-[#F3EFE6]',
    textClass: 'text-neutral-900',
    mutedClass: 'text-neutral-600',
    accentText: 'text-indigo-700',
    cardClass: 'bg-white border border-neutral-200/90 shadow-xs',
    pptxBg: 'FAF8F4',
    pptxText: '0F172A',
    pptxAccent: '4338CA',
    pptxCard: 'FFFFFF',
  },
  emerald: {
    label: 'Forest Emerald',
    bgClass: 'bg-gradient-to-br from-[#042F2E] via-[#064E3B] to-[#022C22]',
    textClass: 'text-white',
    mutedClass: 'text-emerald-100/85',
    accentText: 'text-emerald-300',
    cardClass: 'bg-white/[0.08] border border-emerald-300/20',
    pptxBg: '064E3B',
    pptxText: 'ECFDF5',
    pptxAccent: '34D399',
    pptxCard: '065F46',
  },
  cobalt: {
    label: 'Cobalt Executive',
    bgClass: 'bg-gradient-to-br from-[#172554] via-[#1E3A8A] to-[#0F172A]',
    textClass: 'text-white',
    mutedClass: 'text-blue-100/85',
    accentText: 'text-amber-300',
    cardClass: 'bg-white/[0.08] border border-blue-300/20',
    pptxBg: '1E3A8A',
    pptxText: 'FFFFFF',
    pptxAccent: 'FCD34D',
    pptxCard: '1D4ED8',
  },
};

const MAP_PROMPT_IDEAS = [
  'Launch a family budget and weekly savings system',
  'Plan a new online coffee subscription brand from scratch',
  'Organize my 2025 personal career & learning roadmap',
];

const SLIDE_PROMPT_IDEAS = [
  'Pitch deck for an everyday personal money & goal planning app',
  'Quarterly family or small business financial review presentation',
  '90-day product launch plan with goals, metrics, and roadmap',
];

const VISUAL_PROMPT_IDEAS = [
  'Minimalist product design space overlooking mountain skyline at sunrise',
  'Modern hardware prototype showcase on travertine table with warm daylight',
  'Glass-walled creative team war room with panoramic city view',
  'Clean architectural office workspace with natural oak and greenery',
];

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

interface RemoteVideoTileProps {
  participant: CollabParticipant;
  stream?: MediaStream;
}

const RemoteVideoTile: React.FC<RemoteVideoTileProps> = ({ participant, stream }) => {
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
    <div className="relative aspect-video rounded-2xl overflow-hidden bg-neutral-900 border border-neutral-800 flex items-center justify-center">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={`w-full h-full object-cover ${hasVideo && (participant.camOn || participant.screenOn) ? 'block' : 'hidden'}`}
      />
      {(!hasVideo || (!participant.camOn && !participant.screenOn)) && (
        <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-lg font-extrabold shadow-md"
            style={{ backgroundColor: participant.color || '#0284C7' }}
          >
            {initials}
          </div>
          <p className="text-xs font-semibold text-neutral-300">Camera off</p>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-white truncate">{participant.name}</p>
          <p className="text-[10px] font-mono text-neutral-300 truncate">{participant.role}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {participant.screenOn && (
            <span className="px-2 py-0.5 rounded-md bg-sky-500/90 text-[10px] font-mono font-bold text-white">
              Sharing
            </span>
          )}
          <span
            className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold ${
              participant.micOn ? 'bg-emerald-500/90 text-white' : 'bg-neutral-800/90 text-neutral-300'
            }`}
          >
            {participant.micOn ? 'Mic On' : 'Muted'}
          </span>
        </div>
      </div>
    </div>
  );
};

const GoalVisualizer: React.FC = () => {
  const {
    goals,
    addGoal,
    deleteGoal,
    trackEngagement,
    currentUser,
    saveIdeationBoard,
    loadIdeationBoards,
    logAnalyticsEvent,
  } = useFinMind();

  const [activeTab, setActiveTab] = useState<VisionStudioTab>('mindmap');
  const [boardId, setBoardId] = useState<string>(() => `board-${Date.now().toString(36)}`);
  const [boardTitle, setBoardTitle] = useState('New Product Strategy Board');
  const [roomCode, setRoomCode] = useState(() => `ROOM-${Math.floor(100 + Math.random() * 899)}`);
  const [savedBoards, setSavedBoards] = useState<IdeationBoardRecord[]>([]);
  const [savingBoard, setSavingBoard] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Export Menu & Print/PDF Modal State
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportingPptx, setExportingPptx] = useState(false);
  const [printPreviewHtml, setPrintPreviewHtml] = useState<string | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Separate Per-Tab Prompts & Generation States
  const [mapPrompt, setMapPrompt] = useState('');
  const [enhancingMap, setEnhancingMap] = useState(false);
  const [generatingMap, setGeneratingMap] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const [slidePrompt, setSlidePrompt] = useState('');
  const [enhancingSlides, setEnhancingSlides] = useState(false);
  const [generatingSlides, setGeneratingSlides] = useState(false);
  const [slideError, setSlideError] = useState<string | null>(null);
  const [deckTheme, setDeckTheme] = useState<SlideTheme>('midnight');

  // Mind Map State (Canvas-First Inline Editing)
  const [nodes, setNodes] = useState<MindMapNode[]>(DEFAULT_NODES);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('n-root');
  const [inlineEditingNodeId, setInlineEditingNodeId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const didDragMoveRef = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Slide Deck Builder State
  const [slides, setSlides] = useState<SlideItem[]>(DEFAULT_SLIDES);
  const [activeSlideId, setActiveSlideId] = useState<string>(DEFAULT_SLIDES[0].id);

  // Live Team Room Conferencing State
  const [collabName, setCollabName] = useState(currentUser?.displayName || 'Host');
  const [collabRole, setCollabRole] = useState('Team Host');
  const [isRoomConnected, setIsRoomConnected] = useState(false);
  const [participants, setParticipants] = useState<CollabParticipant[]>([]);
  const [meetingNotes, setMeetingNotes] = useState<CollabNote[]>([]);
  const [newNoteText, setNewNoteText] = useState('');
  const [newNoteKind, setNewNoteKind] = useState<CollabNote['kind']>('note');

  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  const collabWsRef = useRef<WebSocket | null>(null);
  const myPeerIdRef = useRef<string>('');
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
  const [visualLoading, setVisualLoading] = useState(false);
  const [isEnhancingVisual, setIsEnhancingVisual] = useState(false);
  const [visualError, setVisualError] = useState<string | null>(null);
  const [currentVisualResult, setCurrentVisualResult] = useState<string | null>(null);

  useEffect(() => {
    loadIdeationBoards().then((list) => setSavedBoards(list));
  }, [loadIdeationBoards]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
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
  }, [camOn, screenOn, activeTab, refreshLocalPreview]);

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
    const videoSender = senders.find((s) => s.track?.kind === 'video');
    const audioSender = senders.find((s) => s.track?.kind === 'audio');

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

  const disconnectRoom = useCallback(() => {
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
    setParticipants([]);
  }, [stopAllMedia]);

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

  const connectToRoom = useCallback(() => {
    if (collabWsRef.current) {
      collabWsRef.current.close();
      collabWsRef.current = null;
    }
    setMediaError(null);

    const code = roomCode.trim().toUpperCase() || 'ROOM-101';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/collab-room?room=${encodeURIComponent(
      code
    )}&name=${encodeURIComponent(collabName.trim() || 'Host')}&role=${encodeURIComponent(
      collabRole.trim() || 'Member'
    )}`;

    const ws = new WebSocket(wsUrl);
    collabWsRef.current = ws;

    ws.onopen = () => {
      setIsRoomConnected(true);
      logAnalyticsEvent('vision_collab', 'vision', `join_room:${code}`);
      showToast(`Connected to video room ${code}.`);
    };

    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'room_state') {
          if (msg.peerId || msg.clientId) {
            myPeerIdRef.current = msg.peerId || msg.clientId;
          }
          if (Array.isArray(msg.participants)) {
            setParticipants(msg.participants);
            reconcilePeers(msg.participants);
          }
          if (Array.isArray(msg.nodes) && msg.nodes.length > 0) setNodes(msg.nodes);
          else ws.send(JSON.stringify({ type: 'sync_nodes', nodes: nodesRef.current }));

          if (Array.isArray(msg.slides) && msg.slides.length > 0) {
            setSlides(msg.slides);
            setActiveSlideId(msg.slides[0].id);
          } else {
            ws.send(JSON.stringify({ type: 'sync_slides', slides: slidesRef.current }));
          }
          if (Array.isArray(msg.meetingNotes)) setMeetingNotes(msg.meetingNotes);
          ws.send(JSON.stringify({ type: 'media_state', micOn, camOn, screenOn }));
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

    ws.onclose = () => setIsRoomConnected(false);
    ws.onerror = () => setIsRoomConnected(false);
  }, [
    roomCode,
    collabName,
    collabRole,
    micOn,
    camOn,
    screenOn,
    logAnalyticsEvent,
    showToast,
    reconcilePeers,
    closePeerConnection,
    getOrCreatePeerConnection,
    flushPendingIce,
    sendWs,
  ]);

  useEffect(() => {
    return () => disconnectRoom();
  }, [disconnectRoom]);

  const handleToggleMic = async () => {
    setMediaError(null);
    if (!localStreamRef.current || localStreamRef.current.getAudioTracks().length === 0) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const track = audioStream.getAudioTracks()[0];
        if (!localStreamRef.current) localStreamRef.current = new MediaStream([track]);
        else localStreamRef.current.addTrack(track);
        setMicOn(true);
        broadcastMediaState(true, camOn, screenOn);
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

  const handleToggleCamera = async () => {
    setMediaError(null);
    if (!localStreamRef.current || localStreamRef.current.getVideoTracks().length === 0) {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const track = videoStream.getVideoTracks()[0];
        if (!localStreamRef.current) localStreamRef.current = new MediaStream([track]);
        else localStreamRef.current.addTrack(track);
        setCamOn(true);
        broadcastMediaState(micOn, true, screenOn);
        refreshLocalPreview();
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

  const handleCopyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      showToast(`Room code ${roomCode} copied.`);
    } catch {
      showToast(`Share room code: ${roomCode}`);
    }
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

  const handleGenerateSlides = async () => {
    if (!slidePrompt.trim()) return;
    setGeneratingSlides(true);
    setSlideError(null);
    try {
      const resp = await fetch('/api/gemini/vision-slides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: slidePrompt.trim(), theme: deckTheme }),
      });
      const data = await resp.json();
      if (!resp.ok || !Array.isArray(data.slides)) {
        throw new Error(data.error || 'Could not generate slides right now.');
      }
      if (data.title) setBoardTitle(data.title);
      const themed = data.slides.map((s: SlideItem) => ({ ...s, theme: s.theme || deckTheme }));
      setSlides(themed);
      setActiveSlideId(themed[0]?.id || '');
      broadcastSlides(themed);
      logAnalyticsEvent('vision_collab', 'vision', `ai_slides:${slidePrompt.slice(0, 40)}`);
      showToast('Created presentation slide deck.');
    } catch (err: any) {
      setSlideError(err?.message || 'Unable to generate presentation slides right now.');
    } finally {
      setGeneratingSlides(false);
    }
  };

  // ================= BOARD MANAGEMENT (WORKING SAVE & LOAD) =================
  const handleNewBoard = () => {
    setBoardId(`board-${Date.now().toString(36)}`);
    setBoardTitle('Untitled Strategy Workspace');
    setNodes(DEFAULT_NODES);
    setSelectedNodeId('n-root');
    setInlineEditingNodeId(null);
    setSlides(DEFAULT_SLIDES);
    setActiveSlideId(DEFAULT_SLIDES[0].id);
    setMeetingNotes([]);
    showToast('Started a fresh board.');
  };

  const handleSaveBoard = async () => {
    setSavingBoard(true);
    try {
      const board: IdeationBoardRecord = {
        boardId,
        title: boardTitle.trim() || 'Product Strategy Board',
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
        showToast('Board saved and backed up to your cloud workspace.');
      } else if (result.ok) {
        showToast(
          result.error
            ? `Saved on this device (${result.error})`
            : 'Board saved on this device.'
        );
      } else {
        showToast(result.error || 'Could not save board.');
      }
    } finally {
      setSavingBoard(false);
    }
  };

  const handleLoadBoard = (b: IdeationBoardRecord) => {
    setBoardId(b.boardId);
    setBoardTitle(b.title);
    setRoomCode(b.roomCode);
    if (b.nodes.length > 0) {
      setNodes(b.nodes);
      setSelectedNodeId(b.nodes[0].id);
      setInlineEditingNodeId(null);
    }
    if (b.slides.length > 0) {
      setSlides(b.slides);
      setActiveSlideId(b.slides[0].id);
      if (b.slides[0].theme) setDeckTheme(b.slides[0].theme);
    }
    setMeetingNotes(b.meetingNotes || []);
    showToast(`Opened "${b.title}".`);
  };

  // ================= EXPORTS (.pptx, Print/PDF Preview Modal, .md, Backup) =================
  const buildBoardDocumentHtml = () => {
    const slidesHtml = slides
      .map((s, idx) => {
        const t = SLIDE_THEMES[s.theme || deckTheme] || SLIDE_THEMES.midnight;
        const isLight = (s.theme || deckTheme) === 'ivory';
        const bgHex = `#${t.pptxBg}`;
        const textHex = `#${t.pptxText}`;
        const accentHex = `#${t.pptxAccent}`;
        const cardHex = `#${t.pptxCard}`;
        return `
          <section class="slide" style="background:${bgHex};color:${textHex};border-color:${isLight ? '#e5e7eb' : 'rgba(255,255,255,0.12)'}">
            <div class="meta" style="color:${accentHex}">${escapeHtmlText(boardTitle)} &bull; Slide ${idx + 1} of ${slides.length}</div>
            <h2>${escapeHtmlText(s.title || 'Untitled Slide')}</h2>
            ${s.subtitle ? `<p class="subtitle" style="color:${accentHex}">${escapeHtmlText(s.subtitle)}</p>` : ''}
            <div class="slide-body">
              <ul>
                ${(s.bullets || []).filter(Boolean).map((b) => `<li>${escapeHtmlText(b)}</li>`).join('')}
              </ul>
              ${
                s.metricHighlight
                  ? `<div class="metric" style="background:${cardHex};border:1px solid ${accentHex};color:${textHex}">${escapeHtmlText(s.metricHighlight)}</div>`
                  : ''
              }
            </div>
          </section>`;
      })
      .join('\n');

    const mapHtml = `
      <section class="summary">
        <h3>Mind Map Outline</h3>
        <ul>
          ${nodes
            .map(
              (n) =>
                `<li><strong>${escapeHtmlText(n.label)}</strong>${
                  n.metricTag ? ` <em>[${escapeHtmlText(n.metricTag)}]</em>` : ''
                }${n.notes ? ` — ${escapeHtmlText(n.notes)}` : ''}</li>`
            )
            .join('')}
        </ul>
        ${
          meetingNotes.length > 0
            ? `<h3>Team Meeting Notes</h3><ul>${meetingNotes
                .map(
                  (m) =>
                    `<li><strong>[${escapeHtmlText(m.kind.toUpperCase())}] ${escapeHtmlText(
                      m.author
                    )}:</strong> ${escapeHtmlText(m.text)}</li>`
                )
                .join('')}</ul>`
            : ''
        }
      </section>`;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtmlText(boardTitle)} — Presentation & Summary</title>
  <style>
    @page { size: landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 18px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #0f172a; background: #f8fafc; }
    .slide {
      border-radius: 16px;
      padding: 30px 36px;
      margin-bottom: 18px;
      page-break-after: always;
      min-height: 145mm;
      display: flex;
      flex-direction: column;
      border: 1px solid #e2e8f0;
    }
    .meta { font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 700; margin-bottom: 12px; }
    h2 { font-size: 28px; margin: 0 0 8px; }
    .subtitle { font-size: 15px; margin: 0 0 22px; font-weight: 500; }
    .slide-body { display: flex; gap: 24px; align-items: center; flex: 1; }
    ul { margin: 0; padding-left: 20px; font-size: 16px; line-height: 1.65; flex: 1; }
    .metric { min-width: 185px; padding: 22px; border-radius: 14px; text-align: center; font-size: 22px; font-weight: 800; }
    .summary { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px 24px; font-size: 13px; line-height: 1.6; }
    .summary h3 { margin: 12px 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; }
  </style>
</head>
<body>
  ${slidesHtml}
  ${mapHtml}
</body>
</html>`;
  };

  const handleExportPptx = async () => {
    setExportMenuOpen(false);
    setExportingPptx(true);
    try {
      const pres = new PptxGenJS();
      pres.layout = 'LAYOUT_16X9';
      pres.title = boardTitle || 'Liddy Presentation';
      pres.author = currentUser?.displayName || collabName || 'Liddy Member';

      slides.forEach((s, idx) => {
        const slide = pres.addSlide();
        const t = SLIDE_THEMES[s.theme || deckTheme] || SLIDE_THEMES.midnight;
        slide.background = { color: t.pptxBg };

        slide.addShape(pres.ShapeType.rect, {
          x: 0,
          y: 0,
          w: 10,
          h: 0.14,
          fill: { color: t.pptxAccent },
        });

        slide.addText(`${(boardTitle || 'STRATEGY').toUpperCase()}  |  SLIDE ${idx + 1}`, {
          x: 0.65,
          y: 0.35,
          w: 8.7,
          h: 0.35,
          fontSize: 10,
          color: t.pptxAccent,
          bold: true,
        });

        slide.addText(s.title || 'Untitled Slide', {
          x: 0.65,
          y: 0.85,
          w: 8.7,
          h: 0.85,
          fontSize: s.layout === 'cover' ? 30 : 24,
          bold: true,
          color: t.pptxText,
        });

        if (s.subtitle) {
          slide.addText(s.subtitle, {
            x: 0.65,
            y: 1.68,
            w: 8.5,
            h: 0.45,
            fontSize: 14,
            color: t.pptxAccent,
          });
        }

        if (s.metricHighlight) {
          slide.addShape(pres.ShapeType.roundRect, {
            x: 6.45,
            y: 2.3,
            w: 2.9,
            h: 2.0,
            fill: { color: t.pptxCard },
            line: { color: t.pptxAccent, width: 1.5 },
          });
          slide.addText(s.metricHighlight, {
            x: 6.6,
            y: 2.95,
            w: 2.6,
            h: 0.85,
            fontSize: 21,
            bold: true,
            color: t.pptxText,
            align: 'center',
          });
        }

        const bulletW = s.metricHighlight ? 5.5 : 8.7;
        const bulletRows = (s.bullets || [])
          .filter(Boolean)
          .map((b) => ({
            text: b,
            options: {
              bullet: { code: '2022' },
              color: t.pptxText,
              fontSize: 15,
              breakLine: true,
              paraSpaceAfter: 12,
            },
          }));

        if (bulletRows.length > 0) {
          slide.addText(bulletRows as any, {
            x: 0.65,
            y: 2.35,
            w: bulletW,
            h: 2.7,
            valign: 'top',
          });
        }
      });

      const safeFilename = (boardTitle || 'Liddy-Vision-Deck').replace(/[^a-zA-Z0-9_-]/g, '-');
      await pres.writeFile({ fileName: `${safeFilename}.pptx` });
      logAnalyticsEvent('vision_collab', 'vision', `export_pptx:${slides.length}_slides`);
      showToast('Downloaded PowerPoint presentation.');
    } catch (err: any) {
      showToast(err?.message || 'Unable to export PowerPoint right now.');
    } finally {
      setExportingPptx(false);
    }
  };

  const handleOpenPrintPreview = () => {
    setExportMenuOpen(false);
    const html = buildBoardDocumentHtml();
    setPrintPreviewHtml(html);
    logAnalyticsEvent('vision_collab', 'vision', `export_pdf_preview:${slides.length}`);
  };

  const handleExportMarkdown = () => {
    setExportMenuOpen(false);
    const mdLines: string[] = [
      `# ${boardTitle || 'Strategy Workspace'}`,
      `Room Code: ${roomCode} · Exported: ${new Date().toLocaleString()}`,
      '',
      '## Mind Map Outline',
      ...nodes.map(
        (n) => `- **${n.label}**${n.metricTag ? ` [${n.metricTag}]` : ''}${n.notes ? ` — ${n.notes}` : ''}`
      ),
      '',
      '## Presentation Slides',
      ...slides.flatMap((s, idx) => [
        `### Slide ${idx + 1}: ${s.title}`,
        s.subtitle ? `_${s.subtitle}_` : '',
        s.metricHighlight ? `**Highlight:** ${s.metricHighlight}` : '',
        ...(s.bullets || []).filter(Boolean).map((b) => `- ${b}`),
        '',
      ]),
      '## Meeting Notes & Decisions',
      ...(meetingNotes.length > 0
        ? meetingNotes.map((m) => `- **[${m.kind.toUpperCase()}]** ${m.author}: ${m.text}`)
        : ['- No notes recorded yet.']),
    ];

    const safeName = (boardTitle || 'vision-brief').replace(/[^a-zA-Z0-9_-]/g, '-');
    triggerFileDownload(mdLines.filter((l) => l !== undefined).join('\n'), `${safeName}.md`, 'text/markdown');
    showToast('Downloaded Markdown brief.');
  };

  const handleExportBackup = () => {
    setExportMenuOpen(false);
    const payload = {
      boardId,
      title: boardTitle,
      roomCode,
      exportedAt: new Date().toISOString(),
      nodes,
      slides,
      meetingNotes,
    };
    const safeName = (boardTitle || 'vision-board').replace(/[^a-zA-Z0-9_-]/g, '-');
    triggerFileDownload(JSON.stringify(payload, null, 2), `${safeName}-backup.json`, 'application/json');
    showToast('Downloaded portable board backup file.');
  };

  // ================= MIND MAP INTERACTION (DIRECT CANVAS EDITING) =================
  const handleNodePointerDown = (e: React.PointerEvent, node: MindMapNode) => {
    if ((e.target as HTMLElement).closest('input, textarea, select, button')) return;
    e.stopPropagation();
    setSelectedNodeId(node.id);
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    dragOffsetRef.current = {
      dx: e.clientX - rect.left - node.x,
      dy: e.clientY - rect.top - node.y,
    };
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    didDragMoveRef.current = false;
    setDraggingId(node.id);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    if (!draggingId || !canvasRef.current) return;
    const moveDist = Math.hypot(e.clientX - dragStartRef.current.x, e.clientY - dragStartRef.current.y);
    if (moveDist > 5) {
      didDragMoveRef.current = true;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const nextX = Math.max(16, Math.min(rect.width - 245, e.clientX - rect.left - dragOffsetRef.current.dx));
    const nextY = Math.max(16, Math.min(rect.height - 135, e.clientY - rect.top - dragOffsetRef.current.dy));
    setNodes((prev) =>
      prev.map((n) => (n.id === draggingId ? { ...n, x: Math.round(nextX), y: Math.round(nextY) } : n))
    );
  };

  const handleCanvasPointerUp = () => {
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

  const handleAutoArrangeNodes = () => {
    const root = nodes.find((n) => !n.parentId) || nodes[0];
    if (!root) return;
    const children = nodes.filter((n) => n.id !== root.id);
    const total = children.length;
    const cx = 345;
    const cy = 205;
    const nextNodes = nodes.map((n) => {
      if (n.id === root.id) {
        return { ...n, x: cx, y: cy, shape: n.shape || 'hub' };
      }
      const idx = children.findIndex((c) => c.id === n.id);
      const angle = (idx / Math.max(1, total)) * Math.PI * 2 - Math.PI / 2;
      const rx = 285;
      const ry = 165;
      return {
        ...n,
        x: Math.round(Math.max(20, Math.min(660, cx + Math.cos(angle) * rx))),
        y: Math.round(Math.max(24, Math.min(390, cy + Math.sin(angle) * ry))),
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
      notes: 'Click here to write details or metrics.',
      x: Math.min(650, Math.max(24, (parent?.x || 320) + offsetSign * 175)),
      y: Math.min(390, Math.max(24, (parent?.y || 180) + 115)),
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
  const currentThemeSpec = SLIDE_THEMES[activeSlide?.theme || deckTheme] || SLIDE_THEMES.midnight;

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
  const handleEnhanceVisual = async () => {
    if (!visualPrompt.trim()) return;
    setIsEnhancingVisual(true);
    setVisualError(null);
    try {
      const enhanced = await enhanceFinancialPrompt(visualPrompt);
      setVisualPrompt(enhanced);
    } finally {
      setIsEnhancingVisual(false);
    }
  };

  const handleGenerateVisual = async () => {
    if (!visualPrompt.trim()) return;
    setVisualLoading(true);
    setVisualError(null);
    setCurrentVisualResult(null);
    try {
      const url = await generateGoalImage(visualPrompt);
      if (url) {
        setCurrentVisualResult(url);
      } else {
        setVisualError('Could not render a concept visual for that description. Try adjusting your wording.');
      }
    } catch (err: any) {
      setVisualError(err?.message || 'Concept visual creation encountered an issue. Please try again.');
    } finally {
      setVisualLoading(false);
    }
  };

  const handleSaveVisual = () => {
    if (!currentVisualResult || !visualPrompt) return;
    addGoal({ title: visualPrompt, visualUrl: currentVisualResult, type: 'IMAGE' });
    trackEngagement('Vision Visual Concept');
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

  return (
    <div className="space-y-6 animate-enter">
      {/* Top Studio Header */}
      <div className="rounded-3xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900/95 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-indigo-600 dark:text-sky-400 font-bold">
                Vision Collaborative Studio
              </span>
              <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
                Room: {roomCode}
              </span>
              <span
                className={`text-[11px] font-mono px-2.5 py-0.5 rounded-lg font-semibold ${
                  isRoomConnected
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400'
                }`}
              >
                {isRoomConnected ? `Live Call · ${participants.length} online` : 'Workspace Ready'}
              </span>
            </div>
            <input
              type="text"
              value={boardTitle}
              onChange={(e) => setBoardTitle(e.target.value)}
              aria-label="Board title"
              className="w-full max-w-2xl bg-transparent font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-900 dark:text-white border-b border-transparent focus:border-indigo-500 outline-none pt-1 pb-0.5"
            />
            <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400">
              Visual mind mapping, themed presentation decks, live video rooms, and concept illustrations.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {savedBoards.length > 0 && (
              <select
                value={boardId}
                onChange={(e) => {
                  const match = savedBoards.find((b) => b.boardId === e.target.value);
                  if (match) handleLoadBoard(match);
                }}
                aria-label="Load saved board"
                className="px-3 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-xs font-semibold outline-none max-w-[180px]"
              >
                <option value={boardId}>Saved Boards ({savedBoards.length})</option>
                {savedBoards.map((b) => (
                  <option key={b.boardId} value={b.boardId}>
                    {b.title}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={handleNewBoard}
              className="px-3.5 py-2.5 rounded-xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-xs font-bold cursor-pointer transition-colors"
            >
              + New
            </button>

            <button
              type="button"
              onClick={handleSaveBoard}
              disabled={savingBoard}
              className="px-4 py-2.5 rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 hover:border-indigo-500 text-xs font-bold cursor-pointer transition-colors disabled:opacity-60"
            >
              {savingBoard ? 'Saving...' : 'Save Board'}
            </button>

            {/* Download / Export Multi-Format Dropdown */}
            <div className="relative" ref={exportMenuRef}>
              <button
                type="button"
                onClick={() => setExportMenuOpen((prev) => !prev)}
                className="px-4 py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer flex items-center gap-2 shadow-sm hover:opacity-90"
              >
                <span>{exportingPptx ? 'Building Deck...' : 'Export / Download'}</span>
                <span className="text-[10px]">&#9662;</span>
              </button>

              {exportMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white dark:bg-[#16171F] border border-neutral-200 dark:border-white/15 shadow-2xl p-2 z-50 space-y-1">
                  <button
                    type="button"
                    onClick={handleExportPptx}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <p className="text-xs font-bold text-neutral-900 dark:text-white">PowerPoint Deck (.pptx)</p>
                    <p className="text-[10px] text-neutral-500">Full 16:9 widescreen themed slides</p>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenPrintPreview}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <p className="text-xs font-bold text-neutral-900 dark:text-white">Print / Save as PDF</p>
                    <p className="text-[10px] text-neutral-500">Formatted preview, print &amp; PDF handout</p>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportMarkdown}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <p className="text-xs font-bold text-neutral-900 dark:text-white">Markdown Brief (.md)</p>
                    <p className="text-[10px] text-neutral-500">Structured outline for Notion or docs</p>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportBackup}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                  >
                    <p className="text-xs font-bold text-neutral-900 dark:text-white">Board Backup File</p>
                    <p className="text-[10px] text-neutral-500">Download portable workspace snapshot</p>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Studio Sub-Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-neutral-100 dark:border-white/10">
          {[
            { id: 'mindmap' as const, label: 'Mind Map', meta: `${nodes.length} nodes` },
            { id: 'slides' as const, label: 'Slide Deck Creator', meta: `${slides.length} slides` },
            {
              id: 'room' as const,
              label: 'Live Video & Screen Room',
              meta: isRoomConnected ? `${participants.length} live` : 'Start call',
            },
            { id: 'visuals' as const, label: 'Concept Visuals', meta: `${goals.length} saved` },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                  active
                    ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 shadow-xs'
                    : 'bg-neutral-100 dark:bg-neutral-800/80 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`text-[10px] font-mono ${active ? 'opacity-75' : 'text-neutral-400'}`}>
                  {tab.meta}
                </span>
              </button>
            );
          })}
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

      {/* ================= TAB 1: NAPKIN-INSPIRED MIND MAP ================= */}
      {activeTab === 'mindmap' && (
        <div className="space-y-4">
          {/* Dedicated Mind Map Generation Bar with Enhance Prompt */}
          <div className="rounded-3xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900/90 p-5 space-y-3 shadow-xs">
            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
              <input
                type="text"
                value={mapPrompt}
                onChange={(e) => setMapPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGenerateMindMap()}
                placeholder="Describe a goal, project, or topic to turn into a visual mind map..."
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

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-mono text-neutral-400 mr-1">Try:</span>
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

            {mapError && (
              <div className="px-3.5 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs font-semibold">
                {mapError}
              </div>
            )}
          </div>

          {/* Full-Width Interactive Mind Map Graph */}
          <div className="rounded-3xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-4 sm:p-5 space-y-3 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-extrabold">Visual Canvas</h2>
                <p className="text-xs text-neutral-500">
                  Drag cards to arrange · Click any node to edit text, shape, badge, or color right on the map
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleAutoArrangeNodes}
                  className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold cursor-pointer"
                >
                  Auto Arrange
                </button>
                <button
                  type="button"
                  onClick={() => addChildNode()}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
                >
                  + Add Branch
                </button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-neutral-200 dark:border-neutral-800">
              <div
                ref={canvasRef}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={handleCanvasPointerUp}
                onPointerLeave={handleCanvasPointerUp}
                onClick={(e) => {
                  if (e.target === e.currentTarget) setInlineEditingNodeId(null);
                }}
                className="relative min-w-[920px] h-[540px] bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] dark:bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:20px_20px] bg-neutral-50/70 dark:bg-neutral-950 overflow-hidden select-none touch-none"
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
                      <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#6366F1" fillOpacity="0.6" />
                    </marker>
                  </defs>
                  {nodes.map((node) => {
                    if (!node.parentId) return null;
                    const parent = nodes.find((p) => p.id === node.parentId);
                    if (!parent) return null;
                    const x1 = parent.x + 108;
                    const y1 = parent.y + 44;
                    const x2 = node.x + 108;
                    const y2 = node.y + 44;
                    const mx = (x1 + x2) / 2;
                    return (
                      <path
                        key={`edge-${node.id}`}
                        d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                        fill="none"
                        stroke={NODE_COLORS[node.color]?.accentHex || '#6366F1'}
                        strokeOpacity="0.45"
                        strokeWidth="2.4"
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

                  const shapeClass =
                    shape === 'hub'
                      ? `rounded-full px-6 py-4 ${style.pill} shadow-xl border-2 border-white/30`
                      : shape === 'metric'
                      ? 'rounded-2xl bg-neutral-900 text-white border border-sky-400/50 shadow-lg'
                      : shape === 'insight'
                      ? `rounded-[26px] ${style.surface} text-neutral-900 dark:text-white border-2 border-dashed ${style.ring} shadow-sm`
                      : shape === 'action'
                      ? 'rounded-xl bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white border-2 border-emerald-500/70 shadow-sm'
                      : 'rounded-2xl bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white border border-neutral-200 dark:border-neutral-700 shadow-md overflow-hidden';

                  return (
                    <div
                      key={node.id}
                      onPointerDown={(e) => handleNodePointerDown(e, node)}
                      style={{ left: node.x, top: node.y }}
                      className={`absolute transition-shadow ${
                        isEditing ? 'w-[300px] z-40' : 'w-[224px] z-10'
                      } ${isSelected && !isEditing ? 'ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-neutral-950 z-20' : ''} ${
                        isEditing
                          ? 'rounded-2xl bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white border-2 border-indigo-500 shadow-2xl p-4'
                          : `p-3.5 cursor-grab active:cursor-grabbing ${shapeClass}`
                      }`}
                    >
                      {!isEditing ? (
                        <div className="space-y-1.5">
                          {shape === 'step' && (
                            <div
                              className="h-1.5 -mx-3.5 -mt-3.5 mb-2"
                              style={{ backgroundColor: style.accentHex }}
                            />
                          )}
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                                shape === 'hub'
                                  ? 'bg-white/20 text-white'
                                  : shape === 'metric'
                                  ? 'bg-sky-500/20 text-sky-300'
                                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                              }`}
                            >
                              {node.metricTag || SHAPE_OPTIONS.find((s) => s.id === shape)?.label || 'Note'}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedNodeId(node.id);
                                setInlineEditingNodeId(node.id);
                              }}
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded cursor-pointer ${
                                shape === 'hub' || shape === 'metric'
                                  ? 'text-white/80 hover:bg-white/15'
                                  : 'text-indigo-600 dark:text-sky-400 hover:bg-indigo-50 dark:hover:bg-neutral-800'
                              }`}
                            >
                              Edit
                            </button>
                          </div>
                          <p className="font-display text-sm font-extrabold leading-snug">{node.label}</p>
                          {node.notes && (
                            <p
                              className={`text-[11px] leading-relaxed ${
                                shape === 'hub'
                                  ? 'text-white/90'
                                  : shape === 'metric'
                                  ? 'text-neutral-300'
                                  : 'text-neutral-600 dark:text-neutral-300'
                              }`}
                            >
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
                            placeholder="Write details, milestones, or ideas..."
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
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 2: EXPRESSIVE SLIDE DECK CREATOR ================= */}
      {activeTab === 'slides' && (
        <div className="space-y-5">
          {/* Dedicated Slide Deck Prompt Bar with Enhance Prompt */}
          <div className="rounded-3xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900/90 p-5 space-y-3 shadow-xs">
            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
              <input
                type="text"
                value={slidePrompt}
                onChange={(e) => setSlidePrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGenerateSlides()}
                placeholder="Describe your presentation topic, story, or key points to build slides..."
                className="flex-1 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200/90 dark:border-neutral-800 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleEnhanceSlidePrompt}
                  disabled={enhancingSlides || !slidePrompt.trim()}
                  className="px-4 py-3 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-xs font-bold cursor-pointer disabled:opacity-40"
                >
                  {enhancingSlides ? 'Enhancing...' : 'Enhance Prompt'}
                </button>
                <button
                  type="button"
                  onClick={handleGenerateSlides}
                  disabled={generatingSlides || !slidePrompt.trim()}
                  className="px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {generatingSlides ? 'Designing Slides...' : 'Build Slide Deck'}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono text-neutral-400 mr-1">Ideas:</span>
                {SLIDE_PROMPT_IDEAS.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => setSlidePrompt(idea)}
                    className="text-xs px-3 py-1 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 hover:border-indigo-400 cursor-pointer"
                  >
                    {idea}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-mono text-neutral-400 mr-1">Deck Theme:</span>
                {(Object.keys(SLIDE_THEMES) as SlideTheme[]).map((themeKey) => (
                  <button
                    key={themeKey}
                    type="button"
                    onClick={() => applyThemeToDeck(themeKey)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border transition-colors ${
                      (activeSlide?.theme || deckTheme) === themeKey
                        ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 border-neutral-900 dark:border-white'
                        : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-transparent'
                    }`}
                  >
                    {SLIDE_THEMES[themeKey].label.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>

            {slideError && (
              <div className="px-3.5 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs font-semibold">
                {slideError}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Sorter Rail */}
            <div className="lg:col-span-3 rounded-3xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-4 space-y-3 h-fit">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-sm font-extrabold">Slides ({slides.length})</h2>
                <button
                  type="button"
                  onClick={addNewSlide}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
                >
                  + Slide
                </button>
              </div>

              <div className="space-y-2 max-h-[520px] overflow-y-auto">
                {slides.map((s, idx) => {
                  const active = s.id === activeSlide?.id;
                  const tSpec = SLIDE_THEMES[s.theme || deckTheme] || SLIDE_THEMES.midnight;
                  return (
                    <div
                      key={s.id}
                      onClick={() => setActiveSlideId(s.id)}
                      className={`p-3 rounded-2xl border cursor-pointer transition-all space-y-2 ${
                        active
                          ? 'border-indigo-600 dark:border-sky-400 bg-indigo-50/70 dark:bg-indigo-950/40 shadow-xs'
                          : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-400'
                      }`}
                    >
                      <div className={`h-2 rounded-full w-full ${tSpec.bgClass}`} />
                      <div className="flex items-center justify-between gap-1 text-[10px] font-mono text-neutral-500">
                        <span>
                          Slide {idx + 1} · {s.layout}
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
                      <p className="text-xs font-bold line-clamp-2">{s.title || 'Untitled Slide'}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Rich Expressive 16:9 Slide Stage & Editor */}
            {activeSlide && (
              <div className="lg:col-span-9 space-y-5">
                {/* 16:9 Rich Visual Stage */}
                <div
                  className={`rounded-3xl p-7 sm:p-10 aspect-[16/9] flex flex-col justify-between shadow-xl relative overflow-hidden ${currentThemeSpec.bgClass} ${currentThemeSpec.textClass}`}
                >
                  {/* Decorative Geometric Backdrop Accent */}
                  <div className="pointer-events-none absolute -top-20 -right-20 w-72 h-72 rounded-full bg-white/[0.04] blur-2xl" />

                  <div className="flex items-center justify-between text-xs font-mono opacity-80 relative z-10">
                    <span className={`uppercase tracking-widest font-bold ${currentThemeSpec.accentText}`}>
                      {boardTitle}
                    </span>
                    <span>
                      {slides.findIndex((s) => s.id === activeSlide.id) + 1} / {slides.length}
                    </span>
                  </div>

                  {/* Layout-Adaptive Visual Stage */}
                  {activeSlide.layout === 'cover' && (
                    <div className="my-auto grid grid-cols-1 md:grid-cols-12 gap-6 items-center relative z-10">
                      <div className="md:col-span-8 space-y-3">
                        <span
                          className={`inline-block text-[11px] font-mono uppercase tracking-[0.18em] font-bold ${currentThemeSpec.accentText}`}
                        >
                          Executive Blueprint
                        </span>
                        <h3 className="font-display text-2xl sm:text-4xl font-extrabold tracking-tight leading-[1.12]">
                          {activeSlide.title}
                        </h3>
                        {activeSlide.subtitle && (
                          <p className={`text-sm sm:text-base max-w-xl ${currentThemeSpec.mutedClass}`}>
                            {activeSlide.subtitle}
                          </p>
                        )}
                      </div>
                      <div className={`md:col-span-4 rounded-2xl p-5 space-y-3 ${currentThemeSpec.cardClass}`}>
                        {activeSlide.metricHighlight && (
                          <div className="pb-3 border-b border-current/15">
                            <p className="text-[10px] font-mono uppercase opacity-70">Target Milestone</p>
                            <p className={`font-display text-2xl font-extrabold ${currentThemeSpec.accentText}`}>
                              {activeSlide.metricHighlight}
                            </p>
                          </div>
                        )}
                        <ul className="space-y-1.5 text-xs">
                          {(activeSlide.bullets || []).filter(Boolean).slice(0, 3).map((b, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className={currentThemeSpec.accentText}>&#9670;</span>
                              <span className="opacity-90">{b}</span>
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
                          <h3 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight">
                            {activeSlide.title}
                          </h3>
                          {activeSlide.subtitle && (
                            <p className={`text-sm mt-1 ${currentThemeSpec.mutedClass}`}>{activeSlide.subtitle}</p>
                          )}
                        </div>
                        {activeSlide.metricHighlight && (
                          <div className={`px-5 py-2.5 rounded-2xl ${currentThemeSpec.cardClass}`}>
                            <span className="text-[10px] font-mono uppercase block opacity-70">Headline KPI</span>
                            <span className={`font-display text-xl font-extrabold ${currentThemeSpec.accentText}`}>
                              {activeSlide.metricHighlight}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                        {(activeSlide.bullets || []).filter(Boolean).slice(0, 3).map((b, i) => (
                          <div key={i} className={`rounded-2xl p-4 flex flex-col justify-between ${currentThemeSpec.cardClass}`}>
                            <span className={`text-xs font-mono font-bold ${currentThemeSpec.accentText}`}>
                              0{i + 1} · KEY METRIC
                            </span>
                            <p className="text-sm font-semibold leading-snug mt-3">{b}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeSlide.layout === 'roadmap' && (
                    <div className="my-auto space-y-6 relative z-10">
                      <div>
                        <h3 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight">
                          {activeSlide.title}
                        </h3>
                        {activeSlide.subtitle && (
                          <p className={`text-sm mt-1 ${currentThemeSpec.mutedClass}`}>{activeSlide.subtitle}</p>
                        )}
                      </div>

                      <div className="relative">
                        <div className="hidden sm:block absolute top-5 left-6 right-6 h-0.5 bg-current/20" />
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 relative">
                          {(activeSlide.bullets || []).filter(Boolean).slice(0, 3).map((b, i) => (
                            <div key={i} className={`rounded-2xl p-4 space-y-2.5 ${currentThemeSpec.cardClass}`}>
                              <div className="flex items-center justify-between">
                                <span
                                  className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-mono font-extrabold bg-current/10 ${currentThemeSpec.accentText}`}
                                >
                                  P{i + 1}
                                </span>
                                <span className="text-[10px] font-mono opacity-65">STAGE {i + 1}</span>
                              </div>
                              <p className="text-xs sm:text-sm font-semibold leading-snug">{b}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeSlide.layout === 'two-col' && (
                    <div className="my-auto grid grid-cols-1 md:grid-cols-12 gap-5 items-center relative z-10">
                      <div className="md:col-span-5 space-y-2">
                        <span className={`text-xs font-mono uppercase tracking-wider font-bold ${currentThemeSpec.accentText}`}>
                          Structured View
                        </span>
                        <h3 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight leading-tight">
                          {activeSlide.title}
                        </h3>
                        {activeSlide.subtitle && (
                          <p className={`text-sm ${currentThemeSpec.mutedClass}`}>{activeSlide.subtitle}</p>
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

                  <div className="flex items-center justify-between text-[11px] font-mono opacity-60 pt-2 border-t border-current/15 relative z-10">
                    <span>{currentUser?.displayName || collabName || 'Workspace Member'}</span>
                    <span>{currentThemeSpec.label}</span>
                  </div>
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

      {/* ================= TAB 3: LIVE VIDEO & SCREEN CONFERENCING ROOM ================= */}
      {activeTab === 'room' && (
        <div className="space-y-6">
          <div className="rounded-3xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-5 sm:p-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-3">
                <label className="block text-[11px] font-mono uppercase text-neutral-500 mb-1">Your Name</label>
                <input
                  type="text"
                  value={collabName}
                  onChange={(e) => setCollabName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-white/10 text-sm font-semibold outline-none"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[11px] font-mono uppercase text-neutral-500 mb-1">Your Role</label>
                <input
                  type="text"
                  value={collabRole}
                  onChange={(e) => setCollabRole(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-white/10 text-sm outline-none"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[11px] font-mono uppercase text-neutral-500 mb-1">Room Code</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                    className="flex-1 px-3.5 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-white/10 text-sm font-mono uppercase outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopyRoomCode}
                    className="px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-bold cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <div className="md:col-span-3 flex flex-wrap gap-2 justify-end">
                <button
                  type="button"
                  onClick={handleToggleMic}
                  className={`px-3.5 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition-colors border ${
                    micOn
                      ? 'bg-emerald-600 text-white border-emerald-500'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 border-neutral-200 dark:border-neutral-700'
                  }`}
                >
                  {micOn ? 'Mic Live' : 'Unmute Mic'}
                </button>
                <button
                  type="button"
                  onClick={handleToggleCamera}
                  className={`px-3.5 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition-colors border ${
                    camOn
                      ? 'bg-indigo-600 text-white border-indigo-500'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 border-neutral-200 dark:border-neutral-700'
                  }`}
                >
                  {camOn ? 'Camera Active' : 'Turn Camera On'}
                </button>
                <button
                  type="button"
                  onClick={handleToggleScreenShare}
                  className={`px-3.5 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition-colors border ${
                    screenOn
                      ? 'bg-sky-600 text-white border-sky-500'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 border-neutral-200 dark:border-neutral-700'
                  }`}
                >
                  {screenOn ? 'Stop Share' : 'Share Screen'}
                </button>

                {!isRoomConnected ? (
                  <button
                    type="button"
                    onClick={connectToRoom}
                    className="px-5 py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer"
                  >
                    Join Video Room &rarr;
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={disconnectRoom}
                    className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
                  >
                    Leave Call
                  </button>
                )}
              </div>
            </div>

            {mediaError && (
              <div className="px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs flex items-center justify-between gap-3">
                <span>{mediaError}</span>
                <button type="button" onClick={() => setMediaError(null)} className="font-bold cursor-pointer px-1">
                  Dismiss
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 rounded-3xl border border-neutral-200 dark:border-white/10 bg-neutral-950 p-5 space-y-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display text-base font-extrabold">Live Conference Stage</h3>
                  <p className="text-xs text-neutral-400">
                    Share room code <strong className="text-white font-mono">{roomCode}</strong> in another tab or device to connect live video &amp; screens.
                  </p>
                </div>
                <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-neutral-900 border border-neutral-800 text-neutral-300">
                  {isRoomConnected ? `${participants.length} in call` : 'Preview Ready'}
                </span>
              </div>

              <div className={`grid gap-4 ${remoteParticipants.length === 0 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
                <div className="relative aspect-video rounded-2xl overflow-hidden bg-neutral-900 border border-neutral-800 flex items-center justify-center">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-cover ${camOn || screenOn ? 'block' : 'hidden'} ${
                      camOn && !screenOn ? '-scale-x-100' : ''
                    }`}
                  />
                  {!camOn && !screenOn && (
                    <div className="flex flex-col items-center justify-center gap-2 p-4 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center text-white text-xl font-extrabold shadow-md">
                        {localInitials}
                      </div>
                      <p className="text-xs text-neutral-400">Enable camera or screen share above to broadcast video</p>
                    </div>
                  )}

                  <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/85 via-black/40 to-transparent flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">{collabName || 'You'} (You)</p>
                      <p className="text-[10px] font-mono text-neutral-300 truncate">{collabRole}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {screenOn && (
                        <span className="px-2 py-0.5 rounded-md bg-sky-600 text-[10px] font-mono font-bold">Screen</span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold ${
                          micOn ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-neutral-300'
                        }`}
                      >
                        {micOn ? 'Mic On' : 'Muted'}
                      </span>
                    </div>
                  </div>
                </div>

                {remoteParticipants.map((p) => {
                  const pid = p.peerId || p.clientId;
                  return <RemoteVideoTile key={pid} participant={p} stream={remoteStreams[pid]} />;
                })}
              </div>
            </div>

            <div className="lg:col-span-5 rounded-3xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900 p-6 flex flex-col justify-between space-y-5">
              <div className="space-y-4">
                <div>
                  <h3 className="font-display text-lg font-extrabold">Meeting Notes &amp; Decisions</h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    Synchronized live across everyone in room <span className="font-mono font-bold">{roomCode}</span>.
                  </p>
                </div>

                <form onSubmit={handleAddMeetingNote} className="flex gap-2">
                  <select
                    value={newNoteKind}
                    onChange={(e) => setNewNoteKind(e.target.value as CollabNote['kind'])}
                    className="px-3 py-2 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-white/10 text-xs font-bold outline-none"
                  >
                    <option value="note">Note</option>
                    <option value="decision">Decision</option>
                    <option value="action">Action Item</option>
                  </select>
                  <input
                    type="text"
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                    placeholder="Capture decision or next action..."
                    className="flex-1 px-3.5 py-2 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-white/10 text-xs sm:text-sm outline-none focus:border-indigo-500"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer shrink-0"
                  >
                    Post
                  </button>
                </form>

                <div className="space-y-2.5 max-h-[340px] overflow-y-auto">
                  {meetingNotes.length === 0 ? (
                    <div className="p-8 rounded-2xl border border-dashed border-neutral-200 dark:border-white/10 text-center text-xs text-neutral-500">
                      No meeting notes logged yet. Post the first agenda note above.
                    </div>
                  ) : (
                    meetingNotes.map((n) => (
                      <div
                        key={n.id}
                        className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200/80 dark:border-white/10 space-y-1"
                      >
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="font-bold text-indigo-600 dark:text-sky-400 uppercase">
                            {n.kind} &bull; {n.author}
                          </span>
                          <span className="text-neutral-400">
                            {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="text-xs sm:text-sm text-neutral-800 dark:text-neutral-200">{n.text}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 4: CONCEPT & MILESTONE VISUALS ================= */}
      {activeTab === 'visuals' && (
        <div className="space-y-6">
          <div className="glass-card dark:bg-neutral-900/90 dark:border-neutral-800 p-5 rounded-3xl border border-neutral-200/80 space-y-4">
            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
              <input
                type="text"
                value={visualPrompt}
                onChange={(e) => setVisualPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleGenerateVisual()}
                placeholder="Describe a product concept, milestone vision, or workspace inspiration..."
                className="flex-1 bg-neutral-50 dark:bg-neutral-950 border border-neutral-200/80 dark:border-neutral-800 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-sky-400"
              />
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleEnhanceVisual}
                  disabled={isEnhancingVisual || !visualPrompt.trim()}
                  className="px-4 py-3 rounded-2xl bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-xs font-bold cursor-pointer disabled:opacity-40"
                >
                  {isEnhancingVisual ? 'Enhancing...' : 'Enhance Prompt'}
                </button>
                <button
                  type="button"
                  onClick={handleGenerateVisual}
                  disabled={visualLoading || !visualPrompt.trim()}
                  className="px-5 py-3 rounded-2xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {visualLoading ? 'Rendering...' : 'Render Visual'}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {VISUAL_PROMPT_IDEAS.map((idea) => (
                <button
                  key={idea}
                  type="button"
                  onClick={() => setVisualPrompt(idea)}
                  className="text-xs px-3 py-1.5 rounded-xl bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 hover:border-sky-400 cursor-pointer text-left"
                >
                  {idea}
                </button>
              ))}
            </div>

            {visualError && (
              <div className="px-4 py-3 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs font-semibold">
                {visualError}
              </div>
            )}
          </div>

          {visualLoading && (
            <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 text-center space-y-2">
              <div className="w-8 h-8 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin mx-auto" />
              <p className="text-sm font-bold">Creating your custom visual concept...</p>
              <p className="text-xs text-neutral-500">This usually takes a few seconds.</p>
            </div>
          )}

          {currentVisualResult && (
            <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-bold truncate">{visualPrompt}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentVisualResult(null)}
                    className="px-3.5 py-2 rounded-xl text-xs font-bold border border-neutral-200 dark:border-neutral-700 cursor-pointer"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveVisual}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
                  >
                    Save to Gallery
                  </button>
                </div>
              </div>
              <div className="aspect-video rounded-2xl overflow-hidden bg-neutral-950 max-h-[440px]">
                <img src={currentVisualResult} alt={visualPrompt} className="w-full h-full object-cover" />
              </div>
            </div>
          )}

          {goals.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {goals.map((g) => (
                <div
                  key={g.id}
                  className="rounded-3xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 group flex flex-col"
                >
                  <div className="relative aspect-video bg-neutral-950 overflow-hidden">
                    <img src={g.visualUrl} alt={g.title} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => deleteGoal(g.id)}
                      className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      aria-label="Remove concept"
                    >
                      &times;
                    </button>
                  </div>
                  <div className="p-4">
                    <p className="text-xs font-semibold line-clamp-2">{g.title}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================= PRINT & PDF EXPORT PREVIEW MODAL ================= */}
      {printPreviewHtml &&
        createPortal(
          <div
            className="fixed inset-0 z-[9998] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPrintPreviewHtml(null);
            }}
          >
            <div className="bg-white dark:bg-[#121216] border border-neutral-200 dark:border-neutral-800 rounded-3xl max-w-5xl w-full h-[88vh] flex flex-col overflow-hidden shadow-2xl">
              <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg font-extrabold text-neutral-900 dark:text-white">
                    Print &amp; PDF Deck Preview
                  </h3>
                  <p className="text-xs text-neutral-500">
                    Use Print / Save as PDF, or download a standalone printable file.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const frame = document.getElementById('vision-print-frame') as HTMLIFrameElement | null;
                      if (frame?.contentWindow) {
                        frame.contentWindow.focus();
                        frame.contentWindow.print();
                      }
                    }}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
                  >
                    Print / Save as PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const safeName = (boardTitle || 'vision-deck').replace(/[^a-zA-Z0-9_-]/g, '-');
                      triggerFileDownload(printPreviewHtml, `${safeName}-printable.html`, 'text/html');
                      showToast('Downloaded printable presentation file.');
                    }}
                    className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold cursor-pointer"
                  >
                    Download Printable HTML
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrintPreviewHtml(null)}
                    className="w-8 h-8 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-xs font-bold cursor-pointer"
                    aria-label="Close preview"
                  >
                    &times;
                  </button>
                </div>
              </div>
              <iframe
                id="vision-print-frame"
                title="Vision Deck Print Preview"
                srcDoc={printPreviewHtml}
                className="flex-1 w-full bg-neutral-100"
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default GoalVisualizer;