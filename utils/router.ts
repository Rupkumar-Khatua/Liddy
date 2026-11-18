import { PaymentRegion, WindowId } from '../types';

export interface WindowRouteMeta {
  id: WindowId;
  path: string;
  label: string;
  shortLabel: string;
  title: string;
  description: string;
}

export const REGION_PREFIX_MAP: Record<PaymentRegion, '/in' | '/intl'> = {
  IN: '/in',
  INTL: '/intl',
};

export const WINDOW_ROUTES: Record<WindowId, WindowRouteMeta> = {
  home: {
    id: 'home',
    path: '/',
    label: 'Liddy Home',
    shortLabel: 'Home',
    title: 'Liddy — Personal Finance, Invoices, Live Markets & AI Studio',
    description:
      'Manage your personal expenses, track your stock portfolio, create formatted digital invoices, follow live market news, collaborate in video rooms and talk to your AI Finance Agent.',
  },
  overview: {
    id: 'overview',
    path: '/workspace/dashboard',
    label: 'Dashboard & Portfolio',
    shortLabel: 'Dashboard',
    title: 'Financial Dashboard & Stock Portfolio | Liddy',
    description:
      'See where your money went, manage daily spends, connect your stock broking portfolio balance and stay on top of bills in real time.',
  },
  expenses: {
    id: 'expenses',
    path: '/workspace/expenses',
    label: 'Daily Expenses',
    shortLabel: 'Expenses',
    title: 'Daily Expenses & Spending Categories | Liddy',
    description:
      'Review where your money went by category, log daily digital or cash spends and filter your personal ledger.',
  },
  invoices: {
    id: 'invoices',
    path: '/workspace/invoices',
    label: 'Invoices & Bills',
    shortLabel: 'Invoices',
    title: 'Clean Swiss Paper Invoices & Bill-to-Digital Studio | Liddy',
    description:
      'Generate crisp Swiss Paper invoices across A4, US Letter and 80mm thermal sizes or convert handwritten paper bills into editable digital documents.',
  },
  scanner: {
    id: 'scanner',
    path: '/workspace/scan-bill',
    label: 'Scan Paper Bill',
    shortLabel: 'Scan Bill',
    title: 'Paper Bill & Receipt OCR to Digital Template | Liddy',
    description:
      'Snap any printed or handwritten paper bill to extract itemized lines, taxes and totals straight into clean digital invoice templates.',
  },
  markets: {
    id: 'markets',
    path: '/workspace/markets',
    label: 'Market News & Stocks',
    shortLabel: 'Markets',
    title: 'Live Global Financial News Wire & Stock Tracker | Liddy',
    description:
      'Follow verified financial news, global indices, NSE/NYSE stock quotes and live headline feeds.',
  },
  agent: {
    id: 'agent',
    path: '/workspace/ai-agent',
    label: 'Liddy AI & Voice',
    shortLabel: 'AI Agent',
    title: 'Liddy AI Chief Financial Officer & Voice Advisor | Liddy',
    description:
      'Chat or speak live with your personal finance agent to organize spending, extract bills, generate CSV/PDF dashboards and analyze markets.',
  },
  vision: {
    id: 'vision',
    path: '/workspace/vision-studio',
    label: 'Vision Studio',
    shortLabel: 'Vision Studio',
    title: 'Vision Studio — Financial Goals, Mind Maps & Slides | Liddy',
    description:
      'Visualize your financial goals, map budgets on shared mind-map boards, generate structured financial slide decks and collaborate over live HD video calls.',
  },
  pricing: {
    id: 'pricing',
    path: '/pricing',
    label: 'Plans & Billing',
    shortLabel: 'Pricing',
    title: 'Starter Free, 1-Day Pass & Pro Plans | Liddy',
    description:
      'Start free with 5 AI & Studio tries or unlock unlimited access via 1-Day Pass, Monthly or Yearly regional plans.',
  },
  settings: {
    id: 'settings',
    path: '/workspace/settings',
    label: 'Settings',
    shortLabel: 'Settings',
    title: 'Workspace Preferences & Receiving Settings | Liddy',
    description:
      'Customize currency, display language, accessibility contrast and receiving payment details for your invoices.',
  },
  profile: {
    id: 'profile',
    path: '/workspace/account',
    label: 'My Account',
    shortLabel: 'Account',
    title: 'Account & Plan Management | Liddy',
    description:
      'Manage your Liddy cloud sync, connected profile, active pass status and billing history.',
  },
  admin: {
    id: 'admin',
    path: '/admin',
    label: 'Platform Operations',
    shortLabel: 'Admin',
    title: 'Platform Operations Console | Liddy',
    description:
      'Monitor platform revenue, users, payment gateways, design assets, API telemetry and system incidents.',
  },
};

export const WORKSPACE_SWITCHER_WINDOWS: WindowId[] = [
  'overview',
  'expenses',
  'invoices',
  'markets',
  'agent',
  'vision',
  'pricing',
];

export function parseRegionFromPath(pathname: string): PaymentRegion | null {
  const clean = (pathname || '/').trim().toLowerCase();
  if (clean === '/in' || clean.startsWith('/in/')) return 'IN';
  if (clean === '/intl' || clean.startsWith('/intl/')) return 'INTL';
  return null;
}

export function stripRegionPrefix(pathname: string): string {
  const clean = (pathname || '/').trim();
  const lower = clean.toLowerCase();
  if (lower === '/in' || lower === '/intl') return '/';
  if (lower.startsWith('/in/')) return clean.slice(3) || '/';
  if (lower.startsWith('/intl/')) return clean.slice(5) || '/';
  return clean || '/';
}

export function withRegionPrefix(basePath: string, region: PaymentRegion): string {
  const stripped = stripRegionPrefix(basePath);
  // Keep /admin standalone without region prefix
  if (stripped === '/admin' || stripped.startsWith('/admin/')) {
    return '/admin';
  }
  const prefix = REGION_PREFIX_MAP[region] || '/intl';
  if (stripped === '/' || stripped === '') {
    return prefix;
  }
  return `${prefix}${stripped.startsWith('/') ? stripped : `/${stripped}`}`;
}

export function getWindowRouteMeta(windowId: WindowId, region: PaymentRegion = 'INTL'): WindowRouteMeta {
  const base = WINDOW_ROUTES[windowId] || WINDOW_ROUTES.home;
  const localizedPath = windowId === 'admin' ? '/admin' : withRegionPrefix(base.path, region);

  if (windowId === 'home') {
    return {
      ...base,
      path: localizedPath,
      description:
        region === 'IN'
          ? 'Manage personal expenses in INR, track your stock portfolio, create GST invoices with UPI QR links, follow live NSE/BSE news and work with your AI Finance Agent.'
          : 'Manage personal expenses in USD, track your stock portfolio, create formatted international invoices with PayPal checkout, follow live global market news and work with your AI Finance Agent.',
    };
  }
  if (windowId === 'expenses') {
    return {
      ...base,
      path: localizedPath,
      description:
        region === 'IN'
          ? 'Review where your money went by category, log daily UPI, card or cash spends in INR and filter your personal ledger.'
          : 'Review where your money went by category, log daily card, PayPal or cash spends in USD and filter your personal ledger.',
    };
  }
  if (windowId === 'invoices') {
    return {
      ...base,
      path: localizedPath,
      description:
        region === 'IN'
          ? 'Generate crisp Swiss Paper invoices across A4, Letter and 80mm POS sizes with instant UPI QR settlement or scan handwritten bills.'
          : 'Generate crisp Swiss Paper invoices across A4, US Letter and 80mm POS sizes with PayPal settlement or scan paper bills.',
    };
  }
  if (windowId === 'pricing') {
    return {
      ...base,
      path: localizedPath,
      description:
        region === 'IN'
          ? 'Start free with 5 AI & Studio tries or unlock unlimited access for ₹49 Day Pass, ₹149/mo or ₹999/yr via instant UPI.'
          : 'Start free with 5 AI & Studio tries or unlock unlimited access for $2 Day Pass, $9/mo or $20/yr via PayPal.',
    };
  }

  return {
    ...base,
    path: localizedPath,
  };
}

export function parseRoomCodeFromLocation(pathname: string, search = '', hash = ''): string | null {
  const cleanPath = stripRegionPrefix(pathname).replace(/\/+$/, '');
  const joinMatch = cleanPath.match(/^\/join\/([A-Za-z0-9_-]{3,40})$/i);
  if (joinMatch?.[1]) {
    return joinMatch[1].toUpperCase();
  }
  const params = new URLSearchParams(search || '');
  const qRoom = params.get('room');
  if (qRoom && qRoom.trim()) {
    return qRoom.trim().toUpperCase().slice(0, 40);
  }
  if (hash && hash.includes('room=')) {
    const hParams = new URLSearchParams(hash.replace(/^#/, ''));
    const hRoom = hParams.get('room');
    if (hRoom && hRoom.trim()) return hRoom.trim().toUpperCase().slice(0, 40);
  }
  return null;
}

export function parsePathToWindow(pathname: string, search = '', hash = ''): WindowId {
  const clean = stripRegionPrefix(pathname).replace(/\/+$/, '').toLowerCase() || '/';
  if (clean.startsWith('/join/') || parseRoomCodeFromLocation(pathname, search, hash)) {
    return 'vision';
  }
  if (clean === '/workspace/voice') {
    return 'agent';
  }
  for (const meta of Object.values(WINDOW_ROUTES)) {
    if (meta.path.toLowerCase() === clean) {
      return meta.id;
    }
  }
  return 'home';
}

export function windowToPath(windowId: WindowId, region?: PaymentRegion): string {
  const basePath = WINDOW_ROUTES[windowId]?.path || '/';
  if (!region || windowId === 'admin') {
    return basePath;
  }
  return withRegionPrefix(basePath, region);
}

export function syncDocumentSeo(windowId: WindowId, region: PaymentRegion = 'INTL') {
  if (typeof document === 'undefined') return;
  const meta = getWindowRouteMeta(windowId, region);
  document.title = meta.title;

  const setMeta = (selector: string, content: string) => {
    const el = document.querySelector(selector);
    if (el) el.setAttribute('content', content);
  };

  setMeta('meta[name="description"]', meta.description);
  setMeta('meta[property="og:title"]', meta.title);
  setMeta('meta[property="og:description"]', meta.description);
  setMeta('meta[name="twitter:title"]', meta.title);
  setMeta('meta[name="twitter:description"]', meta.description);
}
