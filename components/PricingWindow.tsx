import React, { useState } from 'react';
import { useFinMind } from '../context/FinMindContext';
import { PlanTier, WindowId, BillingCycle, HyperswitchPaymentRecord } from '../types';
import {
  PLAN_CATALOG,
  getPlanMonthlyPriceUsd,
  getPlanMonthlyPriceInr,
} from '../utils/financeMath';
import { HyperswitchCheckoutModal } from './HyperswitchCheckoutModal';

interface PricingWindowProps {
  onNavigateWindow?: (windowId: WindowId) => void;
}

export const PricingWindow: React.FC<PricingWindowProps> = ({ onNavigateWindow }) => {
  const { planTier, upgradePlan, currentUser, openAuthModal } = useFinMind();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('annual');
  const [checkoutTier, setCheckoutTier] = useState<'pro' | 'team' | null>(null);
  const [updatingFree, setUpdatingFree] = useState(false);
  const [upgradeNotice, setUpgradeNotice] = useState<string | null>(null);
  const [displayRegion, setDisplayRegion] = useState<'USD' | 'INR'>(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      return tz.includes('Kolkata') ? 'INR' : 'USD';
    } catch {
      return 'USD';
    }
  });

  const handleSelectPlan = async (tier: PlanTier) => {
    setUpgradeNotice(null);
    if (tier === 'free') {
      setUpdatingFree(true);
      try {
        await upgradePlan('free');
        setUpgradeNotice('Account updated to Starter Free plan.');
      } finally {
        setUpdatingFree(false);
      }
      return;
    }
    setCheckoutTier(tier);
  };

  const handleCheckoutSuccess = (payment: HyperswitchPaymentRecord) => {
    setUpgradeNotice(
      `${PLAN_CATALOG[payment.planTier].name} activated cleanly (${payment.region} · ${payment.paymentRail.replace('_', ' ')}).`
    );
  };

  const tiers: PlanTier[] = ['free', 'pro', 'team'];

  return (
    <div className="space-y-10 animate-enter">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="max-w-2xl space-y-2">
          <p className="text-xs font-mono uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-400 font-semibold">
            Transparent Global &amp; India Pricing
          </p>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-neutral-900 dark:text-white">
            Start free. Upgrade seamlessly with UPI, cards, or digital wallets.
          </h1>
          <p className="text-sm sm:text-base text-neutral-600 dark:text-neutral-300">
            Verified multi-currency billing with instant email invoices. Zero hidden fee on your client bills.
          </p>
        </div>

        {/* Billing Cycle & Currency Preview Toggles */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0 self-start">
          <div className="inline-flex items-center p-1 rounded-2xl bg-neutral-200/70 dark:bg-neutral-900 border border-neutral-300/60 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => setDisplayRegion('USD')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                displayRegion === 'USD'
                  ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              $ USD
            </button>
            <button
              type="button"
              onClick={() => setDisplayRegion('INR')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                displayRegion === 'INR'
                  ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              &#8377; INR
            </button>
          </div>

          <div className="inline-flex items-center p-1 rounded-2xl bg-neutral-200/70 dark:bg-neutral-900 border border-neutral-300/60 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => setBillingCycle('monthly')}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                billingCycle === 'monthly'
                  ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle('annual')}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                billingCycle === 'annual'
                  ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              <span>Annual</span>
              <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">Save 25%</span>
            </button>
          </div>
        </div>
      </div>

      {upgradeNotice && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-sm font-semibold flex items-center justify-between gap-4">
          <span>&#10003; {upgradeNotice}</span>
          {onNavigateWindow && (
            <button
              type="button"
              onClick={() => onNavigateWindow('overview')}
              className="px-4 py-1.5 rounded-xl bg-emerald-700 text-white text-xs font-bold cursor-pointer"
            >
              Open Workspace &rarr;
            </button>
          )}
        </div>
      )}

      {/* Tier Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
        {tiers.map((tierId) => {
          const plan = PLAN_CATALOG[tierId];
          const price =
            displayRegion === 'INR'
              ? getPlanMonthlyPriceInr(tierId, billingCycle)
              : getPlanMonthlyPriceUsd(tierId, billingCycle);
          const symbol = displayRegion === 'INR' ? '₹' : '$';
          const isCurrent = planTier === tierId;
          const isFeatured = tierId === 'pro';

          return (
            <div
              key={tierId}
              className={`rounded-3xl p-7 flex flex-col justify-between border transition-all ${
                isFeatured
                  ? 'bg-neutral-950 text-white border-indigo-500/70 shadow-xl'
                  : 'glass-card dark:bg-neutral-900/90 border-neutral-200/90 dark:border-neutral-800'
              }`}
            >
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xl font-extrabold">{plan.name}</h2>
                  {isFeatured && !isCurrent && (
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-sky-400">
                      Most Popular
                    </span>
                  )}
                  {isCurrent && (
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-emerald-400">
                      Current Plan
                    </span>
                  )}
                </div>

                <div className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-extrabold font-mono tabular-nums">
                    {symbol}{price.toLocaleString()}
                  </span>
                  <span className={`text-xs ${isFeatured ? 'text-neutral-400' : 'text-neutral-500'}`}>
                    / month {billingCycle === 'annual' && price > 0 ? '(billed yearly)' : ''}
                  </span>
                </div>

                <p className={`text-sm leading-relaxed ${isFeatured ? 'text-neutral-300' : 'text-neutral-600 dark:text-neutral-400'}`}>
                  {plan.tagline}
                </p>

                <div className={`pt-4 border-t ${isFeatured ? 'border-white/10' : 'border-neutral-200 dark:border-neutral-800'} space-y-2 text-xs font-mono`}>
                  <div>{plan.invoiceLimitLabel}</div>
                  <div>{plan.scanLimitLabel}</div>
                  <div>{plan.collaborationLabel}</div>
                </div>

                <ul className="space-y-2.5 pt-2">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2.5 text-sm">
                      <span className={isFeatured ? 'text-sky-400 font-bold' : 'text-indigo-600 dark:text-indigo-400 font-bold'}>
                        &#10003;
                      </span>
                      <span className={isFeatured ? 'text-neutral-200' : 'text-neutral-700 dark:text-neutral-300'}>
                        {feat}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-8">
                <button
                  type="button"
                  disabled={updatingFree || isCurrent}
                  onClick={() => handleSelectPlan(tierId)}
                  className={`w-full py-3 px-4 rounded-2xl text-sm font-bold transition-all cursor-pointer disabled:opacity-60 ${
                    isFeatured
                      ? 'bg-white text-neutral-950 hover:bg-neutral-100'
                      : 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 hover:opacity-90'
                  }`}
                >
                  {isCurrent
                    ? 'Current Plan'
                    : tierId === 'free'
                    ? updatingFree
                      ? 'Updating...'
                      : 'Continue Free'
                    : `Choose ${plan.name} →`}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Payment Rail Capabilities Strip */}
      <div className="rounded-3xl border border-neutral-200/80 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-mono uppercase tracking-wider text-indigo-600 dark:text-sky-400 font-bold">
            Flexible Regional &amp; Global Payments
          </p>
          <p className="text-sm font-semibold text-neutral-900 dark:text-white">
            India: UPI QR, UPI ID &amp; RuPay Cards &middot; International: Visa, Mastercard, Amex &amp; Express Wallets
          </p>
        </div>
        {(!currentUser || currentUser.isGuest) && (
          <button
            type="button"
            onClick={() => openAuthModal('Sign In to Sync Account')}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shrink-0 cursor-pointer"
          >
            Sign In to Sync &rarr;
          </button>
        )}
      </div>

      {checkoutTier && (
        <HyperswitchCheckoutModal
          isOpen={Boolean(checkoutTier)}
          planTier={checkoutTier}
          billingCycle={billingCycle}
          onClose={() => setCheckoutTier(null)}
          onSuccess={handleCheckoutSuccess}
        />
      )}
    </div>
  );
};

export default PricingWindow;
