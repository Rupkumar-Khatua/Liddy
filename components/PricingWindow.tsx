import React, { useState } from 'react';
import { useFinMind } from '../context/FinMindContext';
import { PlanTier, WindowId, BillingCycle, HyperswitchPaymentRecord } from '../types';
import {
  PLAN_CATALOG,
  FREE_FEATURE_TRY_LIMIT,
  FIXED_REGIONAL_PRICING,
} from '../utils/financeMath';
import { HyperswitchCheckoutModal } from './HyperswitchCheckoutModal';

interface PricingWindowProps {
  onNavigateWindow?: (windowId: WindowId) => void;
  isModal?: boolean;
  modalReason?: string;
  onCloseModal?: () => void;
}

interface PaidCardSpec {
  key: 'day' | 'pro_monthly' | 'pro_annual';
  planTier: 'day' | 'pro';
  billingCycle: BillingCycle;
  tierLevel: 1 | 2 | 3;
  title: string;
  periodLabel: string;
  tagline: string;
  badge?: string;
  points: string[];
}

const PAID_PLAN_CARDS: PaidCardSpec[] = [
  {
    key: 'day',
    planTier: 'day',
    billingCycle: 'daily',
    tierLevel: 1,
    title: '1-Day Pass',
    periodLabel: '/ 24 hours',
    tagline: 'Instant all-access sprint without a recurring subscription.',
    points: [
      'Unlimited Liddy AI Chat, Financial Agent & Voice',
      'Unlimited Mind Maps, HTML Slides & HD Video Calls',
      'Unlimited Receipt OCR & 5 Swiss Invoice templates',
    ],
  },
  {
    key: 'pro_monthly',
    planTier: 'pro',
    billingCycle: 'monthly',
    tierLevel: 2,
    title: 'Pro Monthly',
    periodLabel: '/ month',
    tagline: 'Consistent month-to-month access across your financial studio.',
    badge: 'Flexible Pro',
    points: [
      'Everything in 1-Day Pass unlocked continuously',
      'Unlimited paper-to-digital bill scanning & HTML decks',
      'Priority Gmail invoice receipts & zero ads',
    ],
  },
  {
    key: 'pro_annual',
    planTier: 'pro',
    billingCycle: 'annual',
    tierLevel: 3,
    title: 'Pro Yearly',
    periodLabel: '/ year',
    tagline: 'Flagship full-year access with maximum savings.',
    badge: 'Best Value',
    points: [
      'Full 12 months of unlimited AI, Slides & Visual Editing',
      'Unlimited Swiss Invoices, OCR Bills & HD Video Rooms',
      '100% ad-free experience synced across all devices',
    ],
  },
];

export const PricingWindow: React.FC<PricingWindowProps> = ({
  onNavigateWindow,
  isModal = false,
  modalReason,
  onCloseModal,
}) => {
  const {
    planTier,
    planExpiresAt,
    freeTriesRemaining,
    paymentRegion,
    reducedMotion,
    currentUser,
    openAuthModal,
  } = useFinMind();

  const [checkoutSpec, setCheckoutSpec] = useState<{
    planTier: 'day' | 'pro';
    billingCycle: BillingCycle;
  } | null>(null);
  const [upgradeNotice, setUpgradeNotice] = useState<string | null>(null);

  const isIndia = paymentRegion === 'IN';
  const regionPricing = FIXED_REGIONAL_PRICING[paymentRegion];
  const currencySymbol = regionPricing.symbol;

  const getRegionalAmount = (cycle: BillingCycle): number => {
    if (cycle === 'daily') return regionPricing.day;
    if (cycle === 'annual') return regionPricing.annual;
    return regionPricing.monthly;
  };

  const handleSelectPaidCard = (card: PaidCardSpec) => {
    setUpgradeNotice(null);
    setCheckoutSpec({
      planTier: card.planTier,
      billingCycle: card.billingCycle,
    });
  };

  const handleCheckoutSuccess = (payment: HyperswitchPaymentRecord) => {
    const planName = PLAN_CATALOG[payment.planTier]?.name || 'Liddy Pro';
    setUpgradeNotice(
      `${planName} activated via ${payment.region === 'IN' ? 'UPI (INR)' : 'PayPal (USD)'}.`
    );
    if (isModal && onCloseModal) {
      window.setTimeout(() => onCloseModal(), 1200);
    }
  };

  return (
    <div className="space-y-7 animate-enter">
      {/* Clean Minimal Header + Subtle Region Selector */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-neutral-200/80 dark:border-neutral-800 pb-5">
        <div className="max-w-2xl space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400 font-semibold">
              {isModal ? 'Unlock Full Studio' : 'Plans & Access'}
            </p>
            {isModal && onCloseModal && (
              <button
                type="button"
                onClick={onCloseModal}
                aria-label="Close upgrade window"
                className="md:hidden w-8 h-8 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 flex items-center justify-center text-sm font-bold cursor-pointer"
              >
                &times;
              </button>
            )}
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-neutral-900 dark:text-white">
            Start free. Upgrade for a day, month, or year.
          </h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {modalReason ||
              (isIndia
                ? 'Personal Dashboard, expenses & stock portfolio stay open forever. Instant UPI checkout.'
                : 'Personal Dashboard, expenses & stock portfolio stay open forever. Secure PayPal checkout.')}
          </p>
        </div>
      </div>

      {/* Compact Starter Free Strip Above the 3 Paid Cards */}
      <div className="rounded-2xl border border-[#E5E5E5] dark:border-neutral-800 bg-white dark:bg-neutral-900/80 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-extrabold text-neutral-900 dark:text-white">
              Starter Free · {currencySymbol}0
            </span>
            {planTier === 'free' && (
              <span className="text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
                Active Plan
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            Dashboard, daily expenses &amp; stock portfolio always open &middot;{' '}
            <strong className="font-mono text-neutral-900 dark:text-white">
              {freeTriesRemaining} / {FREE_FEATURE_TRY_LIMIT}
            </strong>{' '}
            free AI &amp; Studio tries remaining
          </p>
        </div>

        {isModal && onCloseModal ? (
          <button
            type="button"
            onClick={onCloseModal}
            className="px-4 py-2 rounded-xl border border-[#E5E5E5] dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
          >
            Continue on Free Dashboard
          </button>
        ) : (
          <span className="text-xs font-mono text-neutral-500 dark:text-neutral-400 shrink-0">
            No card required
          </span>
        )}
      </div>

      {planTier === 'day' && planExpiresAt && (
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 px-5 py-3.5 flex items-center justify-between gap-3 text-xs text-emerald-900 dark:text-emerald-200 font-medium">
          <span>1-Day Unlimited Pass active until {new Date(planExpiresAt).toLocaleString()}.</span>
        </div>
      )}

      {upgradeNotice && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-sm font-semibold flex items-center justify-between gap-4">
          <span>&#10003; {upgradeNotice}</span>
          {onNavigateWindow && (
            <button
              type="button"
              onClick={() => onNavigateWindow('overview')}
              className="px-4 py-1.5 rounded-xl bg-emerald-700 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
            >
              Open Workspace &rarr;
            </button>
          )}
        </div>
      )}

      {/* 3 Progressively Styled Paid Cards (Day -> Monthly Slate -> Yearly Obsidian + 4-Edge Gemini Glow Bar) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
        {PAID_PLAN_CARDS.map((card) => {
          const priceAmount = getRegionalAmount(card.billingCycle);
          const isCurrent = card.planTier === 'day' && planTier === 'day';

          const cardInner = (
            <div
              className={`h-full rounded-[1.15rem] p-6 sm:p-7 flex flex-col justify-between transition-all ${
                card.tierLevel === 3
                  ? 'bg-[#0A0B0E] text-white'
                  : card.tierLevel === 2
                  ? 'bg-[#F4F5F7] dark:bg-[#171920] border border-neutral-300 dark:border-neutral-700/80 text-neutral-900 dark:text-white shadow-md'
                  : 'bg-white dark:bg-neutral-900 border border-[#E5E5E5] dark:border-neutral-800 text-neutral-900 dark:text-neutral-100'
              }`}
            >
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-2 min-h-[24px]">
                  <h2 className="text-lg font-extrabold tracking-tight">{card.title}</h2>
                  {isCurrent ? (
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-emerald-500">
                      Active
                    </span>
                  ) : card.badge ? (
                    <span
                      className={`text-[11px] font-mono font-bold uppercase tracking-wider ${
                        card.tierLevel === 3
                          ? 'text-sky-400'
                          : 'text-indigo-600 dark:text-sky-400'
                      }`}
                    >
                      {card.badge}
                    </span>
                  ) : null}
                </div>

                <div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl font-extrabold font-mono tabular-nums tracking-tight">
                      {currencySymbol}
                      {priceAmount.toLocaleString()}
                    </span>
                    <span
                      className={`text-xs ${
                        card.tierLevel === 3
                          ? 'text-neutral-400'
                          : 'text-neutral-500 dark:text-neutral-400'
                      }`}
                    >
                      {card.periodLabel}
                    </span>
                  </div>
                  <p
                    className={`text-[11px] font-mono mt-1.5 ${
                      card.tierLevel === 3 ? 'text-neutral-400' : 'text-neutral-500'
                    }`}
                  >
                    {isIndia ? 'Instant UPI Checkout · INR' : 'PayPal Checkout · USD'}
                  </p>
                </div>

                <p
                  className={`text-xs leading-relaxed ${
                    card.tierLevel === 3
                      ? 'text-neutral-300'
                      : 'text-neutral-600 dark:text-neutral-400'
                  }`}
                >
                  {card.tagline}
                </p>

                <ul
                  className={`space-y-2.5 pt-4 border-t ${
                    card.tierLevel === 3
                      ? 'border-white/10'
                      : 'border-neutral-200/80 dark:border-neutral-800'
                  }`}
                >
                  {card.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2.5 text-xs leading-relaxed">
                      <span
                        className={`font-bold shrink-0 ${
                          card.tierLevel === 3
                            ? 'text-emerald-400'
                            : 'text-neutral-900 dark:text-white'
                        }`}
                      >
                        &#10003;
                      </span>
                      <span
                        className={
                          card.tierLevel === 3
                            ? 'text-neutral-200'
                            : 'text-neutral-700 dark:text-neutral-300'
                        }
                      >
                        {pt}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-7">
                <button
                  type="button"
                  disabled={isCurrent}
                  onClick={() => handleSelectPaidCard(card)}
                  className={`w-full py-3 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap ${
                    card.tierLevel === 3
                      ? 'bg-white text-neutral-950 hover:bg-neutral-100 shadow-sm'
                      : card.tierLevel === 2
                      ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 hover:opacity-90'
                      : 'border border-neutral-900 dark:border-white/30 text-neutral-900 dark:text-white hover:bg-neutral-900 hover:text-white dark:hover:bg-white dark:hover:text-neutral-950'
                  }`}
                >
                  {isCurrent
                    ? 'Current Plan'
                    : isIndia
                    ? `Unlock with UPI (${currencySymbol}${priceAmount}) →`
                    : `Unlock with PayPal (${currencySymbol}${priceAmount}) →`}
                </button>
              </div>
            </div>
          );

          if (card.tierLevel === 3) {
            return (
              <div
                key={card.key}
                className={reducedMotion ? 'gemini-yearly-card-reduced' : 'gemini-yearly-card'}
              >
                {cardInner}
              </div>
            );
          }

          return (
            <div key={card.key} className="flex flex-col">
              {cardInner}
            </div>
          );
        })}
      </div>

      {/* Strictly Region-Isolated Checkout Strip */}
      <div className="rounded-2xl border border-[#E5E5E5] dark:border-neutral-800 bg-white dark:bg-neutral-900/80 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="text-xs text-neutral-600 dark:text-neutral-300">
          <span className="font-bold text-neutral-900 dark:text-white mr-2">
            {isIndia ? 'India UPI Gateway:' : 'International PayPal Gateway:'}
          </span>
          {isIndia
            ? 'Direct INR billing via UPI QR or UPI ID with instant receipt.'
            : 'Direct USD billing via PayPal Smart Checkout with instant receipt.'}
        </div>
        {(!currentUser || currentUser.isGuest) && (
          <button
            type="button"
            onClick={() => openAuthModal('Sign In to Sync Account')}
            className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 text-xs font-bold shrink-0 cursor-pointer whitespace-nowrap"
          >
            Sign In to Sync &rarr;
          </button>
        )}
      </div>

      {checkoutSpec && (
        <HyperswitchCheckoutModal
          isOpen={Boolean(checkoutSpec)}
          planTier={checkoutSpec.planTier}
          billingCycle={checkoutSpec.billingCycle}
          initialRegion={paymentRegion}
          onClose={() => setCheckoutSpec(null)}
          onSuccess={handleCheckoutSuccess}
        />
      )}
    </div>
  );
};

export default PricingWindow;
