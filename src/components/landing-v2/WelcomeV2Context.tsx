'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Local provider for the v2 landing page.
 * Owns: language toggle (en/hi), theme toggle (light/dark), role switcher (parent/student/teacher/school).
 * This is intentionally self-contained — the rest of the app uses AuthContext.isHi,
 * but the welcome page is anonymous so we use a lighter-weight provider here.
 */

export type Role = 'parent' | 'student' | 'teacher' | 'school';
export type Lang = 'en' | 'hi';
export type Theme = 'light' | 'dark';

interface WelcomeV2State {
  isHi: boolean;
  lang: Lang;
  toggleLang: () => void;
  theme: Theme | null; // null = follow system
  toggleTheme: () => void;
  role: Role;
  setRole: (r: Role) => void;
  t: (en: string, hi: string) => string;
}

const Ctx = createContext<WelcomeV2State>({
  isHi: false,
  lang: 'en',
  toggleLang: () => {},
  theme: null,
  toggleTheme: () => {},
  role: 'parent',
  setRole: () => {},
  t: (en) => en,
});

export function useWelcomeV2() {
  return useContext(Ctx);
}

const LANG_KEY = 'alf-welcome-lang';
const THEME_KEY = 'alfanumrik-theme';
const ROLE_KEY = 'alf-welcome-role';

export function WelcomeV2Provider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('en');
  const [theme, setTheme] = useState<Theme | null>(null);
  const [role, setRoleState] = useState<Role>('parent');

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const storedLang = localStorage.getItem(LANG_KEY);
      if (storedLang === 'hi' || storedLang === 'en') setLang(storedLang);
      const storedTheme = localStorage.getItem(THEME_KEY);
      if (storedTheme === 'light' || storedTheme === 'dark') setTheme(storedTheme);
      const storedRole = localStorage.getItem(ROLE_KEY);
      if (
        storedRole === 'parent' ||
        storedRole === 'student' ||
        storedRole === 'teacher' ||
        storedRole === 'school'
      ) {
        setRoleState(storedRole);
      }
    } catch {
      /* localStorage unavailable — fall through */
    }
  }, []);

  const toggleLang = () => {
    setLang((prev) => {
      const next = prev === 'en' ? 'hi' : 'en';
      try { localStorage.setItem(LANG_KEY, next); } catch { /* noop */ }
      return next;
    });
  };

  const toggleTheme = () => {
    setTheme((prev) => {
      // Determine current effective theme
      const sysDark =
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      const currentEffective = prev ?? (sysDark ? 'dark' : 'light');
      const next: Theme = currentEffective === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, next); } catch { /* noop */ }
      return next;
    });
  };

  const setRole = (r: Role) => {
    setRoleState(r);
    try { localStorage.setItem(ROLE_KEY, r); } catch { /* noop */ }
  };

  const value = useMemo<WelcomeV2State>(() => ({
    isHi: lang === 'hi',
    lang,
    toggleLang,
    theme,
    toggleTheme,
    role,
    setRole,
    t: (en: string, hi: string) => (lang === 'hi' ? hi : en),
  }), [lang, theme, role]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
