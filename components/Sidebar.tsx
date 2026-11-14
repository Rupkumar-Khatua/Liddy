import React, { useState } from 'react';
import { Page } from '../types';
import { ICONS } from '../constants';
import { useFinMind } from '../context/FinMindContext';
import { Logo } from './Logo';

interface SidebarProps {
  currentPage: Page;
  setPage: (page: Page) => void;
  onOpenProfile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentPage, setPage, onOpenProfile }) => {
  const { currentUser, openAuthModal, openSettings, t } = useFinMind();
  
  // State for Task Manager-style collapse/expand
  const [isPinned, setIsPinned] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Expanded if either hovered or explicitly pinned
  const isExpanded = isPinned || isHovered;

  const navItems = [
    { page: Page.DASHBOARD, labelKey: 'nav.dashboard', defaultLabel: 'Overview', icon: ICONS.Dashboard },
    { page: Page.TRANSACTIONS, labelKey: 'nav.scanner_bills', defaultLabel: 'Scanner & Bills', icon: ICONS.Receipt },
    { page: Page.MARKETS, labelKey: 'nav.markets', defaultLabel: 'World Markets', icon: ICONS.Markets },
    { page: Page.CHAT, labelKey: 'nav.ai_advisor', defaultLabel: 'Financial AI', icon: ICONS.Chat },
    { page: Page.GOALS, labelKey: 'nav.vision_board', defaultLabel: 'Vision Board', icon: ICONS.Goal },
  ];

  const handleProfileClick = () => {
    if (onOpenProfile) {
      onOpenProfile();
    } else {
      openAuthModal('Profile Details & Cloud Sync');
    }
  };

  const togglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPinned((prev) => !prev);
  };

  return (
    <aside
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`h-full flex flex-col glass rounded-[28px] md:rounded-[32px] transition-all duration-300 ease-in-out shadow-glass dark:bg-neutral-900/90 dark:border-neutral-800/80 relative z-30 select-none overflow-hidden ${
        isExpanded 
          ? 'w-[260px] shadow-2xl' 
          : 'w-[68px] md:w-[72px]'
      }`}
    >
      {/* Header Bar with Toggle & Clickable Brand */}
      <div className={`p-3.5 md:p-4 flex items-center border-b border-neutral-200/50 dark:border-neutral-800/60 ${
        isExpanded ? 'justify-between' : 'justify-center'
      }`}>
        {/* Expanded Brand View */}
        {isExpanded ? (
          <div className="flex items-center justify-between w-full pr-1">
            <div className="overflow-hidden">
              <Logo 
                size="sm" 
                showText={true} 
                onClick={() => setPage(Page.DASHBOARD)} 
              />
            </div>
            
            {/* Task Manager Style Collapse/Pin Toggle Button */}
            <button
              onClick={togglePin}
              title={isPinned ? 'Collapse sidebar (unpin)' : 'Keep sidebar expanded (pin)'}
              aria-label="Toggle sidebar expansion"
              className={`p-2 rounded-xl transition-all cursor-pointer border ${
                isPinned 
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 border-neutral-900 dark:border-white shadow-xs' 
                  : 'text-neutral-500 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 border-transparent hover:border-sky-400'
              }`}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
          </div>
        ) : (
          /* Compact Collapsed View: Show Liddy Logo Icon, Click returns to Dashboard */
          <div 
            onClick={() => setPage(Page.DASHBOARD)}
            title="Liddy Financial — Return to Dashboard"
            aria-label="Return to Dashboard"
            className="cursor-pointer transition-transform hover:scale-105 active:scale-95 flex items-center justify-center p-1"
          >
            <Logo size="sm" showText={false} />
          </div>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-2.5 md:px-3 space-y-1.5 overflow-y-auto no-scrollbar py-3">
        {isExpanded && (
          <div className="text-[10px] uppercase tracking-[0.18em] font-extrabold text-neutral-400 dark:text-neutral-500 px-3 mb-2 font-mono transition-opacity animate-enter">
            Workspace
          </div>
        )}
        
        {navItems.map((item) => {
          const isActive = currentPage === item.page;
          const displayLabel = t(item.labelKey, item.defaultLabel);
          return (
            <button
              key={item.page}
              onClick={() => setPage(item.page)}
              title={!isExpanded ? displayLabel : undefined}
              className={`group relative w-full flex items-center rounded-2xl transition-all duration-200 ease-out active:scale-[0.98] cursor-pointer nav-item-btn border ${
                isExpanded ? 'gap-3 px-3.5 py-2.5' : 'justify-center p-3'
              } ${
                isActive
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-950 shadow-md border-neutral-900 dark:border-white'
                  : 'text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100/90 dark:hover:bg-neutral-800/90 hover:text-neutral-950 dark:hover:text-white border-transparent hover:border-sky-400 hover:shadow-[0_0_14px_rgba(56,189,248,0.28)]'
              }`}
            >
              <item.icon className={`w-5 h-5 shrink-0 transition-colors ${
                isActive 
                  ? 'text-white dark:text-neutral-950' 
                  : 'text-neutral-500 group-hover:text-neutral-950 dark:text-neutral-400 dark:group-hover:text-white'
              }`} />
              
              {isExpanded && (
                <>
                  <span className={`text-xs tracking-tight truncate flex-1 text-left ${
                    isActive
                      ? 'text-white dark:text-neutral-950 font-extrabold'
                      : 'text-neutral-800 dark:text-neutral-200 font-semibold group-hover:text-neutral-950 dark:group-hover:text-white'
                  }`}>
                    {displayLabel}
                  </span>
                  {isActive && (
                    <div className="w-1.5 h-1.5 rounded-full bg-white dark:bg-neutral-950 shrink-0"></div>
                  )}
                </>
              )}

              {/* Floating Tooltip Hint in Collapsed Mode */}
              {!isExpanded && (
                <div className="absolute left-full ml-3 px-2.5 py-1 rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[11px] font-bold tracking-tight whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg hidden md:block">
                  {displayLabel}
                </div>
              )}
            </button>
          );
        })}

        {/* Platform / Settings Link */}
        <div className="pt-2">
          {isExpanded && (
            <div className="text-[10px] uppercase tracking-[0.18em] font-extrabold text-neutral-500 dark:text-neutral-400 px-3 mb-2 font-mono transition-opacity animate-enter">
              Platform
            </div>
          )}
          
          <button
            onClick={openSettings}
            title={!isExpanded ? t('nav.settings_compliance', 'Settings & Compliance') : undefined}
            className={`group relative w-full flex items-center rounded-2xl transition-all duration-200 ease-out active:scale-[0.98] cursor-pointer nav-item-btn border ${
              isExpanded ? 'gap-3 px-3.5 py-2.5' : 'justify-center p-3'
            } text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100/90 dark:hover:bg-neutral-800/90 hover:text-neutral-950 dark:hover:text-white border-transparent hover:border-sky-400 hover:shadow-[0_0_14px_rgba(56,189,248,0.28)]`}
          >
            <ICONS.Settings className="w-5 h-5 shrink-0 text-neutral-500 group-hover:text-neutral-950 dark:text-neutral-400 dark:group-hover:text-white transition-colors" />
            
            {isExpanded && (
              <span className="font-semibold text-xs tracking-tight truncate flex-1 text-left text-neutral-800 dark:text-neutral-200 group-hover:text-neutral-950 dark:group-hover:text-white">
                {t('nav.settings_compliance', 'Settings & Compliance')}
              </span>
            )}

            {!isExpanded && (
              <div className="absolute left-full ml-3 px-2.5 py-1 rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[11px] font-bold tracking-tight whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg hidden md:block">
                {t('nav.settings_compliance', 'Settings & Compliance')}
              </div>
            )}
          </button>
        </div>
      </nav>

      {/* User Profile / Account Section */}
      <div className={`p-2.5 md:p-3 mt-auto border-t border-neutral-200/50 dark:border-neutral-800/80 ${
        isExpanded ? 'space-y-1' : 'flex justify-center'
      }`}>
        <button
          onClick={handleProfileClick}
          title={!isExpanded ? (currentUser?.displayName || 'User Profile') : undefined}
          className={`group relative rounded-2xl bg-neutral-100/80 dark:bg-neutral-800/80 hover:bg-white dark:hover:bg-neutral-800 border border-neutral-200/80 dark:border-neutral-700/60 hover:border-sky-400 dark:hover:border-sky-400 hover:shadow-[0_0_14px_rgba(56,189,248,0.28)] flex items-center shadow-xs transition-all text-left active:scale-[0.98] cursor-pointer ${
            isExpanded ? 'w-full p-2.5 gap-2.5' : 'w-10 h-10 justify-center p-0'
          }`}
        >
          {/* Avatar Dot / Initial */}
          <div className="w-8 h-8 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-extrabold flex items-center justify-center text-xs shadow-xs shrink-0 group-hover:scale-105 transition-transform">
            {currentUser?.displayName ? currentUser.displayName.charAt(0).toUpperCase() : 'G'}
          </div>

          {isExpanded && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-neutral-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                {currentUser?.displayName || 'Guest Explorer'}
              </p>
              <p className="text-[10px] text-neutral-500 dark:text-neutral-400 flex items-center gap-1 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span>{t('nav.profile', 'Profile & Account')} &rarr;</span>
              </p>
            </div>
          )}

          {!isExpanded && (
            <div className="absolute left-full ml-3 px-2.5 py-1 rounded-xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[11px] font-bold tracking-tight whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg hidden md:block">
              {currentUser?.displayName || t('nav.profile', 'Account Profile')}
            </div>
          )}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;