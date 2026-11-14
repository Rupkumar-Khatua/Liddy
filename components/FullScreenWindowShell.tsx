import React from 'react';
import { WindowId } from '../types';
import { WINDOW_ROUTES, WORKSPACE_SWITCHER_WINDOWS } from '../utils/router';
import { Logo } from './Logo';
import { useFinMind } from '../context/FinMindContext';
import { AdSlot } from './AdSlot';

interface FullScreenWindowShellProps {
  activeWindow: WindowId;
  onNavigateWindow: (windowId: WindowId) => void;
  onCloseToHome: () => void;
  children: React.ReactNode;
  hideBottomAd?: boolean;
  darkSurface?: boolean;
}

export const FullScreenWindowShell: React.FC<FullScreenWindowShellProps> = ({
  activeWindow,
  onNavigateWindow,
  onCloseToHome,
  children,
  hideBottomAd = false,
  darkSurface = false,
}) => {
  const { planTier, currentUser, openAuthModal, themeMode, setThemeMode } = useFinMind();
  const routeMeta = WINDOW_ROUTES[activeWindow] || WINDOW_ROUTES.overview;

  const cycleTheme = () => {
    const next = themeMode === 'light' ? 'dark' : themeMode === 'dark' ? 'system' : 'light';
    setThemeMode(next);
  };

  return (
    <div
      className={`min-h-screen w-full flex flex-col ${
        darkSurface
          ? 'bg-[#07080D] text-white'
          : 'bg-[#F6F6F4] dark:bg-[#09090B] text-neutral-900 dark:text-neutral-100'
      } transition-colors duration-200`}
    >
      {/* Fixed Top Workspace Bar */}
      <header
        className={`fixed top-0 inset-x-0 z-40 w-full backdrop-blur-xl border-b ${
          darkSurface
            ? 'bg-[#07080D]/90 border-white/10'
            : 'bg-white/90 dark:bg-[#0B0B0F]/90 border-neutral-200/80 dark:border-neutral-800/80'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Left: Back to Home + Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onCloseToHome}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                darkSurface
                  ? 'bg-white/10 hover:bg-white/15 border-white/15 text-white'
                  : 'bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-900 dark:hover:bg-neutral-800 border-neutral-200 dark:border-neutral-800 text-neutral-800 dark:text-neutral-200'
              }`}
            >
              <span>&larr;</span>
              <span>Home</span>
            </button>
            <div className="hidden sm:block">
              <Logo size="sm" showText={false} onClick={onCloseToHome} />
            </div>
            <div className="hidden xl:flex flex-col">
              <span className="text-xs font-bold tracking-tight whitespace-nowrap">
                {routeMeta.label}
              </span>
            </div>
          </div>

          {/* Center: Workspace Section Switcher */}
          <nav
            aria-label="Workspace Sections"
            className="hidden lg:flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-2xl"
          >
            {WORKSPACE_SWITCHER_WINDOWS.map((winId) => {
              const meta = WINDOW_ROUTES[winId];
              const isActive = activeWindow === winId;
              return (
                <button
                  key={winId}
                  type="button"
                  onClick={() => onNavigateWindow(winId)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isActive
                      ? darkSurface
                        ? 'bg-white text-neutral-950 font-bold'
                        : 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 font-bold'
                      : darkSurface
                      ? 'text-neutral-300 hover:text-white hover:bg-white/10'
                      : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  }`}
                >
                  {meta.shortLabel}
                </button>
              );
            })}
          </nav>

          {/* Right: Upgrade/Account Controls + Theme Switcher + Settings */}
          <div className="flex items-center gap-2 shrink-0">
            {planTier === 'free' && (
              <button
                type="button"
                onClick={() => onNavigateWindow('pricing')}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Upgrade
              </button>
            )}

            {(!currentUser || currentUser.isGuest) ? (
              <button
                type="button"
                onClick={() => openAuthModal('Sign In')}
                className={`hidden sm:inline-flex px-3 py-2 rounded-xl text-xs font-semibold border whitespace-nowrap cursor-pointer ${
                  darkSurface
                    ? 'border-white/15 text-neutral-200 hover:bg-white/10'
                    : 'border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                }`}
              >
                Sign In
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigateWindow('profile')}
                title="My Account"
                aria-label="My Account"
                className={`w-9 h-9 rounded-xl font-bold text-xs flex items-center justify-center border transition-colors cursor-pointer ${
                  activeWindow === 'profile'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : darkSurface
                    ? 'bg-white/10 text-white border-white/15 hover:bg-white/15'
                    : 'bg-neutral-100 dark:bg-neutral-900 text-neutral-800 dark:text-neutral-200 border-neutral-200 dark:border-neutral-800 hover:border-indigo-400'
                }`}
              >
                {currentUser.displayName ? currentUser.displayName.charAt(0).toUpperCase() : 'M'}
              </button>
            )}

            {/* Theme Mode Switcher Button */}
            <button
              type="button"
              onClick={cycleTheme}
              title={`Theme: ${themeMode} (click to switch)`}
              aria-label={`Switch theme mode (current ${themeMode})`}
              className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                darkSurface
                  ? 'border-white/15 bg-white/5 text-neutral-200 hover:bg-white/10'
                  : 'border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:border-sky-400'
              }`}
            >
              {themeMode === 'dark' ? (
                <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                </svg>
              ) : themeMode === 'light' ? (
                <svg className="w-4 h-4 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-sky-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 17v4" />
                </svg>
              )}
            </button>

            {/* Workspace Settings Button */}
            <button
              type="button"
              onClick={() => onNavigateWindow('settings')}
              title="Settings"
              aria-label="Settings"
              className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                activeWindow === 'settings'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : darkSurface
                  ? 'border-white/15 bg-white/5 text-neutral-200 hover:bg-white/10'
                  : 'border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 hover:border-sky-400'
              }`}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Quick Section Bar */}
        <div className="lg:hidden px-4 pb-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {WORKSPACE_SWITCHER_WINDOWS.map((winId) => {
            const meta = WINDOW_ROUTES[winId];
            const isActive = activeWindow === winId;
            return (
              <button
                key={winId}
                type="button"
                onClick={() => onNavigateWindow(winId)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? darkSurface
                      ? 'bg-white text-neutral-950 font-bold'
                      : 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 font-bold'
                    : darkSurface
                    ? 'bg-white/5 text-neutral-300'
                    : 'bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400'
                }`}
              >
                {meta.shortLabel}
              </button>
            );
          })}
        </div>
      </header>

      {/* Fixed Header Spacer */}
      <div className="h-[104px] lg:h-16 shrink-0" aria-hidden="true" />

      {/* Main Workspace Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {children}

        {!hideBottomAd && (
          <div className="mt-10">
            <AdSlot
              placementId={`workspace_${activeWindow}`}
              onNavigateWindow={onNavigateWindow}
              compact={true}
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default FullScreenWindowShell;
