import { AiSkillRecord, McpConnectorRecord, SkillsShCatalogItem } from '../types';

export const CURATED_FINANCE_SKILLS: SkillsShCatalogItem[] = [
  {
    id: 'skill_cashflow_runway',
    slug: 'cashflow-runway-audit',
    name: 'Cashflow & Runway Forensic',
    description: 'Separates fixed commitments from discretionary burn, flags concentration above 35%, and models cash runway.',
    category: 'Treasury',
    author: 'liddy-finance',
    repo: 'skills.sh/finance/cashflow-runway-audit',
    installs: 14820,
    triggers: 'burn rate, runway, cashflow, cash flow audit, treasury, liquidity',
    sourceUrl: 'https://skills.sh',
    instructionsMarkdown: `---
name: cashflow-runway-audit
description: Forensic cashflow decomposition, burn velocity, and survival runway calculator
triggers: burn rate, runway, cashflow, liquidity, cash audit
---

# Cashflow & Runway Forensic Skill

## Workflow
1. Partition outflows into Fixed Overhead, Recurring SaaS/Utilities, and Variable Discretionary spend.
2. Flag any single vendor or category exceeding 35% of total monthly outflows as a concentration risk.
3. Calculate gross burn, net monthly surplus/deficit, and cash runway in months.
4. Always emit an executive summary table plus a downloadable CSV ledger and bar chart when asked for reports.`,
  },
  {
    id: 'skill_tax_loss_harvest',
    slug: 'tax-loss-harvesting',
    name: 'Tax-Loss Harvesting & Deduction Scout',
    description: 'Groups tax-deductible software, professional services, health, and unrealized capital losses for year-end efficiency.',
    category: 'Tax & Compliance',
    author: 'open-tax-guild',
    repo: 'skills.sh/finance/tax-loss-harvesting',
    installs: 11290,
    triggers: 'tax, deduction, harvest, capital gains, tax planning, write-off',
    sourceUrl: 'https://skills.sh',
    instructionsMarkdown: `---
name: tax-loss-harvesting
description: Categorize deductible expenses and spot unrealized equity losses to offset realized gains
triggers: tax, deduction, tax-loss, capital gains, write-off
---

# Tax-Loss Harvesting & Deduction Scout

## Guidelines
- Group eligible expenses into Cloud/Software, Contractor Services, Home Office, Utilities, and Hardware.
- Inspect portfolio holdings where currentPrice < avgPrice to quantify harvestable unrealized losses.
- Highlight documentation gaps (missing invoice IDs or ambiguous merchants) prior to filing.`,
  },
  {
    id: 'skill_gst_invoice_compliance',
    slug: 'gst-invoice-compliance',
    name: 'GST & Cross-Border Invoice Auditor',
    description: 'Reconciles receivables, tax totals, overdue due dates, and GST/VAT line-item consistency across invoices.',
    category: 'Invoicing',
    author: 'ledger-ops',
    repo: 'skills.sh/finance/gst-invoice-compliance',
    installs: 9640,
    triggers: 'gst, vat, invoice, receivable, overdue, tax invoice, reconcile',
    sourceUrl: 'https://skills.sh',
    instructionsMarkdown: `---
name: gst-invoice-compliance
description: Audit invoices for tax calculation consistency, overdue balances, and settlement reconciliation
triggers: gst, vat, invoice audit, overdue invoices, receivables
---

# GST & Invoice Compliance Auditor

## Rules
1. Compare subtotal + taxTotal - discountTotal against grandTotal on every invoice.
2. Flag unpaid invoices past dueDate and prioritize collection follow-up by highest grandTotal.
3. Summarize output tax collected vs pending receivables in structured tabular form.`,
  },
  {
    id: 'skill_subscription_leak',
    slug: 'subscription-leak-detector',
    name: 'Recurring SaaS & Subscription Leak Detector',
    description: 'Uncovers duplicate subscriptions, zombie renewals, and creeping price hikes across recurring charges.',
    category: 'Spend Control',
    author: 'finops-collective',
    repo: 'skills.sh/finops/subscription-leak-detector',
    installs: 18350,
    triggers: 'subscription, recurring, duplicate, saas, cancel, leak, audit spend',
    sourceUrl: 'https://skills.sh',
    instructionsMarkdown: `---
name: subscription-leak-detector
description: Spot recurring charges, duplicate billing signatures, and annual vs monthly savings
triggers: subscription, recurring, duplicate, saas audit
---

# Subscription Leak Detector

## Analysis Steps
- Scan transactions marked isRecurring or appearing multiple times for the same merchant.
- Compute annualized run-rate for each recurring vendor (monthly * 12).
- Recommend consolidation or annual billing switches where recurring fees exceed 10% of spend.`,
  },
  {
    id: 'skill_dcf_valuation',
    slug: 'dcf-equity-valuation',
    name: 'DCF & Public Equity Valuation Analyst',
    description: 'Builds 3-scenario discounted cash flow sensitivity tables, P/E comps, and margin of safety targets.',
    category: 'Investing',
    author: 'quant-craft',
    repo: 'skills.sh/investing/dcf-equity-valuation',
    installs: 8410,
    triggers: 'valuation, dcf, intrinsic value, wacc, stock analysis, equity',
    sourceUrl: 'https://skills.sh',
    instructionsMarkdown: `---
name: dcf-equity-valuation
description: Discounted cash flow sensitivity modeling and equity multiple comparison
triggers: valuation, dcf, intrinsic value, wacc, equity research
---

# DCF & Equity Valuation Analyst

## Methodology
- Always present Bull, Base, and Bear cases with explicit discount rate (WACC) and terminal growth assumptions.
- Include a sensitivity matrix comparing WACC (+/- 1%) vs Terminal Growth (+/- 0.5%).
- Highlight capital allocation efficiency: ROIC vs WACC spread and free cash flow yield.`,
  },
  {
    id: 'skill_board_brief',
    slug: 'quarterly-board-brief',
    name: 'Quarterly CFO Board Brief Writer',
    description: 'Synthesizes KPI deltas, variance narratives, risks, and 90-day capital priorities in executive brief format.',
    category: 'Reporting',
    author: 'liddy-finance',
    repo: 'skills.sh/reporting/quarterly-board-brief',
    installs: 7190,
    triggers: 'board brief, executive summary, quarterly report, cfo memo, variance',
    sourceUrl: 'https://skills.sh',
    instructionsMarkdown: `---
name: quarterly-board-brief
description: Produce Swiss-style boardroom financial summaries with KPI highlights and risk register
triggers: board brief, executive report, cfo memo, quarterly summary
---

# Quarterly CFO Board Brief

## Structure
- Lead with 4 crisp headline KPIs (Revenue/Inflow, Total Burn, Net Cashflow, Portfolio NAV).
- Contrast actual category spend against expectations, citing exact dollar or rupee variances.
- Close with 3 concrete 30-day corrective actions and generate PDF/CSV deliverables when requested.`,
  },
  {
    id: 'skill_portfolio_var',
    slug: 'portfolio-risk-var',
    name: 'Portfolio Concentration & Drawdown Stress Test',
    description: 'Evaluates single-stock weight limits, sector exposure, and -15% / -30% drawdown impact on net worth.',
    category: 'Risk & Portfolio',
    author: 'quant-craft',
    repo: 'skills.sh/investing/portfolio-risk-var',
    installs: 6540,
    triggers: 'portfolio risk, rebalance, drawdown, concentration, allocation, beta',
    sourceUrl: 'https://skills.sh',
    instructionsMarkdown: `---
name: portfolio-risk-var
description: Audit position concentration, unrealized P&L dispersion, and market drawdown resilience
triggers: portfolio risk, rebalance, drawdown, diversification
---

# Portfolio Risk & Stress Test Skill

## Checks
1. Compute weight % of each holding relative to total portfolio value. Flag any single asset > 25%.
2. Simulate portfolio market value under -15% correction and -30% severe bear scenario.
3. Recommend systematic rebalancing trims toward diversified core allocations.`,
  },
  {
    id: 'skill_expense_policy',
    slug: 'expense-policy-auditor',
    name: 'Bill & Expense Policy Compliance Checker',
    description: 'Audits uploaded vendor bills, PDFs, and receipts for duplicates, tax breakdowns, and line-item accuracy.',
    category: 'Bookkeeping',
    author: 'ledger-ops',
    repo: 'skills.sh/finance/expense-policy-auditor',
    installs: 12110,
    triggers: 'bill pdf, receipt, policy check, vendor invoice, expense audit, extract',
    sourceUrl: 'https://skills.sh',
    instructionsMarkdown: `---
name: expense-policy-auditor
description: Line-item verification and policy audit for uploaded vendor bills, PDFs, and receipts
triggers: bill pdf, receipt audit, vendor bill, extract line items
---

# Bill & Expense Policy Compliance Checker

## Execution
- Extract Vendor Name, Document Date, Line Items (Description, Qty, Unit Price, Tax, Total), and Grand Total.
- Cross-check whether line item sums match invoice subtotal + tax.
- Populate interactive charts, structured CSV export, and executive PDF brief automatically when requested.`,
  },
];

export function buildDefaultSkills(userId: string): AiSkillRecord[] {
  const now = new Date().toISOString();
  // Seed top 3 essential skills enabled by default so Agent Mode immediately shines
  return CURATED_FINANCE_SKILLS.slice(0, 3).map((item) => ({
    skillId: item.id,
    userId,
    name: item.name,
    slug: item.slug,
    source: 'builtin',
    category: item.category,
    description: item.description,
    triggers: item.triggers,
    instructionsMarkdown: item.instructionsMarkdown,
    author: item.author,
    repo: item.repo,
    installs: item.installs,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }));
}

export interface ConnectorCatalogTemplate {
  connectorId: string;
  name: string;
  slug: string;
  providerType: 'builtin' | 'catalog';
  category: string;
  description: string;
  endpointUrl: string;
  transport: 'builtin' | 'http' | 'sse';
  authType: 'none' | 'bearer' | 'api_key';
  toolsList: string[];
  defaultEnabled: boolean;
}

export const MCP_CONNECTOR_TEMPLATES: ConnectorCatalogTemplate[] = [
  {
    connectorId: 'mcp_cat_google_drive',
    name: 'Google Drive',
    slug: 'google-drive-mcp',
    providerType: 'catalog',
    category: 'Workspace',
    description: 'Search vendor contracts, tax filings, bank PDFs, and quarterly statements stored in Google Drive.',
    endpointUrl: 'https://mcp.google.com/drive',
    transport: 'http',
    authType: 'bearer',
    toolsList: ['search_drive_files', 'read_pdf_document', 'list_folder_receipts'],
    defaultEnabled: false,
  },
  {
    connectorId: 'mcp_cat_gmail',
    name: 'Gmail',
    slug: 'gmail-mcp',
    providerType: 'catalog',
    category: 'Workspace',
    description: 'Fetch billing threads, remittance advices, and client invoice confirmations directly from Gmail.',
    endpointUrl: 'https://mcp.google.com/gmail',
    transport: 'http',
    authType: 'bearer',
    toolsList: ['search_billing_threads', 'read_invoice_attachment', 'draft_payment_followup'],
    defaultEnabled: false,
  },
  {
    connectorId: 'mcp_cat_google_sheets',
    name: 'Google Sheets',
    slug: 'google-sheets-mcp',
    providerType: 'catalog',
    category: 'Workspace',
    description: 'Read financial models, budget trackers, and board KPI workbooks synced across Google Sheets.',
    endpointUrl: 'https://mcp.google.com/sheets',
    transport: 'http',
    authType: 'bearer',
    toolsList: ['read_sheet_range', 'append_ledger_rows', 'list_spreadsheet_tabs'],
    defaultEnabled: false,
  },
  {
    connectorId: 'mcp_cat_notion',
    name: 'Notion',
    slug: 'notion-mcp',
    providerType: 'catalog',
    category: 'Workspace',
    description: 'Log CFO memos, monthly close checklists, and board briefing notes to your Notion workspace.',
    endpointUrl: 'https://mcp.notion.com/mcp',
    transport: 'http',
    authType: 'bearer',
    toolsList: ['search_finance_pages', 'append_cfo_memo', 'query_close_database'],
    defaultEnabled: false,
  },
  {
    connectorId: 'mcp_cat_slack',
    name: 'Slack',
    slug: 'slack-mcp',
    providerType: 'catalog',
    category: 'Workspace',
    description: 'Monitor finance approval channels and summarize vendor spend requests from Slack.',
    endpointUrl: 'https://mcp.slack.com/mcp',
    transport: 'http',
    authType: 'bearer',
    toolsList: ['read_finance_channel', 'post_spend_summary', 'list_approval_requests'],
    defaultEnabled: false,
  },
  {
    connectorId: 'mcp_cat_github',
    name: 'GitHub',
    slug: 'github-mcp',
    providerType: 'catalog',
    category: 'Workspace',
    description: 'Inspect engineering cloud infrastructure usage, release milestones, and FinOps issue trackers.',
    endpointUrl: 'https://api.githubcopilot.com/mcp/',
    transport: 'http',
    authType: 'bearer',
    toolsList: ['list_billing_issues', 'read_finops_reports', 'search_repositories'],
    defaultEnabled: false,
  },
  {
    connectorId: 'mcp_cat_plaid',
    name: 'Plaid Open Banking',
    slug: 'plaid-mcp',
    providerType: 'catalog',
    category: 'Banking',
    description: 'Aggregate checking balances, corporate card liabilities, and bank feeds through Plaid MCP.',
    endpointUrl: 'https://mcp.plaid.com/mcp',
    transport: 'sse',
    authType: 'api_key',
    toolsList: ['get_account_balances', 'sync_bank_transactions', 'fetch_liabilities'],
    defaultEnabled: false,
  },
  {
    connectorId: 'mcp_cat_stripe',
    name: 'Stripe Treasury',
    slug: 'stripe-mcp',
    providerType: 'catalog',
    category: 'Banking',
    description: 'Inspect MRR, payout settlements, refund velocity, and subscription churn metrics from Stripe.',
    endpointUrl: 'https://mcp.stripe.com',
    transport: 'http',
    authType: 'bearer',
    toolsList: ['list_charges', 'get_balance_transactions', 'list_subscriptions'],
    defaultEnabled: false,
  },
  {
    connectorId: 'mcp_cat_quickbooks',
    name: 'QuickBooks Online',
    slug: 'quickbooks-mcp',
    providerType: 'catalog',
    category: 'Accounting',
    description: 'Query P&L statements, balance sheets, chart of accounts, and open vendor bills in QuickBooks.',
    endpointUrl: 'https://mcp.quickbooks.com/mcp',
    transport: 'http',
    authType: 'bearer',
    toolsList: ['query_profit_and_loss', 'list_vendor_bills', 'get_chart_of_accounts'],
    defaultEnabled: false,
  },
  {
    connectorId: 'mcp_cat_xero',
    name: 'Xero Accounting',
    slug: 'xero-mcp',
    providerType: 'catalog',
    category: 'Accounting',
    description: 'Connect Xero ledgers, bank reconciliations, and tax returns through standard JSON-RPC MCP.',
    endpointUrl: 'https://mcp.xero.com/mcp',
    transport: 'http',
    authType: 'bearer',
    toolsList: ['list_bank_transactions', 'get_trial_balance', 'list_overdue_invoices'],
    defaultEnabled: false,
  },
];

export function buildDefaultConnectors(userId: string): McpConnectorRecord[] {
  const now = new Date().toISOString();
  return MCP_CONNECTOR_TEMPLATES.map((tpl) => ({
    connectorId: tpl.connectorId,
    userId,
    name: tpl.name,
    slug: tpl.slug,
    providerType: tpl.providerType,
    category: tpl.category,
    description: tpl.description,
    endpointUrl: tpl.endpointUrl,
    transport: tpl.transport,
    authType: tpl.authType,
    toolsList: tpl.toolsList,
    status: 'disconnected',
    enabled: tpl.defaultEnabled,
    createdAt: now,
    updatedAt: now,
  }));
}
