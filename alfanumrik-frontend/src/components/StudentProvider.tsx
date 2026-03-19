'use client';
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { Student } from '@/lib/types';
import { getLevelFromXP } from '@/lib/engine';

interface StudentCtx {
  student: Student | null;
  lang: 'en' | 'hi';
  isHi: boolean;
  setLang: (l: 'en' | 'hi') => void;
  addXP: (n: number) => void;
  incrementStreak: () => void;
  login: (name: string, grade: number, board: string, language: string) => void;
  logout: () => void;
  isLoggedIn: boolean;
}

const Ctx = createContext<StudentCtx | null>(null);

export function StudentProvider({ children }: { children: ReactNode }) {
  const [student, setStudent] = useState<Student | null>(() => {
    if (typeof window === 'undefined') return null;
    const s = localStorage.getItem('alf_student');
    return s ? JSON.parse(s) : null;
  });
  const [lang, setLangState] = useState<'en' | 'hi'>(() => {
    if (typeof window === 'undefined') return 'en';
    return (localStorage.getItem('alf_lang') as 'en' | 'hi') || 'en';
  });

  const save = (s: Student) => { localStorage.setItem('alf_student', JSON.stringify(s)); setStudent(s); };

  const setLang = (l: 'en' | 'hi') => { localStorage.setItem('alf_lang', l); setLangState(l); };

  const addXP = useCallback((n: number) => {
    setStudent(prev => {
      if (!prev) return prev;
      const updated = { ...prev, xp: prev.xp + n, level: getLevelFromXP(prev.xp + n) };
      localStorage.setItem('alf_student', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const incrementStreak = useCallback(() => {
    setStudent(prev => {
      if (!prev) return prev;
      const ns = prev.streak + 1;
      const updated = { ...prev, streak: ns, longestStreak: Math.max(ns, prev.longestStreak), lastActiveAt: new Date().toISOString() };
      localStorage.setItem('alf_student', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const login = useCallback((name: string, grade: number, board: string, language: string) => {
    const s: Student = {
      id: crypto.randomUUID(), name, grade, board: board as Student['board'],
      language: language as Student['language'], xp: 0, level: 1, streak: 0,
      longestStreak: 0, lastActiveAt: new Date().toISOString(),
    };
    save(s);
    setLang(language === 'hi' ? 'hi' : 'en');
  }, []);

  const logout = useCallback(() => { localStorage.removeItem('alf_student'); setStudent(null); }, []);

  return (
    <Ctx.Provider value={{ student, lang, isHi: lang === 'hi', setLang, addXP, incrementStreak, login, logout, isLoggedIn: !!student }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStudent() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStudent must be inside StudentProvider');
  return ctx;
}
