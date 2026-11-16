import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const gmailProvider = new GoogleAuthProvider();
gmailProvider.addScope('https://www.googleapis.com/auth/gmail.send');
gmailProvider.setCustomParameters({ prompt: 'consent', include_granted_scopes: 'true' });

// Strictly in-memory OAuth access token (never stored in localStorage or sessionStorage)
let inMemoryGmailAccessToken: string | null = null;
let inMemoryGmailTokenEmail: string | null = null;

if (typeof window !== 'undefined') {
  onAuthStateChanged(auth, (user) => {
    if (!user) {
      inMemoryGmailAccessToken = null;
      inMemoryGmailTokenEmail = null;
    }
  });
}

export const getGmailAccessToken = (): string | null => inMemoryGmailAccessToken;
export const getGmailTokenEmail = (): string | null => inMemoryGmailTokenEmail;
export const hasGmailAccessToken = (): boolean => Boolean(inMemoryGmailAccessToken);
export const clearGmailAccessToken = () => {
  inMemoryGmailAccessToken = null;
  inMemoryGmailTokenEmail = null;
};

export const connectGmailForReceipts = async (): Promise<{ accessToken: string; email: string }> => {
  const result = await signInWithPopup(auth, gmailProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const token = credential?.accessToken;
  if (!token) {
    throw new Error('Google did not return an OAuth access token for Gmail delivery.');
  }
  inMemoryGmailAccessToken = token;
  inMemoryGmailTokenEmail = result.user.email || '';
  return { accessToken: token, email: inMemoryGmailTokenEmail };
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: Array<{
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }>;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map((provider) => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL,
      })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const testConnection = async () => {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
};

if (typeof window !== 'undefined') {
  testConnection();
}

export const signInWithGoogle = async () => {
  try {
    const userCredential = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(userCredential);
    if (credential?.accessToken) {
      inMemoryGmailAccessToken = credential.accessToken;
      inMemoryGmailTokenEmail = userCredential.user.email || '';
    }
    return userCredential.user;
  } catch (error) {
    console.error("Error signing in with Google", error);
    throw error;
  }
};

export const signUpWithEmail = async (email: string, pass: string, displayName?: string) => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
    if (displayName && userCredential.user) {
      try {
        await updateProfile(userCredential.user, { displayName });
      } catch (profileErr) {
        console.warn("Profile name update deferred", profileErr);
      }
    }
    return userCredential.user;
  } catch (error) {
    console.error("Error creating account with email", error);
    throw error;
  }
};

export const signInWithEmail = async (email: string, pass: string) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, pass);
    return userCredential.user;
  } catch (error) {
    console.error("Error signing in with email", error);
    throw error;
  }
};

export const sendPasswordReset = async (email: string) => {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    console.error("Error sending password reset email", error);
    throw error;
  }
};

export const logout = async () => {
  try {
    clearGmailAccessToken();
    await signOut(auth);
    localStorage.removeItem('liddy_user_session');
    window.dispatchEvent(new CustomEvent('liddy_auth_change', { detail: null }));
  } catch (error) {
    console.error("Error signing out", error);
    throw error;
  }
};

// ==========================================
// ISOLATED FIREBASE PHONE AUTH (SMS OTP)
// Runs on a dedicated secondary Firebase App so primary workspace sign-in is untouched.
// ==========================================
function getPhoneVerifyAuth() {
  const existing = getApps().find((a) => a.name === 'phone-verify-app');
  const secondaryApp = existing || initializeApp(firebaseConfig, 'phone-verify-app');
  return getAuth(secondaryApp);
}

export function mapPhoneAuthError(err: any): string {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  if (code === 'auth/operation-not-allowed' || msg.includes('operation-not-allowed')) {
    return 'SMS verification is not enabled in Firebase Authentication yet. Enable Phone sign-in under Firebase Console → Authentication → Sign-in method and authorize this domain.';
  }
  if (code === 'auth/invalid-phone-number') {
    return 'Enter a valid mobile number with country code (for example +919876543210 or +14155552671).';
  }
  if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded') {
    return 'Too many SMS attempts right now. Please wait a minute and try again.';
  }
  if (code === 'auth/captcha-check-failed' || code === 'auth/unauthorized-domain') {
    return 'Security verification check failed for this domain. Add this app hostname to Firebase Console → Authentication → Settings → Authorized domains.';
  }
  if (code === 'auth/invalid-verification-code') {
    return 'Incorrect 6-digit SMS verification code. Please check your messages and try again.';
  }
  if (code === 'auth/code-expired') {
    return 'Your SMS verification code expired. Request a new code and try again.';
  }
  return msg || 'Could not complete SMS phone verification.';
}

export function createPhoneRecaptcha(containerEl: HTMLElement): RecaptchaVerifier {
  const phoneAuth = getPhoneVerifyAuth();
  const verifier = new RecaptchaVerifier(phoneAuth, containerEl, {
    size: 'invisible',
  });
  return verifier;
}

export async function sendCheckoutPhoneOtp(
  phoneE164: string,
  verifier: RecaptchaVerifier
): Promise<ConfirmationResult> {
  try {
    const phoneAuth = getPhoneVerifyAuth();
    return await signInWithPhoneNumber(phoneAuth, phoneE164, verifier);
  } catch (err: any) {
    throw new Error(mapPhoneAuthError(err));
  }
}

export async function verifyCheckoutPhoneOtp(
  confirmation: ConfirmationResult,
  smsCode: string
): Promise<{ idToken: string; phoneNumber: string }> {
  try {
    const phoneAuth = getPhoneVerifyAuth();
    const credential = await confirmation.confirm(smsCode.trim());
    const idToken = await credential.user.getIdToken(true);
    const phoneNumber = credential.user.phoneNumber || '';
    // Sign out the temporary secondary app session immediately so workspace auth never changes
    await signOut(phoneAuth).catch(() => {});
    return { idToken, phoneNumber };
  } catch (err: any) {
    throw new Error(mapPhoneAuthError(err));
  }
}
