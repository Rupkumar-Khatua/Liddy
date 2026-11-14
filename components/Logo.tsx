import React from 'react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  showSubtitle?: boolean;
  className?: string;
  onClick?: () => void;
}

export const Logo: React.FC<LogoProps> = ({
  size = 'md',
  showText = true,
  showSubtitle = false,
  className = '',
  onClick,
}) => {
  const iconDimensions = {
    sm: 'w-8 h-8 rounded-xl',
    md: 'w-10 h-10 rounded-2xl',
    lg: 'w-14 h-14 rounded-3xl',
  }[size];

  const svgSize = {
    sm: 'w-5 h-5',
    md: 'w-6 h-6',
    lg: 'w-9 h-9',
  }[size];

  const content = (
    <div className={`flex items-center gap-3 ${onClick ? 'cursor-pointer select-none group' : ''} ${className}`}>
      <div
        className={`${iconDimensions} relative p-2 bg-gradient-to-br from-neutral-900 via-neutral-950 to-neutral-900 text-white flex items-center justify-center shadow-lg border border-neutral-800/80 overflow-hidden transition-all duration-300 group-hover:scale-105`}
      >
        <div className="absolute inset-0 bg-radial from-indigo-500/20 via-transparent to-transparent opacity-70 pointer-events-none" />
        <svg
          className={`${svgSize} relative z-10 drop-shadow-sm`}
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M6 5C6 4.44772 6.44772 4 7 4H12C12.5523 4 13 4.44772 13 5V22H24C24.5523 22 25 22.4477 25 23V27C25 27.5523 24.5523 28 24 28H7C6.44772 28 6 27.5523 6 27V5Z"
            fill="url(#liddy_platinum_grad)"
          />
          <path
            d="M13 14L22 5C22.3905 4.60948 23.0237 4.60948 23.4142 5L26 7.58579C26.3905 7.97631 26.3905 8.60948 26 9L18 17H13V14Z"
            fill="url(#liddy_accent_grad)"
            fillOpacity="0.9"
          />
          <circle cx="24.5" cy="14.5" r="2" fill="#38BDF8" />
          <defs>
            <linearGradient id="liddy_platinum_grad" x1="6" y1="4" x2="25" y2="28" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFFFFF" />
              <stop offset="0.45" stopColor="#E2E8F0" />
              <stop offset="0.8" stopColor="#94A3B8" />
              <stop offset="1" stopColor="#64748B" />
            </linearGradient>
            <linearGradient id="liddy_accent_grad" x1="13" y1="5" x2="26" y2="17" gradientUnits="userSpaceOnUse">
              <stop stopColor="#818CF8" />
              <stop offset="0.5" stopColor="#6366F1" />
              <stop offset="1" stopColor="#4F46E5" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col text-left">
          <span className="text-xl font-extrabold tracking-tight text-neutral-900 dark:text-white font-sans group-hover:text-indigo-600 dark:group-hover:text-sky-400 transition-colors whitespace-nowrap">
            Liddy
          </span>
          {showSubtitle && (
            <p className="text-[10px] text-neutral-500 dark:text-neutral-400 font-mono tracking-wider uppercase font-semibold whitespace-nowrap">
              Daily Financial OS
            </p>
          )}
        </div>
      )}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-2xl transition-transform active:scale-[0.98] text-left block cursor-pointer"
        title="Return to Liddy Home"
      >
        {content}
      </button>
    );
  }

  return content;
};

export default Logo;
