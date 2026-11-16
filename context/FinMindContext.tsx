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
  MerchantPayoutConfig,
  AiImageConfig,
  AgentLedgerOperations,
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
  trackEngagement: (featureName?: string) => boolean;
  isGuestTrialExpired: () => boolean;
  isGuestLocked: boolean;
  remainingGuestMinutes: number;
  remainingGuestActions: number;
  engagementCount: number;
  freeTierActionCount: number;
  isUpgradeModalOpen: boolean;
  upgradeModalReason: string;
  openUpgradeModal: (reason?: string) => void;
  closeUpgradeModal: () => void;

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
  deleteIdeationBoard: (boardId: string) => Promise<void>;

  // Admin Organization, Users & Payments Operations
  organizations: OrganizationRecord[];
  createOrganization: (org: Omit<OrganizationRecord, 'orgId' | 'createdAt' | 'updatedAt' | 'ownerUserId'>) => Promise<OrganizationRecord | null>;
  updateOrganization: (orgId: string, updates: Partial<OrganizationRecord>) => Promise<void>;
  deleteOrganization: (orgId: string) => Promise<void>;
  refreshOrganizations: () => Promise<void>;
  fetchAdminUsers: () => Promise<Array<{ userId: string; displayName: string; email?: string; createdAt?: string; updatedAt?: string }>>;
  fetchAdminPayments: () => Promise<HyperswitchPaymentRecord[]>;
  getAdminAuthHeaders: () => Promise<Record<string, string>>;
  fetchAdminIdeationBoards: () => Promise<IdeationBoardRecord[]>;
  deleteAdminIdeationBoard: (boardId: string) => Promise<void>;
  fetchAdminAllowlist: () => Promise<Array<{ userId: string; email: string; role: 'owner' | 'admin'; createdAt?: string }>>;
  addAdminAllowlistEntry: (userId: string, email: string, role?: 'admin' | 'owner') => Promise<void>;
  removeAdminAllowlistEntry: (userId: string) => Promise<void>;
  reportClientFailure: (subsystem: string, source: string, message: string) => void;

  // Transactions & Invoices Operations
  addTransaction: (t: Omit<Transaction, 'id' | 'status'> & { status?: 'completed' | 'pending' }) => void;
  updateTransaction: (id: string, updates: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;
  applyAgentLedgerOperations: (ops: AgentLedgerOperations) => {
    added: number;
    updated: number;
    deleted: number;
    settledInvoices: number;
  };
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

  // Owner Payout & Banking Receiving Details
  payoutConfig: MerchantPayoutConfig;
  updatePayoutConfig: (next: MerchantPayoutConfig) => Promise<{ ok: boolean; error?: string }>;

  // Free AI Image Engine Configuration (Admin Exclusive Secrets + Public Capability Flags)
  aiImageConfig: AiImageConfig;
  updateAiImageConfig: (next: AiImageConfig) => Promise<{ ok: boolean; error?: string }>;

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
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [upgradeModalReason, setUpgradeModalReason] = useState('');
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

  const [payoutConfig, setPayoutConfig] = useState<MerchantPayoutConfig>(() => {
    try {
      const saved = localStorage.getItem('liddy_payout_public_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return {
            upiId: String(parsed.upiId || ''),
            payeeName: String(parsed.payeeName || ''),
            bankName: String(parsed.bankName || ''),
            accountHolder: '',
            accountNumber: '',
            ifscCode: '',
            paypalEnabled: Boolean(parsed.paypalEnabled),
            paypalEnvironment: parsed.paypalEnvironment === 'live' ? 'live' : 'sandbox',
            paypalClientId: String(parsed.paypalClientId || ''),
            paypalClientSecret: '',
            paypalMerchantEmail: String(parsed.paypalMerchantEmail || ''),
            hasPaypalConfigured: Boolean(parsed.hasPaypalConfigured),
            updatedAt: parsed.updatedAt,
          };
        }
      }
    } catch {}
    return {
      upiId: '',
      payeeName: '',
      bankName: '',
      accountHolder: '',
      accountNumber: '',
      ifscCode: '',
      paypalEnabled: false,
      paypalEnvironment: 'sandbox',
      paypalClientId: '',
      paypalClientSecret: '',
      paypalMerchantEmail: '',
      hasPaypalConfigured: false,
    };
  });

  const [aiImageConfig, setAiImageConfig] = useState<AiImageConfig>({
    aiHordeEnabled: true,
    aiHordeApiKey: '',
    hasAiHordeKey: false,
    cloudflareEnabled: false,
    cloudflareAccountId: '',
    cloudflareApiToken: '',
    hasCloudflareConfigured: false,
    huggingfaceEnabled: false,
    huggingfaceToken: '',
    hasHuggingfaceConfigured: false,
    queueTimeoutSec: 45,
    activeTurboMode: false,
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

  const deleteIdeationBoard = useCallback(async (boardId: string) => {
    const safeId = sanitizeDocId(boardId);
    try {
      const savedRaw = localStorage.getItem('liddy_ideation_boards');
      if (savedRaw) {
        const list: IdeationBoardRecord[] = JSON.parse(savedRaw);
        localStorage.setItem(
          'liddy_ideation_boards',
          JSON.stringify(list.filter((b) => b.boardId !== boardId && sanitizeDocId(b.boardId) !== safeId))
        );
      }
    } catch {}
    if (firebaseUid) {
      try {
        await deleteDoc(doc(db, 'ideation_boards', safeId));
      } catch {}
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
            paymentRail: data.paymentRail || 'PAYPAL',
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

  const getAdminAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await auth.currentUser?.getIdToken().catch(() => '');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const reportClientFailure = useCallback((subsystem: string, source: string, message: string) => {
    fetch('/api/ops/report-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subsystem, source, message, severity: 'error' }),
    }).catch(() => {});
  }, []);

  const fetchAdminIdeationBoards = useCallback(async (): Promise<IdeationBoardRecord[]> => {
    if (!firebaseUid || !isAdminUser) return [];
    try {
      const snap = await getDocs(query(collection(db, 'ideation_boards'), orderBy('updatedAt', 'desc'), limit(100)));
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          boardId: data.boardId || d.id,
          title: data.title || 'Vision Board',
          roomCode: data.roomCode || 'ROOM-101',
          ownerUserId: data.ownerUserId || '',
          nodes: Array.isArray(data.nodes) ? data.nodes : [],
          slides: Array.isArray(data.slides) ? data.slides : [],
          meetingNotes: Array.isArray(data.meetingNotes) ? data.meetingNotes : [],
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : new Date().toISOString(),
        };
      });
    } catch {
      return [];
    }
  }, [firebaseUid, isAdminUser]);

  const deleteAdminIdeationBoard = useCallback(async (boardId: string) => {
    if (!firebaseUid || !isAdminUser) return;
    const safeId = sanitizeDocId(boardId);
    await deleteDoc(doc(db, 'ideation_boards', safeId));
  }, [firebaseUid, isAdminUser]);

  const fetchAdminAllowlist = useCallback(async () => {
    if (!firebaseUid || !isAdminUser) return [];
    try {
      const snap = await getDocs(collection(db, 'admins'));
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          userId: data.userId || d.id,
          email: String(data.email || ''),
          role: (data.role === 'owner' ? 'owner' : 'admin') as 'owner' | 'admin',
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : undefined,
        };
      });
    } catch {
      return [];
    }
  }, [firebaseUid, isAdminUser]);

  const addAdminAllowlistEntry = useCallback(async (userId: string, email: string, role: 'admin' | 'owner' = 'admin') => {
    if (!firebaseUid || !isAdminUser) return;
    const safeId = sanitizeDocId(userId);
    await setDoc(doc(db, 'admins', safeId), {
      userId: safeId,
      email: email.trim().slice(0, 254),
      role,
      createdAt: serverTimestamp(),
    });
  }, [firebaseUid, isAdminUser]);

  const removeAdminAllowlistEntry = useCallback(async (userId: string) => {
    if (!firebaseUid || !isAdminUser || userId === firebaseUid) return;
    const safeId = sanitizeDocId(userId);
    await deleteDoc(doc(db, 'admins', safeId));
  }, [firebaseUid, isAdminUser]);

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

    const unsubPublicPayout = onSnapshot(
      doc(db, 'platform_config', 'payout_public'),
      (snap) => {
        if (isCancelled || !snap.exists()) return;
        const d = snap.data();
        const syncedPublic = {
          upiId: String(d.upiId || ''),
          payeeName: String(d.payeeName || ''),
          bankName: String(d.bankName || ''),
          paypalEnabled: Boolean(d.paypalEnabled),
          paypalEnvironment: (d.paypalEnvironment === 'live' ? 'live' : 'sandbox') as 'sandbox' | 'live',
          paypalClientId: String(d.paypalClientId || ''),
          paypalMerchantEmail: String(d.paypalMerchantEmail || ''),
          hasPaypalConfigured: Boolean(d.hasPaypalConfigured ?? Boolean(d.paypalClientId)),
          updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
        };
        setPayoutConfig((prev) => ({
          ...prev,
          ...syncedPublic,
        }));
        try {
          localStorage.setItem('liddy_payout_public_config', JSON.stringify(syncedPublic));
        } catch {}
      },
      () => {}
    );

    const unsubPublicAiImage = onSnapshot(
      doc(db, 'platform_config', 'ai_image_public'),
      (snap) => {
        if (isCancelled || !snap.exists()) return;
        const d = snap.data();
        setAiImageConfig((prev) => ({
          ...prev,
          aiHordeEnabled: d.aiHordeEnabled !== false,
          hasAiHordeKey: Boolean(d.hasAiHordeKey),
          cloudflareEnabled: Boolean(d.cloudflareEnabled),
          hasCloudflareConfigured: Boolean(d.hasCloudflareConfigured),
          huggingfaceEnabled: Boolean(d.huggingfaceEnabled),
          hasHuggingfaceConfigured: Boolean(d.hasHuggingfaceConfigured),
          queueTimeoutSec: Number(d.queueTimeoutSec) || 45,
          activeTurboMode: Boolean(d.activeTurboMode),
          updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : prev.updatedAt,
        }));
      },
      () => {}
    );

    return () => {
      isCancelled = true;
      unsubPrefs();
      unsubTx();
      unsubInv();
      unsubGoals();
      unsubPortfolio();
      unsubPublicPayout();
      unsubPublicAiImage();
    };
  }, [firebaseUid, syncPreferencesToCloud]);

  // Admin-only full bank, UPI and PayPal config sync (/platform_config/payout + /api/admin/payout-config)
  useEffect(() => {
    if (!firebaseUid || !isAdminUser) {
      fetch('/api/payments/payout-config/public')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && (data.upiId || data.payeeName || data.paypalClientId)) {
            setPayoutConfig((prev) => ({
              ...prev,
              upiId: String(data.upiId || ''),
              payeeName: String(data.payeeName || ''),
              bankName: String(data.bankName || ''),
              paypalEnabled: Boolean(data.paypalEnabled),
              paypalEnvironment: data.paypalEnvironment === 'live' ? 'live' : 'sandbox',
              paypalClientId: String(data.paypalClientId || ''),
              paypalMerchantEmail: String(data.paypalMerchantEmail || ''),
              hasPaypalConfigured: Boolean(data.hasPaypalConfigured),
              updatedAt: data.updatedAt,
            }));
          }
        })
        .catch(() => {});
      fetch('/api/ai/image-config/public')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data && typeof data === 'object') {
            setAiImageConfig((prev) => ({
              ...prev,
              ...data,
            }));
          }
        })
        .catch(() => {});
      return;
    }

    let cancelled = false;
    const unsubAdminPayout = onSnapshot(
      doc(db, 'platform_config', 'payout'),
      async (snap) => {
        if (cancelled || !snap.exists()) return;
        const d = snap.data();
        const full: MerchantPayoutConfig = {
          upiId: String(d.upiId || ''),
          payeeName: String(d.payeeName || ''),
          bankName: String(d.bankName || ''),
          accountHolder: String(d.accountHolder || ''),
          accountNumber: String(d.accountNumber || ''),
          ifscCode: String(d.ifscCode || ''),
          paypalEnabled: Boolean(d.paypalEnabled ?? Boolean(d.paypalClientId)),
          paypalEnvironment: d.paypalEnvironment === 'live' ? 'live' : 'sandbox',
          paypalClientId: String(d.paypalClientId || ''),
          paypalClientSecret: String(d.paypalClientSecret || ''),
          paypalMerchantEmail: String(d.paypalMerchantEmail || ''),
          hasPaypalConfigured: Boolean(d.paypalClientId && d.paypalClientSecret),
          updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
        };
        setPayoutConfig(full);
        if (full.upiId || full.accountNumber || full.paypalClientId) {
          const headers = await getAdminAuthHeaders();
          fetch('/api/admin/payout-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(full),
          }).catch(() => {});
        }
      },
      () => {}
    );

    getAdminAuthHeaders()
      .then((headers) => fetch('/api/admin/payout-config', { headers }))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const cfg = data?.payoutConfig;
        if (cfg && (cfg.upiId || cfg.accountNumber || cfg.paypalClientId)) {
          setPayoutConfig((prev) => {
            if ((prev.upiId || prev.accountNumber || prev.paypalClientId) && prev.updatedAt && cfg.updatedAt && prev.updatedAt > cfg.updatedAt) {
              return prev;
            }
            return cfg;
          });
        }
      })
      .catch(() => {});

    const unsubAdminAiImage = onSnapshot(
      doc(db, 'platform_config', 'ai_image'),
      async (snap) => {
        if (cancelled || !snap.exists()) return;
        const d = snap.data();
        const full: AiImageConfig = {
          aiHordeEnabled: d.aiHordeEnabled !== false,
          aiHordeApiKey: String(d.aiHordeApiKey || ''),
          hasAiHordeKey: Boolean(d.aiHordeApiKey),
          cloudflareEnabled: Boolean(d.cloudflareEnabled),
          cloudflareAccountId: String(d.cloudflareAccountId || ''),
          cloudflareApiToken: String(d.cloudflareApiToken || ''),
          hasCloudflareConfigured: Boolean(d.cloudflareAccountId && d.cloudflareApiToken),
          huggingfaceEnabled: Boolean(d.huggingfaceEnabled),
          huggingfaceToken: String(d.huggingfaceToken || ''),
          hasHuggingfaceConfigured: Boolean(d.huggingfaceToken),
          queueTimeoutSec: Number(d.queueTimeoutSec) || 45,
          activeTurboMode: Boolean(
            (d.cloudflareEnabled && d.cloudflareAccountId && d.cloudflareApiToken) ||
              (d.huggingfaceEnabled && d.huggingfaceToken)
          ),
          updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
        };
        setAiImageConfig(full);
        const headers = await getAdminAuthHeaders();
        fetch('/api/admin/ai-image-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(full),
        }).catch(() => {});
      },
      () => {}
    );

    getAdminAuthHeaders()
      .then((headers) => fetch('/api/admin/ai-image-config', { headers }))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.aiImageConfig) return;
        const cfg = data.aiImageConfig as AiImageConfig;
        setAiImageConfig((prev) => {
          if (prev.updatedAt && cfg.updatedAt && prev.updatedAt > cfg.updatedAt) return prev;
          return cfg;
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unsubAdminPayout();
      unsubAdminAiImage();
    };
  }, [firebaseUid, isAdminUser, getAdminAuthHeaders]);

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

  const [freeTierActionCount, setFreeTierActionCount] = useState<number>(0);

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
    setIsUpgradeModalOpen(false);
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

  const openUpgradeModal = useCallback((reason?: string) => {
    if (reason) setUpgradeModalReason(reason);
    setIsUpgradeModalOpen(true);
  }, []);

  const closeUpgradeModal = useCallback(() => {
    setIsUpgradeModalOpen(false);
    unlockScrollSafely();
  }, []);

  useEffect(() => {
    if (planTier !== 'free' || isAdminUser) {
      setIsUpgradeModalOpen(false);
    }
  }, [planTier, isAdminUser]);

  useEffect(() => {
    if (!currentUser || currentUser.isGuest) {
      setFreeTierActionCount(0);
      return;
    }
    const userKey = sanitizeDocId(currentUser.uid || currentUser.email || 'member');
    try {
      const stored = parseInt(localStorage.getItem(`liddy_free_actions_${userKey}`) || '0', 10);
      setFreeTierActionCount(!isNaN(stored) && stored > 0 ? stored : 0);
    } catch {
      setFreeTierActionCount(0);
    }
  }, [currentUser]);

  const openSettings = useCallback(() => setIsSettingsOpen(true), []);
  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
    unlockScrollSafely();
  }, []);

  const GUEST_TRIAL_DURATION_MS = 30 * 60 * 1000;
  const GUEST_ACTION_LIMIT = 5;
  const FREE_PAYMENT_PROMPT_THRESHOLD = 12;

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

  const isGuestSession = !currentUser || Boolean(currentUser.isGuest);

  const isGuestTrialExpired = useCallback((): boolean => {
    if (currentUser && !currentUser.isGuest) return false;
    const start = getGuestSessionStart();
    return Date.now() - start >= GUEST_TRIAL_DURATION_MS;
  }, [currentUser, getGuestSessionStart]);

  const [remainingGuestMinutes, setRemainingGuestMinutes] = useState<number>(30);
  const [guestTimeExpired, setGuestTimeExpired] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('liddy_guest_session_start');
      if (!stored) return false;
      const parsed = parseInt(stored, 10);
      return !isNaN(parsed) && Date.now() - parsed >= GUEST_TRIAL_DURATION_MS;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const updateRemaining = () => {
      if (currentUser && !currentUser.isGuest) {
        setRemainingGuestMinutes(30);
        setGuestTimeExpired(false);
        return;
      }
      const start = getGuestSessionStart();
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, Math.ceil((GUEST_TRIAL_DURATION_MS - elapsed) / (60 * 1000)));
      const expired = elapsed >= GUEST_TRIAL_DURATION_MS;
      setRemainingGuestMinutes(remaining);
      setGuestTimeExpired(expired);
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 15000);
    return () => clearInterval(interval);
  }, [currentUser, getGuestSessionStart]);

  const isGuestLocked = isGuestSession && (engagementCount > GUEST_ACTION_LIMIT || guestTimeExpired);
  const remainingGuestActions = isGuestSession ? Math.max(0, GUEST_ACTION_LIMIT - engagementCount) : GUEST_ACTION_LIMIT;

  const trackEngagement = useCallback((featureName?: string): boolean => {
    if (!currentUser || currentUser.isGuest) {
      const expiredNow = isGuestTrialExpired();
      let nextCount = engagementCount + 1;
      try {
        const stored = parseInt(localStorage.getItem('liddy_engagement_count') || String(engagementCount), 10);
        if (!isNaN(stored)) nextCount = Math.max(nextCount, stored + 1);
        localStorage.setItem('liddy_engagement_count', nextCount.toString());
      } catch {}
      setEngagementCount(nextCount);

      if (expiredNow) {
        setGuestTimeExpired(true);
      }

      if (nextCount > GUEST_ACTION_LIMIT || expiredNow) {
        openAuthModal(
          expiredNow
            ? 'Your 30-minute guest preview ended — Create a free account to continue'
            : featureName
            ? `Free 5-action guest preview used — Sign up to continue with ${featureName}`
            : 'Free guest allowance used — Create a free account to continue'
        );
        return false;
      }
    } else if (planTier === 'free' && !isAdminUser) {
      const userKey = sanitizeDocId(currentUser.uid || currentUser.email || 'member');
      let nextFreeCount = freeTierActionCount + 1;
      try {
        const stored = parseInt(localStorage.getItem(`liddy_free_actions_${userKey}`) || String(freeTierActionCount), 10);
        if (!isNaN(stored)) nextFreeCount = Math.max(nextFreeCount, stored + 1);
        localStorage.setItem(`liddy_free_actions_${userKey}`, nextFreeCount.toString());
      } catch {}
      setFreeTierActionCount(nextFreeCount);

      if (nextFreeCount >= FREE_PAYMENT_PROMPT_THRESHOLD && nextFreeCount % FREE_PAYMENT_PROMPT_THRESHOLD === 0) {
        openUpgradeModal(
          featureName
            ? `You've completed ${nextFreeCount} workspace actions — Unlock unlimited Pro & Team features for ${featureName}`
            : `You've completed ${nextFreeCount} workspace actions on Starter Free — Upgrade anytime to unlock full limits`
        );
      }
    }
    return true;
  }, [currentUser, engagementCount, freeTierActionCount, planTier, isAdminUser, isGuestTrialExpired, openAuthModal, openUpgradeModal]);

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
      trackEngagement('Receipt & Expense Scanner');
    } else {
      trackEngagement('Expense Ledger');
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

  const applyAgentLedgerOperations = useCallback(
    (ops: AgentLedgerOperations) => {
      const adds = Array.isArray(ops?.addTransactions) ? ops.addTransactions : [];
      const updates = Array.isArray(ops?.updateTransactions) ? ops.updateTransactions : [];
      const deletes = Array.isArray(ops?.deleteTransactionIds) ? ops.deleteTransactionIds : [];
      const settleInvoices = Array.isArray(ops?.markInvoicesPaid) ? ops.markInvoicesPaid : [];

      const deleteSet = new Set(deletes);
      const updateMap = new Map(updates.map((u) => [u.id, u.updates]));
      const newlyAddedTx: Transaction[] = adds.map((item, idx) => ({
        ...item,
        id: sanitizeDocId(`tx-${Date.now().toString()}-${idx}-${Math.random().toString(36).slice(2, 5)}`),
        status: item.status || 'completed',
      }));

      if (newlyAddedTx.length > 0 || updates.length > 0 || deletes.length > 0) {
        setTransactions((prev) => {
          const updatedList = prev
            .filter((t) => !deleteSet.has(t.id))
            .map((t) => (updateMap.has(t.id) ? { ...t, ...updateMap.get(t.id)! } : t));
          return [...newlyAddedTx, ...updatedList];
        });

        if (firebaseUid) {
          const batch = writeBatch(db);
          newlyAddedTx.forEach((nt) => {
            batch.set(doc(db, 'users', firebaseUid, 'transactions', nt.id), buildTransactionPayload(firebaseUid, nt, true));
          });
          updates.forEach(({ id, updates: patch }) => {
            const safeId = sanitizeDocId(id);
            const allowed: Record<string, any> = { updatedAt: serverTimestamp() };
            if (patch.date !== undefined) allowed.date = String(patch.date).slice(0, 32);
            if (patch.merchant !== undefined) allowed.merchant = String(patch.merchant).slice(0, 160);
            if (patch.amount !== undefined) allowed.amount = Math.max(0, Number(patch.amount) || 0);
            if (patch.category !== undefined) allowed.category = String(patch.category).slice(0, 80);
            if (patch.status !== undefined) allowed.status = patch.status;
            if (patch.notes !== undefined) allowed.notes = String(patch.notes).slice(0, 500);
            batch.update(doc(db, 'users', firebaseUid, 'transactions', safeId), allowed);
          });
          deletes.forEach((id) => {
            batch.delete(doc(db, 'users', firebaseUid, 'transactions', sanitizeDocId(id)));
          });
          batch.commit().catch(() => {});
        }
      }

      let settledInvoicesCount = 0;
      if (settleInvoices.length > 0) {
        const settleMap = new Map(settleInvoices.map((s) => [s.id, s]));
        const paidAt = new Date().toISOString();
        setInvoices((prev) =>
          prev.map((inv) => {
            if (!settleMap.has(inv.id) || inv.paymentStatus === 'paid') return inv;
            settledInvoicesCount += 1;
            return { ...inv, paymentStatus: 'paid', paidAt };
          })
        );
        if (firebaseUid) {
          settleInvoices.forEach(({ id }) => {
            updateDoc(doc(db, 'users', firebaseUid, 'invoices', sanitizeDocId(id)), {
              paymentStatus: 'paid',
              paidAt,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
          });
        }
      }

      return {
        added: newlyAddedTx.length,
        updated: updates.length,
        deleted: deletes.length,
        settledInvoices: settledInvoicesCount,
      };
    },
    [firebaseUid]
  );

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
    trackEngagement('Invoice Builder');

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

  const updatePayoutConfig = useCallback(
    async (next: MerchantPayoutConfig): Promise<{ ok: boolean; error?: string }> => {
      if (!firebaseUid || !isAdminUser) {
        return { ok: false, error: 'Only verified platform administrators can modify receiving payout details.' };
      }
      const paypalClientId = String(next.paypalClientId || '').trim().slice(0, 200);
      const paypalClientSecret = String(next.paypalClientSecret || '').trim().slice(0, 200);
      const paypalEnvironment: 'sandbox' | 'live' = next.paypalEnvironment === 'live' ? 'live' : 'sandbox';
      const paypalMerchantEmail = String(next.paypalMerchantEmail || '').trim().slice(0, 254);
      const hasPaypalConfigured = Boolean(paypalClientId && paypalClientSecret);
      const paypalEnabled = typeof next.paypalEnabled === 'boolean' ? next.paypalEnabled : hasPaypalConfigured;

      const normalized: MerchantPayoutConfig = {
        upiId: String(next.upiId || '').trim().slice(0, 120),
        payeeName: String(next.payeeName || '').trim().slice(0, 120),
        bankName: String(next.bankName || '').trim().slice(0, 120),
        accountHolder: String(next.accountHolder || '').trim().slice(0, 120),
        accountNumber: String(next.accountNumber || '').trim().slice(0, 40),
        ifscCode: String(next.ifscCode || '').trim().toUpperCase().slice(0, 32),
        paypalEnabled,
        paypalEnvironment,
        paypalClientId,
        paypalClientSecret,
        paypalMerchantEmail,
        hasPaypalConfigured,
        updatedAt: new Date().toISOString(),
      };

      if (normalized.upiId && (!normalized.upiId.includes('@') || normalized.upiId.length < 3)) {
        return { ok: false, error: 'Enter a valid UPI ID (e.g. yourname@okicici).' };
      }
      if (paypalMerchantEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalMerchantEmail)) {
        return { ok: false, error: 'Enter a valid PayPal merchant email address.' };
      }
      if (paypalEnabled && (!paypalClientId || !paypalClientSecret)) {
        return { ok: false, error: 'Provide both your PayPal Client ID and PayPal Client Secret to enable PayPal.' };
      }
      if (!normalized.upiId && !normalized.accountNumber && !paypalClientId) {
        return { ok: false, error: 'Provide UPI, bank account or PayPal credentials.' };
      }
      if (!normalized.payeeName) {
        return { ok: false, error: 'Enter a payee or business name.' };
      }

      setPayoutConfig(normalized);
      try {
        localStorage.setItem(
          'liddy_payout_public_config',
          JSON.stringify({
            upiId: normalized.upiId,
            payeeName: normalized.payeeName,
            bankName: normalized.bankName || '',
            paypalEnabled: Boolean(normalized.paypalEnabled),
            paypalEnvironment: normalized.paypalEnvironment || 'sandbox',
            paypalClientId: normalized.paypalClientId || '',
            paypalMerchantEmail: normalized.paypalMerchantEmail || '',
            hasPaypalConfigured,
            updatedAt: normalized.updatedAt,
          })
        );
      } catch {}

      try {
        const headers = await getAdminAuthHeaders();
        const serverResp = await fetch('/api/admin/payout-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(normalized),
        });
        if (!serverResp.ok) {
          const errJson = await serverResp.json().catch(() => ({}));
          return { ok: false, error: errJson.error || 'Server rejected payout update.' };
        }
      } catch (err: any) {
        return { ok: false, error: err?.message || 'Network error saving payout config to server.' };
      }

      try {
        await setDoc(doc(db, 'platform_config', 'payout'), {
          upiId: normalized.upiId,
          payeeName: normalized.payeeName,
          bankName: normalized.bankName || '',
          accountHolder: normalized.accountHolder || normalized.payeeName || '',
          accountNumber: normalized.accountNumber || '',
          ifscCode: normalized.ifscCode || '',
          paypalEnabled: Boolean(normalized.paypalEnabled),
          paypalEnvironment: normalized.paypalEnvironment || 'sandbox',
          paypalClientId: normalized.paypalClientId || '',
          paypalClientSecret: normalized.paypalClientSecret || '',
          paypalMerchantEmail: normalized.paypalMerchantEmail || '',
          updatedBy: firebaseUid,
          updatedAt: serverTimestamp(),
        });

        await setDoc(doc(db, 'platform_config', 'payout_public'), {
          upiId: normalized.upiId,
          payeeName: normalized.payeeName,
          bankName: normalized.bankName || '',
          accountNumberLast4: normalized.accountNumber ? normalized.accountNumber.slice(-4) : '',
          paypalEnabled: Boolean(normalized.paypalEnabled),
          paypalEnvironment: normalized.paypalEnvironment || 'sandbox',
          paypalClientId: normalized.paypalClientId || '',
          paypalMerchantEmail: normalized.paypalMerchantEmail || '',
          hasPaypalConfigured,
          hasPayoutConfigured: Boolean(normalized.upiId || normalized.accountNumber || hasPaypalConfigured),
          updatedAt: serverTimestamp(),
        });
      } catch (err: any) {
        try {
          handleFirestoreError(err, OperationType.WRITE, 'platform_config/payout');
        } catch (formatted: any) {
          return { ok: true, error: formatted?.message || 'Saved on server; cloud sync retry pending.' };
        }
      }

      return { ok: true };
    },
    [firebaseUid, isAdminUser, getAdminAuthHeaders]
  );

  const updateAiImageConfig = useCallback(
    async (next: AiImageConfig): Promise<{ ok: boolean; error?: string }> => {
      if (!isAdminUser || !firebaseUid) {
        return { ok: false, error: 'Only verified platform administrators can update image engine credentials.' };
      }

      const cleanTimeout = Math.min(90, Math.max(15, Math.round(Number(next.queueTimeoutSec) || 45)));
      const normalized: AiImageConfig = {
        aiHordeEnabled: next.aiHordeEnabled !== false,
        aiHordeApiKey: String(next.aiHordeApiKey || '').trim().slice(0, 120),
        hasAiHordeKey: Boolean(String(next.aiHordeApiKey || '').trim()),
        cloudflareEnabled: Boolean(next.cloudflareEnabled),
        cloudflareAccountId: String(next.cloudflareAccountId || '').trim().slice(0, 120),
        cloudflareApiToken: String(next.cloudflareApiToken || '').trim().slice(0, 250),
        hasCloudflareConfigured: Boolean(String(next.cloudflareAccountId || '').trim() && String(next.cloudflareApiToken || '').trim()),
        huggingfaceEnabled: Boolean(next.huggingfaceEnabled),
        huggingfaceToken: String(next.huggingfaceToken || '').trim().slice(0, 250),
        hasHuggingfaceConfigured: Boolean(String(next.huggingfaceToken || '').trim()),
        queueTimeoutSec: cleanTimeout,
        updatedAt: new Date().toISOString(),
      };
      normalized.activeTurboMode = Boolean(
        (normalized.cloudflareEnabled && normalized.hasCloudflareConfigured) ||
          (normalized.huggingfaceEnabled && normalized.hasHuggingfaceConfigured)
      );

      if (normalized.cloudflareEnabled && !normalized.hasCloudflareConfigured) {
        return { ok: false, error: 'Provide both Cloudflare Account ID and API Token to enable Cloudflare FLUX.' };
      }
      if (normalized.huggingfaceEnabled && !normalized.hasHuggingfaceConfigured) {
        return { ok: false, error: 'Provide a Hugging Face Access Token to enable Hugging Face FLUX.' };
      }

      try {
        const headers = await getAdminAuthHeaders();
        const serverResp = await fetch('/api/admin/ai-image-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(normalized),
        });
        if (!serverResp.ok) {
          const errJson = await serverResp.json().catch(() => ({}));
          return { ok: false, error: errJson.error || 'Server rejected image engine update.' };
        }
      } catch (err: any) {
        return { ok: false, error: err?.message || 'Network error saving image engine config.' };
      }

      setAiImageConfig(normalized);

      try {
        await setDoc(doc(db, 'platform_config', 'ai_image'), {
          aiHordeEnabled: normalized.aiHordeEnabled,
          aiHordeApiKey: normalized.aiHordeApiKey || '',
          cloudflareEnabled: normalized.cloudflareEnabled,
          cloudflareAccountId: normalized.cloudflareAccountId || '',
          cloudflareApiToken: normalized.cloudflareApiToken || '',
          huggingfaceEnabled: normalized.huggingfaceEnabled,
          huggingfaceToken: normalized.huggingfaceToken || '',
          queueTimeoutSec: normalized.queueTimeoutSec,
          updatedBy: firebaseUid,
          updatedAt: serverTimestamp(),
        });

        await setDoc(doc(db, 'platform_config', 'ai_image_public'), {
          aiHordeEnabled: normalized.aiHordeEnabled,
          hasAiHordeKey: Boolean(normalized.hasAiHordeKey),
          cloudflareEnabled: normalized.cloudflareEnabled,
          hasCloudflareConfigured: Boolean(normalized.hasCloudflareConfigured),
          huggingfaceEnabled: normalized.huggingfaceEnabled,
          hasHuggingfaceConfigured: Boolean(normalized.hasHuggingfaceConfigured),
          queueTimeoutSec: normalized.queueTimeoutSec,
          activeTurboMode: Boolean(normalized.activeTurboMode),
          updatedAt: serverTimestamp(),
        });
      } catch (err: any) {
        try {
          handleFirestoreError(err, OperationType.WRITE, 'platform_config/ai_image');
        } catch (formatted: any) {
          return { ok: true, error: formatted?.message || 'Saved on server; cloud sync retry pending.' };
        }
      }

      return { ok: true };
    },
    [firebaseUid, isAdminUser, getAdminAuthHeaders]
  );

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
      deleteIdeationBoard,
      organizations,
      createOrganization,
      updateOrganization,
      deleteOrganization,
      refreshOrganizations,
      fetchAdminUsers,
      fetchAdminPayments,
      getAdminAuthHeaders,
      fetchAdminIdeationBoards,
      deleteAdminIdeationBoard,
      fetchAdminAllowlist,
      addAdminAllowlistEntry,
      removeAdminAllowlistEntry,
      reportClientFailure,
      addTransaction,
      updateTransaction,
      deleteTransaction,
      applyAgentLedgerOperations,
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
      payoutConfig,
      updatePayoutConfig,
      aiImageConfig,
      updateAiImageConfig,
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
      isGuestLocked,
      remainingGuestMinutes,
      remainingGuestActions,
      engagementCount,
      freeTierActionCount,
      isUpgradeModalOpen,
      upgradeModalReason,
      openUpgradeModal,
      closeUpgradeModal,
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