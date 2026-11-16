import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage } from '../types';
import { 
  queryFinanceAgent, 
  AgentMode, 
  AgentAttachment 
} from '../services/geminiService';
import LiveAdvisor from './LiveAdvisor';
import { Logo } from './Logo';
import { useFinMind } from '../context/FinMindContext';
import { FormattedMessage } from './FormattedMessage';

const QUICK_AUTOMATIONS = [
  { id: 'cleanse_ledger', label: 'Cleanse Ledger', prompt: 'Cleanse my ledger automatically: remove duplicates, normalize merchant names, standardize generic categories and report what changed.' },
  { id: 'balance_sheet', label: 'Balance Sheet', prompt: 'Compile a balance sheet for my current asset portfolio and liabilities with equity commentary.' },
  { id: 'cash_flow_audit', label: 'Cash Flow Audit', prompt: 'Run a thorough cash flow analysis identifying burn rate, runway and liquidity optimization.' },
  { id: 'tax_optimization', label: 'Tax Strategy', prompt: 'Review potential tax-loss harvesting, deduction opportunities and shelter strategies.' },
  { id: 'ratios_analysis', label: 'Financial Ratios', prompt: 'Compute debt-to-equity, current ratio, operating margin and overall financial health score.' },
];

const MODES: Array<{
  id: AgentMode;
  label: string;
  badge: string;
  description: string;
  icon: string;
}> = [
  {
    id: 'chat',
    label: 'Chat Mode',
    badge: 'Fast Advisory',
    description: 'Instant conversational financial guidance and portfolio coaching.',
    icon: '💬',
  },
  {
    id: 'web',
    label: 'Web Search',
    badge: 'Live Grounding',
    description: 'Real-time quotes, central bank updates and verified market news.',
    icon: '🌐',
  },
  {
    id: 'agent',
    label: 'Agent Mode',
    badge: 'CFO Copilot',
    description: 'Multi-step cashflow auditing, tax prep checks and runway math.',
    icon: '⚡',
  },
  {
    id: 'ocr',
    label: 'Receipt Reader',
    badge: 'Doc Vision',
    description: 'Clear visual reading of receipts, invoices and bank statements.',
    icon: '🔍',
  },
];

interface ChatMessageExtended extends ChatMessage {
  attachmentName?: string;
  attachmentType?: string;
  attachmentData?: string;
}

interface ChatAssistantProps {
  initialVoiceMode?: boolean;
}

const ChatAssistant: React.FC<ChatAssistantProps> = ({ initialVoiceMode = false }) => {
  const {
    trackEngagement,
    transactions,
    invoices,
    watchlist,
    stockPortfolio,
    goals,
    currencySymbol,
    applyAgentLedgerOperations,
  } = useFinMind();
  const [messages, setMessages] = useState<ChatMessageExtended[]>([
    {
      id: '1',
      role: 'model',
      text: "Hello, I am Liddy — your autonomous personal finance advisor. Ask me to review spending, cleanse duplicate or messy ledger entries, audit invoices, analyze your portfolio or answer live market questions.",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(initialVoiceMode);
  const [activeMode, setActiveMode] = useState<AgentMode>('agent');
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const [attachment, setAttachment] = useState<AgentAttachment | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);

  // Close mode dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (modeDropdownRef.current && !modeDropdownRef.current.contains(e.target as Node)) {
        setIsModeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  };

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    scrollToBottom();
  }, [messages, isLoading]);

  // Handle file attachment selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Extract pure base64 without data URL scheme prefix
      const base64Data = result.includes(',') ? result.split(',')[1] : result;
      setAttachment({
        name: file.name,
        mimeType: file.type || 'image/jpeg',
        data: base64Data,
        size: file.size,
      });

      // If an image or PDF document is selected, auto-switch to OCR Analyzer mode for best precision
      if (file.type.startsWith('image/') || file.type.includes('pdf')) {
        setActiveMode('ocr');
      }
    };

    reader.readAsDataURL(file);
    // Reset file input so re-selecting same file triggers onChange
    e.target.value = '';
  };

  const handleSendText = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed && !attachment) return;
    if (!trackEngagement('AI Assistant')) return;

    const currentAttachment = attachment;
    const userMsg: ChatMessageExtended = { 
      id: Date.now().toString(), 
      role: 'user', 
      text: trimmed || (currentAttachment ? `[Uploaded Document: ${currentAttachment.name}]` : ''), 
      timestamp: new Date(),
      attachmentName: currentAttachment?.name,
      attachmentType: currentAttachment?.mimeType,
      attachmentData: currentAttachment?.mimeType.startsWith('image/') ? currentAttachment.data : undefined,
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setAttachment(null);
    setIsLoading(true);

    try {
      const history = messages.slice(-6).map(m => ({
        role: m.role,
        text: m.text,
      }));

      const result = await queryFinanceAgent(
        trimmed,
        activeMode,
        currentAttachment,
        history,
        {
          currencySymbol,
          transactions: transactions.slice(0, 180),
          invoices: invoices.slice(0, 60),
          watchlist: watchlist.slice(0, 30),
          stockPortfolio,
          goalsCount: goals.length,
        }
      );

      let appliedSummary: string | undefined;
      if (result.ledgerOperations) {
        const stats = applyAgentLedgerOperations(result.ledgerOperations);
        const parts: string[] = [];
        if (stats.added > 0) parts.push(`${stats.added} added`);
        if (stats.updated > 0) parts.push(`${stats.updated} updated`);
        if (stats.deleted > 0) parts.push(`${stats.deleted} removed`);
        if (stats.settledInvoices > 0) parts.push(`${stats.settledInvoices} invoice settled`);
        if (parts.length > 0) {
          appliedSummary = `Applied to workspace ledger: ${parts.join(' · ')}`;
        }
      }

      const modelMsg: ChatMessageExtended = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: result.text,
        timestamp: new Date(),
        groundingUrls: result.groundingUrls,
        activatedTools: result.activatedTools,
        appliedSummary,
      };

      setMessages(prev => [...prev, modelMsg]);
    } catch (error: any) {
      console.warn("Finance agent communication notice:", error?.message || error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        text: "Sorry, I wasn't able to proceed with that request right now. Please try again in a moment.",
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAction = async (action: typeof QUICK_AUTOMATIONS[0]) => {
    handleSendText(action.prompt);
  };

  const activeModeObj = MODES.find(m => m.id === activeMode) || MODES[0];

  return (
    <div className="flex flex-col h-full bg-white dark:bg-neutral-900 rounded-[32px] shadow-soft overflow-hidden border border-white/60 dark:border-neutral-800">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-neutral-100 dark:border-neutral-800 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-md flex justify-between items-center z-10 sticky top-0">
        <div className="flex items-center gap-3">
          <Logo size="sm" showText={false} />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-neutral-900 dark:text-white text-base">Liddy AI CFO</h2>
              <span className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200/50 dark:border-indigo-800/50 px-2 py-0.5 rounded-md font-semibold">
                {activeModeObj.badge}
              </span>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 hidden sm:block">
              Personal Cashflow, Receipt Reading &amp; Daily Financial Advisor
            </p>
          </div>
        </div>

        {/* Integrated Voice Mode Trigger */}
        <button
          type="button"
          onClick={() => setIsVoiceMode(true)}
          className="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700"
        >
          <span className="flex items-center gap-0.5 h-3.5">
            <span className="w-0.5 h-2 rounded-full bg-cyan-400"></span>
            <span className="w-0.5 h-3.5 rounded-full bg-indigo-400"></span>
            <span className="w-0.5 h-2.5 rounded-full bg-fuchsia-400"></span>
          </span>
          <span>Voice Mode</span>
        </button>
      </div>

      {isVoiceMode && (
        <LiveAdvisor autoConnect={true} onClose={() => setIsVoiceMode(false)} />
      )}

      <>
          {/* Quick GenAI Automation Chips Bar */}
          <div className="px-4 sm:px-6 py-2.5 bg-neutral-50/70 dark:bg-neutral-900 border-b border-neutral-100 dark:border-neutral-800 flex items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="text-[10px] uppercase font-bold tracking-wider text-neutral-400 font-mono shrink-0">Automations:</span>
            {QUICK_AUTOMATIONS.map((qa) => (
              <button
                key={qa.id}
                onClick={() => handleQuickAction(qa)}
                disabled={isLoading}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:border-sky-400 dark:hover:border-sky-400 text-neutral-700 dark:text-neutral-200 hover:text-neutral-900 dark:hover:text-white transition-all shrink-0 whitespace-nowrap shadow-xs disabled:opacity-50 cursor-pointer"
              >
                + {qa.label}
              </button>
            ))}
          </div>

          {/* Messages Feed */}
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-[#FAF9F6]/40 dark:bg-neutral-950/40">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[92%] sm:max-w-[85%] rounded-[24px] px-5 sm:px-6 py-4 shadow-xs relative ${
                  msg.role === 'user' 
                    ? 'bg-neutral-900 dark:bg-indigo-600 text-white rounded-br-none' 
                    : 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 border border-neutral-200/80 dark:border-neutral-800 rounded-bl-none'
                }`}>
                  {/* User Attachment Display */}
                  {msg.attachmentName && (
                    <div className="mb-2.5 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-xs">
                      {msg.attachmentData ? (
                        <img 
                          src={`data:${msg.attachmentType || 'image/jpeg'};base64,${msg.attachmentData}`} 
                          alt={msg.attachmentName} 
                          className="w-8 h-8 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="text-base">📄</span>
                      )}
                      <span className="truncate max-w-[200px] font-mono text-[11px]">{msg.attachmentName}</span>
                    </div>
                  )}

                  {/* Render Formatted Financial Markdown or Plain User Text */}
                  {msg.role === 'model' ? (
                    <FormattedMessage text={msg.text} />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed font-normal">{msg.text}</p>
                  )}

                  {(msg.appliedSummary || (msg.activatedTools && msg.activatedTools.length > 0)) && (
                    <div className="mt-3 pt-2.5 border-t border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center gap-2 text-[11px]">
                      {msg.appliedSummary && (
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300 font-semibold">
                          {msg.appliedSummary}
                        </span>
                      )}
                      {msg.activatedTools && msg.activatedTools.length > 0 && (
                        <span className="px-2.5 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 font-mono">
                          Skills: {msg.activatedTools.map((t) => t.replace(/_/g, ' ')).join(' · ')}
                        </span>
                      )}
                    </div>
                  )}
                  
                  {msg.groundingUrls && msg.groundingUrls.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800 text-xs text-neutral-500 dark:text-neutral-400">
                      <p className="font-semibold text-neutral-700 dark:text-neutral-300 mb-1 flex items-center gap-1.5">
                        <span>🌐</span>
                        <span>Verified Live Market Grounding:</span>
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {msg.groundingUrls.map((url, i) => (
                          <a 
                            key={i} 
                            href={url.uri} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 font-mono text-[11px] bg-neutral-100 dark:bg-neutral-800/80 px-2 py-1 rounded-md"
                          >
                            <span>{url.title}</span>
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  <span className={`text-[10px] block mt-2 ${msg.role === 'user' ? 'text-neutral-300' : 'text-neutral-400'}`}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white dark:bg-neutral-900 rounded-[24px] rounded-bl-none px-6 py-4 border border-neutral-200/80 dark:border-neutral-800 shadow-xs flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce"></span>
                  <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.2s]"></span>
                  <span className="w-2 h-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.4s]"></span>
                  <span className="text-xs text-neutral-600 dark:text-neutral-300 font-medium ml-2">
                    Liddy is executing {activeModeObj.label}...
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area with Attachment (+) and Mode Dropdown */}
          <div className="p-3 sm:p-4 bg-white dark:bg-neutral-900 border-t border-neutral-100 dark:border-neutral-800 space-y-2">
            
            {/* Active Attachment Preview Chip */}
            {attachment && (
              <div className="flex items-center justify-between p-2.5 px-3 bg-neutral-100 dark:bg-neutral-800/90 rounded-2xl border border-neutral-200 dark:border-neutral-700 animate-enter max-w-md">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-sm shrink-0">
                    {attachment.mimeType.startsWith('image/') ? '🖼️' : '📄'}
                  </div>
                  <div className="truncate">
                    <p className="text-xs font-semibold text-neutral-900 dark:text-white truncate">
                      {attachment.name}
                    </p>
                    <p className="text-[10px] text-neutral-400 font-mono">
                      {attachment.size ? `${(attachment.size / 1024).toFixed(1)} KB` : 'Ready to analyze'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setAttachment(null)}
                  className="w-6 h-6 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 hover:text-neutral-900 dark:hover:text-white flex items-center justify-center text-xs font-bold transition-colors cursor-pointer shrink-0 ml-2"
                  title="Remove attachment"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Hidden Native File Input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.csv,.txt,.json,.docx"
              onChange={handleFileChange}
              className="hidden"
            />

            <form 
              onSubmit={(e) => {
                e.preventDefault();
                handleSendText(input);
              }}
              className="flex items-center gap-1.5 sm:gap-2.5 bg-neutral-50 dark:bg-neutral-800/80 border border-neutral-200/80 dark:border-neutral-700/80 rounded-2xl p-1.5 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:bg-white dark:focus-within:bg-neutral-800 transition-all relative"
            >
              {/* + Icon for Uploading Files, Photos, Docs */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach photo, invoice, receipt or financial doc"
                aria-label="Upload document or photo"
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-neutral-200/70 hover:bg-neutral-300 dark:bg-neutral-700/70 dark:hover:bg-neutral-600 text-neutral-700 dark:text-neutral-200 flex items-center justify-center transition-all shrink-0 cursor-pointer active:scale-95 group"
              >
                <svg className="w-5 h-5 text-neutral-600 dark:text-neutral-300 group-hover:text-indigo-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 4v16m8-8H4" />
                </svg>
              </button>

              {/* Mode Selector Dropdown Button (Beside + Button) */}
              <div className="relative shrink-0" ref={modeDropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsModeDropdownOpen(!isModeDropdownOpen)}
                  title="Change AI Agent Mode"
                  className="h-9 sm:h-10 px-2 sm:px-3 rounded-xl bg-neutral-200/70 hover:bg-neutral-300 dark:bg-neutral-700/70 dark:hover:bg-neutral-600 text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5 transition-all text-xs font-semibold cursor-pointer active:scale-95 border border-transparent hover:border-neutral-300 dark:hover:border-neutral-600"
                >
                  <span className="text-sm">{activeModeObj.icon}</span>
                  <span className="hidden md:inline whitespace-nowrap">{activeModeObj.label}</span>
                  <svg className={`w-3 h-3 text-neutral-400 transition-transform ${isModeDropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </button>

                {/* Dropdown Menu Modal */}
                {isModeDropdownOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-72 sm:w-80 rounded-2xl bg-white dark:bg-[#141418] border border-neutral-200 dark:border-neutral-700 shadow-2xl p-2 z-50 animate-enter space-y-1">
                    <div className="px-2.5 py-1.5 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase font-bold tracking-wider text-neutral-400 dark:text-neutral-500">
                        Intelligence Mode
                      </span>
                    </div>

                    {MODES.map((mode) => {
                      const isSelected = activeMode === mode.id;
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => {
                            setActiveMode(mode.id);
                            setIsModeDropdownOpen(false);
                          }}
                          className={`w-full flex items-start gap-3 p-2.5 rounded-xl text-left transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/80 text-indigo-950 dark:text-white'
                              : 'hover:bg-neutral-100 dark:hover:bg-neutral-800/70 text-neutral-700 dark:text-neutral-300'
                          }`}
                        >
                          <span className="text-lg shrink-0 mt-0.5">{mode.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold leading-tight">{mode.label}</span>
                              <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
                                {mode.badge}
                              </span>
                            </div>
                            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-2">
                              {mode.description}
                            </p>
                          </div>
                          {isSelected && (
                            <span className="text-indigo-600 dark:text-indigo-400 text-xs font-bold shrink-0">✓</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Chat Input Field */}
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  activeMode === 'web' 
                    ? "Search live market figures, economic news or stock symbols..." 
                    : activeMode === 'ocr' 
                    ? "Attach document or ask to parse financial statements..." 
                    : activeMode === 'agent' 
                    ? "Command autonomous ratio analysis, DCF valuation or balance sheet..." 
                    : "Ask Liddy to audit transactions, run ratio analysis or compute burn rate..."
                }
                className="flex-1 bg-transparent px-2 sm:px-3 py-2 text-xs sm:text-sm text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-500 focus:outline-none min-w-0"
              />

              {/* Enter / Send Arrow Button */}
              <button
                type="submit"
                disabled={isLoading || (!input.trim() && !attachment)}
                title="Send instruction (Enter)"
                aria-label="Send message"
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 flex items-center justify-center hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors disabled:opacity-30 shadow-xs shrink-0 cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>

              {/* Integrated Voice Mode Trigger */}
              <button
                type="button"
                onClick={() => setIsVoiceMode(true)}
                title="Switch to Voice Mode"
                aria-label="Switch to Voice Mode"
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-cyan-400 via-indigo-500 to-fuchsia-500 p-[1.5px] hover:scale-105 active:scale-95 transition-all shadow-md shrink-0 cursor-pointer group"
              >
                <div className="w-full h-full bg-neutral-900 dark:bg-neutral-950 rounded-[10px] flex items-center justify-center group-hover:bg-opacity-80 transition-all">
                  <div className="flex items-center gap-0.5 h-4.5">
                    <span className="w-0.5 h-2 rounded-full bg-cyan-400"></span>
                    <span className="w-0.5 h-3.5 rounded-full bg-indigo-400"></span>
                    <span className="w-0.5 h-4.5 rounded-full bg-fuchsia-400"></span>
                    <span className="w-0.5 h-3 rounded-full bg-pink-400"></span>
                    <span className="w-0.5 h-1.5 rounded-full bg-cyan-300"></span>
                  </div>
                </div>
              </button>
            </form>
          </div>
        </>
    </div>
  );
};

export default ChatAssistant;