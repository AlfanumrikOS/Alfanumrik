'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { createStudent, getStudent, getStudentSnapshot, type DBStudent, type StudentSnapshot } from '@/lib/supabase';
import type { StudentContext, Language, Subject, Difficulty } from '@/lib/types';

interface StudentContextValue {
  student: StudentContext | null;
  snapshot: StudentSnapshot | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  isHi: boolean;
  login: (name: string, grade: number, board: string, language: string, difficulty?: string) => Promise<void>;
  logout: () => void;
  refreshSnapshot: () => Promise<void>;
  setLanguage: (lang: Language) => void;
  setSubject: (subject: Subject) => void;
}

const Ctx = createContext<StudentContextValue>({
  student: null,
  snapshot: null,
  isLoggedIn: false,
  isLoading: true,
  isHi: false,
  login: async () => {},
  logout: () => {},
  refreshSnapshot: async () => {},
  setLanguage: () => {},
  setSubject: () => {},
});

export const useStudent = () => useContext(Ctx);

const STORAGE_KEY = 'alfanumrik_v2_student';

export function StudentProvider({ children }: { children: ReactNode }) {
  const [student, setStudent] = useState<StudentContext | null>(null);
  const [snapshot, setSnapshot] = useState<StudentSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load student from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as StudentContext;
        setStudent(parsed);
        // Fetch fresh data from DB
        if (parsed.id) {
          getStudent(parsed.id).then(dbStudent => {
            if (dbStudent) {
              const updated: StudentContext = {
                ...parsed,
                xpTotal: dbStudent.xp_total,
                xpWeekly: dbStudent.xp_weekly,
                streakDays: dbStudent.streak_days,
                streakBest: dbStudent.streak_best,
              };
              setStudent(updated);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
            }
          });
        }
      }
    } catch (e) {
      console.warn('Failed to load student:', e);
    }
    setIsLoading(false);
  }, []);

  // Login — creates student in Supabase
  const login = useCallback(async (name: string, grade: number, board: string, language: string, difficulty?: string) => {
    setIsLoading(true);
    try {
      // Create in Supabase
      const dbStudent = await createStudent({
        name,
        grade,
        board,
        language,
        difficulty: difficulty || 'normal',
      });

      const ctx: StudentContext = {
        id: dbStudent?.id || crypto.randomUUID(),
        name,
        grade,
        board,
        language: language as Language,
        subject: 'math' as Subject,
        difficulty: (difficulty || 'normal') as Difficulty,
        xpTotal: 0,
        xpWeekly: 0,
        streakDays: 0,
        streakBest: 0,
        isLoggedIn: true,
      };

      setStudent(ctx);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
    } catch (err) {
      console.error('Login failed:', err);
      // Create offline-only student
      const ctx: StudentContext = {
        id: crypto.randomUUID(),
        name,
        grade,
        board,
        language: language as Language,
        subject: 'math' as Subject,
        difficulty: (difficulty || 'normal') as Difficulty,
        xpTotal: 0,
        xpWeekly: 0,
        streakDays: 0,
        streakBest: 0,
        isLoggedIn: true,
      };
      setStudent(ctx);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
    }
    setIsLoading(false);
  }, []);

  const logout = useCallback(() => {
    setStudent(null);
    setSnapshot(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!student?.id) return;
    const snap = await getStudentSnapshot(student.id);
    if (snap) {
      setSnapshot(snap);
      // Sync XP/streak from snapshot
      const updated = {
        ...student,
        xpTotal: snap.student.xp_total,
        xpWeekly: snap.student.xp_weekly,
        streakDays: snap.student.streak_days,
        streakBest: snap.student.streak_best,
      };
      setStudent(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
  }, [student]);

  const setLanguage = useCallback((lang: Language) => {
    if (!student) return;
    const updated = { ...student, language: lang };
    setStudent(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, [student]);

  const setSubject = useCallback((subject: Subject) => {
    if (!student) return;
    const updated = { ...student, subject };
    setStudent(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, [student]);

  return (
    <Ctx.Provider value={{
      student,
      snapshot,
      isLoggedIn: !!student?.isLoggedIn,
      isLoading,
      isHi: student?.language === 'hi',
      login,
      logout,
      refreshSnapshot,
      setLanguage,
      setSubject,
    }}>
      {children}
    </Ctx.Provider>
  );
}
