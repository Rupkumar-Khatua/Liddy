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
import { WINDOW_ROUTES, parsePathToWindow, windowToPath } from './utils/router';

function syncDocumentSeo(windowId: WindowId) {
  const meta = WINDOW_ROUTES[windowId] || WINDOW_ROUTES.home;
  document.title = meta.title;

  const setMetaTag = (selector: string, content: string) => {
    const el = document.querySelector(selector);
    if (el) el.setAttribute('content', content);
  };

  setMetaTag('meta[name="description"]', meta.description);
  setMetaTag('meta[property="og:title"]', meta.title);
  setMetaTag('meta[property="og:description"]', meta.description);
  setMetaTag('meta[name="twitter:title"]', meta.title);
  setMetaTag('meta[name="twitter:description"]', meta.description);

  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) {
    canonical.setAttribute('href', `${window.location.origin}${meta.path}`);
  }
}

const AppContent: React.FC = () => {
  const [showLaunchScreen, setShowLaunchScreen] = useState(true);
  const [activeWindow, setActiveWindow] = useState<WindowId>(() =>
    typeof window !== 'undefined' ? parsePathToWindow(window.location.pathname) : 'home'
  );
  const [launchVoiceInsideAgent] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/workspace/voice'
  );

  const {
    isAuthModalOpen,
    authModalReason,
    closeAuthModal,
    logAnalyticsEvent,
  } = useFinMind();

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  useEffect(() => {
    syncDocumentSeo(activeWindow);
    logAnalyticsEvent('feature_view', activeWindow);
  }, [activeWindow, logAnalyticsEvent]);

  useEffect(() => {
    const onPopState = () => {
      const next = parsePathToWindow(window.location.pathname);
      setActiveWindow(next);
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

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
    const nextPath = windowToPath(windowId);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ windowId }, '', nextPath);
    }
    setActiveWindow(windowId);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  const renderWorkspace = () => {
    switch (activeWindow) {
      case 'overview':
        return <Dashboard onNavigateWindow={navigateToWindow} />;
      case 'invoices':
        return <Transactions key="section-invoices" initialTab="INVOICE" />;
      case 'scanner':
        return <Transactions key="section-scanner" initialTab="SCAN" />;
      case 'markets':
        return <Markets />;
      case 'agent':
        return (
          <div className="min-h-[75vh]">
            <ChatAssistant initialVoiceMode={launchVoiceInsideAgent} />
          </div>
        );
      case 'vision':
        return <GoalVisualizer />;
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
          featureReason={authModalReason}
          onDismiss={closeAuthModal}
          onSuccess={closeAuthModal}
        />
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