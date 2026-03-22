'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase, getStudentSnapshot } from './supabase';
import type { Student, StudentSnapshot } from './types';

/* ─── Role Types ─── */
export type UserRole = 'student' | 'teacher' | 'guardian' | 'none';

interface TeacherProfile {
  id: string;
  name: string;
  school_name?: string;
  subjects_taught?: string[];
  grades_taught?: string[];
}

interface GuardianProfile {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

interface RoleData {
  roles: UserRole[];
  primary_role: UserRole;
  student: { id: string; name: string; grade: string } | null;
  teacher: { id: string; name: string } | null;
  guardian: { id: string; name: string } | null;
}

/* ─── Auth State ─── */
interface AuthState {
  // Current user
  authUserId: string | null;
  student: Student | null;
  snapshot: StudentSnapshot | null;
  teacher: TeacherProfile | null;
  guardian: GuardianProfile | null;

  // Role system
  roles: UserRole[];
  activeRole: UserRole;
  setActiveRole: (role: UserRole) => void;

  // Status
  isLoggedIn: boolean;
  isLoading: boolean;
  isHi: boolean;

  // Language
  language: string;
  setLanguage: (lang: string) => void;

  // Actions
  refreshStudent: () => Promise<void>;
  refreshSnapshot: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  authUserId: null,
  student: null,
  snapshot: null,
  teacher: null,
  guardian: null,
  roles: [],
  activeRole: 'none',
  setActiveRole: () => {},
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
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [snapshot, setSnapshot] = useState<StudentSnapshot | null>(null);
  const [teacher, setTeacher] = useState<TeacherProfile | null>(null);
  const [guardian, setGuardian] = useState<GuardianProfile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [activeRole, setActiveRoleState] = useState<UserRole>('none');
  const [isLoading, setIsLoading] = useState(true);
  const [language, setLanguageState] = useState('en');

  const setLanguage = (lang: string) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem('alfanumrik_language', lang);
    }
  };

  const setActiveRole = (role: UserRole) => {
    setActiveRoleState(role);
    if (typeof window !== 'undefined') {
      localStorage.setItem('alfanumrik_active_role', role);
    }
  };

  const fetchUser = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setAuthUserId(null);
        setStudent(null);
        setTeacher(null);
        setGuardian(null);
        setRoles([]);
        setActiveRoleState('none');
        setIsLoading(false);
        return;
      }
      setAuthUserId(user.id);

      // Detect all roles using RPC
      const { data: roleData } = await supabase.rpc('get_user_role', {
        p_auth_user_id: user.id,
      });

      if (roleData) {
        const rd = roleData as RoleData;
        setRoles(rd.roles || []);

        // Restore saved role or use primary
        const savedRole = typeof window !== 'undefined'
          ? localStorage.getItem('alfanumrik_active_role') as UserRole | null
          : null;
        const effectiveRole = savedRole && rd.roles.includes(savedRole)
          ? savedRole
          : rd.primary_role || 'none';
        setActiveRoleState(effectiveRole);

        // Load student profile if role exists
        if (rd.student) {
          const { data: studentData } = await supabase
            .from('students')
            .select('*')
            .eq('id', rd.student.id)
            .single();
          if (studentData) {
            setStudent(studentData as Student);
            setLanguageState(studentData.preferred_language ?? 'en');
          }
        }

        // Load teacher profile if role exists
        if (rd.teacher) {
          const { data: teacherData } = await supabase
            .from('teachers')
            .select('id, name, school_name, subjects_taught, grades_taught, email, phone')
            .eq('id', rd.teacher.id)
            .single();
          if (teacherData) setTeacher(teacherData as TeacherProfile);
        }

        // Load guardian profile if role exists
        if (rd.guardian) {
          const { data: guardianData } = await supabase
            .from('guardians')
            .select('id, name, email, phone')
            .eq('id', rd.guardian.id)
            .single();
          if (guardianData) setGuardian(guardianData as GuardianProfile);
        }
      } else {
        // Fallback: try student table directly (backward compat)
        const { data: studentData } = await supabase
          .from('students')
          .select('*')
          .eq('auth_user_id', user.id)
          .single();
        if (studentData) {
          setStudent(studentData as Student);
          setRoles(['student']);
          setActiveRoleState('student');
          setLanguageState(studentData.preferred_language ?? 'en');
        }
      }
    } catch (err) {
      console.error('Auth fetch error:', err);
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
    setAuthUserId(null);
    setStudent(null);
    setSnapshot(null);
    setTeacher(null);
    setGuardian(null);
    setRoles([]);
    setActiveRoleState('none');
    if (typeof window !== 'undefined') {
      localStorage.removeItem('alfanumrik_active_role');
      localStorage.removeItem('alfanumrik_guardian');
      localStorage.removeItem('alfanumrik_parent_student');
      localStorage.removeItem('alfanumrik_admin');
      localStorage.removeItem('alfanumrik_subject');
    }
  }, []);

  useEffect(() => {
    fetchUser();
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('alfanumrik_language');
      if (saved) setLanguageState(saved);
    }
  }, [fetchUser]);

  return (
    <AuthContext.Provider
      value={{
        authUserId,
        student,
        snapshot,
        teacher,
        guardian,
        roles,
        activeRole,
        setActiveRole,
        isLoggedIn: roles.length > 0,
        isLoading,
        isHi: language === 'hi',
        language,
        setLanguage,
        refreshStudent: fetchUser,
        refreshSnapshot,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
