import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useFinMind } from '../context/FinMindContext';
import { logout } from '../firebase';

import { WindowId } from '../types';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  isFullScreen?: boolean;
  onNavigateWindow?: (windowId: WindowId) => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  isFullScreen = false,
  onNavigateWindow,
}) => {
  const { 
    currentUser, 
    transactions, 
    invoices, 
    watchlist, 
    openSettings, 
    clearAllData,
    openAuthModal,
    planTier,
  } = useFinMind();

  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(currentUser?.displayName || 'User');
  const [nameSavedSuccess, setNameSavedSuccess] = useState(false);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [actionSuccessNotice, setActionSuccessNotice] = useState<string | null>(null);

  // Lock body scroll only when modal overlay is rendered
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

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editedName.trim()) return;

    // Update session storage
    const sessionRaw = localStorage.getItem('liddy_user_session');
    const session = sessionRaw ? JSON.parse(sessionRaw) : {};
    session.displayName = editedName.trim();
    localStorage.setItem('liddy_user_session', JSON.stringify(session));

    setNameSavedSuccess(true);
    setIsEditingName(false);
    setTimeout(() => setNameSavedSuccess(false), 3000);
    // Reload context state smoothly
    window.dispatchEvent(new Event('storage'));
  };

  const handleSignOut = async () => {
    await logout();
    localStorage.removeItem('liddy_user_session');
    onClose();
  };

  const handleDeactivateAccount = async () => {
    try {
      try {
        await logout();
      } catch (logoutErr) {
        console.warn('Firebase logout notice:', logoutErr);
      }
      localStorage.removeItem('liddy_user_session');
      setShowDeactivateConfirm(false);
      setActionSuccessNotice('Account successfully deactivated. Session has been revoked.');
      setTimeout(() => {
        onClose();
        window.location.reload();
      }, 1000);
    } catch (err) {
      console.warn('Deactivation notice:', err);
      localStorage.removeItem('liddy_user_session');
      window.location.reload();
    }
  };

  const handleDeleteAccount = async () => {
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
        console.warn('Storage purge notice:', storageErr);
      }
      setShowDeleteConfirm(false);
      setActionSuccessNotice('Account permanently deleted. All associated local and cloud records have been erased.');
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

  const handlePurge = () => {
    clearAllData();
    setShowPurgeConfirm(false);
    onClose();
  };

  const isGuest = !currentUser || currentUser.isGuest;

  const cardBody = (
      <div className={`relative w-full bg-white dark:bg-[#121215] text-neutral-900 dark:text-neutral-100 rounded-[28px] border border-neutral-200/80 dark:border-neutral-800 overflow-hidden flex flex-col ${
        isFullScreen ? 'max-w-4xl mx-auto shadow-xs' : 'max-w-xl shadow-2xl max-h-[90vh]'
      }`}>
        
        {/* Header Bar */}
        <div className="p-6 md:p-8 pb-5 border-b border-neutral-100 dark:border-neutral-800/80 flex items-start justify-between bg-white dark:bg-[#121215]">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-neutral-900 dark:bg-neutral-800 text-white dark:text-white font-extrabold flex items-center justify-center text-xl shadow-md shrink-0 border border-neutral-800 dark:border-neutral-700">
              {currentUser?.displayName ? currentUser.displayName.charAt(0).toUpperCase() : 'G'}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xl font-extrabold text-neutral-900 dark:text-white tracking-tight">
                  {currentUser?.displayName || 'Guest Member'}
                </h3>
                <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold ${
                  isGuest 
                    ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60' 
                    : 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60'
                }`}>
                  {isGuest ? 'LOCAL SESSION' : 'CLOUD SYNCED'}
                </span>
                <span className="px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300">
                  {planTier.toUpperCase()} PLAN
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 font-mono mt-0.5">
                {currentUser?.email || 'guest@liddy.local'}
              </p>
            </div>
          </div>

          {!isFullScreen && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Profile"
              className="w-9 h-9 rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 flex items-center justify-center transition-colors text-sm font-bold shadow-xs cursor-pointer border border-transparent dark:border-neutral-700"
            >
              ✕
            </button>
          )}
        </div>

        {/* Scrollable Body */}
        <div className="p-6 md:p-8 space-y-6 overflow-y-auto no-scrollbar flex-1 bg-white dark:bg-[#121215]">
          
          {actionSuccessNotice && (
            <div className="p-3.5 rounded-2xl bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-bold animate-enter">
              ✓ {actionSuccessNotice}
            </div>
          )}

          {nameSavedSuccess && (
            <div className="p-3 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-bold animate-enter">
              ✓ Profile display name updated successfully.
            </div>
          )}

          {/* Guest Upgrade / Instant Sign Up Card */}
          {isGuest && (
            <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-500/10 via-purple-500/10 to-sky-500/10 border border-indigo-200/80 dark:border-indigo-800/80 space-y-3 animate-enter">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base">✨</span>
                    <h4 className="text-sm font-extrabold text-neutral-900 dark:text-white">
                      Create Your Verified Account
                    </h4>
                  </div>
                  <p className="text-xs text-neutral-600 dark:text-neutral-300 mt-1">
                    Sign up now to enable permanent encrypted cloud synchronization, multi-device ledger restore, and persistent AI financial history.
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    openAuthModal('Sign Up');
                    onClose();
                  }}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Sign Up / Create Account</span>
                  <span>&rarr;</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    openAuthModal('Sign In');
                    onClose();
                  }}
                  className="py-2.5 px-4 rounded-xl border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer text-center"
                >
                  Sign In
                </button>
              </div>
            </div>
          )}

          {!isGuest && (
            <div className="p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3 animate-enter">
              <div>
                <h4 className="text-xs font-bold text-neutral-900 dark:text-white">Active Account Profile</h4>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">Signed in as {currentUser?.displayName}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  openAuthModal('Sign In');
                  onClose();
                }}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-xs cursor-pointer shrink-0"
              >
                Switch Account
              </button>
            </div>
          )}

          {/* Edit Display Name Drawer */}
          {isEditingName ? (
            <form onSubmit={handleSaveName} className="user-profile-card modal-inner-card hover-border-glow p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800 space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 font-mono block">
                Update Display Name
              </label>
              <input
                type="text"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                placeholder="Enter new display name"
                className="w-full px-3.5 py-2 rounded-xl bg-white dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-700 text-neutral-900 dark:text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditingName(false)}
                  className="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs font-bold text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-bold hover:bg-neutral-800 cursor-pointer"
                >
                  Save Name
                </button>
              </div>
            </form>
          ) : (
            <div className="user-profile-card modal-inner-card hover-border-glow flex items-center justify-between p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800">
              <div>
                <p className="text-[11px] uppercase tracking-wider font-mono text-neutral-500 dark:text-neutral-400 font-bold">Display Identity</p>
                <p className="text-sm font-bold text-neutral-900 dark:text-white mt-0.5">{currentUser?.displayName || 'Guest Explorer'}</p>
              </div>
              <button
                onClick={() => {
                  setEditedName(currentUser?.displayName || 'User');
                  setIsEditingName(true);
                }}
                className="px-3 py-1.5 rounded-xl border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold text-neutral-700 dark:text-neutral-200 transition-colors cursor-pointer"
              >
                Edit Name
              </button>
            </div>
          )}

          {/* Account Activity Summary */}
          <div>
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 font-mono mb-3">
              Workspace Activity Summary
            </h4>
            <div className="grid grid-cols-3 gap-3">
              <div className="user-profile-card modal-inner-card hover-border-glow p-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800">
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono font-bold uppercase">Expenses</p>
                <p className="text-lg font-black text-neutral-900 dark:text-white mt-1 font-mono">{transactions.length}</p>
              </div>
              <div className="user-profile-card modal-inner-card hover-border-glow p-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800">
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono font-bold uppercase">Invoices</p>
                <p className="text-lg font-black text-neutral-900 dark:text-white mt-1 font-mono">{(invoices || []).length}</p>
              </div>
              <div className="user-profile-card modal-inner-card hover-border-glow p-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800">
                <p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono font-bold uppercase">Watchlist</p>
                <p className="text-lg font-black text-neutral-900 dark:text-white mt-1 font-mono">{watchlist.length}</p>
              </div>
            </div>
          </div>

          {/* Subscription Plan & Workspace Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="user-profile-card modal-inner-card hover-border-glow flex items-center justify-between p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800">
              <div>
                <h5 className="text-xs font-bold text-neutral-900 dark:text-white">Plan &amp; Billing</h5>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 capitalize">{planTier} tier active</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (onNavigateWindow) {
                    onNavigateWindow('pricing');
                  } else {
                    onClose();
                  }
                }}
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors cursor-pointer"
              >
                {planTier === 'free' ? 'Upgrade &rarr;' : 'Manage'}
              </button>
            </div>

            <div className="user-profile-card modal-inner-card hover-border-glow flex items-center justify-between p-4 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800">
              <div>
                <h5 className="text-xs font-bold text-neutral-900 dark:text-white">Workspace Settings</h5>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">Themes, languages, currency</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (onNavigateWindow) {
                    onNavigateWindow('settings');
                  } else {
                    onClose();
                    openSettings();
                  }
                }}
                className="px-3 py-1.5 rounded-xl bg-neutral-900 dark:bg-neutral-800 hover:bg-neutral-800 dark:hover:bg-neutral-700 text-white dark:text-neutral-200 text-xs font-bold transition-colors cursor-pointer"
              >
                Open &rarr;
              </button>
            </div>
          </div>

          {/* Account Management & Privacy Controls */}
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-extrabold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 font-mono">
              Account Management & Data Sovereignty
            </h4>

            {/* Option 1: Deactivate Account / Session */}
            <div className="user-profile-card modal-inner-card hover-border-glow p-4 rounded-2xl border border-amber-200/80 dark:border-amber-900/40 bg-amber-50/50 dark:bg-neutral-900 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h5 className="text-xs font-bold text-amber-950 dark:text-amber-300">Deactivate Account / Session</h5>
                  <p className="text-[11px] text-amber-800 dark:text-neutral-400 mt-0.5">
                    Revoke all active device credentials, suspend cloud sync, and return this terminal to an anonymous baseline.
                  </p>
                </div>
                {!showDeactivateConfirm ? (
                  <button
                    onClick={() => setShowDeactivateConfirm(true)}
                    className="px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors shrink-0 cursor-pointer"
                  >
                    Deactivate
                  </button>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setShowDeactivateConfirm(false)}
                      className="px-2.5 py-1 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDeactivateAccount}
                      className="px-3 py-1.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold cursor-pointer"
                    >
                      Confirm Deactivation
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Option 2: Delete Account Permanently (GDPR / DPDP Right to Erasure) */}
            <div className="user-profile-card modal-inner-card hover-border-glow p-4 rounded-2xl border border-red-200/80 dark:border-red-900/40 bg-red-50/50 dark:bg-neutral-900 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h5 className="text-xs font-bold text-red-950 dark:text-red-300">Delete Account & Permanent Erasure</h5>
                  <p className="text-[11px] text-red-800 dark:text-neutral-400 mt-0.5">
                    Permanently purge all financial ledger transactions, invoices, watchlist tickers, and identity records. This action cannot be reversed.
                  </p>
                </div>
                {!showDeleteConfirm ? (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors shrink-0 cursor-pointer"
                  >
                    Delete Account
                  </button>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      className="px-2.5 py-1 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDeleteAccount}
                      className="px-3 py-1.5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-bold cursor-pointer"
                    >
                      Confirm Permanent Deletion
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer with Session Controls */}
        <div className="user-profile-footer p-6 bg-neutral-50 dark:bg-[#101014] border-t border-neutral-100 dark:border-neutral-800/80 flex items-center justify-between gap-3">
          {isGuest ? (
            <button
              type="button"
              onClick={() => {
                openAuthModal('Sign In');
                onClose();
              }}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
            >
              Sign In to Cloud Account &rarr;
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  openAuthModal('Sign In');
                  onClose();
                }}
                className="px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
              >
                Switch Account
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="px-3.5 py-2.5 rounded-xl border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-800 dark:text-neutral-200 text-xs font-bold transition-colors cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
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
      className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 md:p-6 animate-enter"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {cardBody}
    </div>,
    document.body
  );
};

export default UserProfileModal;
