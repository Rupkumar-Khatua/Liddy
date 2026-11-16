import {
  Transaction,
  MarketData,
  Invoice,
  IndustryTheme,
  MarketNewsItem,
  ListedCompany,
  VisualStylePreset,
  VisualAspectRatio,
  ImageRenderJobState,
  AiImageConfig,
  FinancialContextSnapshot,
  AgentLedgerOperations,
} from "../types";

export type AgentMode = 'chat' | 'web' | 'agent' | 'ocr';

export interface AgentAttachment {
  name: string;
  mimeType: string;
  data: string; // Base64
  size?: number;
}

export interface AgentQueryResult {
  text: string;
  groundingUrls?: Array<{ title: string; uri: string }>;
  activatedTools?: string[];
  ledgerOperations?: AgentLedgerOperations;
}

const FRIENDLY_AGENT_ERROR =
  "Sorry, I wasn't able to proceed with that request right now. Please try again in a moment.";

// --- 1. Chat Assistant (Text, Web Grounding & Multimodal) ---
export const queryFinanceAgent = async (
  prompt: string,
  mode: AgentMode = 'chat',
  attachment?: AgentAttachment | null,
  history: Array<{ role: 'user' | 'model'; text: string }> = [],
  financialContext?: FinancialContextSnapshot
): Promise<AgentQueryResult> => {
  try {
    const res = await fetch('/api/gemini/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, mode, attachment, history, financialContext }),
    });

    if (!res.ok) {
      throw new Error(FRIENDLY_AGENT_ERROR);
    }

    const data = await res.json().catch(() => null);
    if (!data || !data.text) {
      throw new Error(FRIENDLY_AGENT_ERROR);
    }

    return {
      text: data.text,
      groundingUrls: data.groundingUrls || [],
      activatedTools: Array.isArray(data.activatedTools) ? data.activatedTools : [],
      ledgerOperations: data.ledgerOperations || {},
    };
  } catch (err: any) {
    console.warn("Finance agent query notice:", err?.message || err);
    throw new Error(FRIENDLY_AGENT_ERROR);
  }
};

// --- 2. Receipt Scanning (Vision) ---
export const analyzeReceipt = async (base64Data: string): Promise<Partial<Transaction> | null> => {
  try {
    const res = await fetch('/api/gemini/receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Data }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Receipt scan failed (${res.status})`);
    }

    const data = await res.json();
    return data || null;
  } catch (e) {
    console.warn("Receipt analysis notice:", e);
    return null;
  }
};

// --- 3. Image Generation (Goals & Vision Concept Visuals) ---
export interface GeneratedVisualResult {
  imageUrl: string | null;
  format?: 'raster' | 'vector-fallback';
  mode?: 'ai-raster' | 'ai-vector-fallback' | 'offline-vector-fallback';
  statusMessage?: string;
  provider?: string;
  model?: string;
}

export const fetchPublicAiImageConfig = async (): Promise<AiImageConfig | null> => {
  try {
    const res = await fetch('/api/ai/image-config/public');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

export const startImageRenderJob = async (
  prompt: string,
  style: VisualStylePreset = 'auto',
  aspectRatio: VisualAspectRatio = '16:9'
): Promise<ImageRenderJobState> => {
  const res = await fetch('/api/gemini/image-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, style, aspectRatio }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.jobId) {
    throw new Error(data?.error || `Could not start image render (${res.status})`);
  }
  return data as ImageRenderJobState;
};

export const pollImageRenderJob = async (jobId: string): Promise<ImageRenderJobState> => {
  const res = await fetch(`/api/gemini/image-jobs/${encodeURIComponent(jobId)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.jobId) {
    throw new Error(data?.error || `Image status unavailable (${res.status})`);
  }
  return data as ImageRenderJobState;
};

export const triggerImageJobFallback = async (jobId: string): Promise<ImageRenderJobState> => {
  const res = await fetch(`/api/gemini/image-jobs/${encodeURIComponent(jobId)}/fallback`, {
    method: 'POST',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.jobId) {
    throw new Error(data?.error || `Fast visual match failed (${res.status})`);
  }
  return data as ImageRenderJobState;
};

export const cancelImageRenderJob = async (jobId: string): Promise<void> => {
  await fetch(`/api/gemini/image-jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  }).catch(() => {});
};

export const generateGoalVisualDetailed = async (
  prompt: string,
  style: VisualStylePreset = 'auto',
  aspectRatio: VisualAspectRatio = '16:9'
): Promise<GeneratedVisualResult> => {
  const res = await fetch('/api/gemini/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, style, aspectRatio }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || (!data.imageUrl && data.error)) {
    throw new Error(data.error || `Image generation failed (${res.status})`);
  }
  return {
    imageUrl: data.imageUrl || null,
    format: data.format,
    mode: data.mode,
    statusMessage: data.statusMessage,
    provider: data.provider,
    model: data.model,
  };
};

export const generateGoalImage = async (prompt: string): Promise<string | null> => {
  const res = await generateGoalVisualDetailed(prompt);
  return res.imageUrl;
};

// --- 4. Enhance Financial Prompt ---
export const enhanceFinancialPrompt = async (
  rawPrompt: string,
  style: VisualStylePreset = 'auto'
): Promise<string> => {
  const clean = rawPrompt.trim();
  try {
    const res = await fetch('/api/gemini/enhance-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawPrompt: clean, style }),
    });

    if (!res.ok) {
      return clean;
    }

    const data = await res.json();
    return data.text || clean;
  } catch (err) {
    console.warn("Enhance prompt notice:", err);
    return clean;
  }
};

// --- 5. Autonomous Financial Agent Automation (Balance Sheets, Audits, Analysis) ---
export const runFinanceAgentAutomation = async (
  taskType: 'balance_sheet' | 'cash_flow_audit' | 'tax_optimization' | 'ratios_analysis',
  financialContext: string
): Promise<string> => {
  const res = await fetch('/api/gemini/automation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskType, financialContext }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Automation request failed (${res.status})`);
  }
  return data.text || "Report compilation completed.";
};

// --- 6. TTS Voice ---
export const speakText = async (text: string): Promise<AudioBuffer | null> => {
  try {
    const res = await fetch('/api/gemini/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    if (data.audioBase64) {
      const binaryString = atob(data.audioBase64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      return await audioContext.decodeAudioData(bytes.buffer);
    }
    return null;
  } catch (e) {
    console.warn("TTS notice:", e);
    return null;
  }
};

// --- 7. Digital Invoice Generation & AI Customizer ---
export const generateInvoiceFromPrompt = async (
  prompt: string,
  preferredIndustry?: IndustryTheme
): Promise<Partial<Invoice> | null> => {
  try {
    const res = await fetch('/api/gemini/generate-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, preferredIndustry }),
    });

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Failed to generate invoice with AI notice:", err);
    return null;
  }
};

export const perfectInvoiceWithAI = async (
  currentInvoice: Partial<Invoice>,
  instructions?: string
): Promise<Partial<Invoice> | null> => {
  try {
    const res = await fetch('/api/gemini/perfect-invoice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentInvoice, instructions }),
    });

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Failed to perfect invoice with AI notice:", err);
    return null;
  }
};

// --- 8. Market Overview with Accurate UTC World Clocks & Major World Stock Exchanges ---
export const getInstantMarketBaseline = (): MarketData => {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const utcTimeVal = utcHours + utcMinutes / 60;
  const dayOfWeek = now.getUTCDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  const isNyseOpen = isWeekday && utcTimeVal >= 13.5 && utcTimeVal < 20.0;
  const isNseOpen = isWeekday && utcTimeVal >= 3.75 && utcTimeVal < 10.0;
  const isLseOpen = isWeekday && utcTimeVal >= 8.0 && utcTimeVal < 16.5;
  const isTokyoOpen = isWeekday && utcTimeVal >= 0.0 && utcTimeVal < 6.0;

  const marketStatus = [
    { region: 'US (NYSE / NASDAQ)', isOpen: isNyseOpen, time: '09:30 - 16:00 EST' },
    { region: 'India (NSE / BSE)', isOpen: isNseOpen, time: '09:15 - 15:30 IST' },
    { region: 'Europe (LSE / Euronext)', isOpen: isLseOpen, time: '08:00 - 16:30 GMT' },
    { region: 'Asia (Tokyo / HKEX)', isOpen: isTokyoOpen, time: '09:00 - 15:00 JST' },
  ];

  const indices = [
    { name: 'S&P 500', value: '5,864.67', change: '+0.40%', isPositive: true },
    { name: 'NASDAQ 100', value: '20,324.18', change: '+0.63%', isPositive: true },
    { name: 'NIFTY 50', value: '24,854.05', change: '+0.42%', isPositive: true },
    { name: 'BSE SENSEX', value: '81,224.75', change: '+0.27%', isPositive: true },
    { name: 'FTSE 100', value: '8,358.25', change: '-0.14%', isPositive: false },
    { name: 'NIKKEI 225', value: '38,981.75', change: '+0.18%', isPositive: true },
    { name: 'BITCOIN', value: '$68,450.00', change: '+1.92%', isPositive: true },
    { name: 'ETHEREUM', value: '$2,642.50', change: '+2.45%', isPositive: true },
  ];

  const listedCompanies: ListedCompany[] = [
    {
      ticker: 'SPY',
      name: 'SPDR S&P 500 ETF Trust',
      exchange: 'NYSE / NASDAQ',
      sector: 'Broad Market S&P 500 Index ETF',
      marketCap: '$595B',
      price: '$584.20',
      change: '+0.42%',
      isPositive: true,
      volume: '54.2M',
      peRatio: '27.8x',
      week52High: '$587.84',
      week52Low: '$409.21',
      headquarters: 'State Street Global Advisors, Boston, MA',
      ceo: 'Yie-Hsin Hung',
      description: 'The SPDR S&P 500 ETF Trust is the world’s largest and most traded ETF, mirroring the performance of the benchmark S&P 500 large-cap US equities index.',
      investorUrl: 'https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-500-etf-trust-spy',
      dividendYield: '1.22%'
    },
    {
      ticker: 'QQQ',
      name: 'Invesco QQQ Trust (Nasdaq-100 ETF)',
      exchange: 'NYSE / NASDAQ',
      sector: 'Technology & Large-Cap Innovation ETF',
      marketCap: '$292B',
      price: '$495.60',
      change: '+0.68%',
      isPositive: true,
      volume: '38.6M',
      peRatio: '31.4x',
      week52High: '$503.52',
      week52Low: '$350.20',
      headquarters: 'Invesco Capital Management, Downers Grove, IL',
      ceo: 'Andrew Schlossberg',
      description: 'Invesco QQQ tracks the Nasdaq-100 Index, giving targeted access to global technology leaders including Apple, Microsoft, Nvidia, Amazon, Alphabet and Meta.',
      investorUrl: 'https://www.invesco.com/qqq-etf/',
      dividendYield: '0.58%'
    },
    {
      ticker: 'AAPL',
      name: 'Apple Inc.',
      exchange: 'NYSE / NASDAQ',
      sector: 'Consumer Hardware & Intelligence',
      marketCap: '$3.54T',
      price: '$232.50',
      change: '+0.95%',
      isPositive: true,
      volume: '48.2M',
      peRatio: '34.8x',
      week52High: '$237.23',
      week52Low: '$165.67',
      headquarters: 'Cupertino, California, USA',
      ceo: 'Tim Cook',
      description: 'Designs, manufactures and markets smartphones, personal computers, tablets, wearables and cloud software services.',
      investorUrl: 'https://investor.apple.com',
      dividendYield: '0.43%'
    },
    {
      ticker: 'MSFT',
      name: 'Microsoft Corporation',
      exchange: 'NYSE / NASDAQ',
      sector: 'Enterprise Cloud & AI Platforms',
      marketCap: '$3.24T',
      price: '$435.20',
      change: '+0.65%',
      isPositive: true,
      volume: '22.1M',
      peRatio: '36.2x',
      week52High: '$468.35',
      week52Low: '$366.50',
      headquarters: 'Redmond, Washington, USA',
      ceo: 'Satya Nadella',
      description: 'Develops and licenses mission-critical operating systems, productivity suites, Azure cloud computing and enterprise intelligence.',
      investorUrl: 'https://www.microsoft.com/en-us/investor',
      dividendYield: '0.71%'
    },
    {
      ticker: 'NVDA',
      name: 'NVIDIA Corporation',
      exchange: 'NYSE / NASDAQ',
      sector: 'Accelerated Compute & Silicon Architectures',
      marketCap: '$3.35T',
      price: '$138.40',
      change: '+2.15%',
      isPositive: true,
      volume: '62.4M',
      peRatio: '61.4x',
      week52High: '$140.76',
      week52Low: '$45.10',
      headquarters: 'Santa Clara, California, USA',
      ceo: 'Jensen Huang',
      description: 'Pioneers GPU accelerated computing, tensor core architectures, CUDA software ecosystem and autonomous networking fabrics.',
      investorUrl: 'https://investor.nvidia.com',
      dividendYield: '0.03%'
    },
    {
      ticker: 'GOOGL',
      name: 'Alphabet Inc.',
      exchange: 'NYSE / NASDAQ',
      sector: 'Global Search, Cloud & Systems',
      marketCap: '$2.18T',
      price: '$178.60',
      change: '+0.48%',
      isPositive: true,
      volume: '18.9M',
      peRatio: '24.3x',
      week52High: '$191.75',
      week52Low: '$129.40',
      headquarters: 'Mountain View, California, USA',
      ceo: 'Sundar Pichai',
      description: 'Global technology holding company operating Google search, YouTube, Android, Google Cloud infrastructure and frontier research.',
      investorUrl: 'https://abc.xyz/investor',
      dividendYield: '0.45%'
    },
    {
      ticker: 'AMZN',
      name: 'Amazon.com Inc.',
      exchange: 'NYSE / NASDAQ',
      sector: 'Hyperscale Cloud & Commerce',
      marketCap: '$1.98T',
      price: '$192.40',
      change: '+1.15%',
      isPositive: true,
      volume: '31.5M',
      peRatio: '43.8x',
      week52High: '$201.20',
      week52Low: '$118.35',
      headquarters: 'Seattle, Washington, USA',
      ceo: 'Andy Jassy',
      description: 'Operates Amazon Web Services (AWS) infrastructure, retail marketplaces, logistics robotics and digital advertising platforms.',
      investorUrl: 'https://ir.aboutamazon.com',
      dividendYield: '0.00%'
    },
    {
      ticker: 'META',
      name: 'Meta Platforms Inc.',
      exchange: 'NYSE / NASDAQ',
      sector: 'Interactive Media & Open Models',
      marketCap: '$1.48T',
      price: '$582.10',
      change: '+1.70%',
      isPositive: true,
      volume: '14.2M',
      peRatio: '28.5x',
      week52High: '$602.95',
      week52Low: '$279.40',
      headquarters: 'Menlo Park, California, USA',
      ceo: 'Mark Zuckerberg',
      description: 'Builds social connectivity technologies, family of apps (Instagram, WhatsApp), Llama open model architectures and Reality Labs.',
      investorUrl: 'https://investor.atmeta.com',
      dividendYield: '0.34%'
    },
    {
      ticker: 'TSLA',
      name: 'Tesla Inc.',
      exchange: 'NYSE / NASDAQ',
      sector: 'Autonomous Mobility & Stationary Energy',
      marketCap: '$745B',
      price: '$234.50',
      change: '-0.75%',
      isPositive: false,
      volume: '58.7M',
      peRatio: '68.2x',
      week52High: '$271.00',
      week52Low: '$138.80',
      headquarters: 'Austin, Texas, USA',
      ceo: 'Elon Musk',
      description: 'Designs electric vehicles, Megapack energy storage batteries, solar roof installations and autonomous driving neural networks.',
      investorUrl: 'https://ir.tesla.com',
      dividendYield: '0.00%'
    },
    {
      ticker: 'RELIANCE',
      name: 'Reliance Industries Limited',
      exchange: 'NSE / BSE',
      sector: 'Energy Transition, Retail & 5G Telecom',
      marketCap: '₹20.45 Lakh Cr',
      price: '3,015.40 ₹',
      change: '+0.85%',
      isPositive: true,
      volume: '7.8M',
      peRatio: '28.2x',
      week52High: '3,217.90 ₹',
      week52Low: '2,220.30 ₹',
      headquarters: 'Mumbai, Maharashtra, India',
      ceo: 'Mukesh Ambani',
      description: 'Largest private sector conglomerate in India spanning hydrocarbon refining, petrochemicals, Jio digital networks and Reliance Retail.',
      investorUrl: 'https://www.ril.com/investors',
      dividendYield: '0.33%'
    },
    {
      ticker: 'TCS',
      name: 'Tata Consultancy Services',
      exchange: 'NSE / BSE',
      sector: 'Digital Transformation & Global IT Systems',
      marketCap: '₹15.35 Lakh Cr',
      price: '4,240.00 ₹',
      change: '+0.65%',
      isPositive: true,
      volume: '2.1M',
      peRatio: '31.4x',
      week52High: '4,585.90 ₹',
      week52Low: '3,313.00 ₹',
      headquarters: 'Mumbai, Maharashtra, India',
      ceo: 'K. Krithivasan',
      description: 'Global leader in IT consulting and business solutions operating across 55 countries, with enterprise clients in banking, retail and manufacturing.',
      investorUrl: 'https://www.tcs.com/investor-relations',
      dividendYield: '1.30%'
    },
    {
      ticker: 'HDFCBANK',
      name: 'HDFC Bank Limited',
      exchange: 'NSE / BSE',
      sector: 'Commercial, Retail & Digital Banking',
      marketCap: '₹13.10 Lakh Cr',
      price: '1,710.50 ₹',
      change: '+0.50%',
      isPositive: true,
      volume: '11.4M',
      peRatio: '19.5x',
      week52High: '1,794.00 ₹',
      week52Low: '1,363.55 ₹',
      headquarters: 'Mumbai, Maharashtra, India',
      ceo: 'Sashidhar Jagdishan',
      description: 'Premier private sector banking institution in India providing wholesale, retail, treasury and digital payment infrastructure.',
      investorUrl: 'https://www.hdfcbank.com/personal/investor-relations',
      dividendYield: '1.14%'
    },
    {
      ticker: 'INFY',
      name: 'Infosys Limited',
      exchange: 'NSE / BSE',
      sector: 'Enterprise Software & Cloud Consulting',
      marketCap: '₹8.15 Lakh Cr',
      price: '1,945.00 ₹',
      change: '+1.10%',
      isPositive: true,
      volume: '5.9M',
      peRatio: '27.8x',
      week52High: '1,991.45 ₹',
      week52Low: '1,358.35 ₹',
      headquarters: 'Bengaluru, Karnataka, India',
      ceo: 'Salil Parekh',
      description: 'Global software major delivering digital agile services, Topaz generative solutions and enterprise business process transformations.',
      investorUrl: 'https://www.infosys.com/investors.html',
      dividendYield: '2.36%'
    },
    {
      ticker: 'ZOMATO',
      name: 'Eternal Limited (formerly Zomato Ltd.)',
      exchange: 'NSE / BSE',
      sector: 'Consumer Internet & Quick Commerce (Blinkit, Zomato, Hyperpure, District)',
      marketCap: '₹2.42 Lakh Cr',
      price: '264.80 ₹',
      change: '+1.65%',
      isPositive: true,
      volume: '34.2M',
      peRatio: '86.2x',
      week52High: '298.20 ₹',
      week52Low: '102.50 ₹',
      headquarters: 'Gurugram, Haryana, India',
      ceo: 'Deepinder Goyal',
      description: 'Parent holding conglomerate (Eternal) operating four distinct business divisions: Zomato (food delivery & discovery), Blinkit (10-minute quick commerce), Hyperpure (B2B restaurant supply chain) and District (live ticketing and dining-out events).',
      investorUrl: 'https://www.zomato.com/investor-relations',
      dividendYield: '0.00%'
    }
  ];

  const defaultNews: MarketNewsItem[] = [
    {
      title: 'Global Central Banks Coordinate Liquidity Frameworks Amid Rate Easing Cycle',
      source: 'Reuters',
      summary: 'Monetary authorities review real-time CPI prints and labor dynamics as multi-national easing protocols take effect across developed and emerging market sovereign bonds.',
      category: 'Macroeconomics',
      timeAgo: '12m ago',
      url: 'https://www.reuters.com/markets/',
      impact: 'MACRO',
      sentiment: 'NEUTRAL'
    },
    {
      title: 'High-Bandwidth Memory & CoWoS Packaging Orders Surge into Next Fiscal Quarter',
      source: 'Bloomberg',
      summary: 'Hyperscalers accelerate multi-billion dollar capital expenditure cycles for next-generation compute architectures and high-density datacenter clusters.',
      category: 'Technology',
      timeAgo: '28m ago',
      url: 'https://www.bloomberg.com/markets',
      impact: 'HIGH',
      sentiment: 'BULLISH'
    },
    {
      title: 'Indian Stock Exchanges Reach Milestone Capitalization as Domestic Institutional Flows Expand',
      source: 'Mint',
      summary: 'NSE and BSE equity indices demonstrate steady breadth supported by domestic systematic investment inflows and capital goods capacity investments.',
      category: 'India Equities',
      timeAgo: '45m ago',
      url: 'https://www.livemint.com/market',
      impact: 'HIGH',
      sentiment: 'BULLISH'
    }
  ];

  return {
    indices,
    listedCompanies,
    news: defaultNews,
    marketStatus,
  };
};

export const fetchMarketSnapshot = async (): Promise<MarketData | null> => {
  try {
    const res = await fetch('/api/markets/snapshot');
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Market snapshot fetch error:", err);
    return null;
  }
};

export const fetchLiveMarketNews = async (): Promise<MarketNewsItem[] | null> => {
  try {
    const res = await fetch('/api/gemini/market-news');
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.news) && data.news.length > 0 ? data.news : null;
  } catch (err) {
    console.warn("Live news stream fetch error:", err);
    return null;
  }
};

export const getMarketOverview = async (): Promise<MarketData> => {
  const live = await fetchMarketSnapshot();
  return live || getInstantMarketBaseline();
};

export const searchFinancialNews = async (query: string): Promise<MarketData['news']> => {
  try {
    const res = await fetch('/api/gemini/search-news', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.news) ? data.news : [];
  } catch (err) {
    console.warn("News search notice:", err);
    return [];
  }
};

export const searchCompanyTicker = async (query: string): Promise<ListedCompany | null> => {
  try {
    const res = await fetch('/api/gemini/search-ticker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("Company search notice:", err);
    return null;
  }
};

export const searchGlobalCompanyQuote = async (companyOrTicker: string): Promise<ListedCompany | null> => {
  return searchCompanyTicker(companyOrTicker);
};