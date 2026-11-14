import React, { useState } from 'react';
import { Logo } from './Logo';
import { useFinMind } from '../context/FinMindContext';
import { WindowId } from '../types';

interface TopNavbarProps {
  onNavigateWindow: (windowId: WindowId) => void;
}

const PRIMARY_NAV_LINKS: Array<{ id: WindowId; label: string }> = [
  { id: 'overview', label: 'Workspace' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'markets', label: 'News & Markets' },
  { id: 'vision', label: 'Vision Studio' },
  { id: 'pricing', label: 'Pricing' },
];

export const TopNavbar: React.FC<TopNavbarProps> = ({ onNavigateWindow }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { themeMode, setThemeMode, currentUser, openAuthModal } = useFinMind();

  const toggleTheme = () => {
    setThemeMode(themeMode === 'dark' ? 'light' : 'dark');
  };

  const handleNavigate = (id: WindowId) => {
    setIsMobileMenuOpen(false);
    onNavigateWindow(id);
  };

  return (
    <>
      <header className="fixed top-0 inset-x-0 z-40 w-full bg-white/90 dark:bg-[#09090B]/90 backdrop-blur-xl border-b border-neutral-200/80 dark:border-neutral-800/80 transition-colors duration-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 md:h-[72px] flex items-center justify-between gap-4">
          {/* Brand Wordmark */}
          <div className="flex items-center shrink-0">
            <Logo size="sm" showText={true} showSubtitle={false} onClick={() => handleNavigate('home')} />
          </div>

          {/* Primary Inline Navigation */}
          <nav aria-label="Primary" className="hidden lg:flex items-center gap-7">
            {PRIMARY_NAV_LINKS.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => handleNavigate(link.id)}
                className="text-sm font-semibold text-neutral-600 hover:text-neutral-950 dark:text-neutral-300 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {link.label}
              </button>
            ))}
          </nav>

          {/* Theme + Settings + Primary CTA */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-xl bg-neutral-100 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border border-neutral-200/80 dark:border-neutral-800 hover:border-sky-400 transition-colors cursor-pointer"
              title={`Switch to ${themeMode === 'dark' ? 'Light' : 'Dark'} Mode`}
              aria-label="Toggle theme"
            >
              {themeMode === 'dark' ? (
                <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleNavigate('overview')}
              className="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-950 text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 transition-all cursor-pointer"
            >
              Open Studio &rarr;
            </button>

            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="lg:hidden p-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-neutral-800 dark:text-neutral-200 cursor-pointer"
              aria-label="Toggle Menu"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                {isMobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {isMobileMenuOpen && (
          <div className="lg:hidden border-t border-neutral-200/80 dark:border-neutral-800/80 bg-white/95 dark:bg-[#09090B]/95 px-4 py-4 space-y-2 animate-enter">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: 'overview', label: 'Daily Overview' },
                  { id: 'invoices', label: 'Invoices & UPI' },
                  { id: 'scanner', label: 'Expense AI' },
                  { id: 'markets', label: 'News & Markets' },
                  { id: 'agent', label: 'AI Finance Agent' },
                  { id: 'vision', label: 'Vision Studio' },
                  { id: 'pricing', label: 'Pricing' },
                ] as Array<{ id: WindowId; label: string }>
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  className="p-3 rounded-xl bg-neutral-100 dark:bg-neutral-900 text-left text-xs font-bold text-neutral-800 dark:text-neutral-200 cursor-pointer"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => handleNavigate('settings')}
                className="flex-1 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-bold"
              >
                Settings
              </button>
              {(!currentUser || currentUser.isGuest) ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    openAuthModal('Sign In');
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold"
                >
                  Sign In
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleNavigate('profile')}
                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold"
                >
                  Account
                </button>
              )}
            </div>
          </div>
        )}
      </header>
      <div className="h-16 md:h-[72px] shrink-0" aria-hidden="true" />
    </>
  );
};

export default TopNavbar;
