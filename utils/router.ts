import { WindowId } from '../types';

export interface WindowRouteMeta {
  id: WindowId;
  path: string;
  label: string;
  shortLabel: string;
  title: string;
  description: string;
  isPublicSeo: boolean;
}

export const WINDOW_ROUTES: Record<WindowId, WindowRouteMeta> = {
  home: {
    id: 'home',
    path: '/',
    label: 'Home',
    shortLabel: 'Home',
    title: 'Liddy — Everyday Money, Investments & Smart Workspace',
    description:
      'Manage your personal expenses, track your stock portfolio, create formatted invoices with UPI links, follow live market news, collaborate in video rooms, and talk to your AI Finance Agent.',
    isPublicSeo: true,
  },
  overview: {
    id: 'overview',
    path: '/workspace/overview',
    label: 'Daily Overview',
    shortLabel: 'Overview',
    title: 'Personal Expenses, Stock Portfolio & Invoices | Liddy',
    description:
      'Track where you spend your money, update your connected stock broking balance, and manage digital invoices in one clear workspace.',
    isPublicSeo: true,
  },
  invoices: {
    id: 'invoices',
    path: '/workspace/invoices',
    label: 'Invoices & UPI Pay',
    shortLabel: 'Invoices',
    title: 'Multi-Format Digital Invoices & UPI QR | Liddy',
    description:
      'Create, preview, and export formatted invoices in A4, US Letter, and 80mm Thermal sizes with instant UPI QR pay links and email delivery.',
    isPublicSeo: true,
  },
  scanner: {
    id: 'scanner',
    path: '/workspace/scanner',
    label: 'Receipt Scanner & Expenses',
    shortLabel: 'Expenses',
    title: 'Receipt Capture & Personal Expense Ledger | Liddy',
    description:
      'Snap or upload bills and receipts to extract merchant, date, amount, and personal spending categories automatically.',
    isPublicSeo: true,
  },
  markets: {
    id: 'markets',
    path: '/workspace/markets',
    label: 'Live Markets & News',
    shortLabel: 'Markets & News',
    title: 'Live Global Markets, Stocks & Financial News Wire | Liddy',
    description:
      'Live streaming stock quotes and financial news headlines across US, India, Europe, Asia, and digital assets.',
    isPublicSeo: true,
  },
  agent: {
    id: 'agent',
    path: '/workspace/agent',
    label: 'AI Finance Agent',
    shortLabel: 'AI Agent',
    title: 'Liddy AI Finance Agent — Everyday Money, Investing & Voice | Liddy',
    description:
      'Ask questions across personal budgeting, stock portfolios, uploaded bills, taxes, and integrated hands-free voice briefings.',
    isPublicSeo: true,
  },
  vision: {
    id: 'vision',
    path: '/workspace/vision',
    label: 'Vision & Video Studio',
    shortLabel: 'Vision Studio',
    title: 'Vision Studio — Mind Maps, Slide Decks & Video Rooms | Liddy',
    description:
      'Collaborate in live HD video conferencing rooms, build interactive mind maps, and export structured PowerPoint & PDF presentations.',
    isPublicSeo: true,
  },
  pricing: {
    id: 'pricing',
    path: '/workspace/pricing',
    label: 'Plans & Checkout',
    shortLabel: 'Pricing',
    title: 'Pricing — Starter Free, Liddy Pro & Team Plan | Liddy',
    description:
      'Start free forever or upgrade via verified UPI, cards, or digital wallets with Liddy Pro and Team Plan.',
    isPublicSeo: true,
  },
  settings: {
    id: 'settings',
    path: '/workspace/settings',
    label: 'Workspace Settings',
    shortLabel: 'Settings',
    title: 'Workspace Settings, Currency & Localization | Liddy',
    description:
      'Customize light or dark appearance, 20+ languages, regional currency formatting, and cloud sync controls.',
    isPublicSeo: true,
  },
  profile: {
    id: 'profile',
    path: '/workspace/profile',
    label: 'Account & Plan',
    shortLabel: 'Account',
    title: 'Account, Cloud Sync & Subscription | Liddy',
    description:
      'Manage your Liddy cloud sync, email receipt delivery, display identity, and subscription plan.',
    isPublicSeo: true,
  },
  admin: {
    id: 'admin',
    path: '/admin',
    label: 'Platform Admin Console',
    shortLabel: 'Admin',
    title: 'Liddy Admin Console — Metrics, Security, Users & Payments',
    description: 'Isolated platform administration portal.',
    isPublicSeo: false,
  },
};

export const WORKSPACE_SWITCHER_WINDOWS: WindowId[] = [
  'overview',
  'invoices',
  'scanner',
  'markets',
  'agent',
  'vision',
  'pricing',
];

export function parsePathToWindow(pathname: string): WindowId {
  const normalized = (pathname || '/').replace(/\/+$/, '') || '/';
  if (normalized === '/workspace/voice') return 'agent';

  const entries = Object.values(WINDOW_ROUTES);
  const exact = entries.find((r) => r.path === normalized);
  if (exact) return exact.id;

  if (normalized === '/workspace') return 'overview';
  if (normalized.startsWith('/admin')) return 'admin';
  return 'home';
}

export function windowToPath(windowId: WindowId): string {
  return WINDOW_ROUTES[windowId]?.path || '/';
}
