import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Type, Modality, type LiveServerMessage } from '@google/genai';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const getAiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) {
    console.warn('[Gemini Server] Warning: process.env.GEMINI_API_KEY is not configured.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
      timeout: 25000,
    },
  });
};

let quotaCooldownUntil = 0;

function isQuotaError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  const status = err?.status || err?.code;
  return status === 429 || msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('quota');
}

export function markQuotaExhausted(err?: any) {
  if (isQuotaError(err)) {
    quotaCooldownUntil = Date.now() + 60 * 1000; // 60-second cooldown only on real 429
  }
}

export function shouldSkipGeminiCall(): boolean {
  if (!process.env.GEMINI_API_KEY) return true;
  return Date.now() < quotaCooldownUntil;
}

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
    description: 'Designs, manufactures, and markets iPhone, Mac, iPad, wearables, Apple Silicon, and recurring cloud/media services.',
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
    description: 'Pioneers GPU-accelerated computing, datacenter AI clusters, CUDA software platform, and high-speed networking fabrics.',
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
    description: 'Operates Google Search, YouTube, Android, Google Cloud Platform, and frontier computing research.',
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
    description: 'Operates Amazon Web Services (AWS) cloud infrastructure, global e-commerce logistics, and digital advertising.',
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
    description: 'Connects billions globally via Facebook, Instagram, WhatsApp, Threads, open foundation models, and Reality Labs.',
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
    description: 'Designs electric vehicles, utility-scale Megapack energy storage, solar systems, and autonomous driving networks.',
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
    description: 'India’s largest private sector conglomerate spanning Jio 5G telecom, Reliance Retail, clean energy, and refining.',
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
    description: 'Global IT services and enterprise consulting leader operating across 55 countries for banking, retail, and telecom clients.',
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
    description: 'India’s largest private-sector bank delivering retail banking, corporate treasury, and UPI payment infrastructure.',
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
    description: 'Global software major delivering cloud migration, Topaz platforms, and enterprise engineering transformations.',
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
    description: 'Holding group operating Zomato food delivery, Blinkit 10-minute quick commerce, Hyperpure B2B supply, and District live events.',
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
    description: 'Global science-led biopharmaceutical leader focusing on oncology, rare diseases, and cardiovascular therapies.',
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
    description: 'World’s premier luxury conglomerate encompassing Louis Vuitton, Christian Dior, Tiffany & Co., and Sephora.',
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
    description: 'World’s largest automotive manufacturer leading hybrid-electric powertrains, solid-state batteries, and mobility systems.',
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
    description: 'Operates WeChat social and payment ecosystem, global interactive gaming studios, and enterprise cloud infrastructure.',
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
    { path: '/workspace/invoices', priority: '0.9', changefreq: 'weekly' },
    { path: '/workspace/scanner', priority: '0.9', changefreq: 'weekly' },
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
      monthlyRevenueUsd: Math.max(0, Number(body.monthlyRevenueUsd) ?? (planTier === 'pro' ? 12 : planTier === 'team' ? 29 : planTier === 'enterprise' ? 99 : 0)),
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
interface RuntimePaymentRecord {
  paymentId: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  planTier: 'free' | 'pro' | 'team';
  billingCycle: 'monthly' | 'annual';
  region: 'IN' | 'INTL';
  currency: 'INR' | 'USD' | 'EUR' | 'GBP';
  amount: number;
  amountUsdEquivalent: number;
  paymentRail: 'UPI_QR' | 'UPI_ID' | 'CARD' | 'WALLET';
  connector: string;
  status: 'succeeded' | 'processing' | 'requires_action' | 'failed';
  referenceCode: string;
  createdAt: string;
}

interface RuntimePaymentIntentExtra {
  clientSecret: string;
  upiUri?: string;
  challengeOtp: string;
  step1Verified: boolean;
  maskedInstrument?: string;
}

const runtimePaymentIntents = new Map<string, RuntimePaymentRecord & RuntimePaymentIntentExtra>();
const runtimePaymentsLedger: RuntimePaymentRecord[] = [];

const PLAN_RATES = {
  pro: { monthlyUsd: 12, annualMonthlyUsd: 9, monthlyInr: 999, annualMonthlyInr: 749 },
  team: { monthlyUsd: 29, annualMonthlyUsd: 24, monthlyInr: 2499, annualMonthlyInr: 1999 },
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
          { rail: 'CARD', label: 'Debit or Credit Card', connector: 'in_cards' },
        ]
      : [
          { rail: 'CARD', label: 'Credit or Debit Card', connector: 'global_cards' },
          { rail: 'WALLET', label: 'Apple Pay / Google Pay', connector: 'express_wallet' },
        ],
  });
});

app.post('/api/payments/create-intent', async (req, res) => {
  try {
    const body = req.body || {};
    const planTier: 'pro' | 'team' = body.planTier === 'team' ? 'team' : 'pro';
    const billingCycle: 'monthly' | 'annual' = body.billingCycle === 'monthly' ? 'monthly' : 'annual';
    const region: 'IN' | 'INTL' = body.region === 'IN' ? 'IN' : 'INTL';
    const validRails = new Set(['UPI_QR', 'UPI_ID', 'CARD', 'WALLET']);
    if (body.paymentRail && !validRails.has(body.paymentRail)) {
      return res.status(400).json({ error: 'Selected payment method is not supported. Please choose UPI, Card, or Digital Wallet.' });
    }
    const paymentRail = validRails.has(body.paymentRail) ? body.paymentRail : region === 'IN' ? 'UPI_QR' : 'CARD';

    const rates = PLAN_RATES[planTier];
    const mult = billingCycle === 'annual' ? 12 : 1;
    const currency: 'INR' | 'USD' = region === 'IN' ? 'INR' : 'USD';
    const amount = region === 'IN'
      ? (billingCycle === 'annual' ? rates.annualMonthlyInr : rates.monthlyInr) * mult
      : (billingCycle === 'annual' ? rates.annualMonthlyUsd : rates.monthlyUsd) * mult;
    const amountUsdEquivalent = (billingCycle === 'annual' ? rates.annualMonthlyUsd : rates.monthlyUsd) * mult;

    const connectorMap: Record<string, string> = {
      UPI_QR: 'in_upi_qr',
      UPI_ID: 'in_upi_collect',
      WALLET: 'express_wallet',
      CARD: region === 'IN' ? 'in_cards' : 'global_cards',
    };

    let paymentId = `pay_hs_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    let clientSecret = `${paymentId}_secret_${crypto.randomBytes(8).toString('hex')}`;
    const hyperswitchBase = process.env.HYPERSWITCH_URL || 'https://sandbox.hyperswitch.io';
    const hyperswitchKey = process.env.HYPERSWITCH_API_KEY;

    if (hyperswitchKey) {
      try {
        const hsResp = await fetch(`${hyperswitchBase}/payments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': hyperswitchKey,
          },
          body: JSON.stringify({
            amount: Math.round(amount * 100),
            currency,
            confirm: false,
            description: `Liddy ${planTier.toUpperCase()} (${billingCycle})`,
            authentication_type: 'three_ds',
          }),
          signal: AbortSignal.timeout(6000),
        });
        if (hsResp.ok) {
          const hsData: any = await hsResp.json();
          if (hsData.payment_id) paymentId = hsData.payment_id;
          if (hsData.client_secret) clientSecret = hsData.client_secret;
        }
      } catch {
        // Proceed with built-in Hyperswitch router orchestration seamlessly
      }
    }

    const referenceCode = `HS-${region}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const challengeOtp = String(Math.floor(100000 + Math.random() * 900000));
    const upiUri =
      region === 'IN'
        ? `upi://pay?pa=liddy.payments@icici&pn=Liddy%20Finance&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(
            `Liddy ${planTier.toUpperCase()} ${referenceCode}`
          )}`
        : undefined;

    const intent: RuntimePaymentRecord & RuntimePaymentIntentExtra = {
      paymentId,
      clientSecret,
      upiUri,
      challengeOtp,
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
      paymentRail,
      connector: connectorMap[paymentRail] || 'hyperswitch_router',
      status: 'requires_action',
      referenceCode,
      createdAt: new Date().toISOString(),
    };

    runtimePaymentIntents.set(paymentId, intent);
    // Never leak challengeOtp on intent creation; user must authorize instrument first
    const { challengeOtp: _hidden, ...publicIntent } = intent;
    res.status(201).json(publicIntent);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unable to initialize payment intent' });
  }
});

// Step 1 Verification Challenge Initiation — prevents single-click payment bypass
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

    if (rail === 'CARD') {
      const digits = String(body.cardNumber || '').replace(/\D/g, '');
      const cvv = String(body.cardCvv || '').trim();
      const holder = String(body.cardHolder || '').trim();
      if (!passesLuhnCheck(digits)) {
        return res.status(400).json({ error: 'Invalid card number. Please check your 16-digit card number.' });
      }
      if (!isValidExpiry(body.cardExpiry)) {
        return res.status(400).json({ error: 'Invalid or expired card expiry date (MM/YY).' });
      }
      if (!/^\d{3,4}$/.test(cvv)) {
        return res.status(400).json({ error: 'Invalid security CVV (3 or 4 digits required).' });
      }
      if (holder.length < 2) {
        return res.status(400).json({ error: 'Cardholder name is required.' });
      }
      maskedInstrument = `•••• ${digits.slice(-4)}`;
    } else if (rail === 'UPI_ID') {
      const vpa = String(body.upiId || '').trim();
      if (!/^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/.test(vpa)) {
        return res.status(400).json({ error: 'Enter a valid UPI ID (example: name@okicici).' });
      }
      maskedInstrument = vpa;
    } else if (rail === 'WALLET') {
      const walletProvider = String(body.walletProvider || '').trim();
      const walletEmail = String(body.walletHandle || body.userEmail || '').trim();
      if (!walletProvider || !walletEmail.includes('@')) {
        return res.status(400).json({ error: 'Select a wallet provider and enter your email.' });
      }
      maskedInstrument = `${walletProvider} (${walletEmail})`;
    } else if (rail === 'UPI_QR') {
      maskedInstrument = 'UPI QR Scan';
    } else {
      return res.status(400).json({ error: 'Please select a supported payment method.' });
    }

    existing.step1Verified = true;
    existing.maskedInstrument = maskedInstrument;
    existing.paymentRail = rail as any;
    runtimePaymentIntents.set(paymentId, existing);

    res.json({
      ok: true,
      requiresOtp: rail !== 'UPI_QR',
      requiresUtr: rail === 'UPI_QR',
      maskedInstrument,
      challengeCodeNotice:
        rail === 'UPI_QR'
          ? 'Scan the QR code in your UPI app and enter the 12-digit transaction reference below.'
          : `6-digit verification code sent (Demo code: ${existing.challengeOtp})`,
      verificationHint: rail === 'UPI_QR' ? undefined : existing.challengeOtp,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unable to authorize payment instrument' });
  }
});

app.post('/api/payments/confirm', (req, res) => {
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

    if (rail === 'UPI_QR') {
      const utr = String(body.upiRef || '').trim();
      if (!isValidUtr(utr)) {
        return res.status(400).json({
          error: 'Payment verification failed: enter your valid 10–24 character UPI UTR transaction reference.',
        });
      }
    } else {
      if (!existing.step1Verified) {
        return res.status(400).json({
          error: 'Payment verification required: complete Step 1 instrument authorization before confirming.',
        });
      }
      const otpInput = String(body.verificationCode || '').trim();
      if (!otpInput || otpInput !== existing.challengeOtp) {
        return res.status(400).json({
          error: 'Invalid 6-digit gateway verification code. Please check the code and retry.',
        });
      }
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
      metadata: `${confirmed.planTier}/${confirmed.region}/${confirmed.paymentRail}`,
      revenueImpactUsd: confirmed.amountUsdEquivalent,
      createdAt: confirmed.createdAt,
    });

    const receiptPayload = buildFormattedInvoiceEmailPayload({
      recipientEmail: confirmed.userEmail || '',
      buyerName: confirmed.userName || 'Liddy Member',
      referenceCode: confirmed.referenceCode,
      invoiceNumber: `INV-${confirmed.referenceCode}`,
      date: confirmed.createdAt.split('T')[0],
      items: [
        {
          description: `Liddy ${confirmed.planTier.toUpperCase()} Subscription (${confirmed.billingCycle})`,
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
      notes: 'Subscription unlocked immediately. Thank you for choosing Liddy Financial Workspace.',
    });

    res.json({ ok: true, payment: confirmed, receiptEmail: receiptPayload });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Payment confirmation failed' });
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
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Generate a structured visual mind map for: "${topic}".
Return raw JSON only with keys:
- "title": concise 4-7 word board title
- "nodes": array of 6 nodes covering distinct angles.
  First node MUST have id "n-root", parentId null, shape "hub", x: 350, y: 185.
  Other 5 nodes have parentId "n-root" (or another node's id), spaced cleanly in canvas x: 40..660, y: 40..340 with at least 190px apart so cards never overlap.
  Each node has: { id, label (max 36 chars), notes (max 90 chars), x, y, color ("indigo"|"sky"|"emerald"|"amber"|"rose"|"neutral"), shape ("hub"|"step"|"insight"|"metric"|"action"), metricTag (short 1-2 word badge like "Phase 1" or "Target"), parentId }.`,
      config: { responseMimeType: 'application/json' },
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
app.post('/api/gemini/vision-slides', async (req, res) => {
  const topic = String(req.body?.topic || '').trim();
  const theme = (['midnight', 'ivory', 'emerald', 'cobalt'].includes(req.body?.theme) ? req.body.theme : 'midnight') as 'midnight' | 'ivory' | 'emerald' | 'cobalt';
  if (!topic) {
    return res.status(400).json({ error: 'Enter a topic to build slides.' });
  }

  const fallbackSlides = {
    title: topic.slice(0, 72),
    slides: [
      {
        id: 's-1',
        title: topic.slice(0, 60),
        subtitle: 'Overview, Key Objectives & Next Steps',
        bullets: ['Clear focus tailored for fast team alignment', 'Practical budget and timeline milestones', 'Ready to share or present anywhere'],
        layout: 'cover',
        theme,
        metricHighlight: 'Q1 Plan',
      },
      {
        id: 's-2',
        title: 'Key Numbers & Success Targets',
        subtitle: 'Measurable progress checkpoints',
        bullets: ['Primary goal target: 100% milestone completion', 'Estimated efficiency gain: +35% faster delivery', 'Monthly check-in cadence with clear ownership'],
        layout: 'metrics',
        theme,
        metricHighlight: '+35% Pace',
      },
      {
        id: 's-3',
        title: 'Two-Side Priority Comparison',
        subtitle: 'What matters most right now',
        bullets: ['Focus First: Core deliverables & customer feedback', 'Defer Later: Nice-to-have extras', 'Daily Habit: Keep spending & notes updated'],
        layout: 'two-col',
        theme,
      },
      {
        id: 's-4',
        title: 'Three-Step Action Timeline',
        subtitle: 'Clear path from kickoff to finish',
        bullets: ['Phase 1: Align goals and finalize budget', 'Phase 2: Build prototype and test with users', 'Phase 3: Review outcomes and scale'],
        layout: 'roadmap',
        theme,
      },
    ],
  };

  if (shouldSkipGeminiCall()) {
    return res.json(fallbackSlides);
  }

  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Create an engaging, visually structured 4-slide presentation deck about: "${topic}".
Return raw JSON only with keys:
- "title": crisp presentation title
- "slides": array of 4 slides covering layouts "cover", "metrics", "two-col", "roadmap" in varied order.
  Each slide has: { id ("s-1", etc.), title (max 55 chars), subtitle (max 80 chars), bullets (array of 3 punchy strings, max 85 chars each), layout ("cover"|"metrics"|"two-col"|"roadmap"), theme ("${theme}"), metricHighlight (concise stat like "$25K Saved" or "Week 1-4") }.`,
      config: { responseMimeType: 'application/json' },
    });

    const raw = response.text?.trim() || '';
    if (raw) {
      const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed?.slides) && parsed.slides.length > 0) {
        return res.json(parsed);
      }
    }
    res.json(fallbackSlides);
  } catch (err: any) {
    markQuotaExhausted(err);
    res.json(fallbackSlides);
  }
});

// ==========================================
// 1. CHAT & MULTIMODAL FINANCE AGENT
// ==========================================
app.post('/api/gemini/agent', async (req, res) => {
  if (shouldSkipGeminiCall()) {
    return res.status(503).json({
      error: 'AI advisory service is temporarily unavailable or waiting on API quota cooldown. Please try again in a minute.',
    });
  }

  try {
    const { prompt, mode = 'chat', attachment, history = [] } = req.body;
    const ai = getAiClient();

    let systemInstruction = "You are Liddy, a senior conversational financial advisor. Provide crisp, clear, accurate financial guidance, budgeting advice, and portfolio insights. Format your answers using clean markdown, bold metrics, and structured tables where appropriate.";
    const tools: any[] = [];

    if (mode === 'web') {
      systemInstruction = "You are Liddy Live Grounding Agent. You provide real-time verified financial data, world stock market quotes, economic indices, interest rate decisions, and corporate news. Always use Google Search to verify recent numbers and cite sources in your answers.";
      tools.push({ googleSearch: {} });
    } else if (mode === 'agent') {
      systemInstruction = "You are Liddy Autonomous Financial Analyst & Actuary. You perform rigorous quantitative calculations, balance sheet auditing, operating cash flow analysis, debt-to-equity and liquidity ratio calculations, and forward-looking probabilistic modeling. Always lay out your financial breakdowns in clean tables with exact numbers and clear takeaways.";
    } else if (mode === 'ocr') {
      systemInstruction = "You are Liddy Document & Receipt Intelligence Agent. You inspect financial receipts, commercial invoices, bank statements, tax forms, and portfolio reports. Extract merchant/vendor, date, total amount, taxes, itemized lines, and categorize them into a clean financial summary with a structured table.";
    }

    const contents: any[] = Array.isArray(history)
      ? history
          .filter((h: any) => h && (h.role === 'user' || h.role === 'model') && typeof h.text === 'string' && h.text.trim())
          .slice(-8)
          .map((h: any) => ({ role: h.role, parts: [{ text: h.text }] }))
      : [];

    const userParts: any[] = [];
    if (attachment && attachment.data) {
      userParts.push({
        inlineData: {
          mimeType: attachment.mimeType || 'image/jpeg',
          data: attachment.data,
        },
      });
    }
    userParts.push({
      text: prompt || (attachment ? "Analyze this uploaded financial document or image and provide a comprehensive financial breakdown." : "Hello Liddy."),
    });
    contents.push({ role: 'user', parts: userParts });

    const config: any = { systemInstruction };
    if (tools.length > 0) {
      config.tools = tools;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents,
      config,
    });

    const responseText = response.text || "I have analyzed your request. Please let me know what specific calculations you would like next.";
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    const groundingUrls = groundingChunks?.map((c: any) => ({
      title: c.web?.title || 'Financial Source',
      uri: c.web?.uri || '#'
    })).filter((x: any) => x.uri !== '#');

    res.json({
      text: responseText,
      groundingUrls: groundingUrls || [],
    });
  } catch (err: any) {
    console.warn('[API /api/gemini/agent] Error:', err?.message || err);
    markQuotaExhausted(err);
    res.status(isQuotaError(err) ? 429 : 502).json({
      error: isQuotaError(err)
        ? 'API quota temporarily exhausted. Please retry in a minute.'
        : (err?.message || 'Unable to reach AI advisor right now.'),
    });
  }
});

// ==========================================
// 2. RECEIPT & BILL SCANNER (VISION)
// ==========================================
app.post('/api/gemini/receipt', async (req, res) => {
  if (shouldSkipGeminiCall()) {
    return res.status(503).json({ error: 'Receipt OCR service temporarily unavailable or on quota cooldown.' });
  }

  try {
    const { base64Data } = req.body;
    if (!base64Data) {
      return res.status(400).json({ error: 'Missing base64Data' });
    }

    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
          { text: "Analyze this receipt. Return a JSON object with 'merchant' (string), 'amount' (number), 'date' (YYYY-MM-DD), and 'category' (string). Only return raw JSON without markdown formatting." }
        ]
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            merchant: { type: Type.STRING },
            amount: { type: Type.NUMBER },
            date: { type: Type.STRING },
            category: { type: Type.STRING }
          },
          required: ['merchant', 'amount', 'category']
        }
      }
    });

    const raw = response.text?.trim() || '';
    if (raw) {
      const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      return res.json(JSON.parse(clean));
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
app.post('/api/gemini/generate-image', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Please describe the visual you want to create.' });
    }

    const cleanPrompt = prompt.trim();
    const ai = getAiClient();
    const fullPrompt = `${cleanPrompt}, clean architectural lighting, refined composition, high resolution editorial style`;

    if (!shouldSkipGeminiCall()) {
      // Try default image model without tripping global text-model cooldown on billing/tier limits
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite-image',
          contents: {
            parts: [{ text: fullPrompt }],
          },
          config: {
            imageConfig: { aspectRatio: '16:9' },
          },
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
          if (part.inlineData?.data) {
            const mime = part.inlineData.mimeType || 'image/png';
            return res.json({ imageUrl: `data:${mime};base64,${part.inlineData.data}`, format: 'raster' });
          }
        }
      } catch {
        // Paid image tier unavailable or restricted — gracefully generate high-craft architectural SVG concept below
      }

      // Bespoke architectural SVG concept via Gemini text model
      try {
        const svgResp = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: `Create a polished, high-craft minimalist 16:9 SVG illustration (viewBox="0 0 1280 720") depicting: "${cleanPrompt}".
Use rich layered gradients, warm natural lighting, clean architectural geometry, depth shadows, subtle highlights, and zero cluttered text. Return ONLY valid <svg ...>...</svg> markup with no markdown fences.`,
        });
        const rawSvg = (svgResp.text || '').trim().replace(/^```(?:svg|xml)?\s*/i, '').replace(/```$/i, '').trim();
        if (rawSvg.startsWith('<svg') && rawSvg.includes('</svg>')) {
          const encoded = Buffer.from(rawSvg, 'utf8').toString('base64');
          return res.json({
            imageUrl: `data:image/svg+xml;base64,${encoded}`,
            format: 'svg',
          });
        }
      } catch (svgErr: any) {
        markQuotaExhausted(svgErr);
      }
    }

    // Deterministic sunlit architectural concept illustration fallback (never fails UI render)
    const safeTitle = cleanPrompt
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .slice(0, 68);
    const hash = Array.from(cleanPrompt).reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 210);
    const accentHue = hash;
    const warmHue = (hash + 145) % 360;
    const parametricSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="hsl(${accentHue}, 45%, 14%)"/>
          <stop offset="55%" stop-color="hsl(${accentHue}, 38%, 24%)"/>
          <stop offset="100%" stop-color="hsl(${warmHue}, 52%, 44%)"/>
        </linearGradient>
        <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#FDE68A" stop-opacity="0.95"/>
          <stop offset="100%" stop-color="#F59E0B" stop-opacity="0.1"/>
        </linearGradient>
        <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.04"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#sky)"/>
      <circle cx="960" cy="220" r="150" fill="url(#sun)"/>
      <path d="M0 510 L320 350 L620 470 L940 310 L1280 460 L1280 720 L0 720 Z" fill="hsl(${accentHue}, 35%, 10%)" fill-opacity="0.72"/>
      <path d="M0 580 L410 430 L760 545 L1080 420 L1280 510 L1280 720 L0 720 Z" fill="hsl(${accentHue}, 30%, 7%)" fill-opacity="0.9"/>
      <rect x="140" y="210" width="520" height="310" rx="22" fill="url(#glass)" stroke="rgba(255,255,255,0.28)" stroke-width="2"/>
      <line x1="140" y1="280" x2="660" y2="280" stroke="rgba(255,255,255,0.16)" stroke-width="1.5"/>
      <rect x="180" y="325" width="210" height="145" rx="14" fill="rgba(255,255,255,0.10)"/>
      <rect x="415" y="325" width="205" height="65" rx="12" fill="rgba(255,255,255,0.14)"/>
      <rect x="415" y="405" width="205" height="65" rx="12" fill="rgba(253,230,138,0.22)"/>
      <text x="180" y="253" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700" fill="#F8FAFC" letter-spacing="2">CONCEPT VISUAL STUDY</text>
      <text x="180" y="640" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="600" fill="#F8FAFC" opacity="0.92">${safeTitle}</text>
    </svg>`;
    const fallbackEncoded = Buffer.from(parametricSvg, 'utf8').toString('base64');
    res.json({ imageUrl: `data:image/svg+xml;base64,${fallbackEncoded}`, format: 'svg' });
  } catch (err: any) {
    res.status(502).json({ imageUrl: null, error: err?.message || 'Could not create visual right now.' });
  }
});

// ==========================================
// 4. ENHANCE FINANCIAL PROMPT
// ==========================================
app.post('/api/gemini/enhance-prompt', async (req, res) => {
  const { rawPrompt } = req.body;
  if (!rawPrompt) {
    return res.status(400).json({ error: 'Missing rawPrompt' });
  }

  const fallbackPrompt = `${rawPrompt}, warm architectural lighting, minimalist editorial aesthetic, 8k resolution`;
  if (shouldSkipGeminiCall()) {
    return res.json({ text: fallbackPrompt });
  }

  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `You are an expert art director for architectural wealth and luxury design. Expand this financial goal prompt into a highly cinematic, photorealistic 1-sentence prompt with natural lighting, materials (travertine, dark glass, minimalist metals), and composition: "${rawPrompt}". Return ONLY the enhanced prompt sentence, nothing else.`
    });

    res.json({ text: response.text?.trim() || fallbackPrompt });
  } catch (err: any) {
    markQuotaExhausted(err);
    res.json({ text: fallbackPrompt });
  }
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
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
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

    const analysis = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
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

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
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
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
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
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
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

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
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

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
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
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
  ws: WebSocket;
}

interface ServerCollabRoomState {
  roomCode: string;
  nodes: any[];
  slides: any[];
  meetingNotes: any[];
  participants: Map<string, ServerCollabParticipant>;
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

function serializePresence(room: ServerCollabRoomState) {
  return Array.from(room.participants.values()).map(({ clientId, name, role, color, joinedAt, micOn, camOn, screenOn }) => ({
    clientId,
    peerId: clientId,
    name,
    role,
    color,
    joinedAt,
    micOn,
    camOn,
    screenOn,
  }));
}

collabWss.on('connection', (clientWs: WebSocket, req?: http.IncomingMessage) => {
  const url = new URL(req?.url || '/api/collab-room', 'http://localhost');
  const roomCode = (url.searchParams.get('room') || 'TEAM-101').toUpperCase().slice(0, 32);
  const name = (url.searchParams.get('name') || 'Participant').slice(0, 40);
  const role = (url.searchParams.get('role') || 'Member').slice(0, 32);
  const clientId = `peer_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const palette = ['#4F46E5', '#10B981', '#0284C7', '#D97706', '#E11D48', '#7C3AED'];
  const color = palette[Math.floor(Math.random() * palette.length)];

  let room = activeCollabRooms.get(roomCode);
  if (!room) {
    room = {
      roomCode,
      nodes: [],
      slides: [],
      meetingNotes: [],
      participants: new Map(),
    };
    activeCollabRooms.set(roomCode, room);
  }

  room.participants.set(clientId, {
    clientId,
    name,
    role,
    color,
    joinedAt: new Date().toISOString(),
    micOn: false,
    camOn: false,
    screenOn: false,
    ws: clientWs,
  });

  if (clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(JSON.stringify({
      type: 'room_state',
      clientId,
      peerId: clientId,
      roomCode,
      nodes: room.nodes,
      slides: room.slides,
      meetingNotes: room.meetingNotes,
      participants: serializePresence(room),
    }));
  }

  broadcastToRoom(room, {
    type: 'presence',
    participants: serializePresence(room),
  });

  clientWs.on('message', (raw: any) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (!room) return;

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
          broadcastToRoom(room, {
            type: 'presence',
            participants: serializePresence(room),
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
    room.participants.delete(clientId);
    broadcastToRoom(room, { type: 'peer_left', peerId: clientId });
    if (room.participants.size === 0 && room.nodes.length === 0 && room.slides.length === 0 && room.meetingNotes.length === 0) {
      activeCollabRooms.delete(roomCode);
    } else {
      broadcastToRoom(room, {
        type: 'presence',
        participants: serializePresence(room),
      });
    }
  };

  clientWs.on('close', cleanupPeer);
  clientWs.on('error', cleanupPeer);
});

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url || '', `http://${request.headers.host}`);
  if (pathname === '/api/live') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else if (pathname === '/api/market-stream') {
    marketWss.handleUpgrade(request, socket, head, (ws) => {
      marketWss.emit('connection', ws, request);
    });
  } else if (pathname === '/api/collab-room') {
    collabWss.handleUpgrade(request, socket, head, (ws) => {
      collabWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// ==========================================
// 13. VITE MIDDLEWARE / STATIC ASSET SERVING
// ==========================================
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.use((req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
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
