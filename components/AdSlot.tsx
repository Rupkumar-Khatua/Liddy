import React, { useEffect, useRef } from 'react';
import { useFinMind } from '../context/FinMindContext';
import { WindowId } from '../types';

interface AdSlotProps {
  placementId: string;
  slotId?: string;
  onNavigateWindow?: (windowId: WindowId) => void;
  compact?: boolean;
}

declare global {
  interface Window {
    adsbygoogle?: any[];
  }
}

export const AdSlot: React.FC<AdSlotProps> = ({
  placementId,
  slotId,
  onNavigateWindow,
  compact = false,
}) => {
  const { showAds, logAnalyticsEvent } = useFinMind();
  const hasLoggedRef = useRef(false);
  const adsenseClient = (import.meta as any).env?.VITE_ADSENSE_CLIENT_ID as string | undefined;

  useEffect(() => {
    if (!showAds || hasLoggedRef.current) return;
    hasLoggedRef.current = true;
    logAnalyticsEvent('ad_impression', placementId, adsenseClient ? 'adsense' : 'sponsor_card', 0.02);
  }, [showAds, placementId, adsenseClient, logAnalyticsEvent]);

  useEffect(() => {
    if (!showAds || !adsenseClient || !slotId) return;
    const scriptId = 'liddy-adsense-script';
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(adsenseClient)}`;
      document.head.appendChild(script);
    }
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {}
  }, [showAds, adsenseClient, slotId]);

  if (!showAds) {
    return null;
  }

  return (
    <aside
      aria-label="Sponsored placement"
      className={`w-full rounded-2xl border border-neutral-200/80 dark:border-neutral-800/80 bg-white/75 dark:bg-neutral-900/75 px-5 ${
        compact ? 'py-3.5 min-h-[84px]' : 'py-4 min-h-[104px]'
      } flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors`}
    >
      {adsenseClient && slotId ? (
        <div className="w-full overflow-hidden">
          <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 mb-1">
            Sponsored
          </p>
          <ins
            className="adsbygoogle block"
            style={{ display: 'block', minHeight: compact ? '60px' : '80px' }}
            data-ad-client={adsenseClient}
            data-ad-slot={slotId}
            data-ad-format="auto"
            data-full-width-responsive="true"
          />
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
              <span className="uppercase tracking-wider font-semibold">Liddy Pro</span>
              <span>·</span>
              <span>Ad-Free Workspace + Email Receipts</span>
            </div>
            <p className="text-sm font-semibold text-neutral-900 dark:text-white">
              Unlock unlimited multi-format invoices, instant Gmail receipt delivery, and an ad-free daily workspace.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {onNavigateWindow && (
              <button
                type="button"
                onClick={() => onNavigateWindow('pricing')}
                className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer"
              >
                Upgrade to Pro &rarr;
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  );
};

export default AdSlot;
