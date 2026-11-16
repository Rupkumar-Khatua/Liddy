import React, { useEffect, useState, useMemo, useRef } from 'react';
import {
  getInstantMarketBaseline,
  fetchMarketSnapshot,
  fetchLiveMarketNews,
  searchFinancialNews,
  searchCompanyTicker,
} from '../services/geminiService';
import { MarketData, ListedCompany, MarketNewsItem } from '../types';
import { useFinMind } from '../context/FinMindContext';
import { ICONS } from '../constants';
import { CompanyLogo } from './CompanyLogos';
import { CompanyDetailModal } from './CompanyDetailModal';
import { NewsDetailModal } from './NewsDetailModal';

type ExchangeFilter = 'ALL' | 'US' | 'INDIA' | 'EUROPE' | 'ASIA';

const Markets: React.FC = () => {
  const { watchlist, addToWatchlist, removeFromWatchlist, trackEngagement } = useFinMind();
  const [data, setData] = useState<MarketData>(getInstantMarketBaseline);
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState<string>('Syncing...');
  const [changedTickers, setChangedTickers] = useState<Record<string, 'up' | 'down'>>({});
  const [changedIndices, setChangedIndices] = useState<Record<string, 'up' | 'down'>>({});

  const [isSearchingNews, setIsSearchingNews] = useState(false);
  const [newTicker, setNewTicker] = useState('');

  // Reactive selected company so modal reflects live ticks
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [fallbackCompany, setFallbackCompany] = useState<ListedCompany | null>(null);
  const [selectedNews, setSelectedNews] = useState<MarketNewsItem | null>(null);

  // Listed Companies Filtering & On-Demand Lookup
  const [exchangeFilter, setExchangeFilter] = useState<ExchangeFilter>('ALL');
  const [companySearch, setCompanySearch] = useState('');
  const [isLookingUpTicker, setIsLookingUpTicker] = useState(false);
  const [lookupFeedback, setLookupFeedback] = useState<string | null>(null);

  // News Search
  const [newsSearchQuery, setNewsSearchQuery] = useState('');
  const [customNewsResults, setCustomNewsResults] = useState<MarketNewsItem[] | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const watchlistRef = useRef<string[]>(watchlist);
  watchlistRef.current = watchlist;

  const applyIncomingMarketData = (incoming: Partial<MarketData>) => {
    setData((prev) => {
      // Detect price changes for visual tick feedback
      const idxChanges: Record<string, 'up' | 'down'> = {};
      if (Array.isArray(incoming.indices)) {
        incoming.indices.forEach((nextIdx) => {
          const oldIdx = prev.indices.find((i) => i.name === nextIdx.name);
          if (oldIdx && oldIdx.value !== nextIdx.value && nextIdx.rawPrice && oldIdx.rawPrice) {
            idxChanges[nextIdx.name] = nextIdx.rawPrice >= oldIdx.rawPrice ? 'up' : 'down';
          }
        });
      }

      const compChanges: Record<string, 'up' | 'down'> = {};
      let mergedCompanies = prev.listedCompanies || [];
      if (Array.isArray(incoming.listedCompanies) && incoming.listedCompanies.length > 0) {
        const incomingMap = new Map(incoming.listedCompanies.map((c) => [c.ticker, c]));
        // Preserve any extra user-looked-up companies not in payload
        const extraExisting = mergedCompanies.filter((c) => !incomingMap.has(c.ticker));
        mergedCompanies = [...incoming.listedCompanies, ...extraExisting];

        incoming.listedCompanies.forEach((nextComp) => {
          const oldComp = (prev.listedCompanies || []).find((c) => c.ticker === nextComp.ticker);
          if (oldComp && oldComp.price !== nextComp.price && nextComp.rawPrice && oldComp.rawPrice) {
            compChanges[nextComp.ticker] = nextComp.rawPrice >= oldComp.rawPrice ? 'up' : 'down';
          }
        });
      }

      if (Object.keys(idxChanges).length > 0) {
        setChangedIndices(idxChanges);
        setTimeout(() => setChangedIndices({}), 850);
      }
      if (Object.keys(compChanges).length > 0) {
        setChangedTickers(compChanges);
        setTimeout(() => setChangedTickers({}), 850);
      }

      return {
        indices: incoming.indices && incoming.indices.length > 0 ? incoming.indices : prev.indices,
        listedCompanies: mergedCompanies,
        news: incoming.news && incoming.news.length > 0 ? incoming.news : prev.news,
        marketStatus: incoming.marketStatus && incoming.marketStatus.length > 0 ? incoming.marketStatus : prev.marketStatus,
        lastUpdated: incoming.lastUpdated || new Date().toISOString(),
      };
    });

    const ts = incoming.lastUpdated ? new Date(incoming.lastUpdated) : new Date();
    setLastUpdatedLabel(ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  };

  // Real-time WebSocket stream + initial HTTP snapshot hydration
  useEffect(() => {
    let isMounted = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    fetchMarketSnapshot().then((snapshot) => {
      if (isMounted && snapshot) {
        applyIncomingMarketData(snapshot);
      }
    });

    fetchLiveMarketNews().then((freshNews) => {
      if (isMounted && freshNews && freshNews.length > 0) {
        setData((prev) => ({ ...prev, news: freshNews }));
      }
    });

    const connectMarketStream = () => {
      if (!isMounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/market-stream`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMounted) return;
        setStreamStatus('live');
        if (watchlistRef.current.length > 0) {
          try {
            ws.send(JSON.stringify({ type: 'subscribe', tickers: watchlistRef.current }));
          } catch {}
        }
      };

      ws.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'snapshot' || payload.type === 'tick') {
            applyIncomingMarketData(payload);
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!isMounted) return;
        setStreamStatus('reconnecting');
        reconnectTimer = setTimeout(connectMarketStream, 3500);
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {}
      };
    };

    connectMarketStream();

    return () => {
      isMounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
    };
  }, []);

  // Push updated watchlist subscriptions when user pins new symbols
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && watchlist.length > 0) {
      try {
        wsRef.current.send(JSON.stringify({ type: 'subscribe', tickers: watchlist }));
      } catch {}
    }
  }, [watchlist]);

  const selectedCompany = useMemo(() => {
    if (!selectedTicker) return null;
    return data.listedCompanies?.find((c) => c.ticker === selectedTicker) || fallbackCompany;
  }, [selectedTicker, data.listedCompanies, fallbackCompany]);

  const handleAddTicker = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTicker.trim()) {
      const sym = newTicker.toUpperCase().trim();
      addToWatchlist(sym);
      setNewTicker('');
      trackEngagement('Watchlist Customization');
    }
  };

  const handleDeepTickerLookup = async (queryText?: string) => {
    const symbolToFind = (queryText || companySearch).trim();
    if (!symbolToFind) return;

    setIsLookingUpTicker(true);
    setLookupFeedback(null);
    trackEngagement(`Exchange Deep Lookup: ${symbolToFind}`);

    try {
      const resolvedCompany = await searchCompanyTicker(symbolToFind);
      if (resolvedCompany) {
        setData((prevData) => {
          if (!prevData) return prevData;
          const list = prevData.listedCompanies || [];
          const exists = list.some((c) => c.ticker === resolvedCompany.ticker);
          const updated = exists
            ? list.map((c) => (c.ticker === resolvedCompany.ticker ? resolvedCompany : c))
            : [resolvedCompany, ...list];
          return { ...prevData, listedCompanies: updated };
        });
        setExchangeFilter('ALL');
        setFallbackCompany(resolvedCompany);
        setSelectedTicker(resolvedCompany.ticker);
        setLookupFeedback(`Live quote loaded: ${resolvedCompany.name} (${resolvedCompany.ticker}) — ${resolvedCompany.price}`);
      } else {
        setLookupFeedback(`Could not verify active market quote for "${symbolToFind}". Try a symbol like PLTR, UBER, AAPL or INFY.`);
      }
    } catch {
      setLookupFeedback('Lookup error. Please verify the symbol and try again.');
    } finally {
      setIsLookingUpTicker(false);
    }
  };

  const handleNewsSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newsSearchQuery.trim()) {
      setCustomNewsResults(null);
      return;
    }

    setIsSearchingNews(true);
    trackEngagement('Live Financial News Feed');
    const newsResults = await searchFinancialNews(newsSearchQuery);
    setCustomNewsResults(newsResults || []);
    setIsSearchingNews(false);
  };

  const filteredCompanies = useMemo(() => {
    if (!data?.listedCompanies) return [];
    return data.listedCompanies.filter((company) => {
      if (exchangeFilter === 'US' && !company.exchange.includes('NYSE') && !company.exchange.includes('NASDAQ')) return false;
      if (exchangeFilter === 'INDIA' && !company.exchange.includes('NSE') && !company.exchange.includes('BSE')) return false;
      if (exchangeFilter === 'EUROPE' && !company.exchange.includes('LSE') && !company.exchange.includes('Euronext')) return false;
      if (exchangeFilter === 'ASIA' && !company.exchange.includes('TSE') && !company.exchange.includes('HKEX')) return false;

      if (companySearch.trim()) {
        const query = companySearch.toLowerCase().trim();
        const matchTicker = company.ticker.toLowerCase().includes(query);
        const matchName = company.name.toLowerCase().includes(query);
        const matchSector = company.sector.toLowerCase().includes(query);
        const matchDesc = (company.description || '').toLowerCase().includes(query);
        const matchCeo = (company.ceo || '').toLowerCase().includes(query);
        const matchGoogle = query.includes('goog') && company.ticker === 'GOOGL';
        const matchMeta = (query.includes('meta') || query.includes('faceb')) && company.ticker === 'META';
        const matchTsmc = query.includes('tsmc') && company.ticker === '2330';
        const matchEternal =
          (query.includes('zomato') || query.includes('eternal') || query.includes('blinkit')) &&
          (company.ticker === 'ZOMATO' || company.name.toLowerCase().includes('eternal'));
        return matchTicker || matchName || matchSector || matchDesc || matchCeo || matchGoogle || matchMeta || matchTsmc || matchEternal;
      }
      return true;
    });
  }, [data?.listedCompanies, exchangeFilter, companySearch]);

  const activeNewsList = customNewsResults !== null ? customNewsResults : (data?.news || []);

  const filteredNews = useMemo(() => {
    if (customNewsResults !== null) return customNewsResults;
    if (!newsSearchQuery.trim()) return activeNewsList;
    const q = newsSearchQuery.toLowerCase().trim();
    return activeNewsList.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        item.source.toLowerCase().includes(q) ||
        (item.category && item.category.toLowerCase().includes(q))
    );
  }, [activeNewsList, customNewsResults, newsSearchQuery]);

  return (
    <div className="h-full flex flex-col space-y-6 pt-2 animate-enter">
      {/* Header with Live Stream Indicator & Global Market Clocks */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-3xl font-extrabold text-neutral-900 dark:text-white tracking-tight">
              Global Markets & Listed Equities
            </h2>
            <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-0.5 rounded-full font-mono ${
              streamStatus === 'live'
                ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${streamStatus === 'live' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span>{streamStatus === 'live' ? 'Live Market Feed' : 'Syncing Live Feed'}</span>
              <span className="opacity-70 tabular-nums">· {lastUpdatedLabel}</span>
            </span>
          </div>
          <p className="text-neutral-500 dark:text-neutral-400 mt-1 text-xs">
            Real-time synced market indices, crypto spot pricing, exchange equities and breaking financial wires across NYSE, NASDAQ, NSE, BSE, LSE and TSE.
          </p>
        </div>

        {/* Global Exchange Clocks */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-600 dark:text-neutral-300 bg-white/70 dark:bg-neutral-900/70 backdrop-blur-md px-4 py-2.5 rounded-2xl border border-neutral-200/60 dark:border-neutral-800 shadow-xs">
          {data?.marketStatus?.map((status, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${status.isOpen ? 'bg-emerald-500 shadow-xs' : 'bg-neutral-300 dark:bg-neutral-600'}`} />
              <span className="font-semibold text-neutral-800 dark:text-neutral-200 text-[11px]">{status.region.split(' ')[0]}</span>
              <span className={`font-mono text-[10px] tabular-nums ${status.isOpen ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-neutral-400'}`}>
                {status.isOpen ? 'OPEN' : 'CLOSED'}
              </span>
              {status.localTime && (
                <span className="font-mono text-[10px] text-neutral-400 tabular-nums">({status.localTime})</span>
              )}
              {idx < (data.marketStatus?.length || 0) - 1 && <span className="text-neutral-300 dark:text-neutral-700 ml-1">·</span>}
            </div>
          ))}
        </div>
      </header>

      {/* Major Global Indices Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {data?.indices.map((index, idx) => {
          const tickDir = changedIndices[index.name];
          return (
            <div
              key={index.name || idx}
              className={`glass-card dark:bg-neutral-900/80 p-3.5 rounded-2xl flex flex-col justify-between hover:shadow-md transition-all border hover:scale-[1.02] ${
                tickDir === 'up'
                  ? 'border-emerald-400/70 ring-1 ring-emerald-400/30'
                  : tickDir === 'down'
                  ? 'border-rose-400/70 ring-1 ring-rose-400/30'
                  : 'border-white/70 dark:border-neutral-800'
              }`}
            >
              <div className="flex justify-between items-start">
                <span className="text-neutral-500 dark:text-neutral-400 font-mono font-bold text-[10px] uppercase truncate">{index.name}</span>
              </div>
              <div className="mt-2">
                <h4 className={`text-base font-extrabold tracking-tight font-mono tabular-nums transition-colors ${
                  tickDir === 'up'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : tickDir === 'down'
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-neutral-900 dark:text-white'
                }`}>
                  {index.value}
                </h4>
                <span className={`font-mono text-[10px] font-bold block tabular-nums ${index.isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                  {index.change}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Listed Companies Directory Section */}
      <div className="glass-card dark:bg-neutral-900/90 dark:border-neutral-800 rounded-[32px] p-6 border border-white/70 shadow-xs flex flex-col space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-neutral-100 dark:border-neutral-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">🏛️</span>
              <h3 className="text-lg font-extrabold text-neutral-900 dark:text-white">
                Major World Stock Exchange Listed Companies
              </h3>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-300 mt-0.5">
              Live exchange quotes across NYSE, NASDAQ, NSE, BSE, LSE, Euronext, TSE and HKEX. Search any global symbol.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (companySearch.trim()) {
                handleDeepTickerLookup(companySearch);
              }
            }}
            className="flex items-center gap-2 w-full md:w-80"
          >
            <div className="relative flex-1">
              <ICONS.Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-neutral-300" />
              <input
                type="text"
                value={companySearch}
                onChange={(e) => {
                  setCompanySearch(e.target.value);
                  setLookupFeedback(null);
                }}
                placeholder="Search symbol (e.g. NVDA, INFY, PLTR)..."
                className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl pl-9 pr-8 py-2 text-xs text-neutral-900 dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
              />
              {companySearch && (
                <button
                  type="button"
                  onClick={() => {
                    setCompanySearch('');
                    setLookupFeedback(null);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-white text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={isLookingUpTicker || !companySearch.trim()}
              title="Lookup company across all world exchanges"
              className="px-3.5 py-2 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-xl text-xs font-bold hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors disabled:opacity-40 shadow-xs shrink-0 flex items-center gap-1.5 cursor-pointer"
            >
              {isLookingUpTicker ? (
                <span className="w-3.5 h-3.5 border-2 border-neutral-400 border-t-white dark:border-t-neutral-900 rounded-full animate-spin" />
              ) : (
                <span>Lookup</span>
              )}
            </button>
          </form>
        </div>

        {lookupFeedback && (
          <div className="p-3 rounded-xl bg-indigo-50/80 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-xs text-indigo-900 dark:text-indigo-200 flex items-center justify-between">
            <span className="font-medium">{lookupFeedback}</span>
            <button onClick={() => setLookupFeedback(null)} className="font-bold opacity-60 hover:opacity-100 text-sm">✕</button>
          </div>
        )}

        {/* Exchange Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          {[
            { id: 'ALL' as const, label: 'All Exchanges' },
            { id: 'US' as const, label: 'NYSE & NASDAQ (USA)' },
            { id: 'INDIA' as const, label: 'NSE & BSE (India)' },
            { id: 'EUROPE' as const, label: 'LSE & Euronext (Europe)' },
            { id: 'ASIA' as const, label: 'TSE & HKEX (Asia-Pac)' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setExchangeFilter(tab.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                exchangeFilter === tab.id
                  ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 shadow-xs'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 border border-transparent dark:border-neutral-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-neutral-500 dark:text-neutral-300 font-mono hidden sm:inline font-semibold tabular-nums">
            Showing {filteredCompanies.length} companies
          </span>
        </div>

        {/* Companies Table */}
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800 text-[11px] font-bold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider font-mono">
                <th className="py-3 px-4 pl-2">Asset / Symbol</th>
                <th className="py-3 px-4">Exchange</th>
                <th className="py-3 px-4">Sector</th>
                <th className="py-3 px-4 text-right">Market Cap</th>
                <th className="py-3 px-4 text-right">Price</th>
                <th className="py-3 px-4 text-right">24h Change</th>
                <th className="py-3 px-4 text-right">P/E Ratio</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800/80 text-xs">
              {filteredCompanies.map((c) => {
                const isWatchlisted = watchlist.includes(c.ticker);
                const tickDir = changedTickers[c.ticker];
                return (
                  <tr
                    key={c.ticker}
                    onClick={() => {
                      setFallbackCompany(c);
                      setSelectedTicker(c.ticker);
                      trackEngagement(`Inspect Company: ${c.ticker}`);
                    }}
                    className="hover:bg-neutral-50/80 dark:hover:bg-neutral-800/60 transition-all cursor-pointer group hover-border-glow border-y border-transparent hover:border-sky-400 dark:hover:border-sky-400"
                    title={`Click to view live telemetry for ${c.name}`}
                  >
                    <td className="py-3 px-4 pl-2">
                      <div className="flex items-center gap-3">
                        <CompanyLogo ticker={c.ticker} name={c.name} size="md" />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-neutral-900 dark:text-white font-mono group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                              {c.ticker}
                            </span>
                            <span className="text-[10px] text-neutral-400 opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
                          </div>
                          <span className="text-[11px] text-neutral-500 dark:text-neutral-300 block truncate max-w-[180px]">{c.name}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 border border-transparent dark:border-neutral-700 font-mono text-[10px] font-semibold">
                        {c.exchange}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-neutral-600 dark:text-neutral-300 text-[11px] font-medium">
                      {c.sector}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-neutral-900 dark:text-white tabular-nums">
                      {c.marketCap}
                    </td>
                    <td className={`py-3 px-4 text-right font-mono font-bold tabular-nums transition-colors ${
                      tickDir === 'up'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : tickDir === 'down'
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-neutral-900 dark:text-white'
                    }`}>
                      {c.price}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold tabular-nums">
                      <span className={`px-2 py-0.5 rounded-md ${
                        c.isPositive
                          ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200/50 dark:border-emerald-800/50'
                          : 'bg-red-50 dark:bg-red-950/70 text-red-700 dark:text-red-300 border border-red-200/50 dark:border-red-800/50'
                      }`}>
                        {c.change}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-neutral-700 dark:text-neutral-200 font-semibold tabular-nums">
                      {c.peRatio || '—'}
                    </td>
                    <td className="py-3 px-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          if (isWatchlisted) removeFromWatchlist(c.ticker);
                          else addToWatchlist(c.ticker);
                        }}
                        className={`px-3 py-1 rounded-xl text-[11px] font-bold transition-all cursor-pointer ${
                          isWatchlisted
                            ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                            : 'bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 border border-transparent dark:border-neutral-700'
                        }`}
                        title={isWatchlisted ? 'Remove from Watchlist' : 'Add to Watchlist'}
                      >
                        {isWatchlisted ? '✓ Tracked' : '+ Watch'}
                      </button>
                    </td>
                  </tr>
                );
              })}

              {isLookingUpTicker && (
                <tr>
                  <td colSpan={8} className="py-8 px-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs font-mono text-indigo-600 dark:text-indigo-400 font-bold animate-pulse px-2">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-ping" />
                          <span>Fetching Live Exchange Quote for "{companySearch.toUpperCase()}"...</span>
                        </div>
                        <span className="text-[11px] opacity-75 hidden sm:inline">NYSE · NASDAQ · NSE · BSE · LSE · TSE</span>
                      </div>
                    </div>
                  </td>
                </tr>
              )}

              {!isLookingUpTicker && filteredCompanies.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 px-6 text-center">
                    <div className="max-w-md mx-auto space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mx-auto text-xl">
                        🔍
                      </div>
                      <h4 className="font-bold text-neutral-900 dark:text-white text-sm">
                        {companySearch.trim() ? `Search Global Exchanges for "${companySearch.toUpperCase()}"` : 'No companies in this filter'}
                      </h4>
                      <p className="text-xs text-neutral-500 dark:text-neutral-300 leading-relaxed">
                        {companySearch.trim()
                          ? `Query NYSE, NASDAQ, NSE, BSE, LSE and Tokyo exchanges directly for live market quotes on "${companySearch.toUpperCase()}".`
                          : 'Select another exchange filter above or enter any ticker symbol in the search box.'}
                      </p>
                      {companySearch.trim() && (
                        <button
                          type="button"
                          onClick={() => handleDeepTickerLookup(companySearch)}
                          disabled={isLookingUpTicker}
                          className="px-5 py-2.5 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-bold hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-all shadow-md inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 hover-border-glow"
                        >
                          <span>⚡ Lookup Live Quote for "{companySearch.toUpperCase()}"</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Watchlist & Live Financial News Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        {/* Watchlist Column */}
        <div className="lg:col-span-4 glass-card dark:bg-neutral-900/80 dark:border-neutral-800 rounded-[28px] p-6 flex flex-col border border-white/70 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-neutral-900 dark:text-white">Active Watchlist</h3>
            <span className="text-xs text-neutral-400 font-mono tabular-nums">{watchlist.length} pinned</span>
          </div>

          <form onSubmit={handleAddTicker} className="flex gap-2 mb-4">
            <input
              type="text"
              value={newTicker}
              onChange={(e) => setNewTicker(e.target.value)}
              placeholder="Add symbol (e.g. INFY, NVDA)"
              className="flex-1 px-3.5 py-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200/80 dark:border-neutral-700 rounded-xl text-xs uppercase font-mono text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-bold rounded-xl hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors shadow-xs"
            >
              Add
            </button>
          </form>

          <div className="space-y-2 flex-1 overflow-y-auto no-scrollbar max-h-[380px]">
            {watchlist.length === 0 ? (
              <div className="p-8 text-center text-xs text-neutral-400 border border-dashed border-neutral-200 dark:border-neutral-800 rounded-2xl">
                No pinned assets yet. Click "+ Watch" on any listed company to begin tracking.
              </div>
            ) : (
              watchlist.map((ticker) => {
                const matchedCompany = data?.listedCompanies?.find((c) => c.ticker === ticker);
                return (
                  <div
                    key={ticker}
                    onClick={() => {
                      if (matchedCompany) {
                        setFallbackCompany(matchedCompany);
                        setSelectedTicker(matchedCompany.ticker);
                      } else {
                        handleDeepTickerLookup(ticker);
                      }
                    }}
                    className="flex items-center justify-between p-3 rounded-xl bg-neutral-50/70 dark:bg-neutral-800/60 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all border border-neutral-200/80 dark:border-neutral-800 hover:border-sky-400 dark:hover:border-sky-400 hover:shadow-[0_0_12px_rgba(56,189,248,0.25)] cursor-pointer group"
                    title={matchedCompany ? `Click to inspect ${matchedCompany.name}` : `Click to inspect ${ticker} on global exchanges`}
                  >
                    <div className="flex items-center gap-2.5">
                      <CompanyLogo ticker={ticker} size="sm" />
                      <div>
                        <span className="font-mono font-bold text-xs text-neutral-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                          {ticker}
                        </span>
                        <p className="text-[10px] text-neutral-400 truncate max-w-[120px]">
                          {matchedCompany ? matchedCompany.name : 'Tracked Asset'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {matchedCompany ? (
                        <div className="text-right">
                          <span className="text-xs font-mono font-bold block text-neutral-900 dark:text-white tabular-nums">{matchedCompany.price}</span>
                          <span className={`text-[10px] font-mono font-semibold tabular-nums ${matchedCompany.isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
                            {matchedCompany.change}
                          </span>
                        </div>
                      ) : (
                        <div className="text-right">
                          <span className="text-[10px] font-mono font-bold text-indigo-500 dark:text-indigo-400 group-hover:underline">
                            Inspect &rarr;
                          </span>
                        </div>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromWatchlist(ticker);
                        }}
                        className="text-neutral-400 hover:text-red-500 transition-colors p-1"
                        title="Remove ticker"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Live Financial News Column */}
        <div className="lg:col-span-8 glass-card dark:bg-neutral-900/80 dark:border-neutral-800 rounded-[28px] p-6 flex flex-col border border-white/70 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                <span>📰</span>
                <span>Live Financial News Wire</span>
              </h3>
              <p className="text-xs text-neutral-400">
                Real-time market headlines synced from global financial feeds. Click any story to read full details.
              </p>
            </div>

            <form onSubmit={handleNewsSearch} className="flex gap-2 items-center">
              <input
                type="text"
                value={newsSearchQuery}
                onChange={(e) => {
                  setNewsSearchQuery(e.target.value);
                  if (!e.target.value.trim()) setCustomNewsResults(null);
                }}
                placeholder="Search headlines or tickers..."
                className="px-3 py-1.5 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200/80 dark:border-neutral-700 rounded-xl text-xs text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 w-44"
              />
              <button
                type="submit"
                disabled={isSearchingNews}
                className="px-3.5 py-1.5 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-bold rounded-xl hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors disabled:opacity-50"
              >
                {isSearchingNews ? '...' : 'Search'}
              </button>
              {customNewsResults !== null && (
                <button
                  type="button"
                  onClick={() => {
                    setNewsSearchQuery('');
                    setCustomNewsResults(null);
                  }}
                  className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-white font-semibold"
                >
                  Reset
                </button>
              )}
            </form>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto no-scrollbar max-h-[460px]">
            {isSearchingNews ? (
              <div className="space-y-3 py-1">
                <div className="flex items-center justify-between text-xs font-mono text-indigo-600 dark:text-indigo-400 font-bold animate-pulse px-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-ping" />
                    <span>Querying Live Financial Wire for "{newsSearchQuery || 'Markets'}"...</span>
                  </div>
                </div>
              </div>
            ) : filteredNews.length === 0 ? (
              <div className="p-8 text-center rounded-2xl border border-dashed border-neutral-200 dark:border-neutral-800 space-y-3 my-auto">
                <div className="w-10 h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mx-auto text-lg">
                  📰
                </div>
                <h4 className="text-xs font-bold text-neutral-900 dark:text-white">
                  {newsSearchQuery ? `No cached stories matching "${newsSearchQuery}"` : 'Syncing live market headlines...'}
                </h4>
                {newsSearchQuery && (
                  <button
                    type="button"
                    onClick={() => handleNewsSearch()}
                    className="px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-bold hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-colors shadow-xs inline-flex items-center gap-2 cursor-pointer"
                  >
                    <span>⚡ Query Live Wire for "{newsSearchQuery}"</span>
                  </button>
                )}
              </div>
            ) : (
              filteredNews.map((item, idx) => (
                <div
                  key={`${item.title}-${idx}`}
                  onClick={() => setSelectedNews(item)}
                  className="p-4 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 transition-all shadow-xs cursor-pointer hover:border-sky-400 dark:hover:border-sky-400 hover:shadow-[0_0_14px_rgba(56,189,248,0.25)] hover:bg-neutral-50/60 dark:hover:bg-neutral-800/70 group"
                  title="Click to read article summary and source link"
                >
                  <div className="flex items-center justify-between text-[11px] text-neutral-600 dark:text-neutral-300 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-neutral-900 dark:text-white font-mono bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-md border border-neutral-200/60 dark:border-neutral-700">
                        {item.source}
                      </span>
                      <span>·</span>
                      <span className="text-neutral-600 dark:text-neutral-200 text-[10px] font-semibold">
                        {item.category || 'Global Wire'}
                      </span>
                      {item.sentiment && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded border ${
                          item.sentiment === 'BULLISH'
                            ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200 dark:border-emerald-800'
                            : item.sentiment === 'BEARISH'
                            ? 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/70 border-rose-200 dark:border-rose-800'
                            : 'text-neutral-700 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700'
                        }`}>
                          {item.sentiment}
                        </span>
                      )}
                    </div>
                    {item.timeAgo && (
                      <span className="font-mono text-[10px] text-neutral-500 dark:text-neutral-400 font-medium">{item.timeAgo}</span>
                    )}
                  </div>

                  <h4 className="text-sm font-bold text-neutral-900 dark:text-white leading-snug group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors flex items-center justify-between">
                    <span>{item.title}</span>
                    <span className="text-xs font-mono ml-2 text-indigo-500 opacity-60 group-hover:opacity-100 transition-opacity">↗</span>
                  </h4>

                  <p className="text-xs text-neutral-600 dark:text-neutral-300 mt-2 leading-relaxed line-clamp-2">
                    {item.summary}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Interactive Company Detail Modal (live synced via selectedTicker) */}
      {selectedCompany && (
        <CompanyDetailModal
          company={selectedCompany}
          onClose={() => {
            setSelectedTicker(null);
            setFallbackCompany(null);
          }}
        />
      )}

      {/* Interactive News Detail Modal */}
      {selectedNews && (
        <NewsDetailModal
          news={selectedNews}
          onClose={() => setSelectedNews(null)}
        />
      )}
    </div>
  );
};

export default Markets;