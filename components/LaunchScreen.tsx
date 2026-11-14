import React, { useEffect, useState } from 'react';

interface LaunchScreenProps {
  onComplete: () => void;
}

export const LaunchScreen: React.FC<LaunchScreenProps> = ({ onComplete }) => {
  const [phase, setPhase] = useState<'enter' | 'reveal' | 'zoomOut'>('enter');

  useEffect(() => {
    const timer1 = setTimeout(() => {
      setPhase('reveal');
    }, 320);

    const timer2 = setTimeout(() => {
      setPhase('zoomOut');
    }, 780);

    const timer3 = setTimeout(() => {
      onComplete();
    }, 1050);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [onComplete]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-neutral-950 text-white select-none overflow-hidden transition-all duration-300 ease-out ${
        phase === 'zoomOut'
          ? 'opacity-0 scale-105 blur-xs pointer-events-none'
          : 'opacity-100 scale-100'
      }`}
    >
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] bg-gradient-to-tr from-indigo-600/20 via-sky-500/15 to-emerald-500/20 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-sm">
        <div
          className={`relative mb-6 flex items-center justify-center transition-all duration-400 ease-out ${
            phase === 'enter' ? 'scale-90 opacity-70' : 'scale-100 opacity-100'
          }`}
        >
          <div className="relative w-20 h-20 rounded-3xl bg-neutral-900 border border-neutral-700/80 shadow-2xl flex items-center justify-center overflow-hidden">
            <svg className="w-12 h-12" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="launch_g1" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#38BDF8" />
                  <stop offset="50%" stopColor="#6366F1" />
                  <stop offset="100%" stopColor="#10B981" />
                </linearGradient>
              </defs>
              <path
                d="M50 10 L85 30 L85 70 L50 90 L15 70 L15 30 Z"
                stroke="url(#launch_g1)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M36 28 L36 72 L64 72"
                stroke="#FFFFFF"
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="64" cy="50" r="4.5" fill="#38BDF8" />
            </svg>
          </div>
        </div>

        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white mb-1.5 font-sans">
          LIDDY
        </h1>

        <div
          className={`transition-all duration-400 ease-out ${
            phase === 'enter' ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
          }`}
        >
          <p className="text-xs font-semibold text-neutral-300 tracking-wide font-sans">
            Daily Finance, Investments &amp; Billing Companion
          </p>
        </div>
      </div>
    </div>
  );
};
