# Liddy — Autonomous Finance OS

> **Swiss-precision personal wealth workspace, global equity terminal, automated invoicing studio, and agentic AI CFO powered by Gemini, Firebase Firestore, and Model Context Protocol (MCP).**

[![Stack](https://img.shields.io/badge/Stack-React%2019%20%E2%80%A2%20TypeScript%20%E2%80%A2%20Express%20%E2%80%A2%20Tailwind-4F46E5)](#architecture)
[![AI Engine](https://img.shields.io/badge/AI-Gemini%204%20Hydrogen%20%2B%203.1%20Flash%20Lite-0F766E)](#liddy-ai-cfo-agent--skills)
[![Database](https://img.shields.io/badge/Cloud-Firebase%20Auth%20%2B%20Firestore-D97706)](#firestore-schema--security-model)

Liddy unifies everyday expense tracking, OCR receipt scanning, brokerage portfolio analytics, multi-format presentation creation, Swiss-precision invoicing, and an autonomous AI CFO inside one cohesive workspace with strict automatic regional isolation (`/in` and `/intl`).

---

## Key Capabilities

| Module | Route Segment | Core Functionality |
| :--- | :--- | :--- |
| **Wealth Overview** | `/workspace/overview` | Live net worth summary, monthly inflow vs. burn trends, category breakdown, brokerage NAV, and recent bills. |
| **Expense Ledger & OCR** | `/workspace/expenses` | Multi-currency ledger (`INR ₹`, `USD $`, etc.), category auditing, duplicate cleansing, and receipt photo extraction. |
| **Swiss Invoice Studio** | `/workspace/invoices` | 5 Swiss paper templates across A4, US Letter, and Thermal formats with print-ready PDF, HTML, `.eml`, and Gmail dispatch. |
| **Global Markets** | `/workspace/markets` | Real-time equity quotes, watchlists, company financial deep dives, and curated market wire search grounding. |
| **Liddy AI CFO** | `/workspace/agent` | Conversational + Agentic workflows with inline Recharts graphs, CSV exports, pure-TS `.pdf` reports, MCP Connectors, and `SKILL.md` playbooks. |
| **Live Voice Advisor** | `/workspace/voice` | Full-duplex Gemini Live acoustic voice sessions with real-time financial context. |
| **Vision Studio** | `/workspace/vision` | Multi-slide AI financial decks, goal artwork generation, collaborative rooms, and `.pptx`, `.pdf`, `.html`, `.md` exports. |
| **Admin Portal** | `/admin` | Platform analytics, revenue telemetry, payout gateway configuration, and live Design/Assets documentation kit. |

---

## Automatic Regional Payment Isolation (`/in` vs `/intl`)

Liddy enforces strict payment-rail separation without exposing regional switchers in customer UI:

1. **First-Visit Detection**: On initial load, `FinMindContext` queries `/api/geo/region` (server IP geo headers) and inspects client timezone (`Asia/Kolkata`) to classify users into `IN` or `INTL`.
2. **Scoped Routing (`utils/router.ts`)**:
   - **`/in/*` (India Experience)**: Defaults currency to `INR ₹`, renders tier pricing in rupees (`₹49` Day / `₹149` Month / `₹999` Year), activates **UPI QR & VPA** settlement flows (`Hyperswitch` India + `UPIPaymentModal`), and completely hides PayPal UI/copy across pricing, checkout, and invoices.
   - **`/intl/*` (International Experience)**: Defaults currency to `USD $`, renders tier pricing in dollars (`$2` Day / `$9` Month / `$20` Year), activates **PayPal** checkout & client payment links, and completely hides UPI UI/copy everywhere in the app.
3. **Locked Integrity**: All checkout modals, invoices, and pricing views read the resolved regional route automatically.

---

## Liddy AI CFO, External Connectors & Skills (`SKILL.md`)

Liddy AI opens with a focused conversation canvas (and a collapsible history rail on demand) wired with server-side failover and persistent Firestore session sync:

### Model Failover Router (`server.ts`)
- **Primary Engine**: `gemini-4-hydrogen` handles multi-step reasoning, uploaded bill PDFs, function calling, and live Google Search grounding.
- **Automatic Resiliency**: If upstream returns `HTTP 429` quota exhaustion or gateway timeout, requests seamlessly fail over to `gemini-3.1-flash-lite` (`ThinkingLevel.MINIMAL`) during a 5-minute cooldown so chat, visualizations, and downloads stay responsive.

### Automatic Financial Toolset & Inline Deliverables
Uploading a bill PDF, statement, or receipt inside Agent Mode automatically triggers structured extraction and generates ready-to-use deliverables inside the chat bubble:
- **Interactive Charts**: Inline Recharts Bar, Area, and Donut Pie cards rendered from tool specs.
- **CSV Dashboards**: Multi-column normalized tables previewed inline with 1-click `.csv` download.
- **Executive PDF Briefs**: Pure TypeScript `%PDF-1.4` multi-page builder (`utils/agentPdfBuilder.ts`) producing downloadable KPI and table reports without external binary dependencies.
- **Live Ledger Mutations**: Cleanse duplicate transactions, normalize merchant names, or mark overdue invoices paid with user approval.

### External Connectors (MCP) & Custom Skills
- **Connectors Modal**: Supports curated external **Workspace** (`Google Drive`, `Gmail`, `Google Sheets`, `Notion`, `Slack`, `GitHub`), **Banking** (`Plaid Open Banking`, `Stripe Treasury`), **Accounting** (`QuickBooks Online`, `Xero Accounting`), plus **Custom HTTP/SSE MCP** endpoints verified over JSON-RPC 2.0 (`initialize` + `tools/list`). Built-in Liddy finance capabilities stay active automatically in Agent Mode without cluttering the MCP directory.
- **Skills Workspace (`SKILL.md`)**: Install community finance playbooks from the `skills.sh` search endpoint (`/api/skills/search`) or author custom workflows with YAML frontmatter and Markdown instructions. Active skills sync to `users/{userId}/ai_skills` in Firestore and inject directly into the Liddy AI system prompt.

---

## Vision Studio Presentation & Visual Exports

Vision Studio (`components/GoalVisualizer.tsx`) combines AI-assisted slide deck authoring, shared room codes (`?room=...`), and bundled photography with multi-format exports:
- **8 Deck Themes & 4 Typography Presets**: From Ivory Swiss and Cobalt Brief to Obsidian Swiss and Wealth Emerald.
- **Export Formats**: Download decks cleanly as `.pptx` (Office Open XML ZIP via `utils/pptxBuilder.ts`), print-ready multi-slide `.pdf`, standalone interactive `.html`, or structured `.md` speaker outlines.

---

## Architecture

```
+-------------------------------------------------------------------------+
|                    CLIENT SPA (React 19 + Vite + Tailwind)              |
|  utils/router.ts (/in/* | /intl/*)  <->  FinMindContext (State + Auth)  |
|  - Swiss Paper (#F6F6F4) & Obsidian (#09090B) Design System             |
|  - Recharts Visualizations · Swiss Print Invoices · Pure-TS PDF/PPTX    |
+------------------------------------+------------------------------------+
                                     | HTTPS /api/* & Bearer OAuth
                                     v
+-------------------------------------------------------------------------+
|                EXPRESS FULL-STACK SERVER (server.ts :3000)              |
|  - /api/gemini/*       Primary (gemini-4-hydrogen) -> Fallback Router   |
|  - /api/skills/search  Curated + Live skills.sh Registry Search         |
|  - /api/mcp/inspect    External HTTP/SSE JSON-RPC 2.0 Discovery         |
|  - /api/geo/region     IP Geo Classification (IN vs INTL)               |
|  - /api/payments/*     Hyperswitch India UPI & Intl PayPal Verification |
+------------------------------------+------------------------------------+
                                     | Firebase Admin & Client SDK
                                     v
+-------------------------------------------------------------------------+
|               FIREBASE AUTHENTICATION & FIRESTORE CLOUD DB              |
|  - Strict Default-Deny firestore.rules (Owner-Scoped Subcollections)    |
|  - Real-Time Sync: Transactions, Invoices, Portfolio, Chat, Skills, MCP |
+-------------------------------------------------------------------------+
```

---

## Firestore Schema & Security Model

All user financial records live in strictly owner-scoped subcollections protected by `firestore.rules`:

| Collection Path | Read / Write Access | Purpose |
| :--- | :--- | :--- |
| `users/{userId}` | Owner + Admin | User identity metadata, role, and profile timestamps. |
| `users/{userId}/preferences/{prefId}` | Owner scoped | Currency display, Light/Dark theme, language, watchlist, tier state. |
| `users/{userId}/transactions/{txId}` | Owner scoped | Expenses, income records, OCR receipt metadata, and payment rail links. |
| `users/{userId}/invoices/{invId}` | Owner scoped | Swiss Paper invoices, tax breakdowns, and paid/overdue tracking. |
| `users/{userId}/portfolio/{portId}` | Owner scoped | Equity brokerage holdings, share counts, and cost basis. |
| `users/{userId}/goals/{goalId}` | Owner scoped | Financial target visuals and savings projections. |
| `users/{userId}/chat_sessions/{sessionId}` | Owner scoped | Liddy AI threads, serialized Recharts specs, CSV & PDF report payloads. |
| `users/{userId}/ai_skills/{skillId}` | Owner scoped | Installed `skills.sh` and custom user-authored `SKILL.md` playbooks. |
| `users/{userId}/mcp_connectors/{connectorId}` | Owner scoped | Connected external Workspace, Banking, Accounting, and Custom MCP servers. |
| `payments/{paymentId}` | Owner + Admin | Verified Hyperswitch UPI (`IN`) & PayPal (`INTL`) checkout receipts. |
| `platform_config/payout_public` | Signed-in read | Admin-configured merchant VPA and regional payment activation state. |

---

## Design Tokens & Typography

| Token | Hex | Role |
| :--- | :--- | :--- |
| **Swiss Paper Canvas** | `#F6F6F4` | Default light workspace background |
| **Pure Ledger Surface** | `#FFFFFF` | Cards, invoice sheets, and modal containers |
| **Hairline Border** | `#E5E5E5` | Structural card and grid dividers |
| **Obsidian Portal** | `#09090B` | Dark workspace canvas and Admin surface |
| **Liddy Indigo** | `#4F46E5` | Primary interactive controls and focus states |
| **Executive Teal** | `#0F766E` | Positive cashflow metrics and primary Recharts series |

- **Display**: `Outfit` (`font-display`)
- **UI & Body**: `Plus Jakarta Sans` (`font-sans`)
- **Financial Numerals**: `JetBrains Mono` (`font-mono tabular-nums`)

---

## Environment Variables

Create a local environment file based on `.env.example` before starting the server:

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Yes | Server-side key for `/api/gemini/*` endpoints (never exposed to browser bundle). |
| `PORT` | No | Express + Vite server port (defaults to `3000`). |
| `VITE_GOOGLE_CLIENT_ID` | Optional | Client-side Google Workspace OAuth token flow for direct Gmail invoice sending. |
| `HYPERSWITCH_API_KEY` | Optional | Live Hyperswitch orchestrator secret for server-side payment verification. |

---

## Local Setup & Scripts

```bash
# 1. Install dependencies
npm install

# 2. Run full-stack Express + Vite server on http://localhost:3000
npm run dev

# 3. Typecheck and build production bundle
npm run lint
npm run build

# 4. Start production server
npm start
```

---

## Project Structure

```
.
├── App.tsx                       # Root window router & regional shell controller
├── server.ts                     # Express backend, Gemini failover router, MCP & skills APIs
├── firebase.ts                   # Firebase SDK initialization & Firestore error wrappers
├── firestore.rules               # Default-deny Firestore security rules
├── context/
│   └── FinMindContext.tsx        # App state, Auth, Firestore sync, regional & theme context
├── components/
│   ├── ChatAssistant.tsx         # Liddy AI CFO, collapsed sidebar, inline CSV/PDF/chart cards
│   ├── AgentStudioDrawers.tsx    # Centered Claude/ChatGPT-style Connectors & Skills modals
│   ├── AdminAnalyticsPortal.tsx  # Admin metrics, user access control & Assets hub
│   ├── AdminAssetsShowcase.tsx   # Live tokens, diagrams, media gallery & README viewer
│   ├── Dashboard.tsx             # Net worth, cashflow analytics & goal widgets
│   ├── Transactions.tsx          # Expense ledger, OCR receipt scanner & invoice workspace
│   ├── GoalVisualizer.tsx        # Vision Studio slide deck creator & PPTX/PDF/HTML export
│   └── Markets.tsx               # Real-time stock quotes, watchlists & news grounding
├── services/
│   ├── geminiService.ts          # Client SDK bridge to /api/gemini/*, /api/skills & /api/mcp
│   └── agentExtensionsData.ts    # Curated external MCP templates & default finance SKILL.md library
└── utils/
    ├── router.ts                 # /in and /intl regional URL parser & SEO metadata sync
    ├── agentPdfBuilder.ts        # Pure TypeScript %PDF-1.4 multi-page report builder
    ├── pptxBuilder.ts            # Pure TypeScript Office Open XML .pptx presentation exporter
    └── invoicePrint.ts           # Swiss invoice HTML templates & iframe print formatter
```
