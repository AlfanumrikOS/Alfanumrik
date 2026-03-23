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
    // SECURITY: Only allow switching to roles the server has verified.
    // This prevents localStorage injection attacks where a student
    // sets themselves as 'teacher' via DevTools.
    if (role !== 'none' && roles.length > 0 && !roles.includes(role)) {
      console.warn(`[Auth] Blocked role switch to "${role}" — not in verified roles:`, roles);
      return;
    }
    setActiveRoleState(role);
    if (typeof window !== 'undefined') {
      localStorage.setItem('alfanumrik_active_role', role);
    }
  };

  const fetchUser = useCallback(async () => {
    let hasUser = false;
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
      hasUser = true;
      setAuthUserId(user.id);

      // Detect all roles using RPC
      let rolesResolved = false;
      try {
        const { data: roleData } = await supabase.rpc('get_user_role', {
          p_auth_user_id: user.id,
        });

        if (roleData) {
          const rd = roleData as RoleData;
          setRoles(rd.roles || []);
          rolesResolved = (rd.roles || []).length > 0;

          // Restore saved role — ONLY if it's in the server-verified role list.
          // This prevents the attack where someone manually writes
          // localStorage.setItem('alfanumrik_active_role', 'teacher')
          const savedRole = typeof window !== 'undefined'
            ? localStorage.getItem('alfanumrik_active_role') as UserRole | null
            : null;
          const serverRoles = rd.roles || [];
          const effectiveRole = savedRole && serverRoles.includes(savedRole)
            ? savedRole
            : rd.primary_role || 'student';

          // If saved role was invalid, clean it from localStorage
          if (savedRole && !serverRoles.includes(savedRole)) {
            console.warn(`[Auth] Cleared invalid saved role "${savedRole}". Verified roles:`, serverRoles);
            localStorage.removeItem('alfanumrik_active_role');
          }

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
        }
      } catch (rpcErr) {
        console.warn('get_user_role RPC failed, using fallback:', rpcErr);
      }

      // Fallback: try student table directly
      if (!rolesResolved) {
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
        } else {
          // User is authenticated but has no profile yet (new signup).
          // Set minimum viable state so isLoggedIn becomes true.
          setRoles(['student']);
          setActiveRoleState('student');
        }
      }
    } catch (err) {
      console.error('Auth fetch error:', err);
      // If user was authenticated, ensure they're not stuck as "logged out"
      if (hasUser) {
        setRoles(['student']);
        setActiveRoleState('student');
      }
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
    let cancelled = false;

    const init = async () => {
      await fetchUser();
      if (!cancelled && typeof window !== 'undefined') {
        const saved = localStorage.getItem('alfanumrik_language');
        if (saved) setLanguageState(saved);
      }
    };

    init();

    // Listen for auth state changes (token refresh, sign-out from another tab)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setAuthUserId(null);
        setStudent(null);
        setSnapshot(null);
        setTeacher(null);
        setGuardian(null);
        setRoles([]);
        setActiveRoleState('none');
      } else if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        fetchUser();
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
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
        isLoggedIn: roles.length > 0 || !!authUserId,
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
