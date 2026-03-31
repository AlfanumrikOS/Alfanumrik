'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase, getStudentSnapshot } from './supabase';
import { clearAllCache } from './swr';
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

      // Fallback: try all role tables directly
      if (!rolesResolved) {
        const detectedRoles: UserRole[] = [];
        let detectedPrimary: UserRole = 'none';

        // Check student
        const { data: studentData } = await supabase
          .from('students')
          .select('*')
          .eq('auth_user_id', user.id)
          .single();
        if (studentData) {
          setStudent(studentData as Student);
          detectedRoles.push('student');
          detectedPrimary = 'student';
          setLanguageState(studentData.preferred_language ?? 'en');
        }

        // Check teacher
        const { data: teacherData } = await supabase
          .from('teachers')
          .select('id, name, school_name, subjects_taught, grades_taught, email, phone')
          .eq('auth_user_id', user.id)
          .single();
        if (teacherData) {
          setTeacher(teacherData as TeacherProfile);
          detectedRoles.push('teacher');
          detectedPrimary = 'teacher'; // teacher takes priority
        }

        // Check guardian
        const { data: guardianData } = await supabase
          .from('guardians')
          .select('id, name, email, phone')
          .eq('auth_user_id', user.id)
          .single();
        if (guardianData) {
          setGuardian(guardianData as GuardianProfile);
          detectedRoles.push('guardian');
          if (detectedPrimary === 'none') detectedPrimary = 'guardian';
        }

        if (detectedRoles.length > 0) {
          setRoles(detectedRoles);
          setActiveRoleState(detectedPrimary);
        } else {
          // User is authenticated but has no profile yet.
          // Auto-create profile from auth metadata (handles failed signup inserts).
          const metaRole = user.user_metadata?.role as string | undefined;
          const metaName = user.user_metadata?.name as string || user.email?.split('@')[0] || 'Student';
          const metaGrade = user.user_metadata?.grade as string || '6';
          const metaBoard = user.user_metadata?.board as string || 'CBSE';

          try {
            if (!metaRole || metaRole === 'student') {
              const { data: newStudent } = await supabase.from('students').insert({
                auth_user_id: user.id, name: metaName, email: user.email,
                grade: metaGrade.startsWith('Grade') ? metaGrade : `Grade ${metaGrade}`,
                board: metaBoard, preferred_language: 'en', account_status: 'active',
              }).select('*').single();
              if (newStudent) { setStudent(newStudent as Student); setRoles(['student']); setActiveRoleState('student'); }
            } else if (metaRole === 'teacher') {
              const { data: newTeacher } = await supabase.from('teachers').insert({
                auth_user_id: user.id, name: metaName, email: user.email || '',
              }).select('id, name, school_name, subjects_taught, grades_taught, email, phone').single();
              if (newTeacher) { setTeacher(newTeacher as TeacherProfile); setRoles(['teacher']); setActiveRoleState('teacher'); }
            } else if (metaRole === 'parent') {
              const { data: newGuardian } = await supabase.from('guardians').insert({
                auth_user_id: user.id, name: metaName, email: user.email,
              }).select('id, name, email, phone').single();
              if (newGuardian) { setGuardian(newGuardian as GuardianProfile); setRoles(['guardian']); setActiveRoleState('guardian'); }
            }
          } catch (profileErr) {
            console.warn('Auto-create profile failed:', profileErr);
          }

          // Final fallback if insert also failed
          if (roles.length === 0) {
            const fallbackRole: UserRole = metaRole === 'teacher' ? 'teacher' : metaRole === 'parent' ? 'guardian' : 'student';
            setRoles([fallbackRole]);
            setActiveRoleState(fallbackRole);
          }
        }
      }
    } catch (err) {
      console.error('Auth fetch error:', err);
      // If user was authenticated, ensure they're not stuck as "logged out"
      // Use role from auth metadata if available
      if (hasUser) {
        try {
          const { data: { user: u } } = await supabase.auth.getUser();
          const metaRole = u?.user_metadata?.role as string | undefined;
          const fallbackRole: UserRole = metaRole === 'teacher' ? 'teacher' : metaRole === 'parent' ? 'guardian' : 'student';
          setRoles([fallbackRole]);
          setActiveRoleState(fallbackRole);
        } catch {
          setRoles(['student']);
          setActiveRoleState('student');
        }
      }
    }
    setIsLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount; roles.length is internal state set within this callback
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!student) return;
    const snap = await getStudentSnapshot(student.id);
    if (snap) setSnapshot(snap);
  }, [student]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    // Clear SWR cache to prevent data leakage between accounts on shared devices
    clearAllCache();
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
