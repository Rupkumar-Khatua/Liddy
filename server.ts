import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Type, Modality, ThinkingLevel, type LiveServerMessage, type FunctionDeclaration } from '@google/genai';
import { CURATED_FINANCE_SKILLS, MCP_CONNECTOR_TEMPLATES } from './services/agentExtensionsData';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadFirebaseWebApiKey(): string {
  try {
    const cfgPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (parsed?.apiKey) return String(parsed.apiKey);
    }
  } catch (err) {
    console.warn('[Firebase Server] Could not read firebase-applet-config.json:', err);
  }
  return process.env.VITE_FIREBASE_API_KEY || '';
}

const FIREBASE_WEB_API_KEY = loadFirebaseWebApiKey();

const app = express();
const server = http.createServer(app);

// Enable JSON payloads up to 25MB for document/image vision
app.use(express.json({ limit: '25mb' }));

// Explicitly advertise hardware capability permissions on document & API responses
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'microphone=*, camera=*, geolocation=*');
  next();
});

// ==========================================
// GEMINI CLIENT & QUOTA CIRCUIT BREAKER
// ==========================================
const PLATFORM_OWNER_EMAIL = 'rupk03793@gmail.com';
const SERVER_BOOT_TIME = Date.now();

const getAiClient = () => {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    console.warn('[Gemini Server] Warning: GEMINI_API_KEY / API_KEY is not configured.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
      timeout: 30000,
    },
  });
};

let quotaCooldownUntil = 0;
let hydrogenSlowUntil = 0;
let hydrogenCooldownUntil = 0;

function isQuotaError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  const status = err?.status || err?.code;
  return status === 429 || msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('quota');
}

function isDeadlineOrTimeoutError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  const status = err?.status || err?.code;
  return (
    status === 504 ||
    msg.includes('504') ||
    msg.includes('deadline_exceeded') ||
    msg.includes('deadline expired') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    err?.name === 'TimeoutError' ||
    err?.name === 'AbortError'
  );
}

export function shouldSkipGeminiCall(): boolean {
  if (!(process.env.API_KEY || process.env.GEMINI_API_KEY)) return true;
  return Date.now() < quotaCooldownUntil;
}

function markHydrogenUnavailable(err: any) {
  if (isQuotaError(err)) {
    hydrogenCooldownUntil = Math.max(hydrogenCooldownUntil, Date.now() + 5 * 60 * 1000);
  } else if (isDeadlineOrTimeoutError(err)) {
    hydrogenSlowUntil = Math.max(hydrogenSlowUntil, Date.now() + 90 * 1000);
  }
}

async function generateWithHydrogenFailover(
  ai: GoogleGenAI,
  params: {
    contents: any;
    config?: Record<string, any>;
    timeoutMs?: number;
  }
) {
  const timeoutMs = params.timeoutMs ?? 18000;
  const skipHydrogen = Date.now() < hydrogenCooldownUntil || Date.now() < hydrogenSlowUntil;

  if (!skipHydrogen) {
    try {
      return await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: params.contents,
        config: {
          ...(params.config || {}),
          abortSignal: AbortSignal.timeout(timeoutMs),
        },
      });
    } catch (err: any) {
      if (!isQuotaError(err) && !isDeadlineOrTimeoutError(err)) {
        throw err;
      }
      markHydrogenUnavailable(err);
      console.warn('[Gemini Failover] gemini-4-hydrogen unavailable, retrying on gemini-3.1-flash-lite:', err?.message || err);
    }
  }

  const liteConfig: Record<string, any> = {
    ...(params.config || {}),
    abortSignal: AbortSignal.timeout(Math.max(timeoutMs, 18000)),
  };
  if (liteConfig.thinkingConfig) {
    liteConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };
  }

  return await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: params.contents,
    config: liteConfig,
  });
}

// ==========================================
// SERVER TELEMETRY, INCIDENTS & ADMIN CONTROLS
// ==========================================
type IncidentSubsystem = 'AI' | 'Payments' | 'Markets' | 'WebSockets' | 'Auth' | 'Client' | 'Server';
type IncidentSeverity = 'critical' | 'error' | 'warning';

interface ServerIncidentRecord {
  id: string;
  timestamp: string;
  severity: IncidentSeverity;
  subsystem: IncidentSubsystem;
  source: string;
  statusCode: number;
  message: string;
  status: 'open' | 'acknowledged' | 'resolved';
  occurrences: number;
}

interface ApiEndpointMetric {
  routeKey: string;
  method: string;
  path: string;
  subsystem: IncidentSubsystem | 'Analytics' | 'Admin' | 'Mail';
  totalCalls: number;
  successCount: number;
  errorCount: number;
  totalLatencyMs: number;
  lastLatencyMs: number;
  lastStatus: number | null;
  lastCalledAt: string | null;
  lastError: string | null;
}

interface ServiceControlState {
  aiVision: boolean;
  aiAssistant: boolean;
  paymentsGateway: boolean;
  marketStream: boolean;
  collabRooms: boolean;
  liveVoice: boolean;
  maintenanceBanner: string;
  updatedAt: string;
}

const serviceControls: ServiceControlState = {
  aiVision: true,
  aiAssistant: true,
  paymentsGateway: true,
  marketStream: true,
  collabRooms: true,
  liveVoice: true,
  maintenanceBanner: '',
  updatedAt: new Date().toISOString(),
};

const runtimeIncidents: ServerIncidentRecord[] = [];
const apiMetricsMap = new Map<string, ApiEndpointMetric>();

function classifySubsystem(reqPath: string): ApiEndpointMetric['subsystem'] {
  if (reqPath.startsWith('/api/admin')) return 'Admin';
  if (reqPath.startsWith('/api/payments')) return 'Payments';
  if (reqPath.startsWith('/api/markets')) return 'Markets';
  if (reqPath.startsWith('/api/gemini')) return 'AI';
  if (reqPath.startsWith('/api/analytics')) return 'Analytics';
  if (reqPath.startsWith('/api/mail')) return 'Mail';
  return 'Server';
}

const KNOWN_API_ENDPOINTS: Array<{ method: string; path: string; subsystem: ApiEndpointMetric['subsystem'] }> = [
  { method: 'GET', path: '/api/health', subsystem: 'Server' },
  { method: 'GET', path: '/api/markets/snapshot', subsystem: 'Markets' },
  { method: 'POST', path: '/api/analytics/event', subsystem: 'Analytics' },
  { method: 'GET', path: '/api/analytics/summary', subsystem: 'Analytics' },
  { method: 'GET', path: '/api/analytics/organizations', subsystem: 'Analytics' },
  { method: 'POST', path: '/api/analytics/organizations', subsystem: 'Analytics' },
  { method: 'GET', path: '/api/payments/payout-config', subsystem: 'Payments' },
  { method: 'GET', path: '/api/payments/payout-config/public', subsystem: 'Payments' },
  { method: 'POST', path: '/api/payments/payout-config', subsystem: 'Payments' },
  { method: 'GET', path: '/api/payments/methods', subsystem: 'Payments' },
  { method: 'POST', path: '/api/payments/create-intent', subsystem: 'Payments' },
  { method: 'POST', path: '/api/payments/authorize-rail', subsystem: 'Payments' },
  { method: 'POST', path: '/api/payments/email-otp/send', subsystem: 'Payments' },
  { method: 'POST', path: '/api/payments/email-otp/verify', subsystem: 'Payments' },
  { method: 'POST', path: '/api/payments/confirm', subsystem: 'Payments' },
  { method: 'POST', path: '/api/payments/paypal/create-order', subsystem: 'Payments' },
  { method: 'POST', path: '/api/payments/paypal/capture-order', subsystem: 'Payments' },
  { method: 'POST', path: '/api/payments/receipt-email', subsystem: 'Payments' },
  { method: 'GET', path: '/api/payments/history', subsystem: 'Payments' },
  { method: 'POST', path: '/api/gemini/vision-mindmap', subsystem: 'AI' },
  { method: 'POST', path: '/api/gemini/vision-slides', subsystem: 'AI' },
  { method: 'POST', path: '/api/gemini/generate-image', subsystem: 'AI' },
  { method: 'POST', path: '/api/gemini/image-jobs', subsystem: 'AI' },
  { method: 'GET', path: '/api/gemini/image-jobs/:jobId', subsystem: 'AI' },
  { method: 'POST', path: '/api/gemini/image-jobs/:jobId/fallback', subsystem: 'AI' },
  { method: 'GET', path: '/api/ai/image-config/public', subsystem: 'AI' },
  { method: 'POST', path: '/api/gemini/enhance-prompt', subsystem: 'AI' },
  { method: 'POST', path: '/api/gemini/agent', subsystem: 'AI' },
  { method: 'GET', path: '/api/skills/search', subsystem: 'AI' },
  { method: 'POST', path: '/api/mcp/inspect', subsystem: 'AI' },
  { method: 'POST', path: '/api/gemini/receipt', subsystem: 'AI' },
  { method: 'POST', path: '/api/gemini/automation', subsystem: 'AI' },
  { method: 'POST', path: '/api/gemini/tts', subsystem: 'AI' },
  { method: 'POST', path: '/api/gemini/voice-memo', subsystem: 'AI' },
  { method: 'GET', path: '/api/gemini/market-news', subsystem: 'Markets' },
  { method: 'POST', path: '/api/gemini/search-news', subsystem: 'Markets' },
  { method: 'POST', path: '/api/gemini/search-ticker', subsystem: 'Markets' },
  { method: 'POST', path: '/api/gemini/generate-invoice', subsystem: 'AI' },
  { method: 'POST', path: '/api/gemini/perfect-invoice', subsystem: 'AI' },
  { method: 'GET', path: '/api/admin/system-state', subsystem: 'Admin' },
  { method: 'POST', path: '/api/admin/service-controls', subsystem: 'Admin' },
  { method: 'POST', path: '/api/admin/actions', subsystem: 'Admin' },
  { method: 'GET', path: '/api/admin/payout-config', subsystem: 'Admin' },
  { method: 'POST', path: '/api/admin/payout-config', subsystem: 'Admin' },
  { method: 'GET', path: '/api/admin/ai-image-config', subsystem: 'Admin' },
  { method: 'POST', path: '/api/admin/ai-image-config', subsystem: 'Admin' },
  { method: 'POST', path: '/api/admin/ai-image-probe', subsystem: 'Admin' },
  { method: 'POST', path: '/api/ops/report-error', subsystem: 'Server' },
];

for (const ep of KNOWN_API_ENDPOINTS) {
  const key = `${ep.method} ${ep.path}`;
  apiMetricsMap.set(key, {
    routeKey: key,
    method: ep.method,
    path: ep.path,
    subsystem: ep.subsystem,
    totalCalls: 0,
    successCount: 0,
    errorCount: 0,
    totalLatencyMs: 0,
    lastLatencyMs: 0,
    lastStatus: null,
    lastCalledAt: null,
    lastError: null,
  });
}

function recordFailure(
  severity: IncidentSeverity,
  subsystem: IncidentSubsystem,
  source: string,
  statusCode: number,
  message: string
) {
  const cleanMsg = String(message || 'Unexpected error').slice(0, 400);
  const existingOpen = runtimeIncidents.find(
    (item) => item.status !== 'resolved' && item.source === source && item.message === cleanMsg
  );
  if (existingOpen) {
    existingOpen.occurrences += 1;
    existingOpen.timestamp = new Date().toISOString();
    existingOpen.statusCode = statusCode || existingOpen.statusCode;
    return;
  }
  runtimeIncidents.unshift({
    id: `inc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    severity,
    subsystem,
    source: source.slice(0, 120),
    statusCode: statusCode || 500,
    message: cleanMsg,
    status: 'open',
    occurrences: 1,
  });
  if (runtimeIncidents.length > 150) {
    runtimeIncidents.length = 150;
  }
}

export function markQuotaExhausted(err?: any) {
  if (isQuotaError(err)) {
    quotaCooldownUntil = Date.now() + 15 * 1000;
    recordFailure('warning', 'AI', 'Gemini Quota Cooldown', 429, String(err?.message || 'Rate limit / quota reached'));
  }
}

interface ServerUserAccessRecord {
  userId: string;
  email?: string;
  displayName?: string;
  status: 'active' | 'revoked' | 'blocked';
  revokedAfterMs: number;
  reason?: string;
  updatedBy?: string;
  updatedAt: string;
}

const USER_ACCESS_FILE = path.join(process.cwd(), '.liddy_user_access.json');
const runtimeUserAccessMap = new Map<string, ServerUserAccessRecord>();

function loadUserAccessStore() {
  try {
    if (fs.existsSync(USER_ACCESS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(USER_ACCESS_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        parsed.forEach((rec: ServerUserAccessRecord) => {
          if (rec?.userId) runtimeUserAccessMap.set(rec.userId, rec);
        });
      }
    }
  } catch {}
}

function saveUserAccessStore() {
  try {
    fs.writeFileSync(USER_ACCESS_FILE, JSON.stringify(Array.from(runtimeUserAccessMap.values()), null, 2));
  } catch {}
}

loadUserAccessStore();

function findUserAccessRecord(uid?: string | null, email?: string | null): ServerUserAccessRecord | null {
  if (uid && runtimeUserAccessMap.has(uid)) {
    return runtimeUserAccessMap.get(uid) || null;
  }
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (cleanEmail) {
    for (const rec of runtimeUserAccessMap.values()) {
      if (rec.email && rec.email.toLowerCase() === cleanEmail) {
        return rec;
      }
    }
  }
  return null;
}

function decodeFirebaseJwtClaims(idToken: string): { uid?: string; email?: string; iatMs?: number; authTimeMs?: number } | null {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    const uid = typeof json.user_id === 'string' ? json.user_id : typeof json.sub === 'string' ? json.sub : undefined;
    const email = typeof json.email === 'string' ? json.email.toLowerCase() : undefined;
    const iatMs = typeof json.iat === 'number' ? json.iat * 1000 : undefined;
    const authTimeMs = typeof json.auth_time === 'number' ? json.auth_time * 1000 : undefined;
    return { uid, email, iatMs, authTimeMs };
  } catch {
    return null;
  }
}

async function verifyAdminRequest(req: express.Request): Promise<{ ok: boolean; uid?: string; email?: string; status?: number; error?: string }> {
  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) {
    return { ok: false, status: 401, error: 'Missing admin Authorization Bearer token.' };
  }
  if (!FIREBASE_WEB_API_KEY) {
    return { ok: false, status: 503, error: 'Firebase identity configuration is missing on server.' };
  }
  try {
    const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const data: any = await resp.json().catch(() => ({}));
    const user = data?.users?.[0];
    if (!resp.ok || !user?.localId) {
      return { ok: false, status: 401, error: data?.error?.message || 'Invalid or expired admin session token.' };
    }
    const email = String(user.email || '').toLowerCase();
    const verified = Boolean(user.emailVerified);
    const accessRec = findUserAccessRecord(user.localId, email);
    if (accessRec?.status === 'blocked' && email !== PLATFORM_OWNER_EMAIL) {
      return { ok: false, status: 403, error: 'Your account has been blocked by the platform administrator.' };
    }
    if (email === PLATFORM_OWNER_EMAIL && verified) {
      return { ok: true, uid: user.localId, email };
    }
    return { ok: false, status: 403, error: `Access denied for ${email || user.localId}. Owner verification required.` };
  } catch (err: any) {
    return { ok: false, status: 502, error: err?.message || 'Failed to verify admin token.' };
  }
}

// Enforce blocked/revoked user access + track all /api/* requests + enforce Admin maintenance switches
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();

  if (req.path !== '/api/access/status' && req.path !== '/api/health') {
    const authHeader = String(req.headers.authorization || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const claims = idToken ? decodeFirebaseJwtClaims(idToken) : null;
    const reqUid = claims?.uid || String(req.headers['x-liddy-uid'] || '').trim() || undefined;
    const reqEmail = claims?.email || String(req.headers['x-liddy-email'] || '').trim().toLowerCase() || undefined;

    if ((reqUid || reqEmail) && reqEmail !== PLATFORM_OWNER_EMAIL) {
      const accessRec = findUserAccessRecord(reqUid, reqEmail);
      if (accessRec?.status === 'blocked') {
        return res.status(403).json({
          error: 'Your account has been blocked from using Liddy by an administrator.',
          code: 'ACCOUNT_BLOCKED',
        });
      }
      if (accessRec?.status === 'revoked') {
        const tokenIssuedMs = claims?.authTimeMs || claims?.iatMs || 0;
        if (!tokenIssuedMs || tokenIssuedMs < accessRec.revokedAfterMs) {
          return res.status(401).json({
            error: 'Your session was revoked by an administrator. Please sign in again.',
            code: 'SESSION_REVOKED',
          });
        }
      }
    }
  }

  const started = Date.now();
  const normPath = req.path
    .replace(/\/org-[^/]+$/, '/:orgId')
    .replace(/\/imgjob_[a-zA-Z0-9_-]+(\/fallback)?$/, '/:jobId$1');
  const key = `${req.method} ${normPath}`;

  if (
    (normPath.startsWith('/api/gemini/vision-') ||
      normPath === '/api/gemini/generate-image' ||
      normPath.startsWith('/api/gemini/image-jobs') ||
      normPath === '/api/gemini/enhance-prompt') &&
    !serviceControls.aiVision
  ) {
    return res.status(503).json({
      error: serviceControls.maintenanceBanner || 'Vision AI studio is currently paused by the platform administrator.',
    });
  }
  if (
    (normPath === '/api/gemini/agent' ||
      normPath === '/api/gemini/receipt' ||
      normPath === '/api/gemini/automation' ||
      normPath === '/api/gemini/tts' ||
      normPath === '/api/gemini/voice-memo' ||
      normPath === '/api/gemini/generate-invoice' ||
      normPath === '/api/gemini/perfect-invoice') &&
    !serviceControls.aiAssistant
  ) {
    return res.status(503).json({
      error: serviceControls.maintenanceBanner || 'AI Assistant services are currently paused by the administrator.',
    });
  }
  if (
    normPath.startsWith('/api/payments/') &&
    !normPath.startsWith('/api/payments/payout-config') &&
    normPath !== '/api/payments/history' &&
    !serviceControls.paymentsGateway
  ) {
    return res.status(503).json({
      error: serviceControls.maintenanceBanner || 'Payments checkout gateway is temporarily paused for maintenance.',
    });
  }
  if (
    (normPath.startsWith('/api/markets/') || normPath === '/api/gemini/market-news' || normPath.startsWith('/api/gemini/search-')) &&
    !serviceControls.marketStream
  ) {
    return res.status(503).json({
      error: serviceControls.maintenanceBanner || 'Live market data services are temporarily paused by the administrator.',
    });
  }

  res.on('finish', () => {
    const latency = Date.now() - started;
    const existing = apiMetricsMap.get(key) || {
      routeKey: key,
      method: req.method,
      path: normPath,
      subsystem: classifySubsystem(normPath),
      totalCalls: 0,
      successCount: 0,
      errorCount: 0,
      totalLatencyMs: 0,
      lastLatencyMs: 0,
      lastStatus: null,
      lastCalledAt: null,
      lastError: null,
    };
    existing.totalCalls += 1;
    existing.totalLatencyMs += latency;
    existing.lastLatencyMs = latency;
    existing.lastStatus = res.statusCode;
    existing.lastCalledAt = new Date().toISOString();
    if (res.statusCode >= 400) {
      existing.errorCount += 1;
      existing.lastError = `HTTP ${res.statusCode}`;
      if (res.statusCode >= 500) {
        recordFailure('error', classifySubsystem(normPath) as IncidentSubsystem, key, res.statusCode, `Endpoint returned HTTP ${res.statusCode}`);
      }
    } else {
      existing.successCount += 1;
    }
    apiMetricsMap.set(key, existing);
  });

  next();
});

// ==========================================
// REAL-TIME MARKET AGGREGATOR & STREAM ENGINE
// ==========================================
interface LiveIndexItem {
  name: string;
  symbol: string;
  value: string;
  rawPrice: number;
  change: string;
  isPositive: boolean;
  currency?: string;
}

interface LiveCompanyItem {
  ticker: string;
  yahooSymbol: string;
  name: string;
  exchange: 'NYSE / NASDAQ' | 'NSE / BSE' | 'LSE / Euronext' | 'TSE / HKEX';
  sector: string;
  marketCap: string;
  sharesOutstanding?: number;
  price: string;
  rawPrice: number;
  change: string;
  isPositive: boolean;
  volume: string;
  peRatio?: string;
  week52High?: string;
  week52Low?: string;
  headquarters?: string;
  ceo?: string;
  description?: string;
  investorUrl?: string;
  dividendYield?: string;
  currencyCode?: string;
  country?: string;
}

interface LiveNewsItem {
  title: string;
  source: string;
  summary: string;
  category: string;
  timeAgo: string;
  url: string;
  publishedAt?: string;
  impact?: 'HIGH' | 'MEDIUM' | 'MACRO';
  sentiment?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

interface ExchangeClockStatus {
  region: string;
  isOpen: boolean;
  time: string;
  localTime: string;
}

function isExchangeOpenInTz(timeZone: string, openHour: number, openMin: number, closeHour: number, closeMin: number): { isOpen: boolean; localTime: string } {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const weekday = parts.find(p => p.type === 'weekday')?.value || '';
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);

    const isWeekday = !['Sat', 'Sun'].includes(weekday);
    const mins = hour * 60 + minute;
    const startMins = openHour * 60 + openMin;
    const endMins = closeHour * 60 + closeMin;

    return {
      isOpen: isWeekday && mins >= startMins && mins < endMins,
      localTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    };
  } catch {
    return { isOpen: false, localTime: '--:--' };
  }
}

function computeLiveMarketStatus(): ExchangeClockStatus[] {
  const nyse = isExchangeOpenInTz('America/New_York', 9, 30, 16, 0);
  const nse = isExchangeOpenInTz('Asia/Kolkata', 9, 15, 15, 30);
  const lse = isExchangeOpenInTz('Europe/London', 8, 0, 16, 30);
  const tse = isExchangeOpenInTz('Asia/Tokyo', 9, 0, 15, 0);

  return [
    { region: 'US (NYSE / NASDAQ)', isOpen: nyse.isOpen, time: '09:30 - 16:00 ET', localTime: nyse.localTime },
    { region: 'India (NSE / BSE)', isOpen: nse.isOpen, time: '09:15 - 15:30 IST', localTime: nse.localTime },
    { region: 'Europe (LSE / Euronext)', isOpen: lse.isOpen, time: '08:00 - 16:30 UK', localTime: lse.localTime },
    { region: 'Asia (Tokyo / HKEX)', isOpen: tse.isOpen, time: '09:00 - 15:00 JST', localTime: tse.localTime },
  ];
}

function formatNumber(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatPriceByCurrency(price: number, currency?: string, exchange?: string): string {
  const c = (currency || '').toUpperCase();
  if (c === 'INR' || exchange === 'NSE / BSE') {
    return `${formatNumber(price, 2)} ₹`;
  }
  if (c === 'EUR') {
    return `€${formatNumber(price, 2)}`;
  }
  if (c === 'GBP') {
    return `£${formatNumber(price, 2)}`;
  }
  if (c === 'JPY') {
    return `¥${formatNumber(price, 0)}`;
  }
  if (c === 'HKD') {
    return `HK$${formatNumber(price, 2)}`;
  }
  if (c === 'TWD') {
    return `NT$${formatNumber(price, 1)}`;
  }
  return `$${formatNumber(price, 2)}`;
}

function formatVolume(vol?: number): string {
  if (!vol || !isFinite(vol) || vol <= 0) return '—';
  if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`;
  if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
  return String(Math.round(vol));
}

function formatMarketCap(price: number, shares?: number, currency?: string, exchange?: string, fallback?: string): string {
  if (!shares || !price || !isFinite(price)) return fallback || '—';
  const rawCap = price * shares;
  const c = (currency || '').toUpperCase();
  if (c === 'INR' || exchange === 'NSE / BSE') {
    const lakhCr = rawCap / 1e12;
    if (lakhCr >= 1) return `₹${lakhCr.toFixed(2)} Lakh Cr`;
    const cr = rawCap / 1e7;
    return `₹${Math.round(cr).toLocaleString('en-IN')} Cr`;
  }
  const sym = c === 'EUR' ? '€' : c === 'JPY' ? '¥' : c === 'HKD' ? 'HK$' : c === 'GBP' ? '£' : '$';
  if (rawCap >= 1e12) return `${sym}${(rawCap / 1e12).toFixed(2)}T`;
  if (rawCap >= 1e9) return `${sym}${(rawCap / 1e9).toFixed(1)}B`;
  if (rawCap >= 1e6) return `${sym}${(rawCap / 1e6).toFixed(0)}M`;
  return fallback || '—';
}

function computeRelativeTimeAgo(dateInput?: string | number): string {
  if (!dateInput) return 'Just now';
  const ms = typeof dateInput === 'number'
    ? (dateInput < 1e12 ? dateInput * 1000 : dateInput)
    : Date.parse(dateInput);
  if (!ms || isNaN(ms)) return 'Recent';
  const diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferNewsMetadata(title: string, summary: string): {
  category: string;
  impact: 'HIGH' | 'MEDIUM' | 'MACRO';
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
} {
  const txt = `${title} ${summary}`.toLowerCase();
  let category = 'Equities';
  if (txt.includes('fed') || txt.includes('inflation') || txt.includes('rate') || txt.includes('treasury') || txt.includes('gdp') || txt.includes('cpi') || txt.includes('central bank')) {
    category = 'Macroeconomics';
  } else if (txt.includes('india') || txt.includes('nifty') || txt.includes('sensex') || txt.includes('rbi') || txt.includes('reliance') || txt.includes('tcs') || txt.includes('infosys')) {
    category = 'India Equities';
  } else if (txt.includes('nvidia') || txt.includes('apple') || txt.includes('microsoft') || txt.includes('chip') || txt.includes('semiconductor') || txt.includes('ai ') || txt.includes('tech')) {
    category = 'Technology';
  } else if (txt.includes('bitcoin') || txt.includes('crypto') || txt.includes('ethereum')) {
    category = 'Digital Assets';
  } else if (txt.includes('bond') || txt.includes('yield')) {
    category = 'Fixed Income';
  }

  let sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (/surge|rally|soar|record|gain|beat|jump|rise|upgrade|growth|boom|bull/.test(txt)) {
    sentiment = 'BULLISH';
  } else if (/drop|fall|plunge|miss|cut|slump|decline|warning|selloff|crash|bear/.test(txt)) {
    sentiment = 'BEARISH';
  }

  const impact: 'HIGH' | 'MEDIUM' | 'MACRO' =
    category === 'Macroeconomics' ? 'MACRO' : /billion|trillion|record|earnings|fed|surge|plunge/.test(txt) ? 'HIGH' : 'MEDIUM';

  return { category, impact, sentiment };
}

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface YahooQuoteResult {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  volume?: number;
  week52High?: number;
  week52Low?: number;
  currency?: string;
  exchangeName?: string;
  shortName?: string;
  longName?: string;
}

function parseFormattedNumber(val: any): number | undefined {
  if (typeof val === 'number') return isFinite(val) ? val : undefined;
  if (typeof val !== 'string') return undefined;
  const cleaned = val.replace(/[,%\s+$€£¥₹]/g, '');
  if (!cleaned || cleaned.toUpperCase() === 'UNCH') return 0;
  const parsed = Number(cleaned);
  return isFinite(parsed) ? parsed : undefined;
}

async function fetchCnbcBatchQuotes(cnbcSymbols: string[]): Promise<Map<string, YahooQuoteResult>> {
  const resultMap = new Map<string, YahooQuoteResult>();
  if (cnbcSymbols.length === 0) return resultMap;
  try {
    const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(cnbcSymbols.join('|'))}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
    if (!resp.ok) return resultMap;
    const json: any = await resp.json();
    const quotes: any[] = json?.FormattedQuoteResult?.FormattedQuote || [];
    for (const q of quotes) {
      if (!q?.symbol || q.code !== 0) continue;
      let price = parseFormattedNumber(q.last);
      if (!price || price <= 0) continue;
      const rawCurrency = q.currencyCode;
      const isPence = rawCurrency === 'GBp' || rawCurrency === 'GBX';
      let week52High = parseFormattedNumber(q.yrhiprice);
      let week52Low = parseFormattedNumber(q.yrloprice);
      if (isPence) {
        price = price / 100;
        if (typeof week52High === 'number') week52High = week52High / 100;
        if (typeof week52Low === 'number') week52Low = week52Low / 100;
      }
      const changePct = typeof q.change_pct === 'string' && q.change_pct.toUpperCase() === 'UNCH'
        ? 0
        : (parseFormattedNumber(q.change_pct) ?? 0);
      const vol = parseFormattedNumber(q.volume);
      resultMap.set(q.symbol, {
        symbol: q.symbol,
        price,
        prevClose: changePct !== -100 ? price / (1 + changePct / 100) : price,
        changePct,
        volume: vol && vol > 0 ? vol : undefined,
        week52High: week52High && week52High > 0 ? week52High : undefined,
        week52Low: week52Low && week52Low > 0 ? week52Low : undefined,
        currency: isPence ? 'GBP' : rawCurrency,
        exchangeName: q.exchange,
        shortName: q.shortName,
        longName: q.name,
      });
    }
  } catch {
    // Fallback to Yahoo query2 per-symbol if CNBC temporarily unavailable
  }
  return resultMap;
}

async function fetchYahooChartQuote(yahooSymbol: string): Promise<YahooQuoteResult | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1m&range=1d`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
    if (!resp.ok) return null;
    const json: any = await resp.json();
    const result = json?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta || typeof meta.regularMarketPrice !== 'number') return null;

    let price = meta.regularMarketPrice;
    const rawCurrency = meta.currency;
    // Yahoo returns LSE UK stocks like AZN.L in GBp (pence). Convert GBp -> GBP cleanly.
    const isPence = rawCurrency === 'GBp' || rawCurrency === 'GBX';
    let prevClose = typeof meta.chartPreviousClose === 'number'
      ? meta.chartPreviousClose
      : (typeof meta.previousClose === 'number' ? meta.previousClose : price);
    let week52High = meta.fiftyTwoWeekHigh;
    let week52Low = meta.fiftyTwoWeekLow;

    if (isPence) {
      price = price / 100;
      prevClose = prevClose / 100;
      if (typeof week52High === 'number') week52High = week52High / 100;
      if (typeof week52Low === 'number') week52Low = week52Low / 100;
    }

    const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

    return {
      symbol: yahooSymbol,
      price,
      prevClose,
      changePct,
      volume: typeof meta.regularMarketVolume === 'number' ? meta.regularMarketVolume : undefined,
      week52High: typeof week52High === 'number' ? week52High : undefined,
      week52Low: typeof week52Low === 'number' ? week52Low : undefined,
      currency: isPence ? 'GBP' : rawCurrency,
      exchangeName: meta.fullExchangeName || meta.exchangeName,
      shortName: meta.shortName,
      longName: meta.longName,
    };
  } catch {
    return null;
  }
}

async function fetchCryptoQuotes(): Promise<{ btc?: { price: number; changePct: number }; eth?: { price: number; changePct: number } }> {
  // Primary: Binance 24hr Ticker API (real-time 24/7)
  try {
    const resp = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22%5D', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (resp.ok) {
      const arr: any[] = await resp.json();
      if (Array.isArray(arr) && arr.length > 0) {
        const btcRow = arr.find(r => r.symbol === 'BTCUSDT');
        const ethRow = arr.find(r => r.symbol === 'ETHUSDT');
        return {
          btc: btcRow ? { price: parseFloat(btcRow.lastPrice), changePct: parseFloat(btcRow.priceChangePercent) } : undefined,
          eth: ethRow ? { price: parseFloat(ethRow.lastPrice), changePct: parseFloat(ethRow.priceChangePercent) } : undefined,
        };
      }
    }
  } catch {
    // Fallback to CoinGecko
  }

  try {
    const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (resp.ok) {
      const data: any = await resp.json();
      return {
        btc: data?.bitcoin ? { price: Number(data.bitcoin.usd), changePct: Number(data.bitcoin.usd_24h_change) } : undefined,
        eth: data?.ethereum ? { price: Number(data.ethereum.usd), changePct: Number(data.ethereum.usd_24h_change) } : undefined,
      };
    }
  } catch {
    // Both unavailable
  }

  return {};
}

// Tracked benchmark indices (CNBC primary batch symbol + Yahoo fallback)
const INDEX_DEFINITIONS = [
  { name: 'S&P 500', symbol: '^GSPC', cnbcSymbol: '.SPX', fallbackPrice: 5864.67 },
  { name: 'NASDAQ 100', symbol: '^NDX', cnbcSymbol: '.NDX', fallbackPrice: 20324.18 },
  { name: 'NIFTY 50', symbol: '^NSEI', cnbcSymbol: '.NSEI', fallbackPrice: 24854.05 },
  { name: 'BSE SENSEX', symbol: '^BSESN', cnbcSymbol: '', fallbackPrice: 81224.75 },
  { name: 'FTSE 100', symbol: '^FTSE', cnbcSymbol: '.FTSE', fallbackPrice: 8358.25 },
  { name: 'NIKKEI 225', symbol: '^N225', cnbcSymbol: '.N225', fallbackPrice: 38981.75 },
];

const CNBC_COMPANY_SYMBOL_MAP: Record<string, string> = {
  SPY: 'SPY',
  QQQ: 'QQQ',
  AAPL: 'AAPL',
  MSFT: 'MSFT',
  NVDA: 'NVDA',
  GOOGL: 'GOOGL',
  AMZN: 'AMZN',
  META: 'META',
  TSLA: 'TSLA',
  RELIANCE: 'RELIANCE-IN',
  TCS: 'TCS-IN',
  HDFCBANK: 'HDFCBANK-IN',
  INFY: 'INFY-IN',
  ZOMATO: 'ETERNAL-IN',
  AZN: 'AZN.L',
  ASML: 'ASML-NL',
  MC: 'MC-FR',
  '7203': '7203.T',
  '0700': '0700.HK',
  '2330': '2330-TW',
};

// Global listed equity fundamentals + live Yahoo Finance symbol mapping
const BASE_COMPANIES: Array<Omit<LiveCompanyItem, 'price' | 'rawPrice' | 'change' | 'isPositive' | 'volume'> & { fallbackPrice: number }> = [
  {
    ticker: 'SPY',
    yahooSymbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    exchange: 'NYSE / NASDAQ',
    sector: 'Broad Market S&P 500 Index ETF',
    marketCap: '$595B',
    sharesOutstanding: 9.18e8,
    fallbackPrice: 584.20,
    peRatio: '27.8x',
    headquarters: 'Boston, MA, USA',
    ceo: 'Yie-Hsin Hung',
    description: 'The world’s largest and most actively traded ETF, tracking the benchmark S&P 500 large-cap US equities index.',
    investorUrl: 'https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-500-etf-trust-spy',
    dividendYield: '1.22%',
    currencyCode: 'USD',
    country: 'United States'
  },
  {
    ticker: 'QQQ',
    yahooSymbol: 'QQQ',
    name: 'Invesco QQQ Trust (Nasdaq-100)',
    exchange: 'NYSE / NASDAQ',
    sector: 'Technology & Large-Cap Innovation ETF',
    marketCap: '$292B',
    sharesOutstanding: 6.08e8,
    fallbackPrice: 495.60,
    peRatio: '31.4x',
    headquarters: 'Downers Grove, IL, USA',
    ceo: 'Andrew Schlossberg',
    description: 'Tracks the Nasdaq-100 Index, providing concentrated exposure to global technology and innovation leaders.',
    investorUrl: 'https://www.invesco.com/qqq-etf/',
    dividendYield: '0.58%',
    currencyCode: 'USD',
    country: 'United States'
  },
  {
    ticker: 'AAPL',
    yahooSymbol: 'AAPL',
    name: 'Apple Inc.',
    exchange: 'NYSE / NASDAQ',
    sector: 'Consumer Hardware & Services',
    marketCap: '$3.54T',
    sharesOutstanding: 1.50e10,
    fallbackPrice: 232.50,
    peRatio: '34.8x',
    headquarters: 'Cupertino, CA, USA',
    ceo: 'Tim Cook',
    description: 'Designs, manufactures and markets iPhone, Mac, iPad, wearables, Apple Silicon and recurring cloud/media services.',
    investorUrl: 'https://investor.apple.com',
    dividendYield: '0.43%',
    currencyCode: 'USD',
    country: 'United States'
  },
  {
    ticker: 'MSFT',
    yahooSymbol: 'MSFT',
    name: 'Microsoft Corporation',
    exchange: 'NYSE / NASDAQ',
    sector: 'Enterprise Cloud & Platforms',
    marketCap: '$3.24T',
    sharesOutstanding: 7.43e9,
    fallbackPrice: 435.20,
    peRatio: '36.2x',
    headquarters: 'Redmond, WA, USA',
    ceo: 'Satya Nadella',
    description: 'Global enterprise software and Azure hyperscale cloud computing leader powering workplace productivity and developer ecosystems.',
    investorUrl: 'https://www.microsoft.com/en-us/investor',
    dividendYield: '0.71%',
    currencyCode: 'USD',
    country: 'United States'
  },
  {
    ticker: 'NVDA',
    yahooSymbol: 'NVDA',
    name: 'NVIDIA Corporation',
    exchange: 'NYSE / NASDAQ',
    sector: 'Semiconductors & Accelerated Compute',
    marketCap: '$3.35T',
    sharesOutstanding: 2.45e10,
    fallbackPrice: 138.40,
    peRatio: '58.4x',
    headquarters: 'Santa Clara, CA, USA',
    ceo: 'Jensen Huang',
    description: 'Pioneers GPU-accelerated computing, datacenter AI clusters, CUDA software platform and high-speed networking fabrics.',
    investorUrl: 'https://investor.nvidia.com',
    dividendYield: '0.03%',
    currencyCode: 'USD',
    country: 'United States'
  },
  {
    ticker: 'GOOGL',
    yahooSymbol: 'GOOGL',
    name: 'Alphabet Inc.',
    exchange: 'NYSE / NASDAQ',
    sector: 'Global Search, Cloud & Systems',
    marketCap: '$2.18T',
    sharesOutstanding: 1.22e10,
    fallbackPrice: 178.60,
    peRatio: '24.3x',
    headquarters: 'Mountain View, CA, USA',
    ceo: 'Sundar Pichai',
    description: 'Operates Google Search, YouTube, Android, Google Cloud Platform and frontier computing research.',
    investorUrl: 'https://abc.xyz/investor',
    dividendYield: '0.45%',
    currencyCode: 'USD',
    country: 'United States'
  },
  {
    ticker: 'AMZN',
    yahooSymbol: 'AMZN',
    name: 'Amazon.com Inc.',
    exchange: 'NYSE / NASDAQ',
    sector: 'Hyperscale Cloud & Commerce',
    marketCap: '$1.98T',
    sharesOutstanding: 1.05e10,
    fallbackPrice: 192.40,
    peRatio: '43.8x',
    headquarters: 'Seattle, WA, USA',
    ceo: 'Andy Jassy',
    description: 'Operates Amazon Web Services (AWS) cloud infrastructure, global e-commerce logistics and digital advertising.',
    investorUrl: 'https://ir.aboutamazon.com',
    dividendYield: '0.00%',
    currencyCode: 'USD',
    country: 'United States'
  },
  {
    ticker: 'META',
    yahooSymbol: 'META',
    name: 'Meta Platforms Inc.',
    exchange: 'NYSE / NASDAQ',
    sector: 'Interactive Media & Open Models',
    marketCap: '$1.48T',
    sharesOutstanding: 2.52e9,
    fallbackPrice: 582.10,
    peRatio: '28.5x',
    headquarters: 'Menlo Park, CA, USA',
    ceo: 'Mark Zuckerberg',
    description: 'Connects billions globally via Facebook, Instagram, WhatsApp, Threads, open foundation models and Reality Labs.',
    investorUrl: 'https://investor.atmeta.com',
    dividendYield: '0.34%',
    currencyCode: 'USD',
    country: 'United States'
  },
  {
    ticker: 'TSLA',
    yahooSymbol: 'TSLA',
    name: 'Tesla Inc.',
    exchange: 'NYSE / NASDAQ',
    sector: 'Electric Mobility & Energy Storage',
    marketCap: '$745B',
    sharesOutstanding: 3.21e9,
    fallbackPrice: 234.50,
    peRatio: '68.2x',
    headquarters: 'Austin, TX, USA',
    ceo: 'Elon Musk',
    description: 'Designs electric vehicles, utility-scale Megapack energy storage, solar systems and autonomous driving networks.',
    investorUrl: 'https://ir.tesla.com',
    dividendYield: '0.00%',
    currencyCode: 'USD',
    country: 'United States'
  },
  {
    ticker: 'RELIANCE',
    yahooSymbol: 'RELIANCE.NS',
    name: 'Reliance Industries Limited',
    exchange: 'NSE / BSE',
    sector: 'Energy Transition, Retail & 5G Telecom',
    marketCap: '₹18.10 Lakh Cr',
    sharesOutstanding: 1.353e10,
    fallbackPrice: 1339.70,
    peRatio: '26.4x',
    headquarters: 'Mumbai, Maharashtra, India',
    ceo: 'Mukesh Ambani',
    description: 'India’s largest private sector conglomerate spanning Jio 5G telecom, Reliance Retail, clean energy and refining.',
    investorUrl: 'https://www.ril.com/investors',
    dividendYield: '0.38%',
    currencyCode: 'INR',
    country: 'India'
  },
  {
    ticker: 'TCS',
    yahooSymbol: 'TCS.NS',
    name: 'Tata Consultancy Services',
    exchange: 'NSE / BSE',
    sector: 'Digital Transformation & Global IT',
    marketCap: '₹14.50 Lakh Cr',
    sharesOutstanding: 3.618e9,
    fallbackPrice: 4007.50,
    peRatio: '30.2x',
    headquarters: 'Mumbai, Maharashtra, India',
    ceo: 'K. Krithivasan',
    description: 'Global IT services and enterprise consulting leader operating across 55 countries for banking, retail and telecom clients.',
    investorUrl: 'https://www.tcs.com/investor-relations',
    dividendYield: '1.35%',
    currencyCode: 'INR',
    country: 'India'
  },
  {
    ticker: 'HDFCBANK',
    yahooSymbol: 'HDFCBANK.NS',
    name: 'HDFC Bank Limited',
    exchange: 'NSE / BSE',
    sector: 'Commercial, Retail & Digital Banking',
    marketCap: '₹13.10 Lakh Cr',
    sharesOutstanding: 7.64e9,
    fallbackPrice: 1710.50,
    peRatio: '19.5x',
    headquarters: 'Mumbai, Maharashtra, India',
    ceo: 'Sashidhar Jagdishan',
    description: 'India’s largest private-sector bank delivering retail banking, corporate treasury and UPI payment infrastructure.',
    investorUrl: 'https://www.hdfcbank.com/personal/investor-relations',
    dividendYield: '1.14%',
    currencyCode: 'INR',
    country: 'India'
  },
  {
    ticker: 'INFY',
    yahooSymbol: 'INFY.NS',
    name: 'Infosys Limited',
    exchange: 'NSE / BSE',
    sector: 'Enterprise Software & Cloud Consulting',
    marketCap: '₹7.80 Lakh Cr',
    sharesOutstanding: 4.15e9,
    fallbackPrice: 1880.00,
    peRatio: '27.8x',
    headquarters: 'Bengaluru, Karnataka, India',
    ceo: 'Salil Parekh',
    description: 'Global software major delivering cloud migration, Topaz platforms and enterprise engineering transformations.',
    investorUrl: 'https://www.infosys.com/investors.html',
    dividendYield: '2.36%',
    currencyCode: 'INR',
    country: 'India'
  },
  {
    ticker: 'ZOMATO',
    yahooSymbol: 'ETERNAL.NS',
    name: 'Eternal Limited (formerly Zomato Ltd.)',
    exchange: 'NSE / BSE',
    sector: 'Consumer Internet & Quick Commerce',
    marketCap: '₹2.42 Lakh Cr',
    sharesOutstanding: 9.65e9,
    fallbackPrice: 250.80,
    peRatio: '84.2x',
    headquarters: 'Gurugram, Haryana, India',
    ceo: 'Deepinder Goyal',
    description: 'Holding group operating Zomato food delivery, Blinkit 10-minute quick commerce, Hyperpure B2B supply and District live events.',
    investorUrl: 'https://www.zomato.com/investor-relations',
    dividendYield: '0.00%',
    currencyCode: 'INR',
    country: 'India'
  },
  {
    ticker: 'AZN',
    yahooSymbol: 'AZN.L',
    name: 'AstraZeneca PLC',
    exchange: 'LSE / Euronext',
    sector: 'Biopharmaceuticals & Oncology',
    marketCap: '£215B',
    sharesOutstanding: 1.55e9,
    fallbackPrice: 139.52,
    peRatio: '29.1x',
    headquarters: 'Cambridge, United Kingdom',
    ceo: 'Pascal Soriot',
    description: 'Global science-led biopharmaceutical leader focusing on oncology, rare diseases and cardiovascular therapies.',
    investorUrl: 'https://www.astrazeneca.com/investor-relations.html',
    dividendYield: '2.05%',
    currencyCode: 'GBP',
    country: 'United Kingdom'
  },
  {
    ticker: 'ASML',
    yahooSymbol: 'ASML.AS',
    name: 'ASML Holding N.V.',
    exchange: 'LSE / Euronext',
    sector: 'EUV Lithography Equipment',
    marketCap: '€278B',
    sharesOutstanding: 3.94e8,
    fallbackPrice: 705.00,
    peRatio: '36.8x',
    headquarters: 'Veldhoven, Netherlands',
    ceo: 'Christophe Fouquet',
    description: 'Sole global supplier of extreme ultraviolet (EUV) lithography systems essential for advanced sub-5nm semiconductor nodes.',
    investorUrl: 'https://www.asml.com/en/investors',
    dividendYield: '0.91%',
    currencyCode: 'EUR',
    country: 'Netherlands'
  },
  {
    ticker: 'MC',
    yahooSymbol: 'MC.PA',
    name: 'LVMH Moët Hennessy Louis Vuitton',
    exchange: 'LSE / Euronext',
    sector: 'Global Luxury Goods & Fashion',
    marketCap: '€315B',
    sharesOutstanding: 5.00e8,
    fallbackPrice: 630.00,
    peRatio: '22.8x',
    headquarters: 'Paris, France',
    ceo: 'Bernard Arnault',
    description: 'World’s premier luxury conglomerate encompassing Louis Vuitton, Christian Dior, Tiffany & Co. and Sephora.',
    investorUrl: 'https://www.lvmh.com/investors/',
    dividendYield: '2.05%',
    currencyCode: 'EUR',
    country: 'France'
  },
  {
    ticker: '7203',
    yahooSymbol: '7203.T',
    name: 'Toyota Motor Corporation',
    exchange: 'TSE / HKEX',
    sector: 'Automotive, Hybrid & Electrification',
    marketCap: '¥44.8T',
    sharesOutstanding: 1.31e10,
    fallbackPrice: 3418,
    peRatio: '9.8x',
    headquarters: 'Toyota City, Aichi, Japan',
    ceo: 'Koji Sato',
    description: 'World’s largest automotive manufacturer leading hybrid-electric powertrains, solid-state batteries and mobility systems.',
    investorUrl: 'https://global.toyota/en/ir/',
    dividendYield: '2.45%',
    currencyCode: 'JPY',
    country: 'Japan'
  },
  {
    ticker: '0700',
    yahooSymbol: '0700.HK',
    name: 'Tencent Holdings Limited',
    exchange: 'TSE / HKEX',
    sector: 'Digital Ecosystem, Gaming & Cloud',
    marketCap: 'HK$3.82T',
    sharesOutstanding: 9.28e9,
    fallbackPrice: 412.00,
    peRatio: '18.6x',
    headquarters: 'Shenzhen, China',
    ceo: 'Pony Ma Huateng',
    description: 'Operates WeChat social and payment ecosystem, global interactive gaming studios and enterprise cloud infrastructure.',
    investorUrl: 'https://www.tencent.com/en-us/investors.html',
    dividendYield: '0.82%',
    currencyCode: 'HKD',
    country: 'Hong Kong'
  },
  {
    ticker: '2330',
    yahooSymbol: '2330.TW',
    name: 'Taiwan Semiconductor (TSMC)',
    exchange: 'TSE / HKEX',
    sector: 'Pure-Play Silicon Foundry',
    marketCap: 'NT$27.5T',
    sharesOutstanding: 2.59e10,
    fallbackPrice: 1060.0,
    peRatio: '26.1x',
    headquarters: 'Hsinchu, Taiwan',
    ceo: 'C.C. Wei',
    description: 'World’s largest dedicated independent semiconductor foundry manufacturing leading-edge 3nm and 2nm silicon.',
    investorUrl: 'https://investor.tsmc.com/english',
    dividendYield: '1.48%',
    currencyCode: 'TWD',
    country: 'Taiwan'
  }
];

// Dynamic runtime state for real-time market streaming
const dynamicWatchedCompanies = new Map<string, LiveCompanyItem & { yahooSymbol: string }>();
let liveMarketState: {
  indices: LiveIndexItem[];
  listedCompanies: LiveCompanyItem[];
  news: LiveNewsItem[];
  marketStatus: ExchangeClockStatus[];
  lastUpdated: string;
} = {
  indices: INDEX_DEFINITIONS.map((idx): LiveIndexItem => ({
    name: idx.name,
    symbol: idx.symbol,
    value: formatNumber(idx.fallbackPrice, 2),
    rawPrice: idx.fallbackPrice,
    change: '0.00%',
    isPositive: true,
  })).concat([
    { name: 'BITCOIN', symbol: 'BTC-USD', value: '$—', rawPrice: 0, change: '0.00%', isPositive: true, currency: 'USD' },
    { name: 'ETHEREUM', symbol: 'ETH-USD', value: '$—', rawPrice: 0, change: '0.00%', isPositive: true, currency: 'USD' },
  ]),
  listedCompanies: BASE_COMPANIES.map(c => ({
    ticker: c.ticker,
    yahooSymbol: c.yahooSymbol,
    name: c.name,
    exchange: c.exchange,
    sector: c.sector,
    marketCap: c.marketCap,
    sharesOutstanding: c.sharesOutstanding,
    price: formatPriceByCurrency(c.fallbackPrice, c.currencyCode, c.exchange),
    rawPrice: c.fallbackPrice,
    change: '0.00%',
    isPositive: true,
    volume: '—',
    peRatio: c.peRatio,
    headquarters: c.headquarters,
    ceo: c.ceo,
    description: c.description,
    investorUrl: c.investorUrl,
    dividendYield: c.dividendYield,
    currencyCode: c.currencyCode,
    country: c.country,
  })),
  news: [],
  marketStatus: computeLiveMarketStatus(),
  lastUpdated: new Date().toISOString(),
};

let lastQuotesFetchAt = 0;
let lastNewsFetchAt = 0;
let inFlightRefreshPromise: Promise<typeof liveMarketState> | null = null;

async function fetchLiveRssNews(): Promise<LiveNewsItem[]> {
  const feeds = [
    { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', defaultSource: 'CNBC Markets' },
    { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147', defaultSource: 'CNBC Business' },
    { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC,%5ENDX,%5ENSEI,AAPL,NVDA,MSFT,RELIANCE.NS,TCS.NS,BTC-USD&region=US&lang=en-US', defaultSource: 'Yahoo Finance Wire' },
  ];

  const aggregated: LiveNewsItem[] = [];
  const seenTitles = new Set<string>();

  await Promise.all(feeds.map(async (feed) => {
    try {
      const resp = await fetch(feed.url, {
        headers: { 'User-Agent': BROWSER_USER_AGENT },
        signal: AbortSignal.timeout(7000),
      });
      if (!resp.ok) return;
      const xml = await resp.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
      for (const itemXml of items.slice(0, 8)) {
        const titleRaw = itemXml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
        const linkRaw = itemXml.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '';
        const pubDateRaw = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || '';
        const descRaw = itemXml.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '';
        const sourceRaw = itemXml.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || '';

        const title = decodeHtmlEntities(titleRaw);
        const url = decodeHtmlEntities(linkRaw);
        const summary = decodeHtmlEntities(descRaw) || title;
        const source = decodeHtmlEntities(sourceRaw) || feed.defaultSource;

        if (!title || seenTitles.has(title.toLowerCase())) continue;
        seenTitles.add(title.toLowerCase());

        const meta = inferNewsMetadata(title, summary);
        aggregated.push({
          title,
          source,
          summary: summary.length > 260 ? `${summary.slice(0, 257)}...` : summary,
          category: meta.category,
          timeAgo: computeRelativeTimeAgo(decodeHtmlEntities(pubDateRaw)),
          url: url || 'https://www.cnbc.com/markets/',
          publishedAt: decodeHtmlEntities(pubDateRaw),
          impact: meta.impact,
          sentiment: meta.sentiment,
        });
      }
    } catch {
      // Ignore single feed failure
    }
  }));

  if (aggregated.length < 4) {
    const yahooGeneral = await fetchYahooNewsSearch('global stock market equities');
    for (const item of yahooGeneral) {
      if (!seenTitles.has(item.title.toLowerCase())) {
        seenTitles.add(item.title.toLowerCase());
        aggregated.push(item);
      }
    }
  }

  return aggregated.slice(0, 12);
}

async function fetchYahooNewsSearch(query: string): Promise<LiveNewsItem[]> {
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=0&newsCount=8`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const newsArr: any[] = data?.news || [];
    return newsArr.map((n) => {
      const title = n.title || '';
      const meta = inferNewsMetadata(title, n.publisher || '');
      return {
        title,
        source: n.publisher || 'Financial Wire',
        summary: `${title}${n.relatedTickers?.length ? ` · Related: ${n.relatedTickers.slice(0, 4).join(', ')}` : ''}`,
        category: meta.category,
        timeAgo: computeRelativeTimeAgo(n.providerPublishTime),
        url: n.link || 'https://finance.yahoo.com/',
        publishedAt: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : undefined,
        impact: meta.impact,
        sentiment: meta.sentiment,
      };
    }).filter(n => Boolean(n.title));
  } catch {
    return [];
  }
}

function mapYahooExchangeLabel(exchangeName?: string, symbol?: string): 'NYSE / NASDAQ' | 'NSE / BSE' | 'LSE / Euronext' | 'TSE / HKEX' {
  const sym = (symbol || '').toUpperCase();
  const ex = (exchangeName || '').toUpperCase();
  if (sym.endsWith('.NS') || sym.endsWith('.BO') || ex.includes('NSE') || ex.includes('BSE') || ex.includes('BOMBAY') || ex.includes('INDIA')) {
    return 'NSE / BSE';
  }
  if (sym.endsWith('.L') || sym.endsWith('.PA') || sym.endsWith('.AS') || sym.endsWith('.DE') || ex.includes('LSE') || ex.includes('LON') || ex.includes('PAR') || ex.includes('EURONEXT') || ex.includes('AMS') || ex.includes('XETRA')) {
    return 'LSE / Euronext';
  }
  if (sym.endsWith('.T') || sym.endsWith('.HK') || sym.endsWith('.TW') || ex.includes('TOKYO') || ex.includes('HKSE') || ex.includes('TAIWAN') || ex.includes('JPX')) {
    return 'TSE / HKEX';
  }
  return 'NYSE / NASDAQ';
}

async function resolveAndSubscribeTicker(rawQuery: string): Promise<LiveCompanyItem | null> {
  const clean = rawQuery.trim().toUpperCase();
  if (!clean) return null;

  // 1. Check already tracked BASE_COMPANIES or dynamicWatchedCompanies
  const existing = liveMarketState.listedCompanies.find(
    c => c.ticker.toUpperCase() === clean || c.yahooSymbol.toUpperCase() === clean || c.name.toUpperCase().includes(clean)
  );
  if (existing) {
    const fresh = await fetchYahooChartQuote(existing.yahooSymbol);
    if (fresh) {
      const updated: LiveCompanyItem = {
        ...existing,
        price: formatPriceByCurrency(fresh.price, fresh.currency || existing.currencyCode, existing.exchange),
        rawPrice: fresh.price,
        change: `${fresh.changePct >= 0 ? '+' : ''}${fresh.changePct.toFixed(2)}%`,
        isPositive: fresh.changePct >= 0,
        volume: formatVolume(fresh.volume) !== '—' ? formatVolume(fresh.volume) : existing.volume,
        week52High: fresh.week52High ? formatPriceByCurrency(fresh.week52High, fresh.currency, existing.exchange) : existing.week52High,
        week52Low: fresh.week52Low ? formatPriceByCurrency(fresh.week52Low, fresh.currency, existing.exchange) : existing.week52Low,
        marketCap: formatMarketCap(fresh.price, existing.sharesOutstanding, fresh.currency || existing.currencyCode, existing.exchange, existing.marketCap),
      };
      // Update in liveMarketState immediately
      liveMarketState.listedCompanies = liveMarketState.listedCompanies.map(c =>
        c.ticker === updated.ticker ? updated : c
      );
      return updated;
    }
    return existing;
  }

  // 2. Query Yahoo Finance Search API to resolve exact ticker symbol across global exchanges
  try {
    const searchUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(rawQuery.trim())}&quotesCount=6&newsCount=0`;
    const searchResp = await fetch(searchUrl, {
      headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
    if (searchResp.ok) {
      const searchJson: any = await searchResp.json();
      const quotes: any[] = (searchJson?.quotes || []).filter((q: any) =>
        q.symbol && ['EQUITY', 'ETF', 'INDEX', 'CRYPTOCURRENCY'].includes(q.quoteType || 'EQUITY')
      );
      const best = quotes[0];
      if (best?.symbol) {
        const yahooSymbol = String(best.symbol);
        const displayTicker = yahooSymbol.replace(/\.(NS|BO|L|PA|AS|DE|T|HK|TW)$/i, '').toUpperCase();
        const chartQuote = await fetchYahooChartQuote(yahooSymbol);
        if (chartQuote) {
          const exchange = mapYahooExchangeLabel(chartQuote.exchangeName || best.exchDisp, yahooSymbol);
          const resolved: LiveCompanyItem = {
            ticker: displayTicker,
            yahooSymbol,
            name: chartQuote.longName || best.longname || chartQuote.shortName || best.shortname || displayTicker,
            exchange,
            sector: best.sectorDisp || best.industryDisp || best.quoteType || 'Global Equities',
            marketCap: '—',
            price: formatPriceByCurrency(chartQuote.price, chartQuote.currency, exchange),
            rawPrice: chartQuote.price,
            change: `${chartQuote.changePct >= 0 ? '+' : ''}${chartQuote.changePct.toFixed(2)}%`,
            isPositive: chartQuote.changePct >= 0,
            volume: formatVolume(chartQuote.volume),
            peRatio: '—',
            week52High: chartQuote.week52High ? formatPriceByCurrency(chartQuote.week52High, chartQuote.currency, exchange) : '—',
            week52Low: chartQuote.week52Low ? formatPriceByCurrency(chartQuote.week52Low, chartQuote.currency, exchange) : '—',
            description: `${chartQuote.longName || best.shortname || displayTicker} traded live on ${chartQuote.exchangeName || exchange}.`,
            investorUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(yahooSymbol)}`,
            currencyCode: chartQuote.currency,
          };

          dynamicWatchedCompanies.set(resolved.ticker, resolved);
          if (!liveMarketState.listedCompanies.some(c => c.ticker === resolved.ticker)) {
            liveMarketState.listedCompanies = [resolved, ...liveMarketState.listedCompanies];
          }
          return resolved;
        }
      }
    }
  } catch {
    // Fall through to Gemini search fallback if needed
  }

  return null;
}

async function refreshLiveMarketState(force = false): Promise<typeof liveMarketState> {
  const now = Date.now();
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }
  if (!force && lastQuotesFetchAt > 0 && now - lastQuotesFetchAt < 3500) {
    liveMarketState.marketStatus = computeLiveMarketStatus();
    return liveMarketState;
  }

  inFlightRefreshPromise = (async () => {
    try {
      const allCompanies = [...liveMarketState.listedCompanies];

      // 1. Collect all CNBC-mapped symbols (indices + base equities) for ONE single real-time batch request
      const cnbcSymbols: string[] = [];
      for (const idx of INDEX_DEFINITIONS) {
        if (idx.cnbcSymbol) cnbcSymbols.push(idx.cnbcSymbol);
      }
      for (const comp of allCompanies) {
        const cnbcSym = CNBC_COMPANY_SYMBOL_MAP[comp.ticker];
        if (cnbcSym) cnbcSymbols.push(cnbcSym);
      }

      // Dynamic user-searched companies (not in BASE_COMPANIES) + BSE SENSEX use targeted query2 Yahoo chart calls
      const yahooOnlyCompanies = allCompanies.filter(c => !CNBC_COMPANY_SYMBOL_MAP[c.ticker]);

      const [cnbcMap, sensexQuote, cryptoResults, ...dynamicYahooQuotes] = await Promise.all([
        fetchCnbcBatchQuotes(cnbcSymbols),
        fetchYahooChartQuote('^BSESN'),
        fetchCryptoQuotes(),
        ...yahooOnlyCompanies.slice(0, 8).map(async (c) => ({
          ticker: c.ticker,
          quote: await fetchYahooChartQuote(c.yahooSymbol),
        })),
      ]);

      // Build updated indices
      const updatedIndices: LiveIndexItem[] = await Promise.all(
        INDEX_DEFINITIONS.map(async (def): Promise<LiveIndexItem> => {
          let quote: YahooQuoteResult | null | undefined = def.cnbcSymbol
            ? cnbcMap.get(def.cnbcSymbol)
            : (def.symbol === '^BSESN' ? sensexQuote : undefined);

          if (!quote && def.symbol !== '^BSESN') {
            quote = await fetchYahooChartQuote(def.symbol);
          }

          if (quote) {
            return {
              name: def.name,
              symbol: def.symbol,
              value: formatNumber(quote.price, 2),
              rawPrice: quote.price,
              change: `${quote.changePct >= 0 ? '+' : ''}${quote.changePct.toFixed(2)}%`,
              isPositive: quote.changePct >= 0,
              currency: quote.currency,
            };
          }

          const prev = liveMarketState.indices.find(i => i.name === def.name);
          return prev || {
            name: def.name,
            symbol: def.symbol,
            value: formatNumber(def.fallbackPrice, 2),
            rawPrice: def.fallbackPrice,
            change: '0.00%',
            isPositive: true,
          };
        })
      );

      const prevBtc = liveMarketState.indices.find(i => i.name === 'BITCOIN');
      const prevEth = liveMarketState.indices.find(i => i.name === 'ETHEREUM');

      updatedIndices.push(
        cryptoResults.btc
          ? {
              name: 'BITCOIN',
              symbol: 'BTC-USD',
              value: `$${formatNumber(cryptoResults.btc.price, 2)}`,
              rawPrice: cryptoResults.btc.price,
              change: `${cryptoResults.btc.changePct >= 0 ? '+' : ''}${cryptoResults.btc.changePct.toFixed(2)}%`,
              isPositive: cryptoResults.btc.changePct >= 0,
              currency: 'USD',
            }
          : (prevBtc || { name: 'BITCOIN', symbol: 'BTC-USD', value: '$—', rawPrice: 0, change: '0.00%', isPositive: true, currency: 'USD' }),
        cryptoResults.eth
          ? {
              name: 'ETHEREUM',
              symbol: 'ETH-USD',
              value: `$${formatNumber(cryptoResults.eth.price, 2)}`,
              rawPrice: cryptoResults.eth.price,
              change: `${cryptoResults.eth.changePct >= 0 ? '+' : ''}${cryptoResults.eth.changePct.toFixed(2)}%`,
              isPositive: cryptoResults.eth.changePct >= 0,
              currency: 'USD',
            }
          : (prevEth || { name: 'ETHEREUM', symbol: 'ETH-USD', value: '$—', rawPrice: 0, change: '0.00%', isPositive: true, currency: 'USD' })
      );

      // Map quotes onto companies
      const quoteMap = new Map<string, YahooQuoteResult>();
      for (const comp of allCompanies) {
        const cnbcSym = CNBC_COMPANY_SYMBOL_MAP[comp.ticker];
        if (cnbcSym && cnbcMap.has(cnbcSym)) {
          quoteMap.set(comp.ticker, cnbcMap.get(cnbcSym)!);
        }
      }
      for (const item of dynamicYahooQuotes) {
        if (item.quote) quoteMap.set(item.ticker, item.quote);
      }

      const updatedCompanies: LiveCompanyItem[] = allCompanies.map((comp) => {
        const q = quoteMap.get(comp.ticker);
        if (!q) return comp;
        const currency = q.currency || comp.currencyCode;
        return {
          ...comp,
          price: formatPriceByCurrency(q.price, currency, comp.exchange),
          rawPrice: q.price,
          change: `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%`,
          isPositive: q.changePct >= 0,
          volume: formatVolume(q.volume) !== '—' ? formatVolume(q.volume) : comp.volume,
          week52High: q.week52High ? formatPriceByCurrency(q.week52High, currency, comp.exchange) : comp.week52High,
          week52Low: q.week52Low ? formatPriceByCurrency(q.week52Low, currency, comp.exchange) : comp.week52Low,
          marketCap: formatMarketCap(q.price, comp.sharesOutstanding, currency, comp.exchange, comp.marketCap),
        };
      });

      // 3. Refresh RSS breaking news every 60 seconds or if empty
      let latestNews = liveMarketState.news;
      if (latestNews.length === 0 || Date.now() - lastNewsFetchAt > 60000) {
        const rss = await fetchLiveRssNews();
        if (rss.length > 0) {
          latestNews = rss;
          lastNewsFetchAt = Date.now();
        }
      } else {
        latestNews = latestNews.map(n => ({
          ...n,
          timeAgo: n.publishedAt ? computeRelativeTimeAgo(n.publishedAt) : n.timeAgo,
        }));
      }

      liveMarketState = {
        indices: updatedIndices,
        listedCompanies: updatedCompanies,
        news: latestNews,
        marketStatus: computeLiveMarketStatus(),
        lastUpdated: new Date().toISOString(),
      };
      lastQuotesFetchAt = Date.now();
      return liveMarketState;
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

  return inFlightRefreshPromise;
}

// Live Market Snapshot REST endpoint
app.get('/api/markets/snapshot', async (req, res) => {
  try {
    const force = req.query.force === 'true' || lastQuotesFetchAt === 0 || Date.now() - lastQuotesFetchAt > 8000;
    const state = await refreshLiveMarketState(force);
    res.json(state);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load live market snapshot' });
  }
});

// ==========================================
// SEO & CRAWLER ENDPOINTS (/robots.txt & /sitemap.xml)
// ==========================================
function resolvePublicOrigin(req: express.Request): string {
  const envUrl = process.env.APP_URL;
  if (envUrl && envUrl.startsWith('http')) {
    return envUrl.replace(/\/+$/, '');
  }
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'https';
  const host = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() || req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

app.get('/robots.txt', (req, res) => {
  const origin = resolvePublicOrigin(req);
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nAllow: /workspace/\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`
  );
});

app.get('/sitemap.xml', (req, res) => {
  const origin = resolvePublicOrigin(req);
  const publicPaths = [
    { path: '/', priority: '1.0', changefreq: 'daily' },
    { path: '/workspace/overview', priority: '0.9', changefreq: 'daily' },
    { path: '/workspace/expenses', priority: '0.9', changefreq: 'daily' },
    { path: '/workspace/invoices', priority: '0.9', changefreq: 'weekly' },
    { path: '/workspace/markets', priority: '0.9', changefreq: 'always' },
    { path: '/workspace/agent', priority: '0.8', changefreq: 'weekly' },
    { path: '/workspace/vision', priority: '0.8', changefreq: 'weekly' },
    { path: '/workspace/pricing', priority: '0.9', changefreq: 'weekly' },
  ];
  const lastMod = new Date().toISOString().split('T')[0];
  const urlsXml = publicPaths
    .map(
      (item) =>
        `  <url>\n    <loc>${origin}${item.path}</loc>\n    <lastmod>${lastMod}</lastmod>\n    <changefreq>${item.changefreq}</changefreq>\n    <priority>${item.priority}</priority>\n  </url>`
    )
    .join('\n');

  res
    .type('application/xml')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlsXml}\n</urlset>`);
});

// ==========================================
// RUNTIME ANALYTICS & ORGANIZATION PORTAL API
// ==========================================
interface RuntimeAnalyticsEvent {
  id: string;
  eventType: string;
  featureWindow: string;
  userId: string;
  organizationId?: string;
  metadata?: string;
  revenueImpactUsd: number;
  createdAt: string;
}

interface RuntimeOrganization {
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

const runtimeAnalyticsEvents: RuntimeAnalyticsEvent[] = [];
const runtimeOrganizations: RuntimeOrganization[] = [];

const VALID_ANALYTICS_TYPES = new Set([
  'feature_view',
  'invoice_created',
  'ocr_scan',
  'voice_session',
  'ad_impression',
  'affiliate_click',
  'pro_upgrade',
  'org_created',
  'vision_collab',
]);

app.post('/api/analytics/event', (req, res) => {
  try {
    const { eventType, featureWindow, userId, organizationId, metadata, revenueImpactUsd } = req.body || {};
    if (!eventType || !VALID_ANALYTICS_TYPES.has(String(eventType))) {
      return res.status(400).json({ error: 'Invalid eventType' });
    }
    const evt: RuntimeAnalyticsEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      eventType: String(eventType),
      featureWindow: String(featureWindow || 'home').slice(0, 64),
      userId: String(userId || 'guest').slice(0, 128),
      organizationId: organizationId ? String(organizationId).slice(0, 128) : undefined,
      metadata: metadata ? String(metadata).slice(0, 300) : undefined,
      revenueImpactUsd: Math.max(0, Number(revenueImpactUsd) || 0),
      createdAt: new Date().toISOString(),
    };
    runtimeAnalyticsEvents.unshift(evt);
    if (runtimeAnalyticsEvents.length > 500) {
      runtimeAnalyticsEvents.length = 500;
    }
    res.status(201).json({ ok: true, event: evt });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to record analytics event' });
  }
});

app.get('/api/analytics/summary', (_req, res) => {
  const featureCounts: Record<string, number> = {};
  const eventCounts: Record<string, number> = {};
  let adImpressions = 0;
  let affiliateClicks = 0;
  let proUpgrades = 0;
  let voiceSessions = 0;
  let trackedAffiliateEstUsd = 0;
  const activeUsers = new Set<string>();

  for (const evt of runtimeAnalyticsEvents) {
    activeUsers.add(evt.userId);
    featureCounts[evt.featureWindow] = (featureCounts[evt.featureWindow] || 0) + 1;
    eventCounts[evt.eventType] = (eventCounts[evt.eventType] || 0) + 1;
    if (evt.eventType === 'ad_impression') adImpressions++;
    if (evt.eventType === 'affiliate_click') {
      affiliateClicks++;
      trackedAffiliateEstUsd += evt.revenueImpactUsd || 0;
    }
    if (evt.eventType === 'pro_upgrade') proUpgrades++;
    if (evt.eventType === 'voice_session') voiceSessions++;
  }

  const orgMrrUsd = runtimeOrganizations
    .filter((o) => o.status === 'active')
    .reduce((sum, o) => sum + (Number(o.monthlyRevenueUsd) || 0), 0);

  res.json({
    totalEvents: runtimeAnalyticsEvents.length,
    uniqueUsers: activeUsers.size,
    organizationCount: runtimeOrganizations.length,
    orgMrrUsd,
    adImpressions,
    affiliateClicks,
    trackedAffiliateEstUsd: Math.round(trackedAffiliateEstUsd * 100) / 100,
    proUpgrades,
    voiceSessions,
    featureCounts,
    eventCounts,
    recentEvents: runtimeAnalyticsEvents.slice(0, 40),
  });
});

app.get('/api/analytics/organizations', (_req, res) => {
  res.json({ organizations: runtimeOrganizations });
});

app.post('/api/analytics/organizations', (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim().slice(0, 160);
    if (!name) {
      return res.status(400).json({ error: 'Organization name is required.' });
    }
    const now = new Date().toISOString();
    const orgId = String(body.orgId || `org-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    const planTier = ['free', 'pro', 'team', 'enterprise'].includes(body.planTier) ? body.planTier : 'pro';
    const org: RuntimeOrganization = {
      orgId,
      name,
      industry: String(body.industry || 'Solo Studio & Consulting').slice(0, 80),
      planTier,
      seatCount: Math.max(1, Number(body.seatCount) || 1),
      monthlyRevenueUsd: Math.max(0, Number(body.monthlyRevenueUsd) ?? (planTier === 'pro' ? 9 : planTier === 'team' ? 20 : planTier === 'enterprise' ? 99 : 0)),
      status: ['active', 'trial', 'paused', 'churned'].includes(body.status) ? body.status : 'active',
      ownerUserId: String(body.ownerUserId || 'admin').slice(0, 128),
      billingEmail: body.billingEmail ? String(body.billingEmail).slice(0, 254) : undefined,
      notes: body.notes ? String(body.notes).slice(0, 500) : undefined,
      createdAt: now,
      updatedAt: now,
    };
    const existingIdx = runtimeOrganizations.findIndex((o) => o.orgId === orgId);
    if (existingIdx >= 0) {
      runtimeOrganizations[existingIdx] = org;
    } else {
      runtimeOrganizations.unshift(org);
    }
    res.status(201).json({ organization: org });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to save organization' });
  }
});

app.patch('/api/analytics/organizations/:orgId', (req, res) => {
  const { orgId } = req.params;
  const idx = runtimeOrganizations.findIndex((o) => o.orgId === orgId);
  if (idx < 0) {
    return res.status(404).json({ error: 'Organization not found.' });
  }
  const updates = req.body || {};
  runtimeOrganizations[idx] = {
    ...runtimeOrganizations[idx],
    ...(updates.name ? { name: String(updates.name).slice(0, 160) } : {}),
    ...(updates.industry ? { industry: String(updates.industry).slice(0, 80) } : {}),
    ...(updates.planTier && ['free', 'pro', 'team', 'enterprise'].includes(updates.planTier) ? { planTier: updates.planTier } : {}),
    ...(updates.status && ['active', 'trial', 'paused', 'churned'].includes(updates.status) ? { status: updates.status } : {}),
    ...(updates.seatCount !== undefined ? { seatCount: Math.max(1, Number(updates.seatCount) || 1) } : {}),
    ...(updates.monthlyRevenueUsd !== undefined ? { monthlyRevenueUsd: Math.max(0, Number(updates.monthlyRevenueUsd) || 0) } : {}),
    ...(updates.billingEmail !== undefined ? { billingEmail: String(updates.billingEmail).slice(0, 254) } : {}),
    ...(updates.notes !== undefined ? { notes: String(updates.notes).slice(0, 500) } : {}),
    updatedAt: new Date().toISOString(),
  };
  res.json({ organization: runtimeOrganizations[idx] });
});

app.delete('/api/analytics/organizations/:orgId', (req, res) => {
  const { orgId } = req.params;
  const idx = runtimeOrganizations.findIndex((o) => o.orgId === orgId);
  if (idx >= 0) {
    runtimeOrganizations.splice(idx, 1);
  }
  res.json({ ok: true });
});

// ==========================================
// JUSPAY HYPERSWITCH PAYMENT ORCHESTRATION (INDIA + GLOBAL)
// Open-Source Gateway Integration: https://github.com/juspay/hyperswitch
// ==========================================
interface RuntimePayoutConfig {
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
  updatedAt?: string;
}

const PAYOUT_CONFIG_FILE = path.join(process.cwd(), '.liddy_payout_config.json');

function loadInitialPayoutConfig(): RuntimePayoutConfig {
  try {
    if (fs.existsSync(PAYOUT_CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PAYOUT_CONFIG_FILE, 'utf8'));
      return {
        upiId: String(raw?.upiId || '').trim().slice(0, 120),
        payeeName: String(raw?.payeeName || '').trim().slice(0, 120),
        bankName: raw?.bankName ? String(raw.bankName).trim().slice(0, 120) : '',
        accountHolder: raw?.accountHolder ? String(raw.accountHolder).trim().slice(0, 120) : '',
        accountNumber: raw?.accountNumber ? String(raw.accountNumber).trim().slice(0, 40) : '',
        ifscCode: raw?.ifscCode ? String(raw.ifscCode).trim().toUpperCase().slice(0, 32) : '',
        paypalEnabled: Boolean(raw?.paypalEnabled ?? Boolean(raw?.paypalClientId)),
        paypalEnvironment: raw?.paypalEnvironment === 'live' ? 'live' : 'sandbox',
        paypalClientId: raw?.paypalClientId ? String(raw.paypalClientId).trim().slice(0, 200) : '',
        paypalClientSecret: raw?.paypalClientSecret ? String(raw.paypalClientSecret).trim().slice(0, 200) : '',
        paypalMerchantEmail: raw?.paypalMerchantEmail ? String(raw.paypalMerchantEmail).trim().slice(0, 254) : '',
        updatedAt: raw?.updatedAt ? String(raw.updatedAt) : undefined,
      };
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
  };
}

let runtimePayoutConfig: RuntimePayoutConfig = loadInitialPayoutConfig();

function persistPayoutConfig(next: RuntimePayoutConfig) {
  runtimePayoutConfig = next;
  try {
    fs.writeFileSync(PAYOUT_CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Payout Config] Could not write runtime payout config file:', err);
  }
}

interface RuntimeAiImageConfig {
  aiHordeEnabled: boolean;
  aiHordeApiKey: string;
  cloudflareEnabled: boolean;
  cloudflareAccountId: string;
  cloudflareApiToken: string;
  huggingfaceEnabled: boolean;
  huggingfaceToken: string;
  queueTimeoutSec: number;
  updatedAt?: string;
}

const AI_IMAGE_CONFIG_FILE = path.join(process.cwd(), '.liddy_ai_image_config.json');

function loadInitialAiImageConfig(): RuntimeAiImageConfig {
  try {
    if (fs.existsSync(AI_IMAGE_CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(AI_IMAGE_CONFIG_FILE, 'utf8'));
      const timeoutNum = Number(raw?.queueTimeoutSec);
      return {
        aiHordeEnabled: raw?.aiHordeEnabled !== false,
        aiHordeApiKey: raw?.aiHordeApiKey ? String(raw.aiHordeApiKey).trim().slice(0, 120) : '',
        cloudflareEnabled: Boolean(raw?.cloudflareEnabled),
        cloudflareAccountId: raw?.cloudflareAccountId ? String(raw.cloudflareAccountId).trim().slice(0, 120) : '',
        cloudflareApiToken: raw?.cloudflareApiToken ? String(raw.cloudflareApiToken).trim().slice(0, 250) : '',
        huggingfaceEnabled: Boolean(raw?.huggingfaceEnabled),
        huggingfaceToken: raw?.huggingfaceToken ? String(raw.huggingfaceToken).trim().slice(0, 250) : '',
        queueTimeoutSec: Number.isFinite(timeoutNum) ? Math.min(90, Math.max(15, Math.round(timeoutNum))) : 45,
        updatedAt: raw?.updatedAt ? String(raw.updatedAt) : undefined,
      };
    }
  } catch {}
  return {
    aiHordeEnabled: true,
    aiHordeApiKey: '',
    cloudflareEnabled: false,
    cloudflareAccountId: '',
    cloudflareApiToken: '',
    huggingfaceEnabled: false,
    huggingfaceToken: '',
    queueTimeoutSec: 45,
  };
}

let runtimeAiImageConfig: RuntimeAiImageConfig = loadInitialAiImageConfig();

function persistAiImageConfig(next: RuntimeAiImageConfig) {
  runtimeAiImageConfig = next;
  try {
    fs.writeFileSync(AI_IMAGE_CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.warn('[AI Image Config] Could not write runtime image config file:', err);
  }
}

function getPublicAiImageConfig() {
  const hasCloudflareConfigured = Boolean(
    runtimeAiImageConfig.cloudflareAccountId && runtimeAiImageConfig.cloudflareApiToken
  );
  const hasHuggingfaceConfigured = Boolean(runtimeAiImageConfig.huggingfaceToken);
  const hasAiHordeKey = Boolean(runtimeAiImageConfig.aiHordeApiKey);
  const activeTurboMode = Boolean(
    (runtimeAiImageConfig.cloudflareEnabled && hasCloudflareConfigured) ||
      (runtimeAiImageConfig.huggingfaceEnabled && hasHuggingfaceConfigured)
  );
  return {
    aiHordeEnabled: runtimeAiImageConfig.aiHordeEnabled,
    hasAiHordeKey,
    cloudflareEnabled: runtimeAiImageConfig.cloudflareEnabled,
    hasCloudflareConfigured,
    huggingfaceEnabled: runtimeAiImageConfig.huggingfaceEnabled,
    hasHuggingfaceConfigured,
    queueTimeoutSec: runtimeAiImageConfig.queueTimeoutSec,
    activeTurboMode,
    updatedAt: runtimeAiImageConfig.updatedAt,
  };
}

interface RuntimePaymentRecord {
  paymentId: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  planTier: 'free' | 'day' | 'pro';
  billingCycle: 'daily' | 'monthly' | 'annual';
  region: 'IN' | 'INTL';
  currency: 'INR' | 'USD' | 'EUR' | 'GBP';
  amount: number;
  amountUsdEquivalent: number;
  paymentRail: 'UPI_QR' | 'UPI_ID' | 'PAYPAL' | 'CARD' | 'WALLET';
  connector: string;
  status: 'succeeded' | 'processing' | 'requires_action' | 'failed';
  referenceCode: string;
  createdAt: string;
}

interface RuntimePaymentIntentExtra {
  clientSecret: string;
  upiUri?: string;
  payeeName?: string;
  payeeUpiId?: string;
  payoutConfigured: boolean;
  step1Verified: boolean;
  maskedInstrument?: string;
}

const runtimePaymentIntents = new Map<string, RuntimePaymentRecord & RuntimePaymentIntentExtra>();
const runtimePaymentsLedger: RuntimePaymentRecord[] = [];
const emailOtpChallenges = new Map<string, { email: string; code: string; expiresAt: number; attempts: number }>();
const verifiedEmailOtpTokens = new Map<string, { email: string; expiresAt: number }>();

const PLAN_RATES = {
  day: { dailyUsd: 2, dailyInr: 49 },
  pro: {
    monthlyUsd: 9,
    annualTotalUsd: 20,
    monthlyInr: 149,
    annualTotalInr: 999,
  },
};

function passesLuhnCheck(cardDigits: string): boolean {
  if (!/^\d{13,19}$/.test(cardDigits)) return false;
  if (/^(\d)\1+$/.test(cardDigits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = cardDigits.length - 1; i >= 0; i--) {
    let n = parseInt(cardDigits[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function isValidExpiry(exp: string): boolean {
  const match = String(exp || '').trim().match(/^(\d{2})\s*\/\s*(\d{2})$/);
  if (!match) return false;
  const month = parseInt(match[1], 10);
  const year = 2000 + parseInt(match[2], 10);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  return year > currentYear || (year === currentYear && month >= currentMonth);
}

function isValidUtr(utr: string): boolean {
  const clean = String(utr || '').trim();
  if (!/^[A-Za-z0-9]{10,24}$/.test(clean)) return false;
  if (/^([A-Za-z0-9])\1+$/.test(clean)) return false;
  return true;
}

function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildFormattedInvoiceEmailPayload(input: {
  recipientEmail: string;
  buyerName: string;
  referenceCode: string;
  invoiceNumber: string;
  date: string;
  items: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  currency: string;
  paymentRail: string;
  connector?: string;
  senderName?: string;
  senderTaxId?: string;
  clientTaxId?: string;
  notes?: string;
}) {
  const cur = input.currency || 'USD';
  const sym = cur === 'INR' ? '₹' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : '$';
  const fmt = (n: number) => `${sym}${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const subject = `Invoice & Payment Receipt — ${input.invoiceNumber || input.referenceCode} (${fmt(input.grandTotal)})`;
  const rowsHtml = (input.items || [])
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e5e5;color:#111111;font-size:13px;">${escapeHtml(item.description)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e5e5;color:#525252;font-size:13px;text-align:right;">${Number(item.quantity) || 1}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e5e5;color:#525252;font-size:13px;text-align:right;">${fmt(item.unitPrice)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #e5e5e5;color:#111111;font-size:13px;font-weight:600;text-align:right;">${fmt(item.total)}</td>
      </tr>`
    )
    .join('');

  const htmlBody = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111111;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:12px;overflow:hidden;">
    <div style="padding:24px 28px;border-bottom:1px solid #e5e5e5;background:#fafafa;">
      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#737373;font-weight:700;">Liddy Financial Workspace · Official Receipt</div>
      <h1 style="margin:8px 0 4px;font-size:22px;font-weight:700;color:#111111;">Payment Confirmed</h1>
      <div style="font-size:13px;color:#525252;">Invoice <strong>${escapeHtml(input.invoiceNumber || input.referenceCode)}</strong> · Issued ${escapeHtml(input.date)}</div>
    </div>
    <div style="padding:24px 28px;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px;">
        <tr>
          <td style="vertical-align:top;width:50%;padding-right:12px;">
            <div style="font-size:11px;text-transform:uppercase;color:#737373;font-weight:700;margin-bottom:4px;">Billed To</div>
            <div style="font-weight:600;color:#111111;">${escapeHtml(input.buyerName || 'Valued Customer')}</div>
            <div style="color:#525252;">${escapeHtml(input.recipientEmail)}</div>
            ${input.clientTaxId ? `<div style="color:#525252;margin-top:2px;">Tax ID / GSTIN: ${escapeHtml(input.clientTaxId)}</div>` : ''}
          </td>
          <td style="vertical-align:top;width:50%;text-align:right;">
            <div style="font-size:11px;text-transform:uppercase;color:#737373;font-weight:700;margin-bottom:4px;">From</div>
            <div style="font-weight:600;color:#111111;">${escapeHtml(input.senderName || 'Liddy Workspace Billing')}</div>
            ${input.senderTaxId ? `<div style="color:#525252;">Tax ID / GSTIN: ${escapeHtml(input.senderTaxId)}</div>` : ''}
            <div style="color:#525252;margin-top:4px;">Rail: ${escapeHtml(input.paymentRail)}</div>
            <div style="color:#737373;font-size:12px;">Ref: ${escapeHtml(input.referenceCode)}</div>
          </td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
        <thead>
          <tr style="background:#fafafa;border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5;">
            <th style="padding:10px 8px;text-align:left;font-size:11px;text-transform:uppercase;color:#737373;">Description</th>
            <th style="padding:10px 8px;text-align:right;font-size:11px;text-transform:uppercase;color:#737373;">Qty</th>
            <th style="padding:10px 8px;text-align:right;font-size:11px;text-transform:uppercase;color:#737373;">Unit</th>
            <th style="padding:10px 8px;text-align:right;font-size:11px;text-transform:uppercase;color:#737373;">Amount</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>

      <div style="margin-left:auto;max-width:260px;font-size:13px;">
        <div style="display:flex;justify-content:space-between;padding:4px 0;color:#525252;">
          <span>Subtotal</span><span>${fmt(input.subtotal)}</span>
        </div>
        ${input.discountTotal > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 0;color:#16a34a;"><span>Discount</span><span>-${fmt(input.discountTotal)}</span></div>` : ''}
        ${input.taxTotal > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 0;color:#525252;"><span>Tax / GST</span><span>${fmt(input.taxTotal)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:10px 0 4px;margin-top:6px;border-top:2px solid #111111;font-weight:700;font-size:16px;color:#111111;">
          <span>Total Paid</span><span>${fmt(input.grandTotal)}</span>
        </div>
      </div>

      ${input.notes ? `<div style="margin-top:20px;padding:12px 14px;background:#fafafa;border:1px solid #e5e5e5;border-radius:8px;font-size:12px;color:#525252;">${escapeHtml(input.notes)}</div>` : ''}
    </div>
    <div style="padding:16px 28px;border-top:1px solid #e5e5e5;font-size:11px;color:#737373;background:#fafafa;">
      Verified settlement via ${escapeHtml(input.connector || 'Hyperswitch Router')} · Keep this receipt for accounting &amp; tax filing.
    </div>
  </div>
</body>
</html>`;

  const emlContent = [
    `From: ${input.senderName || 'Liddy Billing'} <billing@liddy.finance>`,
    `To: ${input.recipientEmail}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    htmlBody,
  ].join('\r\n');

  const gmailRawBase64Url = Buffer.from(emlContent, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return { subject, htmlBody, emlContent, gmailRawBase64Url };
}

app.get('/api/payments/payout-config', async (req, res) => {
  const authCheck = await verifyAdminRequest(req);
  if (!authCheck.ok) {
    return res.status(authCheck.status || 403).json({ error: authCheck.error });
  }
  const hasPaypal = Boolean(runtimePayoutConfig.paypalClientId && runtimePayoutConfig.paypalClientSecret);
  res.json({
    payoutConfig: runtimePayoutConfig,
    hasPayoutConfigured: Boolean(runtimePayoutConfig.upiId || runtimePayoutConfig.accountNumber || hasPaypal),
    hasPaypalConfigured: hasPaypal,
  });
});

app.get('/api/payments/payout-config/public', (_req, res) => {
  const acct = runtimePayoutConfig.accountNumber || '';
  const hasPaypal = Boolean(runtimePayoutConfig.paypalClientId && runtimePayoutConfig.paypalClientSecret);
  res.json({
    upiId: runtimePayoutConfig.upiId || '',
    payeeName: runtimePayoutConfig.payeeName || '',
    bankName: runtimePayoutConfig.bankName || '',
    accountNumberLast4: acct ? acct.slice(-4) : '',
    paypalEnabled: Boolean(runtimePayoutConfig.paypalEnabled ?? hasPaypal),
    paypalEnvironment: runtimePayoutConfig.paypalEnvironment === 'live' ? 'live' : 'sandbox',
    paypalClientId: runtimePayoutConfig.paypalClientId || '',
    paypalMerchantEmail: runtimePayoutConfig.paypalMerchantEmail || '',
    hasPaypalConfigured: hasPaypal,
    hasPayoutConfigured: Boolean(runtimePayoutConfig.upiId || runtimePayoutConfig.accountNumber || hasPaypal),
    updatedAt: runtimePayoutConfig.updatedAt,
  });
});

async function handleSaveAdminPayoutConfig(req: express.Request, res: express.Response) {
  const authCheck = await verifyAdminRequest(req);
  if (!authCheck.ok) {
    return res.status(authCheck.status || 403).json({ error: authCheck.error });
  }
  try {
    const body = req.body || {};
    const upiId = String(body.upiId || '').trim().slice(0, 120);
    const payeeName = String(body.payeeName || '').trim().slice(0, 120);
    const bankName = String(body.bankName || '').trim().slice(0, 120);
    const accountHolder = String(body.accountHolder || '').trim().slice(0, 120);
    const accountNumber = String(body.accountNumber || '').trim().slice(0, 40);
    const ifscCode = String(body.ifscCode || '').trim().toUpperCase().slice(0, 32);

    const paypalClientId = String(body.paypalClientId || '').trim().slice(0, 200);
    const paypalClientSecret = String(body.paypalClientSecret || '').trim().slice(0, 200);
    const paypalEnvironment: 'sandbox' | 'live' = body.paypalEnvironment === 'live' ? 'live' : 'sandbox';
    const paypalMerchantEmail = String(body.paypalMerchantEmail || '').trim().slice(0, 254);
    const paypalEnabled = typeof body.paypalEnabled === 'boolean'
      ? body.paypalEnabled
      : Boolean(paypalClientId && paypalClientSecret);

    if (upiId && !/^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9.-]{2,}$/.test(upiId)) {
      return res.status(400).json({ error: 'Enter a valid UPI ID (example: yourname@okicici).' });
    }
    if (paypalMerchantEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalMerchantEmail)) {
      return res.status(400).json({ error: 'Enter a valid PayPal merchant email address.' });
    }
    if (paypalEnabled && (!paypalClientId || !paypalClientSecret)) {
      return res.status(400).json({ error: 'Provide both your PayPal Client ID and PayPal Client Secret to enable PayPal checkout.' });
    }
    if (!upiId && !accountNumber && !paypalClientId) {
      return res.status(400).json({ error: 'Provide UPI, bank account or PayPal credentials to receive customer payments.' });
    }
    if (!payeeName) {
      return res.status(400).json({ error: 'Enter a payee or business name.' });
    }

    const saved: RuntimePayoutConfig = {
      upiId,
      payeeName,
      bankName,
      accountHolder,
      accountNumber,
      ifscCode,
      paypalEnabled,
      paypalEnvironment,
      paypalClientId,
      paypalClientSecret,
      paypalMerchantEmail,
      updatedAt: new Date().toISOString(),
    };
    persistPayoutConfig(saved);
    res.json({ ok: true, payoutConfig: saved });
  } catch (err: any) {
    recordFailure('error', 'Payments', 'POST /api/admin/payout-config', 500, err?.message || 'Unable to save payout details.');
    res.status(500).json({ error: err?.message || 'Unable to save payout details.' });
  }
}

app.post('/api/payments/payout-config', handleSaveAdminPayoutConfig);
app.get('/api/admin/payout-config', async (req, res) => {
  const authCheck = await verifyAdminRequest(req);
  if (!authCheck.ok) {
    return res.status(authCheck.status || 403).json({ error: authCheck.error });
  }
  const hasPaypal = Boolean(runtimePayoutConfig.paypalClientId && runtimePayoutConfig.paypalClientSecret);
  res.json({
    payoutConfig: runtimePayoutConfig,
    hasPayoutConfigured: Boolean(runtimePayoutConfig.upiId || runtimePayoutConfig.accountNumber || hasPaypal),
    hasPaypalConfigured: hasPaypal,
  });
});
app.post('/api/admin/payout-config', handleSaveAdminPayoutConfig);

app.get('/api/ai/image-config/public', (_req, res) => {
  res.json(getPublicAiImageConfig());
});

app.get('/api/admin/ai-image-config', async (req, res) => {
  const authCheck = await verifyAdminRequest(req);
  if (!authCheck.ok) {
    return res.status(authCheck.status || 403).json({ error: authCheck.error });
  }
  res.json({
    aiImageConfig: {
      ...runtimeAiImageConfig,
      ...getPublicAiImageConfig(),
    },
  });
});

app.post('/api/admin/ai-image-config', async (req, res) => {
  const authCheck = await verifyAdminRequest(req);
  if (!authCheck.ok) {
    return res.status(authCheck.status || 403).json({ error: authCheck.error });
  }
  try {
    const body = req.body || {};
    const timeoutNum = Number(body.queueTimeoutSec);
    const saved: RuntimeAiImageConfig = {
      aiHordeEnabled: body.aiHordeEnabled !== false,
      aiHordeApiKey: String(body.aiHordeApiKey || '').trim().slice(0, 120),
      cloudflareEnabled: Boolean(body.cloudflareEnabled),
      cloudflareAccountId: String(body.cloudflareAccountId || '').trim().slice(0, 120),
      cloudflareApiToken: String(body.cloudflareApiToken || '').trim().slice(0, 250),
      huggingfaceEnabled: Boolean(body.huggingfaceEnabled),
      huggingfaceToken: String(body.huggingfaceToken || '').trim().slice(0, 250),
      queueTimeoutSec: Number.isFinite(timeoutNum) ? Math.min(90, Math.max(15, Math.round(timeoutNum))) : 45,
      updatedAt: new Date().toISOString(),
    };
    if (saved.cloudflareEnabled && (!saved.cloudflareAccountId || !saved.cloudflareApiToken)) {
      return res.status(400).json({ error: 'Provide both Cloudflare Account ID and API Token to enable Cloudflare FLUX.' });
    }
    if (saved.huggingfaceEnabled && !saved.huggingfaceToken) {
      return res.status(400).json({ error: 'Provide a Hugging Face Access Token to enable Hugging Face FLUX.' });
    }
    persistAiImageConfig(saved);
    res.json({
      ok: true,
      aiImageConfig: {
        ...saved,
        ...getPublicAiImageConfig(),
      },
    });
  } catch (err: any) {
    recordFailure('error', 'AI', 'POST /api/admin/ai-image-config', 500, err?.message || 'Unable to save image engine configuration.');
    res.status(500).json({ error: err?.message || 'Unable to save image engine configuration.' });
  }
});

app.post('/api/admin/ai-image-probe', async (req, res) => {
  const authCheck = await verifyAdminRequest(req);
  if (!authCheck.ok) {
    return res.status(authCheck.status || 403).json({ error: authCheck.error });
  }
  const results: Record<string, any> = {
    checkedAt: new Date().toISOString(),
  };

  // Probe AI Horde active workers
  try {
    const resp = await fetch('https://aihorde.net/api/v2/status/models?type=image', {
      headers: { 'Client-Agent': 'LiddyVisionStudio:1.0:rupk03793@gmail.com' },
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) {
      const models = (await resp.json().catch(() => [])) as any[];
      const active = Array.isArray(models) ? models.filter((m) => Number(m?.count || 0) > 0) : [];
      const totalWorkers = active.reduce((sum, m) => sum + Number(m?.count || 0), 0);
      results.aiHorde = {
        ok: true,
        enabled: runtimeAiImageConfig.aiHordeEnabled,
        activeModelsCount: active.length,
        totalWorkerSlots: totalWorkers,
        topModels: active
          .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
          .slice(0, 6)
          .map((m) => `${m.name} (${m.count} GPU, ~${m.eta}s)`),
      };
    } else {
      results.aiHorde = { ok: false, status: resp.status, error: 'AI Horde status endpoint returned non-200.' };
    }
  } catch (err: any) {
    results.aiHorde = { ok: false, error: err?.message || 'Unable to reach AI Horde.' };
  }

  // Probe Cloudflare Workers AI token validity if configured
  if (runtimeAiImageConfig.cloudflareAccountId && runtimeAiImageConfig.cloudflareApiToken) {
    try {
      const cfResp = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(runtimeAiImageConfig.cloudflareAccountId)}/ai/models/search?per_page=1`,
        {
          headers: { Authorization: `Bearer ${runtimeAiImageConfig.cloudflareApiToken}` },
          signal: AbortSignal.timeout(7000),
        }
      );
      results.cloudflare = {
        ok: cfResp.ok,
        enabled: runtimeAiImageConfig.cloudflareEnabled,
        status: cfResp.status,
      };
    } catch (err: any) {
      results.cloudflare = { ok: false, enabled: runtimeAiImageConfig.cloudflareEnabled, error: err?.message || 'Cloudflare probe failed' };
    }
  } else {
    results.cloudflare = { ok: false, enabled: false, configured: false };
  }

  // Probe Hugging Face token validity if configured
  if (runtimeAiImageConfig.huggingfaceToken) {
    try {
      const hfResp = await fetch('https://huggingface.co/api/whoami-v2', {
        headers: { Authorization: `Bearer ${runtimeAiImageConfig.huggingfaceToken}` },
        signal: AbortSignal.timeout(7000),
      });
      const hfJson: any = await hfResp.json().catch(() => ({}));
      results.huggingface = {
        ok: hfResp.ok,
        enabled: runtimeAiImageConfig.huggingfaceEnabled,
        status: hfResp.status,
        account: hfJson?.name || undefined,
      };
    } catch (err: any) {
      results.huggingface = { ok: false, enabled: runtimeAiImageConfig.huggingfaceEnabled, error: err?.message || 'Hugging Face probe failed' };
    }
  } else {
    results.huggingface = { ok: false, enabled: false, configured: false };
  }

  res.json(results);
});

app.get('/api/geo/region', async (req, res) => {
  try {
    const headerCandidates = [
      req.headers['cf-ipcountry'],
      req.headers['x-vercel-ip-country'],
      req.headers['x-appengine-country'],
      req.headers['x-country-code'],
      req.headers['x-geo-country'],
      req.headers['x-client-country'],
    ];
    for (const raw of headerCandidates) {
      const code = String(raw || '').trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(code) && code !== 'XX' && code !== 'T1') {
        return res.json({
          region: code === 'IN' ? 'IN' : 'INTL',
          countryCode: code,
          source: 'header',
        });
      }
    }

    const tzHint = String(req.query.tz || '').trim();
    const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const rawIp = forwardedFor || req.socket?.remoteAddress || '';
    const cleanIp = rawIp.replace(/^::ffff:/, '').trim();
    const isPrivateIp =
      !cleanIp ||
      cleanIp === '::1' ||
      cleanIp === '127.0.0.1' ||
      cleanIp.startsWith('10.') ||
      cleanIp.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(cleanIp);

    if (!isPrivateIp) {
      try {
        const ipResp = await fetch(`https://ipapi.co/${encodeURIComponent(cleanIp)}/country/`, {
          signal: AbortSignal.timeout(1200),
        });
        if (ipResp.ok) {
          const code = (await ipResp.text()).trim().toUpperCase();
          if (/^[A-Z]{2}$/.test(code)) {
            return res.json({
              region: code === 'IN' ? 'IN' : 'INTL',
              countryCode: code,
              source: 'ip',
            });
          }
        }
      } catch {}
    }

    const tzIsIndia =
      tzHint.includes('Kolkata') ||
      tzHint.includes('Calcutta') ||
      tzHint === 'Asia/Delhi' ||
      tzHint === 'IST';
    return res.json({
      region: tzIsIndia ? 'IN' : 'INTL',
      countryCode: tzIsIndia ? 'IN' : 'US',
      source: tzHint ? 'timezone' : 'default',
    });
  } catch {
    return res.json({ region: 'INTL', countryCode: 'US', source: 'fallback' });
  }
});

app.get('/api/payments/methods', (req, res) => {
  const country = String(req.query.country || 'IN').toUpperCase() === 'IN' ? 'IN' : 'INTL';
  res.json({
    gateway: 'Multi-Currency Checkout Router',
    country,
    currency: country === 'IN' ? 'INR' : 'USD',
    rails: country === 'IN'
      ? [
          { rail: 'UPI_QR', label: 'UPI QR Scan', connector: 'in_upi_qr' },
          { rail: 'UPI_ID', label: 'UPI ID / Handle', connector: 'in_upi_collect' },
        ]
      : [
          { rail: 'PAYPAL', label: 'PayPal', connector: 'paypal_checkout' },
        ],
  });
});

app.post('/api/payments/create-intent', async (req, res) => {
  try {
    const body = req.body || {};
    const requestedTier = String(body.planTier || 'pro').toLowerCase();
    const billingCycle: 'daily' | 'monthly' | 'annual' =
      requestedTier === 'day' || body.billingCycle === 'daily'
        ? 'daily'
        : body.billingCycle === 'annual'
        ? 'annual'
        : 'monthly';
    const planTier: 'day' | 'pro' = billingCycle === 'daily' || requestedTier === 'day' ? 'day' : 'pro';
    const region: 'IN' | 'INTL' = body.region === 'IN' ? 'IN' : 'INTL';
    const validRails = new Set(['UPI_QR', 'UPI_ID', 'PAYPAL']);
    if (body.paymentRail && !validRails.has(body.paymentRail)) {
      return res.status(400).json({ error: 'Selected payment method is not supported. Use UPI in India or PayPal internationally.' });
    }
    const paymentRail = validRails.has(body.paymentRail)
      ? body.paymentRail
      : region === 'IN'
      ? 'UPI_QR'
      : 'PAYPAL';

    const amountUsdEquivalent =
      planTier === 'day'
        ? PLAN_RATES.day.dailyUsd
        : billingCycle === 'annual'
        ? PLAN_RATES.pro.annualTotalUsd
        : PLAN_RATES.pro.monthlyUsd;
    const currency: 'INR' | 'USD' = region === 'IN' ? 'INR' : 'USD';
    const amount =
      region === 'IN'
        ? planTier === 'day'
          ? PLAN_RATES.day.dailyInr
          : billingCycle === 'annual'
          ? PLAN_RATES.pro.annualTotalInr
          : PLAN_RATES.pro.monthlyInr
        : amountUsdEquivalent;

    const connectorMap: Record<string, string> = {
      UPI_QR: 'in_upi_qr',
      UPI_ID: 'in_upi_collect',
      PAYPAL: 'paypal_checkout',
    };

    const paymentId = `pay_hs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const clientSecret = `${paymentId}_secret_${Math.random().toString(36).slice(2, 10)}`;
    const referenceCode = `HS-${region}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const configuredUpi = (runtimePayoutConfig.upiId || '').trim();
    const configuredPayee = (runtimePayoutConfig.payeeName || runtimePayoutConfig.accountHolder || 'Account Owner').trim();
    const hasPaypal = Boolean(runtimePayoutConfig.paypalClientId && runtimePayoutConfig.paypalClientSecret);
    const payoutConfigured = region === 'IN'
      ? Boolean(configuredUpi || runtimePayoutConfig.accountNumber)
      : hasPaypal;

    const upiUri =
      region === 'IN' && configuredUpi
        ? `upi://pay?pa=${encodeURIComponent(configuredUpi)}&pn=${encodeURIComponent(configuredPayee)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(
            `Liddy ${planTier.toUpperCase()} ${referenceCode}`
          )}`
        : undefined;

    const intent: RuntimePaymentRecord & RuntimePaymentIntentExtra = {
      paymentId,
      clientSecret,
      upiUri,
      payeeName: configuredPayee,
      payeeUpiId: configuredUpi || undefined,
      payoutConfigured,
      step1Verified: false,
      userId: String(body.userId || 'guest').slice(0, 128),
      userEmail: body.userEmail ? String(body.userEmail).slice(0, 254) : undefined,
      userName: body.userName ? String(body.userName).slice(0, 120) : undefined,
      planTier,
      billingCycle,
      region,
      currency,
      amount,
      amountUsdEquivalent,
      paymentRail: paymentRail as any,
      connector: connectorMap[paymentRail] || 'checkout_router',
      status: 'requires_action',
      referenceCode,
      createdAt: new Date().toISOString(),
    };

    runtimePaymentIntents.set(paymentId, intent);
    res.status(201).json({
      ...intent,
      paypalConfigured: hasPaypal,
      paypalClientId: runtimePayoutConfig.paypalClientId || '',
      paypalEnvironment: runtimePayoutConfig.paypalEnvironment === 'live' ? 'live' : 'sandbox',
      paypalMerchantEmail: runtimePayoutConfig.paypalMerchantEmail || '',
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unable to initialize payment intent' });
  }
});

// Step 1 Instrument Validation — real SMS confirmation happens next via Firebase Phone Auth
app.post('/api/payments/authorize-rail', (req, res) => {
  try {
    const body = req.body || {};
    const paymentId = String(body.paymentId || '');
    const existing = runtimePaymentIntents.get(paymentId);
    if (!existing) {
      return res.status(404).json({ error: 'Payment session expired or not found.' });
    }

    const rail = String(body.paymentRail || existing.paymentRail);
    let maskedInstrument = '';

    if (rail === 'UPI_ID') {
      const vpa = String(body.upiId || '').trim();
      if (!/^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/.test(vpa)) {
        return res.status(400).json({ error: 'Enter a valid UPI ID (example: name@okicici).' });
      }
      maskedInstrument = vpa;
    } else if (rail === 'UPI_QR') {
      const utr = String(body.upiRef || '').trim();
      if (!isValidUtr(utr)) {
        return res.status(400).json({
          error: 'Scan the UPI QR and enter your 10–24 character UTR transaction reference first.',
        });
      }
      maskedInstrument = `UPI QR (Ref ${utr})`;
    } else if (rail === 'PAYPAL') {
      const hasPaypal = Boolean(runtimePayoutConfig.paypalClientId && runtimePayoutConfig.paypalClientSecret);
      if (!hasPaypal) {
        return res.status(400).json({
          error: 'PayPal receiving credentials are not configured in Admin yet.',
        });
      }
      const buyerEmail = String(body.userEmail || existing.userEmail || '').trim();
      if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
        return res.status(400).json({ error: 'Enter a valid billing email to continue to PayPal.' });
      }
      maskedInstrument = `PayPal (${buyerEmail})`;
    } else {
      return res.status(400).json({ error: 'Selected payment method is unavailable. Use UPI in India or PayPal internationally.' });
    }

    existing.step1Verified = true;
    existing.maskedInstrument = maskedInstrument;
    existing.paymentRail = rail as any;
    runtimePaymentIntents.set(paymentId, existing);

    res.json({
      ok: true,
      requiresSmsVerification: true,
      maskedInstrument,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unable to authorize payment instrument' });
  }
});

async function verifyFirebasePhoneIdToken(
  idToken: string,
  expectedPhone?: string
): Promise<{ valid: boolean; phoneNumber?: string; error?: string }> {
  if (!FIREBASE_WEB_API_KEY) {
    return { valid: false, error: 'Firebase verification key is unavailable on server.' };
  }
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
        signal: AbortSignal.timeout(8000),
      }
    );
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !Array.isArray(data?.users) || data.users.length === 0) {
      return { valid: false, error: 'SMS verification token expired or invalid. Verify your phone code again.' };
    }
    const phone = String(data.users[0]?.phoneNumber || '').trim();
    if (!phone) {
      return { valid: false, error: 'Verified account did not include a confirmed phone number.' };
    }
    if (expectedPhone && expectedPhone.trim() && phone !== expectedPhone.trim()) {
      return { valid: false, error: 'Verified phone number does not match the checkout phone number.' };
    }
    return { valid: true, phoneNumber: phone };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Unable to verify SMS confirmation token.' };
  }
}

app.post('/api/payments/email-otp/send', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address to receive your verification code.' });
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const challengeId = `eotp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    emailOtpChallenges.set(challengeId, {
      email,
      code,
      expiresAt: Date.now() + 10 * 60 * 1000,
      attempts: 0,
    });

    // Clean expired entries
    const now = Date.now();
    for (const [k, v] of emailOtpChallenges.entries()) {
      if (v.expiresAt < now) emailOtpChallenges.delete(k);
    }

    let deliveredViaEmail = false;
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const mailResp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || 'Liddy Checkout <onboarding@resend.dev>',
            to: [email],
            subject: `Your Liddy checkout verification code: ${code}`,
            html: `<p>Your 6-digit Liddy verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
          }),
          signal: AbortSignal.timeout(7000),
        });
        deliveredViaEmail = mailResp.ok;
      } catch {
        deliveredViaEmail = false;
      }
    }

    res.json({
      ok: true,
      challengeId,
      email,
      expiresInSec: 600,
      deliveryMode: deliveredViaEmail ? 'email_inbox' : 'in_app_fallback',
      ...(deliveredViaEmail ? {} : { previewCode: code }),
      notice: deliveredViaEmail
        ? `6-digit verification code sent to ${email}.`
        : 'Firebase SMS is not active yet — use this 6-digit email verification code to complete checkout securely.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unable to generate verification code.' });
  }
});

app.post('/api/payments/email-otp/verify', (req, res) => {
  try {
    const challengeId = String(req.body?.challengeId || '').trim();
    const code = String(req.body?.code || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const record = emailOtpChallenges.get(challengeId);
    if (!record) {
      return res.status(404).json({ error: 'Verification code expired or not found. Request a new code.' });
    }
    if (Date.now() > record.expiresAt) {
      emailOtpChallenges.delete(challengeId);
      return res.status(400).json({ error: 'Verification code expired. Request a new code.' });
    }
    if (email && email !== record.email) {
      return res.status(400).json({ error: 'Email address does not match this verification request.' });
    }
    record.attempts += 1;
    if (record.attempts > 5) {
      emailOtpChallenges.delete(challengeId);
      return res.status(429).json({ error: 'Too many invalid attempts. Request a new code.' });
    }
    if (code !== record.code) {
      return res.status(400).json({ error: 'Incorrect 6-digit code. Please check and try again.' });
    }

    emailOtpChallenges.delete(challengeId);
    const emailOtpToken = `etok_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    verifiedEmailOtpTokens.set(emailOtpToken, {
      email: record.email,
      expiresAt: Date.now() + 20 * 60 * 1000,
    });

    res.json({
      ok: true,
      emailOtpToken,
      verifiedEmail: record.email,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unable to verify email code.' });
  }
});

async function verifyCheckoutIdentity(body: any): Promise<{ valid: boolean; label?: string; method?: 'sms' | 'email'; error?: string }> {
  const firebasePhoneIdToken = String(body?.firebasePhoneIdToken || '').trim();
  const expectedPhone = String(body?.verifiedPhoneNumber || '').trim();
  const emailOtpToken = String(body?.emailOtpToken || '').trim();

  if (firebasePhoneIdToken) {
    const phoneCheck = await verifyFirebasePhoneIdToken(firebasePhoneIdToken, expectedPhone);
    if (!phoneCheck.valid) {
      return { valid: false, error: phoneCheck.error || 'SMS phone verification failed.' };
    }
    return { valid: true, label: phoneCheck.phoneNumber, method: 'sms' };
  }

  if (emailOtpToken) {
    const tokenRecord = verifiedEmailOtpTokens.get(emailOtpToken);
    if (!tokenRecord || Date.now() > tokenRecord.expiresAt) {
      verifiedEmailOtpTokens.delete(emailOtpToken);
      return { valid: false, error: 'Email verification expired. Request and verify a fresh 6-digit code.' };
    }
    return { valid: true, label: tokenRecord.email, method: 'email' };
  }

  return { valid: false, error: 'Complete SMS or 6-digit Email OTP verification before confirming payment.' };
}

app.post('/api/payments/confirm', async (req, res) => {
  try {
    const body = req.body || {};
    const paymentId = String(body.paymentId || '');
    const existing = runtimePaymentIntents.get(paymentId);
    if (!existing) {
      return res.status(404).json({ error: 'Payment session expired or not found.' });
    }

    const rail = String(body.paymentRail || existing.paymentRail);
    const buyerEmail = String(body.userEmail || existing.userEmail || '').trim();
    if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      return res.status(400).json({ error: 'A valid billing email is required for your payment invoice.' });
    }

    if (!existing.step1Verified) {
      return res.status(400).json({
        error: 'Complete payment details in Step 1 before confirming.',
      });
    }

    if (rail === 'UPI_QR') {
      const utr = String(body.upiRef || '').trim();
      if (!isValidUtr(utr)) {
        return res.status(400).json({
          error: 'Enter a valid 10–24 character UPI UTR transaction reference.',
        });
      }
    }

    const identityCheck = await verifyCheckoutIdentity(body);
    if (!identityCheck.valid) {
      return res.status(401).json({
        error: identityCheck.error || 'Checkout verification failed.',
      });
    }

    const confirmed: RuntimePaymentRecord = {
      paymentId: existing.paymentId,
      userId: String(body.userId || existing.userId).slice(0, 128),
      userEmail: buyerEmail.slice(0, 254),
      userName: body.userName ? String(body.userName).slice(0, 120) : existing.userName,
      planTier: existing.planTier,
      billingCycle: existing.billingCycle,
      region: existing.region,
      currency: existing.currency,
      amount: existing.amount,
      amountUsdEquivalent: existing.amountUsdEquivalent,
      paymentRail: rail as any,
      connector: existing.connector,
      status: 'succeeded',
      referenceCode: body.upiRef ? String(body.upiRef).slice(0, 120) : existing.referenceCode,
      createdAt: new Date().toISOString(),
    };

    runtimePaymentIntents.delete(paymentId);
    runtimePaymentsLedger.unshift(confirmed);
    if (runtimePaymentsLedger.length > 250) {
      runtimePaymentsLedger.length = 250;
    }

    runtimeAnalyticsEvents.unshift({
      id: `evt-pay-${Date.now()}`,
      eventType: 'pro_upgrade',
      featureWindow: 'pricing',
      userId: confirmed.userId,
      metadata: `${confirmed.planTier}/${confirmed.region}/${confirmed.paymentRail}/${identityCheck.label || identityCheck.method}`,
      revenueImpactUsd: confirmed.amountUsdEquivalent,
      createdAt: confirmed.createdAt,
    });

    const verifiedViaNote =
      identityCheck.method === 'sms'
        ? `Verified via SMS (${identityCheck.label})`
        : `Verified via Email OTP (${identityCheck.label})`;

    const receiptPayload = buildFormattedInvoiceEmailPayload({
      recipientEmail: confirmed.userEmail || '',
      buyerName: confirmed.userName || 'Liddy Member',
      referenceCode: confirmed.referenceCode,
      invoiceNumber: `INV-${confirmed.referenceCode}`,
      date: confirmed.createdAt.split('T')[0],
      items: [
        {
          description: `Liddy ${confirmed.planTier === 'day' ? '1-Day Pass' : confirmed.planTier.toUpperCase()} (${confirmed.billingCycle})`,
          quantity: 1,
          unitPrice: confirmed.amount,
          total: confirmed.amount,
        },
      ],
      subtotal: confirmed.amount,
      taxTotal: 0,
      discountTotal: 0,
      grandTotal: confirmed.amount,
      currency: confirmed.currency,
      paymentRail: confirmed.paymentRail,
      connector: confirmed.connector,
      senderName: runtimePayoutConfig.payeeName || 'Liddy Workspace Billing',
      notes: runtimePayoutConfig.upiId
        ? `Paid to ${runtimePayoutConfig.payeeName || 'Owner'} (${runtimePayoutConfig.upiId}). ${verifiedViaNote}.`
        : `${verifiedViaNote}. Subscription unlocked immediately.`,
    });

    res.json({
      ok: true,
      payment: confirmed,
      receiptEmail: receiptPayload,
      verifiedPhone: identityCheck.method === 'sms' ? identityCheck.label : undefined,
      verifiedEmail: identityCheck.method === 'email' ? identityCheck.label : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Payment confirmation failed' });
  }
});

// ==========================================
// PAYPAL ORDERS V2 (CREATE & CAPTURE WITH ADMIN CREDENTIALS)
// ==========================================
function getPayPalApiBase(): string {
  return runtimePayoutConfig.paypalEnvironment === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function generatePayPalAccessToken(): Promise<string> {
  const clientId = (runtimePayoutConfig.paypalClientId || '').trim();
  const clientSecret = (runtimePayoutConfig.paypalClientSecret || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('PayPal Client ID and Client Secret must be saved in the Admin Portal first.');
  }
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const resp = await fetch(`${getPayPalApiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10000),
  });
  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.message || 'Unable to authenticate PayPal merchant credentials.');
  }
  return String(data.access_token);
}

app.post('/api/payments/paypal/create-order', async (req, res) => {
  try {
    const body = req.body || {};
    const paymentId = String(body.paymentId || '').trim();
    const existing = runtimePaymentIntents.get(paymentId);
    if (!existing) {
      return res.status(404).json({ error: 'Payment session expired or not found.' });
    }
    const identityCheck = await verifyCheckoutIdentity(body);
    if (!identityCheck.valid) {
      return res.status(401).json({ error: identityCheck.error || 'Complete SMS or Email verification before PayPal checkout.' });
    }

    const accessToken = await generatePayPalAccessToken();
    const amountUsd = Number(existing.amountUsdEquivalent || existing.amount || 0).toFixed(2);
    const merchantEmail = (runtimePayoutConfig.paypalMerchantEmail || '').trim();
    const purchaseUnit: Record<string, any> = {
      reference_id: existing.referenceCode,
      description: `Liddy ${existing.planTier === 'day' ? '1-Day Pass' : existing.planTier.toUpperCase()} (${existing.billingCycle})`,
      amount: {
        currency_code: 'USD',
        value: amountUsd,
      },
    };
    if (merchantEmail) {
      purchaseUnit.payee = { email_address: merchantEmail };
    }

    const ppResp = await fetch(`${getPayPalApiBase()}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [purchaseUnit],
      }),
      signal: AbortSignal.timeout(12000),
    });
    const orderData: any = await ppResp.json().catch(() => ({}));
    if (!ppResp.ok || !orderData?.id) {
      const msg = orderData?.details?.[0]?.description || orderData?.message || 'PayPal rejected order initialization.';
      recordFailure('error', 'Payments', 'POST /api/payments/paypal/create-order', ppResp.status || 502, msg);
      return res.status(ppResp.status >= 400 ? ppResp.status : 502).json({ error: msg });
    }

    res.json({
      ok: true,
      orderId: orderData.id,
      paymentId: existing.paymentId,
      amount: Number(amountUsd),
      currency: 'USD',
      environment: runtimePayoutConfig.paypalEnvironment === 'live' ? 'live' : 'sandbox',
    });
  } catch (err: any) {
    recordFailure('error', 'Payments', 'POST /api/payments/paypal/create-order', 500, err?.message || 'PayPal order creation error');
    res.status(500).json({ error: err?.message || 'Failed to create PayPal order.' });
  }
});

app.post('/api/payments/paypal/capture-order', async (req, res) => {
  try {
    const body = req.body || {};
    const paymentId = String(body.paymentId || '').trim();
    const orderId = String(body.orderId || '').trim();
    const existing = runtimePaymentIntents.get(paymentId);
    if (!existing) {
      return res.status(404).json({ error: 'Payment session expired or not found.' });
    }
    if (!orderId) {
      return res.status(400).json({ error: 'Missing PayPal order ID.' });
    }
    const buyerEmail = String(body.userEmail || existing.userEmail || '').trim();
    if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      return res.status(400).json({ error: 'A valid billing email is required.' });
    }
    const identityCheck = await verifyCheckoutIdentity(body);
    if (!identityCheck.valid) {
      return res.status(401).json({ error: identityCheck.error || 'Verification failed.' });
    }

    const accessToken = await generatePayPalAccessToken();
    const capResp = await fetch(`${getPayPalApiBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(12000),
    });
    const capData: any = await capResp.json().catch(() => ({}));
    if (!capResp.ok || (capData?.status !== 'COMPLETED' && capData?.status !== 'APPROVED')) {
      const issue = capData?.details?.[0]?.issue;
      const msg = capData?.details?.[0]?.description || capData?.message || 'PayPal payment capture was not completed.';
      recordFailure('error', 'Payments', 'POST /api/payments/paypal/capture-order', capResp.status || 400, msg);
      return res.status(400).json({ error: msg, issue });
    }

    const captureId =
      capData?.purchase_units?.[0]?.payments?.captures?.[0]?.id || orderId;
    const payerEmail = capData?.payer?.email_address || buyerEmail;
    const confirmed: RuntimePaymentRecord = {
      paymentId: existing.paymentId,
      userId: String(body.userId || existing.userId).slice(0, 128),
      userEmail: buyerEmail.slice(0, 254),
      userName: body.userName ? String(body.userName).slice(0, 120) : existing.userName,
      planTier: existing.planTier,
      billingCycle: existing.billingCycle,
      region: 'INTL',
      currency: 'USD',
      amount: existing.amountUsdEquivalent,
      amountUsdEquivalent: existing.amountUsdEquivalent,
      paymentRail: 'PAYPAL',
      connector: `paypal_${runtimePayoutConfig.paypalEnvironment === 'live' ? 'live' : 'sandbox'}`,
      status: 'succeeded',
      referenceCode: String(captureId).slice(0, 120),
      createdAt: new Date().toISOString(),
    };

    runtimePaymentIntents.delete(paymentId);
    runtimePaymentsLedger.unshift(confirmed);
    if (runtimePaymentsLedger.length > 250) {
      runtimePaymentsLedger.length = 250;
    }
    runtimeAnalyticsEvents.unshift({
      id: `evt-pp-${Date.now()}`,
      eventType: 'pro_upgrade',
      featureWindow: 'pricing',
      userId: confirmed.userId,
      metadata: `${confirmed.planTier}/INTL/PAYPAL/${captureId}`,
      revenueImpactUsd: confirmed.amountUsdEquivalent,
      createdAt: confirmed.createdAt,
    });

    const verifiedNote =
      identityCheck.method === 'sms'
        ? `SMS verified (${identityCheck.label})`
        : `Email OTP verified (${identityCheck.label})`;

    const receiptPayload = buildFormattedInvoiceEmailPayload({
      recipientEmail: confirmed.userEmail || '',
      buyerName: confirmed.userName || 'Liddy Member',
      referenceCode: confirmed.referenceCode,
      invoiceNumber: `INV-${confirmed.referenceCode}`,
      date: confirmed.createdAt.split('T')[0],
      items: [
        {
          description: `Liddy ${confirmed.planTier === 'day' ? '1-Day Pass' : confirmed.planTier.toUpperCase()} (${confirmed.billingCycle})`,
          quantity: 1,
          unitPrice: confirmed.amount,
          total: confirmed.amount,
        },
      ],
      subtotal: confirmed.amount,
      taxTotal: 0,
      discountTotal: 0,
      grandTotal: confirmed.amount,
      currency: 'USD',
      paymentRail: 'PAYPAL',
      connector: confirmed.connector,
      senderName: runtimePayoutConfig.payeeName || 'Liddy Workspace Billing',
      notes: `Paid via PayPal (${payerEmail}) · Order ${orderId} · ${verifiedNote}.`,
    });

    res.json({
      ok: true,
      payment: confirmed,
      receiptEmail: receiptPayload,
      verifiedPhone: identityCheck.method === 'sms' ? identityCheck.label : undefined,
      verifiedEmail: identityCheck.method === 'email' ? identityCheck.label : undefined,
    });
  } catch (err: any) {
    recordFailure('error', 'Payments', 'POST /api/payments/paypal/capture-order', 500, err?.message || 'PayPal capture failed');
    res.status(500).json({ error: err?.message || 'Unable to capture PayPal payment.' });
  }
});

app.post('/api/payments/receipt-email', (req, res) => {
  try {
    const body = req.body || {};
    const recipientEmail = String(body.recipientEmail || '').trim();
    if (!recipientEmail || !recipientEmail.includes('@')) {
      return res.status(400).json({ error: 'A valid recipient email address is required.' });
    }
    const payload = buildFormattedInvoiceEmailPayload({
      recipientEmail,
      buyerName: String(body.buyerName || 'Customer'),
      referenceCode: String(body.referenceCode || `REF-${Date.now()}`),
      invoiceNumber: String(body.invoiceNumber || `INV-${Date.now()}`),
      date: String(body.date || new Date().toISOString().split('T')[0]),
      items: Array.isArray(body.items) ? body.items : [],
      subtotal: Number(body.subtotal) || Number(body.grandTotal) || 0,
      taxTotal: Number(body.taxTotal) || 0,
      discountTotal: Number(body.discountTotal) || 0,
      grandTotal: Number(body.grandTotal) || 0,
      currency: String(body.currency || 'USD'),
      paymentRail: String(body.paymentRail || 'DIGITAL'),
      connector: String(body.connector || 'Liddy Billing'),
      senderName: body.senderName ? String(body.senderName) : undefined,
      senderTaxId: body.senderTaxId ? String(body.senderTaxId) : undefined,
      clientTaxId: body.clientTaxId ? String(body.clientTaxId) : undefined,
      notes: body.notes ? String(body.notes) : undefined,
    });
    res.json({ ok: true, ...payload });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to build invoice email payload' });
  }
});

app.get('/api/payments/history', (_req, res) => {
  res.json({ payments: runtimePaymentsLedger });
});

// Dedicated Mind Map AI Generator (/api/gemini/vision-mindmap)
app.post('/api/gemini/vision-mindmap', async (req, res) => {
  const topic = String(req.body?.topic || '').trim();
  if (!topic) {
    return res.status(400).json({ error: 'Enter a topic or idea to map.' });
  }

  const fallbackNodes = {
    title: topic.slice(0, 72),
    nodes: [
      { id: 'n-root', label: topic.slice(0, 44), x: 350, y: 185, color: 'indigo', shape: 'hub', metricTag: 'Core Goal', parentId: null, notes: 'Central focus & shared outcome' },
      { id: 'n-1', label: 'Key Problem & Need', x: 70, y: 55, color: 'sky', shape: 'insight', metricTag: 'Discovery', parentId: 'n-root', notes: 'What everyday friction this solves' },
      { id: 'n-2', label: 'Budget & Numbers', x: 640, y: 55, color: 'emerald', shape: 'metric', metricTag: 'Key Metric', parentId: 'n-root', notes: 'Target savings, costs & return' },
      { id: 'n-3', label: 'Step 1: First Milestone', x: 70, y: 315, color: 'amber', shape: 'step', metricTag: 'Phase 1', parentId: 'n-root', notes: 'Immediate action for this week' },
      { id: 'n-4', label: 'Step 2: Launch & Review', x: 640, y: 315, color: 'rose', shape: 'action', metricTag: 'Next Step', parentId: 'n-root', notes: 'Share results and refine plan' },
    ],
  };

  if (shouldSkipGeminiCall()) {
    return res.json(fallbackNodes);
  }

  try {
    const ai = getAiClient();
    const response = await generateWithHydrogenFailover(ai, {
      contents: `Generate a structured visual mind map for: "${topic}".
Return raw JSON only with keys:
- "title": concise 4-7 word board title
- "nodes": array of 6 nodes covering distinct angles.
  First node MUST have id "n-root", parentId null, shape "hub", x: 350, y: 185.
  Other 5 nodes have parentId "n-root" (or another node's id), spaced cleanly in canvas x: 40..660, y: 40..340 with at least 190px apart so cards never overlap.
  Each node has: { id, label (max 36 chars), notes (max 90 chars), x, y, color ("indigo"|"sky"|"emerald"|"amber"|"rose"|"neutral"), shape ("hub"|"step"|"insight"|"metric"|"action"), metricTag (short 1-2 word badge like "Phase 1" or "Target"), parentId }.`,
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const raw = response.text?.trim() || '';
    if (raw) {
      const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed?.nodes) && parsed.nodes.length > 0) {
        return res.json(parsed);
      }
    }
    res.json(fallbackNodes);
  } catch (err: any) {
    markQuotaExhausted(err);
    res.json(fallbackNodes);
  }
});

// Dedicated Visual Slide Deck AI Generator (/api/gemini/vision-slides)
const VALID_SLIDE_THEMES = new Set(['ivory', 'midnight', 'emerald', 'cobalt', 'ledger', 'navy', 'charcoal', 'growth']);
const VALID_FONT_STYLES = new Set(['swiss_sans', 'editorial_serif', 'mono_quant', 'executive_geometric']);
const VALID_CONTENT_STYLES = new Set(['short', 'brief', 'medium', 'detailed']);
const VALID_GRAPHICS_STYLES = new Set(['charts', 'diagrams', 'cards', 'roadmap', 'minimal']);
const VALID_SLIDE_LAYOUTS = ['cover', 'metrics', 'two-col', 'roadmap'] as const;

function buildFinancialFallbackSlide(
  index: number,
  total: number,
  topic: string,
  opts: {
    theme: string;
    fontStyle: string;
    contentStyle: string;
    graphicsStyle: string;
    audience: string;
  }
) {
  const layout = index === 0 ? 'cover' : VALID_SLIDE_LAYOUTS[(index % 3) + 1];
  const shortTopic = topic.slice(0, 52);
  const bulletCount = opts.contentStyle === 'short' ? 2 : opts.contentStyle === 'detailed' ? 4 : 3;

  const catalog = [
    {
      title: shortTopic,
      subtitle: `${opts.audience} · Financial Brief & Executive Outlook`,
      metricHighlight: 'FY Outlook',
      bullets: [
        'Primary financial objective, capital efficiency target & horizon',
        'Key revenue drivers, expense discipline and reserve buffer ratios',
        'Decision checkpoints aligned for stakeholder approval',
        'Risk-adjusted upside scenarios with monthly variance tracking',
      ],
      chartBars: [
        { label: 'Q1', value: 42 },
        { label: 'Q2', value: 58 },
        { label: 'Q3', value: 74 },
        { label: 'Q4', value: 92 },
      ],
    },
    {
      title: 'Core Revenue & Cashflow KPIs',
      subtitle: 'Operating performance & unit economics benchmark',
      metricHighlight: '+28% YoY',
      bullets: [
        'Net operating cashflow margin expanded by +420 bps YoY',
        'Recurring revenue share crossed 72% with stable collection velocity',
        'Working capital runway maintained at 14+ months coverage',
        'Customer acquisition payback reduced below 6.5 billing cycles',
      ],
      chartBars: [
        { label: 'Rev', value: 86 },
        { label: 'Gross', value: 68 },
        { label: 'OpEx', value: 44 },
        { label: 'FCF', value: 56 },
      ],
    },
    {
      title: 'Cost Structure & Margin Allocation',
      subtitle: 'Disciplined capital deployment across core pillars',
      metricHighlight: '74% Gross',
      bullets: [
        'Direct COGS & infrastructure optimized at 26% of gross receipts',
        'Growth & customer acquisition capped inside a 3.8x LTV/CAC guardrail',
        'Tax & contingency reserve set aside automatically each cycle',
        'Fixed overhead kept lean with zero-based quarterly budget audits',
      ],
      chartBars: [
        { label: 'Core', value: 74 },
        { label: 'Growth', value: 48 },
        { label: 'Reserve', value: 32 },
        { label: 'Tax', value: 22 },
      ],
    },
    {
      title: '90-Day Capital Allocation Roadmap',
      subtitle: 'Phased execution milestones & treasury checkpoints',
      metricHighlight: '3 Phases',
      bullets: [
        'Phase 1: Lock quarterly budget ceilings & sweep surplus into T-bills',
        'Phase 2: Reprice high-margin tiers & automate receivables follow-ups',
        'Phase 3: Rebalance portfolio exposure & review Q4 dividend targets',
        'Audit monthly ledger variance against conservative base case',
      ],
      chartBars: [
        { label: 'P1', value: 35 },
        { label: 'P2', value: 65 },
        { label: 'P3', value: 95 },
      ],
    },
    {
      title: 'Scenario Stress Test & Downside Guardrails',
      subtitle: 'Sensitivity analysis across base, bull & conservative cases',
      metricHighlight: '14 Mo Runway',
      bullets: [
        'Base case sustains 22% EBITDA margin at current run-rate',
        'Conservative -15% demand stress preserves positive net cashflow',
        'Upside acceleration funds expansion strictly from operating surplus',
        'Automated trigger halts discretionary spend if reserve dips < 6 mo',
      ],
      chartBars: [
        { label: 'Bear', value: 45 },
        { label: 'Base', value: 72 },
        { label: 'Bull', value: 96 },
      ],
    },
    {
      title: 'Portfolio & Treasury Yield Mix',
      subtitle: 'Balanced liquidity, equities & fixed-income weighting',
      metricHighlight: '11.4% IRR',
      bullets: [
        'Core index & dividend equities form 55% long-horizon anchor',
        'Sovereign bonds & liquid treasury funds hold 30% shock buffer',
        'Tactical cash reserve retains 15% dry powder for dips',
        'Quarterly rebalance enforces strict +/- 5% drift bands',
      ],
      chartBars: [
        { label: 'Equity', value: 55 },
        { label: 'Bonds', value: 30 },
        { label: 'Cash', value: 15 },
      ],
    },
  ];

  const tpl = catalog[index % catalog.length];
  const suffixTitle =
    index >= catalog.length ? `${tpl.title} — Part ${index + 1}` : tpl.title;
  const trimmedBullets = tpl.bullets.slice(0, bulletCount).map((b) =>
    opts.contentStyle === 'short' ? b.split(',')[0].slice(0, 56) : b
  );

  return {
    id: `s-${index + 1}`,
    title: index === 0 ? shortTopic : suffixTitle,
    subtitle: index === 0 ? `${opts.audience} · ${total}-Slide Financial Deck` : tpl.subtitle,
    bullets: trimmedBullets,
    layout,
    theme: opts.theme,
    fontStyle: opts.fontStyle,
    contentStyle: opts.contentStyle,
    graphicsStyle: opts.graphicsStyle,
    metricHighlight: tpl.metricHighlight,
    chartBars: tpl.chartBars,
  };
}

app.post('/api/gemini/vision-slides', async (req, res) => {
  const topic = String(req.body?.topic || '').trim();
  if (!topic) {
    return res.status(400).json({ error: 'Enter a financial topic to build slides.' });
  }

  const parsedCount = Number(req.body?.slideCount);
  const slideCount = Number.isFinite(parsedCount) ? Math.min(15, Math.max(4, Math.round(parsedCount))) : 6;
  const theme = VALID_SLIDE_THEMES.has(req.body?.theme) ? String(req.body.theme) : 'ivory';
  const fontStyle = VALID_FONT_STYLES.has(req.body?.fontStyle) ? String(req.body.fontStyle) : 'swiss_sans';
  const contentStyle = VALID_CONTENT_STYLES.has(req.body?.contentStyle) ? String(req.body.contentStyle) : 'medium';
  const graphicsStyle = VALID_GRAPHICS_STYLES.has(req.body?.graphicsStyle) ? String(req.body.graphicsStyle) : 'charts';
  const audience = String(req.body?.audience || 'Executive & Financial Review').trim().slice(0, 60);

  const normalizeSlideDeck = (rawTitle: string | undefined, rawSlides: any[]) => {
    const cleanSlides: any[] = [];
    for (let i = 0; i < slideCount; i++) {
      const candidate = Array.isArray(rawSlides) ? rawSlides[i] : null;
      const fallback = buildFinancialFallbackSlide(i, slideCount, topic, {
        theme,
        fontStyle,
        contentStyle,
        graphicsStyle,
        audience,
      });

      if (candidate && typeof candidate === 'object') {
        const bulletsRaw = Array.isArray(candidate.bullets)
          ? candidate.bullets.map((b: any) => String(b || '').trim()).filter(Boolean)
          : [];
        const targetCount = contentStyle === 'short' ? 2 : contentStyle === 'detailed' ? 4 : 3;
        const normalizedBullets =
          bulletsRaw.length > 0 ? bulletsRaw.slice(0, targetCount) : fallback.bullets;
        const bars = Array.isArray(candidate.chartBars)
          ? candidate.chartBars
              .slice(0, 5)
              .map((b: any) => ({
                label: String(b?.label || 'M').slice(0, 10),
                value: Math.max(5, Math.min(100, Number(b?.value) || 50)),
              }))
          : fallback.chartBars;
        cleanSlides.push({
          id: `s-${i + 1}`,
          title: String(candidate.title || fallback.title).slice(0, 68),
          subtitle: String(candidate.subtitle || fallback.subtitle).slice(0, 96),
          bullets: normalizedBullets,
          layout: VALID_SLIDE_LAYOUTS.includes(candidate.layout) ? candidate.layout : fallback.layout,
          theme,
          fontStyle,
          contentStyle,
          graphicsStyle,
          metricHighlight: candidate.metricHighlight ? String(candidate.metricHighlight).slice(0, 28) : fallback.metricHighlight,
          chartBars: bars,
        });
      } else {
        cleanSlides.push(fallback);
      }
    }

    return {
      title: String(rawTitle || topic).slice(0, 76),
      slides: cleanSlides,
    };
  };

  const fallbackDeck = normalizeSlideDeck(topic, []);

  if (shouldSkipGeminiCall()) {
    return res.json(fallbackDeck);
  }

  const densityInstruction =
    contentStyle === 'short'
      ? 'Keep each slide ultra-minimal: strictly 2 punchy bullets of max 8 words each.'
      : contentStyle === 'brief'
      ? 'Keep text concise: strictly 2–3 tight executive points under 12 words each.'
      : contentStyle === 'detailed'
      ? 'Provide rich analytical depth: strictly 4 data-backed bullets (15–22 words each) with realistic metrics.'
      : 'Keep balanced clarity: 3 concrete bullets (10–15 words each).';

  try {
    const ai = getAiClient();
    const response = await generateWithHydrogenFailover(ai, {
      contents: `You are a senior financial presentation architect (inspired by Gamma & Swiss financial reporting).
Create a strictly finance-focused, investor-grade ${slideCount}-slide presentation deck about: "${topic}".
Target Audience: "${audience}".
Graphics Preference: "${graphicsStyle}".
Content Density Rule: ${densityInstruction}

CRITICAL REQUIREMENTS:
1. Stay 100% focused on finance, budgeting, revenue, investments, margins, cashflow, or financial goals.
2. You MUST return an array of EXACTLY ${slideCount} slide objects in "slides" (no more, no fewer than ${slideCount}).

Return raw JSON only with keys:
- "title": crisp financial presentation title
- "slides": array of EXACTLY ${slideCount} slides with varied layouts ("cover", "metrics", "two-col", "roadmap").
  Each slide object MUST contain:
  {
    id: "s-1", "s-2", ..., "s-${slideCount}",
    title: string (max 60 chars),
    subtitle: string (max 85 chars),
    bullets: string[],
    layout: "cover" | "metrics" | "two-col" | "roadmap",
    metricHighlight: string (concise financial figure like "$142K MRR", "+28% YoY", "18 Mo Runway"),
    chartBars: array of 3-4 objects { label: short 2-6 char label like "Q1" or "Rev", value: integer 15..100 }
  }.`,
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const raw = response.text?.trim() || '';
    if (raw) {
      const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed?.slides) && parsed.slides.length > 0) {
        return res.json(normalizeSlideDeck(parsed.title, parsed.slides));
      }
    }
    res.json(fallbackDeck);
  } catch (err: any) {
    markQuotaExhausted(err);
    res.json(fallbackDeck);
  }
});

// ==========================================
// 1. CHAT & MULTIMODAL FINANCE AGENT
// ==========================================
const FINANCIAL_AGENT_TOOLS: FunctionDeclaration[] = [
  {
    name: 'activate_financial_skill',
    description:
      'Activate a specialized financial analysis or bookkeeping skill before performing complex audits, data cleansing, tax checks, or portfolio valuations.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        skillName: {
          type: Type.STRING,
          description:
            'Financial skill to activate: cashflow_forensic, ledger_cleansing, tax_optimization, portfolio_rebalance, or invoice_reconciliation.',
        },
      },
      required: ['skillName'],
    },
  },
  {
    name: 'analyze_ledger_and_cashflow',
    description:
      'Analyze user transactions, income, spending categories, recurring expenses, and anomalies directly from the financial snapshot.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        categoryFilter: {
          type: Type.STRING,
          description: 'Optional category name to filter by.',
        },
        merchantFilter: {
          type: Type.STRING,
          description: 'Optional merchant substring to filter by.',
        },
      },
    },
  },
  {
    name: 'cleanse_ledger_data',
    description:
      'Automatically cleanse transaction data: remove duplicate entries, normalize merchant casing/prefixes, standardize generic categories, and prune invalid zero/negative amounts.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        removeDuplicates: {
          type: Type.BOOLEAN,
          description: 'Remove duplicate transactions having the same date, normalized merchant, and amount.',
        },
        normalizeMerchants: {
          type: Type.BOOLEAN,
          description: 'Clean noisy payment prefixes (UPI/, POS/, card codes) and fix merchant capitalization.',
        },
        standardizeCategories: {
          type: Type.BOOLEAN,
          description: 'Assign clean standard financial categories to uncategorized or General items based on merchant.',
        },
        removeInvalidAmounts: {
          type: Type.BOOLEAN,
          description: 'Remove corrupted transactions with zero or negative amounts.',
        },
      },
    },
  },
  {
    name: 'add_or_update_transactions',
    description:
      'Add new financial transactions or update existing ones (merchant, amount, category, date, recurring status, or notes).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        additions: {
          type: Type.ARRAY,
          description: 'New transactions to record.',
          items: {
            type: Type.OBJECT,
            properties: {
              merchant: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              category: { type: Type.STRING },
              date: { type: Type.STRING, description: 'YYYY-MM-DD' },
              isRecurring: { type: Type.BOOLEAN },
              paymentMethod: { type: Type.STRING, description: 'UPI, CARD, CASH, SCAN_RECEIPT, or INVOICE' },
              notes: { type: Type.STRING },
            },
            required: ['merchant', 'amount', 'category'],
          },
        },
        updates: {
          type: Type.ARRAY,
          description: 'Updates to apply to existing transaction IDs.',
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              merchant: { type: Type.STRING },
              amount: { type: Type.NUMBER },
              category: { type: Type.STRING },
              date: { type: Type.STRING },
              isRecurring: { type: Type.BOOLEAN },
              notes: { type: Type.STRING },
            },
            required: ['id'],
          },
        },
      },
    },
  },
  {
    name: 'delete_transactions',
    description: 'Delete specific financial transactions by their exact transaction IDs.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        transactionIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Array of transaction IDs to remove from the ledger.',
        },
      },
      required: ['transactionIds'],
    },
  },
  {
    name: 'audit_invoices_and_receivables',
    description:
      'Inspect client invoices, paid vs unpaid receivables, tax totals, and optionally mark specific invoices as paid.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        markPaidInvoiceIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Optional list of invoice IDs to mark as settled/paid automatically.',
        },
        paymentMethod: {
          type: Type.STRING,
          description: 'Payment rail when marking paid: UPI, CARD, CASH, or INVOICE.',
        },
      },
    },
  },
  {
    name: 'analyze_financial_ratios_and_portfolio',
    description:
      'Compute quantitative financial ratios, burn rate, portfolio gain/loss, concentration risk, and liquidity metrics.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        monthlyIncomeAssumption: {
          type: Type.NUMBER,
          description: 'Optional estimated monthly income if not present in transactions.',
        },
      },
    },
  },
  {
    name: 'generate_visual_dashboard',
    description:
      'Render one or more interactive visual charts (bar, pie, or area) inside the chat response from extracted bill PDFs, CSVs, or workspace ledger numbers.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        charts: {
          type: Type.ARRAY,
          description: 'Up to 3 visual charts to display inside the response.',
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              subtitle: { type: Type.STRING },
              chartType: { type: Type.STRING, description: 'bar | pie | area' },
              valuePrefix: { type: Type.STRING, description: 'Currency symbol or blank for counts' },
              data: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    value: { type: Type.NUMBER },
                    secondaryValue: { type: Type.NUMBER },
                  },
                  required: ['name', 'value'],
                },
              },
            },
            required: ['title', 'chartType', 'data'],
          },
        },
      },
      required: ['charts'],
    },
  },
  {
    name: 'export_csv_dashboard',
    description:
      'Generate a structured downloadable CSV dashboard file containing extracted bill line items, financial metrics, or ledger breakdown rows.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filename: { type: Type.STRING, description: 'File name ending in .csv' },
        title: { type: Type.STRING },
        headers: { type: Type.ARRAY, items: { type: Type.STRING } },
        rows: {
          type: Type.ARRAY,
          items: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      },
      required: ['filename', 'title', 'headers', 'rows'],
    },
  },
  {
    name: 'export_pdf_report',
    description:
      'Compile a downloadable formatted PDF financial report with executive KPIs, bulleted insights, and structured line-item or summary tables.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        filename: { type: Type.STRING, description: 'File name ending in .pdf' },
        title: { type: Type.STRING },
        subtitle: { type: Type.STRING },
        kpis: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              value: { type: Type.STRING },
            },
            required: ['label', 'value'],
          },
        },
        sections: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              heading: { type: Type.STRING },
              bullets: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['heading', 'bullets'],
          },
        },
        table: {
          type: Type.OBJECT,
          properties: {
            headers: { type: Type.ARRAY, items: { type: Type.STRING } },
            rows: {
              type: Type.ARRAY,
              items: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
          },
        },
      },
      required: ['filename', 'title', 'kpis', 'sections'],
    },
  },
];

function inferCleanCategory(merchant: string, currentCategory: string): string {
  const rawCat = String(currentCategory || '').trim();
  const m = String(merchant || '').toLowerCase();
  if (rawCat && !['general', 'other', 'misc', 'uncategorized', 'unknown'].includes(rawCat.toLowerCase())) {
    return rawCat;
  }
  if (/uber|ola|lyft|rapido|metro|fuel|shell|bpcl|hpcl|indigo|airlines|irctc/.test(m)) return 'Transport';
  if (/swiggy|zomato|starbucks|cafe|coffee|restaurant|mcdonald|dominos|blinkit|zepto|instamart|grocery|bigbasket/.test(m)) {
    return /blinkit|zepto|instamart|grocery|bigbasket/.test(m) ? 'Groceries' : 'Dining & Coffee';
  }
  if (/aws|google cloud|azure|openai|vercel|github|figma|notion|adobe|slack|zoom|microsoft|apple/.test(m)) {
    return 'Software & Subscriptions';
  }
  if (/netflix|spotify|prime|hotstar|cinema|pvr|bookmyshow/.test(m)) return 'Entertainment';
  if (/pharmacy|apollo|medplus|hospital|clinic|health|1mg|pharmeasy/.test(m)) return 'Healthcare';
  if (/electricity|bescom|water|jio|airtel|act|broadband|wifi|gas|rent|maintenance/.test(m)) return 'Utilities & Bills';
  if (/salary|payroll|dividend|interest|refund|cashback|client|stripe|razorpay|retainer|invoice/.test(m)) {
    return 'Income & Receivables';
  }
  if (/amazon|flipkart|myntra|ikea|decathlon|retail/.test(m)) return 'Shopping';
  return rawCat || 'Operating Expenses';
}

function normalizeMerchantLabel(merchant: string): string {
  let clean = String(merchant || '')
    .replace(/^(upi|pos|neft|imps|rtgs|ach|bil|txn|trf)[/:*\-\s]+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) clean = 'Recorded Merchant';
  return clean
    .split(' ')
    .map((word) => (word.length <= 2 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join(' ');
}

function isIncomeLikeTransaction(tx: any): boolean {
  const cat = String(tx?.category || '').toLowerCase();
  const merch = String(tx?.merchant || '').toLowerCase();
  const method = String(tx?.paymentMethod || '').toUpperCase();
  return (
    method === 'INVOICE' ||
    cat.includes('income') ||
    cat.includes('salary') ||
    cat.includes('revenue') ||
    cat.includes('receivable') ||
    cat.includes('retainer') ||
    /salary|payroll|client retainer|settled/.test(merch)
  );
}

function isPrivateOrUnsafeHost(hostname: string): boolean {
  const h = hostname.toLowerCase().trim();
  if (!h || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' || h.endsWith('.local')) {
    return true;
  }
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  const match172 = h.match(/^172\.(\d+)\./);
  if (match172 && Number(match172[1]) >= 16 && Number(match172[1]) <= 31) return true;
  return false;
}

function parseJsonOrSsePayload(rawText: string, contentType: string): any {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) return null;
  if (!contentType.includes('text/event-stream')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to SSE line scan
    }
  }
  const lines = trimmed.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        return JSON.parse(payload);
      } catch {
        continue;
      }
    }
  }
  return null;
}

app.get('/api/skills/search', async (req, res) => {
  const queryText = String(req.query?.q || '').trim().slice(0, 120);
  const qLower = queryText.toLowerCase();

  const matchingCurated = CURATED_FINANCE_SKILLS.filter((item) => {
    if (!qLower) return true;
    const hay = `${item.name} ${item.slug} ${item.category} ${item.description} ${item.triggers}`.toLowerCase();
    return hay.includes(qLower);
  });

  const liveSkills: typeof CURATED_FINANCE_SKILLS = [];
  if (queryText.length >= 2) {
    try {
      const registryUrl = `https://skills.sh/api/skills?q=${encodeURIComponent(queryText)}&limit=10`;
      const upstream = await fetch(registryUrl, {
        headers: { Accept: 'application/json', 'User-Agent': 'LiddyFinanceAgent/1.0' },
        signal: AbortSignal.timeout(3500),
      });
      if (upstream.ok) {
        const body = await upstream.json().catch(() => null);
        const rows = Array.isArray(body?.skills) ? body.skills : Array.isArray(body) ? body : [];
        for (const r of rows.slice(0, 10)) {
          const slug = String(r?.slug || r?.skillId || r?.id || r?.name || '')
            .toLowerCase()
            .replace(/[^a-z0-9-_]/g, '-')
            .slice(0, 80);
          if (!slug) continue;
          const name = String(r?.name || r?.title || slug).slice(0, 100);
          const desc = String(r?.description || r?.summary || `Community skill imported from skills.sh (${slug}).`).slice(0, 260);
          const repo = String(r?.source || r?.repo || `skills.sh/${slug}`).slice(0, 120);
          liveSkills.push({
            id: `skill_sh_${slug}`,
            slug,
            name,
            description: desc,
            category: String(r?.category || 'skills.sh Registry').slice(0, 48),
            author: String(r?.author || r?.owner || 'skills.sh').slice(0, 60),
            repo,
            installs: Number(r?.installs || r?.downloads || 0) || 0,
            triggers: String(r?.triggers || slug.replace(/-/g, ', ')).slice(0, 140),
            sourceUrl: r?.url ? String(r.url) : `https://skills.sh/skills/${slug}`,
            instructionsMarkdown:
              typeof r?.instructionsMarkdown === 'string' && r.instructionsMarkdown.trim()
                ? r.instructionsMarkdown.slice(0, 12000)
                : `---\nname: ${slug}\ndescription: ${desc}\nsource: ${repo}\n---\n\n# ${name}\n\n## Role & Guidelines\n- Apply ${desc}\n- Adapt all computations, audit notes, charts, and CSV/PDF outputs to the user's financial workspace context.`,
          });
        }
      }
    } catch {
      // Upstream timeout or unreachable — gracefully rely on curated finance skills library
    }
  }

  const seenSlugs = new Set<string>();
  const combined: typeof CURATED_FINANCE_SKILLS = [];
  for (const item of [...liveSkills, ...matchingCurated]) {
    if (seenSlugs.has(item.slug)) continue;
    seenSlugs.add(item.slug);
    combined.push(item);
  }

  res.json({
    skills: combined,
    source: liveSkills.length > 0 ? 'skills.sh+curated' : 'curated',
  });
});

app.post('/api/mcp/inspect', async (req, res) => {
  const started = Date.now();
  const endpointUrl = String(req.body?.endpointUrl || '').trim().slice(0, 512);
  const transport = String(req.body?.transport || 'http');
  const authType = String(req.body?.authType || 'none');
  const authToken = typeof req.body?.authToken === 'string' ? req.body.authToken.trim().slice(0, 512) : '';

  const catalogMatch = MCP_CONNECTOR_TEMPLATES.find((t) => t.endpointUrl === endpointUrl);
  if (catalogMatch && !authToken) {
    return res.json({
      ok: true,
      serverName: catalogMatch.name,
      protocolVersion: '2025-03-26',
      tools: catalogMatch.toolsList,
      latencyMs: Date.now() - started,
    });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(endpointUrl);
  } catch {
    return res.status(400).json({ ok: false, tools: [], error: 'Enter a valid HTTP/HTTPS MCP endpoint URL.' });
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return res.status(400).json({ ok: false, tools: [], error: 'Only http:// and https:// MCP endpoints are supported.' });
  }
  if (isPrivateOrUnsafeHost(parsedUrl.hostname)) {
    return res.status(400).json({
      ok: false,
      tools: [],
      error: 'Localhost and private network IP addresses cannot be inspected from the cloud sandbox.',
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (authToken) {
    if (authType === 'api_key') {
      headers['x-api-key'] = authToken;
    } else {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
  }

  try {
    const initResp = await fetch(parsedUrl.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'Liddy-AI-CFO', version: '1.0.0' },
        },
      }),
      signal: AbortSignal.timeout(4500),
    });

    const initSessionId = initResp.headers.get('mcp-session-id');
    const initText = await initResp.text();
    const initJson = parseJsonOrSsePayload(initText, initResp.headers.get('content-type') || '');

    if (!initResp.ok && initResp.status >= 400) {
      return res.json({
        ok: false,
        tools: [],
        latencyMs: Date.now() - started,
        error: `Remote server responded with HTTP ${initResp.status}. Verify endpoint URL and credentials.`,
      });
    }

    const listHeaders: Record<string, string> = { ...headers };
    if (initSessionId) listHeaders['mcp-session-id'] = initSessionId;

    let discoveredTools: string[] = [];
    try {
      const toolsResp = await fetch(parsedUrl.toString(), {
        method: 'POST',
        headers: listHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
        signal: AbortSignal.timeout(4000),
      });
      const toolsText = await toolsResp.text();
      const toolsJson = parseJsonOrSsePayload(toolsText, toolsResp.headers.get('content-type') || '');
      const rawTools = toolsJson?.result?.tools;
      if (Array.isArray(rawTools)) {
        discoveredTools = rawTools
          .map((t: any) => String(t?.name || '').trim())
          .filter(Boolean)
          .slice(0, 40);
      }
    } catch {
      // Some minimal servers only return capabilities on initialize
    }

    return res.json({
      ok: true,
      serverName: String(initJson?.result?.serverInfo?.name || parsedUrl.hostname),
      protocolVersion: String(initJson?.result?.protocolVersion || '2025-03-26'),
      tools: discoveredTools,
      latencyMs: Date.now() - started,
    });
  } catch (err: any) {
    return res.json({
      ok: false,
      tools: [],
      latencyMs: Date.now() - started,
      error: err?.name === 'TimeoutError'
        ? 'MCP endpoint timed out after 4.5s.'
        : `Unable to complete MCP handshake (${err?.message || 'network error'}).`,
    });
  }
});

app.post('/api/gemini/agent', async (req, res) => {
  const FRIENDLY_ERROR =
    "Sorry, I wasn't able to proceed with that request right now. Please try again in a moment.";

  if (shouldSkipGeminiCall()) {
    const isMissingKey = !(process.env.API_KEY || process.env.GEMINI_API_KEY);
    return res.status(503).json({
      error: isMissingKey
        ? 'Gemini API key is not configured yet. Add GEMINI_API_KEY in Settings > Secrets.'
        : 'AI assistant is briefly cooling down after a rate limit. Please try again in a few seconds.',
    });
  }

  try {
    const {
      prompt,
      mode = 'chat',
      attachment,
      history = [],
      financialContext,
      activeSkills = [],
      activeConnectors = [],
    } = req.body || {};
    const ai = getAiClient();

    const safeTxList: any[] = Array.isArray(financialContext?.transactions)
      ? financialContext.transactions.slice(0, 180)
      : [];
    const safeInvoices: any[] = Array.isArray(financialContext?.invoices)
      ? financialContext.invoices.slice(0, 60)
      : [];
    const currencySym = String(financialContext?.currencySymbol || '₹').slice(0, 6);
    const stockPortfolio = financialContext?.stockPortfolio || null;
    const watchlist: string[] = Array.isArray(financialContext?.watchlist) ? financialContext.watchlist.slice(0, 30) : [];

    // Working mutable snapshot inside this multi-turn loop so sequential tool calls see prior mutations
    let workingTx = safeTxList.map((t) => ({ ...t }));
    let workingInvoices = safeInvoices.map((inv) => ({ ...inv }));

    const pendingAdds: any[] = [];
    const pendingUpdatesMap = new Map<string, any>();
    const pendingDeletesSet = new Set<string>();
    const pendingInvoicePaid: Array<{ id: string; paymentMethod?: string }> = [];
    const activatedToolsSet = new Set<string>();
    const collectedCharts: Array<{
      id: string;
      title: string;
      subtitle?: string;
      chartType: 'bar' | 'pie' | 'trend';
      currencySymbol?: string;
      data: Array<{ label: string; value: number; secondaryValue?: number }>;
    }> = [];
    let collectedCsvExport: {
      filename: string;
      title: string;
      headers: string[];
      rows: string[][];
      rowCount: number;
      csvContent: string;
    } | null = null;
    let collectedPdfReport: {
      filename: string;
      title: string;
      subtitle?: string;
      generatedAt: string;
      currencySymbol?: string;
      kpis: Array<{ label: string; value: string }>;
      sections: Array<{
        heading: string;
        bullets?: string[];
        table?: { headers: string[]; rows: Array<Array<string | number>> };
      }>;
    } | null = null;

    const safeActiveSkills = Array.isArray(activeSkills) ? activeSkills.slice(0, 12) : [];
    const safeActiveConnectors = Array.isArray(activeConnectors) ? activeConnectors.slice(0, 14) : [];

    const startedAt = Date.now();
    const promptLower = String(prompt || '').toLowerCase();
    const isMutationOrAuditIntent = /\b(cleanse|deduplicate|normalize|delete transaction|remove transaction|add transaction|record expense|log expense|update transaction|mark .* paid|settle invoice|audit invoices|clean my ledger|fix categories)\b/i.test(
      promptLower
    );
    const isArtifactOrAnalysisIntent =
      Boolean(attachment?.data) ||
      /\b(visuali[sz]e|chart|graph|dashboard|csv|excel|spreadsheet|pdf|report|extract|analy[sz]e|bill|invoice|receipt|statement|summary|breakdown)\b/i.test(
        promptLower
      );
    const wantsFunctions = mode === 'agent' || isMutationOrAuditIntent || isArtifactOrAnalysisIntent;
    const wantsWebLookup =
      !attachment?.data &&
      (mode === 'web' ||
        (mode === 'chat' &&
          !isMutationOrAuditIntent &&
          !isArtifactOrAnalysisIntent &&
          /\b(live price|current price|latest news|stock price|share price|nifty|sensex|nasdaq|s&p 500|repo rate|fed rate|rbi rate|cpi inflation|bitcoin price|usd to inr|exchange rate)\b/.test(
            promptLower
          )));

    let systemInstruction =
      'You are Liddy, a specialized AI Chief Financial Officer and agentic financial operations advisor. ' +
      'STRICT SCOPE GUARDRAIL: You must ONLY assist with financial tasks—personal finance, expense ledger analysis, bookkeeping, data cleansing, parsing bill PDFs/receipts/CSVs, generating visual dashboards, CSV exports, PDF reports, invoice audits, tax planning, portfolio valuation, budgeting, financial ratios, cashflow modeling, and live market research. ' +
      'If a user asks for non-financial tasks (such as coding unrelated software, creative fiction, medical advice, general trivia, or non-financial automation), politely decline tool execution and redirect them to how you can help with their finances instead. ' +
      `All monetary figures default to workspace currency "${currencySym}". Be concise, structured, and direct.`;

    if (mode === 'agent' || isMutationOrAuditIntent || isArtifactOrAnalysisIntent) {
      systemInstruction +=
        ' AGENTIC EXECUTION & DELIVERABLES: When the user uploads a bill PDF/image/CSV or asks for visualizations, dashboards, CSV files, or PDF reports, you MUST actively call generate_visual_dashboard (for inline interactive charts), export_csv_dashboard (for structured .csv spreadsheets), and/or export_pdf_report (for downloadable executive .pdf reports) alongside ledger/invoice tools. Extract real figures, dates, tax, and line items accurately from any uploaded bill.';
    } else if (mode === 'web') {
      systemInstruction +=
        ' WEB GROUNDING: Use Google Search grounding for live market quotes, macro rates, earnings, and financial news.';
    } else if (mode === 'ocr') {
      systemInstruction +=
        ' DOCUMENT VISION: Inspect attached receipts, invoices, or statements and extract crisp line items, dates, and totals.';
    }

    if (safeActiveSkills.length > 0) {
      const skillsPromptBlock = safeActiveSkills
        .map((sk: any) => {
          const title = String(sk?.name || sk?.slug || 'Custom Skill').slice(0, 80);
          const body = String(sk?.instructionsMarkdown || '').trim().slice(0, 900);
          return `### Skill: ${title} (${String(sk?.category || 'Finance').slice(0, 40)})\n${body}`;
        })
        .join('\n\n')
        .slice(0, 4500);
      systemInstruction += `\n\n[ACTIVE USER SKILLS (SKILL.md)]\nFollow these installed financial playbooks automatically whenever relevant:\n${skillsPromptBlock}`;
    }

    if (safeActiveConnectors.length > 0) {
      const mcpBlock = safeActiveConnectors
        .map((c: any) => {
          const toolsStr = Array.isArray(c?.toolsList) && c.toolsList.length > 0
            ? `tools=[${c.toolsList.slice(0, 8).join(', ')}]`
            : 'tools=[mcp-ready]';
          return `- ${String(c?.name || c?.slug || 'MCP Connector').slice(0, 80)} (${String(c?.transport || 'http')} · ${toolsStr})`;
        })
        .join('\n')
        .slice(0, 1800);
      systemInstruction += `\n\n[CONNECTED MCP SERVERS]\n${mcpBlock}\nBuilt-in Liddy MCP tools execute live against workspace state; for external remote MCP connectors not directly bridged in the cloud sandbox, note clearly what data was used from the workspace vs what requires remote credentials.`;
    }

    const executeFinancialTool = (name: string, args: any) => {
      activatedToolsSet.add(name);

      if (name === 'activate_financial_skill') {
        const skill = String(args?.skillName || 'cashflow_forensic');
        const playbooks: Record<string, string> = {
          cashflow_forensic:
            'Skill active: Inspect recurring vs discretionary burn, detect category concentration above 35%, reconcile income against outflows, and compute net monthly savings rate.',
          ledger_cleansing:
            'Skill active: Detect duplicate rows sharing date+merchant+amount, strip banking/UPI prefix clutter, standardize generic categories (General/Misc), and remove invalid 0-value rows.',
          tax_optimization:
            'Skill active: Group deductible business/software/health/utilities expenses cleanly, compute invoice GST/tax liability totals, and highlight missing documentation.',
          portfolio_rebalance:
            'Skill active: Evaluate unrealized gain/loss, position weights across holdings, cash buffer adequacy, and diversification alerts.',
          invoice_reconciliation:
            'Skill active: Compare unpaid vs paid receivables, highlight overdue items past dueDate, and reconcile paid bills into ledger income.',
        };
        return {
          status: 'activated',
          skill,
          guidance: playbooks[skill] || playbooks.cashflow_forensic,
        };
      }

      if (name === 'analyze_ledger_and_cashflow') {
        const catFilter = String(args?.categoryFilter || '').trim().toLowerCase();
        const merchFilter = String(args?.merchantFilter || '').trim().toLowerCase();
        const activeRows = workingTx.filter((t) => !pendingDeletesSet.has(t.id));
        const filtered = activeRows.filter((t) => {
          if (catFilter && !String(t.category || '').toLowerCase().includes(catFilter)) return false;
          if (merchFilter && !String(t.merchant || '').toLowerCase().includes(merchFilter)) return false;
          return true;
        });

        let totalOutflow = 0;
        let totalInflow = 0;
        let recurringTotal = 0;
        const categoryTotals: Record<string, { count: number; total: number }> = {};

        const seenSignatures = new Map<string, number>();
        let potentialDuplicates = 0;
        let messyMerchants = 0;
        let genericCategories = 0;
        let invalidAmounts = 0;

        for (const t of filtered) {
          const amt = Number(t.amount) || 0;
          if (amt <= 0) invalidAmounts += 1;
          if (/^(upi|pos|neft|imps|rtgs)[/:*\-\s]/i.test(String(t.merchant || '')) || /\s{2,}/.test(String(t.merchant || ''))) {
            messyMerchants += 1;
          }
          if (!t.category || ['general', 'other', 'misc', 'uncategorized'].includes(String(t.category).toLowerCase())) {
            genericCategories += 1;
          }
          const sig = `${t.date}|${normalizeMerchantLabel(t.merchant).toLowerCase()}|${amt.toFixed(2)}`;
          const count = (seenSignatures.get(sig) || 0) + 1;
          seenSignatures.set(sig, count);
          if (count > 1) potentialDuplicates += 1;

          if (isIncomeLikeTransaction(t)) {
            totalInflow += amt;
          } else {
            totalOutflow += amt;
            if (t.isRecurring) recurringTotal += amt;
            const cat = t.category || 'Uncategorized';
            if (!categoryTotals[cat]) categoryTotals[cat] = { count: 0, total: 0 };
            categoryTotals[cat].count += 1;
            categoryTotals[cat].total += amt;
          }
        }

        return {
          currencySymbol: currencySym,
          totalRecords: filtered.length,
          totalOutflow: Number(totalOutflow.toFixed(2)),
          totalInflow: Number(totalInflow.toFixed(2)),
          netCashflow: Number((totalInflow - totalOutflow).toFixed(2)),
          recurringSpend: Number(recurringTotal.toFixed(2)),
          categoryBreakdown: Object.entries(categoryTotals)
            .map(([category, info]) => ({ category, count: info.count, total: Number(info.total.toFixed(2)) }))
            .sort((a, b) => b.total - a.total),
          dataQualityIssues: {
            potentialDuplicates,
            messyMerchants,
            genericCategories,
            invalidAmounts,
          },
          sampleTransactions: filtered.slice(0, 35).map((t) => ({
            id: t.id,
            date: t.date,
            merchant: t.merchant,
            amount: t.amount,
            category: t.category,
            isRecurring: Boolean(t.isRecurring),
            status: t.status,
          })),
        };
      }

      if (name === 'cleanse_ledger_data') {
        const doDup = args?.removeDuplicates !== false;
        const doMerch = args?.normalizeMerchants !== false;
        const doCat = args?.standardizeCategories !== false;
        const doInvalid = args?.removeInvalidAmounts !== false;

        const seenSignatures = new Set<string>();
        let removedDuplicates = 0;
        let removedInvalid = 0;
        let normalizedMerchantsCount = 0;
        let recategorizedCount = 0;
        const sampleChanges: string[] = [];

        const nextWorking: any[] = [];
        for (const tx of workingTx) {
          if (pendingDeletesSet.has(tx.id)) continue;
          const amt = Number(tx.amount) || 0;

          if (doInvalid && (!Number.isFinite(amt) || amt <= 0)) {
            pendingDeletesSet.add(tx.id);
            removedInvalid += 1;
            if (sampleChanges.length < 8) sampleChanges.push(`Removed invalid entry "${tx.merchant}" (${amt})`);
            continue;
          }

          const cleanMerchant = doMerch ? normalizeMerchantLabel(tx.merchant) : tx.merchant;
          const cleanCategory = doCat ? inferCleanCategory(cleanMerchant, tx.category) : tx.category;
          const sig = `${tx.date}|${cleanMerchant.toLowerCase()}|${amt.toFixed(2)}`;

          if (doDup && seenSignatures.has(sig)) {
            pendingDeletesSet.add(tx.id);
            removedDuplicates += 1;
            if (sampleChanges.length < 8) sampleChanges.push(`Removed duplicate "${cleanMerchant}" (${amt} on ${tx.date})`);
            continue;
          }
          seenSignatures.add(sig);

          const patch: Record<string, any> = {};
          if (doMerch && cleanMerchant !== tx.merchant) {
            patch.merchant = cleanMerchant;
            normalizedMerchantsCount += 1;
          }
          if (doCat && cleanCategory !== tx.category) {
            patch.category = cleanCategory;
            recategorizedCount += 1;
          }

          if (Object.keys(patch).length > 0) {
            const merged = { ...pendingUpdatesMap.get(tx.id), ...patch };
            pendingUpdatesMap.set(tx.id, merged);
            Object.assign(tx, merged);
            if (sampleChanges.length < 8) {
              sampleChanges.push(`Cleaned "${tx.merchant}" -> ${tx.category}`);
            }
          }
          nextWorking.push(tx);
        }

        workingTx = nextWorking;
        return {
          status: 'cleansed',
          removedDuplicates,
          removedInvalid,
          normalizedMerchantsCount,
          recategorizedCount,
          remainingCount: workingTx.length,
          sampleChanges,
        };
      }

      if (name === 'add_or_update_transactions') {
        const additions = Array.isArray(args?.additions) ? args.additions : [];
        const updates = Array.isArray(args?.updates) ? args.updates : [];
        const addedItems: any[] = [];
        const updatedIds: string[] = [];

        for (const item of additions.slice(0, 20)) {
          const cleanMerch = normalizeMerchantLabel(String(item?.merchant || 'Recorded Item'));
          const amt = Math.max(0, Number(item?.amount) || 0);
          if (amt <= 0) continue;
          const newEntry = {
            merchant: cleanMerch,
            amount: amt,
            category: String(item?.category || inferCleanCategory(cleanMerch, '')),
            date: String(item?.date || new Date().toISOString().split('T')[0]).slice(0, 10),
            isRecurring: Boolean(item?.isRecurring),
            paymentMethod: ['UPI', 'CARD', 'CASH', 'SCAN_RECEIPT', 'INVOICE'].includes(String(item?.paymentMethod))
              ? item.paymentMethod
              : 'UPI',
            notes: item?.notes ? String(item.notes).slice(0, 300) : 'Recorded by Liddy Agent',
          };
          pendingAdds.push(newEntry);
          workingTx.unshift({ id: `pending-${pendingAdds.length}`, status: 'completed', ...newEntry });
          addedItems.push(newEntry);
        }

        for (const upd of updates.slice(0, 50)) {
          if (!upd?.id) continue;
          const target = workingTx.find((t) => t.id === upd.id);
          if (!target) continue;
          const patch: Record<string, any> = {};
          if (upd.merchant !== undefined) patch.merchant = String(upd.merchant).slice(0, 160);
          if (upd.amount !== undefined) patch.amount = Math.max(0, Number(upd.amount) || 0);
          if (upd.category !== undefined) patch.category = String(upd.category).slice(0, 80);
          if (upd.date !== undefined) patch.date = String(upd.date).slice(0, 32);
          if (upd.isRecurring !== undefined) patch.isRecurring = Boolean(upd.isRecurring);
          if (upd.notes !== undefined) patch.notes = String(upd.notes).slice(0, 400);
          if (Object.keys(patch).length > 0) {
            pendingUpdatesMap.set(upd.id, { ...pendingUpdatesMap.get(upd.id), ...patch });
            Object.assign(target, patch);
            updatedIds.push(upd.id);
          }
        }

        return {
          status: 'applied',
          addedCount: addedItems.length,
          addedItems,
          updatedCount: updatedIds.length,
          updatedIds,
        };
      }

      if (name === 'delete_transactions') {
        const ids: string[] = Array.isArray(args?.transactionIds) ? args.transactionIds.map(String) : [];
        let deleted = 0;
        for (const id of ids) {
          if (workingTx.some((t) => t.id === id)) {
            pendingDeletesSet.add(id);
            deleted += 1;
          }
        }
        workingTx = workingTx.filter((t) => !pendingDeletesSet.has(t.id));
        return { status: 'deleted', deletedCount: deleted };
      }

      if (name === 'audit_invoices_and_receivables') {
        const markPaidIds: string[] = Array.isArray(args?.markPaidInvoiceIds) ? args.markPaidInvoiceIds.map(String) : [];
        const method = ['UPI', 'CARD', 'CASH', 'INVOICE'].includes(String(args?.paymentMethod))
          ? String(args.paymentMethod)
          : 'UPI';

        let newlySettled = 0;
        for (const invId of markPaidIds) {
          const target = workingInvoices.find((i) => i.id === invId);
          if (target && target.paymentStatus !== 'paid') {
            target.paymentStatus = 'paid';
            pendingInvoicePaid.push({ id: invId, paymentMethod: method });
            newlySettled += 1;
          }
        }

        const paid = workingInvoices.filter((i) => i.paymentStatus === 'paid');
        const unpaid = workingInvoices.filter((i) => i.paymentStatus !== 'paid');
        return {
          currencySymbol: currencySym,
          totalInvoices: workingInvoices.length,
          paidCount: paid.length,
          paidTotal: Number(paid.reduce((s, i) => s + (Number(i.grandTotal) || 0), 0).toFixed(2)),
          unpaidCount: unpaid.length,
          unpaidTotal: Number(unpaid.reduce((s, i) => s + (Number(i.grandTotal) || 0), 0).toFixed(2)),
          taxCollectedOrBilled: Number(workingInvoices.reduce((s, i) => s + (Number(i.taxTotal) || 0), 0).toFixed(2)),
          newlySettledCount: newlySettled,
          invoices: workingInvoices.slice(0, 20).map((i) => ({
            id: i.id,
            invoiceNumber: i.invoiceNumber,
            clientName: i.clientName,
            grandTotal: i.grandTotal,
            paymentStatus: i.paymentStatus,
            dueDate: i.dueDate,
          })),
        };
      }

      if (name === 'analyze_financial_ratios_and_portfolio') {
        const outflow = workingTx
          .filter((t) => !isIncomeLikeTransaction(t))
          .reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const inflow = workingTx
          .filter((t) => isIncomeLikeTransaction(t))
          .reduce((s, t) => s + (Number(t.amount) || 0), 0);
        const paidInvoicesTotal = workingInvoices
          .filter((i) => i.paymentStatus === 'paid')
          .reduce((s, i) => s + (Number(i.grandTotal) || 0), 0);

        const totalRevenue = inflow + paidInvoicesTotal + (Number(args?.monthlyIncomeAssumption) || 0);
        const savingsRatePct = totalRevenue > 0 ? ((totalRevenue - outflow) / totalRevenue) * 100 : 0;

        const portValue = Number(stockPortfolio?.totalValue) || 0;
        const portInvested = Number(stockPortfolio?.totalInvested) || 0;
        const portGain = portValue - portInvested;
        const portGainPct = portInvested > 0 ? (portGain / portInvested) * 100 : 0;

        return {
          currencySymbol: currencySym,
          totalSpend: Number(outflow.toFixed(2)),
          recognizedIncome: Number(totalRevenue.toFixed(2)),
          savingsRatePercent: Number(savingsRatePct.toFixed(2)),
          stockPortfolio: {
            brokerName: stockPortfolio?.brokerName || 'Connected Broker',
            totalValue: portValue,
            totalInvested: portInvested,
            unrealizedGain: Number(portGain.toFixed(2)),
            unrealizedReturnPercent: Number(portGainPct.toFixed(2)),
            holdings: Array.isArray(stockPortfolio?.holdings) ? stockPortfolio.holdings.slice(0, 15) : [],
          },
          watchlistCount: watchlist.length,
          watchlist,
        };
      }

      if (name === 'generate_visual_dashboard') {
        const rawCharts = Array.isArray(args?.charts) ? args.charts : [];
        let created = 0;
        for (const ch of rawCharts.slice(0, 3)) {
          const dataRows = Array.isArray(ch?.data)
            ? ch.data
                .slice(0, 16)
                .map((d: any) => ({
                  label: String(d?.label || d?.name || 'Item').slice(0, 28),
                  value: Math.round((Number(d?.value) || 0) * 100) / 100,
                  ...(d?.secondaryValue !== undefined
                    ? { secondaryValue: Math.round((Number(d.secondaryValue) || 0) * 100) / 100 }
                    : {}),
                }))
                .filter((d: any) => Number.isFinite(d.value))
            : [];
          if (dataRows.length === 0) continue;
          const chartType: 'bar' | 'pie' | 'trend' =
            ch?.chartType === 'pie'
              ? 'pie'
              : ch?.chartType === 'area' || ch?.chartType === 'trend'
              ? 'trend'
              : 'bar';
          collectedCharts.push({
            id: `chart_${Date.now()}_${collectedCharts.length + 1}`,
            title: String(ch?.title || 'Financial Breakdown').slice(0, 90),
            subtitle: ch?.subtitle ? String(ch.subtitle).slice(0, 140) : undefined,
            chartType,
            currencySymbol: ch?.valuePrefix !== undefined ? String(ch.valuePrefix).slice(0, 6) : currencySym,
            data: dataRows,
          });
          created += 1;
        }
        return { status: 'rendered', chartCount: created };
      }

      if (name === 'export_csv_dashboard') {
        const safeHeaders = Array.isArray(args?.headers)
          ? args.headers.map((h: any) => String(h || 'Column').slice(0, 60)).slice(0, 14)
          : ['Item', 'Category', 'Amount'];
        const safeRows = Array.isArray(args?.rows)
          ? args.rows.slice(0, 200).map((r: any) =>
              Array.isArray(r) ? r.slice(0, safeHeaders.length).map((c: any) => String(c ?? '').slice(0, 180)) : [String(r ?? '')]
            )
          : [];
        const escapeCsvCell = (val: string) => {
          const clean = String(val ?? '');
          return /[",\n\r]/.test(clean) ? `"${clean.replace(/"/g, '""')}"` : clean;
        };
        const csvContent = [
          safeHeaders.map(escapeCsvCell).join(','),
          ...safeRows.map((row: string[]) => row.map(escapeCsvCell).join(',')),
        ].join('\n');
        const baseName = String(args?.filename || 'liddy-financial-dashboard.csv')
          .replace(/[^a-zA-Z0-9._-]/g, '-')
          .replace(/(\.csv)?$/i, '.csv');
        collectedCsvExport = {
          filename: baseName,
          title: String(args?.title || 'Financial CSV Dashboard').slice(0, 100),
          headers: safeHeaders,
          rows: safeRows,
          rowCount: safeRows.length,
          csvContent,
        };
        return {
          status: 'generated',
          filename: baseName,
          rowCount: safeRows.length,
          columns: safeHeaders.length,
        };
      }

      if (name === 'export_pdf_report') {
        const baseName = String(args?.filename || 'liddy-financial-report.pdf')
          .replace(/[^a-zA-Z0-9._-]/g, '-')
          .replace(/(\.pdf)?$/i, '.pdf');
        const kpis = Array.isArray(args?.kpis)
          ? args.kpis.slice(0, 6).map((k: any) => ({
              label: String(k?.label || 'Metric').slice(0, 40),
              value: String(k?.value || '0').slice(0, 40),
            }))
          : [];
        const sections: Array<{
          heading: string;
          bullets?: string[];
          table?: { headers: string[]; rows: Array<Array<string | number>> };
        }> = Array.isArray(args?.sections)
          ? args.sections.slice(0, 6).map((s: any) => ({
              heading: String(s?.heading || 'Analysis').slice(0, 80),
              bullets: Array.isArray(s?.bullets)
                ? s.bullets.slice(0, 8).map((b: any) => String(b || '').slice(0, 220))
                : [],
            }))
          : [];
        const table =
          args?.table && Array.isArray(args.table.headers) && Array.isArray(args.table.rows)
            ? {
                headers: args.table.headers.slice(0, 8).map((h: any) => String(h || '').slice(0, 40)),
                rows: args.table.rows.slice(0, 40).map((r: any) =>
                  Array.isArray(r) ? r.slice(0, 8).map((c: any) => String(c ?? '').slice(0, 60)) : []
                ),
              }
            : undefined;
        if (table && table.headers.length > 0 && table.rows.length > 0) {
          sections.push({
            heading: 'Structured Data Breakdown',
            bullets: [],
            table,
          });
        }
        collectedPdfReport = {
          filename: baseName,
          title: String(args?.title || 'Executive Financial Report').slice(0, 100),
          subtitle: args?.subtitle ? String(args.subtitle).slice(0, 140) : undefined,
          generatedAt: new Date().toISOString().split('T')[0],
          currencySymbol: currencySym,
          kpis,
          sections,
        };
        return { status: 'compiled', filename: baseName, kpiCount: kpis.length, sectionCount: sections.length };
      }

      return { error: 'Tool not applicable outside financial workflows.' };
    };

    // Precompute deterministic digest so chat/web responses answer immediately without extra tool round-trips
    const quickLedgerSummary = executeFinancialTool('analyze_ledger_and_cashflow', {});
    const quickRatioSummary = executeFinancialTool('analyze_financial_ratios_and_portfolio', {});
    // Reset activatedToolsSet since precomputation is passive context, not a user-visible tool step
    activatedToolsSet.clear();

    const rawHistory: Array<{ role: 'user' | 'model'; text: string }> = Array.isArray(history)
      ? history
          .filter((h: any) => h && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string' && h.text.trim())
          .slice(-6)
          .map((h: any) => ({ role: h.role as 'user' | 'model', text: String(h.text).trim().slice(0, 1200) }))
      : [];

    while (rawHistory.length > 0 && rawHistory[0].role !== 'user') {
      rawHistory.shift();
    }
    const contents: any[] = [];
    for (const h of rawHistory) {
      const prev = contents[contents.length - 1];
      if (prev && prev.role === h.role) {
        prev.parts[0].text += `\n${h.text}`;
      } else {
        contents.push({ role: h.role, parts: [{ text: h.text }] });
      }
    }

    const digestCats = Array.isArray((quickLedgerSummary as any).categoryBreakdown)
      ? (quickLedgerSummary as any).categoryBreakdown
          .slice(0, 6)
          .map((c: any) => `${c.category}: ${currencySym}${c.total} (${c.count})`)
          .join(', ')
      : 'None';
    const digestRecentTx = Array.isArray((quickLedgerSummary as any).sampleTransactions)
      ? (quickLedgerSummary as any).sampleTransactions
          .slice(0, 8)
          .map((t: any) => `${t.date} | ${t.merchant} | ${currencySym}${t.amount} | ${t.category}`)
          .join('; ')
      : 'None';

    const contextSummaryHeader =
      `[Workspace Financial Digest]\n` +
      `Currency: ${currencySym} | Spend: ${currencySym}${(quickLedgerSummary as any).totalOutflow || 0} | ` +
      `Inflow: ${currencySym}${(quickLedgerSummary as any).totalInflow || 0} | Net: ${currencySym}${(quickLedgerSummary as any).netCashflow || 0} | ` +
      `Recurring: ${currencySym}${(quickLedgerSummary as any).recurringSpend || 0}\n` +
      `Top Categories: ${digestCats || 'None'}\n` +
      `Invoices (${workingInvoices.length}): Unpaid=${workingInvoices.filter((i) => i.paymentStatus !== 'paid').length}, Paid=${workingInvoices.filter((i) => i.paymentStatus === 'paid').length}\n` +
      `Portfolio: Value=${currencySym}${(quickRatioSummary as any).stockPortfolio?.totalValue || 0}, Gain=${currencySym}${(quickRatioSummary as any).stockPortfolio?.unrealizedGain || 0} (${(quickRatioSummary as any).stockPortfolio?.unrealizedReturnPercent || 0}%), Watchlist=[${watchlist.join(', ') || 'None'}]\n` +
      `Recent Tx: ${digestRecentTx || 'None'}\n\n`;

    const userParts: any[] = [];
    if (attachment && attachment.data) {
      const mimeLower = String(attachment.mimeType || '').toLowerCase();
      const nameLower = String(attachment.name || '').toLowerCase();
      const isPlainTextDoc =
        mimeLower.startsWith('text/') ||
        mimeLower.includes('csv') ||
        mimeLower.includes('json') ||
        /\.(csv|txt|tsv|json)$/i.test(nameLower);
      if (isPlainTextDoc) {
        try {
          const decodedText = Buffer.from(String(attachment.data), 'base64').toString('utf8').slice(0, 28000);
          userParts.push({
            text: `[Attached Data File: ${attachment.name || 'document.csv'}]\n${decodedText}\n`,
          });
        } catch {
          userParts.push({
            inlineData: {
              mimeType: 'text/plain',
              data: attachment.data,
            },
          });
        }
      } else {
        userParts.push({
          inlineData: {
            mimeType: attachment.mimeType || 'image/jpeg',
            data: attachment.data,
          },
        });
      }
    }
    userParts.push({
      text: `${contextSummaryHeader}${
        prompt || (attachment ? 'Analyze this uploaded financial document, extract key line items, and prepare charts/CSV/PDF deliverables.' : 'Provide a financial overview of my workspace.')
      }`,
    });

    if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
      contents.push({ role: 'model', parts: [{ text: 'Understood. Continuing financial review.' }] });
    }
    contents.push({ role: 'user', parts: userParts });

    const useWebSearch = Boolean(wantsWebLookup && mode !== 'ocr' && !attachment?.data);

    const callAgentModel = async (
      allowWeb: boolean,
      allowFunctions: boolean,
      thinkingLevel: ThinkingLevel = ThinkingLevel.LOW,
      timeoutMs = 15000,
      modelName = 'gemini-4-hydrogen'
    ) => {
      const activeTools: any[] = [];
      if (allowWeb) activeTools.push({ googleSearch: {} });
      if (allowFunctions) activeTools.push({ functionDeclarations: FINANCIAL_AGENT_TOOLS });

      const effectiveThinking =
        modelName === 'gemini-3.1-flash-lite' ? ThinkingLevel.MINIMAL : thinkingLevel;

      const config: any = {
        systemInstruction,
        thinkingConfig: { thinkingLevel: effectiveThinking },
        abortSignal: AbortSignal.timeout(timeoutMs),
      };
      if (activeTools.length > 0) {
        config.tools = activeTools;
      }
      if (allowWeb && allowFunctions) {
        config.toolConfig = { includeServerSideToolInvocations: true };
      }

      return ai.models.generateContent({
        model: modelName,
        contents,
        config,
      });
    };

    let activeAllowWeb = useWebSearch;
    let activeAllowFunctions = wantsFunctions && !useWebSearch;
    let activeModel =
      Date.now() < hydrogenSlowUntil || Date.now() < hydrogenCooldownUntil
        ? 'gemini-3.1-flash-lite'
        : 'gemini-4-hydrogen';
    const initialThinking = activeAllowFunctions ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW;
    let response: any;
    try {
      response = await callAgentModel(
        activeAllowWeb,
        activeAllowFunctions,
        initialThinking,
        activeModel === 'gemini-4-hydrogen' ? 14000 : 18000,
        activeModel
      );
    } catch (firstErr: any) {
      if ((isQuotaError(firstErr) || isDeadlineOrTimeoutError(firstErr)) && activeModel === 'gemini-4-hydrogen') {
        markHydrogenUnavailable(firstErr);
        activeModel = 'gemini-3.1-flash-lite';
        console.warn('[API /api/gemini/agent] Failing over to gemini-3.1-flash-lite:', firstErr?.message || firstErr);
        try {
          response = await callAgentModel(
            activeAllowWeb,
            activeAllowFunctions,
            ThinkingLevel.MINIMAL,
            18000,
            'gemini-3.1-flash-lite'
          );
        } catch (liteErr: any) {
          if (isQuotaError(liteErr)) throw liteErr;
          activeAllowWeb = false;
          activeAllowFunctions = false;
          response = await callAgentModel(false, false, ThinkingLevel.MINIMAL, 15000, 'gemini-3.1-flash-lite');
        }
      } else if (isQuotaError(firstErr)) {
        throw firstErr;
      } else {
        activeAllowWeb = false;
        activeAllowFunctions = false;
        response = await callAgentModel(false, false, ThinkingLevel.MINIMAL, 15000, 'gemini-3.1-flash-lite');
      }
    }

    // Multi-turn autonomous function-calling execution loop (capped at 4 steps & 28s wall clock)
    let step = 0;
    while (
      activeAllowFunctions &&
      response?.functionCalls &&
      response.functionCalls.length > 0 &&
      step < 4 &&
      Date.now() - startedAt < 28000
    ) {
      step += 1;
      const candidateContent = response.candidates?.[0]?.content;
      if (candidateContent) {
        contents.push(candidateContent);
      }

      const fnResponseParts = response.functionCalls.map((fc: any) => {
        const result = executeFinancialTool(fc.name, fc.args || {});
        return {
          functionResponse: {
            id: fc.id,
            name: fc.name,
            response: { result },
          },
        };
      });

      contents.push({ role: 'user', parts: fnResponseParts });
      try {
        response = await callAgentModel(activeAllowWeb, step < 3, ThinkingLevel.LOW, 14000, activeModel);
      } catch (stepErr: any) {
        if ((isQuotaError(stepErr) || isDeadlineOrTimeoutError(stepErr)) && activeModel === 'gemini-4-hydrogen') {
          markHydrogenUnavailable(stepErr);
          activeModel = 'gemini-3.1-flash-lite';
          try {
            response = await callAgentModel(activeAllowWeb, step < 3, ThinkingLevel.MINIMAL, 15000, 'gemini-3.1-flash-lite');
            continue;
          } catch (liteStepErr: any) {
            if (isQuotaError(liteStepErr)) throw liteStepErr;
            break;
          }
        }
        if (isQuotaError(stepErr)) throw stepErr;
        break;
      }
    }

    const responseText =
      response?.text?.trim() ||
      'I have completed your financial analysis and prepared the requested deliverables.';

    // Deterministic safeguard: if user requested chart/CSV/PDF artifacts in Agent Mode and any wasn't emitted via tool calls, synthesize from markdown table or workspace ledger
    const wantsChartArtifact = /\b(visuali[sz]e|chart|graph|dashboard)\b/i.test(promptLower);
    const wantsCsvArtifact = /\b(csv|spreadsheet|excel|dashboard file)\b/i.test(promptLower);
    const wantsPdfArtifact = /\b(pdf|report)\b/i.test(promptLower);

    if ((mode === 'agent' || isArtifactOrAnalysisIntent) && (wantsChartArtifact || wantsCsvArtifact || wantsPdfArtifact)) {
      // Extract markdown table rows if Gemini produced a table in its response text
      const extractedTable: { headers: string[]; rows: string[][] } | null = (() => {
        const lines = responseText.split('\n').map((l) => l.trim());
        for (let i = 0; i < lines.length - 2; i++) {
          if (lines[i].startsWith('|') && lines[i + 1].startsWith('|') && /^\|[\s:|-]+\|$/.test(lines[i + 1])) {
            const parseRow = (line: string) =>
              line
                .replace(/^\|/, '')
                .replace(/\|$/, '')
                .split('|')
                .map((c) => c.trim());
            const headers = parseRow(lines[i]);
            const rows: string[][] = [];
            for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) {
              const cells = parseRow(lines[j]);
              if (cells.length > 0) rows.push(cells);
            }
            if (headers.length >= 2 && rows.length > 0) {
              return { headers, rows };
            }
          }
        }
        return null;
      })();

      const fallbackCats = Array.isArray((quickLedgerSummary as any).categoryBreakdown)
        ? (quickLedgerSummary as any).categoryBreakdown.slice(0, 8)
        : [];

      if (wantsChartArtifact && collectedCharts.length === 0) {
        if (extractedTable && extractedTable.rows.length > 0) {
          const numColIdx = extractedTable.headers.findIndex((_, idx) =>
            idx > 0 && extractedTable.rows.some((r) => /[\d]/.test(r[idx] || ''))
          );
          if (numColIdx > 0) {
            const chartPoints = extractedTable.rows
              .slice(0, 12)
              .map((r) => {
                const rawNum = Number(String(r[numColIdx] || '').replace(/[^0-9.-]/g, ''));
                return {
                  label: String(r[0] || 'Item').slice(0, 26),
                  value: Number.isFinite(rawNum) ? rawNum : 0,
                };
              })
              .filter((d) => d.value > 0);
            if (chartPoints.length > 0) {
              collectedCharts.push({
                id: `chart_${Date.now()}_${collectedCharts.length + 1}`,
                title: attachment?.name ? `${attachment.name} Breakdown` : 'Extracted Financial Visualization',
                subtitle: 'Generated automatically from structured analysis',
                chartType: 'bar',
                currencySymbol: currencySym,
                data: chartPoints,
              });
              activatedToolsSet.add('generate_visual_dashboard');
            }
          }
        }
        if (collectedCharts.length === 0 && fallbackCats.length > 0) {
          collectedCharts.push({
            id: `chart_${Date.now()}_${collectedCharts.length + 1}`,
            title: 'Spending Allocation by Category',
            subtitle: 'Live workspace ledger visualization',
            chartType: 'bar',
            currencySymbol: currencySym,
            data: fallbackCats.map((c: any) => ({ label: String(c.category || 'Category'), value: Number(c.total) || 0 })),
          });
          activatedToolsSet.add('generate_visual_dashboard');
        }
      }

      if (wantsCsvArtifact && !collectedCsvExport) {
        const csvHeaders = extractedTable?.headers || ['Date', 'Merchant', 'Category', 'Method', 'Amount'];
        const csvRows =
          extractedTable?.rows ||
          workingTx.slice(0, 60).map((t) => [
            String(t.date || ''),
            String(t.merchant || ''),
            String(t.category || 'Other'),
            String(t.paymentMethod || ''),
            String(t.amount || 0),
          ]);
        if (csvRows.length > 0) {
          const escapeCsv = (val: string) =>
            /[",\n\r]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
          const csvContent = [
            csvHeaders.map(escapeCsv).join(','),
            ...csvRows.map((r) => r.map(escapeCsv).join(',')),
          ].join('\n');
          collectedCsvExport = {
            filename: 'liddy-financial-dashboard.csv',
            title: attachment?.name ? `${attachment.name} CSV Dashboard` : 'Liddy Financial CSV Dashboard',
            headers: csvHeaders,
            rows: csvRows,
            rowCount: csvRows.length,
            csvContent,
          };
          activatedToolsSet.add('export_csv_dashboard');
        }
      }

      if (wantsPdfArtifact && !collectedPdfReport) {
        const summaryLines = responseText
          .split('\n')
          .map((l) => l.replace(/^[-*•#]+\s*/, '').trim())
          .filter((l) => l.length > 8 && !l.startsWith('|') && !l.startsWith('```'))
          .slice(0, 6);
        const totalOut = Number((quickLedgerSummary as any).totalOutflow || 0);
        const totalIn = Number((quickLedgerSummary as any).totalInflow || 0);
        const fallbackTable =
          extractedTable ||
          (fallbackCats.length > 0
            ? {
                headers: ['Category', 'Count', 'Total'],
                rows: fallbackCats.map((c: any) => [
                  String(c.category),
                  String(c.count),
                  `${currencySym}${Number(c.total || 0).toLocaleString()}`,
                ]),
              }
            : undefined);
        const pdfSections: Array<{
          heading: string;
          bullets?: string[];
          table?: { headers: string[]; rows: Array<Array<string | number>> };
        }> = [
          {
            heading: 'Key Findings & Executive Summary',
            bullets: summaryLines.length > 0 ? summaryLines : ['Structured analysis completed cleanly.'],
          },
        ];
        if (fallbackTable && fallbackTable.headers.length > 0 && fallbackTable.rows.length > 0) {
          pdfSections.push({
            heading: 'Category & Line-Item Breakdown',
            bullets: [],
            table: fallbackTable,
          });
        }
        collectedPdfReport = {
          filename: 'liddy-executive-report.pdf',
          title: attachment?.name ? `Analysis Report: ${attachment.name}` : 'Liddy Executive Financial Report',
          subtitle: 'Compiled automatically by Liddy AI CFO Agent',
          generatedAt: new Date().toISOString().split('T')[0],
          currencySymbol: currencySym,
          kpis: [
            { label: 'Total Spend', value: `${currencySym}${totalOut.toLocaleString()}` },
            { label: 'Total Inflow', value: `${currencySym}${totalIn.toLocaleString()}` },
            { label: 'Net Cashflow', value: `${currencySym}${(totalIn - totalOut).toLocaleString()}` },
          ],
          sections: pdfSections,
        };
        activatedToolsSet.add('export_pdf_report');
      }
    }

    // Annotate any active user skills whose triggers matched the current prompt
    for (const sk of safeActiveSkills) {
      const trigList = String(sk?.triggers || '')
        .split(',')
        .map((t: string) => t.trim().toLowerCase())
        .filter((t: string) => t.length >= 2);
      if (trigList.some((tr: string) => promptLower.includes(tr))) {
        activatedToolsSet.add(`skill:${String(sk?.slug || sk?.name || 'custom').slice(0, 32)}`);
      }
    }

    const groundingChunks = response?.candidates?.[0]?.groundingMetadata?.groundingChunks;
    const groundingUrls = groundingChunks
      ?.map((c: any) => ({
        title: c.web?.title || 'Financial Source',
        uri: c.web?.uri || '#',
      }))
      .filter((x: any) => x.uri !== '#');

    const updateTransactions = Array.from(pendingUpdatesMap.entries()).map(([id, updates]) => ({
      id,
      updates,
    }));

    const ledgerOperations = {
      ...(pendingAdds.length > 0 ? { addTransactions: pendingAdds } : {}),
      ...(updateTransactions.length > 0 ? { updateTransactions } : {}),
      ...(pendingDeletesSet.size > 0 ? { deleteTransactionIds: Array.from(pendingDeletesSet) } : {}),
      ...(pendingInvoicePaid.length > 0 ? { markInvoicesPaid: pendingInvoicePaid } : {}),
    };

    res.json({
      text: responseText,
      groundingUrls: groundingUrls || [],
      activatedTools: Array.from(activatedToolsSet),
      ledgerOperations,
      charts: collectedCharts,
      csvExport: collectedCsvExport,
      pdfReport: collectedPdfReport,
    });
  } catch (err: any) {
    console.warn('[API /api/gemini/agent] Error:', err?.message || err);
    markQuotaExhausted(err);
    const status = isQuotaError(err) ? 429 : isDeadlineOrTimeoutError(err) ? 504 : 502;
    const message =
      status === 429
        ? 'AI rate limit reached across both primary and fallback models. Please wait a moment and try again.'
        : status === 504
        ? 'The AI response took too long to complete. Please try a shorter prompt or retry in a moment.'
        : FRIENDLY_ERROR;
    res.status(status).json({ error: message });
  }
});

// ==========================================
// 2. RECEIPT & HANDWRITTEN BILL OCR TO DIGITAL INVOICE
// ==========================================
app.post('/api/gemini/receipt', async (req, res) => {
  if (shouldSkipGeminiCall()) {
    return res.status(503).json({ error: 'Receipt OCR service temporarily unavailable. Please try again shortly.' });
  }

  try {
    const { base64Data, mimeType } = req.body || {};
    if (!base64Data) {
      return res.status(400).json({ error: 'Missing receipt or bill image data.' });
    }

    const ai = getAiClient();
    const response = await generateWithHydrogenFailover(ai, {
      contents: {
        parts: [
          { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64Data } },
          {
            text:
              'You are an expert OCR engine for printed receipts and handwritten paper bills. Carefully read every line item, merchant header, address/phone, invoice/bill number, date, currency symbol or code, quantities, unit prices, taxes/GST, subtotal, and grand total. Return clean raw JSON only.',
          },
        ],
      },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            merchant: { type: Type.STRING },
            amount: { type: Type.NUMBER },
            date: { type: Type.STRING },
            category: { type: Type.STRING },
            invoiceNumber: { type: Type.STRING },
            senderDetails: { type: Type.STRING },
            currency: { type: Type.STRING },
            subtotal: { type: Type.NUMBER },
            taxTotal: { type: Type.NUMBER },
            notes: { type: Type.STRING },
            isHandwritten: { type: Type.BOOLEAN },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  description: { type: Type.STRING },
                  quantity: { type: Type.NUMBER },
                  unitPrice: { type: Type.NUMBER },
                  taxPercent: { type: Type.NUMBER },
                  total: { type: Type.NUMBER },
                },
                required: ['description', 'quantity', 'unitPrice', 'total'],
              },
            },
          },
          required: ['merchant', 'amount', 'category'],
        },
      },
    });

    const raw = response.text?.trim() || '';
    if (raw) {
      const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(clean);
      const amountNum = Number(parsed?.amount) || 0;
      const items =
        Array.isArray(parsed?.items) && parsed.items.length > 0
          ? parsed.items.map((it: any) => {
              const qty = Math.max(1, Number(it?.quantity) || 1);
              const total = Number(it?.total) || Number(it?.unitPrice) * qty || 0;
              const unitPrice = Number(it?.unitPrice) || (qty > 0 ? total / qty : total);
              return {
                description: String(it?.description || 'Item').slice(0, 140),
                quantity: qty,
                unitPrice: Math.round(unitPrice * 100) / 100,
                taxPercent: Math.max(0, Number(it?.taxPercent) || 0),
                total: Math.round(total * 100) / 100,
              };
            })
          : [
              {
                description: `${String(parsed?.merchant || 'Scanned Bill').slice(0, 80)} (${String(parsed?.category || 'General')})`,
                quantity: 1,
                unitPrice: amountNum,
                taxPercent: 0,
                total: amountNum,
              },
            ];

      return res.json({
        merchant: String(parsed?.merchant || 'Scanned Merchant').slice(0, 160),
        amount: amountNum,
        date: String(parsed?.date || new Date().toISOString().split('T')[0]).slice(0, 10),
        category: String(parsed?.category || 'Shopping').slice(0, 80),
        invoiceNumber: parsed?.invoiceNumber ? String(parsed.invoiceNumber).slice(0, 64) : undefined,
        senderDetails: parsed?.senderDetails ? String(parsed.senderDetails).slice(0, 300) : undefined,
        currency: parsed?.currency ? String(parsed.currency).slice(0, 8) : undefined,
        subtotal: Number(parsed?.subtotal) || Math.max(0, amountNum - (Number(parsed?.taxTotal) || 0)),
        taxTotal: Math.max(0, Number(parsed?.taxTotal) || 0),
        notes: parsed?.notes ? String(parsed.notes).slice(0, 400) : undefined,
        isHandwritten: Boolean(parsed?.isHandwritten),
        items,
      });
    }
    res.status(422).json({ error: 'Could not extract receipt fields from this image.' });
  } catch (err: any) {
    console.warn('[API /api/gemini/receipt] Error:', err?.message || err);
    markQuotaExhausted(err);
    res.status(isQuotaError(err) ? 429 : 502).json({ error: err?.message || 'Receipt OCR failed.' });
  }
});

// ==========================================
// 3. IMAGE GENERATION (GOALS & CONCEPT VISUALS)
// ==========================================
function buildDeterministicConceptSvg(promptText: string): string {
  const clean = String(promptText || 'Strategic Concept').trim();
  const safeTitle = escapeHtml(clean.slice(0, 74) + (clean.length > 74 ? '...' : ''));
  const lower = clean.toLowerCase();

  let palette = { bg1: '#0F172A', bg2: '#1E293B', accent1: '#38BDF8', accent2: '#818CF8', warm: '#F59E0B' };
  if (lower.includes('café') || lower.includes('cafe') || lower.includes('coffee') || lower.includes('roast') || lower.includes('bakery')) {
    palette = { bg1: '#1C1410', bg2: '#3B2518', accent1: '#F59E0B', accent2: '#FBBF24', warm: '#D97706' };
  } else if (lower.includes('ev') || lower.includes('solar') || lower.includes('green') || lower.includes('sustainability') || lower.includes('nature') || lower.includes('plant')) {
    palette = { bg1: '#052E16', bg2: '#064E3B', accent1: '#34D399', accent2: '#10B981', warm: '#A7F3D0' };
  } else if (lower.includes('studio') || lower.includes('design') || lower.includes('office') || lower.includes('minimal') || lower.includes('architect')) {
    palette = { bg1: '#18181B', bg2: '#27272A', accent1: '#F4F4F5', accent2: '#38BDF8', warm: '#F59E0B' };
  }

  const words = clean
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 4);
  const chipLabels = words.length > 0 ? words : ['Vision', 'Concept', 'Blueprint'];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${palette.bg1}"/>
      <stop offset="100%" stop-color="${palette.bg2}"/>
    </linearGradient>
    <radialGradient id="glow" cx="72%" cy="32%" r="55%">
      <stop offset="0%" stop-color="${palette.accent1}" stop-opacity="0.35"/>
      <stop offset="60%" stop-color="${palette.accent2}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${palette.bg1}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="arch" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#sky)"/>
  <rect width="1280" height="720" fill="url(#glow)"/>
  <g stroke="#FFFFFF" stroke-opacity="0.06" stroke-width="1">
    <line x1="0" y1="540" x2="1280" y2="540"/>
    <line x1="160" y1="0" x2="160" y2="720"/>
    <line x1="640" y1="0" x2="640" y2="720"/>
    <line x1="1120" y1="0" x2="1120" y2="720"/>
  </g>
  <circle cx="940" cy="230" r="140" fill="${palette.accent1}" fill-opacity="0.16" stroke="${palette.accent1}" stroke-opacity="0.45" stroke-width="2"/>
  <circle cx="940" cy="230" r="88" fill="${palette.warm}" fill-opacity="0.18"/>
  <path d="M160 540 L380 280 L560 410 L760 220 L1120 540 Z" fill="url(#arch)" stroke="${palette.accent2}" stroke-opacity="0.4" stroke-width="2"/>
  <rect x="680" y="320" width="380" height="220" rx="18" fill="#0B1120" fill-opacity="0.7" stroke="${palette.accent1}" stroke-opacity="0.45" stroke-width="2"/>
  <polyline points="720,480 790,440 855,455 935,380 1020,355" fill="none" stroke="${palette.accent1}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="935" cy="380" r="8" fill="${palette.warm}"/>
  <circle cx="1020" cy="355" r="9" fill="${palette.accent1}"/>
  <text x="96" y="130" fill="${palette.accent1}" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700" letter-spacing="4">VISION CONCEPT RENDER</text>
  <text x="96" y="185" fill="#FFFFFF" font-family="system-ui, -apple-system, sans-serif" font-size="38" font-weight="800">${safeTitle}</text>
  <g transform="translate(96, 600)">
    ${chipLabels
      .map(
        (w, i) =>
          `<g transform="translate(${i * 195}, 0)"><rect width="175" height="44" rx="10" fill="#FFFFFF" fill-opacity="0.1" stroke="#FFFFFF" stroke-opacity="0.2"/><text x="87" y="28" text-anchor="middle" fill="#F8FAFC" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="600">${escapeHtml(w)}</text></g>`
      )
      .join('')}
  </g>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function extractConceptSearchQueries(prompt: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'by', 'for', 'with', 'that', 'this',
    'from', 'into', 'near', 'beside', 'over', 'under', 'about', 'create', 'generate', 'draw', 'make',
    'show', 'build', 'high', 'resolution', 'photorealistic', 'realistic', 'lighting', 'cinematic',
    'modern', 'ultra', 'style', 'aesthetic', 'concept', 'visual', 'image', 'picture', 'design',
    'render', 'illustration', 'artwork', 'photo', 'scene', 'background', 'detailed', '4k', '8k', 'hd',
  ]);
  const tokens = prompt
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !stopWords.has(w.toLowerCase()));

  const unique: string[] = [];
  for (const t of tokens) {
    if (!unique.some((u) => u.toLowerCase() === t.toLowerCase())) {
      unique.push(t);
    }
  }

  const queries: string[] = [];
  if (unique.length >= 4) queries.push(unique.slice(0, 4).join(' '));
  if (unique.length >= 3) queries.push(unique.slice(0, 3).join(' '));
  if (unique.length >= 2) queries.push(unique.slice(0, 2).join(' '));
  if (unique.length >= 1) queries.push(unique[0]);
  if (queries.length === 0) queries.push(prompt.slice(0, 60));
  return queries;
}

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateIPv6Literal(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (isPrivateIPv4(host)) return true;
  if (isPrivateIPv6Literal(host)) return true;
  return false;
}

async function fetchImageUrlAsDataUrl(targetUrl: string, timeoutMs = 9000): Promise<string | null> {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname) return null;
    if (parsed.username || parsed.password) return null;
    if (isPrivateOrLocalHostname(parsed.hostname)) return null;

    const resp = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'LiddyVisionStudio/1.0' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!resp.ok || !ct.startsWith('image/')) return null;
    if (ct.includes('svg')) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 6000 || buf.length > 6_000_000) return null;
    return `data:${ct.split(';')[0]};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function fetchOpenverseImageDataUrl(prompt: string): Promise<string | null> {
  try {
    const queries = extractConceptSearchQueries(prompt);
    for (const q of queries) {
      const apiUrl = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=8`;
      const resp = await fetch(apiUrl, {
        headers: { 'User-Agent': 'LiddyVisionStudio/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) continue;
      const json: any = await resp.json().catch(() => ({}));
      const results = Array.isArray(json?.results) ? json.results : [];
      if (results.length === 0) continue;

      for (const item of results.slice(0, 5)) {
        const candidates = [item?.url, item?.thumbnail].filter(
          (u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)
        );
        for (const candidate of candidates) {
          if (/icon|logo|flag|diagram|svg/i.test(candidate)) continue;
          const dataUrl = await fetchImageUrlAsDataUrl(candidate, 8000);
          if (dataUrl) return dataUrl;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchWikimediaConceptPhotoDataUrl(prompt: string): Promise<string | null> {
  try {
    const queries = extractConceptSearchQueries(prompt);
    for (const q of queries.slice(0, 2)) {
      // Pass 1: Wikipedia Article PageImages (real topic photos, not PDF/DjVu scans)
      const articleSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
        q
      )}&gsrnamespace=0&gsrlimit=8&prop=pageimages&piprop=original|thumbnail&pithumbsize=1280&format=json&origin=*`;
      const articleResp = await fetch(articleSearchUrl, {
        headers: { 'User-Agent': 'LiddyVisionStudio/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (articleResp.ok) {
        const articleJson: any = await articleResp.json().catch(() => ({}));
        const pages = Object.values(articleJson?.query?.pages || {}) as any[];
        for (const p of pages) {
          const targetUrl = String(p?.thumbnail?.source || p?.original?.source || '');
          if (!targetUrl) continue;
          if (/icon|logo|flag|map|diagram|coat_of_arms|\.svg/i.test(targetUrl)) continue;
          const dataUrl = await fetchImageUrlAsDataUrl(targetUrl, 9000);
          if (dataUrl) return dataUrl;
        }
      }

      // Pass 2: Wikimedia Commons image files
      const fileSearchUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
        q
      )}&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=1280&format=json&origin=*`;
      const fileResp = await fetch(fileSearchUrl, {
        headers: { 'User-Agent': 'LiddyVisionStudio/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (fileResp.ok) {
        const fileJson: any = await fileResp.json().catch(() => ({}));
        const pages = Object.values(fileJson?.query?.pages || {}) as any[];
        for (const p of pages) {
          const info = p?.imageinfo?.[0];
          const mime = String(info?.mime || '').toLowerCase();
          const targetUrl = String(info?.thumburl || info?.url || '');
          if (!targetUrl) continue;
          if (!mime.includes('jpeg') && !mime.includes('jpg') && !mime.includes('png') && !mime.includes('webp')) continue;
          if (/icon|logo|flag|map|diagram|coat_of_arms/i.test(targetUrl)) continue;
          const dataUrl = await fetchImageUrlAsDataUrl(targetUrl, 9000);
          if (dataUrl) return dataUrl;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

type VisualStylePresetServer =
  | 'auto'
  | 'photorealistic'
  | 'cinematic'
  | 'editorial_3d'
  | 'illustration'
  | 'watercolor';

type VisualAspectRatioServer = '16:9' | '1:1' | '4:3' | '9:16';

const STYLE_PRESET_MAP: Record<
  VisualStylePresetServer,
  { label: string; positive: string; negative: string; preferredModels: string[] }
> = {
  auto: {
    label: 'Balanced Studio',
    positive: 'high detail, balanced composition, clean lighting, crisp sharp focus',
    negative: 'blurry, low quality, distorted, watermark, signature, text artifact',
    preferredModels: [
      'Deliberate',
      "ICBINP - I Can't Believe It's Not Photography",
      'Dreamshaper',
      'AbsoluteReality',
      'AlbedoBase XL (SDXL)',
      'stable_diffusion',
    ],
  },
  photorealistic: {
    label: 'Photorealistic',
    positive: 'editorial photography, natural golden lighting, 35mm lens, shallow depth of field, realistic textures, ultra crisp focus',
    negative: 'cartoon, anime, 3d render, painting, blurry, watermark, deformed, plastic skin',
    preferredModels: [
      "ICBINP - I Can't Believe It's Not Photography",
      'AbsoluteReality',
      'Realistic Vision',
      'majicMIX realistic',
      'Deliberate',
      'stable_diffusion',
    ],
  },
  cinematic: {
    label: 'Cinematic',
    positive: 'cinematic film still, atmospheric moody lighting, anamorphic depth, rich color grading, dramatic composition',
    negative: 'flat lighting, snapshot, amateur, blurry, watermark, distorted, low contrast',
    preferredModels: [
      'Dreamshaper',
      'Deliberate',
      'AbsoluteReality',
      'Juggernaut XL',
      'AlbedoBase XL (SDXL)',
      'stable_diffusion',
    ],
  },
  editorial_3d: {
    label: 'Editorial 3D',
    positive: 'tactile 3d architectural render, smooth matte clay and brushed metal materials, soft global illumination, clean studio pedestal',
    negative: 'noisy photograph, messy clutter, sketch, blurry, watermark, text',
    preferredModels: [
      'Dreamshaper',
      'Deliberate',
      'AlbedoBase XL (SDXL)',
      'stable_diffusion',
    ],
  },
  illustration: {
    label: 'Illustration',
    positive: 'modern editorial gouache and ink illustration, expressive crisp linework, harmonious color palette, crafted composition',
    negative: 'photorealistic photograph, grainy noise, blurry, watermark, distorted',
    preferredModels: [
      'Dreamshaper',
      'Deliberate',
      'Anything v5',
      'AlbedoBase XL (SDXL)',
      'stable_diffusion',
    ],
  },
  watercolor: {
    label: 'Watercolor',
    positive: 'fine art watercolor painting on textured cold-press cotton paper, translucent pigment washes, delicate brushwork, luminous highlights',
    negative: '3d cgi render, neon digital photography, harsh plastic, watermark, blurry',
    preferredModels: [
      'Dreamshaper',
      'Deliberate',
      'AlbedoBase XL (SDXL)',
      'stable_diffusion',
    ],
  },
};

const ASPECT_RATIO_DIMS: Record<
  VisualAspectRatioServer,
  { hordeW: number; hordeH: number; safeW: number; safeH: number; hfW: number; hfH: number; geminiRatio: string }
> = {
  '16:9': { hordeW: 704, hordeH: 448, safeW: 640, safeH: 384, hfW: 832, hfH: 448, geminiRatio: '16:9' },
  '1:1': { hordeW: 576, hordeH: 576, safeW: 512, safeH: 512, hfW: 768, hfH: 768, geminiRatio: '1:1' },
  '4:3': { hordeW: 640, hordeH: 448, safeW: 576, safeH: 448, hfW: 768, hfH: 576, geminiRatio: '4:3' },
  '9:16': { hordeW: 448, hordeH: 704, safeW: 384, safeH: 640, hfW: 448, hfH: 832, geminiRatio: '9:16' },
};

function normalizeStylePreset(raw: unknown): VisualStylePresetServer {
  const s = String(raw || 'auto').toLowerCase();
  if (s === 'photorealistic' || s === 'cinematic' || s === 'editorial_3d' || s === 'illustration' || s === 'watercolor') {
    return s;
  }
  return 'auto';
}

function normalizeAspectRatio(raw: unknown): VisualAspectRatioServer {
  const s = String(raw || '16:9');
  if (s === '1:1' || s === '4:3' || s === '9:16') return s;
  return '16:9';
}

function buildStyledPrompt(basePrompt: string, style: VisualStylePresetServer): { styledPrompt: string; negativePrompt: string } {
  const spec = STYLE_PRESET_MAP[style];
  const styledPrompt = style === 'auto' ? basePrompt : `${basePrompt}, ${spec.positive}`;
  return {
    styledPrompt: styledPrompt.slice(0, 950),
    negativePrompt: spec.negative,
  };
}

let cachedHordeModels: { fetchedAt: number; activeNames: Set<string> } = {
  fetchedAt: 0,
  activeNames: new Set(),
};

async function getActiveAiHordeModels(): Promise<Set<string>> {
  if (Date.now() - cachedHordeModels.fetchedAt < 120_000 && cachedHordeModels.activeNames.size > 0) {
    return cachedHordeModels.activeNames;
  }
  try {
    const resp = await fetch('https://aihorde.net/api/v2/status/models?type=image', {
      headers: { 'Client-Agent': 'LiddyVisionStudio:1.0:rupk03793@gmail.com' },
      signal: AbortSignal.timeout(6000),
    });
    if (resp.ok) {
      const list = (await resp.json().catch(() => [])) as any[];
      const set = new Set<string>();
      for (const m of Array.isArray(list) ? list : []) {
        if (Number(m?.count || 0) > 0 && typeof m?.name === 'string') {
          set.add(m.name);
        }
      }
      if (set.size > 0) {
        cachedHordeModels = { fetchedAt: Date.now(), activeNames: set };
      }
    }
  } catch {}
  return cachedHordeModels.activeNames;
}

interface ImageJobResultPayload {
  imageUrl: string;
  format: 'raster' | 'vector-fallback';
  mode: 'ai-raster' | 'ai-vector-fallback' | 'offline-vector-fallback';
  statusMessage: string;
  provider: string;
  model?: string;
}

interface InternalImageJob {
  jobId: string;
  prompt: string;
  style: VisualStylePresetServer;
  aspectRatio: VisualAspectRatioServer;
  status: 'queued' | 'processing' | 'fallback' | 'completed' | 'failed' | 'cancelled';
  provider: string;
  model?: string;
  stageLabel: string;
  queuePosition: number | null;
  waitTimeSec: number | null;
  progressPercent: number;
  createdAtMs: number;
  hordeId?: string;
  cancelled: boolean;
  forceFallback: boolean;
  result?: ImageJobResultPayload;
  error?: string;
}

const runtimeImageJobs = new Map<string, InternalImageJob>();

function serializeImageJob(job: InternalImageJob) {
  return {
    jobId: job.jobId,
    status: job.status,
    provider: job.provider,
    model: job.model,
    stageLabel: job.stageLabel,
    queuePosition: job.queuePosition,
    waitTimeSec: job.waitTimeSec,
    progressPercent: job.progressPercent,
    elapsedSec: Math.max(0, Math.round((Date.now() - job.createdAtMs) / 1000)),
    result: job.result,
    error: job.error,
  };
}

function pruneOldImageJobs() {
  const cutoff = Date.now() - 15 * 60 * 1000;
  runtimeImageJobs.forEach((job, key) => {
    if (job.createdAtMs < cutoff) {
      runtimeImageJobs.delete(key);
    }
  });
  if (runtimeImageJobs.size > 80) {
    const keys = Array.from(runtimeImageJobs.keys());
    for (let i = 0; i < keys.length - 80; i++) {
      runtimeImageJobs.delete(keys[i]);
    }
  }
}

async function generateViaCloudflareFlux(styledPrompt: string, aspectRatio: VisualAspectRatioServer): Promise<ImageJobResultPayload | null> {
  if (!runtimeAiImageConfig.cloudflareEnabled || !runtimeAiImageConfig.cloudflareAccountId || !runtimeAiImageConfig.cloudflareApiToken) {
    return null;
  }
  try {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
      runtimeAiImageConfig.cloudflareAccountId
    )}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtimeAiImageConfig.cloudflareApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `${styledPrompt} (${aspectRatio} composition)`,
        num_steps: 4,
      }),
      signal: AbortSignal.timeout(18000),
    });
    const json: any = await resp.json().catch(() => ({}));
    const b64 = json?.result?.image;
    if (!resp.ok || typeof b64 !== 'string' || b64.length < 1000) {
      const msg = json?.errors?.[0]?.message || `Cloudflare FLUX returned HTTP ${resp.status}`;
      recordFailure('warning', 'AI', 'Cloudflare Workers AI (FLUX.1-schnell)', resp.status || 502, msg);
      return null;
    }
    return {
      imageUrl: `data:image/jpeg;base64,${b64}`,
      format: 'raster',
      mode: 'ai-raster',
      provider: 'Cloudflare Workers AI',
      model: 'FLUX.1-schnell',
      statusMessage: 'Generated in high speed with FLUX.1-schnell.',
    };
  } catch (err: any) {
    recordFailure('warning', 'AI', 'Cloudflare Workers AI (FLUX.1-schnell)', 502, String(err?.message || err));
    return null;
  }
}

async function generateViaHuggingFaceFlux(styledPrompt: string, aspectRatio: VisualAspectRatioServer): Promise<ImageJobResultPayload | null> {
  if (!runtimeAiImageConfig.huggingfaceEnabled || !runtimeAiImageConfig.huggingfaceToken) {
    return null;
  }
  const dims = ASPECT_RATIO_DIMS[aspectRatio];
  try {
    const resp = await fetch('https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${runtimeAiImageConfig.huggingfaceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: styledPrompt,
        parameters: {
          width: dims.hordeW,
          height: dims.hordeH,
          num_inference_steps: 4,
        },
      }),
      signal: AbortSignal.timeout(25000),
    });
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!resp.ok || !ct.startsWith('image/')) {
      const errBody = await resp.text().catch(() => '');
      recordFailure('warning', 'AI', 'Hugging Face FLUX.1-schnell', resp.status || 502, errBody.slice(0, 220) || `HTTP ${resp.status}`);
      return null;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 4000) return null;
    const mime = ct.split(';')[0] || 'image/jpeg';
    return {
      imageUrl: `data:${mime};base64,${buf.toString('base64')}`,
      format: 'raster',
      mode: 'ai-raster',
      provider: 'Hugging Face Inference',
      model: 'FLUX.1-schnell',
      statusMessage: 'Generated with FLUX.1-schnell on Hugging Face.',
    };
  } catch (err: any) {
    recordFailure('warning', 'AI', 'Hugging Face FLUX.1-schnell', 502, String(err?.message || err));
    return null;
  }
}

async function cancelAiHordeJob(hordeId: string | undefined, apiKey: string) {
  if (!hordeId) return;
  try {
    await fetch(`https://aihorde.net/api/v2/generate/status/${encodeURIComponent(hordeId)}`, {
      method: 'DELETE',
      headers: {
        apikey: apiKey,
        'Client-Agent': 'LiddyVisionStudio:1.0:rupk03793@gmail.com',
      },
      signal: AbortSignal.timeout(4000),
    });
  } catch {}
}

async function runFastMatchFallback(rawPrompt: string, style: VisualStylePresetServer, job?: InternalImageJob): Promise<ImageJobResultPayload> {
  if (job) {
    job.status = 'fallback';
    job.provider = 'Openverse & Wikimedia';
    job.stageLabel = 'Matching high-resolution visual references...';
    job.progressPercent = Math.max(job.progressPercent, 76);
  }

  const openverseDataUrl = await fetchOpenverseImageDataUrl(rawPrompt);
  if (openverseDataUrl) {
    return {
      imageUrl: openverseDataUrl,
      format: 'raster',
      mode: 'ai-raster',
      provider: 'Openverse Photography',
      model: STYLE_PRESET_MAP[style].label,
      statusMessage: 'Matched high-resolution photography to your concept.',
    };
  }

  const wikimediaDataUrl = await fetchWikimediaConceptPhotoDataUrl(rawPrompt);
  if (wikimediaDataUrl) {
    return {
      imageUrl: wikimediaDataUrl,
      format: 'raster',
      mode: 'ai-raster',
      provider: 'Wikimedia Commons',
      model: STYLE_PRESET_MAP[style].label,
      statusMessage: 'Matched encyclopedia photography to your concept.',
    };
  }

  if (Boolean(process.env.API_KEY || process.env.GEMINI_API_KEY) && !shouldSkipGeminiCall()) {
    try {
      const ai = getAiClient();
      const svgResp = await generateWithHydrogenFailover(ai, {
        contents: `Create a detailed 1280x720 SVG illustration directly depicting: "${rawPrompt}".
Rules:
- Return ONLY raw valid <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">...</svg> code.
- Use rich linearGradient/radialGradient backgrounds, layered scene elements, depth shadows and recognizable illustrated objects matching the prompt.
- Do NOT wrap in markdown backticks. Do NOT use external image URLs or <script>.`,
      });
      const rawText = String(svgResp.text || '').trim().replace(/^```(?:svg|xml)?\s*/i, '').replace(/```$/i, '').trim();
      const svgMatch = rawText.match(/<svg[\s\S]*<\/svg>/i);
      if (svgMatch && !/<script/i.test(svgMatch[0])) {
        const b64 = Buffer.from(svgMatch[0], 'utf8').toString('base64');
        return {
          imageUrl: `data:image/svg+xml;base64,${b64}`,
          format: 'vector-fallback',
          mode: 'ai-vector-fallback',
          provider: 'Vector Concept Engine',
          statusMessage: 'Rendered custom vector concept illustration.',
        };
      }
    } catch (vecErr: any) {
      markQuotaExhausted(vecErr);
    }
  }

  return {
    imageUrl: buildDeterministicConceptSvg(rawPrompt),
    format: 'vector-fallback',
    mode: 'offline-vector-fallback',
    provider: 'Studio Concept Board',
    statusMessage: 'Free GPU workers were busy so a studio concept card was rendered. Try again in a moment for fresh AI artwork.',
  };
}

async function generateViaAiHorde(
  rawPrompt: string,
  style: VisualStylePresetServer,
  aspectRatio: VisualAspectRatioServer,
  job?: InternalImageJob,
  maxWaitSecOverride?: number
): Promise<ImageJobResultPayload | null> {
  if (!runtimeAiImageConfig.aiHordeEnabled) return null;

  const { styledPrompt, negativePrompt } = buildStyledPrompt(rawPrompt, style);
  const apiKey = runtimeAiImageConfig.aiHordeApiKey || '0000000000';
  const dims = ASPECT_RATIO_DIMS[aspectRatio];
  const styleSpec = STYLE_PRESET_MAP[style];
  const activeModels = await getActiveAiHordeModels();

  let candidateModels = styleSpec.preferredModels.filter((m) => activeModels.size === 0 || activeModels.has(m));
  if (candidateModels.length === 0) {
    candidateModels = ['Deliberate', "ICBINP - I Can't Believe It's Not Photography", 'stable_diffusion'];
  }

  const submitHorde = async (width: number, height: number, steps: number, models: string[]) => {
    const payload = {
      prompt: negativePrompt ? `${styledPrompt} ### ${negativePrompt}` : styledPrompt,
      params: {
        sampler_name: 'k_euler_a',
        cfg_scale: 7,
        width,
        height,
        steps,
        karras: true,
        n: 1,
      },
      models,
      nsfw: false,
      censor_nsfw: true,
      r2: true,
      shared: false,
    };

    const resp = await fetch('https://aihorde.net/api/v2/generate/async', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
        'Client-Agent': 'LiddyVisionStudio:1.0:rupk03793@gmail.com',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    const json: any = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, json };
  };

  if (job) {
    job.provider = 'AI Horde Free GPUs';
    job.model = candidateModels[0];
    job.stageLabel = 'Dispatching prompt to free community GPU workers...';
    job.progressPercent = 18;
  }

  let submission = await submitHorde(dims.hordeW, dims.hordeH, 24, candidateModels);
  if (!submission.ok && (submission.status === 403 || submission.status === 400)) {
    // Automatic anonymous budget step-down so zero-signup requests succeed cleanly
    submission = await submitHorde(dims.safeW, dims.safeH, 20, ['Deliberate', "ICBINP - I Can't Believe It's Not Photography", 'Dreamshaper', 'stable_diffusion']);
  }

  if (!submission.ok || !submission.json?.id) {
    const msg = submission.json?.message || `AI Horde dispatch returned HTTP ${submission.status}`;
    recordFailure('warning', 'AI', 'AI Horde GPU Dispatch', submission.status || 502, msg);
    return null;
  }

  const hordeId = String(submission.json.id);
  if (job) {
    job.hordeId = hordeId;
    job.status = 'queued';
    job.stageLabel = 'Waiting for available AI Horde GPU worker...';
    job.progressPercent = 28;
  }

  const timeoutMs = (maxWaitSecOverride || runtimeAiImageConfig.queueTimeoutSec || 45) * 1000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (job && (job.cancelled || job.forceFallback)) {
      await cancelAiHordeJob(hordeId, apiKey);
      return null;
    }

    await new Promise((r) => setTimeout(r, 2000));

    if (job && (job.cancelled || job.forceFallback)) {
      await cancelAiHordeJob(hordeId, apiKey);
      return null;
    }

    try {
      const checkResp = await fetch(`https://aihorde.net/api/v2/generate/status/${encodeURIComponent(hordeId)}`, {
        headers: { 'Client-Agent': 'LiddyVisionStudio:1.0:rupk03793@gmail.com' },
        signal: AbortSignal.timeout(7000),
      });
      if (!checkResp.ok) continue;
      const checkJson: any = await checkResp.json().catch(() => ({}));

      if (job) {
        const qPos = Number.isFinite(checkJson?.queue_position) ? Number(checkJson.queue_position) : null;
        const waitSec = Number.isFinite(checkJson?.wait_time) ? Number(checkJson.wait_time) : null;
        const processingCount = Number(checkJson?.processing || 0);
        job.queuePosition = qPos;
        job.waitTimeSec = waitSec;
        if (processingCount > 0) {
          job.status = 'processing';
          job.stageLabel = 'Worker GPU is rendering your concept...';
          job.progressPercent = Math.min(88, Math.max(job.progressPercent, 68));
        } else if (qPos !== null && qPos > 0) {
          job.status = 'queued';
          job.stageLabel = `In free GPU queue (#${qPos})${waitSec !== null ? ` · est. ~${waitSec}s` : ''}`;
          job.progressPercent = Math.min(64, Math.max(30, job.progressPercent + 6));
        } else {
          job.status = 'processing';
          job.stageLabel = 'Preparing diffusion artwork on worker GPU...';
          job.progressPercent = Math.min(78, job.progressPercent + 8);
        }
      }

      if (checkJson?.faulted || !checkJson?.is_possible) {
        recordFailure('warning', 'AI', 'AI Horde GPU Worker', 502, checkJson?.faulted ? 'AI Horde generation faulted' : 'No matching worker online');
        await cancelAiHordeJob(hordeId, apiKey);
        return null;
      }

      if (checkJson?.done && Array.isArray(checkJson?.generations) && checkJson.generations.length > 0) {
        const gen = checkJson.generations[0];
        const imgValue = String(gen?.img || '');
        const usedModel = String(gen?.model || candidateModels[0] || 'AI Diffusion');
        if (job) {
          job.model = usedModel;
          job.stageLabel = 'Downloading finished artwork...';
          job.progressPercent = 94;
        }

        if (imgValue.startsWith('http://') || imgValue.startsWith('https://')) {
          const dataUrl = await fetchImageUrlAsDataUrl(imgValue, 12000);
          if (dataUrl) {
            return {
              imageUrl: dataUrl,
              format: 'raster',
              mode: 'ai-raster',
              provider: 'AI Horde Free GPUs',
              model: usedModel,
              statusMessage: `Generated bespoke AI artwork via ${usedModel}.`,
            };
          }
        } else if (imgValue.length > 200) {
          const cleanData = imgValue.startsWith('data:') ? imgValue : `data:image/webp;base64,${imgValue}`;
          return {
            imageUrl: cleanData,
            format: 'raster',
            mode: 'ai-raster',
            provider: 'AI Horde Free GPUs',
            model: usedModel,
            statusMessage: `Generated bespoke AI artwork via ${usedModel}.`,
          };
        }
        return null;
      }
    } catch {}
  }

  // Timed out waiting in free GPU queue
  await cancelAiHordeJob(hordeId, apiKey);
  recordFailure('warning', 'AI', 'AI Horde Queue Timeout', 504, `Queue exceeded ${Math.round(timeoutMs / 1000)}s; switched to fast visual match.`);
  return null;
}

async function executeImagePipeline(job: InternalImageJob) {
  const { styledPrompt } = buildStyledPrompt(job.prompt, job.style);
  const hasGeminiKey = Boolean(process.env.API_KEY || process.env.GEMINI_API_KEY);

  try {
    // Tier 0: Gemini Image Model if a billed key exists and is active
    if (hasGeminiKey && !shouldSkipGeminiCall()) {
      job.provider = 'Gemini Image Engine';
      job.model = 'gemini-3.1-flash-lite-image';
      job.stageLabel = 'Rendering with Gemini Image Engine...';
      job.progressPercent = 35;
      try {
        const ai = getAiClient();
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite-image',
          contents: { parts: [{ text: styledPrompt }] },
          config: { imageConfig: { aspectRatio: ASPECT_RATIO_DIMS[job.aspectRatio].geminiRatio } },
        });
        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData?.data) {
            const mime = part.inlineData.mimeType || 'image/png';
            job.result = {
              imageUrl: `data:${mime};base64,${part.inlineData.data}`,
              format: 'raster',
              mode: 'ai-raster',
              provider: 'Gemini Image Engine',
              model: 'gemini-3.1-flash-lite-image',
              statusMessage: 'Generated with Gemini Image Engine.',
            };
            job.status = 'completed';
            job.progressPercent = 100;
            job.stageLabel = 'Completed';
            return;
          }
        }
      } catch (err: any) {
        markQuotaExhausted(err);
      }
    }

    if (job.cancelled) return;

    // Tier 1A: Optional Free Admin Cloudflare Workers AI (FLUX.1-schnell)
    if (!job.forceFallback && runtimeAiImageConfig.cloudflareEnabled && runtimeAiImageConfig.cloudflareAccountId && runtimeAiImageConfig.cloudflareApiToken) {
      job.provider = 'Cloudflare Workers AI';
      job.model = 'FLUX.1-schnell';
      job.status = 'processing';
      job.stageLabel = 'Generating in high speed via Cloudflare FLUX.1-schnell...';
      job.progressPercent = 45;
      const cfResult = await generateViaCloudflareFlux(styledPrompt, job.aspectRatio);
      if (cfResult) {
        job.result = cfResult;
        job.status = 'completed';
        job.progressPercent = 100;
        job.stageLabel = 'Completed';
        return;
      }
    }

    if (job.cancelled) return;

    // Tier 1B: Optional Free Admin Hugging Face Inference (FLUX.1-schnell)
    if (!job.forceFallback && runtimeAiImageConfig.huggingfaceEnabled && runtimeAiImageConfig.huggingfaceToken) {
      job.provider = 'Hugging Face Inference';
      job.model = 'FLUX.1-schnell';
      job.status = 'processing';
      job.stageLabel = 'Generating artwork via Hugging Face FLUX.1-schnell...';
      job.progressPercent = 50;
      const hfResult = await generateViaHuggingFaceFlux(styledPrompt, job.aspectRatio);
      if (hfResult) {
        job.result = hfResult;
        job.status = 'completed';
        job.progressPercent = 100;
        job.stageLabel = 'Completed';
        return;
      }
    }

    if (job.cancelled) return;

    // Tier 2: Zero-Signup Default AI Horde Free Crowd GPUs
    if (!job.forceFallback && runtimeAiImageConfig.aiHordeEnabled) {
      const hordeResult = await generateViaAiHorde(job.prompt, job.style, job.aspectRatio, job);
      if (job.cancelled) return;
      if (hordeResult) {
        job.result = hordeResult;
        job.status = 'completed';
        job.progressPercent = 100;
        job.stageLabel = 'Completed';
        return;
      }
    }

    if (job.cancelled || (job.status as InternalImageJob['status']) === 'completed') return;

    // Tier 3: Fast High-Res Visual Match & Vector Fallback
    const fallbackResult = await runFastMatchFallback(job.prompt, job.style, job);
    if (job.cancelled || (job.status as InternalImageJob['status']) === 'completed') return;
    job.result = fallbackResult;
    job.status = 'completed';
    job.progressPercent = 100;
    job.stageLabel = 'Completed';
  } catch (err: any) {
    if (job.cancelled || (job.status as InternalImageJob['status']) === 'completed') return;
    const emergencyResult = await runFastMatchFallback(job.prompt, job.style, job);
    if (job.cancelled || (job.status as InternalImageJob['status']) === 'completed') return;
    job.result = emergencyResult;
    job.status = 'completed';
    job.progressPercent = 100;
    job.stageLabel = 'Completed';
    recordFailure('warning', 'AI', 'Image Pipeline Fallback', 502, String(err?.message || err));
  }
}

app.post('/api/gemini/image-jobs', (req, res) => {
  const { prompt, style, aspectRatio } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Please describe the visual you want to create.' });
  }

  pruneOldImageJobs();
  const cleanPrompt = prompt.trim().slice(0, 800);
  const normStyle = normalizeStylePreset(style);
  const normRatio = normalizeAspectRatio(aspectRatio);
  const jobId = `imgjob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  const job: InternalImageJob = {
    jobId,
    prompt: cleanPrompt,
    style: normStyle,
    aspectRatio: normRatio,
    status: 'queued',
    provider: runtimeAiImageConfig.cloudflareEnabled && runtimeAiImageConfig.cloudflareApiToken
      ? 'Cloudflare Workers AI'
      : runtimeAiImageConfig.huggingfaceEnabled && runtimeAiImageConfig.huggingfaceToken
      ? 'Hugging Face Inference'
      : 'AI Horde Free GPUs',
    stageLabel: 'Preparing creative pipeline...',
    queuePosition: null,
    waitTimeSec: null,
    progressPercent: 8,
    createdAtMs: Date.now(),
    cancelled: false,
    forceFallback: false,
  };

  runtimeImageJobs.set(jobId, job);
  void executeImagePipeline(job);
  res.json(serializeImageJob(job));
});

app.get('/api/gemini/image-jobs/:jobId', (req, res) => {
  const job = runtimeImageJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Image render job not found or expired.' });
  }
  res.json(serializeImageJob(job));
});

app.post('/api/gemini/image-jobs/:jobId/fallback', async (req, res) => {
  const job = runtimeImageJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Image render job not found or expired.' });
  }
  if (job.status === 'completed' || job.status === 'cancelled') {
    return res.json(serializeImageJob(job));
  }
  job.forceFallback = true;
  if (job.hordeId) {
    void cancelAiHordeJob(job.hordeId, runtimeAiImageConfig.aiHordeApiKey || '0000000000');
  }
  job.result = await runFastMatchFallback(job.prompt, job.style, job);
  job.status = 'completed';
  job.progressPercent = 100;
  job.stageLabel = 'Completed';
  res.json(serializeImageJob(job));
});

app.delete('/api/gemini/image-jobs/:jobId', (req, res) => {
  const job = runtimeImageJobs.get(req.params.jobId);
  if (job) {
    job.cancelled = true;
    job.status = 'cancelled';
    if (job.hordeId) {
      void cancelAiHordeJob(job.hordeId, runtimeAiImageConfig.aiHordeApiKey || '0000000000');
    }
  }
  res.json({ ok: true });
});

app.post('/api/gemini/generate-image', async (req, res) => {
  const { prompt, style, aspectRatio } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Please describe the visual you want to create.' });
  }

  const cleanPrompt = prompt.trim().slice(0, 800);
  const normStyle = normalizeStylePreset(style);
  const normRatio = normalizeAspectRatio(aspectRatio);
  const { styledPrompt } = buildStyledPrompt(cleanPrompt, normStyle);
  const hasKey = Boolean(process.env.API_KEY || process.env.GEMINI_API_KEY);

  // Tier 1: Gemini 3.1 Image Model (when billed API key & quota available)
  if (hasKey && !shouldSkipGeminiCall()) {
    try {
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-image',
        contents: { parts: [{ text: styledPrompt }] },
        config: { imageConfig: { aspectRatio: ASPECT_RATIO_DIMS[normRatio].geminiRatio } },
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData?.data) {
          const mime = part.inlineData.mimeType || 'image/png';
          return res.json({
            imageUrl: `data:${mime};base64,${part.inlineData.data}`,
            format: 'raster',
            mode: 'ai-raster',
            provider: 'Gemini Image Engine',
            statusMessage: 'Image generated cleanly.',
          });
        }
      }
    } catch (err: any) {
      markQuotaExhausted(err);
      recordFailure('warning', 'AI', 'POST /api/gemini/generate-image (raster)', Number(err?.status || 502), String(err?.message || err));
    }
  }

  // Tier 2A & 2B: Fast Free Admin FLUX Keys
  const cfRes = await generateViaCloudflareFlux(styledPrompt, normRatio);
  if (cfRes) return res.json(cfRes);

  const hfRes = await generateViaHuggingFaceFlux(styledPrompt, normRatio);
  if (hfRes) return res.json(hfRes);

  // Tier 3: AI Horde Free Crowd GPUs (25s synchronous cap before falling back)
  const hordeRes = await generateViaAiHorde(cleanPrompt, normStyle, normRatio, undefined, 25);
  if (hordeRes) return res.json(hordeRes);

  // Tier 4: Openverse / Wikimedia / SVG Fast Fallback
  const fallbackRes = await runFastMatchFallback(cleanPrompt, normStyle);
  return res.json(fallbackRes);
});

// ==========================================
// 3B. FINANCIAL GOAL IMAGE EDITOR (AI PROMPT EDIT)
// ==========================================
app.post('/api/gemini/edit-image', async (req, res) => {
  const { imageDataUrl, instruction, aspectRatio } = req.body || {};
  const cleanInstruction = String(instruction || '').trim().slice(0, 600);
  if (!imageDataUrl || typeof imageDataUrl !== 'string') {
    return res.status(400).json({ error: 'Missing source image to edit.' });
  }
  if (!cleanInstruction) {
    return res.status(400).json({ error: 'Enter an AI edit instruction first.' });
  }

  const normRatio = normalizeAspectRatio(aspectRatio);
  let resolvedDataUrl = imageDataUrl.trim();
  if (resolvedDataUrl.startsWith('http://') || resolvedDataUrl.startsWith('https://')) {
    const converted = await fetchImageUrlAsDataUrl(resolvedDataUrl, 10000);
    if (converted) resolvedDataUrl = converted;
  }

  const dataMatch = resolvedDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  const hasKey = Boolean(process.env.API_KEY || process.env.GEMINI_API_KEY);

  if (dataMatch && !dataMatch[1].includes('svg') && hasKey && !shouldSkipGeminiCall()) {
    try {
      const mimeType = dataMatch[1];
      const base64Data = dataMatch[2];
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-image',
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType } },
            {
              text: `Edit this financial goal visual per the user instruction while maintaining realistic clarity, composition, and aspirational personal wealth quality: ${cleanInstruction}`,
            },
          ],
        },
        config: {
          imageConfig: { aspectRatio: ASPECT_RATIO_DIMS[normRatio].geminiRatio },
        },
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData?.data) {
          const outMime = part.inlineData.mimeType || 'image/png';
          return res.json({
            imageUrl: `data:${outMime};base64,${part.inlineData.data}`,
            format: 'raster',
            mode: 'ai-raster',
            provider: 'Gemini Image Editor',
            statusMessage: 'Edited financial goal visual with AI.',
          });
        }
      }
    } catch (err: any) {
      markQuotaExhausted(err);
      recordFailure('warning', 'AI', 'POST /api/gemini/edit-image', Number(err?.status || 502), String(err?.message || err));
    }
  }

  // Fallback to admin-configured Cloudflare / HF FLUX regeneration when Gemini image key lacks quota
  const fallbackPrompt = `Financial goal milestone scene, ${cleanInstruction}, warm architectural natural light, photorealistic editorial quality`;
  const cfRes = await generateViaCloudflareFlux(fallbackPrompt, normRatio);
  if (cfRes) return res.json(cfRes);

  const hfRes = await generateViaHuggingFaceFlux(fallbackPrompt, normRatio);
  if (hfRes) return res.json(hfRes);

  const hordeRes = await generateViaAiHorde(fallbackPrompt, 'photorealistic', normRatio, undefined, 25);
  if (hordeRes) return res.json(hordeRes);

  return res.status(503).json({
    error: 'AI prompt image editing requires an active Gemini Image quota or FLUX engine. Use Manual Canvas Controls to add goal titles, filters, crop & frames instantly.',
  });
});

// ==========================================
// 4. ENHANCE FINANCIAL VISUAL PROMPT
// ==========================================
const STYLE_ENHANCEMENTS: Record<VisualStylePresetServer, string> = {
  auto: 'framed as an aspirational personal financial goal milestone, bathed in natural balanced lighting with crisp composition',
  photorealistic: 'shot on a 35mm lens capturing a real-world wealth milestone in warm natural golden light with true-to-life detail',
  cinematic: 'framed as an atmospheric wide cinema still symbolizing financial freedom, dramatic rim lighting and rich color grading',
  editorial_3d: 'presented as a minimalist matte architectural 3D studio financial milestone diorama with crisp tactile geometry',
  illustration: 'illustrated in refined editorial gouache portraying a concrete financial savings milestone with curated palette',
  watercolor: 'painted in expressive fine art watercolor washes celebrating a long-term wealth goal on textured cotton paper',
};

app.post('/api/gemini/enhance-prompt', async (req, res) => {
  const rawPrompt = String(req.body?.rawPrompt || '').trim();
  const style = normalizeStylePreset(req.body?.style);
  if (!rawPrompt) {
    return res.status(400).json({ error: 'Missing rawPrompt' });
  }

  if (!shouldSkipGeminiCall()) {
    try {
      const ai = getAiClient();
      const response = await generateWithHydrogenFailover(ai, {
        contents: `Rewrite and enrich this financial goal, wealth milestone, or finance-focused concept into one vivid, specific 1-sentence visual prompt tailored to a "${STYLE_PRESET_MAP[style].label}" aesthetic. Ground the scene in tangible personal finance, wealth, home/retirement, business growth, or savings milestones while preserving the user's core subject: "${rawPrompt}". Return ONLY the improved prompt sentence.`,
        config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      });

      const out = response.text?.trim();
      if (out) return res.json({ text: out });
    } catch (err: any) {
      markQuotaExhausted(err);
    }
  }

  // Clean zero-key offline financial visual enrichment that preserves the user's exact subject
  const cleanSubject = rawPrompt.replace(/[.!?]+$/, '');
  const enriched = `${cleanSubject}, ${STYLE_ENHANCEMENTS[style]}`;
  res.json({ text: enriched });
});

// ==========================================
// 5. AUTONOMOUS FINANCIAL AUTOMATION
// ==========================================
app.post('/api/gemini/automation', async (req, res) => {
  if (shouldSkipGeminiCall()) {
    return res.status(503).json({ error: 'Financial automation engine temporarily unavailable or on quota cooldown.' });
  }

  try {
    const { taskType, financialContext } = req.body;
    const ai = getAiClient();
    const promptMap: Record<string, string> = {
      balance_sheet: "Generate a comprehensive, professional Balance Sheet (Assets, Liabilities, Equity) formatted with clean markdown tables and financial commentary.",
      cash_flow_audit: "Perform an autonomous Cash Flow Audit analyzing operating, investing, and financing cash flows with actionable liquidity recommendations.",
      tax_optimization: "Formulate a strategic Tax Optimization report identifying allowable deductions, retirement account harvesting, and tax-loss opportunities.",
      ratios_analysis: "Calculate key financial ratios (Current Ratio, Debt-to-Equity, Net Margin, Savings Rate) with benchmarks and a strategic health score."
    };

    const taskPrompt = promptMap[taskType] || "Provide an in-depth financial advisory report.";
    const response = await generateWithHydrogenFailover(ai, {
      contents: `${taskPrompt}\nContext: ${financialContext || 'Standard portfolio records'}`,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    res.json({ text: response.text || 'Report compilation completed.' });
  } catch (err: any) {
    markQuotaExhausted(err);
    res.status(isQuotaError(err) ? 429 : 502).json({ error: err?.message || 'Automation request failed.' });
  }
});

// ==========================================
// 6. TEXT-TO-SPEECH (TTS)
// ==========================================
app.post('/api/gemini/tts', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Missing text' });
  }

  if (shouldSkipGeminiCall()) {
    return res.status(200).json({ audioBase64: null });
  }

  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      return res.json({ audioBase64: base64Audio });
    }
    res.status(200).json({ audioBase64: null });
  } catch (err: any) {
    markQuotaExhausted(err);
    res.status(200).json({ audioBase64: null });
  }
});

// ==========================================
// 6B. VOICE MEMO AUDIO-ONLY BRIEFING FALLBACK
// ==========================================
app.post('/api/gemini/voice-memo', async (req, res) => {
  if (shouldSkipGeminiCall()) {
    return res.status(503).json({ error: 'Voice briefing service is temporarily unavailable or on quota cooldown.' });
  }

  try {
    const { audioBase64, mimeType, mode } = req.body;
    if (!audioBase64) {
      return res.status(400).json({ error: 'Missing recorded audio payload.' });
    }

    const ai = getAiClient();
    const modePromptMap: Record<string, string> = {
      brief: 'Focus on crisp personal finance & daily money clarity for everyone: spending habits, savings goals, investments, and smart budgeting.',
      cashflow: 'Focus on household & personal cashflow, bill due dates, monthly spending categories, and practical savings adjustments.',
      market: 'Focus on live equity markets, stock portfolio health, interest rates, and global financial news.',
    };

    const analysis = await generateWithHydrogenFailover(ai, {
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: String(mimeType || 'audio/mp3'),
              data: audioBase64,
            },
          },
          {
            text: `You are Liddy Voice Studio, an executive financial strategist. ${
              modePromptMap[String(mode || 'brief')] || modePromptMap.brief
            } Respond in natural spoken prose (3-4 concise sentences, no markdown, no bullets).`,
          },
        ],
      },
    });

    const spokenReply = analysis.text?.trim() || 'Your cashflow studio is ready. Focus on collecting pending client invoices and setting aside your tax reserve.';

    const ttsResponse = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [{ parts: [{ text: spokenReply }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Zephyr' },
          },
        },
      },
    });

    const replyAudioBase64 = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
    if (!replyAudioBase64) {
      return res.status(502).json({ error: 'Could not synthesize spoken audio response.' });
    }

    // Pure audio-only studio response: no text transcript returned to client
    return res.json({ audioBase64: replyAudioBase64 });
  } catch (err: any) {
    markQuotaExhausted(err);
    return res.status(isQuotaError(err) ? 429 : 502).json({
      error: err?.message || 'Unable to process voice memo audio.',
    });
  }
});

// ==========================================
// 7. LIVE MARKET NEWS WIRE (REAL RSS + GEMINI)
// ==========================================
app.get('/api/gemini/market-news', async (_req, res) => {
  try {
    // Always prioritize fresh real-time RSS feeds first
    const rssNews = await fetchLiveRssNews();
    if (rssNews.length > 0) {
      liveMarketState.news = rssNews;
      lastNewsFetchAt = Date.now();
      return res.json({ news: rssNews });
    }

    // Fallback to Gemini Google Search grounding if RSS unreachable
    if (!shouldSkipGeminiCall()) {
      const ai = getAiClient();
      const currentDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const livePrompt = `Retrieve 6 breaking, factual global financial news stories for today (${currentDate}). Return ONLY raw JSON with key "news": array of objects having title, source, summary, category, timeAgo, url, impact ("HIGH"|"MEDIUM"|"MACRO"), sentiment ("BULLISH"|"BEARISH"|"NEUTRAL").`;

      const response = await generateWithHydrogenFailover(ai, {
        contents: livePrompt,
        config: { tools: [{ googleSearch: {} }] },
      });

      const rawText = response.text?.trim() || '';
      if (rawText) {
        const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(cleanJson);
        if (Array.isArray(parsed.news) && parsed.news.length > 0) {
          liveMarketState.news = parsed.news;
          return res.json({ news: parsed.news });
        }
      }
    }

    res.json({ news: liveMarketState.news });
  } catch (err: any) {
    markQuotaExhausted(err);
    res.json({ news: liveMarketState.news });
  }
});

// ==========================================
// 8. FINANCIAL NEWS SEARCH (LIVE YAHOO NEWS + GEMINI)
// ==========================================
app.post('/api/gemini/search-news', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.json({ news: [] });
  }

  try {
    // Primary live publisher wire search
    const yahooNews = await fetchYahooNewsSearch(String(query));
    if (yahooNews.length > 0) {
      return res.json({ news: yahooNews });
    }

    if (!shouldSkipGeminiCall()) {
      const ai = getAiClient();
      const response = await generateWithHydrogenFailover(ai, {
        contents: `Find 4 latest authentic financial news articles about: "${query}". Return ONLY raw JSON with key 'news' (array of objects with title, source, summary, url, category, timeAgo, sentiment). Do not output markdown code blocks.`,
        config: { tools: [{ googleSearch: {} }] },
      });

      const rawText = response.text?.trim() || '';
      if (rawText) {
        const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(cleanJson);
        if (Array.isArray(parsed.news) && parsed.news.length > 0) {
          return res.json({ news: parsed.news });
        }
      }
    }

    const qLower = String(query).toLowerCase();
    const filtered = liveMarketState.news.filter(n =>
      n.title.toLowerCase().includes(qLower) || n.summary.toLowerCase().includes(qLower)
    );
    res.json({ news: filtered });
  } catch (err: any) {
    markQuotaExhausted(err);
    res.json({ news: [] });
  }
});

// ==========================================
// 9. REAL-TIME COMPANY TICKER LOOKUP
// ==========================================
app.post('/api/gemini/search-ticker', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Missing query' });
  }

  try {
    const resolved = await resolveAndSubscribeTicker(String(query));
    if (resolved) {
      return res.json(resolved);
    }

    if (!shouldSkipGeminiCall()) {
      const ai = getAiClient();
      const response = await generateWithHydrogenFailover(ai, {
        contents: `Look up verified live financial market data for public company or ticker symbol: "${query}".
Return a single JSON object with fields: ticker, name, exchange ("NYSE / NASDAQ" | "NSE / BSE" | "LSE / Euronext" | "TSE / HKEX"), sector, marketCap, price, change, isPositive (boolean), volume, peRatio, week52High, week52Low, headquarters, ceo, description, investorUrl, dividendYield.
Only return raw JSON without markdown code blocks.`,
        config: { tools: [{ googleSearch: {} }] },
      });

      const rawText = response.text?.trim() || '';
      if (rawText) {
        const cleanJson = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(cleanJson);
        if (parsed && parsed.ticker && parsed.name) {
          return res.json({
            ticker: String(parsed.ticker).toUpperCase(),
            name: parsed.name,
            exchange: parsed.exchange || 'NYSE / NASDAQ',
            sector: parsed.sector || 'Equities',
            marketCap: parsed.marketCap || '—',
            price: parsed.price || '—',
            change: parsed.change || '0.00%',
            isPositive: typeof parsed.isPositive === 'boolean' ? parsed.isPositive : !String(parsed.change).startsWith('-'),
            volume: parsed.volume || '—',
            peRatio: parsed.peRatio || '—',
            week52High: parsed.week52High || '—',
            week52Low: parsed.week52Low || '—',
            headquarters: parsed.headquarters || '',
            ceo: parsed.ceo || '',
            description: parsed.description || '',
            investorUrl: parsed.investorUrl || `https://www.google.com/finance/quote/${parsed.ticker}`,
            dividendYield: parsed.dividendYield || '—',
          });
        }
      }
    }

    res.json(null);
  } catch (err: any) {
    markQuotaExhausted(err);
    res.json(null);
  }
});

// ==========================================
// 10. DIGITAL INVOICE GENERATION
// ==========================================
app.post('/api/gemini/generate-invoice', async (req, res) => {
  if (shouldSkipGeminiCall()) {
    return res.status(503).json({ error: 'Invoice AI drafting service temporarily unavailable or on quota cooldown.' });
  }

  try {
    const { prompt, preferredIndustry } = req.body;
    const ai = getAiClient();
    const today = new Date().toISOString().split('T')[0];
    const systemPrompt = `You are an expert digital accountant and billing architect.
Convert the user's natural language request into a clean, complete, structured invoice object.
Default date is today (${today}). Auto-generate a professional invoiceNumber (e.g., INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}).
Determine or respect the industry: 'RETAIL' | 'TECH' | 'DINING' | 'HEALTHCARE' | 'SERVICES'.
Preferred industry if provided: ${preferredIndustry || 'SERVICES'}.
For items, accurately calculate total = (quantity * unitPrice) * (1 - (discountPercent || 0)/100) * (1 + (taxPercent || 0)/100).
Also calculate grand totals: subtotal, taxTotal, discountTotal, grandTotal.
Return ONLY clean JSON without markdown code fences.`;

    const response = await generateWithHydrogenFailover(ai, {
      contents: [
        { text: systemPrompt },
        { text: `User request to generate bill/invoice:\n"${prompt}"` }
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            invoiceNumber: { type: Type.STRING },
            date: { type: Type.STRING },
            dueDate: { type: Type.STRING },
            senderName: { type: Type.STRING },
            senderDetails: { type: Type.STRING },
            clientName: { type: Type.STRING },
            clientDetails: { type: Type.STRING },
            industry: { type: Type.STRING },
            currency: { type: Type.STRING },
            notes: { type: Type.STRING },
            upiId: { type: Type.STRING },
            payeeName: { type: Type.STRING },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  description: { type: Type.STRING },
                  quantity: { type: Type.NUMBER },
                  unitPrice: { type: Type.NUMBER },
                  discountPercent: { type: Type.NUMBER },
                  taxPercent: { type: Type.NUMBER },
                  total: { type: Type.NUMBER }
                },
                required: ['description', 'quantity', 'unitPrice', 'total']
              }
            },
            subtotal: { type: Type.NUMBER },
            taxTotal: { type: Type.NUMBER },
            discountTotal: { type: Type.NUMBER },
            grandTotal: { type: Type.NUMBER }
          },
          required: ['invoiceNumber', 'clientName', 'items', 'subtotal', 'grandTotal']
        }
      }
    });

    const raw = response.text?.trim() || '';
    if (raw) {
      const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      return res.json(JSON.parse(clean));
    }
    res.json(null);
  } catch (err: any) {
    markQuotaExhausted(err);
    res.status(isQuotaError(err) ? 429 : 502).json({ error: err?.message || 'Invoice AI generation failed.' });
  }
});

// ==========================================
// 11. INVOICE AI AUDITING & POLISHING
// ==========================================
app.post('/api/gemini/perfect-invoice', async (req, res) => {
  if (shouldSkipGeminiCall()) {
    return res.status(503).json({ error: 'Invoice auditing service temporarily unavailable or on quota cooldown.' });
  }

  try {
    const { currentInvoice, instructions } = req.body;
    const ai = getAiClient();
    const systemPrompt = `You are a financial auditor and design specialist for digital bills.
Analyze the provided draft invoice, fix any grammar, enrich item descriptions to look professional and transparent, verify taxes and math, adjust tone to the specific industry (${currentInvoice?.industry || 'SERVICES'}), and provide polished notes and terms.
Additional user instruction: ${instructions || 'Polish line items, ensure proper categorization, and make the billing terms crisp and clear.'}
Return the updated invoice object as raw JSON.`;

    const response = await generateWithHydrogenFailover(ai, {
      contents: [
        { text: systemPrompt },
        { text: `Current Invoice JSON:\n${JSON.stringify(currentInvoice, null, 2)}` }
      ],
      config: {
        responseMimeType: 'application/json'
      }
    });

    const raw = response.text?.trim() || '';
    if (raw) {
      const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      return res.json(JSON.parse(clean));
    }
    res.json(null);
  } catch (err: any) {
    markQuotaExhausted(err);
    res.status(isQuotaError(err) ? 429 : 502).json({ error: err?.message || 'Invoice polishing failed.' });
  }
});

// ==========================================
// 12. WEBSOCKET SERVER FOR GEMINI LIVE API & MARKET STREAM
// ==========================================
const wss = new WebSocketServer({ noServer: true });
const marketWss = new WebSocketServer({ noServer: true });

wss.on('connection', async (clientWs: WebSocket, req?: http.IncomingMessage) => {
  let liveSession: any = null;
  let isClosed = false;

  const modeParam = (() => {
    try {
      const url = new URL(req?.url || '/api/live', 'http://localhost');
      return url.searchParams.get('mode') || 'brief';
    } catch {
      return 'brief';
    }
  })();

  if (shouldSkipGeminiCall()) {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'error', error: 'Live voice service is temporarily unavailable or on quota cooldown.' }));
      clientWs.close();
    }
    return;
  }

  try {
    const ai = getAiClient();
    const modePromptMap: Record<string, string> = {
      brief:
        'Focus on clear daily money guidance for everyone: everyday expense awareness, stock portfolio check-ins, bills, and practical next steps.',
      cashflow:
        'Focus on monthly spending audits, bill & invoice management, emergency reserve planning, and net savings clarity.',
      market:
        'Focus on real-time global equity indices, stock market moves, interest rates, currency shifts, and macroeconomic updates.',
    };

    const systemPrompt = `You are Liddy Voice Assistant, a helpful and sharp financial guide for everyday people, investors, and teams.
Respond strictly in natural, warm, concise spoken audio without filler or robotic disclaimers.
${modePromptMap[modeParam] || modePromptMap.brief}
If the user says goodbye or asks to end the session, reply warmly with a short sign-off.`;

    const sessionPromise = ai.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
        },
        systemInstruction: systemPrompt,
      },
      callbacks: {
        onopen: () => {
          if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'open' }));
          }
        },
        onmessage: (message: LiveServerMessage) => {
          if (isClosed || clientWs.readyState !== WebSocket.OPEN) return;

          // Pure audio-only studio stream: no speech transcripts emitted to the client
          const parts = message.serverContent?.modelTurn?.parts || [];
          for (const part of parts) {
            if (part?.inlineData?.data) {
              clientWs.send(JSON.stringify({ type: 'audio', audio: part.inlineData.data }));
            }
          }

          if (message.serverContent?.interrupted) {
            clientWs.send(JSON.stringify({ type: 'interrupted', interrupted: true }));
          }
        },
        onclose: () => {
          if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'close' }));
          }
        },
        onerror: (err: any) => {
          markQuotaExhausted(err);
          if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ type: 'error', error: err?.message || 'Live voice stream encountered an upstream error.' }));
          }
        }
      }
    });

    liveSession = await sessionPromise;

    clientWs.on('message', (data: any) => {
      if (!liveSession || isClosed) return;
      try {
        const payload = JSON.parse(data.toString());
        if (payload.audio) {
          liveSession.sendRealtimeInput({
            audio: {
              data: payload.audio,
              mimeType: 'audio/pcm;rate=16000'
            }
          });
        } else if (payload.text) {
          liveSession.sendClientContent({
            turns: [
              {
                role: 'user',
                parts: [{ text: payload.text }]
              }
            ],
            turnComplete: true
          });
        }
      } catch {
        // Ignore malformed client input
      }
    });

    clientWs.on('close', () => {
      isClosed = true;
      if (liveSession && typeof liveSession.close === 'function') {
        try {
          liveSession.close();
        } catch {}
      }
    });

    clientWs.on('error', () => {
      isClosed = true;
      if (liveSession && typeof liveSession.close === 'function') {
        try {
          liveSession.close();
        } catch {}
      }
    });

  } catch (err: any) {
    markQuotaExhausted(err);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'error', error: err?.message || 'Failed to establish live voice session.' }));
      clientWs.close();
    }
  }
});

// Real-Time Market Telemetry WebSocket Server (/api/market-stream)
let marketPollTimer: NodeJS.Timeout | null = null;

function ensureMarketStreamLoop() {
  if (marketPollTimer) return;
  marketPollTimer = setInterval(async () => {
    if (marketWss.clients.size === 0) {
      if (marketPollTimer) {
        clearInterval(marketPollTimer);
        marketPollTimer = null;
      }
      return;
    }

    try {
      const state = await refreshLiveMarketState(true);
      const payload = JSON.stringify({ type: 'tick', ...state });
      marketWss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(payload);
          } catch {}
        }
      });
    } catch {
      // Keep broadcast loop resilient
    }
  }, 4500);
}

marketWss.on('connection', async (clientWs: WebSocket) => {
  ensureMarketStreamLoop();

  try {
    // Send immediate cached state first if fresh, or fetch live right away
    const state = await refreshLiveMarketState(Date.now() - lastQuotesFetchAt > 6000);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'snapshot', ...state }));
    }
  } catch {}

  clientWs.on('message', async (raw: any) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'subscribe' && Array.isArray(msg.tickers)) {
        const missing = msg.tickers
          .map((t: any) => String(t).toUpperCase().trim())
          .filter((t: string) => t && !liveMarketState.listedCompanies.some(c => c.ticker === t));
        for (const sym of missing.slice(0, 6)) {
          await resolveAndSubscribeTicker(sym);
        }
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: 'snapshot', ...liveMarketState }));
        }
      }
    } catch {
      // Ignore invalid payloads
    }
  });
});

// Server-Authoritative Collaborative Vision & WebRTC Video Studio Server (/api/collab-room)
interface ServerCollabParticipant {
  clientId: string;
  name: string;
  role: string;
  color: string;
  joinedAt: string;
  guestKey: string;
  userId?: string;
  email?: string;
  isHost: boolean;
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  handRaised: boolean;
  ws: WebSocket;
}

interface ServerCollabWaitingPeer {
  clientId: string;
  name: string;
  role: string;
  color: string;
  guestKey: string;
  userId?: string;
  email?: string;
  requestedAt: string;
  ws: WebSocket;
}

interface ServerCollabDeniedEntry {
  guestKey: string;
  name: string;
  deniedAt: string;
}

interface ServerCollabRoomState {
  roomCode: string;
  hostClientId: string | null;
  hostKey: string | null;
  nodes: any[];
  slides: any[];
  meetingNotes: any[];
  chatMessages: any[];
  participants: Map<string, ServerCollabParticipant>;
  waitingPeers: Map<string, ServerCollabWaitingPeer>;
  deniedKeys: Map<string, ServerCollabDeniedEntry>;
}

const collabWss = new WebSocketServer({ noServer: true });
const activeCollabRooms = new Map<string, ServerCollabRoomState>();

function broadcastToRoom(room: ServerCollabRoomState, messageObj: any, excludeClientId?: string) {
  const encoded = JSON.stringify(messageObj);
  room.participants.forEach((p) => {
    if (excludeClientId && p.clientId === excludeClientId) return;
    if (p.ws.readyState === WebSocket.OPEN) {
      try {
        p.ws.send(encoded);
      } catch {}
    }
  });
}

function sendToHost(room: ServerCollabRoomState, messageObj: any) {
  if (!room.hostClientId) return;
  const host = room.participants.get(room.hostClientId);
  if (host && host.ws.readyState === WebSocket.OPEN) {
    try {
      host.ws.send(JSON.stringify(messageObj));
    } catch {}
  }
}

function serializePresence(room: ServerCollabRoomState) {
  return Array.from(room.participants.values()).map(({ clientId, name, role, color, joinedAt, isHost, micOn, camOn, screenOn, handRaised }) => ({
    clientId,
    peerId: clientId,
    name,
    role,
    color,
    joinedAt,
    isHost,
    micOn,
    camOn,
    screenOn,
    handRaised,
  }));
}

function serializeWaitingPeers(room: ServerCollabRoomState) {
  return Array.from(room.waitingPeers.values()).map(({ clientId, name, role, requestedAt }) => ({
    clientId,
    name,
    role,
    requestedAt,
  }));
}

function serializeDeniedList(room: ServerCollabRoomState) {
  return Array.from(room.deniedKeys.values());
}

function terminateBlockedUserInRooms(userId?: string, email?: string, mode: 'blocked' | 'revoked' = 'blocked') {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const payload = JSON.stringify({
    type: mode === 'blocked' ? 'account_blocked' : 'account_revoked',
    message:
      mode === 'blocked'
        ? 'Your account has been blocked by the platform administrator.'
        : 'Your active session was revoked by the platform administrator.',
  });

  activeCollabRooms.forEach((room) => {
    room.participants.forEach((p, cid) => {
      const matchesUid = Boolean(userId && p.userId === userId);
      const matchesEmail = Boolean(cleanEmail && p.email?.toLowerCase() === cleanEmail);
      if (matchesUid || matchesEmail) {
        try {
          if (p.ws.readyState === WebSocket.OPEN) {
            p.ws.send(payload);
            p.ws.close(1008, mode === 'blocked' ? 'Account blocked' : 'Session revoked');
          }
        } catch {}
        room.participants.delete(cid);
        if (room.hostClientId === cid) {
          room.hostClientId = null;
        }
        broadcastToRoom(room, { type: 'peer_left', peerId: cid });
        broadcastToRoom(room, { type: 'presence', participants: serializePresence(room) });
      }
    });

    room.waitingPeers.forEach((w, cid) => {
      const matchesUid = Boolean(userId && w.userId === userId);
      const matchesEmail = Boolean(cleanEmail && w.email?.toLowerCase() === cleanEmail);
      if (matchesUid || matchesEmail) {
        try {
          if (w.ws.readyState === WebSocket.OPEN) {
            w.ws.send(payload);
            w.ws.close(1008, mode === 'blocked' ? 'Account blocked' : 'Session revoked');
          }
        } catch {}
        room.waitingPeers.delete(cid);
        sendToHost(room, { type: 'waiting_requests', waitingRequests: serializeWaitingPeers(room) });
      }
    });
  });
}

function promoteParticipant(
  room: ServerCollabRoomState,
  peer: ServerCollabParticipant
) {
  room.participants.set(peer.clientId, peer);
  if (peer.ws.readyState === WebSocket.OPEN) {
    peer.ws.send(
      JSON.stringify({
        type: 'room_state',
        clientId: peer.clientId,
        peerId: peer.clientId,
        isHost: peer.isHost,
        roomCode: room.roomCode,
        nodes: room.nodes,
        slides: room.slides,
        meetingNotes: room.meetingNotes,
        chatMessages: room.chatMessages,
        participants: serializePresence(room),
        waitingRequests: peer.isHost ? serializeWaitingPeers(room) : [],
        deniedList: peer.isHost ? serializeDeniedList(room) : [],
      })
    );
  }
  broadcastToRoom(room, {
    type: 'presence',
    participants: serializePresence(room),
  });
}

collabWss.on('connection', (clientWs: WebSocket, req?: http.IncomingMessage) => {
  const url = new URL(req?.url || '/api/collab-room', 'http://localhost');
  const roomCode = (url.searchParams.get('room') || 'TEAM-101').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32) || 'TEAM-101';
  const name = (url.searchParams.get('name') || 'Participant').trim().slice(0, 40) || 'Participant';
  const role = (url.searchParams.get('role') || 'Member').trim().slice(0, 32) || 'Member';
  const requestedMode = (url.searchParams.get('mode') || 'knock').toLowerCase();
  const rawGuestKey = (url.searchParams.get('guestKey') || '').trim().slice(0, 80);
  const userId = (url.searchParams.get('uid') || '').trim().slice(0, 128) || undefined;
  const email = (url.searchParams.get('email') || '').trim().toLowerCase().slice(0, 254) || undefined;

  const accessRec = findUserAccessRecord(userId, email);
  if (accessRec?.status === 'blocked' && email !== PLATFORM_OWNER_EMAIL) {
    try {
      clientWs.send(
        JSON.stringify({
          type: 'account_blocked',
          message: 'Your account has been blocked from using Liddy by an administrator.',
        })
      );
      clientWs.close(1008, 'Account blocked');
    } catch {}
    return;
  }

  const clientId = `peer_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const guestKey = userId ? `uid:${userId}` : rawGuestKey ? `guest:${rawGuestKey}` : `sess:${clientId}`;
  const palette = ['#4F46E5', '#10B981', '#0284C7', '#D97706', '#E11D48', '#7C3AED'];
  const color = palette[Math.floor(Math.random() * palette.length)];

  let room = activeCollabRooms.get(roomCode);
  if (!room) {
    room = {
      roomCode,
      hostClientId: null,
      hostKey: null,
      nodes: [],
      slides: [],
      meetingNotes: [],
      chatMessages: [],
      participants: new Map(),
      waitingPeers: new Map(),
      deniedKeys: new Map(),
    };
    activeCollabRooms.set(roomCode, room);
  }

  // Enforce room-level deny/removal blocklist across reconnects
  const altGuestKey = rawGuestKey ? `guest:${rawGuestKey}` : '';
  const isDenied = room.deniedKeys.has(guestKey) || (altGuestKey && room.deniedKeys.has(altGuestKey));
  if (isDenied && room.hostKey !== guestKey) {
    try {
      clientWs.send(
        JSON.stringify({
          type: 'join_denied',
          roomCode,
          message: 'The host denied or removed your access to this room. You cannot re-enter unless admitted by the host.',
        })
      );
      clientWs.close(1008, 'Denied by host');
    } catch {}
    return;
  }

  const canClaimHost =
    (requestedMode === 'host' && (!room.hostClientId || room.hostKey === guestKey)) ||
    (room.hostKey === guestKey && !room.hostClientId);

  if (canClaimHost) {
    room.hostClientId = clientId;
    room.hostKey = guestKey;
    promoteParticipant(room, {
      clientId,
      name,
      role: role || 'Host',
      color,
      joinedAt: new Date().toISOString(),
      guestKey,
      userId,
      email,
      isHost: true,
      micOn: false,
      camOn: false,
      screenOn: false,
      handRaised: false,
      ws: clientWs,
    });
  } else {
    // Enter waiting room and knock for host approval
    room.waitingPeers.set(clientId, {
      clientId,
      name,
      role,
      color,
      guestKey,
      userId,
      email,
      requestedAt: new Date().toISOString(),
      ws: clientWs,
    });

    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({
          type: 'waiting_approval',
          clientId,
          roomCode,
          hostPresent: Boolean(room.hostClientId),
          message: room.hostClientId
            ? 'Asking the host for permission to join...'
            : 'Waiting for the host to open this room and admit you...',
        })
      );
    }

    sendToHost(room, {
      type: 'waiting_requests',
      waitingRequests: serializeWaitingPeers(room),
    });
  }

  clientWs.on('message', (raw: any) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (!room) return;

      // Host-only admission and moderation commands
      if (clientId === room.hostClientId && room.participants.has(clientId)) {
        if (msg.type === 'host_admit' && msg.targetClientId) {
          const targetId = String(msg.targetClientId);
          const waiting = room.waitingPeers.get(targetId);
          if (waiting) {
            room.waitingPeers.delete(targetId);
            room.deniedKeys.delete(waiting.guestKey);
            if (waiting.ws.readyState === WebSocket.OPEN) {
              waiting.ws.send(JSON.stringify({ type: 'admitted', roomCode }));
            }
            promoteParticipant(room, {
              clientId: waiting.clientId,
              name: waiting.name,
              role: waiting.role,
              color: waiting.color,
              joinedAt: new Date().toISOString(),
              guestKey: waiting.guestKey,
              userId: waiting.userId,
              email: waiting.email,
              isHost: false,
              micOn: false,
              camOn: false,
              screenOn: false,
              handRaised: false,
              ws: waiting.ws,
            });
            sendToHost(room, {
              type: 'waiting_requests',
              waitingRequests: serializeWaitingPeers(room),
            });
          }
          return;
        }

        if (msg.type === 'host_deny' && msg.targetClientId) {
          const targetId = String(msg.targetClientId);
          const waiting = room.waitingPeers.get(targetId);
          if (waiting) {
            room.waitingPeers.delete(targetId);
            const deniedAt = new Date().toISOString();
            room.deniedKeys.set(waiting.guestKey, {
              guestKey: waiting.guestKey,
              name: waiting.name,
              deniedAt,
            });
            if (waiting.ws.readyState === WebSocket.OPEN) {
              try {
                waiting.ws.send(
                  JSON.stringify({
                    type: 'join_denied',
                    roomCode,
                    message: 'The host declined your request to join this meeting.',
                  })
                );
                waiting.ws.close(1008, 'Denied by host');
              } catch {}
            }
            sendToHost(room, {
              type: 'waiting_requests',
              waitingRequests: serializeWaitingPeers(room),
            });
            sendToHost(room, {
              type: 'denied_list',
              deniedList: serializeDeniedList(room),
            });
          }
          return;
        }

        if (msg.type === 'host_remove_participant' && msg.targetClientId) {
          const targetId = String(msg.targetClientId);
          if (targetId === clientId) return;
          const target = room.participants.get(targetId);
          if (target) {
            room.participants.delete(targetId);
            room.deniedKeys.set(target.guestKey, {
              guestKey: target.guestKey,
              name: target.name,
              deniedAt: new Date().toISOString(),
            });
            if (target.ws.readyState === WebSocket.OPEN) {
              try {
                target.ws.send(
                  JSON.stringify({
                    type: 'removed_from_room',
                    roomCode,
                    message: 'You were removed from this meeting by the host.',
                  })
                );
                target.ws.close(1008, 'Removed by host');
              } catch {}
            }
            broadcastToRoom(room, { type: 'peer_left', peerId: targetId });
            broadcastToRoom(room, { type: 'presence', participants: serializePresence(room) });
            sendToHost(room, {
              type: 'denied_list',
              deniedList: serializeDeniedList(room),
            });
          }
          return;
        }

        if (msg.type === 'host_unblock_denied' && msg.guestKey) {
          room.deniedKeys.delete(String(msg.guestKey));
          sendToHost(room, {
            type: 'denied_list',
            deniedList: serializeDeniedList(room),
          });
          return;
        }
      }

      // Only admitted participants can send room state, chat, reactions, or WebRTC signals
      if (!room.participants.has(clientId)) {
        return;
      }

      if (msg.type === 'sync_nodes' && Array.isArray(msg.nodes)) {
        room.nodes = msg.nodes.slice(0, 120);
        broadcastToRoom(room, { type: 'nodes_update', nodes: room.nodes, senderId: clientId }, clientId);
      } else if (msg.type === 'sync_slides' && Array.isArray(msg.slides)) {
        room.slides = msg.slides.slice(0, 40);
        broadcastToRoom(room, { type: 'slides_update', slides: room.slides, senderId: clientId }, clientId);
      } else if (msg.type === 'add_note' && msg.note) {
        room.meetingNotes = [msg.note, ...room.meetingNotes].slice(0, 150);
        broadcastToRoom(room, { type: 'notes_update', meetingNotes: room.meetingNotes, senderId: clientId }, clientId);
      } else if (msg.type === 'cursor_ping') {
        broadcastToRoom(room, { type: 'cursor_ping', clientId, name, color, x: msg.x, y: msg.y }, clientId);
      } else if (msg.type === 'media_state') {
        const me = room.participants.get(clientId);
        if (me) {
          if (typeof msg.micOn === 'boolean') me.micOn = msg.micOn;
          if (typeof msg.camOn === 'boolean') me.camOn = msg.camOn;
          if (typeof msg.screenOn === 'boolean') me.screenOn = msg.screenOn;
          if (typeof msg.handRaised === 'boolean') me.handRaised = msg.handRaised;
          broadcastToRoom(room, {
            type: 'presence',
            participants: serializePresence(room),
          });
        }
      } else if (msg.type === 'hand_state') {
        const me = room.participants.get(clientId);
        if (me && typeof msg.handRaised === 'boolean') {
          me.handRaised = msg.handRaised;
          broadcastToRoom(room, {
            type: 'presence',
            participants: serializePresence(room),
          });
        }
      } else if (msg.type === 'room_reaction' && typeof msg.emoji === 'string') {
        const cleanEmoji = msg.emoji.slice(0, 12);
        broadcastToRoom(room, {
          type: 'room_reaction',
          id: `react_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          clientId,
          senderName: name,
          emoji: cleanEmoji,
        });
      } else if (msg.type === 'room_chat' && typeof msg.text === 'string') {
        const cleanText = msg.text.trim().slice(0, 600);
        if (cleanText) {
          const entry = {
            id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            clientId,
            senderName: name,
            senderColor: color,
            text: cleanText,
            createdAt: new Date().toISOString(),
          };
          room.chatMessages = [...room.chatMessages, entry].slice(-100);
          broadcastToRoom(room, {
            type: 'room_chat_message',
            message: entry,
          });
        }
      } else if (msg.type === 'rtc_offer' || msg.type === 'rtc_answer' || msg.type === 'rtc_ice') {
        const targetPeerId = String(msg.targetPeerId || '');
        const target = room.participants.get(targetPeerId);
        if (target && target.ws.readyState === WebSocket.OPEN) {
          target.ws.send(JSON.stringify({
            type: msg.type,
            fromPeerId: clientId,
            fromName: name,
            fromRole: role,
            fromColor: color,
            sdp: msg.sdp,
            candidate: msg.candidate,
          }));
        }
      }
    } catch {}
  });

  const cleanupPeer = () => {
    if (!room) return;
    const wasWaiting = room.waitingPeers.delete(clientId);
    if (wasWaiting) {
      sendToHost(room, {
        type: 'waiting_requests',
        waitingRequests: serializeWaitingPeers(room),
      });
    }

    const wasAdmitted = room.participants.delete(clientId);
    if (room.hostClientId === clientId) {
      room.hostClientId = null;
      // Inform waiting peers that host stepped out
      room.waitingPeers.forEach((w) => {
        if (w.ws.readyState === WebSocket.OPEN) {
          try {
            w.ws.send(
              JSON.stringify({
                type: 'waiting_approval',
                clientId: w.clientId,
                roomCode,
                hostPresent: false,
                message: 'Waiting for the host to return and admit you...',
              })
            );
          } catch {}
        }
      });
    }

    if (wasAdmitted) {
      broadcastToRoom(room, { type: 'peer_left', peerId: clientId });
      broadcastToRoom(room, {
        type: 'presence',
        participants: serializePresence(room),
      });
    }

    if (
      room.participants.size === 0 &&
      room.waitingPeers.size === 0 &&
      room.nodes.length === 0 &&
      room.slides.length === 0 &&
      room.meetingNotes.length === 0 &&
      room.chatMessages.length === 0
    ) {
      activeCollabRooms.delete(roomCode);
    }
  };

  clientWs.on('close', cleanupPeer);
  clientWs.on('error', (err: any) => {
    recordFailure('error', 'WebSockets', `/api/collab-room (${roomCode})`, 500, err?.message || 'Collab WebSocket error');
    cleanupPeer();
  });
});

// ==========================================
// 12A-B. USER ACCESS CONTROL API (REVOKE & BLOCK)
// ==========================================
app.get('/api/access/status', (req, res) => {
  const authHeader = String(req.headers.authorization || '');
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const claims = idToken ? decodeFirebaseJwtClaims(idToken) : null;
  const uid = claims?.uid || String(req.query.uid || '').trim() || undefined;
  const email = claims?.email || String(req.query.email || '').trim().toLowerCase() || undefined;

  if (!uid && !email) {
    return res.json({ status: 'active', revokedAfterMs: 0 });
  }
  if (email === PLATFORM_OWNER_EMAIL) {
    return res.json({ status: 'active', revokedAfterMs: 0 });
  }
  const rec = findUserAccessRecord(uid, email);
  if (!rec) {
    return res.json({ status: 'active', revokedAfterMs: 0 });
  }
  if (rec.status === 'revoked') {
    const tokenIssuedMs = claims?.authTimeMs || claims?.iatMs || 0;
    if (tokenIssuedMs && tokenIssuedMs >= rec.revokedAfterMs) {
      return res.json({ status: 'active', revokedAfterMs: rec.revokedAfterMs });
    }
  }
  return res.json({
    status: rec.status,
    revokedAfterMs: rec.revokedAfterMs,
    reason: rec.reason || '',
    updatedAt: rec.updatedAt,
  });
});

app.get('/api/admin/user-access', async (req, res) => {
  const authCheck = await verifyAdminRequest(req);
  if (!authCheck.ok) {
    return res.status(authCheck.status || 403).json({ error: authCheck.error });
  }
  return res.json({ records: Array.from(runtimeUserAccessMap.values()) });
});

app.post('/api/admin/user-access', async (req, res) => {
  const authCheck = await verifyAdminRequest(req);
  if (!authCheck.ok) {
    return res.status(authCheck.status || 403).json({ error: authCheck.error });
  }
  const { action, userId, email, displayName, reason } = req.body || {};
  const cleanUid = String(userId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const cleanEmail = String(email || '').trim().toLowerCase().slice(0, 254);

  if (!cleanUid && !cleanEmail) {
    return res.status(400).json({ error: 'Provide either a user UID or email address.' });
  }
  if (cleanEmail === PLATFORM_OWNER_EMAIL || (authCheck.uid && cleanUid === authCheck.uid)) {
    return res.status(400).json({ error: 'The platform owner account cannot be blocked or revoked.' });
  }

  const key = cleanUid || `email_${cleanEmail.replace(/[^a-z0-9_-]/g, '_').slice(0, 96)}`;
  const nowIso = new Date().toISOString();
  const existing = findUserAccessRecord(cleanUid || key, cleanEmail);

  let nextStatus: 'active' | 'revoked' | 'blocked' = 'active';
  if (action === 'block') nextStatus = 'blocked';
  else if (action === 'revoke') nextStatus = 'revoked';
  else if (action === 'unblock') nextStatus = 'active';
  else {
    return res.status(400).json({ error: 'Invalid access action. Expected block, unblock or revoke.' });
  }

  const record: ServerUserAccessRecord = {
    userId: cleanUid || existing?.userId || key,
    email: cleanEmail || existing?.email || '',
    displayName: String(displayName || existing?.displayName || '').slice(0, 120),
    status: nextStatus,
    revokedAfterMs: nextStatus === 'active' ? existing?.revokedAfterMs || 0 : Date.now(),
    reason: String(reason || (nextStatus === 'blocked' ? 'Blocked by platform administrator.' : nextStatus === 'revoked' ? 'Session revoked by platform administrator.' : '')).slice(0, 300),
    updatedBy: authCheck.uid || 'admin',
    updatedAt: nowIso,
  };

  if (nextStatus === 'active') {
    runtimeUserAccessMap.delete(record.userId);
    if (existing?.userId && existing.userId !== record.userId) {
      runtimeUserAccessMap.delete(existing.userId);
    }
  } else {
    runtimeUserAccessMap.set(record.userId, record);
    terminateBlockedUserInRooms(record.userId, record.email, nextStatus === 'blocked' ? 'blocked' : 'revoked');
  }
  saveUserAccessStore();

  return res.json({
    ok: true,
    record,
    message:
      nextStatus === 'blocked'
        ? `Blocked ${record.email || record.userId} across the app.`
        : nextStatus === 'revoked'
        ? `Revoked active sessions for ${record.email || record.userId}.`
        : `Restored access for ${record.email || record.userId}.`,
  });
});

// ==========================================
// 12B. ADMIN OPERATIONS, SYSTEM STATE & INCIDENT CONTROL API
// ==========================================
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.round((Date.now() - SERVER_BOOT_TIME) / 1000),
    services: serviceControls,
    aiConfigured: Boolean(process.env.API_KEY || process.env.GEMINI_API_KEY),
  });
});

app.post('/api/ops/report-error', (req, res) => {
  const { subsystem, source, message, severity } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: 'Missing error message' });
  }
  recordFailure(
    severity === 'critical' || severity === 'warning' ? severity : 'error',
    (['AI', 'Payments', 'Markets', 'WebSockets', 'Auth', 'Client', 'Server'].includes(subsystem) ? subsystem : 'Client') as IncidentSubsystem,
    String(source || 'Browser Runtime'),
    0,
    String(message)
  );
  res.json({ ok: true });
});

app.get('/api/admin/system-state', async (req, res) => {
  const authCheck = await verifyAdminRequest(req);
  if (!authCheck.ok) {
    return res.status(authCheck.status || 403).json({ error: authCheck.error });
  }

  const mem = process.memoryUsage();
  const apiMetrics = Array.from(apiMetricsMap.values()).map((m) => ({
    ...m,
    avgLatencyMs: m.totalCalls > 0 ? Math.round(m.totalLatencyMs / m.totalCalls) : 0,
  }));

  const collabRooms = Array.from(activeCollabRooms.values()).map((room) => ({
    roomCode: room.roomCode,
    participantCount: room.participants.size,
    nodeCount: room.nodes.length,
    slideCount: room.slides.length,
    noteCount: room.meetingNotes.length,
    participants: serializePresence(room),
  }));

  res.json({
    server: {
      uptimeSec: Math.round((Date.now() - SERVER_BOOT_TIME) / 1000),
      nodeVersion: process.version,
      memoryRssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      aiKeyConfigured: Boolean(process.env.API_KEY || process.env.GEMINI_API_KEY),
      firebaseKeyConfigured: Boolean(FIREBASE_WEB_API_KEY),
      quotaCooldownRemainingSec: Math.max(0, Math.ceil((quotaCooldownUntil - Date.now()) / 1000)),
      marketLastFetchAt: lastQuotesFetchAt ? new Date(lastQuotesFetchAt).toISOString() : null,
      marketSourceStatus: lastQuotesFetchAt ? 'Live Market + Crypto + RSS Feeds' : 'Baseline Initializing',
    },
    serviceControls,
    apiMetrics,
    webSockets: {
      liveVoiceClients: wss.clients.size,
      marketStreamClients: marketWss.clients.size,
      collabTotalClients: collabRooms.reduce((sum, r) => sum + r.participantCount, 0),
      activeCollabRooms: collabRooms,
    },
    runtimeStores: {
      paymentIntentsCount: runtimePaymentIntents.size,
      paymentsLedgerCount: runtimePaymentsLedger.length,
      analyticsEventsCount: runtimeAnalyticsEvents.length,
      organizationsCount: runtimeOrganizations.length,
      marketCompaniesCached: liveMarketState.listedCompanies.length,
      marketNewsCached: liveMarketState.news.length,
      payoutConfigured: Boolean(runtimePayoutConfig.upiId || runtimePayoutConfig.accountNumber),
      payoutPayeeName: runtimePayoutConfig.payeeName || null,
      payoutUpiId: runtimePayoutConfig.upiId || null,
    },
    incidents: runtimeIncidents,
  });
});

app.post('/api/admin/service-controls', async (req, res) => {
  const authCheck = await verifyAdminRequest(req);
  if (!authCheck.ok) {
    return res.status(authCheck.status || 403).json({ error: authCheck.error });
  }
  const body = req.body || {};
  (['aiVision', 'aiAssistant', 'paymentsGateway', 'marketStream', 'collabRooms', 'liveVoice'] as const).forEach((k) => {
    if (typeof body[k] === 'boolean') {
      serviceControls[k] = body[k];
    }
  });
  if (typeof body.maintenanceBanner === 'string') {
    serviceControls.maintenanceBanner = body.maintenanceBanner.trim().slice(0, 240);
  }
  serviceControls.updatedAt = new Date().toISOString();
  res.json({ ok: true, serviceControls });
});

app.post('/api/admin/actions', async (req, res) => {
  const authCheck = await verifyAdminRequest(req);
  if (!authCheck.ok) {
    return res.status(authCheck.status || 403).json({ error: authCheck.error });
  }
  const { action, roomCode, clientId, incidentId, message } = req.body || {};

  if (action === 'reset_ai_cooldown') {
    quotaCooldownUntil = 0;
    return res.json({ ok: true, message: 'AI quota cooldown reset.' });
  }
  if (action === 'flush_market_cache') {
    await refreshLiveMarketState(true);
    return res.json({ ok: true, message: 'Live market & news cache refreshed.' });
  }
  if (action === 'clear_expired_intents') {
    const cutoff = Date.now() - 60 * 60 * 1000;
    let cleared = 0;
    runtimePaymentIntents.forEach((intent, key) => {
      const created = Date.parse(intent.createdAt || '') || 0;
      if (intent.status !== 'succeeded' && created < cutoff) {
        runtimePaymentIntents.delete(key);
        cleared += 1;
      }
    });
    return res.json({ ok: true, message: `Cleared ${cleared} expired payment intents.` });
  }
  if (action === 'ack_incident' && incidentId) {
    const inc = runtimeIncidents.find((i) => i.id === incidentId);
    if (inc) inc.status = 'acknowledged';
    return res.json({ ok: true });
  }
  if (action === 'resolve_incident' && incidentId) {
    const inc = runtimeIncidents.find((i) => i.id === incidentId);
    if (inc) inc.status = 'resolved';
    return res.json({ ok: true });
  }
  if (action === 'clear_resolved_incidents') {
    for (let i = runtimeIncidents.length - 1; i >= 0; i--) {
      if (runtimeIncidents[i].status === 'resolved') {
        runtimeIncidents.splice(i, 1);
      }
    }
    return res.json({ ok: true });
  }
  if (action === 'close_collab_room' && roomCode) {
    const code = String(roomCode).toUpperCase();
    const room = activeCollabRooms.get(code);
    if (room) {
      room.participants.forEach((p) => {
        if (p.ws.readyState === WebSocket.OPEN) {
          try {
            p.ws.send(JSON.stringify({ type: 'admin_room_closed', message: 'This collaboration room was closed by an administrator.' }));
            p.ws.close(1000, 'Closed by administrator');
          } catch {}
        }
      });
      activeCollabRooms.delete(code);
    }
    return res.json({ ok: true, message: `Closed room ${code}.` });
  }
  if (action === 'kick_room_participant' && roomCode && clientId) {
    const code = String(roomCode).toUpperCase();
    const room = activeCollabRooms.get(code);
    const target = room?.participants.get(String(clientId));
    if (room && target) {
      try {
        target.ws.send(JSON.stringify({ type: 'admin_room_closed', message: 'You were removed from this room by an administrator.' }));
        target.ws.close(1000, 'Removed by administrator');
      } catch {}
      room.participants.delete(String(clientId));
      broadcastToRoom(room, { type: 'presence', participants: serializePresence(room) });
    }
    return res.json({ ok: true });
  }
  if (action === 'broadcast_room_message' && message) {
    const cleanMsg = String(message).trim().slice(0, 300);
    const targetCode = String(roomCode || 'ALL').toUpperCase();
    activeCollabRooms.forEach((room, code) => {
      if (targetCode === 'ALL' || code === targetCode) {
        broadcastToRoom(room, { type: 'admin_notice', message: cleanMsg });
      }
    });
    return res.json({ ok: true, message: 'Broadcast delivered.' });
  }

  return res.status(400).json({ error: 'Unknown or incomplete admin action.' });
});

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
  if (pathname === '/api/live') {
    if (!serviceControls.liveVoice) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else if (pathname === '/api/market-stream') {
    if (!serviceControls.marketStream) {
      socket.destroy();
      return;
    }
    marketWss.handleUpgrade(request, socket, head, (ws) => {
      marketWss.emit('connection', ws, request);
    });
  } else if (pathname === '/api/collab-room') {
    if (!serviceControls.collabRooms) {
      socket.destroy();
      return;
    }
    collabWss.handleUpgrade(request, socket, head, (ws) => {
      collabWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// ==========================================
// 13. VITE MIDDLEWARE / STATIC ASSET SERVING + BULLETPROOF SPA FALLBACKS
// ==========================================
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });

    // Guarantee shared invite links and deep routes always resolve to SPA HTML cleanly
    app.get(['/workspace', '/workspace/{*splat}', '/join', '/join/{*splat}', '/admin', '/admin/{*splat}'], async (req, res, next) => {
      try {
        const templatePath = path.resolve(__dirname, 'index.html');
        const rawHtml = fs.readFileSync(templatePath, 'utf-8');
        const transformed = await vite.transformIndexHtml(req.originalUrl, rawHtml);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(transformed);
      } catch (e) {
        next(e);
      }
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const fallbackIndex = fs.existsSync(path.join(distDir, 'index.html'))
      ? path.join(distDir, 'index.html')
      : path.resolve(__dirname, 'index.html');

    app.use(express.static(distDir));
    app.get(['/', '/workspace', '/workspace/{*splat}', '/join', '/join/{*splat}', '/admin', '/admin/{*splat}'], (_req, res) => {
      res.sendFile(fallbackIndex);
    });
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(fallbackIndex);
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Liddy Server] Listening on http://0.0.0.0:${PORT} (Production: ${isProduction})`);
    // Warm up live market snapshot and RSS news feed non-blocking on boot
    refreshLiveMarketState(true).catch(() => {});
  });
}

startServer();
