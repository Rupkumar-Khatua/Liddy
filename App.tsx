import React, { useState, useEffect, useCallback } from 'react';
import Dashboard from './components/Dashboard';
import ChatAssistant from './components/ChatAssistant';
import Transactions from './components/Transactions';
import GoalVisualizer from './components/GoalVisualizer';
import Markets from './components/Markets';
import Login from './components/Login';
import SettingsModal from './components/SettingsModal';
import UserProfileModal from './components/UserProfileModal';
import LandingPage from './components/LandingPage';
import FullScreenWindowShell from './components/FullScreenWindowShell';
import PricingWindow from './components/PricingWindow';
import AdminAnalyticsPortal from './components/AdminAnalyticsPortal';
import { LaunchScreen } from './components/LaunchScreen';
import { FinMindProvider, useFinMind } from './context/FinMindContext';
import { WindowId } from './types';
import {
  parsePathToWindow,
  windowToPath,
  parseRoomCodeFromLocation,
  parseRegionFromPath,
  stripRegionPrefix,
  getWindowRouteMeta,
  syncDocumentSeo,
} from './utils/router';

const AppContent: React.FC = () => {
  const [showLaunchScreen, setShowLaunchScreen] = useState<boolean>(() =>
    !(
      typeof window !== 'undefined' &&
      Boolean(parseRoomCodeFromLocation(window.location.pathname, window.location.search, window.location.hash))
    )
  );
  const [activeWindow, setActiveWindow] = useState<WindowId>(() =>
    typeof window !== 'undefined'
      ? parsePathToWindow(window.location.pathname, window.location.search, window.location.hash)
      : 'home'
  );
  const [visionRoomCode, setVisionRoomCode] = useState<string | null>(() =>
    typeof window !== 'undefined'
      ? parseRoomCodeFromLocation(window.location.pathname, window.location.search, window.location.hash)
      : null
  );
  const [launchVoiceInsideAgent] = useState<boolean>(() =>
    typeof window !== 'undefined' && stripRegionPrefix(window.location.pathname).replace(/\/+$/, '') === '/workspace/voice'
  );

  const {
    isAuthModalOpen,
    authModalReason,
    isGuestLocked,
    openAuthModal,
    closeAuthModal,
    isUpgradeModalOpen,
    upgradeModalReason,
    closeUpgradeModal,
    planTier,
    isAdminUser,
    paymentRegion,
    setPaymentRegion,
    accountAccessStatus,
    accountAccessReason,
    clearAccountAccessNotice,
    logAnalyticsEvent,
  } = useFinMind();

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  useEffect(() => {
    syncDocumentSeo(activeWindow, paymentRegion);
    const meta = getWindowRouteMeta(activeWindow, paymentRegion);
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      canonical.setAttribute('href', `${window.location.origin}${meta.path}`);
    }
    logAnalyticsEvent('feature_view', activeWindow);
  }, [activeWindow, paymentRegion, logAnalyticsEvent]);

  useEffect(() => {
    const onPopState = () => {
      const pathRegion = parseRegionFromPath(window.location.pathname);
      if (pathRegion) {
        setPaymentRegion(pathRegion, false);
      }
      const next = parsePathToWindow(window.location.pathname, window.location.search, window.location.hash);
      setActiveWindow(next);
      setVisionRoomCode(
        next === 'vision'
          ? parseRoomCodeFromLocation(window.location.pathname, window.location.search, window.location.hash)
          : null
      );
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [setPaymentRegion]);

  useEffect(() => {
    const cleanupBadElements = () => {
      const badElements = document.querySelectorAll(
        '.goog-te-banner-frame, iframe.skiptranslate, div[class*="VIpgJd"], #goog-gt-tt, .goog-tooltip'
      );
      badElements.forEach((el) => {
        const htmlEl = el as HTMLElement;
        htmlEl.style.display = 'none';
        htmlEl.style.visibility = 'hidden';
      });
    };

    const observer = new MutationObserver(cleanupBadElements);
    observer.observe(document.body, { childList: true, subtree: false });
    cleanupBadElements();
    return () => observer.disconnect();
  }, []);

  const navigateToWindow = useCallback((windowId: WindowId) => {
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    const nextPath = windowToPath(windowId, paymentRegion);
    if (window.location.pathname !== nextPath || (windowId !== 'vision' && window.location.search)) {
      window.history.pushState({ windowId, region: paymentRegion }, '', nextPath);
    }
    if (windowId !== 'vision') {
      setVisionRoomCode(null);
    }
    setActiveWindow(windowId);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [paymentRegion]);

  const renderWorkspace = () => {
    switch (activeWindow) {
      case 'overview':
        return <Dashboard onNavigateWindow={navigateToWindow} />;
      case 'expenses':
        return <Transactions key="section-expenses" initialTab="LIST" />;
      case 'invoices':
        return <Transactions key="section-invoices" initialTab="INVOICE" />;
      case 'scanner':
        return <Transactions key="section-scanner" initialTab="INVOICE" initialInvoiceView="SCAN_BILL" />;
      case 'markets':
        return <Markets />;
      case 'agent':
        return (
          <div className="min-h-[75vh]">
            <ChatAssistant initialVoiceMode={launchVoiceInsideAgent} />
          </div>
        );
      case 'vision':
        return (
          <GoalVisualizer
            initialRoomCode={visionRoomCode}
            onRoomCodeChange={(code) => {
              setVisionRoomCode(code);
              if (activeWindow === 'vision' && code) {
                const basePath = windowToPath('vision', paymentRegion);
                const targetUrl = `${basePath}?room=${encodeURIComponent(code)}`;
                if (`${window.location.pathname}${window.location.search}` !== targetUrl) {
                  window.history.replaceState({ windowId: 'vision', room: code, region: paymentRegion }, '', targetUrl);
                }
              }
            }}
          />
        );
      case 'pricing':
        return <PricingWindow onNavigateWindow={navigateToWindow} />;
      case 'settings':
        return (
          <SettingsModal
            isOpen={true}
            isFullScreen={true}
            onClose={() => navigateToWindow('overview')}
          />
        );
      case 'profile':
        return (
          <UserProfileModal
            isOpen={true}
            isFullScreen={true}
            onClose={() => navigateToWindow('overview')}
            onNavigateWindow={navigateToWindow}
          />
        );
      default:
        return <Dashboard onNavigateWindow={navigateToWindow} />;
    }
  };

  if (accountAccessStatus === 'blocked') {
    return (
      <div className="min-h-screen w-full bg-[#06070B] text-white flex items-center justify-center p-6 font-sans">
        <div className="max-w-md w-full rounded-3xl bg-neutral-900 border border-rose-500/30 p-8 space-y-6 text-center shadow-2xl">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 mx-auto flex items-center justify-center font-mono text-lg font-bold">
            !
          </div>
          <div className="space-y-2">
            <p className="text-xs font-mono uppercase tracking-[0.18em] text-rose-400 font-semibold">
              Access Restricted
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight text-white">
              Account Blocked
            </h1>
            <p className="text-sm text-neutral-300 leading-relaxed">
              {accountAccessReason || 'Your account has been blocked from using Liddy by the platform administrator.'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                clearAccountAccessNotice();
                openAuthModal('Sign in with another account');
              }}
              className="flex-1 py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer transition-colors whitespace-nowrap"
            >
              Use Another Account
            </button>
            <button
              type="button"
              onClick={() => {
                clearAccountAccessNotice();
                navigateToWindow('home');
              }}
              className="flex-1 py-3 px-4 rounded-2xl bg-white/10 hover:bg-white/15 text-neutral-200 text-xs font-bold cursor-pointer transition-colors whitespace-nowrap"
            >
              Return Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#F6F6F4] dark:bg-[#09090B] text-neutral-900 dark:text-neutral-100 font-sans selection:bg-indigo-600 selection:text-white relative transition-colors duration-200 overflow-x-clip">
      {showLaunchScreen && (
        <LaunchScreen onComplete={() => setShowLaunchScreen(false)} />
      )}

      {activeWindow === 'home' ? (
        <LandingPage onNavigateWindow={navigateToWindow} />
      ) : activeWindow === 'admin' ? (
        <AdminAnalyticsPortal
          onExitAdmin={() => navigateToWindow('home')}
        />
      ) : (
        <FullScreenWindowShell
          activeWindow={activeWindow}
          onNavigateWindow={navigateToWindow}
          onCloseToHome={() => navigateToWindow('home')}
          hideBottomAd={activeWindow === 'pricing' || activeWindow === 'vision'}
        >
          {renderWorkspace()}
        </FullScreenWindowShell>
      )}

      {isAuthModalOpen && (
        <Login
          isModal={true}
          forceLock={false}
          featureReason={
            authModalReason ||
            (isGuestLocked ? 'Your guest preview has ended — Create a free account to continue' : undefined)
          }
          onDismiss={closeAuthModal}
          onSuccess={closeAuthModal}
          onReturnHome={() => {
            closeAuthModal();
            navigateToWindow('home');
          }}
        />
      )}

      {isUpgradeModalOpen &&
        planTier === 'free' &&
        !isAdminUser &&
        !isAuthModalOpen &&
        activeWindow !== 'pricing' &&
        activeWindow !== 'admin' && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-neutral-950/40 dark:bg-black/65 backdrop-blur-sm overflow-y-auto"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeUpgradeModal();
            }}
          >
            <div className="relative w-full max-w-5xl rounded-3xl bg-[#F6F6F4] dark:bg-[#0B0C11] border border-neutral-200 dark:border-white/10 shadow-2xl p-5 sm:p-8 my-auto max-h-[92vh] overflow-y-auto animate-enter">
              <button
                type="button"
                onClick={closeUpgradeModal}
                aria-label="Close payments window"
                className="hidden md:flex absolute top-5 right-5 w-9 h-9 rounded-full bg-neutral-200/80 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 items-center justify-center text-lg font-bold transition-colors cursor-pointer z-10"
              >
                &times;
              </button>
              <PricingWindow
                isModal={true}
                modalReason={upgradeModalReason}
                onCloseModal={closeUpgradeModal}
                onNavigateWindow={(win) => {
                  closeUpgradeModal();
                  navigateToWindow(win);
                }}
              />
            </div>
          </div>
        )}
    </div>
  );
};

const App: React.FC = () => {
  return (
    <FinMindProvider>
      <AppContent />
    </FinMindProvider>
  );
};

export default App;