import React from 'react';
import { ThreeLogoCanvas } from './ThreeLogoCanvas';
import { Logo } from './Logo';
import { WindowId } from '../types';

interface SystemFooterProps {
  onNavigateWindow: (windowId: WindowId) => void;
}

export const SystemFooter: React.FC<SystemFooterProps> = ({ onNavigateWindow }) => {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer id="section-footer" className="w-full mt-16 pb-14 px-4 sm:px-6 lg:px-8 transition-colors duration-200">
      <div className="max-w-7xl mx-auto space-y-12">
        <div className="w-full border-t border-neutral-200/80 dark:border-neutral-800/80" />

        {/* Platform Directory */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="space-y-3">
            <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-900 dark:text-neutral-200">
              Daily Money &amp; Wealth
            </h4>
            <ul className="space-y-2.5 text-xs text-neutral-600 dark:text-neutral-400">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('overview')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  Personal Expenses &amp; Spending
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('overview')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  Stock Broker Portfolio Tracker
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('vision')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  Mind Maps &amp; Slide Decks
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('vision')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  Live Video Collaboration Rooms
                </button>
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-900 dark:text-neutral-200">
              Invoicing &amp; Receipts
            </h4>
            <ul className="space-y-2.5 text-xs text-neutral-600 dark:text-neutral-400">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('invoices')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  A4, Letter &amp; 80mm Invoices
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('scanner')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  Instant Receipt Capture (AI)
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('scanner')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  Expense &amp; Bill Ledger
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('invoices')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  UPI QR &amp; Gmail Receipts
                </button>
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-900 dark:text-neutral-200">
              News Wire &amp; AI Guide
            </h4>
            <ul className="space-y-2.5 text-xs text-neutral-600 dark:text-neutral-400">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('markets')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  Live Global Financial News
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('markets')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  Real-Time Stock &amp; Earnings Feed
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('markets')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  US, India &amp; Europe Macro Pulse
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('agent')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  AI Budget, Tax &amp; Voice Advisor
                </button>
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-neutral-900 dark:text-neutral-200">
              Plans &amp; Preferences
            </h4>
            <ul className="space-y-2.5 text-xs text-neutral-600 dark:text-neutral-400">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('pricing')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  Liddy Pro &amp; Team Plans
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('settings')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  Themes, Languages &amp; Currency
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('profile')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  Account &amp; Cloud Sync
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateWindow('settings')}
                  className="hover:text-indigo-600 dark:hover:text-sky-400 transition-colors text-left cursor-pointer"
                >
                  Data Privacy &amp; Governance
                </button>
              </li>
            </ul>
          </div>
        </div>

        {/* Clean 3D Emblem */}
        <div className="py-2 flex items-center justify-center">
          <ThreeLogoCanvas height={300} />
        </div>

        {/* Bottom Strip */}
        <div className="pt-8 border-t border-neutral-200/80 dark:border-neutral-800/80 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <Logo size="sm" showText={true} showSubtitle={false} onClick={() => onNavigateWindow('home')} />
            <div className="h-4 w-px bg-neutral-300 dark:bg-neutral-800 hidden sm:block" />
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              &copy; {new Date().getFullYear()} Liddy. Everyday Financial &amp; Creative Workspace for Everyone.
            </p>
          </div>

          <button
            type="button"
            onClick={scrollToTop}
            className="px-4 py-2 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:border-sky-400 text-xs font-bold text-neutral-700 dark:text-neutral-300 flex items-center gap-2 min-h-[40px] transition-all cursor-pointer"
            title="Return to top of page"
          >
            <span>Back to Top</span>
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            </svg>
          </button>
        </div>
      </div>
    </footer>
  );
};

export default SystemFooter;
