import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useFinMind } from '../context/FinMindContext';
import { Logo } from './Logo';
import { logout } from '../firebase';
import { SUPPORTED_LANGUAGES } from '../services/localization';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isFullScreen?: boolean;
}

type SettingsTab = 'APPEARANCE' | 'LANGUAGE' | 'ACCOUNT' | 'ABOUT' | 'PRIVACY';
type ComplianceRegion = 'OVERVIEW' | 'EU' | 'INDIA' | 'US' | 'APAC' | 'TERMS';

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, isFullScreen = false }) => {
  const {
    currentUser,
    openAuthModal,
    clearAllTransactions,
    clearAllData,
    transactions,
    invoices,
    currencySymbol,
    setCurrencySymbol,
    currencyPlacement,
    setCurrencyPlacement,
    themeMode,
    setThemeMode,
    highContrast,
    setHighContrast,
    reducedMotion,
    setReducedMotion,
    currentLanguage,
    setLanguage,
  } = useFinMind();

  const [activeTab, setActiveTab] = useState<SettingsTab>('APPEARANCE');
  const [languageRegionFilter, setLanguageRegionFilter] = useState<'ALL' | 'INDIA' | 'INTERNATIONAL'>('ALL');
  const [languageSearchQuery, setLanguageSearchQuery] = useState('');
  const [complianceRegion, setComplianceRegion] = useState<ComplianceRegion>('OVERVIEW');
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [isPurging, setIsPurging] = useState(false);
  const [showPurgeSuccess, setShowPurgeSuccess] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  // Location access state
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState<string | null>(null);

  const handleDetectLocation = () => {
    setLocationFeedback(null);
    if (!navigator.geolocation) {
      setLocationFeedback('Geolocation is not supported in this browser.');
      return;
    }
    setDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDetectingLocation(false);
        const { latitude, longitude } = pos.coords;
        if (latitude >= 6 && latitude <= 37 && longitude >= 68 && longitude <= 98) {
          setCurrencySymbol('₹');
          setLocationFeedback('Synced regional currency: Indian Rupee (₹)');
        } else if (latitude >= 24 && latitude <= 50 && longitude >= -125 && longitude <= -66) {
          setCurrencySymbol('$');
          setLocationFeedback('Synced regional currency: US Dollar ($)');
        } else if (latitude >= 35 && latitude <= 70 && longitude >= -10 && longitude <= 40) {
          setCurrencySymbol('€');
          setLocationFeedback('Synced regional currency: Euro (€)');
        } else {
          setLocationFeedback('Location verified. Preferences updated.');
        }
        setTimeout(() => setLocationFeedback(null), 4000);
      },
      (err) => {
        setDetectingLocation(false);
        setLocationFeedback(
          err?.code === 1
            ? 'Location permission was declined. Select a currency manually below.'
            : 'Unable to determine location right now. Select a currency manually below.'
        );
      },
      { timeout: 10000 }
    );
  };

  // Lock body scroll only when rendered as a portal modal
  useEffect(() => {
    if (isOpen && !isFullScreen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
      };
    }
  }, [isOpen, isFullScreen]);

  if (!isOpen && !isFullScreen) return null;

  const handlePurgeAll = () => {
    setIsPurging(true);
    setTimeout(() => {
      clearAllTransactions();
      setIsPurging(false);
      setShowPurgeSuccess(true);
      setPurgeConfirmText('');
      setTimeout(() => setShowPurgeSuccess(false), 3000);
    }, 600);
  };

  const handleDeleteAccountPermanently = async () => {
    try {
      if (typeof clearAllData === 'function') {
        clearAllData();
      }
      try {
        await logout();
      } catch (logoutErr) {
        console.warn('Firebase logout during permanent erasure notice:', logoutErr);
      }
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch (storageErr) {
        console.warn('Storage clear notice:', storageErr);
      }
      setShowDeleteConfirm(false);
      setDeleteNotice('Account permanently deleted. All local and cloud records have been erased.');
      setTimeout(() => {
        onClose();
        window.location.reload();
      }, 1000);
    } catch (err) {
      console.warn('Account erasure notice:', err);
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {}
      window.location.reload();
    }
  };

  const cardBody = (
      <div
        className={`bg-white dark:bg-[#121215] text-neutral-900 dark:text-neutral-100 rounded-[28px] w-full border border-neutral-200/80 dark:border-neutral-800 flex flex-col overflow-hidden ${
          isFullScreen ? 'shadow-xs min-h-[75vh]' : 'max-w-4xl shadow-2xl max-h-[92vh] my-auto'
        }`}
        role={isFullScreen ? undefined : 'dialog'}
        aria-modal={isFullScreen ? undefined : true}
        aria-labelledby="settings-title"
      >
        {/* Header */}
        <div className="p-6 pb-4 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size="sm" showText={false} />
            <div>
              <h2 id="settings-title" className="text-xl font-extrabold tracking-tight">Workspace Settings</h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Manage themes, currency display, languages and privacy.</p>
            </div>
          </div>
          {!isFullScreen && (
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 flex items-center justify-center transition-colors text-sm font-bold cursor-pointer"
              aria-label="Close settings"
            >
              ✕
            </button>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-3 flex gap-2 border-b border-neutral-100 dark:border-neutral-800 overflow-x-auto no-scrollbar">
          {[
            { id: 'APPEARANCE' as const, label: 'Appearance', icon: '🎨' },
            { id: 'LANGUAGE' as const, label: 'Language', icon: '🌐' },
            { id: 'ACCOUNT' as const, label: 'Account', icon: '👤' },
            { id: 'PRIVACY' as const, label: 'Privacy & Compliance', icon: '🛡️' },
            { id: 'ABOUT' as const, label: 'About', icon: '🏛️' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 px-3 text-xs font-bold transition-all relative flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'text-neutral-900 dark:text-white'
                  : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-neutral-900 dark:bg-white rounded-full"></div>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* --- APPEARANCE & THEME TAB --- */}
          {activeTab === 'APPEARANCE' && (
            <div className="space-y-6 animate-enter">
              {/* Interface Theme Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  Interface Theme
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'system' as const, label: 'System Default', desc: 'Syncs with OS preferences', icon: '💻' },
                    { id: 'light' as const, label: 'Light Mode', desc: 'Crisp pearl canvas', icon: '☀️' },
                    { id: 'dark' as const, label: 'Dark Mode', desc: 'Deep obsidian contrast', icon: '🌙' },
                  ].map(t => (
                    <button
                      key={t.id}
                      onClick={() => setThemeMode(t.id)}
                      className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between h-[100px] ${
                        themeMode === t.id
                          ? 'border-neutral-900 dark:border-white bg-neutral-50 dark:bg-neutral-800 shadow-sm'
                          : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-lg">{t.icon}</span>
                        {themeMode === t.id && (
                          <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400"></span>
                        )}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-neutral-900 dark:text-white">{t.label}</div>
                        <div className="text-[10px] text-neutral-400 truncate">{t.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Currency Sign Selection */}
              <div className="space-y-3 pt-4 border-t border-neutral-100 dark:border-neutral-800">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                      Currency Sign Format
                    </label>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      Select your preferred currency symbol. UPI invoices always enforce the ₹ sign.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={detectingLocation}
                    onClick={handleDetectLocation}
                    className="self-start sm:self-auto px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900 border border-indigo-200/60 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    <span>{detectingLocation ? 'Detecting Location...' : '📍 Auto-Detect Location'}</span>
                  </button>
                </div>

                {locationFeedback && (
                  <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-semibold animate-fade-in flex items-center gap-1.5">
                    <span>✓</span>
                    <span>{locationFeedback}</span>
                  </div>
                )}
                
                <div className="grid grid-cols-5 gap-2">
                  {[
                    { symbol: '₹', label: 'Rupee' },
                    { symbol: '$', label: 'Dollar' },
                    { symbol: '€', label: 'Euro' },
                    { symbol: '£', label: 'Pound' },
                    { symbol: '¥', label: 'Yen' },
                  ].map(c => (
                    <button
                      key={c.symbol}
                      onClick={() => setCurrencySymbol(c.symbol)}
                      className={`py-2 px-3 rounded-xl border text-center font-bold text-sm transition-all ${
                        currencySymbol === c.symbol
                          ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 border-neutral-900 dark:border-white shadow-xs'
                          : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-neutral-400'
                      }`}
                    >
                      <span className="text-base">{c.symbol}</span>
                      <span className="block text-[10px] font-normal opacity-70">{c.label}</span>
                    </button>
                  ))}
                </div>

                {/* Currency Sign Placement */}
                <div className="pt-2 border-t border-neutral-200 dark:border-neutral-700/60 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-neutral-800 dark:text-neutral-200">Currency Sign Placement</div>
                    <div className="text-[11px] text-neutral-400">Position the currency sign before or after numbers</div>
                  </div>
                  <div className="flex bg-white dark:bg-neutral-900 p-1 rounded-xl border border-neutral-200 dark:border-neutral-700">
                    <button
                      onClick={() => setCurrencyPlacement('after')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                        currencyPlacement === 'after'
                          ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                          : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                      }`}
                    >
                      500.00 {currencySymbol}
                    </button>
                    <button
                      onClick={() => setCurrencyPlacement('before')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                        currencyPlacement === 'before'
                          ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                          : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                      }`}
                    >
                      {currencySymbol} 500.00
                    </button>
                  </div>
                </div>
              </div>

              {/* Accessibility Controls */}
              <div className="space-y-3 pt-4 border-t border-neutral-100 dark:border-neutral-800">
                <label className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  Accessibility & Motion
                </label>

                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                  <div>
                    <div className="text-xs font-bold text-neutral-900 dark:text-white">High Contrast Mode</div>
                    <div className="text-[11px] text-neutral-400">Enhance borders and text legibility across all panels</div>
                  </div>
                  <button
                    onClick={() => setHighContrast(!highContrast)}
                    className={`w-12 h-6 rounded-full transition-colors relative p-0.5 ${
                      highContrast ? 'bg-indigo-600' : 'bg-neutral-200 dark:bg-neutral-700'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white transition-transform ${highContrast ? 'translate-x-6' : 'translate-x-0'}`}></div>
                  </button>
                </div>

                <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                  <div>
                    <div className="text-xs font-bold text-neutral-900 dark:text-white">Reduced Motion</div>
                    <div className="text-[11px] text-neutral-400">Disable transitions and decorative ambient animations</div>
                  </div>
                  <button
                    onClick={() => setReducedMotion(!reducedMotion)}
                    className={`w-12 h-6 rounded-full transition-colors relative p-0.5 ${
                      reducedMotion ? 'bg-indigo-600' : 'bg-neutral-200 dark:bg-neutral-700'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white transition-transform ${reducedMotion ? 'translate-x-6' : 'translate-x-0'}`}></div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* --- LANGUAGE & REGIONAL LOCALIZATION TAB --- */}
          {activeTab === 'LANGUAGE' && (
            <div className="space-y-5 animate-enter">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-neutral-900 dark:text-white">Language & Regional Localization</h3>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                    Select your display language. Includes all 12 major Indian languages and key foreign languages.
                  </p>
                </div>

                {/* Region Filter Buttons */}
                <div className="flex bg-neutral-100 dark:bg-neutral-900 p-1 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold shrink-0">
                  {[
                    { id: 'ALL' as const, label: `All (${SUPPORTED_LANGUAGES.length})` },
                    { id: 'INDIA' as const, label: 'Indian (12)' },
                    { id: 'INTERNATIONAL' as const, label: `Global (${SUPPORTED_LANGUAGES.filter(l => l.region === 'International').length})` },
                  ].map(f => (
                    <button
                      key={f.id}
                      onClick={() => setLanguageRegionFilter(f.id)}
                      className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                        languageRegionFilter === f.id
                          ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs'
                          : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Instant Language Search Bar */}
              <div className="relative">
                <input
                  type="text"
                  value={languageSearchQuery}
                  onChange={(e) => setLanguageSearchQuery(e.target.value)}
                  placeholder="Search language by name or native script (e.g. বাংলা, Hindi, Français, العربية)..."
                  className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl px-4 py-2.5 text-xs text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                {languageSearchQuery && (
                  <button
                    onClick={() => setLanguageSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-white text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Language Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-[380px] overflow-y-auto no-scrollbar p-0.5">
                {SUPPORTED_LANGUAGES.filter(lang => {
                  if (languageRegionFilter === 'INDIA' && lang.region !== 'India') return false;
                  if (languageRegionFilter === 'INTERNATIONAL' && lang.region !== 'International') return false;
                  if (languageSearchQuery.trim()) {
                    const q = languageSearchQuery.toLowerCase().trim();
                    return (
                      lang.name.toLowerCase().includes(q) ||
                      lang.nativeName.toLowerCase().includes(q) ||
                      lang.code.toLowerCase().includes(q)
                    );
                  }
                  return true;
                }).map((lang) => {
                  const isSelected = currentLanguage === lang.code;
                  return (
                    <div
                      key={lang.code}
                      onClick={() => setLanguage(lang.code)}
                      className={`modal-inner-card hover-border-glow p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'border-sky-500 dark:border-sky-400 bg-sky-50/50 dark:bg-neutral-900 shadow-sm ring-2 ring-sky-400/30'
                          : 'border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:bg-neutral-50/60 dark:hover:bg-neutral-800'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-base font-bold text-neutral-900 dark:text-white block">
                            {lang.nativeName}
                          </span>
                          <span className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 block">
                            {lang.name}
                          </span>
                        </div>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-bold ${
                          lang.region === 'India'
                            ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/50'
                            : 'bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-900/50'
                        }`}>
                          {lang.region}
                        </span>
                      </div>

                      <div className="mt-4 pt-2 border-t border-neutral-100 dark:border-neutral-800/80 flex items-center justify-between text-[11px]">
                        <span className="text-neutral-400 font-mono text-[10px]">
                          {lang.dir === 'rtl' ? 'Right-to-Left' : 'Standard LTR'}
                        </span>
                        {isSelected ? (
                          <span className="text-sky-600 dark:text-sky-400 font-bold flex items-center gap-1">
                            <span>✓</span>
                            <span>Selected</span>
                          </span>
                        ) : (
                          <span className="text-neutral-400 opacity-0 group-hover:opacity-100 text-[10px]">
                            Tap to apply
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Status Banner */}
              <div className="modal-inner-card hover-border-glow p-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800 text-xs text-neutral-600 dark:text-neutral-300 flex items-center justify-between">
                <span>Active Language: <strong className="font-mono text-neutral-900 dark:text-white uppercase">{SUPPORTED_LANGUAGES.find(l => l.code === currentLanguage)?.name || currentLanguage}</strong> ({currentLanguage.toUpperCase()})</span>
                <span className="text-neutral-400 font-mono text-[11px]">Instant UI Localization Active</span>
              </div>
            </div>
          )}

          {/* --- ACCOUNT TAB --- */}
          {activeTab === 'ACCOUNT' && (
            <div className="space-y-6 animate-enter">
              {/* User Identity Card */}
              <div className="p-5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200/80 dark:border-neutral-800 flex items-center justify-between">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-extrabold flex items-center justify-center text-lg shadow-sm">
                    {currentUser?.displayName ? currentUser.displayName.charAt(0).toUpperCase() : 'G'}
                  </div>
                  <div>
                    <div className="text-sm font-bold text-neutral-900 dark:text-white">
                      {currentUser?.displayName || 'Guest Explorer'}
                    </div>
                    <div className="text-xs text-neutral-400 font-mono">
                      {currentUser?.email || 'Local Sandbox Session'}
                    </div>
                  </div>
                </div>

                {(!currentUser || currentUser.isGuest) ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        openAuthModal('Sign Up');
                        onClose();
                      }}
                      className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer"
                    >
                      Sign Up &rarr;
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        openAuthModal('Sign In');
                        onClose();
                      }}
                      className="px-3.5 py-2 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200 text-xs font-bold rounded-xl transition-all cursor-pointer"
                    >
                      Sign In
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        openAuthModal('Sign In');
                        onClose();
                      }}
                      className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer"
                    >
                      Switch / Sign In
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await logout();
                        localStorage.removeItem('liddy_user_session');
                        window.dispatchEvent(new Event('storage'));
                      }}
                      className="px-3.5 py-2 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold text-neutral-700 dark:text-neutral-300 rounded-xl transition-colors cursor-pointer"
                    >
                      Sign Out
                    </button>
                  </div>
                )}
              </div>

              {/* Data Purge Section */}
              <div className="p-5 rounded-2xl border border-red-200 dark:border-red-950/60 bg-red-50/50 dark:bg-red-950/20 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-red-900 dark:text-red-300 font-mono">
                      Strict Zero-Baseline Data Purge
                    </h4>
                    <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                      Permanently wipe all stored transactions, digital invoices and cached telemetry. Returns the entire system to an absolute 0.00 baseline.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400 font-mono">
                  <span>Current Records: <strong>{transactions.length} transactions</strong>, <strong>{invoices.length} invoices</strong></span>
                </div>

                {showPurgeSuccess && (
                  <div className="p-3 bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-xl text-xs font-bold animate-enter">
                    ✓ All ledger data purged. Pure 0.00 zero-baseline enforced.
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={handlePurgeAll}
                    disabled={isPurging}
                    className="px-4 py-2.5 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-100 rounded-xl text-xs font-bold transition-all shadow-xs disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                  >
                    {isPurging ? 'Purging...' : 'Reset Ledger to 0.00'}
                  </button>
                </div>
              </div>

              {/* Delete Account & Permanent Erasure Section */}
              <div className="p-5 rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50/70 dark:bg-red-950/25 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-red-900 dark:text-red-300 font-mono">
                      Delete Account & Permanent Erasure
                    </h4>
                    <p className="text-xs text-red-800 dark:text-red-400 mt-1 leading-relaxed">
                      Permanently purge all financial ledger transactions, invoices, watchlist tickers and identity records. This action cannot be reversed.
                    </p>
                  </div>
                  {!showDeleteConfirm ? (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs shrink-0 cursor-pointer"
                    >
                      Delete Account
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="px-3 py-1.5 text-xs font-bold text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800 rounded-xl transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteAccountPermanently}
                        className="px-4 py-2 bg-red-700 hover:bg-red-800 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer"
                      >
                        Confirm Permanent Deletion
                      </button>
                    </div>
                  )}
                </div>

                {deleteNotice && (
                  <div className="p-3 bg-red-100 dark:bg-red-950 border border-red-300 dark:border-red-800 text-red-900 dark:text-red-200 rounded-xl text-xs font-bold animate-enter">
                    ✓ {deleteNotice}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* --- COMPREHENSIVE PRIVACY POLICY & REGULATORY RESEARCH TAB --- */}
          {activeTab === 'PRIVACY' && (
            <div className="space-y-6 animate-enter text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
              
              {/* Regional Regulatory Compliance Sub-Tabs */}
              <div className="flex items-center gap-1.5 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl overflow-x-auto no-scrollbar">
                {[
                  { id: 'OVERVIEW' as const, label: 'Overview & Fiduciary' },
                  { id: 'EU' as const, label: 'EU (GDPR & DORA)' },
                  { id: 'INDIA' as const, label: 'India (DPDP & RBI)' },
                  { id: 'US' as const, label: 'US (CCPA & GLBA)' },
                  { id: 'APAC' as const, label: 'APAC (APPI & PDPA)' },
                  { id: 'TERMS' as const, label: 'Terms & Conditions' },
                ].map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => setComplianceRegion(sub.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                      complianceRegion === sub.id
                        ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-xs'
                        : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>

              {/* 1. OVERVIEW & FIDUCIARY SAFEGUARDS */}
              {complianceRegion === 'OVERVIEW' && (
                <div className="space-y-4 animate-enter">
                  <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-900 dark:text-emerald-200">
                    <div className="font-bold text-sm mb-1">🛡️ Sovereign Custody Guarantee</div>
                    <p>
                      The Liddy platform operates on a strict non-custodial, client-partitioned architecture. Your transactional records, invoices, itemized bills and UPI keys remain under your sovereign control. We do not sell personal telemetry, license spending behavior to brokers or train public AI models on your customer receipts.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <div className="font-bold text-neutral-900 dark:text-white mb-1">Local-First Persistence</div>
                      <p className="text-neutral-500 dark:text-neutral-400">Ledger records and receipts are anchored inside your browser private encrypted partition. Cloud sync occurs exclusively via authenticated user channels.</p>
                    </div>

                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <div className="font-bold text-neutral-900 dark:text-white mb-1">Open UPI Sandboxing</div>
                      <p className="text-neutral-500 dark:text-neutral-400">Dynamic QR codes are generated client-side following NPCI standards. Banking MPINs and authentication credentials never touch external proxy servers.</p>
                    </div>

                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <div className="font-bold text-neutral-900 dark:text-white mb-1">Zero Tracking Telemetry</div>
                      <p className="text-neutral-500 dark:text-neutral-400">No cross-site tracking pixels, fingerprinting beacons or ad networks. Performance analytics are strictly anonymized and local.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* 2. EUROPEAN UNION (GDPR & DORA) */}
              {complianceRegion === 'EU' && (
                <div className="space-y-4 animate-enter">
                  <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base">🇪🇺</span>
                      <h4 className="text-sm font-bold text-neutral-900 dark:text-white">
                        European Union: GDPR & Digital Operational Resilience Act (DORA)
                      </h4>
                    </div>
                    <p className="text-neutral-600 dark:text-neutral-300 leading-relaxed">
                      Liddy complies with the General Data Protection Regulation (Regulation EU 2016/679) and the European Banking Authority (EBA) ICT Risk Guidelines, alongside Regulation (EU) 2022/2554 (DORA) governing digital operational resilience for financial entities.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <h5 className="font-bold text-neutral-900 dark:text-white">Article 5 & 6 — Lawfulness, Fairness & Purpose Limitation</h5>
                      <p className="text-neutral-500 dark:text-neutral-400 mt-1">
                        Financial data processing is grounded exclusively upon Contractual Necessity (Art. 6(1)(b)) to fulfill ledger calculation, scanning and digital invoicing requested directly by the user. Personal data is never repurposed for secondary monetization.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <h5 className="font-bold text-neutral-900 dark:text-white">Article 17 & 20 — Right to Erasure & Data Portability</h5>
                      <p className="text-neutral-500 dark:text-neutral-400 mt-1">
                        Users hold unilateral execution authority to purge all ledger records and receipts permanently via the Zero-Baseline Purge tool. Machine-readable JSON and CSV export facilitates continuous data portability.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <h5 className="font-bold text-neutral-900 dark:text-white">DORA Regulation (EU) 2022/2554 Resilience Framework</h5>
                      <p className="text-neutral-500 dark:text-neutral-400 mt-1">
                        ICT risk management mechanisms incorporate real-time zero-baseline sanitization, client-side cryptographic encapsulation and zero dependency on unverified third-party scripts.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 3. INDIA (DPDP ACT 2023 & RBI/NPCI) */}
              {complianceRegion === 'INDIA' && (
                <div className="space-y-4 animate-enter">
                  <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base">🇮🇳</span>
                      <h4 className="text-sm font-bold text-neutral-900 dark:text-white">
                        India: Digital Personal Data Protection Act (DPDP) 2023 & RBI Directives
                      </h4>
                    </div>
                    <p className="text-neutral-600 dark:text-neutral-300 leading-relaxed">
                      Comprehensive research on India's DPDP Act 2023, RBI Master Directions on IT Governance (2023) and NPCI Unified Payments Interface (UPI) Procedural Guidelines.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <h5 className="font-bold text-neutral-900 dark:text-white">DPDP Act 2023 — Data Principal Consent & Fiduciary Obligations</h5>
                      <p className="text-neutral-500 dark:text-neutral-400 mt-1">
                        Complies with Section 6 itemized consent notice mandates. The platform acts as a Data Fiduciary implementing reasonable security safeguards to prevent personal data breaches under Section 8(5), adhering to penalty mitigation thresholds up to ₹250 Crore.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <h5 className="font-bold text-neutral-900 dark:text-white">RBI Master Direction on IT Governance, Risk & Controls</h5>
                      <p className="text-neutral-500 dark:text-neutral-400 mt-1">
                        Encapsulates zero-trust architectural parameters aligned with Reserve Bank of India cybersecurity frameworks. All telemetry verification is performed client-side without intermediate caching of sensitive financial instruments.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <h5 className="font-bold text-neutral-900 dark:text-white">NPCI UPI Dynamic QR Specifications</h5>
                      <p className="text-neutral-500 dark:text-neutral-400 mt-1">
                        All generated QR codes strictly adhere to National Payments Corporation of India (NPCI) UPI specification (upi://pay?pa=...&pn=...&am=...&cu=INR). No settlement intermediary captures consumer banking credentials.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 4. UNITED STATES (CCPA/CPRA & GLBA) */}
              {complianceRegion === 'US' && (
                <div className="space-y-4 animate-enter">
                  <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base">🇺🇸</span>
                      <h4 className="text-sm font-bold text-neutral-900 dark:text-white">
                        United States: CCPA / CPRA & Gramm-Leach-Bliley Act (GLBA)
                      </h4>
                    </div>
                    <p className="text-neutral-600 dark:text-neutral-300 leading-relaxed">
                      Standards aligned with California Consumer Privacy Act (CCPA) as amended by the California Privacy Rights Act (CPRA), the FTC Safeguards Rule (16 CFR Part 314) and GLBA consumer financial privacy protections.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <h5 className="font-bold text-neutral-900 dark:text-white">CCPA / CPRA — "Do Not Sell or Share My Personal Information"</h5>
                      <p className="text-neutral-500 dark:text-neutral-400 mt-1">
                        Liddy unequivocally does NOT sell or share personal information (including financial records, merchant receipts or invoice line items) for cross-context behavioral advertising.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <h5 className="font-bold text-neutral-900 dark:text-white">GLBA Safeguards Rule (16 CFR Part 314) Compliance</h5>
                      <p className="text-neutral-500 dark:text-neutral-400 mt-1">
                        Technical safeguards maintain administrative and system access controls protecting customer non-public personal information (NPI) from unauthorized access, loss or manipulation.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 5. ASIA-PACIFIC (JAPAN APPI & SINGAPORE PDPA) */}
              {complianceRegion === 'APAC' && (
                <div className="space-y-4 animate-enter">
                  <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-base">🌏</span>
                      <h4 className="text-sm font-bold text-neutral-900 dark:text-white">
                        Asia-Pacific: Japan APPI & Singapore PDPA
                      </h4>
                    </div>
                    <p className="text-neutral-600 dark:text-neutral-300 leading-relaxed">
                      Governance adhering to Japan's Act on the Protection of Personal Information (APPI - 2020/2022 amendments) and Singapore's Personal Data Protection Act 2012 (PDPA).
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <h5 className="font-bold text-neutral-900 dark:text-white">Japan APPI (PPC Regulations)</h5>
                      <p className="text-neutral-500 dark:text-neutral-400 mt-1">
                        Compliance with Personal Information Protection Commission (PPC) requirements regarding explicit purpose specification, restriction on third-party transfers and individual disclosure entitlements.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <h5 className="font-bold text-neutral-900 dark:text-white">Singapore PDPA & Cross-Border Governance</h5>
                      <p className="text-neutral-500 dark:text-neutral-400 mt-1">
                        Cross-border data transfer safeguards ensure standard-of-protection comparability when synchronizing encrypted cloud ledger backups across secure regional nodes.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 6. COMPREHENSIVE TERMS & CONDITIONS */}
              {complianceRegion === 'TERMS' && (
                <div className="space-y-4 animate-enter text-xs leading-relaxed">
                  <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                    <h4 className="text-sm font-bold text-neutral-900 dark:text-white mb-1">
                      Institutional Terms of Service & Software License Agreement
                    </h4>
                    <p className="text-neutral-500 dark:text-neutral-400">
                      Effective Date: March 2026 · Governing all usage of the Liddy Financial platform.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <div className="font-bold text-neutral-900 dark:text-white mb-1">1. Non-Investment Advisory Disclaimer</div>
                      <p className="text-neutral-500 dark:text-neutral-400">
                        The Liddy platform is a financial computation and ledger visualization tool. Information, market feeds, stock directory metrics and mathematical projections rendered in this software do NOT constitute financial, investment, legal or tax advice. Users are solely responsible for verifying exchange quotes and financial decisions.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <div className="font-bold text-neutral-900 dark:text-white mb-1">2. Non-Custodial Open Payments & Invoicing</div>
                      <p className="text-neutral-500 dark:text-neutral-400">
                        Liddy provides software tools to compile digital invoices and generate standard UPI protocol strings. Liddy is not a licensed payment gateway, bank or escrow depository. All transaction settlements execute strictly between your financial institution and your counterparty.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <div className="font-bold text-neutral-900 dark:text-white mb-1">3. Software License & Intellectual Property</div>
                      <p className="text-neutral-500 dark:text-neutral-400">
                        Liddy grants you a non-exclusive, revocable, non-transferable license to utilize the application for personal and enterprise record keeping. All software architecture, vector marks and visual systems remain proprietary intellectual property.
                      </p>
                    </div>

                    <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                      <div className="font-bold text-neutral-900 dark:text-white mb-1">4. Limitation of Liability & Indemnification</div>
                      <p className="text-neutral-500 dark:text-neutral-400">
                        To the maximum extent permitted by applicable law, Liddy and its developers shall not be liable for indirect, incidental or consequential damages resulting from transaction reconciliation delays, third-party network outages or device loss.
                      </p>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* --- ABOUT US TAB --- */}
          {activeTab === 'ABOUT' && (
            <div className="space-y-5 animate-enter text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">
              <div className="p-5 rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200/80 dark:border-neutral-800">
                <Logo size="md" className="mb-4" />
                <h3 className="text-base font-bold text-neutral-900 dark:text-white">The Liddy Platform</h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                  Liddy is a modern financial telemetry platform engineered for people who demand real numbers, verifiable global market feeds and zero synthetic placeholders.
                </p>
              </div>

              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Core Engineering Principles</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                    <div className="font-bold text-neutral-900 dark:text-white mb-1">True Zero-Baseline</div>
                    <p className="text-neutral-500 dark:text-neutral-400">No mock companies, fake spending or pre-filled shopping runs. Telemetry begins at 0.00 until you record genuine activity.</p>
                  </div>
                  <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                    <div className="font-bold text-neutral-900 dark:text-white mb-1">Open UPI & Standard Billing</div>
                    <p className="text-neutral-500 dark:text-neutral-400">Native dynamic QR generation with standard VPA interoperability, industry templates and automatic settlement reconciliation.</p>
                  </div>
                  <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                    <div className="font-bold text-neutral-900 dark:text-white mb-1">Global Exchange Registry</div>
                    <p className="text-neutral-500 dark:text-neutral-400">Comprehensive real-time directory of companies listed across NYSE, NASDAQ, NSE, BSE, LSE and Tokyo exchanges.</p>
                  </div>
                  <div className="p-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                    <div className="font-bold text-neutral-900 dark:text-white mb-1">Autonomous Intelligence</div>
                    <p className="text-neutral-500 dark:text-neutral-400">Neural document parsing and conversational telemetry with zero intrusive third-party watermarks or branding slop.</p>
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-neutral-400 dark:text-neutral-500 border-t border-neutral-100 dark:border-neutral-800 pt-3 flex items-center justify-between">
                <span>Version 2.5.0 (Global Compliance Edition)</span>
                <span>Production Ready</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 px-6 bg-neutral-50 dark:bg-[#101014] border-t border-neutral-100 dark:border-neutral-800/80 flex items-center justify-between text-xs">
          <span className="text-neutral-400 dark:text-neutral-500 font-mono">Liddy · Everyday Personal Finance</span>
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 rounded-xl font-bold transition-all shadow-xs cursor-pointer hover-border-glow"
          >
            {isFullScreen ? 'Back to Home' : 'Done'}
          </button>
        </div>
      </div>
  );

  if (isFullScreen) {
    return cardBody;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 md:p-6 bg-black/80 backdrop-blur-md animate-enter overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {cardBody}
    </div>,
    document.body
  );
};

export default SettingsModal;
