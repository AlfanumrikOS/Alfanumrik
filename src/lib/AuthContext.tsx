'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase, getStudentSnapshot } from './supabase';
import type { Student, StudentSnapshot } from './types';

interface AuthState {
  student: Student | null;
  snapshot: StudentSnapshot | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  isHi: boolean;
  language: string;
  setLanguage: (lang: string) => void;
  refreshStudent: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  student: null,
  snapshot: null,
  isLoggedIn: false,
  isLoading: true,
  isHi: false,
  language: 'en',
  setLanguage: () => {},
  refreshStudent: async () => {},
  refreshSnapshot: async () => {},
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [student, setStudent] = useState<Student | null>(null);
  const [snapshot, setSnapshot] = useState<StudentSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [language, setLanguageState] = useState('en');

  const setLanguage = (lang: string) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem('alfanumrik_language', lang);
    }
  };

  const fetchStudent = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setStudent(null);
      setIsLoading(false);
      return;
    }
    const { data } = await supabase
      .from('students')
      .select('*')
      .eq('auth_user_id', user.id)
      .single();
    if (data) {
      setStudent(data as Student);
      setLanguageState(data.preferred_language ?? 'en');
    }
    setIsLoading(false);
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!student) return;
    const snap = await getStudentSnapshot(student.id);
    if (snap) setSnapshot(snap);
  }, [student]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setStudent(null);
    setSnapshot(null);
  }, []);

  useEffect(() => {
    fetchStudent();
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('alfanumrik_language');
      if (saved) setLanguageState(saved);
    }
  }, [fetchStudent]);

  return (
    <AuthContext.Provider
      value={{
        student,
        snapshot,
        isLoggedIn: !!student,
        isLoading,
        isHi: language === 'hi',
        language,
        setLanguage,
        refreshStudent: fetchStudent,
        refreshSnapshot,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
