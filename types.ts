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
  | 'expenses'
  | 'invoices'
  | 'scanner'
  | 'markets'
  | 'agent'
  | 'vision'
  | 'pricing'
  | 'settings'
  | 'profile'
  | 'admin';

export type PlanTier = 'free' | 'day' | 'pro';

export type BillingCycle = 'daily' | 'monthly' | 'annual';
export type PaymentRegion = 'IN' | 'INTL';
export type PaymentRail = 'UPI_QR' | 'UPI_ID' | 'PAYPAL';

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
  paymentRail: PaymentRail | 'CARD' | 'WALLET';
  connector: string;
  status: 'succeeded' | 'processing' | 'requires_action' | 'failed';
  referenceCode: string;
  createdAt: string;
}

export interface MerchantPayoutConfig {
  upiId: string;
  payeeName: string;
  bankName?: string;
  accountHolder?: string;
  accountNumber?: string;
  ifscCode?: string;
  paypalEnabled?: boolean;
  paypalEnvironment?: 'sandbox' | 'live';
  paypalClientId?: string;
  paypalClientSecret?: string;
  paypalMerchantEmail?: string;
  hasPaypalConfigured?: boolean;
  updatedAt?: string;
}

export type VisualStylePreset =
  | 'auto'
  | 'photorealistic'
  | 'cinematic'
  | 'editorial_3d'
  | 'illustration'
  | 'watercolor';

export type VisualAspectRatio = '16:9' | '1:1' | '4:3' | '9:16';

export interface AiImageConfig {
  aiHordeEnabled: boolean;
  aiHordeApiKey?: string;
  hasAiHordeKey?: boolean;
  cloudflareEnabled: boolean;
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;
  hasCloudflareConfigured?: boolean;
  huggingfaceEnabled: boolean;
  huggingfaceToken?: string;
  hasHuggingfaceConfigured?: boolean;
  queueTimeoutSec: number;
  activeTurboMode?: boolean;
  updatedAt?: string;
}

export interface ImageRenderJobState {
  jobId: string;
  status: 'queued' | 'processing' | 'fallback' | 'completed' | 'failed' | 'cancelled';
  provider: string;
  model?: string;
  stageLabel: string;
  queuePosition?: number | null;
  waitTimeSec?: number | null;
  progressPercent: number;
  elapsedSec: number;
  result?: {
    imageUrl: string;
    format: 'raster' | 'vector-fallback';
    mode: 'ai-raster' | 'ai-vector-fallback' | 'offline-vector-fallback';
    statusMessage: string;
    provider: string;
    model?: string;
  };
  error?: string;
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
export type SlideTheme =
  | 'ivory'
  | 'midnight'
  | 'emerald'
  | 'cobalt'
  | 'ledger'
  | 'navy'
  | 'charcoal'
  | 'growth';
export type SlideFontStyle = 'swiss_sans' | 'editorial_serif' | 'mono_quant' | 'executive_geometric';
export type SlideContentStyle = 'short' | 'brief' | 'medium' | 'detailed';
export type SlideGraphicsStyle = 'charts' | 'diagrams' | 'cards' | 'roadmap' | 'minimal';

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

export interface SlideChartBar {
  label: string;
  value: number;
  unit?: string;
}

export interface SlideItem {
  id: string;
  title: string;
  subtitle?: string;
  bullets: string[];
  layout: 'cover' | 'two-col' | 'metrics' | 'roadmap';
  theme?: SlideTheme;
  fontStyle?: SlideFontStyle;
  contentStyle?: SlideContentStyle;
  graphicsStyle?: SlideGraphicsStyle;
  metricHighlight?: string;
  chartBars?: SlideChartBar[];
}

export interface CollabNote {
  id: string;
  author: string;
  text: string;
  kind: 'note' | 'decision' | 'action';
  createdAt: string;
}

export type UserAccessStatus = 'active' | 'revoked' | 'blocked';

export interface UserAccessRecord {
  userId: string;
  email?: string;
  displayName?: string;
  status: UserAccessStatus;
  revokedAfterMs: number;
  reason?: string;
  updatedBy?: string;
  updatedAt: string;
}

export interface CollabParticipant {
  clientId: string;
  peerId?: string;
  name: string;
  role: string;
  color: string;
  joinedAt: string;
  isHost?: boolean;
  micOn?: boolean;
  camOn?: boolean;
  screenOn?: boolean;
  handRaised?: boolean;
}

export interface CollabWaitingPeer {
  clientId: string;
  name: string;
  role: string;
  requestedAt: string;
}

export interface CollabDeniedEntry {
  guestKey: string;
  name: string;
  deniedAt: string;
}

export interface CollabChatMessage {
  id: string;
  clientId: string;
  senderName: string;
  senderColor: string;
  text: string;
  createdAt: string;
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
export type InvoiceTemplateStyle = 'swiss' | 'classic' | 'minimal' | 'corporate' | 'executive';
export type InvoicePaperFormat = 'a4' | 'letter' | 'thermal80';

export interface ReceiptExtractionLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxPercent?: number;
  total: number;
}

export interface ReceiptExtractionResult {
  merchant: string;
  amount: number;
  date: string;
  category: string;
  invoiceNumber?: string;
  senderDetails?: string;
  currency?: string;
  subtotal?: number;
  taxTotal?: number;
  paymentMethod?: string;
  notes?: string;
  isHandwritten?: boolean;
  items?: ReceiptExtractionLineItem[];
}

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
  paypalId?: string;
  paymentRegion?: PaymentRegion;
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
  paymentMethod?: 'UPI' | 'CARD' | 'CASH' | 'SCAN_RECEIPT' | 'INVOICE' | 'PAYPAL';
  notes?: string;
}

export interface FinancialContextSnapshot {
  currencySymbol: string;
  transactions: Transaction[];
  invoices: Invoice[];
  watchlist: string[];
  stockPortfolio: StockPortfolioState;
  goalsCount: number;
}

export interface AgentLedgerOperations {
  addTransactions?: Array<Omit<Transaction, 'id' | 'status'> & { status?: 'completed' | 'pending' }>;
  updateTransactions?: Array<{ id: string; updates: Partial<Transaction> }>;
  deleteTransactionIds?: string[];
  markInvoicesPaid?: Array<{ id: string; paymentMethod?: string; upiReference?: string }>;
}

export interface AgentChartDatum {
  label: string;
  value: number;
  secondaryValue?: number;
}

export interface AgentChartSpec {
  id: string;
  title: string;
  subtitle?: string;
  chartType: 'bar' | 'pie' | 'trend';
  currencySymbol?: string;
  data: AgentChartDatum[];
}

export interface AgentCsvExportSpec {
  filename: string;
  title: string;
  headers: string[];
  rows: Array<Array<string | number>>;
  csvContent: string;
}

export interface AgentPdfReportSpec {
  filename: string;
  title: string;
  subtitle?: string;
  generatedAt?: string;
  currencySymbol?: string;
  kpis?: Array<{ label: string; value: string }>;
  sections: Array<{
    heading: string;
    bullets?: string[];
    table?: {
      headers: string[];
      rows: Array<Array<string | number>>;
    };
  }>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
  images?: string[];
  attachmentName?: string;
  groundingUrls?: Array<{title: string, uri: string}>;
  activatedTools?: string[];
  appliedSummary?: string;
  charts?: AgentChartSpec[];
  csvExport?: AgentCsvExportSpec;
  pdfReport?: AgentPdfReportSpec;
}

export interface ChatSessionRecord {
  sessionId: string;
  userId: string;
  title: string;
  mode: 'chat' | 'agent' | 'ocr' | 'web';
  preview?: string;
  messages: Array<Omit<ChatMessage, 'timestamp'> & { timestamp: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface AiSkillRecord {
  skillId: string;
  userId: string;
  name: string;
  slug: string;
  source: 'builtin' | 'skills.sh' | 'custom';
  category: string;
  description?: string;
  triggers?: string;
  instructionsMarkdown: string;
  author?: string;
  repo?: string;
  installs?: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface McpConnectorRecord {
  connectorId: string;
  userId: string;
  name: string;
  slug: string;
  providerType: 'builtin' | 'catalog' | 'custom';
  category: string;
  description?: string;
  endpointUrl?: string;
  transport: 'builtin' | 'http' | 'sse';
  authType?: 'none' | 'bearer' | 'api_key';
  authCredentialMasked?: string;
  toolsList?: string[];
  status: 'connected' | 'disconnected' | 'error';
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillsShCatalogItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  author: string;
  repo: string;
  installs: number;
  triggers: string;
  instructionsMarkdown: string;
  sourceUrl?: string;
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