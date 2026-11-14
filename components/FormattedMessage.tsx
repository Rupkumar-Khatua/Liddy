import React from 'react';

interface FormattedMessageProps {
  text: string;
  className?: string;
}

// Parses inline bold, italic, inline code, and clean text
const renderInlineContent = (content: string): React.ReactNode[] => {
  // Regex to split on bold (**text**), inline code (`code`), or italic (*text*)
  const tokens = content.split(/(\*\*[^*]+?\*\*|`[^`]+?`|\*[^*]+?\*)/g);

  return tokens.map((token, idx) => {
    if (!token) return null;

    // Bold: **text**
    if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
      const boldText = token.slice(2, -2);
      return (
        <strong key={idx} className="font-bold text-neutral-900 dark:text-white">
          {boldText}
        </strong>
      );
    }

    // Inline code / metric: `code`
    if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      const codeText = token.slice(1, -1);
      return (
        <code 
          key={idx} 
          className="font-mono text-xs px-1.5 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-indigo-600 dark:text-indigo-400 font-semibold"
        >
          {codeText}
        </code>
      );
    }

    // Italic: *text*
    if (token.startsWith('*') && token.endsWith('*') && token.length >= 2) {
      const italicText = token.slice(1, -1);
      return (
        <em key={idx} className="italic text-neutral-700 dark:text-neutral-300">
          {italicText}
        </em>
      );
    }

    // Clean any stray asterisks or hashes
    const cleaned = token.replace(/^\*+\s*/, '').replace(/\*+$/, '');
    return <span key={idx}>{cleaned}</span>;
  });
};

export const FormattedMessage: React.FC<FormattedMessageProps> = ({ text, className = '' }) => {
  if (!text) return null;

  // Split into lines to parse markdown blocks
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let tableRows: string[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let currentListItems: React.ReactNode[] = [];
  let currentListType: 'ul' | 'ol' | null = null;

  const flushList = () => {
    if (currentListItems.length > 0 && currentListType) {
      if (currentListType === 'ul') {
        elements.push(
          <ul key={`ul-${elements.length}`} className="my-2.5 space-y-1 pl-4 list-disc marker:text-indigo-500 text-sm">
            {currentListItems}
          </ul>
        );
      } else {
        elements.push(
          <ol key={`ol-${elements.length}`} className="my-2.5 space-y-1 pl-4 list-decimal marker:text-indigo-500 font-mono text-sm">
            {currentListItems}
          </ol>
        );
      }
      currentListItems = [];
      currentListType = null;
    }
  };

  const flushTable = () => {
    if (tableRows.length >= 2) {
      // Parse markdown table
      const headerLine = tableRows[0];
      const dataLines = tableRows.slice(1).filter(r => !/^[|\s-:]+$/.test(r.trim()));

      const parseRow = (rowStr: string) =>
        rowStr
          .split('|')
          .map(c => c.trim())
          .filter((_, i, arr) => i > 0 && i < arr.length - 1);

      const headers = parseRow(headerLine);
      const rows = dataLines.map(parseRow);

      elements.push(
        <div key={`table-${elements.length}`} className="my-3.5 overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-700/80 shadow-xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-100/80 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 font-semibold border-b border-neutral-200 dark:border-neutral-700">
              <tr>
                {headers.map((h, hi) => (
                  <th key={hi} className="px-3.5 py-2 whitespace-nowrap font-mono uppercase text-[11px] tracking-wider">
                    {renderInlineContent(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80 bg-white/50 dark:bg-neutral-900/50">
              {rows.map((row, ri) => (
                <tr key={ri} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/40 transition-colors">
                  {row.map((cell, ci) => {
                    const isNumeric = /^[$€₹£]?\s*[-+]?[0-9,.]+%?$/.test(cell.trim());
                    return (
                      <td 
                        key={ci} 
                        className={`px-3.5 py-2 text-neutral-800 dark:text-neutral-200 ${
                          isNumeric ? 'font-mono tabular-nums text-right font-medium' : ''
                        }`}
                      >
                        {renderInlineContent(cell)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    // 1. Triple backtick code block boundary
    if (line.startsWith('```')) {
      flushList();
      flushTable();
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${elements.length}`} className="my-3 p-3.5 rounded-xl bg-neutral-900 text-neutral-100 font-mono text-xs overflow-x-auto border border-neutral-800">
            <code>{codeBlockLines.join('\n')}</code>
          </pre>
        );
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(rawLine);
      continue;
    }

    // 2. Table row detection
    if (line.startsWith('|') && line.endsWith('|')) {
      flushList();
      tableRows.push(line);
      continue;
    } else if (tableRows.length > 0) {
      flushTable();
    }

    // 3. Headers (# H1, ## H2, ### H3, #### H4)
    if (line.startsWith('#')) {
      flushList();
      const level = line.match(/^#+/)?.[0].length || 1;
      const titleText = line.replace(/^#+\s*/, '').trim();

      if (level === 1) {
        elements.push(
          <h2 key={`h-${i}`} className="text-base sm:text-lg font-extrabold text-neutral-900 dark:text-white mt-4 mb-2 tracking-tight flex items-center gap-2">
            <span className="w-1.5 h-4 rounded-full bg-indigo-500 inline-block"></span>
            <span>{renderInlineContent(titleText)}</span>
          </h2>
        );
      } else if (level === 2) {
        elements.push(
          <h3 key={`h-${i}`} className="text-sm sm:text-base font-bold text-neutral-900 dark:text-white mt-3.5 mb-1.5 tracking-tight">
            {renderInlineContent(titleText)}
          </h3>
        );
      } else {
        elements.push(
          <h4 key={`h-${i}`} className="text-xs sm:text-sm font-bold text-neutral-800 dark:text-neutral-200 mt-2.5 mb-1 uppercase tracking-wider font-mono">
            {renderInlineContent(titleText)}
          </h4>
        );
      }
      continue;
    }

    // 4. Bullet list items (* item or - item)
    if (/^[-*]\s+/.test(line)) {
      if (currentListType !== 'ul') {
        flushList();
        currentListType = 'ul';
      }
      const itemText = line.replace(/^[-*]\s+/, '').trim();
      currentListItems.push(
        <li key={`li-${i}`} className="text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
          {renderInlineContent(itemText)}
        </li>
      );
      continue;
    }

    // 5. Numbered list items (1. item)
    if (/^\d+\.\s+/.test(line)) {
      if (currentListType !== 'ol') {
        flushList();
        currentListType = 'ol';
      }
      const itemText = line.replace(/^\d+\.\s+/, '').trim();
      currentListItems.push(
        <li key={`li-${i}`} className="text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
          {renderInlineContent(itemText)}
        </li>
      );
      continue;
    }

    // Not a list line -> flush any open list
    flushList();

    // 6. Blockquote or Callout (> text)
    if (line.startsWith('>')) {
      const quoteText = line.replace(/^>\s*/, '').trim();
      elements.push(
        <div 
          key={`quote-${i}`} 
          className="my-2.5 p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border-l-2 border-indigo-500 text-xs sm:text-sm text-indigo-950 dark:text-indigo-200 font-medium"
        >
          {renderInlineContent(quoteText)}
        </div>
      );
      continue;
    }

    // 7. Divider line (--- or ***)
    if (/^[-*_]{3,}$/.test(line)) {
      elements.push(
        <hr key={`hr-${i}`} className="my-3 border-neutral-200 dark:border-neutral-800" />
      );
      continue;
    }

    // 8. Empty lines
    if (!line) {
      elements.push(<div key={`sp-${i}`} className="h-1.5" />);
      continue;
    }

    // 9. Standard paragraph
    elements.push(
      <p key={`p-${i}`} className="text-sm leading-relaxed text-neutral-800 dark:text-neutral-200 font-normal">
        {renderInlineContent(line)}
      </p>
    );
  }

  flushList();
  flushTable();

  return <div className={`formatted-message space-y-1.5 ${className}`}>{elements}</div>;
};

export default FormattedMessage;
