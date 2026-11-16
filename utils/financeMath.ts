import { PlanTier, InvoiceLineItem, PaymentRegion, BillingCycle, PaymentRail } from '../types';

export const PLAN_CATALOG: Record<PlanTier, {
  id: PlanTier;
  name: string;
  monthlyUsd: number;
  annualMonthlyUsd: number;
  monthlyInr: number;
  annualMonthlyInr: number;
  tagline: string;
  invoiceLimitLabel: string;
  scanLimitLabel: string;
  collaborationLabel: string;
  features: string[];
}> = {
  free: {
    id: 'free',
    name: 'Starter Free',
    monthlyUsd: 0,
    annualMonthlyUsd: 0,
    monthlyInr: 0,
    annualMonthlyInr: 0,
    tagline: 'Everything you need daily to track expenses, stocks, bills and market news.',
    invoiceLimitLabel: '10 formatted invoices / mo',
    scanLimitLabel: '15 smart receipt scans / mo',
    collaborationLabel: '1 shared Vision board & video room',
    features: [
      'Personal expense tracker & connected stock portfolio card',
      'Formatted A4, Letter & 80mm thermal invoices + UPI QR',
      'Live global market updates & financial news feed',
      'Smart receipt scanner, Liddy Advisor & Voice guide',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Liddy Pro',
    monthlyUsd: 12,
    annualMonthlyUsd: 9,
    monthlyInr: 999,
    annualMonthlyInr: 749,
    tagline: 'Ad-free daily money control, unlimited invoices, email receipts and smart planning.',
    invoiceLimitLabel: 'Unlimited invoices & custom branding',
    scanLimitLabel: 'Unlimited receipt & statement scans',
    collaborationLabel: 'Unlimited Vision boards, slides & PDF exports',
    features: [
      '100% Ad-free workspace across web and mobile',
      'Unlimited multi-format invoices & direct Gmail receipts',
      'PowerPoint, PDF & Markdown exports from Vision Studio',
      'Savings goals, portfolio tracking & daily cashflow guidance',
    ],
  },
  team: {
    id: 'team',
    name: 'Team Plan',
    monthlyUsd: 29,
    annualMonthlyUsd: 24,
    monthlyInr: 2499,
    annualMonthlyInr: 1999,
    tagline: 'Shared financial & creative workspace with live HD video rooms for teams and families.',
    invoiceLimitLabel: 'Unlimited + 5 shared seats',
    scanLimitLabel: 'Unlimited shared receipt archive',
    collaborationLabel: 'HD video conferencing, screen share & live boards',
    features: [
      'Everything in Liddy Pro for up to 5 members',
      'Live HD video, audio & screen-share collaboration rooms',
      'Shared boards, synced meeting notes & decisions archive',
      'Priority support & verified payment history',
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
      subtitle: 'GPay, PhonePe, Paytm and BHIM · Instant',
      connector: 'in_upi_qr',
    },
    {
      rail: 'UPI_ID',
      label: 'UPI ID / Handle',
      subtitle: 'Pay via @okicici, @okaxis or @ybl handle',
      connector: 'in_upi_collect',
    },
  ],
  INTL: [
    {
      rail: 'PAYPAL',
      label: 'PayPal',
      subtitle: 'Fast international checkout via PayPal balance or bank',
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

export function getPlanMonthlyPriceUsd(planTier: PlanTier, billingCycle: BillingCycle = 'monthly'): number {
  const plan = PLAN_CATALOG[planTier] || PLAN_CATALOG.free;
  return billingCycle === 'annual' ? plan.annualMonthlyUsd : plan.monthlyUsd;
}

export function getPlanMonthlyPriceInr(planTier: PlanTier, billingCycle: BillingCycle = 'monthly'): number {
  const plan = PLAN_CATALOG[planTier] || PLAN_CATALOG.free;
  return billingCycle === 'annual' ? plan.annualMonthlyInr : plan.monthlyInr;
}

export function getPlanCheckoutCharge(
  planTier: PlanTier,
  billingCycle: BillingCycle,
  region: PaymentRegion
): {
  currency: 'INR' | 'USD';
  symbol: '₹' | '$';
  monthlyPrice: number;
  totalCharge: number;
  usdEquivalent: number;
} {
  const monthlyUsd = getPlanMonthlyPriceUsd(planTier, billingCycle);
  const monthlyInr = getPlanMonthlyPriceInr(planTier, billingCycle);
  const multiplier = billingCycle === 'annual' ? 12 : 1;

  if (region === 'IN') {
    return {
      currency: 'INR',
      symbol: '₹',
      monthlyPrice: monthlyInr,
      totalCharge: monthlyInr * multiplier,
      usdEquivalent: monthlyUsd * multiplier,
    };
  }
  return {
    currency: 'USD',
    symbol: '$',
    monthlyPrice: monthlyUsd,
    totalCharge: monthlyUsd * multiplier,
    usdEquivalent: monthlyUsd * multiplier,
  };
}
