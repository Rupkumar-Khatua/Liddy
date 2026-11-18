import React, { useState } from 'react';
import { Logo } from './Logo';
import { STUDIO_MEDIA } from '../src/assets/studioMedia';
import { TEMPLATE_LABELS, PAPER_FORMAT_SPECS } from '../utils/invoicePrint';
import readmeContent from '../README.md?raw';

type ShowcaseSection = 'all' | 'docs' | 'architecture' | 'typography' | 'tokens' | 'gallery' | 'studio';

interface DesignTokenItem {
  name: string;
  cssVar: string;
  hex: string;
  usage: string;
  darkText?: boolean;
}

const DESIGN_TOKENS: DesignTokenItem[] = [
  { name: 'Swiss Paper Canvas', cssVar: '--bg-swiss-paper', hex: '#F6F6F4', usage: 'Primary light workspace backdrop', darkText: true },
  { name: 'Pure Ledger Surface', cssVar: '--surface-card', hex: '#FFFFFF', usage: 'Invoice sheets & dashboard cards', darkText: true },
  { name: 'Crisp Hairline Border', cssVar: '--border-hairline', hex: '#E5E5E5', usage: 'Swiss structural cell & card borders', darkText: true },
  { name: 'Obsidian Portal Ground', cssVar: '--bg-obsidian', hex: '#0A0B0E', usage: 'Dark workspace & Admin control plane' },
  { name: 'Slate Card Elevation', cssVar: '--surface-dark-card', hex: '#141418', usage: 'Dark mode panels & glass containers' },
  { name: 'Liddy Indigo Accent', cssVar: '--accent-indigo', hex: '#4F46E5', usage: 'Interactive controls & active tab pills' },
  { name: 'Executive Teal', cssVar: '--chart-teal', hex: '#0F766E', usage: 'Primary Recharts positive cashflow bar' },
  { name: 'Institutional Blue', cssVar: '--chart-blue', hex: '#2563EB', usage: 'Benchmark curves & secondary chart series' },
  { name: 'Amber Signal', cssVar: '--chart-amber', hex: '#D97706', usage: 'Pending settlements & tax alerts' },
];

const SLIDE_THEMES_DOC = [
  { id: 'ivory', name: 'Ivory Swiss', bg: '#FFFFFF', card: '#FAFAFA', text: '#111111', accent: '#1D4ED8', border: '#E5E5E5' },
  { id: 'midnight', name: 'Obsidian Swiss', bg: '#0F1115', card: '#161922', text: '#F8FAFC', accent: '#38BDF8', border: '#262B38' },
  { id: 'emerald', name: 'Sage Studio', bg: '#F6FAF8', card: '#FFFFFF', text: '#0F241B', accent: '#047857', border: '#DCEADF' },
  { id: 'cobalt', name: 'Cobalt Brief', bg: '#F5F8FF', card: '#FFFFFF', text: '#0F172A', accent: '#1E40AF', border: '#DCE5FA' },
  { id: 'ledger', name: 'Warm Ledger', bg: '#FCFBF7', card: '#FFFFFF', text: '#1C1917', accent: '#B45309', border: '#EAE4D7' },
  { id: 'navy', name: 'Institutional Navy', bg: '#0B1528', card: '#12203B', text: '#F1F5F9', accent: '#60A5FA', border: '#243758' },
  { id: 'charcoal', name: 'Monochrome Slate', bg: '#18181B', card: '#202024', text: '#FAFAFA', accent: '#E4E4E7', border: '#2E2E33' },
  { id: 'growth', name: 'Wealth Emerald', bg: '#06241B', card: '#0A3025', text: '#ECFDF5', accent: '#34D399', border: '#144B3A' },
];

const SLIDE_FONT_PRESETS = [
  { id: 'swiss_sans', label: 'Swiss Modern Sans', family: "'Inter', 'Plus Jakarta Sans', sans-serif", sample: 'Q4 Operating Margin · +18.4%' },
  { id: 'editorial_serif', label: 'Editorial Serif', family: "Georgia, 'Times New Roman', serif", sample: 'Annual Capital Allocation Brief' },
  { id: 'mono_quant', label: 'Quant Terminal', family: "'JetBrains Mono', monospace", sample: 'EV/EBITDA 14.2x | FCF $4.82M' },
  { id: 'executive_geometric', label: 'Executive Geometric', family: "'Outfit', 'Plus Jakarta Sans', sans-serif", sample: '90-Day Liquidity Roadmap' },
];

const AGENT_SKILLS_DOC = [
  {
    tool: 'generate_visual_dashboard',
    trigger: 'Visualize / chart / breakdown / trend prompts',
    output: 'Inline interactive Recharts Bar, Donut Pie, or Area Trend cards inside chat',
  },
  {
    tool: 'export_csv_dashboard',
    trigger: 'CSV / spreadsheet / table export prompts',
    output: 'Structured multi-column CSV preview card + one-click .csv file download',
  },
  {
    tool: 'export_pdf_report',
    trigger: 'PDF / board brief / statement summary prompts',
    output: 'Pure TypeScript %PDF-1.4 multi-page generator with KPIs, bullets & tables',
  },
  {
    tool: 'audit_and_cleanse_ledger',
    trigger: 'Cleanse / normalize / categorize / mark paid prompts',
    output: 'Live Firestore mutations applied directly to transactions & invoices',
  },
  {
    tool: 'calculate_financial_ratios',
    trigger: 'Margins / savings rate / burn & runway math',
    output: 'Exact server-side arithmetic free from LLM rounding errors',
  },
  {
    tool: 'forecast_savings_compound',
    trigger: 'Goal compounding / SIP & retirement projections',
    output: 'Monthly contribution compounding curve with inflation sensitivity',
  },
];

const FIRESTORE_COLLECTIONS_DOC = [
  { path: 'users/{userId}', scope: 'Owner + Admin read', purpose: 'User identity, display name, profile metadata' },
  { path: 'users/{userId}/preferences/{prefId}', scope: 'Owner scoped', purpose: 'Plan tier, currency, themeMode, watchlist, orgId' },
  { path: 'users/{userId}/transactions/{txId}', scope: 'Owner scoped', purpose: 'Expenses & inflows linked to invoices & payment rails' },
  { path: 'users/{userId}/invoices/{invId}', scope: 'Owner scoped', purpose: 'Swiss Paper / GST / Global invoices & settlement status' },
  { path: 'users/{userId}/portfolio/{portId}', scope: 'Owner scoped', purpose: 'Connected stock broker totals, holdings & notes' },
  { path: 'users/{userId}/goals/{goalId}', scope: 'Owner scoped', purpose: 'Generated & edited financial goal visuals' },
  { path: 'users/{userId}/chat_sessions/{sessionId}', scope: 'Owner scoped', purpose: 'Liddy AI CFO persistent threads, charts & export specs' },
  { path: 'payments/{paymentId}', scope: 'Owner + Admin audit', purpose: 'Hyperswitch India UPI & International PayPal settlements' },
  { path: 'platform_config/payout_public', scope: 'Signed-in read', purpose: 'Admin-controlled UPI VPA & PayPal client routing flags' },
];

const GALLERY_ASSETS = [
  { title: 'Hero Founder Workspace', subtitle: 'Landing & Editorial Desk · src/assets/images', src: STUDIO_MEDIA.heroFounderWorkspace, ratio: '16:9 JPG' },
  { title: 'Invoicing Desk Showcase', subtitle: 'Swiss Paper Studio Visual · src/assets/images', src: STUDIO_MEDIA.featureInvoicingDesk, ratio: '4:3 JPG' },
  { title: 'Voice Acoustics Studio', subtitle: 'Live Gemini Audio Visual · src/assets/images', src: STUDIO_MEDIA.featureVoiceAcoustics, ratio: '4:3 JPG' },
  { title: 'Founder Avatar Portrait', subtitle: 'Profile & Persona Preset · src/assets/images', src: STUDIO_MEDIA.avatarFounderPortrait, ratio: '1:1 JPG' },
  { title: 'Liddy Brand Reference', subtitle: 'Public AI Studio Asset · /assets/aistudio', src: '/assets/aistudio/liddy_8776a7f5.png', ratio: 'PNG' },
  { title: 'Workspace Capture', subtitle: 'Product Overview Reference · /assets/aistudio', src: '/assets/aistudio/screenshot_1_16af8202.png', ratio: 'PNG' },
  { title: 'Account Module Asset', subtitle: 'Identity UI Reference · /assets/aistudio', src: '/assets/aistudio/account_b099b848.png', ratio: 'PNG' },
  { title: 'Layout Direction Ref', subtitle: 'Visual Style Reference · /assets/aistudio', src: '/assets/aistudio/make_like_this_2f2a66bd.png', ratio: 'PNG' },
];

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={`b-${keyIdx++}`} className="font-bold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={`c-${keyIdx++}`}
          className="px-1.5 py-0.5 rounded bg-white/10 text-sky-300 font-mono text-[11px]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        if (linkMatch[2].startsWith('https://img.shields.io/')) {
          parts.push(
            <span
              key={`badge-${keyIdx++}`}
              className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-[11px] font-mono text-indigo-300 mr-1.5"
            >
              {linkMatch[1]}
            </span>
          );
        } else {
          parts.push(
            <a
              key={`a-${keyIdx++}`}
              href={linkMatch[2]}
              className="text-sky-400 hover:underline font-medium"
            >
              {linkMatch[1]}
            </a>
          );
        }
      }
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

const MarkdownPreviewRenderer: React.FC<{ markdown: string }> = ({ markdown }) => {
  const lines = markdown.split(/\r?\n/);
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed === '---') {
      nodes.push(<hr key={`hr-${blockKey++}`} className="border-white/10 my-4" />);
      i++;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      nodes.push(
        <div key={`code-${blockKey++}`} className="rounded-xl border border-white/10 bg-[#08090D] overflow-hidden my-3">
          {lang && (
            <div className="px-3.5 py-1.5 border-b border-white/10 text-[10px] font-mono uppercase text-neutral-400 bg-white/[0.03]">
              {lang}
            </div>
          )}
          <pre className="p-3.5 text-xs font-mono text-neutral-200 overflow-x-auto leading-relaxed">
            {codeLines.join('\n')}
          </pre>
        </div>
      );
      continue;
    }

    if (trimmed.startsWith('# ')) {
      nodes.push(
        <h1 key={`h1-${blockKey++}`} className="text-2xl font-extrabold text-white tracking-tight pt-1 pb-2 border-b border-white/10">
          {renderInlineMarkdown(trimmed.slice(2))}
        </h1>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith('## ')) {
      nodes.push(
        <h2 key={`h2-${blockKey++}`} className="text-lg font-bold text-white pt-4 pb-1">
          {renderInlineMarkdown(trimmed.slice(3))}
        </h2>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith('### ')) {
      nodes.push(
        <h3 key={`h3-${blockKey++}`} className="text-sm font-bold text-indigo-300 pt-2">
          {renderInlineMarkdown(trimmed.slice(4))}
        </h3>
      );
      i++;
      continue;
    }

    if (trimmed.startsWith('> ')) {
      nodes.push(
        <blockquote key={`bq-${blockKey++}`} className="rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-4 py-3 text-xs text-neutral-200 leading-relaxed my-2">
          {renderInlineMarkdown(trimmed.slice(2))}
        </blockquote>
      );
      i++;
      continue;
    }

    // Markdown table
    if (trimmed.startsWith('|') && i + 1 < lines.length && lines[i + 1].trim().startsWith('|') && lines[i + 1].includes('---')) {
      const headerCells = trimmed
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        bodyRows.push(
          lines[i]
            .trim()
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim())
        );
        i++;
      }
      nodes.push(
        <div key={`tbl-${blockKey++}`} className="overflow-x-auto rounded-2xl border border-white/10 my-3">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.04] text-[10px] font-mono uppercase text-neutral-400">
                {headerCells.map((hc, hIdx) => (
                  <th key={hIdx} className="px-3.5 py-2.5 whitespace-nowrap">
                    {hc}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rIdx) => (
                <tr key={rIdx} className="border-b last:border-b-0 border-white/[0.06]">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3.5 py-2 text-neutral-300 align-top">
                      {renderInlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Lists (- or 1.)
    if (trimmed.startsWith('- ') || /^\d+\.\s+/.test(trimmed)) {
      const isOrdered = /^\d+\.\s+/.test(trimmed);
      const items: string[] = [];
      while (
        i < lines.length &&
        (isOrdered ? /^\d+\.\s+/.test(lines[i].trim()) : lines[i].trim().startsWith('- '))
      ) {
        items.push(
          isOrdered
            ? lines[i].trim().replace(/^\d+\.\s+/, '')
            : lines[i].trim().slice(2)
        );
        i++;
      }
      nodes.push(
        isOrdered ? (
          <ol key={`ol-${blockKey++}`} className="list-decimal list-inside space-y-1.5 text-xs text-neutral-300 leading-relaxed pl-1">
            {items.map((item, idx) => (
              <li key={idx}>{renderInlineMarkdown(item)}</li>
            ))}
          </ol>
        ) : (
          <ul key={`ul-${blockKey++}`} className="list-disc list-inside space-y-1.5 text-xs text-neutral-300 leading-relaxed pl-1">
            {items.map((item, idx) => (
              <li key={idx}>{renderInlineMarkdown(item)}</li>
            ))}
          </ul>
        )
      );
      continue;
    }

    // Badge-only paragraphs cleanly wrap inline
    if (trimmed.startsWith('[![') && trimmed.endsWith(')')) {
      const badgeLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('[![')) {
        badgeLines.push(lines[i].trim().replace(/^\[!\[([^\]]+)\]\([^)]+\)\]\(([^)]+)\)/, '[$1]($2)'));
        i++;
      }
      nodes.push(
        <div key={`badges-${blockKey++}`} className="flex flex-wrap items-center gap-2 py-1">
          {badgeLines.map((b, bIdx) => {
            const m = b.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
            return (
              <a
                key={bIdx}
                href={m ? m[2] : '#'}
                className="px-2.5 py-1 rounded-lg bg-white/[0.06] border border-white/10 text-[11px] font-mono text-neutral-200 hover:border-indigo-400/50 transition-colors"
              >
                {m ? m[1] : b}
              </a>
            );
          })}
        </div>
      );
      continue;
    }

    nodes.push(
      <p key={`p-${blockKey++}`} className="text-xs sm:text-[13px] text-neutral-300 leading-relaxed">
        {renderInlineMarkdown(trimmed)}
      </p>
    );
    i++;
  }

  return <div className="space-y-3">{nodes}</div>;
};

export const AdminAssetsShowcase: React.FC = () => {
  const [section, setSection] = useState<ShowcaseSection>('all');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [readmeTab, setReadmeTab] = useState<'rendered' | 'raw'>('rendered');
  const [readmeCopied, setReadmeCopied] = useState(false);

  const handleCopyReadme = async () => {
    try {
      await navigator.clipboard.writeText(readmeContent);
    } catch {}
    setReadmeCopied(true);
    setTimeout(() => setReadmeCopied(false), 2000);
  };

  const handleDownloadReadme = () => {
    const blob = new Blob([readmeContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'README.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleCopyToken = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedToken(value);
      setTimeout(() => setCopiedToken(null), 1800);
    } catch {
      setCopiedToken(value);
      setTimeout(() => setCopiedToken(null), 1800);
    }
  };

  const downloadBrandLogoSvg = () => {
    const svg = `<svg width="256" height="256" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" rx="8" fill="#0F1115"/>
  <path d="M6 5C6 4.44772 6.44772 4 7 4H12C12.5523 4 13 4.44772 13 5V22H24C24.5523 22 25 22.4477 25 23V27C25 27.5523 24.5523 28 24 28H7C6.44772 28 6 27.5523 6 27V5Z" fill="#F8FAFC"/>
  <path d="M13 14L22 5C22.3905 4.60948 23.0237 4.60948 23.4142 5L26 7.58579C26.3905 7.97631 26.3905 8.60948 26 9L18 17H13V14Z" fill="#6366F1"/>
  <circle cx="24.5" cy="14.5" r="2" fill="#38BDF8"/>
</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'liddy-brand-mark.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const show = (target: Exclude<ShowcaseSection, 'all'>) =>
    section === 'all' || section === target;

  return (
    <div className="space-y-8">
      {/* Header Banner & Section Filter */}
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#12141C] via-[#0F1117] to-[#161926] p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] font-mono uppercase tracking-widest font-bold px-2.5 py-1 rounded-md bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              Admin Design &amp; Engineering Kit
            </span>
            <span className="text-[10px] font-mono text-neutral-400">
              v2.4 · Swiss Paper &amp; Obsidian OS
            </span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight font-display">
            Liddy Application Documentation, Design System &amp; Studio Assets
          </h2>
          <p className="text-sm text-neutral-400 leading-relaxed">
            Interactive reference showcasing regional routing (/in vs /intl), Gemini failover architecture, typography hierarchy, copyable CSS tokens, brand marks, visual media, slide themes, invoice formats, and Firestore schemas.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'all', label: 'All Docs' },
              { id: 'docs', label: 'GitHub README' },
              { id: 'architecture', label: 'Architecture' },
              { id: 'typography', label: 'Typography' },
              { id: 'tokens', label: 'Design Tokens' },
              { id: 'gallery', label: 'Visual Media' },
              { id: 'studio', label: 'Studio & Schema' },
            ] as Array<{ id: ShowcaseSection; label: string }>
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-colors whitespace-nowrap ${
                section === item.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white/[0.06] text-neutral-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* 0. GitHub-Ready README.md Viewer (Rendered Preview + Raw + Copy + Download) */}
      {show('docs') && (
        <section className="rounded-3xl border border-white/10 bg-[#111319] p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-indigo-400 font-bold">
                Repository Documentation · README.md
              </span>
              <h3 className="text-lg font-bold text-white mt-0.5">
                GitHub-Ready Technical &amp; Product Documentation
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-white/[0.06] p-1 rounded-xl border border-white/10">
                <button
                  type="button"
                  onClick={() => setReadmeTab('rendered')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    readmeTab === 'rendered'
                      ? 'bg-indigo-600 text-white'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  Rendered Preview
                </button>
                <button
                  type="button"
                  onClick={() => setReadmeTab('raw')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    readmeTab === 'raw'
                      ? 'bg-indigo-600 text-white'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  Raw Markdown
                </button>
              </div>

              <button
                type="button"
                onClick={handleCopyReadme}
                className="px-3.5 py-2 rounded-xl bg-white/[0.08] hover:bg-white/15 border border-white/15 text-xs font-bold text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                {readmeCopied ? 'Copied README' : 'Copy README'}
              </button>

              <button
                type="button"
                onClick={handleDownloadReadme}
                className="px-3.5 py-2 rounded-xl bg-white text-neutral-950 hover:bg-neutral-200 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap"
              >
                Download README.md
              </button>
            </div>
          </div>

          {readmeTab === 'rendered' ? (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-5 sm:p-6 max-h-[680px] overflow-y-auto">
              <MarkdownPreviewRenderer markdown={readmeContent} />
            </div>
          ) : (
            <pre className="rounded-2xl border border-white/10 bg-[#08090D] p-5 text-xs font-mono text-neutral-200 overflow-auto max-h-[680px] leading-relaxed whitespace-pre">
              {readmeContent}
            </pre>
          )}
        </section>
      )}

      {/* 1. System & Regional Isolation Architecture Diagram */}
      {show('architecture') && (
        <section className="rounded-3xl border border-white/10 bg-[#111319] p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-sky-400 font-bold">
                01 · System Architecture &amp; Regional Isolation
              </span>
              <h3 className="text-lg font-bold text-white mt-0.5">
                Auto-Redirected /in &amp; /intl Pipelines + AI Failover Router
              </h3>
            </div>
            <span className="text-xs font-mono text-neutral-400">
              Port 3000 · Express + Vite + Firestore + Gemini SDK
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Node A: Regional Edge Router */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-emerald-400">EDGE GEO ROUTER</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-neutral-300">
                  utils/router.ts
                </span>
              </div>
              <p className="text-xs text-neutral-300 leading-relaxed">
                Resolves <code className="text-sky-300">/api/geo/region</code> IP lookup and timezone (<code className="text-sky-300">Asia/Kolkata</code>) on first visit to assign strict regional paths:
              </p>
              <div className="space-y-2 pt-1">
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs">
                  <p className="font-mono font-bold text-emerald-300">/in/* — India Mode</p>
                  <p className="text-neutral-300 mt-1">
                    Currency INR ₹ · Plans ₹49 Day / ₹149 Mo / ₹999 Yr · UPI QR &amp; VPA only · Zero global processor leaks.
                  </p>
                </div>
                <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-3 text-xs">
                  <p className="font-mono font-bold text-sky-300">/intl/* — International Mode</p>
                  <p className="text-neutral-300 mt-1">
                    Currency USD $ · Plans $2 Day / $9 Mo / $20 Yr · PayPal Checkout &amp; links only · Zero local rail leaks.
                  </p>
                </div>
              </div>
            </div>

            {/* Node B: Gemini AI Failover Engine */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-indigo-400">GEMINI FAILOVER PIPELINE</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-neutral-300">
                  server.ts
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <p className="font-mono text-white font-semibold">1. Primary: gemini-4-hydrogen</p>
                  <p className="text-neutral-400 mt-0.5">
                    Structured reasoning, Vision OCR, multi-tool function calling &amp; Google Search grounding.
                  </p>
                </div>
                <div className="text-center font-mono text-[10px] text-amber-400">
                  ↓ Auto-failover on HTTP 429 Quota or 504 Timeout (5m cooldown)
                </div>
                <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3">
                  <p className="font-mono text-indigo-200 font-semibold">2. Fallback: gemini-3.1-flash-lite</p>
                  <p className="text-neutral-300 mt-0.5">
                    Low-latency (<code className="text-indigo-200">ThinkingLevel.MINIMAL</code>) preserves chat, receipts, charts, CSV &amp; PDF exports cleanly.
                  </p>
                </div>
              </div>
            </div>

            {/* Node C: Persistence & Access Control */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-amber-400">CLOUD PERSISTENCE &amp; RBAC</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-neutral-300">
                  firestore.rules
                </span>
              </div>
              <ul className="space-y-2 text-xs text-neutral-300">
                <li className="rounded-lg bg-black/30 border border-white/10 px-3 py-2">
                  <strong className="text-white block">Default-Deny Security Rules</strong>
                  Strict type/field validation, immutable <code className="text-amber-300">createdAt</code>, server timestamps, and owner-scoped isolation.
                </li>
                <li className="rounded-lg bg-black/30 border border-white/10 px-3 py-2">
                  <strong className="text-white block">Real-Time Agentic Sync</strong>
                  Liddy AI threads, Recharts specs, CSV &amp; PDF outputs sync directly to <code className="text-amber-300">chat_sessions</code>.
                </li>
                <li className="rounded-lg bg-black/30 border border-white/10 px-3 py-2">
                  <strong className="text-white block">Gmail OAuth Client Dispatch</strong>
                  Strictly in-memory Bearer token with downloadable <code className="text-amber-300">.eml</code> &amp; Swiss print HTML receipts.
                </li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* 2. Live Typography Specimens */}
      {show('typography') && (
        <section className="rounded-3xl border border-white/10 bg-[#111319] p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-indigo-400 font-bold">
                02 · Typography System
              </span>
              <h3 className="text-lg font-bold text-white mt-0.5">
                Live Font Specimens &amp; Financial Numerals
              </h3>
            </div>
            <span className="text-xs font-mono text-neutral-400">
              Outfit · Plus Jakarta Sans · JetBrains Mono
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
                <span>DISPLAY HEADINGS</span>
                <span>font-display · Outfit</span>
              </div>
              <p className="text-2xl font-extrabold text-white tracking-tight" style={{ fontFamily: "'Outfit', sans-serif" }}>
                Clarity for everyday wealth &amp; cashflow.
              </p>
              <p className="text-xs text-neutral-400">
                Weights 500–800 · Tight tracking (<code className="text-neutral-200">-0.02em</code>) with balanced headlines.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
                <span>UI BODY &amp; LEDGER TEXT</span>
                <span>font-sans · Plus Jakarta Sans</span>
              </div>
              <p className="text-base font-medium text-neutral-100 leading-relaxed" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                Scan paper receipts, track brokerage positions, generate clean Swiss invoices, and analyze multi-line tax statements cleanly.
              </p>
              <p className="text-xs text-neutral-400">
                Weights 400–800 · High x-height legibility on paper &amp; dark slate.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono text-neutral-400">
                <span>QUANT &amp; TABULAR DATA</span>
                <span>font-mono · JetBrains Mono</span>
              </div>
              <p className="text-xl font-bold text-emerald-400 tabular-nums font-mono">
                $148,920.50 · +14.82%
              </p>
              <p className="text-sm font-semibold text-neutral-200 tabular-nums font-mono">
                ₹9,99,450.00 · INV-2026-0412
              </p>
              <p className="text-xs text-neutral-400">
                Always paired with <code className="text-neutral-200">tabular-nums</code> so financial columns never jitter.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
            {SLIDE_FONT_PRESETS.map((preset) => (
              <div
                key={preset.id}
                className="rounded-2xl border border-white/10 bg-black/30 p-4 space-y-1.5"
              >
                <span className="text-[10px] font-mono uppercase text-indigo-300">
                  Deck Font · {preset.id}
                </span>
                <p className="text-xs font-bold text-white">{preset.label}</p>
                <p className="text-sm text-neutral-200 pt-1" style={{ fontFamily: preset.family }}>
                  {preset.sample}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. Design Tokens, Swatches & Motion Showcase */}
      {show('tokens') && (
        <section className="rounded-3xl border border-white/10 bg-[#111319] p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 font-bold">
                03 · Design Tokens &amp; Craft Components
              </span>
              <h3 className="text-lg font-bold text-white mt-0.5">
                Copyable Color Palette, Radii &amp; Yearly Glow Spec
              </h3>
            </div>
            {copiedToken && (
              <span className="text-xs font-mono px-3 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300">
                Copied {copiedToken}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {DESIGN_TOKENS.map((tok) => (
              <button
                key={tok.cssVar}
                type="button"
                onClick={() => handleCopyToken(tok.hex)}
                className="text-left rounded-2xl border border-white/10 bg-white/[0.03] hover:border-white/25 p-3.5 flex items-center gap-3.5 transition-colors cursor-pointer group"
              >
                <div
                  className="w-12 h-12 rounded-xl border border-white/15 shrink-0 flex items-center justify-center font-mono text-[10px] font-bold"
                  style={{
                    backgroundColor: tok.hex,
                    color: tok.darkText ? '#111114' : '#FFFFFF',
                  }}
                >
                  {tok.hex}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-white truncate">{tok.name}</p>
                    <span className="text-[10px] font-mono text-neutral-400 group-hover:text-indigo-300">
                      Copy
                    </span>
                  </div>
                  <p className="text-[11px] font-mono text-indigo-300 truncate">{tok.cssVar}</p>
                  <p className="text-[11px] text-neutral-400 truncate mt-0.5">{tok.usage}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Interactive Gemini Yearly 4-Edge Glow Bar & Glass Card Specimens */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-2">
            <div className="gemini-yearly-card">
              <div className="rounded-[1.15rem] bg-[#101218] p-5 h-full flex flex-col justify-between gap-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-md bg-white/10 text-white font-bold">
                    .gemini-yearly-card
                  </span>
                  <span className="text-xs font-mono text-sky-300">conic-gradient · 5.5s linear</span>
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">
                    4-Side Rotating Gemini Glow Frame
                  </h4>
                  <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                    Used exclusively on the Pro Yearly subscription tier (<code className="text-neutral-200">#4285F4 → #9B72CB → #D96570 → #34A853</code>), automatically respecting <code className="text-neutral-200">prefers-reduced-motion</code> and workspace accessibility toggles.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/35 p-5 space-y-3">
              <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 font-bold">
                Swiss Radius &amp; Shadow Architecture
              </span>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl border border-white/15 bg-white/[0.04] p-3">
                  <div className="w-8 h-8 rounded-lg border border-sky-400/50 bg-sky-500/15 mx-auto mb-2" />
                  <p className="text-[11px] font-mono text-white font-bold">rounded-xl</p>
                  <p className="text-[10px] text-neutral-400">12px · Controls</p>
                </div>
                <div className="rounded-2xl border border-white/15 bg-white/[0.04] p-3">
                  <div className="w-8 h-8 rounded-2xl border border-indigo-400/50 bg-indigo-500/15 mx-auto mb-2" />
                  <p className="text-[11px] font-mono text-white font-bold">rounded-2xl</p>
                  <p className="text-[10px] text-neutral-400">16px · Cards</p>
                </div>
                <div className="rounded-3xl border border-white/15 bg-white/[0.04] p-3">
                  <div className="w-8 h-8 rounded-3xl border border-emerald-400/50 bg-emerald-500/15 mx-auto mb-2" />
                  <p className="text-[11px] font-mono text-white font-bold">rounded-[32px]</p>
                  <p className="text-[10px] text-neutral-400">32px · Shells</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 4. Brand Identity, Photography & Asset Gallery */}
      {show('gallery') && (
        <section className="rounded-3xl border border-white/10 bg-[#111319] p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400 font-bold">
                04 · Brand Identity &amp; Media Gallery
              </span>
              <h3 className="text-lg font-bold text-white mt-0.5">
                Vector Logo Specimens &amp; Bundled Application Photography
              </h3>
            </div>
            <button
              type="button"
              onClick={downloadBrandLogoSvg}
              className="px-3.5 py-1.5 rounded-xl bg-white text-neutral-900 hover:bg-neutral-200 text-xs font-bold transition-colors cursor-pointer"
            >
              Download Logo (.SVG)
            </button>
          </div>

          {/* Logo Scale Showcase */}
          <div className="rounded-2xl border border-white/10 bg-black/30 p-5 flex flex-wrap items-center justify-between gap-6">
            <div className="flex flex-wrap items-center gap-8">
              <div className="space-y-2">
                <span className="text-[10px] font-mono text-neutral-400 block">SM (32px)</span>
                <Logo size="sm" showText={false} />
              </div>
              <div className="space-y-2">
                <span className="text-[10px] font-mono text-neutral-400 block">MD (40px)</span>
                <Logo size="md" showText={true} />
              </div>
              <div className="space-y-2">
                <span className="text-[10px] font-mono text-neutral-400 block">LG (56px)</span>
                <Logo size="lg" showText={true} showSubtitle={true} />
              </div>
            </div>
            <div className="text-xs text-neutral-400 max-w-sm">
              Geometric L-monogram with indigo accent fold and cyan clarity node. Built as inline vector SVG in <code className="text-neutral-200">components/Logo.tsx</code> for zero network latency.
            </div>
          </div>

          {/* Media Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {GALLERY_ASSETS.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden flex flex-col"
              >
                <div className="aspect-video bg-black/50 overflow-hidden border-b border-white/10">
                  <img
                    src={item.src}
                    alt={item.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="p-3.5 flex-1 flex flex-col justify-between gap-2">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-white truncate">{item.title}</p>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-neutral-300 shrink-0">
                        {item.ratio}
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-400 mt-0.5 truncate">{item.subtitle}</p>
                  </div>
                  <a
                    href={item.src}
                    download
                    className="text-[11px] font-mono font-semibold text-sky-400 hover:text-sky-300 transition-colors"
                  >
                    Open / Download Asset →
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. Creative Studios, Agentic Skills & Firestore Reference */}
      {show('studio') && (
        <section className="rounded-3xl border border-white/10 bg-[#111319] p-6 space-y-7">
          <div className="border-b border-white/10 pb-4">
            <span className="text-[10px] font-mono uppercase tracking-widest text-fuchsia-400 font-bold">
              05 · Creative Engines &amp; Engineering Reference
            </span>
            <h3 className="text-lg font-bold text-white mt-0.5">
              8 Presentation Themes, 5 Swiss Invoice Formats, Agentic Skills &amp; Firestore Collections
            </h3>
          </div>

          {/* 8 Presentation Themes */}
          <div className="space-y-3">
            <h4 className="text-xs font-mono uppercase tracking-wider text-neutral-300 font-bold">
              Vision Studio · 8 Financial Presentation Themes
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {SLIDE_THEMES_DOC.map((t) => (
                <div
                  key={t.id}
                  className="rounded-2xl p-3.5 border transition-transform hover:-translate-y-0.5"
                  style={{
                    backgroundColor: t.bg,
                    borderColor: t.border,
                    color: t.text,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold truncate">{t.name}</span>
                    <span
                      className="w-3.5 h-3.5 rounded-full border shrink-0"
                      style={{ backgroundColor: t.accent, borderColor: t.border }}
                    />
                  </div>
                  <div
                    className="mt-2.5 rounded-lg p-2 text-[10px] font-mono border"
                    style={{ backgroundColor: t.card, borderColor: t.border }}
                  >
                    Q4 Margin · <strong style={{ color: t.accent }}>24.8%</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 5 Invoice Templates & 3 Paper Formats */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="space-y-3">
              <h4 className="text-xs font-mono uppercase tracking-wider text-neutral-300 font-bold">
                Swiss Paper Invoice Templates (5 Presets)
              </h4>
              <div className="space-y-2">
                {Object.entries(TEMPLATE_LABELS).map(([key, spec]) => (
                  <div
                    key={key}
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-7 h-7 rounded-lg border border-white/20 shrink-0"
                        style={{
                          background: `linear-gradient(135deg, ${spec.swatchBg} 55%, ${spec.swatchAccent} 55%)`,
                        }}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white">{spec.label}</p>
                        <p className="text-[11px] text-neutral-400 truncate">{spec.desc}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-neutral-400 shrink-0">{key}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2.5">
                <h4 className="text-xs font-mono uppercase tracking-wider text-neutral-300 font-bold">
                  Paper Geometry &amp; Export Formats
                </h4>
                <div className="grid grid-cols-3 gap-2.5">
                  {Object.entries(PAPER_FORMAT_SPECS).map(([key, fmt]) => (
                    <div
                      key={key}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs"
                    >
                      <span className="text-[10px] font-mono font-bold text-sky-400">
                        {fmt.badge}
                      </span>
                      <p className="font-bold text-white mt-1">{fmt.widthPx}px</p>
                      <p className="text-[10px] text-neutral-400 mt-0.5 truncate">{fmt.sizeCss}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5">
                <h4 className="text-xs font-mono uppercase tracking-wider text-neutral-300 font-bold">
                  Liddy AI Agentic CFO Toolset
                </h4>
                <div className="space-y-1.5">
                  {AGENT_SKILLS_DOC.map((skill) => (
                    <div
                      key={skill.tool}
                      className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs"
                    >
                      <p className="font-mono font-bold text-indigo-300">{skill.tool}</p>
                      <p className="text-[11px] text-neutral-400 mt-0.5">{skill.output}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Firestore Collections Reference Table */}
          <div className="space-y-3">
            <h4 className="text-xs font-mono uppercase tracking-wider text-neutral-300 font-bold">
              Firestore Data Architecture &amp; Security Scopes
            </h4>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.04] text-[10px] font-mono uppercase text-neutral-400">
                    <th className="px-4 py-2.5">Collection Path</th>
                    <th className="px-4 py-2.5">Rule Scope</th>
                    <th className="px-4 py-2.5">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {FIRESTORE_COLLECTIONS_DOC.map((col) => (
                    <tr key={col.path} className="border-b last:border-b-0 border-white/[0.06]">
                      <td className="px-4 py-2 font-mono text-sky-300 whitespace-nowrap">
                        {col.path}
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-emerald-300 whitespace-nowrap">
                        {col.scope}
                      </td>
                      <td className="px-4 py-2 text-neutral-300">{col.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};

export default AdminAssetsShowcase;
