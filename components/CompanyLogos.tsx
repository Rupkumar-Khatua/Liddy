import React from 'react';

interface CompanyLogoProps {
  ticker: string;
  name?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const CompanyLogo: React.FC<CompanyLogoProps> = ({
  ticker,
  name,
  className = '',
  size = 'md'
}) => {
  const containerSize = {
    sm: 'w-7 h-7 rounded-lg',
    md: 'w-9 h-9 rounded-xl',
    lg: 'w-14 h-14 rounded-2xl'
  }[size];

  const iconSize = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-8 h-8'
  }[size];

  const t = ticker.toUpperCase().trim();

  // Render authentic corporate marks
  const renderLogoGraphic = () => {
    switch (t) {
      case 'SPY':
        return (
          // SPDR S&P 500 ETF Trust Emblem
          <div className="font-mono font-black text-[9px] text-emerald-600 dark:text-emerald-400 tracking-tighter flex items-center justify-center">
            SPDR
          </div>
        );

      case 'QQQ':
        return (
          // Invesco QQQ Electric Blue Monogram
          <div className="font-mono font-black text-[10px] text-indigo-600 dark:text-indigo-400 tracking-tight flex items-center justify-center">
            QQQ
          </div>
        );

      case 'AAPL':
        return (
          // Apple Minimalist Silhouette
          <svg className={iconSize} viewBox="0 0 170 170" fill="currentColor">
            <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.04-7.66-7.85-11.89-14.43-5.77-8.9-10.4-19.16-13.88-30.77-3.48-11.62-5.22-22.68-5.22-33.19 0-14.12 3.69-25.56 11.08-34.33 7.39-8.77 16.64-13.26 27.76-13.48 5.76 0 11.75 1.48 17.98 4.45 6.22 2.97 10.15 4.51 11.78 4.62 1.96-.22 6.08-1.8 12.37-4.74 6.29-2.93 12.08-4.34 17.38-4.22 13.9.65 24.87 5.76 32.92 15.34-12.17 7.39-18.15 17.5-17.93 30.33.22 10.22 4.12 18.69 11.71 25.42 7.59 6.74 16.73 10.43 27.42 11.08-2.61 7.82-5.76 15.65-9.44 23.49zM119.22 33.15c0-7.39 2.66-14.46 7.98-21.2 5.32-6.74 11.96-10.87 19.92-12.4-.22 1.3-.49 2.55-.82 3.75-.98 4.35-2.88 8.64-5.71 12.87-3.91 5.76-9.13 9.78-15.65 12.06-1.52.54-3.42.87-5.72.92z"/>
          </svg>
        );

      case 'MSFT':
        return (
          // Microsoft 4-Color Grid
          <svg className={iconSize} viewBox="0 0 24 24">
            <rect x="1" y="1" width="10" height="10" fill="#F25022" />
            <rect x="13" y="1" width="10" height="10" fill="#7FBA00" />
            <rect x="1" y="13" width="10" height="10" fill="#00A4EF" />
            <rect x="13" y="13" width="10" height="10" fill="#FFB900" />
          </svg>
        );

      case 'NVDA':
        return (
          // NVIDIA Geometric Mark
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <path d="M7 6C5 9 5 15 8 18C12 21 17 20 20 17C17 19 13 18 10 16C7 13 8 9 10 7C11 6 13 6 15 7C13 5 10 5 7 6Z" fill="#76B900" />
            <circle cx="15" cy="12" r="3" fill="#76B900" />
          </svg>
        );

      case 'GOOGL':
        return (
          // Google Multi-Color G
          <svg className={iconSize} viewBox="0 0 24 24">
            <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"/>
            <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"/>
            <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
            <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
          </svg>
        );

      case 'AMZN':
        return (
          // Amazon Smile Mark
          <svg className={iconSize} viewBox="0 0 24 24" fill="currentColor">
            <path d="M13.9 12.3c-.9.1-1.8.5-2.2 1.1-.4.6-.3 1.5.3 2 .5.4 1.2.4 1.8.1.6-.3 1.1-.8 1.3-1.5v-1.7zm1.8-3.4v6.2c0 .5.1.9.4 1.2.3.3.7.4 1.1.4.5 0 .9-.2 1.2-.5l-.4-1c-.2.2-.4.2-.6.2-.2 0-.3-.1-.4-.2-.1-.2-.1-.5-.1-.8v-4c0-.7-.2-1.3-.7-1.8-.5-.5-1.3-.8-2.2-.8-1.2 0-2.3.4-3.1 1.2l.9 1c.5-.5 1.3-.8 2.1-.8.5 0 .9.1 1.2.4.3.3.5.7.5 1.1z" />
            <path d="M21.5 18.2c-2.4 1.8-5.6 2.7-8.8 2.7-4.2 0-8-1.5-11.2-4.1-.3-.2-.3-.6 0-.8.2-.1.5 0 .7.2 3 2.4 6.5 3.8 10.5 3.8 2.9 0 5.8-.8 8-2.4.4-.3.9.1.8.6z" fill="#FF9900" />
          </svg>
        );

      case 'META':
        return (
          // Meta Infinity Mark
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <path d="M12 14.5C9.8 17.5 7.5 18 5.7 18C3.2 18 1.5 16 1.5 13.5C1.5 10.7 3.6 8 6.5 8C8.5 8 10.4 9.5 12 12C13.6 9.5 15.5 8 17.5 8C20.4 8 22.5 10.7 22.5 13.5C22.5 16 20.8 18 18.3 18C16.5 18 14.2 17.5 12 14.5Z" stroke="#0081FB" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        );

      case 'TSLA':
        return (
          // Tesla T Shield Mark
          <svg className={iconSize} viewBox="0 0 24 24" fill="#E82127">
            <path d="M12 5.5c2.4 0 4.8.4 7 .9.3-1.2.7-2.1 1.2-2.7-2.6-.7-5.4-1.1-8.2-1.1s-5.6.4-8.2 1.1c.5.6.9 1.5 1.2 2.7 2.2-.5 4.6-.9 7-.9zm0 2.8c-2.6 0-5 .3-7.2.9.2.8.5 2.5.6 3.6 2-.4 4.3-.6 6.6-.6s4.6.2 6.6.6c.1-1.1.4-2.8.6-3.6-2.2-.6-4.6-.9-7.2-.9zm-1.5 6.2v7.5h3v-7.5c2.2.3 4.2.8 6.1 1.4.1-.7.4-2.1.5-2.8-2.1-.5-4.4-.9-6.6-1.1v-1.1h-6v1.1c-2.2.2-4.5.6-6.6 1.1.1.7.4 2.1.5 2.8 1.9-.6 3.9-1.1 6.1-1.4z"/>
          </svg>
        );

      case 'BRK.A':
        return (
          // Berkshire Hathaway Classic Navy Monogram
          <div className="font-serif font-black text-xs text-[#002B49] dark:text-neutral-200 tracking-tighter">
            BH
          </div>
        );

      case 'RELIANCE':
        return (
          // Reliance Industries Gear & Flame Mark
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="#004B87" strokeWidth="2" />
            <path d="M12 6L14 11H10L12 6Z" fill="#D9222A" />
            <circle cx="12" cy="14" r="2.5" fill="#004B87" />
          </svg>
        );

      case 'TCS':
        return (
          // Tata Consultancy Services
          <div className="font-sans font-black text-[10px] text-[#005A9C] dark:text-blue-400 tracking-wider">
            TATA
          </div>
        );

      case 'HDFCBANK':
        return (
          // HDFC Bank Square Geometric
          <svg className={iconSize} viewBox="0 0 24 24">
            <rect x="2" y="2" width="20" height="20" rx="3" fill="#004B87" />
            <rect x="7" y="7" width="10" height="10" fill="#ED1C24" />
            <rect x="10" y="10" width="4" height="4" fill="#FFFFFF" />
          </svg>
        );

      case 'INFY':
        return (
          // Infosys
          <div className="font-sans font-black text-[10px] text-[#007CC3] tracking-tighter">
            Infosys
          </div>
        );

      case 'JPM':
        return (
          // JPMorgan Chase Octagon / Monogram
          <div className="font-sans font-black text-[10px] text-[#113355] dark:text-blue-300 tracking-tight">
            JPM
          </div>
        );

      case 'LLY':
        return (
          // Eli Lilly Script Style
          <div className="font-serif italic font-bold text-xs text-[#D52B1E] tracking-tighter">
            Lilly
          </div>
        );

      case 'AVGO':
        return (
          // Broadcom Red Dot Wave
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" fill="#CC0000" />
            <path d="M7 14C9 10 15 10 17 14" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
          </svg>
        );

      case 'WMT':
        return (
          // Walmart Spark
          <svg className={iconSize} viewBox="0 0 24 24" fill="#FFC220">
            <path d="M12 2v6m0 8v6M2 12h6m8 0h6m-3.5-6.5l-4.2 4.2m-4.6 4.6l-4.2 4.2m13 0l-4.2-4.2m-4.6-4.6l-4.2-4.2" stroke="#FFC220" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        );

      case 'ICICIBANK':
        return (
          // ICICI Bank Maroon 'i'
          <svg className={iconSize} viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" fill="#B3282D" />
            <path d="M10 8h4v8h-4z" fill="#FFFFFF" />
            <circle cx="12" cy="5" r="1.5" fill="#F58220" />
          </svg>
        );

      case 'BHARTIARTL':
        return (
          // Airtel Red Swirl
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <path d="M7 16C7 10 11 6 15 6C18 6 19 8 18 11C16 16 11 18 7 16Z" fill="#ED1C24" />
          </svg>
        );

      case 'SBIN':
        return (
          // SBI Keyhole Blue Circle
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9.5" fill="#00A5D9" />
            <circle cx="12" cy="9.5" r="2.5" fill="#FFFFFF" />
            <rect x="11" y="9.5" width="2" height="7.5" fill="#FFFFFF" />
          </svg>
        );

      case 'ITC':
        return (
          // ITC Triangle Mark
          <div className="font-sans font-black text-[11px] text-[#004B87] dark:text-amber-400 tracking-wider">
            ITC
          </div>
        );

      case 'LT':
        return (
          // Larsen & Toubro Circle
          <div className="font-sans font-black text-[10px] text-[#002D62] dark:text-cyan-300 tracking-wider">
            L&T
          </div>
        );

      case 'TATAMOTORS':
        return (
          // Tata Motors
          <div className="font-sans font-bold text-[9px] text-[#1E3A8A] dark:text-blue-400 tracking-tight">
            MOTORS
          </div>
        );

      case 'SHEL':
        return (
          // Shell Pecten Scallop
          <svg className={iconSize} viewBox="0 0 24 24">
            <path d="M12 3C8 3 5 7 5 12C5 17 8 20 12 21C16 20 19 17 19 12C19 7 16 3 12 3Z" fill="#FFD100" stroke="#DD1D21" strokeWidth="1.5" />
          </svg>
        );

      case 'NOVN':
        return (
          // Novartis Blue Monogram
          <div className="font-sans font-black text-[10px] text-[#003B5C] dark:text-teal-300 tracking-tighter">
            NOVARTIS
          </div>
        );

      case 'TTE':
        return (
          // TotalEnergies Multi-Color Wind
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <circle cx="9" cy="12" r="5" stroke="#E30613" strokeWidth="2" />
            <circle cx="15" cy="12" r="5" stroke="#005CA9" strokeWidth="2" />
          </svg>
        );

      case '005930':
        return (
          // Samsung Blue Oval
          <svg className={iconSize} viewBox="0 0 24 24">
            <ellipse cx="12" cy="12" rx="10" ry="6" fill="#1428A0" />
            <text x="12" y="14" fill="#FFFFFF" fontSize="4.5" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">SAMSUNG</text>
          </svg>
        );

      case '6861':
        return (
          // Keyence
          <div className="font-mono font-bold text-[9px] text-[#D71920] tracking-tight">
            KEYENCE
          </div>
        );

      case '8035':
        return (
          // Tokyo Electron
          <div className="font-sans font-black text-[10px] text-[#005BAC] dark:text-blue-300 tracking-wider">
            TEL
          </div>
        );

      case 'ASML':
        return (
          // ASML Semiconductor
          <div className="font-mono font-black text-[10px] text-[#002F6C] dark:text-cyan-400 tracking-widest">
            ASML
          </div>
        );

      case 'NOVO-B':
        return (
          // Novo Nordisk Apis Bull
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" fill="#001489" />
            <path d="M7 13C8 10 11 9 14 11C16 12 17 14 17 16" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="9" cy="9" r="1.5" fill="#FFFFFF" />
          </svg>
        );

      case 'SAP':
        return (
          // SAP Trapezoid
          <svg className={iconSize} viewBox="0 0 24 24">
            <path d="M2 5L12 3L22 5V19L12 21L2 19V5Z" fill="#008FD3" />
            <text x="12" y="14" fill="#FFFFFF" fontSize="7" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">SAP</text>
          </svg>
        );

      case 'MC':
        return (
          // LVMH Luxury Serif Mark
          <div className="font-serif font-black text-[11px] text-neutral-900 dark:text-white tracking-widest">
            LV
          </div>
        );

      case 'AZN':
        return (
          // AstraZeneca
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <path d="M5 18L12 6L19 18" stroke="#D0006F" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="12" cy="14" r="3" fill="#FFC72C" />
          </svg>
        );

      case '7203':
        return (
          // Toyota Triple Ellipse
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <ellipse cx="12" cy="12" rx="10" ry="7" stroke="#EB0A1E" strokeWidth="1.8" />
            <ellipse cx="12" cy="12" rx="4" ry="6" stroke="#EB0A1E" strokeWidth="1.8" />
            <ellipse cx="12" cy="9" rx="7" ry="3" stroke="#EB0A1E" strokeWidth="1.8" />
          </svg>
        );

      case '6758':
        return (
          // Sony Monogram
          <div className="font-mono font-black text-[10px] text-neutral-900 dark:text-white tracking-widest">
            SONY
          </div>
        );

      case '2330':
        return (
          // TSMC Wafer Mark
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="#C8102E" strokeWidth="2" />
            <line x1="12" y1="3" x2="12" y2="21" stroke="#C8102E" strokeWidth="1.5" />
            <line x1="3" y1="12" x2="21" y2="12" stroke="#C8102E" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="4" fill="#C8102E" />
          </svg>
        );

      case '0700':
        return (
          // Tencent Penguin / Blue Mark
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="5" fill="#0052D9" />
            <path d="M8 12C8 9.5 9.8 7.5 12 7.5C14.2 7.5 16 9.5 16 12C16 14.5 14.5 16.5 12 16.5C9.5 16.5 8 14.5 8 12Z" fill="#FFFFFF" />
            <circle cx="12" cy="12" r="2" fill="#E37318" />
          </svg>
        );

      case 'JPM':
        return (
          // JPMorgan Chase Octagon Mark
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <path d="M4 8L8 4H16L20 8V16L16 20H8L4 16V8Z" stroke="#005B94" strokeWidth="2" fill="#0A2F44" />
            <path d="M9 12H15M12 9V15" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        );

      case 'LLY':
        return (
          // Eli Lilly Red Script Mark
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="4" fill="#D52B1E" />
            <path d="M6 16C8 14 10 10 11 7M10 16C12 14 14 10 15 7M14 16C16 14 17 11 18 9" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
          </svg>
        );

      case 'AVGO':
        return (
          // Broadcom Red Geometric Wave
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="4" fill="#CC092F" />
            <path d="M5 14C8 8 11 8 13 14C15 20 18 20 19 14" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );

      case 'WMT':
        return (
          // Walmart Yellow Spark
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <path d="M12 3V8M12 16V21M4.2 7.5L8.5 10M15.5 14L19.8 16.5M4.2 16.5L8.5 14M15.5 10L19.8 7.5" stroke="#FFC220" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        );

      case 'ICICIBANK':
        return (
          // ICICI Bank Maroon/Orange Flame
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="4" fill="#A81C2E" />
            <path d="M6 18V6L12 12L18 6V18" stroke="#F58220" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );

      case 'BHARTIARTL':
        return (
          // Airtel Red Swirl
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill="#E40000" />
            <path d="M12 7C9.2 7 7 9.2 7 12C7 14.8 9.2 17 12 17C14.8 17 16 15 16 13C16 11 14 10 12 10" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
          </svg>
        );

      case 'SBIN':
        return (
          // SBI Keyhole Blue Emblem
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill="#0093D8" />
            <circle cx="12" cy="10" r="3.5" fill="#FFFFFF" />
            <rect x="11" y="10" width="2" height="8" fill="#FFFFFF" />
          </svg>
        );

      case 'ITC':
        return (
          // ITC Tri-Color Badge
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="4" fill="#1C355E" />
            <path d="M6 8H18M12 8V17M8 17H16" stroke="#DDA835" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );

      case 'LT':
        return (
          // Larsen & Toubro Blue Block
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="4" fill="#003366" />
            <path d="M7 7V17H12M14 7H20M17 7V17" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );

      case 'TATAMOTORS':
        return (
          // Tata Motors Blue Crest
          <svg className={iconSize} viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill="#004B87" />
            <path d="M8 9H16M12 9V17M10 13H14" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        );

      case 'ETERNAL':
      case 'ZOMATO':
        return (
          // Eternal Limited (Zomato Parent) Crimson & Gold Emblem
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#E23744] to-[#B31D28] text-white">
            <span className="font-mono font-black text-[8px] tracking-tight text-white leading-none">
              ETERNAL
            </span>
          </div>
        );

      default: {
        // High-contrast corporate monogram badge with deterministic color
        const colors = [
          'bg-indigo-600 text-white',
          'bg-emerald-600 text-white',
          'bg-sky-600 text-white',
          'bg-amber-600 text-white',
          'bg-violet-600 text-white',
          'bg-rose-600 text-white'
        ];
        const hash = t.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const colorClass = colors[hash % colors.length];

        return (
          <div className={`w-full h-full flex items-center justify-center font-mono font-bold text-xs ${colorClass}`}>
            {t.slice(0, 3)}
          </div>
        );
      }
    }
  };

  return (
    <div 
      className={`${containerSize} bg-white dark:bg-neutral-800 border border-neutral-200/80 dark:border-neutral-700/80 flex items-center justify-center shadow-xs shrink-0 overflow-hidden ${className}`}
      title={name || ticker}
    >
      {renderLogoGraphic()}
    </div>
  );
};

export default CompanyLogo;
