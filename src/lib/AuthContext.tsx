'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase, getStudentSnapshot } from './supabase';
import { clearAllCache } from './swr';
import type { Student, StudentSnapshot } from './types';

/* ─── Role Types ─── */
// Note: 'guardian' is the DB role name; maps to 'parent' via ROLE_ALIASES in identity/constants.ts
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
  isDemoUser: boolean;

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
  isDemoUser: false,
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
  const [hasProfile, setHasProfile] = useState(false);
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
        setHasProfile(false);
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
              setHasProfile(true);
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
            if (teacherData) {
              setTeacher(teacherData as TeacherProfile);
              setHasProfile(true);
            }
          }

          // Load guardian profile if role exists
          if (rd.guardian) {
            const { data: guardianData } = await supabase
              .from('guardians')
              .select('id, name, email, phone')
              .eq('id', rd.guardian.id)
              .single();
            if (guardianData) {
              setGuardian(guardianData as GuardianProfile);
              setHasProfile(true);
            }
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
          setHasProfile(true);
        } else {
          // User is authenticated but has no profile yet.
          // Call server bootstrap to create profile from auth metadata.
          const metaRole = user.user_metadata?.role as string | undefined;
          const metaName = user.user_metadata?.name as string || user.email?.split('@')[0] || 'Student';
          const metaGrade = user.user_metadata?.grade as string || '9';
          const metaBoard = user.user_metadata?.board as string || 'CBSE';

          try {
            const bootstrapRes = await fetch('/api/auth/bootstrap', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                role: metaRole === 'teacher' ? 'teacher' : metaRole === 'parent' ? 'parent' : 'student',
                name: metaName,
                grade: metaGrade,
                board: metaBoard,
              }),
            });

            if (bootstrapRes.ok) {
              // Re-fetch to get the newly created profile
              const { data: newStudentData } = await supabase
                .from('students')
                .select('*')
                .eq('auth_user_id', user.id)
                .single();
              if (newStudentData) {
                setStudent(newStudentData as Student);
                setRoles(['student']);
                setActiveRoleState('student');
                setHasProfile(true);
              } else {
                // Check teacher/guardian
                const { data: newTeacherData } = await supabase
                  .from('teachers')
                  .select('id, name, school_name, subjects_taught, grades_taught, email, phone')
                  .eq('auth_user_id', user.id)
                  .single();
                if (newTeacherData) {
                  setTeacher(newTeacherData as TeacherProfile);
                  setRoles(['teacher']);
                  setActiveRoleState('teacher');
                  setHasProfile(true);
                } else {
                  const { data: newGuardianData } = await supabase
                    .from('guardians')
                    .select('id, name, email, phone')
                    .eq('auth_user_id', user.id)
                    .single();
                  if (newGuardianData) {
                    setGuardian(newGuardianData as GuardianProfile);
                    setRoles(['guardian']);
                    setActiveRoleState('guardian');
                    setHasProfile(true);
                  }
                }
              }
            }
          } catch (bootstrapErr) {
            console.warn('[Auth] Server bootstrap failed:', bootstrapErr);
          }

          // No final fallback — if no profile was created, hasProfile stays false
          // and isLoggedIn will be false, redirecting user to login
        }
      }
    } catch (err) {
      console.error('Auth fetch error:', err);
      // Don't set fallback roles without a real profile — this caused redirect loops.
      // hasProfile stays false, isLoggedIn will be false, user redirected to login.
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
    setHasProfile(false);
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
        setHasProfile(false);
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
        isLoggedIn: hasProfile,
        isLoading,
        isHi: language === 'hi',
        isDemoUser: student?.account_status === 'demo',
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
