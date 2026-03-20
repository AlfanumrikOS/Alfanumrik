'use client';
import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Student, LearningSnapshot, Language } from '@/lib/types';

interface AuthCtx {
  session: Session | null;
  user: User | null;
  student: Student | null;
  snapshot: LearningSnapshot | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  isHi: boolean;
  language: Language;
  setLanguage: (l: Language) => void;
  refreshStudent: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  session: null, user: null, student: null, snapshot: null,
  isLoading: true, isLoggedIn: false, isHi: false, language: 'en',
  setLanguage: () => {}, refreshStudent: async () => {}, refreshSnapshot: async () => {}, signOut: async () => {},
});

export const useAuth = () => useContext(Ctx);

// convenience aliases
export const useStudent = () => {
  const ctx = useAuth();
  return { ...ctx, isHi: ctx.isHi, isLoggedIn: ctx.isLoggedIn };
};

const LANG_KEY = 'alfanumrik_language';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser]     = useState<User | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [snapshot, setSnapshot] = useState<LearningSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [language, setLangState] = useState<Language>('en');

  const setLanguage = useCallback((l: Language) => {
    setLangState(l);
    localStorage.setItem(LANG_KEY, l);
    if (student) {
      supabase.from('students').update({ preferred_language: l }).eq('id', student.id);
    }
  }, [student]);

  const loadStudent = useCallback(async (authUser: User) => {
    const { data } = await supabase
      .from('students')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .single();
    if (data) {
      setStudent(data as Student);
      const storedLang = localStorage.getItem(LANG_KEY) as Language | null;
      setLangState(storedLang ?? (data as Student).preferred_language ?? 'en');
    }
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!student) return;
    const { data } = await supabase.rpc('get_learning_snapshot' as any, { p_student_id: student.id } as any);
    if (data?.[0]) setSnapshot(data[0] as LearningSnapshot);
  }, [student]);

  const refreshStudent = useCallback(async () => {
    if (!user) return;
    await loadStudent(user);
  }, [user, loadStudent]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null); setUser(null); setStudent(null); setSnapshot(null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) loadStudent(data.session.user).finally(() => setIsLoading(false));
      else setIsLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (sess?.user) loadStudent(sess.user);
      else { setStudent(null); setSnapshot(null); }
    });
    return () => subscription.unsubscribe();
  }, [loadStudent]);

  useEffect(() => {
    if (student) refreshSnapshot();
  }, [student?.id]); // eslint-disable-line

  const isHi = language === 'hi' || language === 'hinglish';

  return (
    <Ctx.Provider value={{ session, user, student, snapshot, isLoading,
      isLoggedIn: !!student?.onboarding_completed, isHi, language, setLanguage,
      refreshStudent, refreshSnapshot, signOut }}>
      {children}
    </Ctx.Provider>
  );
}
