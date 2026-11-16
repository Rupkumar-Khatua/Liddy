import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import QRCode from 'qrcode';
import { loadScript } from '@paypal/paypal-js';
import type { ConfirmationResult, RecaptchaVerifier } from 'firebase/auth';
import { useFinMind } from '../context/FinMindContext';
import {
  BillingCycle,
  PaymentRegion,
  PaymentRail,
  HyperswitchPaymentRecord,
} from '../types';
import {
  PLAN_CATALOG,
  REGIONAL_PAYMENT_OPTIONS,
  getPlanCheckoutCharge,
} from '../utils/financeMath';
import {
  connectGmailForReceipts,
  getGmailAccessToken,
  getGmailTokenEmail,
  hasGmailAccessToken,
  createPhoneRecaptcha,
  sendCheckoutPhoneOtp,
  verifyCheckoutPhoneOtp,
} from '../firebase';
import {
  dispatchInvoiceViaGmailApi,
  GeneratedEmailReceipt,
  triggerFileDownload,
} from '../services/emailReceiptService';

interface HyperswitchCheckoutModalProps {
  isOpen: boolean;
  planTier: 'pro' | 'team';
  billingCycle: BillingCycle;
  onClose: () => void;
  onSuccess?: (payment: HyperswitchPaymentRecord) => void;
}

export const HyperswitchCheckoutModal: React.FC<HyperswitchCheckoutModalProps> = ({
  isOpen,
  planTier,
  billingCycle,
  onClose,
  onSuccess,
}) => {
  const { currentUser, currencySymbol, recordGatewayPayment, payoutConfig } = useFinMind();

  const detectDefaultRegion = (): PaymentRegion => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (currencySymbol === '₹' || tz.includes('Kolkata') || tz.includes('Calcutta')) {
        return 'IN';
      }
    } catch {}
    return 'INTL';
  };

  const [region, setRegion] = useState<PaymentRegion>(detectDefaultRegion);
  const [selectedRail, setSelectedRail] = useState<PaymentRail>(() =>
    detectDefaultRegion() === 'IN' ? 'UPI_QR' : 'PAYPAL'
  );
  const [cycle, setCycle] = useState<BillingCycle>(billingCycle);

  const [intentData, setIntentData] = useState<{
    paymentId: string;
    upiUri?: string;
    payeeName?: string;
    payeeUpiId?: string;
    payoutConfigured?: boolean;
    paypalConfigured?: boolean;
    paypalClientId?: string;
    paypalEnvironment?: 'sandbox' | 'live';
    paypalMerchantEmail?: string;
    referenceCode: string;
    connector: string;
  } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Two-step real SMS verification state via Firebase Phone Auth + PayPal Smart Buttons
  const [authStep, setAuthStep] = useState<'instrument' | 'otp' | 'paypal_capture' | 'confirmed'>('instrument');
  const [maskedInstrument, setMaskedInstrument] = useState<string>('');
  const [countryDialCode, setCountryDialCode] = useState<string>(() =>
    detectDefaultRegion() === 'IN' ? '+91' : '+1'
  );
  const [phoneDigits, setPhoneDigits] = useState('');
  const [smsConfirmation, setSmsConfirmation] = useState<ConfirmationResult | null>(null);
  const [verifiedPhoneAuth, setVerifiedPhoneAuth] = useState<{ idToken: string; phoneNumber: string } | null>(null);
  const [sendingSms, setSendingSms] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [smsSentTo, setSmsSentTo] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const paypalButtonsContainerRef = useRef<HTMLDivElement | null>(null);
  const [paypalSdkLoading, setPaypalSdkLoading] = useState(false);

  // Buyer billing email & UPI inputs
  const [billingEmail, setBillingEmail] = useState(currentUser?.email || '');
  const [upiId, setUpiId] = useState('');
  const [upiRefInput, setUpiRefInput] = useState('');

  // Confirmed payment + formatted email invoice state
  const [confirmedPayment, setConfirmedPayment] = useState<HyperswitchPaymentRecord | null>(null);
  const [receiptEmail, setReceiptEmail] = useState<GeneratedEmailReceipt | null>(null);
  const [gmailConnected, setGmailConnected] = useState<boolean>(hasGmailAccessToken());
  const [gmailSenderEmail, setGmailSenderEmail] = useState<string>(getGmailTokenEmail() || '');
  const [sendingGmail, setSendingGmail] = useState(false);
  const [gmailSendStatus, setGmailSendStatus] = useState<string | null>(null);
  const [gmailError, setGmailError] = useState<string | null>(null);

  const clearRecaptcha = useCallback(() => {
    try {
      recaptchaVerifierRef.current?.clear();
    } catch {}
    recaptchaVerifierRef.current = null;
    if (recaptchaContainerRef.current) {
      recaptchaContainerRef.current.innerHTML = '';
    }
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    return () => clearRecaptcha();
  }, [clearRecaptcha]);

  useEffect(() => {
    setCycle(billingCycle);
  }, [billingCycle]);

  useEffect(() => {
    if (currentUser?.email && !billingEmail) {
      setBillingEmail(currentUser.email);
    }
  }, [currentUser, billingEmail]);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  const initIntent = useCallback(
    async (targetRegion: PaymentRegion, targetRail: PaymentRail, targetCycle: BillingCycle) => {
      setInitializing(true);
      setErrorMsg(null);
      setAuthStep('instrument');
      setSmsConfirmation(null);
      setVerifiedPhoneAuth(null);
      setSmsSentTo(null);
      setResendCooldown(0);
      setVerificationCode('');
      clearRecaptcha();
      try {
        const resp = await fetch('/api/payments/create-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            planTier,
            billingCycle: targetCycle,
            region: targetRegion,
            paymentRail: targetRail,
            userId: currentUser?.uid || 'guest',
            userEmail: billingEmail.trim() || currentUser?.email,
            userName: currentUser?.displayName,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data.error || 'Could not start checkout session.');
        }
        setIntentData({
          paymentId: data.paymentId,
          upiUri: data.upiUri,
          payeeName: data.payeeName,
          payeeUpiId: data.payeeUpiId,
          payoutConfigured: Boolean(data.payoutConfigured),
          paypalConfigured: Boolean(data.paypalConfigured || payoutConfig.hasPaypalConfigured),
          paypalClientId: data.paypalClientId || payoutConfig.paypalClientId || '',
          paypalEnvironment: data.paypalEnvironment || payoutConfig.paypalEnvironment || 'sandbox',
          paypalMerchantEmail: data.paypalMerchantEmail || payoutConfig.paypalMerchantEmail || '',
          referenceCode: data.referenceCode,
          connector: data.connector,
        });

        if (data.upiUri) {
          const qr = await QRCode.toDataURL(data.upiUri, {
            width: 240,
            margin: 1,
            color: { dark: '#111114', light: '#FFFFFF' },
          });
          setQrDataUrl(qr);
        } else {
          setQrDataUrl(null);
        }
      } catch (err: any) {
        setErrorMsg(err?.message || 'Unable to prepare payment session.');
      } finally {
        setInitializing(false);
      }
    },
    [planTier, currentUser, billingEmail, clearRecaptcha, payoutConfig.hasPaypalConfigured, payoutConfig.paypalClientId, payoutConfig.paypalEnvironment, payoutConfig.paypalMerchantEmail]
  );

  useEffect(() => {
    if (isOpen) {
      setConfirmedPayment(null);
      setReceiptEmail(null);
      setGmailSendStatus(null);
      setGmailError(null);
      setGmailConnected(hasGmailAccessToken());
      setGmailSenderEmail(getGmailTokenEmail() || '');
      initIntent(region, selectedRail, cycle);
    }
  }, [isOpen, region, selectedRail, cycle, initIntent]);

  // Mount official PayPal Smart Buttons once SMS is verified for International PayPal flow
  useEffect(() => {
    if (!isOpen || authStep !== 'paypal_capture' || !verifiedPhoneAuth || !intentData?.paypalClientId) {
      return;
    }
    const container = paypalButtonsContainerRef.current;
    if (!container) return;

    let cancelled = false;
    setPaypalSdkLoading(true);
    setErrorMsg(null);
    container.innerHTML = '';

    loadScript({
      clientId: intentData.paypalClientId,
      currency: 'USD',
      intent: 'capture',
      disableFunding: 'card,credit,paylater',
    })
      .then((paypal) => {
        if (cancelled || !paypal?.Buttons || !paypalButtonsContainerRef.current) return;
        paypalButtonsContainerRef.current.innerHTML = '';
        return paypal
          .Buttons({
            style: {
              layout: 'vertical',
              color: 'gold',
              shape: 'rect',
              label: 'paypal',
              height: 44,
            },
            createOrder: async () => {
              setErrorMsg(null);
              const resp = await fetch('/api/payments/paypal/create-order', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  paymentId: intentData.paymentId,
                  firebasePhoneIdToken: verifiedPhoneAuth.idToken,
                  verifiedPhoneNumber: verifiedPhoneAuth.phoneNumber,
                }),
              });
              const data = await resp.json();
              if (!resp.ok || !data.orderId) {
                throw new Error(data.error || 'Unable to start PayPal order.');
              }
              return data.orderId;
            },
            onApprove: async (data, actions) => {
              setProcessing(true);
              setErrorMsg(null);
              try {
                const resp = await fetch('/api/payments/paypal/capture-order', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    paymentId: intentData.paymentId,
                    orderId: data.orderID,
                    firebasePhoneIdToken: verifiedPhoneAuth.idToken,
                    verifiedPhoneNumber: verifiedPhoneAuth.phoneNumber,
                    userId: currentUser?.uid || 'guest',
                    userEmail: billingEmail.trim(),
                    userName: currentUser?.displayName || 'Liddy Member',
                  }),
                });
                const result = await resp.json();
                if (!resp.ok) {
                  if (result.issue === 'INSTRUMENT_DECLINED' && actions?.restart) {
                    return actions.restart();
                  }
                  throw new Error(result.error || 'PayPal capture failed.');
                }
                const confirmed: HyperswitchPaymentRecord = result.payment;
                await recordGatewayPayment(confirmed);
                setConfirmedPayment(confirmed);
                if (result.receiptEmail) {
                  setReceiptEmail(result.receiptEmail);
                }
                setAuthStep('confirmed');
                onSuccess?.(confirmed);
              } catch (err: any) {
                setErrorMsg(err?.message || 'Unable to complete PayPal capture.');
              } finally {
                setProcessing(false);
              }
            },
            onCancel: () => {
              setErrorMsg('PayPal checkout window was closed before completing payment.');
            },
            onError: (err: any) => {
              setErrorMsg(err?.message || 'PayPal encountered an error loading checkout.');
            },
          })
          .render(paypalButtonsContainerRef.current);
      })
      .catch((err: any) => {
        if (!cancelled) {
          setErrorMsg(err?.message || 'Unable to load PayPal Smart Buttons. Verify your PayPal Client ID in Admin.');
        }
      })
      .finally(() => {
        if (!cancelled) setPaypalSdkLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    authStep,
    verifiedPhoneAuth,
    intentData?.paypalClientId,
    intentData?.paymentId,
    currentUser?.uid,
    currentUser?.displayName,
    billingEmail,
    recordGatewayPayment,
    onSuccess,
  ]);

  if (!isOpen) return null;

  const handleRegionSwitch = (nextRegion: PaymentRegion) => {
    setRegion(nextRegion);
    setCountryDialCode(nextRegion === 'IN' ? '+91' : '+1');
    const defaultRail = REGIONAL_PAYMENT_OPTIONS[nextRegion][0]?.rail || (nextRegion === 'IN' ? 'UPI_QR' : 'PAYPAL');
    setSelectedRail(defaultRail);
    setErrorMsg(null);
  };

  const validateBillingEmail = (): boolean => {
    const clean = billingEmail.trim();
    if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setErrorMsg('Enter a valid billing email so we can issue your payment invoice.');
      return false;
    }
    return true;
  };

  const handleAuthorizeInstrument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!intentData?.paymentId) {
      setErrorMsg('Preparing checkout session, please wait a moment.');
      return;
    }
    setErrorMsg(null);
    if (!validateBillingEmail()) return;

    if (selectedRail === 'UPI_QR') {
      if (!intentData.payoutConfigured) {
        setErrorMsg('The account owner must configure a receiving UPI ID in the Admin Portal first.');
        return;
      }
      const cleanUtr = upiRefInput.trim();
      if (!/^[A-Za-z0-9]{10,24}$/.test(cleanUtr) || /^([A-Za-z0-9])\1+$/.test(cleanUtr)) {
        setErrorMsg('Scan the UPI QR code and enter the 10–24 character reference number from your UPI app.');
        return;
      }
    }

    if (selectedRail === 'PAYPAL') {
      if (!intentData.paypalConfigured || !intentData.paypalClientId) {
        setErrorMsg('PayPal receiving credentials are not configured in the Admin Portal yet.');
        return;
      }
    }

    setProcessing(true);
    try {
      const resp = await fetch('/api/payments/authorize-rail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId: intentData.paymentId,
          paymentRail: selectedRail,
          upiRef: selectedRail === 'UPI_QR' ? upiRefInput.trim() : undefined,
          upiId: selectedRail === 'UPI_ID' ? upiId.trim() : undefined,
          userEmail: billingEmail.trim(),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Could not verify your payment details.');
      }

      setMaskedInstrument(data.maskedInstrument || selectedRail);
      setSmsConfirmation(null);
      setVerifiedPhoneAuth(null);
      setSmsSentTo(null);
      setVerificationCode('');
      setAuthStep('otp');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Verification failed. Check details and try again.');
    } finally {
      setProcessing(false);
    }
  };

  const buildE164Phone = (): string => {
    const dial = countryDialCode.replace(/[^\d+]/g, '');
    const digits = phoneDigits.replace(/\D/g, '');
    if (!digits) return '';
    return `${dial.startsWith('+') ? dial : `+${dial}`}${digits}`;
  };

  const handleSendRealSms = async () => {
    setErrorMsg(null);
    const e164 = buildE164Phone();
    if (!/^\+[1-9]\d{7,14}$/.test(e164)) {
      setErrorMsg('Enter a valid mobile number with your country code (for example 9876543210).');
      return;
    }
    if (!recaptchaContainerRef.current) {
      setErrorMsg('Security check container is still loading. Please try again.');
      return;
    }

    setSendingSms(true);
    try {
      clearRecaptcha();
      const verifier = createPhoneRecaptcha(recaptchaContainerRef.current);
      recaptchaVerifierRef.current = verifier;
      const confirmation = await sendCheckoutPhoneOtp(e164, verifier);
      setSmsConfirmation(confirmation);
      setSmsSentTo(e164);
      setResendCooldown(30);
    } catch (err: any) {
      clearRecaptcha();
      setErrorMsg(err?.message || 'Unable to send verification SMS. Please check the number and try again.');
    } finally {
      setSendingSms(false);
    }
  };

  const submitFinalConfirm = async () => {
    if (!intentData?.paymentId) return;
    if (!validateBillingEmail()) return;

    if (!smsConfirmation) {
      setErrorMsg('Send and verify an SMS code on your mobile number before completing payment.');
      return;
    }

    if (verificationCode.trim().length !== 6) {
      setErrorMsg('Enter the 6-digit SMS code sent to your mobile phone.');
      return;
    }

    setErrorMsg(null);
    setProcessing(true);
    try {
      const { idToken, phoneNumber } = await verifyCheckoutPhoneOtp(
        smsConfirmation,
        verificationCode.trim()
      );
      const confirmedPhone = phoneNumber || smsSentTo || buildE164Phone();
      clearRecaptcha();

      if (selectedRail === 'PAYPAL') {
        setVerifiedPhoneAuth({ idToken, phoneNumber: confirmedPhone });
        setAuthStep('paypal_capture');
        return;
      }

      const resp = await fetch('/api/payments/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId: intentData.paymentId,
          paymentRail: selectedRail,
          upiId: upiId.trim() || undefined,
          upiRef: selectedRail === 'UPI_QR' ? upiRefInput.trim() : undefined,
          firebasePhoneIdToken: idToken,
          verifiedPhoneNumber: confirmedPhone,
          userId: currentUser?.uid || 'guest',
          userEmail: billingEmail.trim(),
          userName: currentUser?.displayName || 'Liddy Member',
        }),
      });
      const result = await resp.json();
      if (!resp.ok || !result.payment) {
        throw new Error(result.error || 'Payment verification failed.');
      }

      const confirmed: HyperswitchPaymentRecord = result.payment;
      await recordGatewayPayment(confirmed);
      setConfirmedPayment(confirmed);
      if (result.receiptEmail) {
        setReceiptEmail(result.receiptEmail);
      }
      setAuthStep('confirmed');
      onSuccess?.(confirmed);
    } catch (err: any) {
      setErrorMsg(err?.message || 'SMS verification failed. Check your code and try again.');
    } finally {
      setProcessing(false);
    }
  };

  const handleConnectGmail = async () => {
    setGmailError(null);
    try {
      const res = await connectGmailForReceipts();
      setGmailConnected(true);
      setGmailSenderEmail(res.email);
    } catch (err: any) {
      setGmailError(err?.message || 'Could not authorize Gmail sending.');
    }
  };

  const handleSendInvoiceEmail = async () => {
    if (!receiptEmail || !confirmedPayment) return;
    const token = getGmailAccessToken();
    if (!token) {
      setGmailError('Connect your Google account above first to send invoice receipts via Gmail.');
      return;
    }
    setSendingGmail(true);
    setGmailError(null);
    setGmailSendStatus(null);
    try {
      await dispatchInvoiceViaGmailApi({
        accessToken: token,
        senderEmail: gmailSenderEmail || 'me',
        recipientEmail: billingEmail.trim() || confirmedPayment.userEmail || '',
        subject: receiptEmail.subject,
        htmlBody: receiptEmail.htmlBody,
      });
      setGmailSendStatus(`Payment invoice sent to ${billingEmail.trim() || confirmedPayment.userEmail} via Gmail.`);
    } catch (err: any) {
      setGmailError(err?.message || 'Could not send via Gmail right now. Use the download options below.');
    } finally {
      setSendingGmail(false);
    }
  };

  const plan = PLAN_CATALOG[planTier];
  const charge = getPlanCheckoutCharge(planTier, cycle, region);
  const railOptions = REGIONAL_PAYMENT_OPTIONS[region];

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget && !processing) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hyperswitch-checkout-title"
        className="w-full max-w-2xl bg-white dark:bg-[#111217] text-neutral-900 dark:text-neutral-100 rounded-3xl border border-neutral-200 dark:border-white/10 shadow-2xl overflow-hidden my-auto animate-enter"
      >
        {/* Top Checkout Header */}
        <div className="px-6 py-5 border-b border-neutral-200/80 dark:border-white/10 flex items-center justify-between gap-4 bg-neutral-50/80 dark:bg-neutral-950/60">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-indigo-600 dark:text-sky-400 font-semibold">
              Protected Billing · Verified Checkout
            </p>
            <h2 id="hyperswitch-checkout-title" className="text-lg sm:text-xl font-extrabold mt-0.5">
              {confirmedPayment ? 'Payment Verified & Invoice Issued' : `Complete ${plan.name} Upgrade`}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={processing}
            aria-label="Close checkout"
            className="w-9 h-9 rounded-xl bg-neutral-200/70 dark:bg-white/10 hover:bg-neutral-300 dark:hover:bg-white/20 flex items-center justify-center text-sm font-bold cursor-pointer"
          >
            &times;
          </button>
        </div>

        {confirmedPayment ? (
          <div className="p-7 sm:p-8 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto text-2xl font-bold border border-emerald-500/30">
                &#10003;
              </div>
              <h3 className="text-2xl font-extrabold">Welcome to {plan.name}</h3>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Your payment was authorized cleanly. Dispatch or download your formatted invoice receipt below.
              </p>
            </div>

            <div className="max-w-lg mx-auto rounded-2xl border border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-900/70 p-4 space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-neutral-500">Amount Settled</span>
                <span className="font-bold text-neutral-900 dark:text-white">
                  {confirmedPayment.currency} {confirmedPayment.amount.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Billing Email</span>
                <span className="font-semibold">{confirmedPayment.userEmail}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Payment Rail</span>
                <span className="font-bold">{confirmedPayment.paymentRail} ({confirmedPayment.region})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Reference ID</span>
                <span className="text-indigo-600 dark:text-sky-400">{confirmedPayment.referenceCode}</span>
              </div>
            </div>

            {/* Email Invoice Dispatch Box (Gmail OAuth + Server Fallback) */}
            <div className="max-w-lg mx-auto rounded-2xl border border-neutral-200 dark:border-white/10 p-5 space-y-3.5 bg-white dark:bg-neutral-950/60">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold">Send Payment Invoice to Your Email</h4>
                <span className="text-[10px] font-mono uppercase text-neutral-500">Gmail + Receipt</span>
              </div>

              {gmailError && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs font-semibold">
                  {gmailError}
                </div>
              )}

              {gmailSendStatus ? (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                  &#10003; {gmailSendStatus}
                </div>
              ) : !gmailConnected ? (
                <button
                  type="button"
                  onClick={handleConnectGmail}
                  className="w-full py-2.5 px-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 hover:border-indigo-500 text-neutral-900 dark:text-white text-xs font-bold flex items-center justify-center gap-2.5 cursor-pointer shadow-2xs"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z" />
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z" />
                    <path fill="#FBBC05" d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z" />
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z" />
                  </svg>
                  <span>Connect Gmail to Send Invoice</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={sendingGmail}
                  onClick={handleSendInvoiceEmail}
                  className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  {sendingGmail
                    ? 'Dispatching Invoice via Gmail...'
                    : `Confirm & Email Invoice to ${confirmedPayment.userEmail}`}
                </button>
              )}

              {receiptEmail && (
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      triggerFileDownload(
                        receiptEmail.emlContent,
                        `Invoice-${confirmedPayment.referenceCode}.eml`,
                        'message/rfc822'
                      )
                    }
                    className="py-2 px-3 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold cursor-pointer"
                  >
                    Download Email (.eml)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerFileDownload(
                        receiptEmail.htmlBody,
                        `Invoice-${confirmedPayment.referenceCode}.html`,
                        'text/html'
                      )
                    }
                    className="py-2 px-3 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-semibold cursor-pointer"
                  >
                    Download Invoice (.html)
                  </button>
                </div>
              )}
            </div>

            <div className="text-center">
              <button
                type="button"
                onClick={onClose}
                className="px-7 py-3 rounded-2xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-sm font-bold cursor-pointer hover:opacity-90"
              >
                Return to Liddy Workspace
              </button>
            </div>
          </div>
        ) : authStep === 'paypal_capture' ? (
          <div className="p-6 sm:p-8 space-y-5">
            <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/70 dark:bg-indigo-950/30 p-4 space-y-1.5">
              <p className="text-xs font-mono uppercase tracking-wider text-indigo-700 dark:text-sky-400 font-bold">
                Final Step · Complete via PayPal
              </p>
              <p className="text-sm font-bold text-neutral-900 dark:text-white">
                Authorize ${charge.totalCharge.toLocaleString()} USD for {plan.name}
              </p>
              <p className="text-xs text-neutral-600 dark:text-neutral-300">
                SMS verified ({verifiedPhoneAuth?.phoneNumber}) · PayPal {intentData?.paypalEnvironment === 'live' ? 'Live' : 'Sandbox'}
                {intentData?.paypalMerchantEmail ? ` · Merchant: ${intentData.paypalMerchantEmail}` : ''}
              </p>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs font-semibold">
                {errorMsg}
              </div>
            )}

            <div className="rounded-2xl border border-neutral-200 dark:border-white/10 bg-white dark:bg-neutral-900/50 p-5 space-y-4">
              {paypalSdkLoading && (
                <div className="py-4 text-center text-xs font-mono text-neutral-500">
                  Loading PayPal Smart Buttons...
                </div>
              )}
              <div ref={paypalButtonsContainerRef} id="paypal-smart-button-container" className="min-h-[54px]" />
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="button"
                disabled={processing}
                onClick={() => {
                  setAuthStep('instrument');
                  setErrorMsg(null);
                }}
                className="px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-bold cursor-pointer"
              >
                &larr; Change Payment Method
              </button>
              <span className="text-[11px] font-mono text-neutral-500">
                Secured via PayPal Orders v2
              </span>
            </div>
          </div>
        ) : authStep === 'otp' ? (
          <div className="p-6 sm:p-8 space-y-5">
            <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/70 dark:bg-indigo-950/30 p-4 space-y-1.5">
              <p className="text-xs font-mono uppercase tracking-wider text-indigo-700 dark:text-sky-400 font-bold">
                Step 2 of {selectedRail === 'PAYPAL' ? '3' : '2'} · Mobile SMS Verification
              </p>
              <p className="text-sm font-bold text-neutral-900 dark:text-white">
                Confirming {charge.symbol}{charge.totalCharge.toLocaleString()} {charge.currency} via {maskedInstrument}
              </p>
              {intentData?.payeeUpiId && selectedRail !== 'PAYPAL' && (
                <p className="text-xs text-neutral-600 dark:text-neutral-300">
                  Receiving account: <strong>{intentData.payeeName || 'Owner'}</strong> ({intentData.payeeUpiId})
                </p>
              )}
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs font-semibold">
                {errorMsg}
              </div>
            )}

            {/* Mobile number input & Send SMS button */}
            <div className="space-y-3">
              <label className="block text-xs font-mono uppercase text-neutral-500 font-bold">
                Mobile Number for SMS Confirmation
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  value={countryDialCode}
                  onChange={(e) => setCountryDialCode(e.target.value)}
                  disabled={sendingSms || processing}
                  className="px-3 py-3 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 text-xs font-mono font-bold text-neutral-900 dark:text-white outline-none focus:border-indigo-500 sm:w-32"
                >
                  <option value="+91">IN (+91)</option>
                  <option value="+1">US (+1)</option>
                  <option value="+44">UK (+44)</option>
                  <option value="+65">SG (+65)</option>
                  <option value="+971">AE (+971)</option>
                  <option value="+61">AU (+61)</option>
                </select>
                <input
                  type="tel"
                  inputMode="tel"
                  value={phoneDigits}
                  onChange={(e) => setPhoneDigits(e.target.value.replace(/\D/g, '').slice(0, 14))}
                  placeholder="Enter mobile number"
                  disabled={sendingSms || processing}
                  className="flex-1 px-4 py-3 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 text-sm font-mono font-semibold text-neutral-900 dark:text-white outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={handleSendRealSms}
                  disabled={sendingSms || processing || resendCooldown > 0}
                  className="px-4 py-3 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-bold whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  {sendingSms
                    ? 'Sending SMS...'
                    : resendCooldown > 0
                    ? `Resend in ${resendCooldown}s`
                    : smsSentTo
                    ? 'Resend SMS Code'
                    : 'Send SMS Code'}
                </button>
              </div>
              <div ref={recaptchaContainerRef} />
            </div>

            {smsSentTo && (
              <div className="space-y-2 animate-enter">
                <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 font-semibold">
                  SMS verification code sent to {smsSentTo}.
                </div>
                <label className="block text-xs font-mono uppercase text-neutral-500 font-bold pt-1">
                  Enter 6-Digit SMS Code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit SMS code"
                  className="w-full px-4 py-3.5 rounded-2xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 text-lg font-mono tracking-[0.35em] text-center font-extrabold outline-none focus:border-indigo-500"
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                disabled={processing || sendingSms}
                onClick={() => {
                  clearRecaptcha();
                  setSmsConfirmation(null);
                  setVerifiedPhoneAuth(null);
                  setSmsSentTo(null);
                  setAuthStep('instrument');
                  setErrorMsg(null);
                }}
                className="px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-bold cursor-pointer"
              >
                &larr; Edit Payment Details
              </button>

              <button
                type="button"
                disabled={processing || !smsConfirmation || verificationCode.length !== 6}
                onClick={submitFinalConfirm}
                className="px-7 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold shadow-lg cursor-pointer"
              >
                {processing
                  ? 'Verifying...'
                  : selectedRail === 'PAYPAL'
                  ? 'Verify SMS & Continue to PayPal →'
                  : `Verify SMS & Complete ${charge.symbol}${charge.totalCharge.toLocaleString()}`}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-5">
            {/* Plan Summary & Country / Billing Switcher */}
            <div className="rounded-2xl border border-neutral-200 dark:border-white/10 bg-neutral-50/90 dark:bg-neutral-900/80 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-extrabold">{plan.name}</span>
                  <span className="text-xs font-mono text-neutral-500">({cycle})</span>
                </div>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                  {charge.symbol}{charge.monthlyPrice}/mo &middot; {cycle === 'annual' ? 'Billed yearly (Save 25%)' : 'Billed monthly'}
                </p>
              </div>

              <div className="flex flex-col sm:items-end gap-1.5">
                <div className="text-2xl font-extrabold font-mono tabular-nums text-neutral-900 dark:text-white">
                  {charge.symbol}{charge.totalCharge.toLocaleString()} {charge.currency}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleRegionSwitch('IN')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                      region === 'IN'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-neutral-200/80 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    India (INR)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRegionSwitch('INTL')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                      region === 'INTL'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-neutral-200/80 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    International (USD)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCycle((c) => (c === 'annual' ? 'monthly' : 'annual'))}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-mono bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-neutral-200 cursor-pointer"
                  >
                    {cycle === 'annual' ? 'Switch Monthly' : 'Switch Annual'}
                  </button>
                </div>
              </div>
            </div>

            {/* Required Billing Email for Invoice Receipt */}
            <div>
              <label className="block text-[11px] font-mono uppercase text-neutral-500 mb-1">
                Billing Email (For Formatted Payment Invoice)
              </label>
              <input
                type="email"
                required
                value={billingEmail}
                onChange={(e) => setBillingEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-white/10 text-sm outline-none focus:border-indigo-500"
              />
            </div>

            {/* Regional Payment Methods Selector */}
            <div className="space-y-2.5">
              <p className="text-xs font-mono uppercase tracking-wider text-neutral-500 dark:text-neutral-400 font-semibold">
                Select {region === 'IN' ? 'Indian Payment Method' : 'Global Payment Method'}
              </p>
              <div className={`grid gap-2.5 ${railOptions.length > 2 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'}`}>
                {railOptions.map((opt) => {
                  const active = selectedRail === opt.rail;
                  return (
                    <button
                      key={opt.rail}
                      type="button"
                      onClick={() => {
                        setSelectedRail(opt.rail);
                        setErrorMsg(null);
                      }}
                      className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                        active
                          ? 'border-indigo-600 dark:border-sky-400 bg-indigo-50/70 dark:bg-indigo-950/40'
                          : 'border-neutral-200 dark:border-white/10 hover:border-neutral-400 dark:hover:border-white/25'
                      }`}
                    >
                      <p className="text-xs font-bold text-neutral-900 dark:text-white leading-tight">
                        {opt.label}
                      </p>
                      <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
                        {opt.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs font-semibold">
                {errorMsg}
              </div>
            )}

            {/* Dynamic Instrument Capture Panel */}
            <form onSubmit={handleAuthorizeInstrument} className="space-y-4">
              {selectedRail === 'UPI_QR' && region === 'IN' && (
                <div className="rounded-2xl border border-neutral-200 dark:border-white/10 p-5 flex flex-col sm:flex-row items-center gap-6 bg-white dark:bg-neutral-900/50">
                  {intentData?.payoutConfigured && qrDataUrl ? (
                    <div className="w-40 h-40 rounded-2xl bg-white p-2 border border-neutral-200 flex items-center justify-center shrink-0">
                      <img src={qrDataUrl} alt="UPI QR Checkout Code" className="w-full h-full object-contain" />
                    </div>
                  ) : (
                    <div className="w-40 h-40 rounded-2xl bg-amber-50 dark:bg-amber-950/30 p-3 border border-amber-200 dark:border-amber-800 flex flex-col items-center justify-center text-center shrink-0 gap-2">
                      <span className="text-xs font-bold text-amber-800 dark:text-amber-200">
                        {initializing ? 'Loading QR...' : 'Merchant Setup Pending'}
                      </span>
                    </div>
                  )}
                  <div className="space-y-3 flex-1 w-full">
                    <div>
                      <h4 className="text-sm font-bold">
                        {intentData?.payeeUpiId
                          ? `Pay ${intentData.payeeName || 'Owner'} (${intentData.payeeUpiId})`
                          : 'Platform Settlement Pending'}
                      </h4>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                        {intentData?.payoutConfigured
                          ? 'Scan with any UPI app, enter your 12-digit UTR number below, then verify with your mobile SMS code.'
                          : 'The platform owner has not configured receiving payout details in the Admin Console yet.'}
                      </p>
                    </div>
                    <input
                      type="text"
                      required
                      value={upiRefInput}
                      onChange={(e) => setUpiRefInput(e.target.value)}
                      placeholder="12-digit UPI reference / UTR number"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-white/10 text-xs font-mono outline-none focus:border-indigo-500"
                    />
                    {intentData?.upiUri && (
                      <a
                        href={intentData.upiUri}
                        className="inline-block text-xs font-bold text-indigo-600 dark:text-sky-400 hover:underline"
                      >
                        Launch Installed UPI App &rarr;
                      </a>
                    )}
                  </div>
                </div>
              )}

              {selectedRail === 'UPI_ID' && region === 'IN' && (
                <div className="rounded-2xl border border-neutral-200 dark:border-white/10 p-5 space-y-3 bg-white dark:bg-neutral-900/50">
                  <label className="block text-xs font-mono uppercase text-neutral-500">
                    Enter Your UPI ID
                  </label>
                  <input
                    type="text"
                    required
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    placeholder="name@okicici or mobile@ybl"
                    className="w-full px-4 py-3 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-white/10 text-sm font-mono outline-none focus:border-indigo-500"
                  />
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                    {intentData?.payeeUpiId
                      ? `Payments go to ${intentData.payeeName || 'Owner'} (${intentData.payeeUpiId}). Next step confirms via SMS.`
                      : 'Next step verifies your payment via mobile SMS.'}
                  </p>
                </div>
              )}

              {selectedRail === 'PAYPAL' && region === 'INTL' && (
                <div className="rounded-2xl border border-neutral-200 dark:border-white/10 p-5 space-y-3 bg-white dark:bg-neutral-900/50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-extrabold text-neutral-900 dark:text-white">
                      PayPal International Checkout
                    </span>
                    <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-md font-bold ${
                      intentData?.paypalConfigured && intentData?.paypalClientId
                        ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300'
                        : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    }`}>
                      {intentData?.paypalConfigured && intentData?.paypalClientId
                        ? `PayPal ${intentData.paypalEnvironment === 'live' ? 'Live' : 'Sandbox'}`
                        : 'Setup Required'}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">
                    {intentData?.paypalConfigured && intentData?.paypalClientId
                      ? 'Verify your mobile phone number via SMS in the next step, then sign in with your PayPal balance or linked PayPal account to capture payment immediately.'
                      : 'The platform administrator must save PayPal Client ID and Client Secret in the Admin Portal before International PayPal payments can run.'}
                  </p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <p className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
                  SMS-Verified Checkout
                </p>

                <button
                  type="submit"
                  disabled={processing || initializing}
                  className="px-7 py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-bold shadow-lg transition-all cursor-pointer whitespace-nowrap"
                >
                  {processing ? 'Checking...' : 'Continue to SMS Verification →'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default HyperswitchCheckoutModal;
