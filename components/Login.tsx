import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { signInWithGoogle, signUpWithEmail, signInWithEmail, sendPasswordReset } from '../firebase';
import { Logo } from './Logo';
import { useFinMind, LiddyUser } from '../context/FinMindContext';
import architecturalBg from '../src/assets/images/architectural_wealth_glass_1792761653339.jpg';

interface LoginProps {
  onSuccess?: () => void;
  onDismiss?: () => void;
  featureReason?: string;
  isModal?: boolean;
}

export const Login: React.FC<LoginProps> = ({
  onSuccess,
  onDismiss,
  featureReason,
  isModal = true,
}) => {
  const { currentUser, loginUser, logoutUser } = useFinMind();
  
  // Initialize mode intelligently based on context reason
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>(() => {
    if (featureReason && /sign\s*in|login/i.test(featureReason)) return 'signin';
    return 'signup';
  });

  useEffect(() => {
    if (featureReason) {
      if (/sign\s*in|login/i.test(featureReason)) {
        setAuthMode('signin');
      } else if (/sign\s*up|register/i.test(featureReason)) {
        setAuthMode('signup');
      }
    }
  }, [featureReason]);
  
  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // Status states
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Prevent mobile synthetic touch clicks from dismissing on mount
  const [mountedTime] = useState(() => Date.now());

  // Safe dismiss & return that guaranteed unlocks body scroll
  const handleReturnToDashboard = () => {
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    if (onDismiss) onDismiss();
    else if (onSuccess) onSuccess();
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('scroll'));
    }, 50);
  };

  // Safe body scroll locking and unconditional release on unmount
  useEffect(() => {
    if (isModal) {
      document.body.style.overflow = 'hidden';
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          handleReturnToDashboard();
        }
      };
      window.addEventListener('keydown', onKeyDown);

      return () => {
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
        window.removeEventListener('keydown', onKeyDown);
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('scroll'));
      };
    }
  }, [isModal]);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const user = await signInWithGoogle();
      if (user) {
        const mappedUser: LiddyUser = {
          displayName: user.displayName || user.email?.split('@')[0] || 'Member',
          email: user.email || '',
          photoURL: user.photoURL || undefined,
          isGuest: false,
        };
        loginUser(mappedUser);
        handleReturnToDashboard();
      }
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') {
        setErrorMsg('Sign-in popup was closed before completion. Please try again.');
      } else if (err?.code === 'auth/popup-blocked') {
        setErrorMsg('Browser popup was blocked. Please allow popups or use email & password sign-in.');
      } else if (err?.code === 'auth/operation-not-allowed') {
        setErrorMsg('Google sign-in is not enabled in Firebase Authentication for this project.');
      } else if (err?.code === 'auth/network-request-failed') {
        setErrorMsg('Network error while contacting Google Authentication. Please check your connection.');
      } else {
        setErrorMsg(err?.message || 'Google sign-in could not be completed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const mapFirebaseAuthError = (err: any): string => {
    switch (err?.code) {
      case 'auth/email-already-in-use':
        return 'This email address is already registered. Please sign in instead.';
      case 'auth/weak-password':
        return 'Password should be at least 6 characters with letters and numbers.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/invalid-credential':
      case 'auth/user-not-found':
      case 'auth/wrong-password':
        return 'Incorrect email or password. Please verify your credentials or create an account.';
      case 'auth/too-many-requests':
        return 'Too many failed attempts. Please wait a moment before trying again.';
      case 'auth/operation-not-allowed':
        return 'Email/Password sign-in is currently disabled in Firebase Authentication settings.';
      case 'auth/network-request-failed':
        return 'Network error while reaching authentication servers. Please check your connection.';
      default:
        return err?.message || 'Authentication failed. Please check your credentials and try again.';
    }
  };

  const handlePasswordReset = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
      setErrorMsg('Enter your email address above first so we can send a password reset link.');
      return;
    }
    setIsLoading(true);
    try {
      await sendPasswordReset(trimmedEmail);
      setSuccessMsg(`Password reset instructions sent to ${trimmedEmail}. Check your inbox.`);
    } catch (err: any) {
      setErrorMsg(mapFirebaseAuthError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const trimmedEmail = email.trim();
      if (!trimmedEmail.includes('@') || !trimmedEmail.includes('.')) {
        setErrorMsg('Please enter a valid email address.');
        return;
      }

      if (password.length < 6) {
        setErrorMsg('Password must be at least 6 characters long.');
        return;
      }

      if (authMode === 'signup') {
        if (!name.trim()) {
          setErrorMsg('Please enter your full name or legal alias.');
          return;
        }

        if (password !== confirmPassword) {
          setErrorMsg('Passwords do not match. Please verify.');
          return;
        }

        try {
          const newUser = await signUpWithEmail(trimmedEmail, password, name.trim());
          const mappedUser: LiddyUser = {
            displayName: name.trim() || newUser?.displayName || trimmedEmail.split('@')[0],
            email: newUser?.email || trimmedEmail,
            isGuest: false,
          };
          loginUser(mappedUser);
          setSuccessMsg('Account created successfully! Synchronizing cloud workspace...');
          setTimeout(() => {
            handleReturnToDashboard();
          }, 500);
        } catch (signUpErr: any) {
          if (signUpErr?.code === 'auth/email-already-in-use') {
            setAuthMode('signin');
          }
          setErrorMsg(mapFirebaseAuthError(signUpErr));
        }
      } else {
        try {
          const signedIn = await signInWithEmail(trimmedEmail, password);
          const mappedUser: LiddyUser = {
            displayName: signedIn?.displayName || trimmedEmail.split('@')[0],
            email: signedIn?.email || trimmedEmail,
            photoURL: signedIn?.photoURL || undefined,
            isGuest: false,
          };
          loginUser(mappedUser);
          setSuccessMsg('Signed in successfully! Syncing cloud balance sheets...');
          setTimeout(() => {
            handleReturnToDashboard();
          }, 500);
        } catch (signInErr: any) {
          setErrorMsg(mapFirebaseAuthError(signInErr));
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuestContinue = () => {
    loginUser({
      displayName: 'Guest Explorer',
      email: 'guest@liddy.ai',
      isGuest: true,
    });
    handleReturnToDashboard();
  };

  const isAlreadyLoggedIn = Boolean(currentUser && !currentUser.isGuest && currentUser.email && currentUser.email !== 'guest@liddy.ai');

  const content = (
    <div 
      className={
        isModal 
          ? 'fixed inset-0 z-[999999] bg-black/85 backdrop-blur-xl flex items-center justify-center p-3 sm:p-6 overflow-y-auto font-sans antialiased' 
          : 'min-h-screen w-full bg-[#FAF9F6] dark:bg-neutral-950 flex items-center justify-center p-3 sm:p-6 font-sans antialiased'
      }
      style={
        isModal 
          ? {
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 999999,
              margin: 0,
            }
          : undefined
      }
      onClick={(e) => {
        // Only trigger backdrop dismiss if clicked on outer container after 400ms mount cooldown
        if (isModal && e.target === e.currentTarget && Date.now() - mountedTime > 400) {
          handleReturnToDashboard();
        }
      }}
    >
      {/* Emergent.sh Inspired Split Card Container */}
      <div 
        className="relative w-full max-w-5xl rounded-[28px] md:rounded-[36px] bg-white dark:bg-[#0D0D10] shadow-2xl overflow-hidden border border-neutral-200/90 dark:border-neutral-800 grid grid-cols-1 md:grid-cols-12 my-auto max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* ================= LEFT COLUMN: AUTHENTICATION FORM ================= */}
        <div className="md:col-span-7 p-6 sm:p-10 md:p-12 flex flex-col justify-between overflow-y-auto max-h-[92vh]">
          <div>
            {/* Top Navigation & Return Bar */}
            <div className="flex items-center justify-between mb-6">
              <button
                type="button"
                onClick={handleReturnToDashboard}
                className="group inline-flex items-center gap-2 text-xs font-bold text-neutral-600 dark:text-neutral-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all py-1.5 px-3 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer active:scale-95"
                title="Return to App Dashboard"
              >
                <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
                <span>Return to Dashboard</span>
              </button>

              {/* Close ✕ Button */}
              <button
                type="button"
                onClick={handleReturnToDashboard}
                aria-label="Close authentication modal"
                className="flex items-center justify-center w-8 h-8 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-all cursor-pointer"
                title="Close (Esc)"
              >
                <span className="text-sm font-black">✕</span>
              </button>
            </div>

            {/* Brand Monogram */}
            <div className="mb-5">
              <div className="flex items-center gap-2.5 mb-2">
                <Logo size="sm" showText={true} />
              </div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-neutral-900 dark:text-white">
                {authMode === 'signup' ? 'Create Your Account' : 'Welcome Back'}
              </h1>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1.5 leading-relaxed">
                {authMode === 'signup'
                  ? 'Track everyday expenses, connect your stock portfolio, create invoices, and stay updated with live market news.'
                  : 'Sign in to access your synced stock portfolio, saved goals, invoices, and receipt history.'}
              </p>
            </div>

            {/* Active Session Info Banner (if user is switching accounts or re-authenticating) */}
            {isAlreadyLoggedIn && (
              <div className="mb-4 p-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3 animate-enter">
                <div className="flex items-center gap-2.5 truncate">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-indigo-500 to-purple-600 text-white font-bold flex items-center justify-center text-xs shrink-0">
                    {currentUser.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="truncate">
                    <div className="text-xs font-bold text-neutral-900 dark:text-white truncate">
                      {currentUser.displayName}
                    </div>
                    <div className="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono truncate">
                      {currentUser.email}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleReturnToDashboard}
                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer"
                  >
                    Keep Session
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await logoutUser();
                    }}
                    className="px-2.5 py-1 rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-semibold cursor-pointer"
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            )}

            {/* Contextual Feature Gate Notice (if triggered after immersion) */}
            {featureReason && !isAlreadyLoggedIn && (
              <div className="mb-4 p-3 bg-indigo-50/80 dark:bg-indigo-950/40 rounded-2xl border border-indigo-200/80 dark:border-indigo-800/80 flex items-center gap-2.5 text-xs text-indigo-950 dark:text-indigo-200 animate-enter">
                <div className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400 animate-ping shrink-0" />
                <span className="leading-snug">
                  Authentication requested for: <strong className="font-bold underline decoration-indigo-400">{featureReason}</strong>
                </span>
              </div>
            )}

            {/* Mode Selector (Sign Up vs Sign In) */}
            <div className="flex p-1 bg-neutral-100 dark:bg-neutral-900 rounded-2xl mb-4 border border-neutral-200/60 dark:border-neutral-800/60">
              <button
                type="button"
                onClick={() => { setAuthMode('signup'); setErrorMsg(null); setSuccessMsg(null); }}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                  authMode === 'signup'
                    ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                }`}
              >
                Create Account
              </button>
              <button
                type="button"
                onClick={() => { setAuthMode('signin'); setErrorMsg(null); setSuccessMsg(null); }}
                className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                  authMode === 'signin'
                    ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                }`}
              >
                Sign In
              </button>
            </div>

            {/* Form Fields */}
            <form onSubmit={handleFormSubmit} className="space-y-3.5">
                  {authMode === 'signup' && (
                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                        Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Maya Chen"
                        className="w-full px-3.5 py-2.5 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl text-xs sm:text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@domain.com"
                      className="w-full px-3.5 py-2.5 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl text-xs sm:text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                        Password
                      </label>
                      {authMode === 'signin' && (
                        <button
                          type="button"
                          onClick={handlePasswordReset}
                          className="text-[11px] text-neutral-500 hover:text-indigo-600 dark:text-neutral-400 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full px-3.5 py-2.5 pr-10 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl text-xs sm:text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-pointer"
                      >
                        {showPassword ? (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  {authMode === 'signup' && (
                    <div>
                      <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                        Confirm Password
                      </label>
                      <div className="relative">
                        <input
                          type={showConfirmPassword ? 'text' : 'password'}
                          required
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="••••••••••••"
                          className="w-full px-3.5 py-2.5 pr-10 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl text-xs sm:text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-pointer"
                        >
                          {showConfirmPassword ? (
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  )}

              {errorMsg && (
                <div className="p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-600 dark:text-red-300 font-medium">
                  {errorMsg}
                </div>
              )}

              {successMsg && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-xl text-xs text-emerald-600 dark:text-emerald-300 font-medium">
                  {successMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] text-white font-bold text-xs sm:text-sm rounded-2xl transition-all shadow-md hover:shadow-indigo-500/25 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-2"
              >
                {isLoading ? (
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <span>
                    {authMode === 'signup'
                      ? 'Create Account & Continue'
                      : 'Sign In to Account'}
                  </span>
                )}
              </button>
            </form>

            {/* Subtle Divider */}
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-neutral-200 dark:border-neutral-800" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white dark:bg-[#0D0D10] px-3 text-neutral-400 font-medium uppercase tracking-wider text-[10px]">
                  Or continue with
                </span>
              </div>
            </div>

            {/* Google Sign In Button */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="w-full py-2.5 px-4 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 border border-neutral-200 dark:border-neutral-800 rounded-2xl text-xs sm:text-sm font-semibold text-neutral-800 dark:text-neutral-200 transition-all flex items-center justify-center gap-3 shadow-xs hover:border-neutral-300 cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Sign in with Google</span>
            </button>

            {/* Continue as Guest Escape Link */}
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={handleGuestContinue}
                className="text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white font-medium transition-colors py-1 px-3 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              >
                Want to explore first? Continue as Guest &rarr;
              </button>
            </div>
          </div>

          {/* Bottom Switcher */}
          <div className="mt-6 pt-4 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
            <span>
              {authMode === 'signup' ? 'Already have an account?' : "Don't have an account yet?"}
            </span>
            <button
              type="button"
              onClick={() => {
                setAuthMode(authMode === 'signup' ? 'signin' : 'signup');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className="font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
            >
              {authMode === 'signup' ? 'Sign In instead' : 'Create Free Account'}
            </button>
          </div>
        </div>

        {/* ================= RIGHT COLUMN: EMERGENT-INSPIRED ARCHITECTURAL WEALTH ART ================= */}
        <div className="hidden md:relative md:col-span-5 bg-neutral-950 text-white overflow-hidden md:flex flex-col justify-between p-8 lg:p-10">
          
          {/* Architectural Background Image with Prismatic Lighting */}
          <img
            src={architecturalBg}
            alt="Minimalist dark architectural wealth with glass refraction"
            className="absolute inset-0 w-full h-full object-cover object-center select-none"
          />

          {/* Dark Luxury Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/55 to-black/35 backdrop-blur-[1px]" />

          {/* Ambient Top Security Badge */}
          <div className="relative z-10 flex items-center justify-between">
            <span className="text-[10px] font-mono tracking-widest text-neutral-300 uppercase px-2.5 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15">
              Cipher 256-Bit SSL
            </span>
            <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 font-bold px-2.5 py-1 rounded-full bg-emerald-950/60 backdrop-blur-md border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Live Exchange Feed</span>
            </div>
          </div>

          {/* Frosted Glass Middle Showcase Card */}
          <div className="relative z-10 space-y-4 my-auto">
            <div className="p-6 rounded-3xl bg-white/10 dark:bg-black/40 backdrop-blur-xl border border-white/20 shadow-2xl space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-indigo-400 shadow-sm shadow-indigo-400/50" />
                <span className="text-[11px] font-mono uppercase tracking-wider text-indigo-200 font-bold">
                  Autonomous Ledger
                </span>
              </div>
              <h2 className="text-xl lg:text-2xl font-bold tracking-tight text-white leading-snug">
                Institutional Baseline. Absolute Privacy.
              </h2>
              <p className="text-xs text-neutral-300 leading-relaxed font-light">
                Zero synthetic mock data or fabricated merchants. Every stock ticker, invoice, and currency conversion is grounded in verifiable exchange feeds.
              </p>
            </div>

            {/* Micro Feature Pills */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div className="p-3 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10">
                <div className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Markets</div>
                <div className="text-xs font-bold text-white mt-0.5">Live Global Feed</div>
              </div>
              <div className="p-3 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10">
                <div className="text-[10px] text-neutral-400 uppercase tracking-wider font-mono">Sync</div>
                <div className="text-xs font-bold text-emerald-400 mt-0.5">Cloud + Instant Sync</div>
              </div>
            </div>
          </div>

          {/* Footer Metadata */}
          <div className="relative z-10 flex items-center justify-between text-[11px] text-neutral-300 border-t border-white/15 pt-4 font-mono">
            <span>Sovereign Client Privacy</span>
            <span>20 Languages</span>
          </div>
        </div>

      </div>
    </div>
  );

  if (isModal) {
    return createPortal(content, document.body);
  }

  return content;
};

export default Login;
