import { PlanTier, InvoiceLineItem, PaymentRegion, BillingCycle, PaymentRail } from '../types';

export const FREE_FEATURE_TRY_LIMIT = 5;

export const FIXED_REGIONAL_PRICING = {
  IN: {
    currency: 'INR' as const,
    symbol: '₹' as const,
    day: 49,
    monthly: 149,
    annual: 999,
  },
  INTL: {
    currency: 'USD' as const,
    symbol: '$' as const,
    day: 2,
    monthly: 9,
    annual: 20,
  },
};

export const PLAN_CATALOG: Record<PlanTier, {
  id: PlanTier;
  name: string;
  dailyUsd?: number;
  dailyInr?: number;
  monthlyUsd: number;
  annualTotalUsd: number;
  monthlyInr: number;
  annualTotalInr: number;
  tagline: string;
  quotaLabel: string;
  features: string[];
}> = {
  free: {
    id: 'free',
    name: 'Starter Free',
    monthlyUsd: 0,
    annualTotalUsd: 0,
    monthlyInr: 0,
    annualTotalInr: 0,
    tagline: 'Dashboard, daily expense tracking & stock portfolio open forever, plus 5 AI & Studio tries.',
    quotaLabel: '5 AI & Studio tries total',
    features: [
      'Always-open Dashboard, daily spends & stock portfolio tracking',
      '5 free tries across Liddy AI, Vision Studio, Slides & Receipt OCR',
      'Live market overview & personal category breakdown',
    ],
  },
  day: {
    id: 'day',
    name: '1-Day Unlimited Pass',
    dailyUsd: FIXED_REGIONAL_PRICING.INTL.day,
    dailyInr: FIXED_REGIONAL_PRICING.IN.day,
    monthlyUsd: FIXED_REGIONAL_PRICING.INTL.day,
    annualTotalUsd: FIXED_REGIONAL_PRICING.INTL.day,
    monthlyInr: FIXED_REGIONAL_PRICING.IN.day,
    annualTotalInr: FIXED_REGIONAL_PRICING.IN.day,
    tagline: 'Full unlimited workspace access for 24 hours with zero recurring commitment.',
    quotaLabel: '24h unlimited access',
    features: [
      'Unlimited Liddy AI Chat, Financial Agent & Voice sessions for 24h',
      'Unlimited Vision Mind Maps, HTML Slides & HD Video Rooms',
      'Unlimited Receipt-to-Digital-Bill OCR & all Swiss templates',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Liddy Pro',
    monthlyUsd: FIXED_REGIONAL_PRICING.INTL.monthly,
    annualTotalUsd: FIXED_REGIONAL_PRICING.INTL.annual,
    monthlyInr: FIXED_REGIONAL_PRICING.IN.monthly,
    annualTotalInr: FIXED_REGIONAL_PRICING.IN.annual,
    tagline: 'Unlimited AI CFO, Vision Studio, Slides & Clean Swiss Paper Invoicing.',
    quotaLabel: 'Unlimited everything',
    features: [
      'Unlimited Liddy AI Financial Agent, OCR & autonomous ledger tools',
      'Unlimited Clean Swiss Paper Invoices & Bill-to-Digital templates',
      'Unlimited Mind Maps, Gamma-style HTML Decks & HD Video Calls',
      '100% ad-free workspace with priority email receipts',
    ],
  },
};

export interface RegionalPaymentOption {
  rail: PaymentRail;
  label: string;
  subtitle: string;
  connector: string;
}

export const REGIONAL_PAYMENT_OPTIONS: Record<PaymentRegion, RegionalPaymentOption[]> = {
  IN: [
    {
      rail: 'UPI_QR',
      label: 'UPI QR Scan',
      subtitle: 'GPay, PhonePe, Paytm and BHIM in INR',
      connector: 'in_upi_qr',
    },
    {
      rail: 'UPI_ID',
      label: 'UPI ID / Handle',
      subtitle: 'Pay via @okicici, @okaxis or @ybl in INR',
      connector: 'in_upi_collect',
    },
  ],
  INTL: [
    {
      rail: 'PAYPAL',
      label: 'PayPal',
      subtitle: 'PayPal balance or card in USD',
      connector: 'paypal_checkout',
    },
  ],
};

export function computeLineItemAmounts(item: Pick<InvoiceLineItem, 'quantity' | 'unitPrice' | 'discountPercent' | 'taxPercent'>) {
  const qty = Math.max(0, Number(item.quantity) || 0);
  const price = Math.max(0, Number(item.unitPrice) || 0);
  const discPct = Math.max(0, Math.min(100, Number(item.discountPercent) || 0));
  const taxPct = Math.max(0, Math.min(100, Number(item.taxPercent) || 0));

  const gross = qty * price;
  const discount = gross * (discPct / 100);
  const taxable = gross - discount;
  const tax = taxable * (taxPct / 100);
  const total = Math.round((taxable + tax) * 100) / 100;

  return {
    gross: Math.round(gross * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    total,
  };
}

export function computeInvoiceTotals(items: Array<Pick<InvoiceLineItem, 'quantity' | 'unitPrice' | 'discountPercent' | 'taxPercent'>>) {
  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  let grandTotal = 0;

  for (const item of items) {
    const res = computeLineItemAmounts(item);
    subtotal += res.gross;
    discountTotal += res.discount;
    taxTotal += res.tax;
    grandTotal += res.total;
  }

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    discountTotal: Math.round(discountTotal * 100) / 100,
    taxTotal: Math.round(taxTotal * 100) / 100,
    grandTotal: Math.round(grandTotal * 100) / 100,
  };
}

export function shouldShowAdsForPlan(planTier: PlanTier, adFreeOverride?: boolean): boolean {
  if (adFreeOverride === true) return false;
  return planTier === 'free';
}

export function getPlanCheckoutCharge(
  planTier: PlanTier,
  billingCycle: BillingCycle,
  region: PaymentRegion
): {
  currency: 'INR' | 'USD';
  symbol: '₹' | '$';
  totalCharge: number;
  usdEquivalent: number;
  cycleLabel: string;
} {
  let usd = 0;
  let inr = 0;
  let cycleLabel = 'Free';

  if (planTier === 'day' || billingCycle === 'daily') {
    usd = FIXED_REGIONAL_PRICING.INTL.day;
    inr = FIXED_REGIONAL_PRICING.IN.day;
    cycleLabel = '24 Hours Unlimited';
  } else if (planTier === 'pro') {
    if (billingCycle === 'annual') {
      usd = FIXED_REGIONAL_PRICING.INTL.annual;
      inr = FIXED_REGIONAL_PRICING.IN.annual;
      cycleLabel = '1 Year Unlimited';
    } else {
      usd = FIXED_REGIONAL_PRICING.INTL.monthly;
      inr = FIXED_REGIONAL_PRICING.IN.monthly;
      cycleLabel = '1 Month Unlimited';
    }
  }

  if (region === 'IN') {
    return {
      currency: 'INR',
      symbol: '₹',
      totalCharge: inr,
      usdEquivalent: usd,
      cycleLabel,
    };
  }
  return {
    currency: 'USD',
    symbol: '$',
    totalCharge: usd,
    usdEquivalent: usd,
    cycleLabel,
  };
}
