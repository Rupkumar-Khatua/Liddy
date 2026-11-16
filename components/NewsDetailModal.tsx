import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MarketNewsItem } from '../types';
import { useFinMind } from '../context/FinMindContext';
import { useTranslationSync } from '../services/localization';

interface NewsDetailModalProps {
  news: MarketNewsItem | null;
  onClose: () => void;
}

export const NewsDetailModal: React.FC<NewsDetailModalProps> = ({ news, onClose }) => {
  const { trackEngagement, currentLanguage, t } = useFinMind();

  // Instant multi-language synchronization: triggers immediate DOM re-scan when modal opens
  useTranslationSync(currentLanguage, Boolean(news));

  // Lock body scroll when modal is active
  useEffect(() => {
    if (news) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [news]);

  if (!news) return null;

  const externalNewsUrl = news.url || `https://news.google.com/search?q=${encodeURIComponent(news.title)}`;

  const modalContent = (
    <div 
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-3 md:p-8 animate-enter overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-3xl bg-white dark:bg-[#121215] text-neutral-900 dark:text-neutral-100 rounded-[32px] shadow-2xl border border-neutral-200/80 dark:border-neutral-800 overflow-hidden flex flex-col max-h-[90vh] my-auto"
      >
        
        {/* Header Bar */}
        <div className="p-6 md:p-8 pb-4 border-b border-neutral-100 dark:border-neutral-800/80 flex items-start justify-between bg-white dark:bg-[#121215]">
          <div className="space-y-2 pr-4">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-extrabold text-neutral-900 dark:text-white font-mono bg-neutral-100 dark:bg-neutral-800 px-3 py-1 rounded-md border border-neutral-200/70 dark:border-neutral-700">
                {news.source}
              </span>
              <span>·</span>
              <span className="text-neutral-500 dark:text-neutral-400 font-mono">
                {news.category || 'Global Markets Wire'}
              </span>
              {news.timeAgo && (
                <>
                  <span>·</span>
                  <span className="text-neutral-400 font-mono text-[11px]">{news.timeAgo}</span>
                </>
              )}
            </div>

            <h3 className="text-xl md:text-2xl font-extrabold text-neutral-900 dark:text-white tracking-tight leading-snug">
              {news.title}
            </h3>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            className="w-10 h-10 rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 flex items-center justify-center transition-colors text-base font-bold shadow-xs shrink-0 cursor-pointer border border-transparent dark:border-neutral-700"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Story Body */}
        <div className="p-6 md:p-8 space-y-6 overflow-y-auto no-scrollbar flex-1 text-xs md:text-sm leading-relaxed text-neutral-700 dark:text-neutral-300 bg-white dark:bg-[#121215]">
          
          {/* Executive Overview */}
          <div className="modal-inner-card hover-border-glow p-5 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800">
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 font-mono mb-2">
              {t('news.wire_dispatch_summary', 'Wire Dispatch Summary')}
            </h4>
            <p className="text-neutral-800 dark:text-neutral-200 font-medium leading-relaxed">
              {news.summary}
            </p>
          </div>

          {/* Analytical Breakdown & Market Impact */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 font-mono">
              {t('news.market_context', 'Market Context & Institutional Impact')}
            </h4>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="modal-inner-card hover-border-glow p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800">
                <span className="font-bold text-neutral-900 dark:text-white block mb-1">
                  {t('news.impact_rating', 'Impact Rating')}
                </span>
                <span className="inline-block px-2.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 font-mono font-bold text-[10px] border border-amber-200 dark:border-amber-900/60">
                  {news.impact || 'MACROECONOMIC IMPACT'}
                </span>
                <p className="text-neutral-500 dark:text-neutral-400 mt-2 leading-relaxed">
                  Active policy developments directly influence sovereign debt yields, institutional cash allocations and equity sector multiples.
                </p>
              </div>

              <div className="modal-inner-card hover-border-glow p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800">
                <span className="font-bold text-neutral-900 dark:text-white block mb-1">
                  {t('news.asset_implication', 'Asset Allocation Implication')}
                </span>
                <span className="inline-block px-2.5 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 font-mono font-bold text-[10px] border border-blue-200 dark:border-blue-900/60">
                  EQUITIES & LIQUID RESERVES
                </span>
                <p className="text-neutral-500 dark:text-neutral-400 mt-2 leading-relaxed">
                  Cross-asset volatility may adjust quarterly treasury projections, inventory financing terms and foreign exchange hedges.
                </p>
              </div>
            </div>
          </div>

          {/* Source Attribution Note */}
          <div className="p-3.5 rounded-2xl bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 text-xs flex items-center justify-between border border-neutral-200/60 dark:border-neutral-800">
            <span>Verified Wire Source: <strong className="text-neutral-900 dark:text-white">{news.source}</strong></span>
            <span className="font-mono text-[11px]">{t('news.source_filing', 'Uncensored Primary Dispatch')}</span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-6 bg-neutral-50 dark:bg-[#101014] border-t border-neutral-100 dark:border-neutral-800/80 flex items-center justify-between gap-3">
          <span className="text-xs text-neutral-400 font-mono">Real-Time Market Dispatch</span>

          <div className="flex items-center gap-2.5">
            <a
              href={externalNewsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEngagement(`External News Read: ${news.source}`)}
              className="px-5 py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer hover-border-glow"
            >
              <span>{t('news.read_full', `Read Full Article on ${news.source}`)}</span>
              <span>↗</span>
            </a>
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold text-neutral-700 dark:text-neutral-300 transition-colors cursor-pointer"
            >
              {t('news.close', 'Close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default NewsDetailModal;
