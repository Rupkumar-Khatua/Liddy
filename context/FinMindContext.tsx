import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  Transaction,
  Goal,
  AppState,
  Invoice,
  PlanTier,
  AnalyticsEventType,
  OrganizationRecord,
  HyperswitchPaymentRecord,
  IdeationBoardRecord,
  StockPortfolioState,
} from '../types';
import { auth, db, logout, OperationType, handleFirestoreError } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { SUPPORTED_LANGUAGES, getTranslation, triggerGlobalTranslation } from '../services/localization';
import { shouldShowAdsForPlan } from '../utils/financeMath';

export interface LiddyUser {
  uid?: string;
  displayName: string;
  email: string;
  photoURL?: string;
  isGuest?: boolean;
}

export type ThemeMode = 'system' | 'light' | 'dark';
export type CurrencyPlacement = 'after' | 'before';

export const PLATFORM_OWNER_EMAIL = 'rupk03793@gmail.com';

interface FinMindContextType extends AppState {
  currentUser: LiddyUser | null;
  isAdminUser: boolean;
  isAuthModalOpen: boolean;
  authModalReason: string;
  openAuthModal: (reason?: string) => void;
  closeAuthModal: () => void;
  loginUser: (user: LiddyUser) => void;
  logoutUser: () => Promise<void>;
  trackEngagement: (featureName?: string) => void;
  isGuestTrialExpired: () => boolean;
  remainingGuestMinutes: number;
  engagementCount: number;

  // Monetization, Payments & Entitlements
  planTier: PlanTier;
  adFree: boolean;
  showAds: boolean;
  organizationId: string;
  payments: HyperswitchPaymentRecord[];
  upgradePlan: (tier: PlanTier) => Promise<void>;
  recordGatewayPayment: (payment: HyperswitchPaymentRecord) => Promise<void>;
  logAnalyticsEvent: (
    eventType: AnalyticsEventType,
    featureWindow: string,
    metadata?: string,
    revenueImpactUsd?: number
  ) => Promise<void>;

  // Vision Collaboration & Ideation Boards
  saveIdeationBoard: (
    board: IdeationBoardRecord
  ) => Promise<{ ok: boolean; syncedToCloud: boolean; error?: string }>;
  loadIdeationBoards: () => Promise<IdeationBoardRecord[]>;

  // Admin Organization, Users & Payments Operations
  organizations: OrganizationRecord[];
  createOrganization: (org: Omit<OrganizationRecord, 'orgId' | 'createdAt' | 'updatedAt' | 'ownerUserId'>) => Promise<OrganizationRecord | null>;
  updateOrganization: (orgId: string, updates: Partial<OrganizationRecord>) => Promise<void>;
  deleteOrganization: (orgId: string) => Promise<void>;
  refreshOrganizations: () => Promise<void>;
  fetchAdminUsers: () => Promise<Array<{ userId: string; displayName: string; email?: string; createdAt?: string; updatedAt?: string }>>;
  fetchAdminPayments: () => Promise<HyperswitchPaymentRecord[]>;

  // Transactions & Invoices Operations
  addTransaction: (t: Omit<Transaction, 'id' | 'status'> & { status?: 'completed' | 'pending' }) => void;
  updateTransaction: (id: string, updates: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;
  clearAllTransactions: () => void;
  resetAllData: () => void;
  clearAllData: () => void;

  addInvoice: (
    inv: Omit<Invoice, 'id' | 'paymentStatus'> & {
      paymentStatus?: 'unpaid' | 'paid' | 'pending';
      paidAt?: string;
    }
  ) => Invoice;
  updateInvoice: (id: string, updates: Partial<Invoice>) => void;
  deleteInvoice: (id: string) => void;
  markInvoicePaid: (id: string, paymentMethod?: string, upiRef?: string) => void;

  addGoal: (g: Omit<Goal, 'id' | 'createdAt'>) => void;
  deleteGoal: (id: string) => void;
  addToWatchlist: (ticker: string) => void;
  removeFromWatchlist: (ticker: string) => void;

  // Connected Stock Broking Portfolio
  stockPortfolio: StockPortfolioState;
  updateStockPortfolio: (next: StockPortfolioState) => Promise<void>;

  // Currency & Formatting
  currencySymbol: string;
  setCurrencySymbol: (sym: string) => void;
  currencyPlacement: CurrencyPlacement;
  setCurrencyPlacement: (placement: CurrencyPlacement) => void;
  formatAmount: (amount: number) => string;

  // Language & Localization
  currentLanguage: string;
  setLanguage: (code: string) => void;
  t: (key: string, defaultText?: string) => string;

  // Settings & Theme
  isSettingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  highContrast: boolean;
  setHighContrast: (val: boolean) => void;
  reducedMotion: boolean;
  setReducedMotion: (val: boolean) => void;
}

const FinMindContext = createContext<FinMindContextType | undefined>(undefined);

const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'NVDA', 'RELIANCE', 'TCS', 'AAPL'];

function sanitizeDocId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned || `id_${Date.now()}`;
}

function buildTransactionPayload(userId: string, t: Transaction, isCreate: boolean) {
  const payload: Record<string, any> = {
    userId,
    date: String(t.date || new Date().toISOString().split('T')[0]).slice(0, 32),
    merchant: String(t.merchant || 'Merchant').slice(0, 160),
    amount: Math.max(0, Math.min(1000000000, Number(t.amount) || 0)),
    category: String(t.category || 'General').slice(0, 80),
    status: t.status === 'pending' ? 'pending' : 'completed',
    updatedAt: serverTimestamp(),
  };
  if (isCreate) {
    payload.createdAt = serverTimestamp();
  }
  if (t.paymentMethod && ['UPI', 'CARD', 'CASH', 'SCAN_RECEIPT', 'INVOICE'].includes(t.paymentMethod)) {
    payload.paymentMethod = t.paymentMethod;
  }
  if (t.invoiceId) payload.invoiceId = String(t.invoiceId).slice(0, 128);
  if (t.upiReference) payload.upiReference = String(t.upiReference).slice(0, 200);
  if (t.notes) payload.notes = String(t.notes).slice(0, 500);
  return payload;
}

function buildInvoicePayload(userId: string, inv: Invoice, isCreate: boolean) {
  const validIndustries = ['RETAIL', 'TECH', 'DINING', 'HEALTHCARE', 'SERVICES'];
  const industry = validIndustries.includes(inv.industry) ? inv.industry : 'SERVICES';
  const items = Array.isArray(inv.items) && inv.items.length > 0
    ? inv.items.slice(0, 50).map((it) => ({
        id: String(it.id || `item-${Date.now()}`),
        description: String(it.description || 'Item').slice(0, 300),
        quantity: Math.max(0, Number(it.quantity) || 1),
        unitPrice: Math.max(0, Number(it.unitPrice) || 0),
        discountPercent: Math.max(0, Number(it.discountPercent) || 0),
        taxPercent: Math.max(0, Number(it.taxPercent) || 0),
        total: Math.max(0, Number(it.total) || 0),
      }))
    : [{ id: 'item-1', description: 'Service Charge', quantity: 1, unitPrice: Math.max(0, Number(inv.grandTotal) || 0), total: Math.max(0, Number(inv.grandTotal) || 0) }];

  const payload: Record<string, any> = {
    userId,
    invoiceNumber: String(inv.invoiceNumber || `INV-${Date.now()}`).slice(0, 64),
    date: String(inv.date || new Date().toISOString().split('T')[0]).slice(0, 32),
    clientName: String(inv.clientName || 'Client').slice(0, 160),
    industry,
    items,
    subtotal: Math.max(0, Number(inv.subtotal) || 0),
    taxTotal: Math.max(0, Number(inv.taxTotal) || 0),
    discountTotal: Math.max(0, Number(inv.discountTotal) || 0),
    grandTotal: Math.max(0, Number(inv.grandTotal) || 0),
    currency: String(inv.currency || '₹').slice(0, 12),
    paymentStatus: ['unpaid', 'paid', 'pending'].includes(inv.paymentStatus) ? inv.paymentStatus : 'unpaid',
    updatedAt: serverTimestamp(),
  };
  if (isCreate) payload.createdAt = serverTimestamp();
  if (inv.dueDate) payload.dueDate = String(inv.dueDate).slice(0, 32);
  if (inv.senderName) payload.senderName = String(inv.senderName).slice(0, 160);
  if (inv.senderDetails) payload.senderDetails = String(inv.senderDetails).slice(0, 400);
  if (inv.senderTaxId) payload.senderTaxId = String(inv.senderTaxId).slice(0, 64);
  if (inv.clientDetails) payload.clientDetails = String(inv.clientDetails).slice(0, 400);
  if (inv.clientEmail) payload.clientEmail = String(inv.clientEmail).slice(0, 254);
  if (inv.clientTaxId) payload.clientTaxId = String(inv.clientTaxId).slice(0, 64);
  if (inv.templateStyle && ['classic', 'minimal', 'corporate'].includes(inv.templateStyle)) {
    payload.templateStyle = inv.templateStyle;
  }
  if (inv.paperFormat && ['a4', 'letter', 'thermal80'].includes(inv.paperFormat)) {
    payload.paperFormat = inv.paperFormat;
  }
  if (inv.notes) payload.notes = String(inv.notes).slice(0, 600);
  if (inv.upiId) payload.upiId = String(inv.upiId).slice(0, 120);
  if (inv.payeeName) payload.payeeName = String(inv.payeeName).slice(0, 120);
  if (inv.paidAt) payload.paidAt = String(inv.paidAt).slice(0, 64);
  return payload;
}

export const FinMindProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<LiddyUser | null>(() => {
    try {
      const saved = localStorage.getItem('liddy_user_session');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [isAdminDocVerified, setIsAdminDocVerified] = useState(false);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalReason, setAuthModalReason] = useState('Liddy Workspace');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Plan & Monetization Preferences
  const [planTier, setPlanTierState] = useState<PlanTier>(() => {
    const saved = localStorage.getItem('liddy_plan_tier');
    return saved === 'pro' || saved === 'team' ? saved : 'free';
  });
  const [adFree, setAdFreeState] = useState<boolean>(() => {
    return localStorage.getItem('liddy_ad_free') === 'true';
  });
  const [organizationId, setOrganizationIdState] = useState<string>(() => {
    return localStorage.getItem('liddy_org_id') || '';
  });
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const [payments, setPayments] = useState<HyperswitchPaymentRecord[]>(() => {
    try {
      const saved = localStorage.getItem('liddy_gateway_payments');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Settings: Theme & Accessibility
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    return (localStorage.getItem('liddy_theme_mode') as ThemeMode) || 'system';
  });

  const [highContrast, setHighContrastState] = useState<boolean>(() => {
    return localStorage.getItem('liddy_high_contrast') === 'true';
  });

  const [reducedMotion, setReducedMotionState] = useState<boolean>(() => {
    return localStorage.getItem('liddy_reduced_motion') === 'true';
  });

  // Settings: Currency
  const [currencySymbol, setCurrencySymbolState] = useState<string>(() => {
    return localStorage.getItem('liddy_currency_symbol') || '₹';
  });

  const [currencyPlacement, setCurrencyPlacementState] = useState<CurrencyPlacement>(() => {
    return (localStorage.getItem('liddy_currency_placement') as CurrencyPlacement) || 'after';
  });

  // Language & Localization
  const [currentLanguage, setCurrentLanguageState] = useState<string>(() => {
    return localStorage.getItem('liddy_language') || 'en';
  });

  // Ledger state: strictly zero baseline until real transactions/invoices/goals are created
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    try {
      const saved = localStorage.getItem('finmind_transactions');
      if (saved) {
        const parsed: Transaction[] = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter(t => t && !t.id?.startsWith('tx_init_'));
        }
      }
      return [];
    } catch {
      return [];
    }
  });

  const [invoices, setInvoices] = useState<Invoice[]>(() => {
    try {
      const saved = localStorage.getItem('finmind_invoices');
      if (saved) {
        const parsed: Invoice[] = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter(inv => inv && !inv.id?.startsWith('inv_init_'));
        }
      }
      return [];
    } catch {
      return [];
    }
  });

  const [goals, setGoals] = useState<Goal[]>(() => {
    try {
      const saved = localStorage.getItem('finmind_goals');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('finmind_watchlist');
      return saved ? JSON.parse(saved) : DEFAULT_WATCHLIST;
    } catch {
      return DEFAULT_WATCHLIST;
    }
  });

  const [stockPortfolio, setStockPortfolio] = useState<StockPortfolioState>(() => {
    try {
      const saved = localStorage.getItem('liddy_stock_portfolio');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.brokerName === 'string') return parsed;
      }
    } catch {}
    return {
      brokerName: 'Zerodha Kite',
      totalValue: 0,
      totalInvested: 0,
      currency: '₹',
      notes: '',
      holdings: [],
      updatedAt: new Date().toISOString(),
    };
  });

  const isAdminUser = Boolean(
    (!currentUser?.isGuest && currentUser?.email?.toLowerCase() === PLATFORM_OWNER_EMAIL) ||
    isAdminDocVerified
  );

  const showAds = shouldShowAdsForPlan(planTier, adFree);

  const prefStateRef = useRef({
    watchlist,
    currencySymbol,
    currencyPlacement,
    themeMode,
    currentLanguage,
    planTier,
    adFree,
    organizationId,
  });
  prefStateRef.current = {
    watchlist,
    currencySymbol,
    currencyPlacement,
    themeMode,
    currentLanguage,
    planTier,
    adFree,
    organizationId,
  };

  const localDataRef = useRef({ transactions, invoices, goals });
  localDataRef.current = { transactions, invoices, goals };

  const syncPreferencesToCloud = useCallback(async (uid: string, overrides?: Partial<typeof prefStateRef.current>) => {
    const nextPrefs = { ...prefStateRef.current, ...overrides };
    const path = `users/${uid}/preferences/settings`;
    try {
      await setDoc(doc(db, 'users', uid, 'preferences', 'settings'), {
        userId: uid,
        watchlist: nextPrefs.watchlist.slice(0, 40),
        currencySymbol: nextPrefs.currencySymbol.slice(0, 8),
        currencyPlacement: nextPrefs.currencyPlacement,
        themeMode: nextPrefs.themeMode,
        currentLanguage: nextPrefs.currentLanguage.slice(0, 16),
        planTier: nextPrefs.planTier,
        adFree: Boolean(nextPrefs.adFree),
        ...(nextPrefs.organizationId ? { organizationId: nextPrefs.organizationId.slice(0, 128) } : {}),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, path);
      } catch {}
    }
  }, []);

  const logAnalyticsEvent = useCallback(
    async (
      eventType: AnalyticsEventType,
      featureWindow: string,
      metadata?: string,
      revenueImpactUsd = 0
    ) => {
      const userId = firebaseUid || currentUser?.uid || 'guest';
      // Always track to backend runtime telemetry
      fetch('/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType,
          featureWindow,
          userId,
          organizationId: organizationId || undefined,
          metadata,
          revenueImpactUsd,
        }),
      }).catch(() => {});

      // Mirror to Firestore analytics_events when signed in
      if (firebaseUid) {
        const eventId = sanitizeDocId(`evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
        const path = `analytics_events/${eventId}`;
        try {
          await setDoc(doc(db, 'analytics_events', eventId), {
            eventType,
            featureWindow: featureWindow.slice(0, 64),
            userId: firebaseUid,
            ...(organizationId ? { organizationId: organizationId.slice(0, 128) } : {}),
            ...(metadata ? { metadata: metadata.slice(0, 300) } : {}),
            revenueImpactUsd: Math.max(0, Number(revenueImpactUsd) || 0),
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.CREATE, path);
          } catch {}
        }
      }
    },
    [firebaseUid, currentUser?.uid, organizationId]
  );

  const upgradePlan = useCallback(
    async (tier: PlanTier) => {
      const nextAdFree = tier !== 'free';
      setPlanTierState(tier);
      setAdFreeState(nextAdFree);
      localStorage.setItem('liddy_plan_tier', tier);
      localStorage.setItem('liddy_ad_free', nextAdFree ? 'true' : 'false');

      if (firebaseUid) {
        await syncPreferencesToCloud(firebaseUid, { planTier: tier, adFree: nextAdFree });
      }
      const priceUsd = tier === 'pro' ? 12 : tier === 'team' ? 29 : 0;
      await logAnalyticsEvent('pro_upgrade', 'pricing', `plan:${tier}`, priceUsd);
    },
    [firebaseUid, syncPreferencesToCloud, logAnalyticsEvent]
  );

  const recordGatewayPayment = useCallback(
    async (payment: HyperswitchPaymentRecord) => {
      const safeId = sanitizeDocId(payment.paymentId);
      const effectiveUserId = firebaseUid || payment.userId || currentUser?.uid || 'guest';
      const normalized: HyperswitchPaymentRecord = {
        ...payment,
        paymentId: safeId,
        userId: effectiveUserId,
        userEmail: payment.userEmail || currentUser?.email || undefined,
        userName: payment.userName || currentUser?.displayName || undefined,
      };

      setPayments((prev) => {
        const next = [normalized, ...prev.filter((p) => p.paymentId !== safeId)].slice(0, 100);
        try {
          localStorage.setItem('liddy_gateway_payments', JSON.stringify(next));
        } catch {}
        return next;
      });

      if (firebaseUid) {
        const path = `payments/${safeId}`;
        try {
          await setDoc(doc(db, 'payments', safeId), {
            paymentId: safeId,
            userId: firebaseUid,
            ...(normalized.userEmail ? { userEmail: normalized.userEmail.slice(0, 254) } : {}),
            ...(normalized.userName ? { userName: normalized.userName.slice(0, 120) } : {}),
            planTier: normalized.planTier,
            billingCycle: normalized.billingCycle,
            region: normalized.region,
            currency: normalized.currency,
            amount: Math.max(0, Number(normalized.amount) || 0),
            amountUsdEquivalent: Math.max(0, Number(normalized.amountUsdEquivalent) || 0),
            paymentRail: normalized.paymentRail,
            connector: String(normalized.connector || 'hyperswitch').slice(0, 80),
            status: normalized.status,
            referenceCode: String(normalized.referenceCode || safeId).slice(0, 120),
            createdAt: serverTimestamp(),
          });
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.CREATE, path);
          } catch {}
        }
      }

      if (normalized.status === 'succeeded') {
        const nextAdFree = normalized.planTier !== 'free';
        setPlanTierState(normalized.planTier);
        setAdFreeState(nextAdFree);
        localStorage.setItem('liddy_plan_tier', normalized.planTier);
        localStorage.setItem('liddy_ad_free', nextAdFree ? 'true' : 'false');
        if (firebaseUid) {
          await syncPreferencesToCloud(firebaseUid, { planTier: normalized.planTier, adFree: nextAdFree });
        }
        await logAnalyticsEvent(
          'pro_upgrade',
          'pricing',
          `hyperswitch:${normalized.region}:${normalized.paymentRail}:${normalized.planTier}`,
          normalized.amountUsdEquivalent
        );
      }
    },
    [firebaseUid, currentUser, syncPreferencesToCloud, logAnalyticsEvent]
  );

  const saveIdeationBoard = useCallback(
    async (
      board: IdeationBoardRecord
    ): Promise<{ ok: boolean; syncedToCloud: boolean; error?: string }> => {
      const stripUndefined = <T,>(val: T): T => {
        if (Array.isArray(val)) {
          return val.map((item) => stripUndefined(item)) as unknown as T;
        }
        if (val && typeof val === 'object') {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
            if (v !== undefined) {
              out[k] = stripUndefined(v);
            }
          }
          return out as T;
        }
        return val;
      };

      const rawId = sanitizeDocId(board.boardId);
      const safeId = /^[a-zA-Z0-9_-]{1,128}$/.test(rawId)
        ? rawId
        : `board-${Date.now().toString(36)}`;
      const ownerId = firebaseUid || currentUser?.uid || board.ownerUserId || 'local-user';
      const cleanNodes = stripUndefined(
        (board.nodes || []).slice(0, 150).map((n) => ({
          id: String(n.id || `n-${Date.now().toString(36)}`).slice(0, 64),
          label: String(n.label || 'Untitled Node').slice(0, 160),
          notes: String(n.notes || '').slice(0, 500),
          x: Number.isFinite(n.x) ? Math.round(n.x) : 200,
          y: Number.isFinite(n.y) ? Math.round(n.y) : 160,
          color: n.color || 'indigo',
          shape: n.shape || 'insight',
          metricTag: n.metricTag ? String(n.metricTag).slice(0, 48) : '',
          parentId: n.parentId ?? null,
          author: n.author ? String(n.author).slice(0, 64) : '',
        }))
      );
      const cleanSlides = stripUndefined(
        (board.slides || []).slice(0, 40).map((s) => ({
          id: String(s.id || `s-${Date.now().toString(36)}`).slice(0, 64),
          title: String(s.title || 'Untitled Slide').slice(0, 160),
          subtitle: s.subtitle ? String(s.subtitle).slice(0, 200) : '',
          bullets: Array.isArray(s.bullets)
            ? s.bullets.map((b) => String(b || '').slice(0, 240)).filter(Boolean).slice(0, 8)
            : [],
          layout: s.layout || 'two-col',
          theme: s.theme || 'midnight',
          metricHighlight: s.metricHighlight ? String(s.metricHighlight).slice(0, 64) : '',
        }))
      );
      const cleanNotes = stripUndefined(
        (board.meetingNotes || []).slice(0, 200).map((m) => ({
          id: String(m.id || `note-${Date.now().toString(36)}`).slice(0, 64),
          author: String(m.author || 'Member').slice(0, 80),
          text: String(m.text || '').slice(0, 600),
          kind: m.kind || 'note',
          createdAt: String(m.createdAt || new Date().toISOString()),
        }))
      );

      const normalized: IdeationBoardRecord = {
        boardId: safeId,
        title: String(board.title || 'Strategy Board').trim().slice(0, 160) || 'Strategy Board',
        roomCode: String(board.roomCode || 'ROOM-101').trim().slice(0, 40) || 'ROOM-101',
        ownerUserId: ownerId,
        nodes: cleanNodes,
        slides: cleanSlides,
        meetingNotes: cleanNotes,
        updatedAt: new Date().toISOString(),
      };

      let localSaved = false;
      try {
        const savedRaw = localStorage.getItem('liddy_ideation_boards');
        const list: IdeationBoardRecord[] = savedRaw ? JSON.parse(savedRaw) : [];
        const updated = [normalized, ...list.filter((b) => b.boardId !== safeId)].slice(0, 25);
        localStorage.setItem('liddy_ideation_boards', JSON.stringify(updated));
        localSaved = true;
      } catch {}

      if (firebaseUid) {
        const path = `ideation_boards/${safeId}`;
        try {
          await setDoc(doc(db, 'ideation_boards', safeId), {
            boardId: safeId,
            title: normalized.title,
            roomCode: normalized.roomCode,
            ownerUserId: firebaseUid,
            nodes: cleanNodes,
            slides: cleanSlides,
            meetingNotes: cleanNotes,
            updatedAt: serverTimestamp(),
          });
          return { ok: true, syncedToCloud: true };
        } catch (err: any) {
          try {
            handleFirestoreError(err, OperationType.WRITE, path);
          } catch (formattedErr: any) {
            return {
              ok: localSaved,
              syncedToCloud: false,
              error: formattedErr?.message || err?.message || 'Cloud sync failed',
            };
          }
          return {
            ok: localSaved,
            syncedToCloud: false,
            error: err?.message || 'Cloud sync failed',
          };
        }
      }

      return { ok: localSaved, syncedToCloud: false };
    },
    [firebaseUid, currentUser?.uid]
  );

  const loadIdeationBoards = useCallback(async (): Promise<IdeationBoardRecord[]> => {
    let localBoards: IdeationBoardRecord[] = [];
    try {
      const savedRaw = localStorage.getItem('liddy_ideation_boards');
      if (savedRaw) localBoards = JSON.parse(savedRaw);
    } catch {}

    if (!firebaseUid) return localBoards;

    try {
      const snap = await getDocs(
        query(collection(db, 'ideation_boards'), where('ownerUserId', '==', firebaseUid), limit(20))
      );
      const cloudBoards: IdeationBoardRecord[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          boardId: data.boardId || d.id,
          title: data.title || 'Vision Board',
          roomCode: data.roomCode || 'ROOM-101',
          ownerUserId: data.ownerUserId || firebaseUid,
          nodes: Array.isArray(data.nodes) ? data.nodes : [],
          slides: Array.isArray(data.slides) ? data.slides : [],
          meetingNotes: Array.isArray(data.meetingNotes) ? data.meetingNotes : [],
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : new Date().toISOString(),
        };
      });
      const byId = new Map<string, IdeationBoardRecord>();
      localBoards.forEach((b) => byId.set(b.boardId, b));
      cloudBoards.forEach((b) => byId.set(b.boardId, b));
      return Array.from(byId.values());
    } catch {
      return localBoards;
    }
  }, [firebaseUid]);

  const fetchAdminUsers = useCallback(async () => {
    if (!firebaseUid || !isAdminUser) return [];
    try {
      const snap = await getDocs(query(collection(db, 'users'), limit(100)));
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          userId: data.userId || d.id,
          displayName: data.displayName || 'Member',
          email: data.email,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : undefined,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : undefined,
        };
      });
    } catch {
      return [];
    }
  }, [firebaseUid, isAdminUser]);

  const fetchAdminPayments = useCallback(async (): Promise<HyperswitchPaymentRecord[]> => {
    const byId = new Map<string, HyperswitchPaymentRecord>();
    payments.forEach((p) => byId.set(p.paymentId, p));

    try {
      const resp = await fetch('/api/payments/history');
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.payments)) {
          data.payments.forEach((p: HyperswitchPaymentRecord) => byId.set(p.paymentId, p));
        }
      }
    } catch {}

    if (firebaseUid && isAdminUser) {
      try {
        const snap = await getDocs(query(collection(db, 'payments'), orderBy('createdAt', 'desc'), limit(100)));
        snap.docs.forEach((d) => {
          const data = d.data();
          byId.set(data.paymentId || d.id, {
            paymentId: data.paymentId || d.id,
            userId: data.userId || 'user',
            userEmail: data.userEmail,
            userName: data.userName,
            planTier: data.planTier || 'pro',
            billingCycle: data.billingCycle || 'annual',
            region: data.region || 'INTL',
            currency: data.currency || 'USD',
            amount: Number(data.amount) || 0,
            amountUsdEquivalent: Number(data.amountUsdEquivalent) || 0,
            paymentRail: data.paymentRail || 'CARD',
            connector: data.connector || 'hyperswitch',
            status: data.status || 'succeeded',
            referenceCode: data.referenceCode || d.id,
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
          });
        });
      } catch {}
    }

    return Array.from(byId.values()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [payments, firebaseUid, isAdminUser]);

  const refreshOrganizations = useCallback(async () => {
    try {
      const resp = await fetch('/api/analytics/organizations');
      if (resp.ok) {
        const json = await resp.json();
        if (Array.isArray(json.organizations)) {
          setOrganizations(json.organizations);
        }
      }
    } catch {}

    if (firebaseUid && isAdminUser) {
      try {
        const snap = await getDocs(
          query(collection(db, 'organizations'), orderBy('updatedAt', 'desc'), limit(50))
        );
        const cloudOrgs: OrganizationRecord[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            orgId: data.orgId || d.id,
            name: data.name || 'Workspace',
            industry: data.industry || 'Solo Studio',
            planTier: data.planTier || 'pro',
            seatCount: Number(data.seatCount) || 1,
            monthlyRevenueUsd: Number(data.monthlyRevenueUsd) || 0,
            status: data.status || 'active',
            ownerUserId: data.ownerUserId || firebaseUid,
            billingEmail: data.billingEmail,
            notes: data.notes,
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
            updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : new Date().toISOString(),
          };
        });
        if (cloudOrgs.length > 0) {
          setOrganizations((prev) => {
            const byId = new Map(prev.map((o) => [o.orgId, o]));
            cloudOrgs.forEach((o) => byId.set(o.orgId, o));
            return Array.from(byId.values());
          });
        }
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.LIST, 'organizations');
        } catch {}
      }
    }
  }, [firebaseUid, isAdminUser]);

  const createOrganization = useCallback(
    async (
      input: Omit<OrganizationRecord, 'orgId' | 'createdAt' | 'updatedAt' | 'ownerUserId'>
    ): Promise<OrganizationRecord | null> => {
      const orgId = sanitizeDocId(`org-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`);
      const ownerId = firebaseUid || 'admin';
      const nowIso = new Date().toISOString();
      const record: OrganizationRecord = {
        ...input,
        orgId,
        ownerUserId: ownerId,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      try {
        await fetch('/api/analytics/organizations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        });
      } catch {}

      if (firebaseUid) {
        const path = `organizations/${orgId}`;
        try {
          await setDoc(doc(db, 'organizations', orgId), {
            orgId,
            name: record.name.slice(0, 160),
            industry: record.industry.slice(0, 80),
            planTier: record.planTier,
            seatCount: Math.max(1, Number(record.seatCount) || 1),
            monthlyRevenueUsd: Math.max(0, Number(record.monthlyRevenueUsd) || 0),
            status: record.status,
            ownerUserId: ownerId,
            ...(record.billingEmail ? { billingEmail: record.billingEmail.slice(0, 254) } : {}),
            ...(record.notes ? { notes: record.notes.slice(0, 500) } : {}),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.CREATE, path);
          } catch {}
        }
      }

      setOrganizations((prev) => [record, ...prev]);
      await logAnalyticsEvent('org_created', 'admin', record.name, record.monthlyRevenueUsd);
      return record;
    },
    [firebaseUid, logAnalyticsEvent]
  );

  const updateOrganization = useCallback(
    async (orgId: string, updates: Partial<OrganizationRecord>) => {
      const safeId = sanitizeDocId(orgId);
      setOrganizations((prev) =>
        prev.map((o) => (o.orgId === safeId ? { ...o, ...updates, updatedAt: new Date().toISOString() } : o))
      );

      try {
        await fetch(`/api/analytics/organizations/${encodeURIComponent(safeId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
      } catch {}

      if (firebaseUid) {
        const path = `organizations/${safeId}`;
        try {
          const payload: Record<string, any> = { updatedAt: serverTimestamp() };
          if (updates.name !== undefined) payload.name = String(updates.name).slice(0, 160);
          if (updates.industry !== undefined) payload.industry = String(updates.industry).slice(0, 80);
          if (updates.planTier !== undefined) payload.planTier = updates.planTier;
          if (updates.seatCount !== undefined) payload.seatCount = Math.max(1, Number(updates.seatCount) || 1);
          if (updates.monthlyRevenueUsd !== undefined) payload.monthlyRevenueUsd = Math.max(0, Number(updates.monthlyRevenueUsd) || 0);
          if (updates.status !== undefined) payload.status = updates.status;
          if (updates.billingEmail !== undefined) payload.billingEmail = String(updates.billingEmail).slice(0, 254);
          if (updates.notes !== undefined) payload.notes = String(updates.notes).slice(0, 500);
          await updateDoc(doc(db, 'organizations', safeId), payload);
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.UPDATE, path);
          } catch {}
        }
      }
    },
    [firebaseUid]
  );

  const deleteOrganization = useCallback(
    async (orgId: string) => {
      const safeId = sanitizeDocId(orgId);
      setOrganizations((prev) => prev.filter((o) => o.orgId !== safeId));
      try {
        await fetch(`/api/analytics/organizations/${encodeURIComponent(safeId)}`, {
          method: 'DELETE',
        });
      } catch {}

      if (firebaseUid) {
        const path = `organizations/${safeId}`;
        try {
          await deleteDoc(doc(db, 'organizations', safeId));
        } catch (err) {
          try {
            handleFirestoreError(err, OperationType.DELETE, path);
          } catch {}
        }
      }
    },
    [firebaseUid]
  );

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    localStorage.setItem('liddy_theme_mode', mode);
    if (firebaseUid) syncPreferencesToCloud(firebaseUid, { themeMode: mode });
  };

  const setHighContrast = (val: boolean) => {
    setHighContrastState(val);
    localStorage.setItem('liddy_high_contrast', val ? 'true' : 'false');
  };

  const setReducedMotion = (val: boolean) => {
    setReducedMotionState(val);
    localStorage.setItem('liddy_reduced_motion', val ? 'true' : 'false');
  };

  const setCurrencySymbol = (sym: string) => {
    setCurrencySymbolState(sym);
    localStorage.setItem('liddy_currency_symbol', sym);
    if (firebaseUid) syncPreferencesToCloud(firebaseUid, { currencySymbol: sym });
  };

  const setCurrencyPlacement = (placement: CurrencyPlacement) => {
    setCurrencyPlacementState(placement);
    localStorage.setItem('liddy_currency_placement', placement);
    if (firebaseUid) syncPreferencesToCloud(firebaseUid, { currencyPlacement: placement });
  };

  const setLanguage = (code: string) => {
    setCurrentLanguageState(code);
    localStorage.setItem('liddy_language', code);
    triggerGlobalTranslation(code);
    const targetLang = SUPPORTED_LANGUAGES.find(l => l.code === code);
    document.documentElement.dir = targetLang?.dir || 'ltr';
    if (firebaseUid) syncPreferencesToCloud(firebaseUid, { currentLanguage: code });
  };

  useEffect(() => {
    if (currentLanguage && currentLanguage !== 'en') {
      triggerGlobalTranslation(currentLanguage);
    }
  }, []);

  const t = useCallback((key: string, defaultText?: string) => {
    return getTranslation(key, currentLanguage, defaultText);
  }, [currentLanguage]);

  // Sync HTML root element classes with theme selection
  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (isDark: boolean) => {
      if (isDark) root.classList.add('dark');
      else root.classList.remove('dark');
    };

    if (themeMode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mediaQuery.matches);
      const listener = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    } else {
      applyTheme(themeMode === 'dark');
    }
  }, [themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    if (highContrast) root.classList.add('high-contrast');
    else root.classList.remove('high-contrast');

    if (reducedMotion) root.classList.add('reduced-motion');
    else root.classList.remove('reduced-motion');
  }, [highContrast, reducedMotion]);

  // Sync with Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        const mappedUser: LiddyUser = {
          uid: firebaseUser.uid,
          displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Member',
          email: firebaseUser.email || '',
          photoURL: firebaseUser.photoURL || undefined,
          isGuest: false,
        };
        setCurrentUser(mappedUser);
        setFirebaseUid(firebaseUser.uid);
        localStorage.setItem('liddy_user_session', JSON.stringify(mappedUser));
        setIsAuthModalOpen(false);
      } else {
        setFirebaseUid(null);
        setIsAdminDocVerified(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Firestore Real-Time Cloud Sync when authenticated
  useEffect(() => {
    if (!firebaseUid) return;

    const uid = firebaseUid;
    let isCancelled = false;

    const bootstrapUserCloud = async () => {
      const profileRef = doc(db, 'users', uid);
      try {
        const snap = await getDoc(profileRef);
        const displayName = (auth.currentUser?.displayName || currentUser?.displayName || 'Member').slice(0, 120);
        const profilePayload: Record<string, any> = {
          userId: uid,
          displayName,
          updatedAt: serverTimestamp(),
        };
        if (auth.currentUser?.email) profilePayload.email = auth.currentUser.email.slice(0, 254);
        if (auth.currentUser?.photoURL) profilePayload.photoURL = auth.currentUser.photoURL.slice(0, 1024);

        if (!snap.exists()) {
          await setDoc(profileRef, {
            ...profilePayload,
            createdAt: serverTimestamp(),
          });
        } else {
          await updateDoc(profileRef, {
            displayName,
            ...(profilePayload.email ? { email: profilePayload.email } : {}),
            ...(profilePayload.photoURL ? { photoURL: profilePayload.photoURL } : {}),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
        } catch {}
      }

      // Check Firestore /admins/{uid} allowlist
      try {
        const adminSnap = await getDoc(doc(db, 'admins', uid));
        if (!isCancelled && adminSnap.exists()) {
          setIsAdminDocVerified(true);
        }
      } catch {}

      try {
        const prefRef = doc(db, 'users', uid, 'preferences', 'settings');
        const prefSnap = await getDoc(prefRef);
        if (!prefSnap.exists()) {
          await syncPreferencesToCloud(uid);
        }
      } catch {}

      try {
        const { transactions: localTx, invoices: localInv, goals: localGoals } = localDataRef.current;
        for (const tx of localTx.slice(0, 25)) {
          const safeId = sanitizeDocId(tx.id);
          const ref = doc(db, 'users', uid, 'transactions', safeId);
          const existing = await getDoc(ref);
          if (!existing.exists()) {
            await setDoc(ref, buildTransactionPayload(uid, tx, true));
          }
        }
        for (const inv of localInv.slice(0, 25)) {
          const safeId = sanitizeDocId(inv.id);
          const ref = doc(db, 'users', uid, 'invoices', safeId);
          const existing = await getDoc(ref);
          if (!existing.exists()) {
            await setDoc(ref, buildInvoicePayload(uid, inv, true));
          }
        }
        for (const goal of localGoals.slice(0, 15)) {
          const safeId = sanitizeDocId(goal.id);
          const ref = doc(db, 'users', uid, 'goals', safeId);
          const existing = await getDoc(ref);
          if (!existing.exists() && goal.visualUrl && goal.visualUrl.length <= 700000) {
            await setDoc(ref, {
              userId: uid,
              title: String(goal.title || 'Goal').slice(0, 300),
              visualUrl: goal.visualUrl,
              type: goal.type === 'VIDEO' ? 'VIDEO' : 'IMAGE',
              createdAt: serverTimestamp(),
            });
          }
        }
      } catch {}
    };

    bootstrapUserCloud();

    const unsubPrefs = onSnapshot(
      doc(db, 'users', uid, 'preferences', 'settings'),
      (snap) => {
        if (isCancelled || !snap.exists()) return;
        const d = snap.data();
        if (Array.isArray(d.watchlist)) {
          setWatchlist(d.watchlist);
          localStorage.setItem('finmind_watchlist', JSON.stringify(d.watchlist));
        }
        if (typeof d.currencySymbol === 'string') {
          setCurrencySymbolState(d.currencySymbol);
          localStorage.setItem('liddy_currency_symbol', d.currencySymbol);
        }
        if (d.currencyPlacement === 'before' || d.currencyPlacement === 'after') {
          setCurrencyPlacementState(d.currencyPlacement);
          localStorage.setItem('liddy_currency_placement', d.currencyPlacement);
        }
        if (d.themeMode === 'system' || d.themeMode === 'light' || d.themeMode === 'dark') {
          setThemeModeState(d.themeMode);
          localStorage.setItem('liddy_theme_mode', d.themeMode);
        }
        if (typeof d.currentLanguage === 'string') {
          setCurrentLanguageState(d.currentLanguage);
          localStorage.setItem('liddy_language', d.currentLanguage);
        }
        if (d.planTier === 'free' || d.planTier === 'pro' || d.planTier === 'team') {
          setPlanTierState(d.planTier);
          localStorage.setItem('liddy_plan_tier', d.planTier);
        }
        if (typeof d.adFree === 'boolean') {
          setAdFreeState(d.adFree);
          localStorage.setItem('liddy_ad_free', d.adFree ? 'true' : 'false');
        }
        if (typeof d.organizationId === 'string') {
          setOrganizationIdState(d.organizationId);
          localStorage.setItem('liddy_org_id', d.organizationId);
        }
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.GET, `users/${uid}/preferences/settings`);
        } catch {}
      }
    );

    const txQuery = query(collection(db, 'users', uid, 'transactions'), where('userId', '==', uid));
    const unsubTx = onSnapshot(
      txQuery,
      (snap) => {
        if (isCancelled) return;
        const list: Transaction[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              date: data.date || new Date().toISOString().split('T')[0],
              merchant: data.merchant || 'Merchant',
              amount: Number(data.amount) || 0,
              category: data.category || 'General',
              status: data.status === 'pending' ? 'pending' : 'completed',
              paymentMethod: data.paymentMethod,
              invoiceId: data.invoiceId,
              upiReference: data.upiReference,
              notes: data.notes,
            } as Transaction;
          })
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setTransactions(list);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, `users/${uid}/transactions`);
        } catch {}
      }
    );

    const invQuery = query(collection(db, 'users', uid, 'invoices'), where('userId', '==', uid));
    const unsubInv = onSnapshot(
      invQuery,
      (snap) => {
        if (isCancelled) return;
        const list: Invoice[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              invoiceNumber: data.invoiceNumber,
              date: data.date,
              dueDate: data.dueDate,
              senderName: data.senderName || '',
              senderDetails: data.senderDetails,
              senderTaxId: data.senderTaxId,
              clientName: data.clientName,
              clientDetails: data.clientDetails,
              clientEmail: data.clientEmail,
              clientTaxId: data.clientTaxId,
              industry: data.industry || 'SERVICES',
              templateStyle: data.templateStyle || 'classic',
              paperFormat: data.paperFormat || 'a4',
              items: Array.isArray(data.items) ? data.items : [],
              subtotal: Number(data.subtotal) || 0,
              taxTotal: Number(data.taxTotal) || 0,
              discountTotal: Number(data.discountTotal) || 0,
              grandTotal: Number(data.grandTotal) || 0,
              currency: data.currency || '₹',
              notes: data.notes,
              upiId: data.upiId,
              payeeName: data.payeeName,
              paymentStatus: data.paymentStatus || 'unpaid',
              paidAt: data.paidAt,
            } as Invoice;
          })
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setInvoices(list);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, `users/${uid}/invoices`);
        } catch {}
      }
    );

    const goalsQuery = query(collection(db, 'users', uid, 'goals'), where('userId', '==', uid));
    const unsubGoals = onSnapshot(
      goalsQuery,
      (snap) => {
        if (isCancelled) return;
        const list: Goal[] = snap.docs.map((d) => {
          const data = d.data();
          const created = data.createdAt?.toDate ? data.createdAt.toDate() : new Date();
          return {
            id: d.id,
            title: data.title,
            visualUrl: data.visualUrl,
            type: data.type === 'VIDEO' ? 'VIDEO' : 'IMAGE',
            createdAt: created,
          };
        });
        setGoals(list);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, `users/${uid}/goals`);
        } catch {}
      }
    );

    const unsubPortfolio = onSnapshot(
      doc(db, 'users', uid, 'portfolio', 'main'),
      (snap) => {
        if (isCancelled || !snap.exists()) return;
        const d = snap.data();
        const synced: StockPortfolioState = {
          brokerName: d.brokerName || 'Zerodha Kite',
          totalValue: Number(d.totalValue) || 0,
          totalInvested: Number(d.totalInvested) || 0,
          currency: d.currency || '₹',
          notes: d.notes || '',
          holdings: Array.isArray(d.holdings) ? d.holdings : [],
          updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
        };
        setStockPortfolio(synced);
        localStorage.setItem('liddy_stock_portfolio', JSON.stringify(synced));
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.GET, `users/${uid}/portfolio/main`);
        } catch {}
      }
    );

    return () => {
      isCancelled = true;
      unsubPrefs();
      unsubTx();
      unsubInv();
      unsubGoals();
      unsubPortfolio();
    };
  }, [firebaseUid, syncPreferencesToCloud]);

  useEffect(() => {
    const handleAuthSync = (e: any) => {
      if (e?.detail !== undefined) {
        setCurrentUser(e.detail);
      } else {
        const saved = localStorage.getItem('liddy_user_session');
        setCurrentUser(saved ? JSON.parse(saved) : null);
      }
    };
    window.addEventListener('liddy_auth_change', handleAuthSync);
    window.addEventListener('storage', handleAuthSync);
    return () => {
      window.removeEventListener('liddy_auth_change', handleAuthSync);
      window.removeEventListener('storage', handleAuthSync);
    };
  }, []);

  const [engagementCount, setEngagementCount] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('liddy_engagement_count');
      return stored ? parseInt(stored, 10) || 0 : 0;
    } catch {
      return 0;
    }
  });

  const unlockScrollSafely = () => {
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('scroll'));
  };

  const loginUser = useCallback((user: LiddyUser) => {
    setCurrentUser(user);
    localStorage.setItem('liddy_user_session', JSON.stringify(user));
    setIsAuthModalOpen(false);
    unlockScrollSafely();
    window.dispatchEvent(new CustomEvent('liddy_auth_change', { detail: user }));
  }, []);

  const logoutUser = useCallback(async () => {
    await logout();
    setFirebaseUid(null);
    setCurrentUser(null);
    setIsAdminDocVerified(false);
    localStorage.removeItem('liddy_user_session');
    unlockScrollSafely();
    window.dispatchEvent(new CustomEvent('liddy_auth_change', { detail: null }));
  }, []);

  const openAuthModal = useCallback((reason?: string) => {
    if (reason) setAuthModalReason(reason);
    setIsAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
    unlockScrollSafely();
  }, []);

  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
    unlockScrollSafely();
  }, []);

  const GUEST_TRIAL_DURATION_MS = 30 * 60 * 1000;

  const getGuestSessionStart = useCallback((): number => {
    try {
      const stored = localStorage.getItem('liddy_guest_session_start');
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
      const now = Date.now();
      localStorage.setItem('liddy_guest_session_start', now.toString());
      return now;
    } catch {
      return Date.now();
    }
  }, []);

  const isGuestTrialExpired = useCallback((): boolean => {
    if (currentUser && !currentUser.isGuest) return false;
    const start = getGuestSessionStart();
    return Date.now() - start > GUEST_TRIAL_DURATION_MS;
  }, [currentUser, getGuestSessionStart]);

  const [remainingGuestMinutes, setRemainingGuestMinutes] = useState<number>(30);

  useEffect(() => {
    const updateRemaining = () => {
      if (currentUser && !currentUser.isGuest) {
        setRemainingGuestMinutes(30);
        return;
      }
      const start = getGuestSessionStart();
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, Math.ceil((GUEST_TRIAL_DURATION_MS - elapsed) / (60 * 1000)));
      setRemainingGuestMinutes(remaining);
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 30000);
    return () => clearInterval(interval);
  }, [currentUser, getGuestSessionStart]);

  const trackEngagement = useCallback((featureName?: string) => {
    if (!currentUser || currentUser.isGuest) {
      setEngagementCount((prev) => {
        const next = prev + 1;
        try {
          localStorage.setItem('liddy_engagement_count', next.toString());
        } catch {}

        if (next > 5 || isGuestTrialExpired()) {
          openAuthModal(featureName ? `Liddy Workspace: ${featureName}` : 'Unlock Cloud Sync');
        }
        return next;
      });
    }
  }, [currentUser, isGuestTrialExpired, openAuthModal]);

  const user = {
    name: currentUser?.displayName || 'Member',
    monthlyBudget: 0
  };

  useEffect(() => {
    localStorage.setItem('finmind_transactions', JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem('finmind_invoices', JSON.stringify(invoices));
  }, [invoices]);

  useEffect(() => {
    localStorage.setItem('finmind_goals', JSON.stringify(goals));
  }, [goals]);

  useEffect(() => {
    localStorage.setItem('finmind_watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  const formatAmount = useCallback((amount: number) => {
    const val = Number(amount) || 0;
    const formattedNum = val.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return currencyPlacement === 'after'
      ? `${formattedNum} ${currencySymbol}`
      : `${currencySymbol} ${formattedNum}`;
  }, [currencySymbol, currencyPlacement]);

  const addTransaction = (t: Omit<Transaction, 'id' | 'status'> & { status?: 'completed' | 'pending' }) => {
    const id = sanitizeDocId('tx-' + Date.now().toString() + '-' + Math.random().toString(36).substring(2, 6));
    const newTransaction: Transaction = {
      ...t,
      id,
      status: t.status || 'completed'
    };
    setTransactions(prev => [newTransaction, ...prev]);

    if (t.paymentMethod === 'SCAN_RECEIPT') {
      logAnalyticsEvent('ocr_scan', 'scanner', t.merchant, t.amount);
    }

    if (firebaseUid) {
      const path = `users/${firebaseUid}/transactions/${id}`;
      setDoc(doc(db, 'users', firebaseUid, 'transactions', id), buildTransactionPayload(firebaseUid, newTransaction, true))
        .catch((err) => {
          try {
            handleFirestoreError(err, OperationType.CREATE, path);
          } catch {}
        });
    }
  };

  const updateTransaction = (id: string, updates: Partial<Transaction>) => {
    const safeId = sanitizeDocId(id);
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));

    if (firebaseUid) {
      const allowedUpdates: Record<string, any> = { updatedAt: serverTimestamp() };
      if (updates.date !== undefined) allowedUpdates.date = String(updates.date).slice(0, 32);
      if (updates.merchant !== undefined) allowedUpdates.merchant = String(updates.merchant).slice(0, 160);
      if (updates.amount !== undefined) allowedUpdates.amount = Math.max(0, Number(updates.amount) || 0);
      if (updates.category !== undefined) allowedUpdates.category = String(updates.category).slice(0, 80);
      if (updates.status !== undefined) allowedUpdates.status = updates.status;
      if (updates.paymentMethod !== undefined) allowedUpdates.paymentMethod = updates.paymentMethod;
      if (updates.upiReference !== undefined) allowedUpdates.upiReference = String(updates.upiReference).slice(0, 200);
      if (updates.notes !== undefined) allowedUpdates.notes = String(updates.notes).slice(0, 500);

      const path = `users/${firebaseUid}/transactions/${safeId}`;
      updateDoc(doc(db, 'users', firebaseUid, 'transactions', safeId), allowedUpdates)
        .catch((err) => {
          try {
            handleFirestoreError(err, OperationType.UPDATE, path);
          } catch {}
        });
    }
  };

  const deleteTransaction = (id: string) => {
    const safeId = sanitizeDocId(id);
    setTransactions(prev => prev.filter(t => t.id !== id));

    if (firebaseUid) {
      const path = `users/${firebaseUid}/transactions/${safeId}`;
      deleteDoc(doc(db, 'users', firebaseUid, 'transactions', safeId))
        .catch((err) => {
          try {
            handleFirestoreError(err, OperationType.DELETE, path);
          } catch {}
        });
    }
  };

  const clearAllTransactions = () => {
    const toDelete = [...transactions];
    setTransactions([]);
    localStorage.setItem('finmind_transactions', JSON.stringify([]));

    if (firebaseUid && toDelete.length > 0) {
      const batch = writeBatch(db);
      toDelete.forEach((tx) => {
        batch.delete(doc(db, 'users', firebaseUid, 'transactions', sanitizeDocId(tx.id)));
      });
      batch.commit().catch((err) => {
        try {
          handleFirestoreError(err, OperationType.DELETE, `users/${firebaseUid}/transactions`);
        } catch {}
      });
    }
  };

  const resetAllData = () => {
    const txCopy = [...transactions];
    const invCopy = [...invoices];
    setTransactions([]);
    setInvoices([]);
    localStorage.setItem('finmind_transactions', JSON.stringify([]));
    localStorage.setItem('finmind_invoices', JSON.stringify([]));

    if (firebaseUid && (txCopy.length > 0 || invCopy.length > 0)) {
      const batch = writeBatch(db);
      txCopy.forEach((tx) => batch.delete(doc(db, 'users', firebaseUid, 'transactions', sanitizeDocId(tx.id))));
      invCopy.forEach((inv) => batch.delete(doc(db, 'users', firebaseUid, 'invoices', sanitizeDocId(inv.id))));
      batch.commit().catch(() => {});
    }
  };

  const clearAllData = useCallback(() => {
    const uid = firebaseUid;
    const txCopy = [...localDataRef.current.transactions];
    const invCopy = [...localDataRef.current.invoices];
    const goalCopy = [...localDataRef.current.goals];

    setTransactions([]);
    setInvoices([]);
    setGoals([]);
    setWatchlist([]);
    setCurrentUser(null);

    if (uid) {
      const batch = writeBatch(db);
      txCopy.forEach((tx) => batch.delete(doc(db, 'users', uid, 'transactions', sanitizeDocId(tx.id))));
      invCopy.forEach((inv) => batch.delete(doc(db, 'users', uid, 'invoices', sanitizeDocId(inv.id))));
      goalCopy.forEach((g) => batch.delete(doc(db, 'users', uid, 'goals', sanitizeDocId(g.id))));
      batch.delete(doc(db, 'users', uid, 'preferences', 'settings'));
      batch.delete(doc(db, 'users', uid));
      batch.commit().catch(() => {});
    }

    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.warn('Storage clear error', e);
    }
    unlockScrollSafely();
    window.dispatchEvent(new CustomEvent('liddy_auth_change', { detail: null }));
  }, [firebaseUid]);

  const addInvoice = (
    inv: Omit<Invoice, 'id' | 'paymentStatus'> & {
      paymentStatus?: 'unpaid' | 'paid' | 'pending';
      paidAt?: string;
    }
  ): Invoice => {
    const id = sanitizeDocId('inv-' + Date.now().toString() + '-' + Math.random().toString(36).substring(2, 5));
    const status = inv.paymentStatus || 'unpaid';
    const newInvoice: Invoice = {
      ...inv,
      id,
      paymentStatus: status,
      ...(status === 'paid' ? { paidAt: inv.paidAt || new Date().toISOString() } : {}),
    };
    setInvoices(prev => [newInvoice, ...prev]);
    logAnalyticsEvent('invoice_created', 'invoices', inv.clientName, inv.grandTotal);

    if (firebaseUid) {
      const path = `users/${firebaseUid}/invoices/${id}`;
      setDoc(doc(db, 'users', firebaseUid, 'invoices', id), buildInvoicePayload(firebaseUid, newInvoice, true))
        .catch((err) => {
          try {
            handleFirestoreError(err, OperationType.CREATE, path);
          } catch {}
        });
    }
    return newInvoice;
  };

  const updateInvoice = (id: string, updates: Partial<Invoice>) => {
    const safeId = sanitizeDocId(id);
    setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, ...updates } : inv));

    if (firebaseUid) {
      const allowedUpdates: Record<string, any> = { updatedAt: serverTimestamp() };
      const allowedKeys = [
        'dueDate', 'senderName', 'senderDetails', 'senderTaxId', 'clientName', 'clientDetails',
        'clientEmail', 'clientTaxId', 'templateStyle', 'paperFormat',
        'items', 'subtotal', 'taxTotal', 'discountTotal', 'grandTotal',
        'notes', 'upiId', 'payeeName', 'paymentStatus', 'paidAt'
      ];
      for (const k of allowedKeys) {
        if ((updates as any)[k] !== undefined) {
          allowedUpdates[k] = (updates as any)[k];
        }
      }
      const path = `users/${firebaseUid}/invoices/${safeId}`;
      updateDoc(doc(db, 'users', firebaseUid, 'invoices', safeId), allowedUpdates)
        .catch((err) => {
          try {
            handleFirestoreError(err, OperationType.UPDATE, path);
          } catch {}
        });
    }
  };

  const deleteInvoice = (id: string) => {
    const safeId = sanitizeDocId(id);
    setInvoices(prev => prev.filter(inv => inv.id !== id));

    if (firebaseUid) {
      const path = `users/${firebaseUid}/invoices/${safeId}`;
      deleteDoc(doc(db, 'users', firebaseUid, 'invoices', safeId))
        .catch((err) => {
          try {
            handleFirestoreError(err, OperationType.DELETE, path);
          } catch {}
        });
    }
  };

  const markInvoicePaid = (id: string, paymentMethod = 'UPI', upiRef?: string) => {
    const target = invoices.find(inv => inv.id === id);
    if (!target || target.paymentStatus === 'paid') return;

    const paidAt = new Date().toISOString();
    updateInvoice(id, {
      paymentStatus: 'paid',
      paidAt
    });

    const normalizedMethod =
      paymentMethod === 'CASH' || paymentMethod === 'CARD' || paymentMethod === 'UPI' || paymentMethod === 'INVOICE'
        ? paymentMethod
        : 'UPI';

    addTransaction({
      merchant: target.clientName || target.senderName || 'Settled Client Bill',
      amount: target.grandTotal,
      category: target.industry || 'Client Retainer',
      date: paidAt.split('T')[0],
      status: 'completed',
      invoiceId: target.id,
      upiReference: upiRef || target.upiId,
      paymentMethod: normalizedMethod,
      notes: `Settled ${target.invoiceNumber} (${target.industry}) via ${paymentMethod}${upiRef ? ` · Ref ${upiRef}` : ''}`
    });
  };

  const addGoal = (g: Omit<Goal, 'id' | 'createdAt'>) => {
    const id = sanitizeDocId('goal-' + Date.now().toString() + '-' + Math.random().toString(36).substring(2, 5));
    const newGoal: Goal = {
      ...g,
      id,
      createdAt: new Date()
    };
    setGoals(prev => [newGoal, ...prev]);

    if (firebaseUid && g.visualUrl && g.visualUrl.length <= 700000) {
      const path = `users/${firebaseUid}/goals/${id}`;
      setDoc(doc(db, 'users', firebaseUid, 'goals', id), {
        userId: firebaseUid,
        title: String(g.title || 'Financial Milestone').slice(0, 300),
        visualUrl: g.visualUrl,
        type: g.type === 'VIDEO' ? 'VIDEO' : 'IMAGE',
        createdAt: serverTimestamp(),
      }).catch((err) => {
        try {
          handleFirestoreError(err, OperationType.CREATE, path);
        } catch {}
      });
    }
  };

  const deleteGoal = (id: string) => {
    const safeId = sanitizeDocId(id);
    setGoals(prev => prev.filter(g => g.id !== id));

    if (firebaseUid) {
      const path = `users/${firebaseUid}/goals/${safeId}`;
      deleteDoc(doc(db, 'users', firebaseUid, 'goals', safeId))
        .catch((err) => {
          try {
            handleFirestoreError(err, OperationType.DELETE, path);
          } catch {}
        });
    }
  };

  const addToWatchlist = (ticker: string) => {
    const clean = ticker.toUpperCase().trim().slice(0, 24);
    if (!clean) return;
    setWatchlist(prev => {
      if (prev.includes(clean)) return prev;
      const next = [...prev, clean].slice(0, 40);
      if (firebaseUid) syncPreferencesToCloud(firebaseUid, { watchlist: next });
      return next;
    });
  };

  const removeFromWatchlist = (ticker: string) => {
    const clean = ticker.toUpperCase().trim();
    setWatchlist(prev => {
      const next = prev.filter(t => t !== clean);
      if (firebaseUid) syncPreferencesToCloud(firebaseUid, { watchlist: next });
      return next;
    });
  };

  const updateStockPortfolio = useCallback(async (next: StockPortfolioState) => {
    const cleanHoldings = (next.holdings || []).slice(0, 50).map((h) => ({
      id: String(h.id || `hold_${Date.now()}`),
      symbol: String(h.symbol || 'STOCK').toUpperCase().slice(0, 24),
      name: String(h.name || 'Equity').slice(0, 80),
      shares: Math.max(0, Number(h.shares) || 0),
      avgPrice: Math.max(0, Number(h.avgPrice) || 0),
      currentPrice: Math.max(0, Number(h.currentPrice) || 0),
    }));
    const normalized: StockPortfolioState = {
      brokerName: String(next.brokerName || 'Zerodha Kite').slice(0, 80),
      totalValue: Math.max(0, Number(next.totalValue) || 0),
      totalInvested: Math.max(0, Number(next.totalInvested) || 0),
      currency: String(next.currency || currencySymbol || '₹').slice(0, 8),
      notes: next.notes ? String(next.notes).slice(0, 400) : '',
      holdings: cleanHoldings,
      updatedAt: new Date().toISOString(),
    };
    setStockPortfolio(normalized);
    try {
      localStorage.setItem('liddy_stock_portfolio', JSON.stringify(normalized));
    } catch {}

    if (firebaseUid) {
      const path = `users/${firebaseUid}/portfolio/main`;
      try {
        await setDoc(doc(db, 'users', firebaseUid, 'portfolio', 'main'), {
          userId: firebaseUid,
          brokerName: normalized.brokerName,
          totalValue: normalized.totalValue,
          totalInvested: normalized.totalInvested,
          currency: normalized.currency,
          ...(normalized.notes ? { notes: normalized.notes } : {}),
          holdings: normalized.holdings,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.WRITE, path);
        } catch {}
      }
    }
  }, [firebaseUid, currencySymbol]);

  return (
    <FinMindContext.Provider value={{
      transactions,
      invoices,
      goals,
      user,
      watchlist,
      currentUser,
      isAdminUser,
      isAuthModalOpen,
      authModalReason,
      openAuthModal,
      closeAuthModal,
      loginUser,
      logoutUser,
      trackEngagement,
      planTier,
      adFree,
      showAds,
      organizationId,
      payments,
      upgradePlan,
      recordGatewayPayment,
      logAnalyticsEvent,
      saveIdeationBoard,
      loadIdeationBoards,
      organizations,
      createOrganization,
      updateOrganization,
      deleteOrganization,
      refreshOrganizations,
      fetchAdminUsers,
      fetchAdminPayments,
      addTransaction,
      updateTransaction,
      deleteTransaction,
      clearAllTransactions,
      resetAllData,
      clearAllData,
      addInvoice,
      updateInvoice,
      deleteInvoice,
      markInvoicePaid,
      addGoal,
      deleteGoal,
      addToWatchlist,
      removeFromWatchlist,
      stockPortfolio,
      updateStockPortfolio,
      currencySymbol,
      setCurrencySymbol,
      currencyPlacement,
      setCurrencyPlacement,
      formatAmount,
      isSettingsOpen,
      openSettings,
      closeSettings,
      themeMode,
      setThemeMode,
      highContrast,
      setHighContrast,
      reducedMotion,
      setReducedMotion,
      currentLanguage,
      setLanguage,
      t,
      isGuestTrialExpired,
      remainingGuestMinutes,
      engagementCount
    }}>
      {children}
    </FinMindContext.Provider>
  );
};

export const useFinMind = () => {
  const context = useContext(FinMindContext);
  if (!context) {
    throw new Error('useFinMind must be used within a FinMindProvider');
  }
  return context;
};