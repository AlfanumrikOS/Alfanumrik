'use client';

import { useState, useEffect, createContext, useContext, type ReactNode } from 'react';

/**
 * Lightweight bilingual context for the landing page.
 * Uses localStorage to persist language preference.
 * Does NOT require authentication.
 */

interface LangContextType {
  isHi: boolean;
  toggle: () => void;
  t: (en: string, hi: string) => string;
}

const LangContext = createContext<LangContextType>({
  isHi: false,
  toggle: () => {},
  t: (en) => en,
});

export function useLang() {
  return useContext(LangContext);
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [isHi, setIsHi] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('alfanumrik_language');
    if (saved === 'hi') setIsHi(true);
  }, []);

  const toggle = () => {
    setIsHi(prev => {
      const next = !prev;
      localStorage.setItem('alfanumrik_language', next ? 'hi' : 'en');
      return next;
    });
  };

  const t = (en: string, hi: string) => isHi ? hi : en;

  return (
    <LangContext.Provider value={{ isHi, toggle, t }}>
      {children}
    </LangContext.Provider>
  );
}

/** Language toggle pill for the navbar */
export function LangToggle() {
  const { isHi, toggle } = useLang();
  return (
    <button
      onClick={toggle}
      className="flex items-center rounded-full text-[11px] font-bold overflow-hidden"
      style={{ border: '1.5px solid var(--border)', background: 'var(--surface-1)' }}
      aria-label={isHi ? 'Switch to English' : 'हिन्दी में बदलें'}
    >
      <span
        className="px-2.5 py-1 transition-all"
        style={{
          background: !isHi ? 'var(--orange)' : 'transparent',
          color: !isHi ? '#fff' : 'var(--text-3)',
        }}
      >
        EN
      </span>
      <span
        className="px-2.5 py-1 transition-all"
        style={{
          background: isHi ? 'var(--orange)' : 'transparent',
          color: isHi ? '#fff' : 'var(--text-3)',
        }}
      >
        हिन्दी
      </span>
    </button>
  );
}
