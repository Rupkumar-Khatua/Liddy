import React, { useState } from 'react';
import { WindowId } from '../types';
import { STUDIO_MEDIA } from '../src/assets/studioMedia';
import { useFinMind } from '../context/FinMindContext';
import { TopNavbar } from './TopNavbar';
import { SystemFooter } from './SystemFooter';
import { AdSlot } from './AdSlot';

interface LandingPageProps {
  onNavigateWindow: (windowId: WindowId) => void;
}

const getFeatureStripItems = (paymentRegion: 'IN' | 'INTL'): Array<{
  num: string;
  windowId: WindowId;
  title: string;
  meta: string;
  summary: string;
  accentGradient: string;
}> => {
  const isIndia = paymentRegion === 'IN';
  return [
    {
      num: '01',
      windowId: 'overview',
      title: 'Daily Money Overview',
      meta: 'Expenses · Stocks · Bills',
      summary: 'See every personal expense, your connected stock broker balance and pending invoices side by side.',
      accentGradient: 'from-indigo-500 to-violet-500',
    },
    {
      num: '02',
      windowId: 'invoices',
      title: 'Swiss Invoice & Bill Studio',
      meta: '5 Templates · Bill OCR',
      summary: '5 Clean Swiss Paper templates, A4/Letter/80mm print and paper-to-digital bill OCR.',
      accentGradient: 'from-emerald-500 to-teal-500',
    },
    {
      num: '03',
      windowId: 'expenses',
      title: 'Personal Expenses',
      meta: 'Where You Spent What',
      summary: isIndia
        ? 'Categorize daily cash, card and UPI spending cleanly inside your personal ledger.'
        : 'Categorize daily cash, card and PayPal spending cleanly inside your personal ledger.',
      accentGradient: 'from-sky-500 to-cyan-500',
    },
    {
      num: '04',
      windowId: 'markets',
      title: 'Live Market & News Wire',
      meta: 'Global Streaming',
      summary: 'Breaking financial headlines, interest rate updates and live US & India stock quotes.',
      accentGradient: 'from-amber-500 to-orange-500',
    },
    {
      num: '05',
      windowId: 'agent',
      title: 'Liddy AI Guide',
      meta: 'Chat · Agent · Voice',
      summary: 'Ask budgeting, stock, bill or tax questions by chat, autonomous financial tools or voice.',
      accentGradient: 'from-fuchsia-500 to-indigo-500',
    },
    {
      num: '06',
      windowId: 'vision',
      title: 'Vision Studio & Video',
      meta: 'Mind Map · HTML Decks · Call',
      summary: 'Host live video rooms, map ideas freely and export interactive .html slide decks.',
      accentGradient: 'from-rose-500 to-pink-500',
    },
    {
      num: '07',
      windowId: 'pricing',
      title: isIndia ? 'India Access Plans' : 'Global Access Plans',
      meta: isIndia ? '₹49 · ₹149 · ₹999' : '$2 · $9 · $20',
      summary: isIndia
        ? 'Free dashboard with 5 AI tries, ₹49 Day Pass, ₹149/mo or ₹999/yr via instant UPI.'
        : 'Free dashboard with 5 AI tries, $2 Day Pass, $9/mo or $20/yr via PayPal.',
      accentGradient: 'from-violet-500 to-purple-500',
    },
  ];
};

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigateWindow }) => {
  const { planTier, paymentRegion } = useFinMind();
  const isIndia = paymentRegion === 'IN';
  const featureStripItems = getFeatureStripItems(paymentRegion);
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [invImgFailed, setInvImgFailed] = useState(false);
  const [newsImgFailed, setNewsImgFailed] = useState(false);
  const [avatarImgFailed, setAvatarImgFailed] = useState(false);

  return (
    <div className="min-h-screen w-full bg-[#F6F6F4] dark:bg-[#09090B] text-neutral-900 dark:text-neutral-100 transition-colors duration-200 flex flex-col">
      <TopNavbar onNavigateWindow={onNavigateWindow} />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-16 space-y-20 md:space-y-24">
        {/* ================= 1. EDITORIAL HERO SPLIT ================= */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
            <p className="text-xs font-mono uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400 font-semibold">
              Your Everyday Daily Financial Companion
            </p>

            <h1 className="text-4xl sm:text-5xl lg:text-[54px] font-extrabold tracking-tight leading-[1.06] text-neutral-900 dark:text-white">
              One calm place for daily expenses, stocks and bills.
            </h1>

            <p className="text-base sm:text-lg text-neutral-600 dark:text-neutral-300 leading-relaxed max-w-xl">
              {isIndia
                ? 'Track everyday spending, follow live markets, issue ready-to-print invoices with UPI QR links and collaborate in live video rooms.'
                : 'Track everyday spending, follow live markets, issue ready-to-print invoices with PayPal links and collaborate in live video rooms.'}
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              <button
                type="button"
                onClick={() => onNavigateWindow('overview')}
                className="px-6 py-3.5 rounded-2xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-950 text-sm font-bold transition-all cursor-pointer shadow-sm whitespace-nowrap shrink-0"
              >
                Open Daily Workspace &rarr;
              </button>
            </div>
          </div>

          <div className="lg:col-span-6 flex">
            <div className="w-full rounded-[28px] overflow-hidden border border-neutral-200/90 dark:border-neutral-800 bg-neutral-900 shadow-lg relative min-h-[300px] sm:min-h-[380px]">
              {!heroImgFailed ? (
                <img
                  src={STUDIO_MEDIA.heroFounderWorkspace}
                  alt="Modern desk showing personal expenses, stock portfolio, invoices and live market news"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-neutral-900 via-indigo-950 to-neutral-900 flex items-center justify-center p-8 text-white">
                  <span className="text-xl font-bold">Liddy Personal Finance</span>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent flex items-end p-6">
                <div className="w-full flex flex-wrap items-center justify-between gap-3 text-white">
                  <div>
                    <p className="text-xs font-mono text-sky-300">All-In-One Daily Workspace</p>
                    <p className="text-sm font-bold">Expenses · Stock Portfolio · Invoicing · News Wire</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onNavigateWindow('markets')}
                    className="px-4 py-2 rounded-xl bg-white text-neutral-950 text-xs font-bold hover:bg-neutral-100 cursor-pointer"
                  >
                    Live Markets &rarr;
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ================= 2. AUTO-SCROLLING FEATURE SHOWCASE ================= */}
        <section
          aria-label="Platform capabilities strip"
          className="rounded-[32px] border border-neutral-200/90 dark:border-white/10 bg-white/70 dark:bg-neutral-950/70 backdrop-blur-md p-5 sm:p-7 space-y-5 shadow-soft"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-indigo-600 dark:text-sky-400 font-bold">
                Everything Inside Liddy · Hover to Pause
              </p>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-neutral-900 dark:text-white">
                Click any tool to jump straight in
              </h2>
            </div>
            <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
              7 Integrated Daily Tools
            </span>
          </div>

          <div className="feature-marquee-shell overflow-hidden relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-[#FAF9F6] dark:from-[#0B0B0F] to-transparent z-10 hidden sm:block" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[#FAF9F6] dark:from-[#0B0B0F] to-transparent z-10 hidden sm:block" />

            <div className="feature-marquee-track gap-4 pr-4">
              {[0, 1].map((passIndex) => (
                <div
                  key={passIndex}
                  aria-hidden={passIndex === 1}
                  className="flex items-stretch gap-4 shrink-0"
                >
                  {featureStripItems.map((item) => (
                    <button
                      key={`${passIndex}-${item.windowId}`}
                      type="button"
                      tabIndex={passIndex === 1 ? -1 : 0}
                      onClick={() => onNavigateWindow(item.windowId)}
                      className="w-[275px] sm:w-[300px] shrink-0 text-left rounded-2xl border border-neutral-200/90 dark:border-white/10 bg-white dark:bg-[#13141B] hover:border-indigo-500 dark:hover:border-sky-400 hover:-translate-y-0.5 transition-all cursor-pointer group overflow-hidden flex flex-col justify-between shadow-xs"
                    >
                      <div className={`h-1.5 w-full bg-gradient-to-r ${item.accentGradient}`} />
                      <div className="p-5 space-y-2.5 flex-1 flex flex-col justify-between">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
                            <span className="font-bold text-neutral-800 dark:text-neutral-200">{item.num}</span>
                            <span>{item.meta}</span>
                          </div>
                          <h3 className="text-base font-extrabold text-neutral-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-sky-400 transition-colors">
                            {item.title}
                          </h3>
                          <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                            {item.summary}
                          </p>
                        </div>

                        <div className="pt-2 border-t border-neutral-100 dark:border-white/5 flex items-center justify-between">
                          <span className="text-[11px] font-bold text-indigo-600 dark:text-sky-400">
                            Open Tool &rarr;
                          </span>
                          <svg
                            className="w-4 h-4 text-neutral-400 group-hover:text-indigo-500 dark:group-hover:text-sky-400 group-hover:translate-x-0.5 transition-all"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                          </svg>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ================= 3. ASYMMETRIC BENTO FEATURE GRID ================= */}
        <section className="space-y-8">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-mono uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400 font-semibold">
              Everyday Financial Clarity
            </p>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Daily spending, stock wealth and fast billing in one place.
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Large Bento Card: Multi-Format Invoicing */}
            <div
              onClick={() => onNavigateWindow('invoices')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onNavigateWindow('invoices')}
              className="lg:col-span-7 glass-card dark:bg-neutral-900/90 border border-neutral-200/80 dark:border-neutral-800 rounded-3xl overflow-hidden flex flex-col justify-between cursor-pointer group"
            >
              <div className="p-7 space-y-3">
                <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                  {isIndia ? 'Invoicing & UPI QR' : 'Invoicing & PayPal'}
                </p>
                <h3 className="text-2xl font-extrabold group-hover:text-indigo-600 dark:group-hover:text-sky-400 transition-colors">
                  Swiss Paper Invoices &amp; Bill-to-Digital Studio
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed max-w-xl">
                  Choose from 5 Clean Swiss Paper templates across A4, Letter and 80mm, or convert any paper bill via OCR into a downloadable digital invoice.
                </p>
                <span className="inline-block text-xs font-bold text-indigo-600 dark:text-sky-400 pt-1">
                  Open Invoices Studio &rarr;
                </span>
              </div>
              <div className="h-56 w-full overflow-hidden border-t border-neutral-200/70 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-950">
                {!invImgFailed ? (
                  <img
                    src={STUDIO_MEDIA.featureInvoicingDesk}
                    alt={isIndia ? 'Digital invoicing and UPI checkout workspace' : 'Digital invoicing and PayPal checkout workspace'}
                    referrerPolicy="no-referrer"
                    onError={() => setInvImgFailed(true)}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                  />
                ) : null}
              </div>
            </div>

            {/* Right Bento Card: Live Global Market News & Wire */}
            <div
              onClick={() => onNavigateWindow('markets')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onNavigateWindow('markets')}
              className="lg:col-span-5 bg-neutral-950 text-white border border-white/10 rounded-3xl overflow-hidden flex flex-col justify-between cursor-pointer group hover:border-sky-400/60 transition-all"
            >
              <div className="p-7 space-y-3">
                <p className="text-xs font-mono text-sky-400">Live Wire &amp; Intelligence</p>
                <h3 className="text-2xl font-extrabold">Global Financial News &amp; Market Wire</h3>
                <p className="text-sm text-neutral-300 leading-relaxed">
                  Stay ahead of earnings, central bank rate moves, macro news stories and real-time S&amp;P 500, NASDAQ, NIFTY 50 and SENSEX tickers.
                </p>
                <span className="inline-block text-xs font-bold text-sky-400 pt-1">
                  Read Market News &rarr;
                </span>
              </div>
              <div className="h-56 w-full overflow-hidden border-t border-white/10">
                {!newsImgFailed ? (
                  <img
                    src={STUDIO_MEDIA.featureVoiceAcoustics}
                    alt="Global financial intelligence and live news pulse sphere"
                    referrerPolicy="no-referrer"
                    onError={() => setNewsImgFailed(true)}
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                  />
                ) : null}
              </div>
            </div>

            {/* Secondary Bento Row */}
            <button
              type="button"
              onClick={() => onNavigateWindow('vision')}
              className="lg:col-span-4 glass-card dark:bg-neutral-900/90 border border-neutral-200/80 dark:border-neutral-800 rounded-3xl p-7 text-left space-y-3 cursor-pointer"
            >
              <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400">Mind Map · HTML Decks · Video</p>
              <h3 className="text-xl font-extrabold">Creative Studio &amp; Live Video Rooms</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                Map ideas freely on an expandable canvas, export interactive HTML slide decks and host live video calls.
              </p>
              <span className="inline-block text-xs font-bold text-indigo-600 dark:text-sky-400">
                Launch Studio &rarr;
              </span>
            </button>

            <button
              type="button"
              onClick={() => onNavigateWindow('expenses')}
              className="lg:col-span-4 glass-card dark:bg-neutral-900/90 border border-neutral-200/80 dark:border-neutral-800 rounded-3xl p-7 text-left space-y-3 cursor-pointer"
            >
              <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400">Personal Spending</p>
              <h3 className="text-xl font-extrabold">Where You Spent What</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                {isIndia
                  ? 'Track daily expenses across categories, inspect recurring bills and log manual cash or UPI payments anytime.'
                  : 'Track daily expenses across categories, inspect recurring bills and log manual cash, card or PayPal payments anytime.'}
              </p>
              <span className="inline-block text-xs font-bold text-indigo-600 dark:text-sky-400">
                Open Expenses &rarr;
              </span>
            </button>

            <button
              type="button"
              onClick={() => onNavigateWindow('agent')}
              className="lg:col-span-4 glass-card dark:bg-neutral-900/90 border border-neutral-200/80 dark:border-neutral-800 rounded-3xl p-7 text-left space-y-3 cursor-pointer"
            >
              <p className="text-xs font-mono text-neutral-500 dark:text-neutral-400">AI Copilot</p>
              <h3 className="text-xl font-extrabold">AI Finance &amp; Voice Guide</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                Review spending habits, analyze bank PDFs, plan savings targets or speak naturally with integrated voice mode.
              </p>
              <span className="inline-block text-xs font-bold text-indigo-600 dark:text-sky-400">
                Ask AI Agent &rarr;
              </span>
            </button>
          </div>
        </section>

        {/* ================= 4. NON-INTRUSIVE SPONSOR PLACEMENT ================= */}
        <AdSlot
          placementId="landing_mid_banner"
          onNavigateWindow={onNavigateWindow}
        />

        {/* ================= 5. USER PROOF + PLANS PREVIEW ================= */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-5 glass-card dark:bg-neutral-900/90 border border-neutral-200/80 dark:border-neutral-800 rounded-3xl p-7 flex flex-col justify-between gap-6">
            <p className="text-lg sm:text-xl font-semibold leading-snug text-neutral-900 dark:text-white">
              “Finally one clean dashboard that shows my daily expenses, Zerodha portfolio balance and pending bills without switching between five confusing finance apps.”
            </p>
            <div className="flex items-center gap-4 pt-4 border-t border-neutral-200/70 dark:border-neutral-800">
              {!avatarImgFailed ? (
                <img
                  src={STUDIO_MEDIA.avatarFounderPortrait}
                  alt="Ananya Rao, product designer and everyday investor"
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarImgFailed(true)}
                  className="w-12 h-12 rounded-2xl object-cover shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white font-bold flex items-center justify-center shrink-0">
                  AR
                </div>
              )}
              <div>
                <p className="text-sm font-bold text-neutral-900 dark:text-white">Ananya Rao</p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  Product Designer &amp; Daily Investor · Bengaluru &amp; London
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 rounded-3xl bg-neutral-950 text-white border border-white/10 p-7 flex flex-col justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-sky-400">
                <span>{isIndia ? 'India UPI Billing' : 'International PayPal Billing'}</span>
                <span>Current Plan: {planTier.toUpperCase()}</span>
              </div>
              <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                Free Daily Workspace. Flexible Day Pass, Monthly or Yearly Pro.
              </h3>
              <p className="text-sm text-neutral-300 leading-relaxed">
                {isIndia
                  ? 'Starter Free keeps your Dashboard, daily expense log and stock portfolio open forever plus 5 free tries across AI & Studio tools. Unlock unlimited access anytime with ₹49 Day Pass, ₹149/mo or ₹999/yr via instant UPI.'
                  : 'Starter Free keeps your Dashboard, daily expense log and stock portfolio open forever plus 5 free tries across AI & Studio tools. Unlock unlimited access anytime with $2 Day Pass, $9/mo or $20/yr via PayPal.'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                <p className="font-mono text-sky-400">Verified Checkout</p>
                <p className="font-bold text-sm mt-1">Instant Invoice via Gmail</p>
                <p className="text-neutral-400 mt-1">
                  {isIndia
                    ? 'Every confirmed UPI order delivers a formatted invoice receipt.'
                    : 'Every confirmed PayPal order delivers a formatted invoice receipt.'}
                </p>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                <p className="font-mono text-emerald-400">Clean Swiss Studio</p>
                <p className="font-bold text-sm mt-1">5 Templates · A4, Letter &amp; 80mm</p>
                <p className="text-neutral-400 mt-1">Create invoices or convert paper bills to digital across 5 Swiss templates.</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onNavigateWindow('pricing')}
                className="px-5 py-2.5 rounded-xl bg-white text-neutral-950 text-xs font-bold hover:bg-neutral-100 cursor-pointer"
              >
                Compare Plans &amp; Checkout &rarr;
              </button>
              <button
                type="button"
                onClick={() => onNavigateWindow('overview')}
                className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold cursor-pointer"
              >
                Open Dashboard
              </button>
            </div>
          </div>
        </section>

        {/* ================= 6. AEO STRUCTURED FAQ ================= */}
        <section className="space-y-6 pt-4">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-mono uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400 font-semibold">
              Common Questions
            </p>
            <h2 className="text-3xl font-extrabold tracking-tight">
              Simple daily clarity for every money decision.
            </h2>
          </div>

          <dl className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass-card dark:bg-neutral-900/90 border border-neutral-200/80 dark:border-neutral-800 rounded-2xl p-6 space-y-2">
              <dt className="text-base font-bold text-neutral-900 dark:text-white">
                Who is Liddy built for?
              </dt>
              <dd className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                Liddy is a general-purpose daily financial companion built for everyone—track everyday expenses, update your stock broking portfolio, manage A4/Letter/thermal invoices, follow live financial news and collaborate with teams or family.
              </dd>
            </div>

            <div className="glass-card dark:bg-neutral-900/90 border border-neutral-200/80 dark:border-neutral-800 rounded-2xl p-6 space-y-2">
              <dt className="text-base font-bold text-neutral-900 dark:text-white">
                How does the connected stock portfolio card work?
              </dt>
              <dd className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                Select your stock broking app (such as Zerodha Kite, Groww, Upstox, Robinhood or Fidelity), log your stock holdings or total portfolio balance and track your unrealized gains right next to your daily spending.
              </dd>
            </div>

            <div className="glass-card dark:bg-neutral-900/90 border border-neutral-200/80 dark:border-neutral-800 rounded-2xl p-6 space-y-2">
              <dt className="text-base font-bold text-neutral-900 dark:text-white">
                Which payment methods and receipts are supported?
              </dt>
              <dd className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                {isIndia
                  ? 'Checkout verifies payments seamlessly via UPI (UPI QR & UPI ID) in INR and delivers a formatted invoice via Gmail or downloadable receipt.'
                  : 'Checkout verifies payments seamlessly via PayPal in USD and delivers a formatted invoice via Gmail or downloadable receipt.'}
              </dd>
            </div>

            <div className="glass-card dark:bg-neutral-900/90 border border-neutral-200/80 dark:border-neutral-800 rounded-2xl p-6 space-y-2">
              <dt className="text-base font-bold text-neutral-900 dark:text-white">
                What can you create inside Vision Studio?
              </dt>
              <dd className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                Map ideas on an interactive canvas, design Clean Swiss Paper presentations downloadable as self-contained .html decks and host live HD video &amp; screen-share rooms.
              </dd>
            </div>
          </dl>
        </section>
      </main>

      <SystemFooter onNavigateWindow={onNavigateWindow} />
    </div>
  );
};

export default LandingPage;
