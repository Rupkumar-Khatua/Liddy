export enum Page {
  DASHBOARD = 'DASHBOARD',
  TRANSACTIONS = 'TRANSACTIONS',
  CHAT = 'CHAT',
  GOALS = 'GOALS',
  MARKETS = 'MARKETS'
}

export type WindowId =
  | 'home'
  | 'overview'
  | 'invoices'
  | 'scanner'
  | 'markets'
  | 'agent'
  | 'vision'
  | 'pricing'
  | 'settings'
  | 'profile'
  | 'admin';

export type PlanTier = 'free' | 'pro' | 'team';

export type BillingCycle = 'monthly' | 'annual';
export type PaymentRegion = 'IN' | 'INTL';
export type PaymentRail = 'UPI_QR' | 'UPI_ID' | 'CARD' | 'WALLET';

export interface HyperswitchPaymentRecord {
  paymentId: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  planTier: PlanTier;
  billingCycle: BillingCycle;
  region: PaymentRegion;
  currency: 'INR' | 'USD' | 'EUR' | 'GBP';
  amount: number;
  amountUsdEquivalent: number;
  paymentRail: PaymentRail;
  connector: string;
  status: 'succeeded' | 'processing' | 'requires_action' | 'failed';
  referenceCode: string;
  createdAt: string;
}

export interface StockHolding {
  id: string;
  symbol: string;
  name: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
}

export interface StockPortfolioState {
  brokerName: string;
  totalValue: number;
  totalInvested: number;
  currency: string;
  notes?: string;
  holdings: StockHolding[];
  updatedAt: string;
}

export type MindMapShape = 'hub' | 'step' | 'insight' | 'metric' | 'action';
export type SlideTheme = 'midnight' | 'ivory' | 'emerald' | 'cobalt';

export interface MindMapNode {
  id: string;
  label: string;
  notes?: string;
  x: number;
  y: number;
  color: 'indigo' | 'emerald' | 'sky' | 'amber' | 'rose' | 'neutral';
  shape?: MindMapShape;
  metricTag?: string;
  parentId?: string | null;
  author?: string;
}

export interface SlideItem {
  id: string;
  title: string;
  subtitle?: string;
  bullets: string[];
  layout: 'cover' | 'two-col' | 'metrics' | 'roadmap';
  theme?: SlideTheme;
  metricHighlight?: string;
}

export interface CollabNote {
  id: string;
  author: string;
  text: string;
  kind: 'note' | 'decision' | 'action';
  createdAt: string;
}

export interface CollabParticipant {
  clientId: string;
  peerId?: string;
  name: string;
  role: string;
  color: string;
  joinedAt: string;
  micOn?: boolean;
  camOn?: boolean;
  screenOn?: boolean;
}

export interface IdeationBoardRecord {
  boardId: string;
  title: string;
  roomCode: string;
  ownerUserId: string;
  nodes: MindMapNode[];
  slides: SlideItem[];
  meetingNotes: CollabNote[];
  updatedAt: string;
}

export type IndustryTheme = 'RETAIL' | 'TECH' | 'DINING' | 'HEALTHCARE' | 'SERVICES';
export type InvoiceTemplateStyle = 'classic' | 'minimal' | 'corporate';
export type InvoicePaperFormat = 'a4' | 'letter' | 'thermal80';

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  taxPercent?: number;
  total: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  date: string;
  dueDate?: string;
  senderName: string;
  senderDetails?: string;
  senderTaxId?: string;
  clientName: string;
  clientDetails?: string;
  clientEmail?: string;
  clientTaxId?: string;
  industry: IndustryTheme;
  templateStyle?: InvoiceTemplateStyle;
  paperFormat?: InvoicePaperFormat;
  items: InvoiceLineItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  currency: string;
  notes?: string;
  upiId?: string;
  payeeName?: string;
  paymentStatus: 'unpaid' | 'paid' | 'pending';
  paidAt?: string;
  industrySpecific?: Record<string, string>;
}

export interface Transaction {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string;
  isRecurring?: boolean;
  status: 'completed' | 'pending';
  invoiceId?: string;
  upiReference?: string;
  paymentMethod?: 'UPI' | 'CARD' | 'CASH' | 'SCAN_RECEIPT' | 'INVOICE';
  notes?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  images?: string[];
  groundingUrls?: Array<{title: string, uri: string}>;
}

export interface Goal {
  id: string;
  title: string;
  targetDate?: string;
  visualUrl: string;
  type: 'IMAGE' | 'VIDEO';
  createdAt: Date;
}

export interface ListedCompany {
  ticker: string;
  yahooSymbol?: string;
  name: string;
  exchange: 'NYSE / NASDAQ' | 'NSE / BSE' | 'LSE / Euronext' | 'TSE / HKEX';
  sector: string;
  marketCap: string;
  price: string;
  rawPrice?: number;
  change: string;
  isPositive: boolean;
  volume: string;
  peRatio?: string;
  week52High?: string;
  week52Low?: string;
  headquarters?: string;
  ceo?: string;
  description?: string;
  websiteUrl?: string;
  investorUrl?: string;
  dividendYield?: string;
  currencyCode?: string;
  country?: string;
}

export interface MarketNewsItem {
  title: string;
  source: string;
  summary: string;
  category?: string;
  timeAgo?: string;
  url?: string;
  publishedAt?: string;
  author?: string;
  impact?: 'HIGH' | 'MEDIUM' | 'MACRO';
  sentiment?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface MarketData {
  indices: Array<{
    name: string;
    symbol?: string;
    value: string;
    rawPrice?: number;
    change: string;
    isPositive: boolean;
    range?: string;
  }>;
  news: MarketNewsItem[];
  marketStatus: Array<{
    region: string;
    isOpen: boolean;
    time: string;
    localTime?: string;
  }>;
  listedCompanies?: ListedCompany[];
  lastUpdated?: string;
}

export interface OrganizationRecord {
  orgId: string;
  name: string;
  industry: string;
  planTier: 'free' | 'pro' | 'team' | 'enterprise';
  seatCount: number;
  monthlyRevenueUsd: number;
  status: 'active' | 'trial' | 'paused' | 'churned';
  ownerUserId: string;
  billingEmail?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type AnalyticsEventType =
  | 'feature_view'
  | 'invoice_created'
  | 'ocr_scan'
  | 'voice_session'
  | 'ad_impression'
  | 'affiliate_click'
  | 'pro_upgrade'
  | 'org_created'
  | 'vision_collab';

export interface AnalyticsEventRecord {
  id: string;
  eventType: AnalyticsEventType;
  featureWindow: string;
  userId: string;
  organizationId?: string;
  metadata?: string;
  revenueImpactUsd?: number;
  createdAt: string;
}

export interface AppState {
  transactions: Transaction[];
  invoices: Invoice[];
  goals: Goal[];
  watchlist: string[];
  user: {
    name: string;
    monthlyBudget: number;
  };
}