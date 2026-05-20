'use client';

/**
 * ⚠️ CRITICAL AUTH PATH
 * This file is part of the core authentication system.
 * Changes here WILL break login/signup/verify/reset for ALL users.
 *
 * Before modifying:
 * 1. Run: npm run test -- --grep "auth"
 * 2. Run: node scripts/auth-guard.js
 * 3. Test ALL flows manually: signup, login, verify email, reset password, logout
 * 4. Verify on Chrome: /login renders, /dashboard redirects to /login when unauthenticated
 *
 * DO NOT: create middleware.ts, add client-side profile inserts, remove role tabs
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { supabase, getStudentSnapshot } from './supabase';
import { clearAllCache } from './swr';
import { clearAtlasFlagCache } from './use-atlas-flag';
import { track } from './analytics';
import { identify as posthogIdentify, reset as posthogReset } from './posthog/client';
import type { Student, StudentSnapshot } from './types';

/* ─── Role Types ─── */
export type UserRole = 'student' | 'teacher' | 'guardian' | 'institution_admin' | 'none';

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

/* ─── Theme Type ─── */
export type ThemePreference = 'light' | 'dark' | 'system';

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

  // Theme
  theme: ThemePreference;
  toggleTheme: () => void;

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
  theme: 'system',
  toggleTheme: () => {},
  refreshStudent: async () => {},
  refreshSnapshot: async () => {},
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

/** Resolve a ThemePreference into the concrete theme to apply.
 *
 *  REVERSED 2026-05-11: dark mode shipped (PRs #705, #706) caused severe
 *  legibility regressions in admin surfaces (super-admin Control Room
 *  was effectively unreadable). The CEO directive is to ship a single
 *  light theme across the entire product — students, parents, teachers,
 *  school admins, super admins. Until each `dark:` Tailwind variant and
 *  legacy `[data-theme="dark"]` CSS block has been excised from the
 *  codebase, this function returns 'light' unconditionally and the
 *  toggle is hidden from the UI. The ThemePreference type and the
 *  toggleTheme contract stay intact so consumers don't need refactor.
 *  When the dead code cleanup happens, this function can be removed. */
function resolveTheme(_pref: ThemePreference): 'light' | 'dark' {
  return 'light';
}

/** Apply theme preference to document.documentElement via data-theme attribute.
 *  Always writes 'light' (see resolveTheme rationale above). Kept as a
 *  function rather than inlined so future re-enablement of dark mode is
 *  a single-file change. */
function applyThemeToDOM(_pref: ThemePreference) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', 'light');
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
  // Theme is light-only across the product (see resolveTheme rationale).
  // Initial state pinned to 'light'; the bootstrap effect below no longer
  // consults localStorage.alfanumrik_theme.
  const [theme, setThemeState] = useState<ThemePreference>('light');

  const setLanguage = (lang: string) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem('alfanumrik_language', lang);
    }
  };

  // Theme toggle is a no-op until dark mode is restored. Kept for backwards
  // compatibility with consumers that still call it; renders nothing visible.
  const toggleTheme = useCallback(() => {
    // Intentionally empty. Light-only across the product (see resolveTheme).
  }, []);

  // Apply light theme exactly once on mount. No system listener, no localStorage.
  // Previously a system-theme listener flipped dark/light live based on OS pref;
  // that behavior is suspended along with the rest of the dark-mode surface.
  useEffect(() => {
    applyThemeToDOM('light');
  }, []);

  // Guard against recursive fetchUser calls after bootstrap.
  // Reset to false on each fresh fetchUser invocation; set to true after bootstrap attempt.
  const bootstrapAttemptedRef = useRef(false);

  // B11: Use useCallback + roles dependency to prevent stale closure.
  // Without useCallback, event handlers that captured a previous version of
  // setActiveRole would validate against an outdated roles array.
  const setActiveRole = useCallback((role: UserRole) => {
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
  }, [roles]);

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

        // Check school_admin (institution_admin role).
        // The baseline `get_user_role` RPC only inspects students/teachers/
        // guardians — school_admins are invisible to it. So a school admin
        // whose RPC call succeeded with `roles: []` falls through to this
        // fallback block, and without this check would end up with
        // activeRole='none' and hang on /dashboard. We don't expose a
        // separate schoolAdmin profile in AuthContext — the school-admin
        // page (src/app/school-admin/page.tsx) re-queries the row itself.
        // All we need from here is the role so routing works.
        const { data: schoolAdminData } = await supabase
          .from('school_admins')
          .select('id, school_id')
          .eq('auth_user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();
        if (schoolAdminData) {
          detectedRoles.push('institution_admin');
          if (detectedPrimary === 'none') detectedPrimary = 'institution_admin';
        }

        if (detectedRoles.length > 0) {
          setRoles(detectedRoles);
          setActiveRoleState(detectedPrimary);
        } else if (!bootstrapAttemptedRef.current) {
          // User is authenticated but has no profile yet.
          // B10: Route through /api/auth/bootstrap (server-side, admin client, idempotent)
          // instead of inserting directly via browser client (which bypasses RLS, triggers,
          // and onboarding_state creation).
          // Guard: only attempt bootstrap once to prevent infinite recursion if
          // bootstrap succeeds but the subsequent profile query still fails.
          bootstrapAttemptedRef.current = true;
          const metaRole = user.user_metadata?.role as string | undefined;
          const metaName = user.user_metadata?.name as string || user.email?.split('@')[0] || 'Student';
          const metaGrade = user.user_metadata?.grade as string || '6';
          const metaBoard = user.user_metadata?.board as string || 'CBSE';

          let bootstrapSucceeded = false;
          try {
            let parsedSubjects: string[] | null = null;
            let parsedGrades: string[] | null = null;
            try {
              if (user.user_metadata?.subjects_taught) parsedSubjects = JSON.parse(user.user_metadata.subjects_taught);
              if (user.user_metadata?.grades_taught) parsedGrades = JSON.parse(user.user_metadata.grades_taught);
            } catch { /* malformed JSON */ }

            const payload: Record<string, unknown> = {
              role: metaRole || 'student',
              name: metaName,
              grade: metaGrade,
              board: metaBoard,
            };
            if (metaRole === 'teacher') {
              payload.school_name = user.user_metadata?.school_name || null;
              payload.subjects_taught = parsedSubjects;
              payload.grades_taught = parsedGrades;
            }

            const res = await fetch('/api/auth/bootstrap', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            if (res.ok) {
              bootstrapSucceeded = true;
              // Analytics: F16 — see audit 2026-04-27.
              // Bootstrap is the first successful server-side write of a profile,
              // gated by Redis idempotency lock — fires exactly once per new user.
              try {
                const role: 'student' | 'teacher' | 'parent' | 'guardian' =
                  metaRole === 'teacher' ? 'teacher'
                    : metaRole === 'parent' || metaRole === 'guardian' ? 'guardian'
                    : 'student';
                track('signup_complete', { role, method: 'email' });
              } catch { /* analytics is non-critical */ }
              // Re-run fetchUser ONE MORE TIME to pick up newly created profile.
              // bootstrapAttemptedRef.current is already true, so the recursive call
              // will skip this bootstrap block — preventing infinite recursion.
              await fetchUser();
              return; // fetchUser will set all state; don't double-set below
            }
          } catch (bootstrapErr) {
            console.warn('[Auth] Bootstrap via API failed, using direct insert fallback:', bootstrapErr);
          }

          // If bootstrap failed, set role from metadata so UI shows something
          // (user will be prompted to retry on next page load)
          if (!bootstrapSucceeded) {
            console.warn('[Auth] Bootstrap API unreachable — will retry on next load');
            const fallbackRole: UserRole = metaRole === 'teacher' ? 'teacher'
              : (metaRole === 'parent' || metaRole === 'guardian') ? 'guardian'
              : 'student';
            setRoles([fallbackRole]);
            setActiveRoleState(fallbackRole);
          }
        } else {
          // Bootstrap was already attempted but profile still not found.
          // Fall through to metadata-based fallback to avoid infinite loop.
          const metaRole = user.user_metadata?.role as string | undefined;
          console.warn('[Auth] Profile not found after bootstrap — using metadata fallback');
          const fallbackRole: UserRole = metaRole === 'teacher' ? 'teacher'
            : (metaRole === 'parent' || metaRole === 'guardian') ? 'guardian'
            : 'student';
          setRoles([fallbackRole]);
          setActiveRoleState(fallbackRole);
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
          // Don't assume student role if we can't verify anything
          setRoles([]);
          setActiveRoleState('none');
        }
      }
    }
    setIsLoading(false);
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!student) return;
    const snap = await getStudentSnapshot(student.id);
    if (snap) setSnapshot(snap);
  }, [student]);

  // ── PostHog identify on auth + language change (Marking-Authenticity Wave 2) ──
  // Fires on:
  //  - SIGNED_IN / initial session load (when authUserId resolves)
  //  - Profile load (so grade/board/plan land on the person profile)
  //  - Language toggle (so the preferred_language person property updates live)
  // Reset is handled in signOut() below.
  //
  // Allowlist enforced inside posthogIdentify() — only fields in
  // PERSON_PROPERTY_ALLOWLIST (grade, board, plan, preferred_language,
  // signup_date) make it onto the person profile. P13: NEVER include
  // email, full_name, phone, parent_phone — and the wrapper drops them
  // even if a future edit accidentally passes them.
  useEffect(() => {
    if (!authUserId) return;
    try {
      // We re-read the auth user (already cached by Supabase) to pull
      // created_at without threading it through provider state.
      void supabase.auth.getUser().then(({ data }) => {
        const signupDate = data?.user?.created_at?.split('T')[0];
        posthogIdentify(authUserId, {
          grade: student?.grade,
          board: student?.board ?? undefined,
          plan: student?.subscription_plan ?? 'free',
          preferred_language: language === 'hi' ? 'hi' : 'en',
          signup_date: signupDate,
        });
      });
    } catch {
      // Non-fatal — analytics never breaks auth.
    }
  }, [authUserId, student?.grade, student?.board, student?.subscription_plan, language]);

  const signOut = useCallback(async () => {
    // Deregister device session
    try {
      await fetch('/api/auth/session', { method: 'DELETE' });
    } catch { /* best-effort */ }
    await supabase.auth.signOut();
    // Reset bootstrap guard so a new sign-in can trigger bootstrap if needed
    bootstrapAttemptedRef.current = false;
    // Clear SWR cache to prevent data leakage between accounts on shared devices
    clearAllCache();
    // Clear Editorial Atlas flag cache so the next signin doesn't render
    // with a previous user's flag state on first paint.
    clearAtlasFlagCache();
    // Reset PostHog distinct_id so the next signin starts a fresh identified
    // session — without this, the next user inherits the previous user's
    // cohort attribution. See P13.
    try { posthogReset(); } catch { /* analytics never breaks signout */ }
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

        // Dark mode REVERSED 2026-05-11 — see resolveTheme rationale. Ignore
        // any saved theme preference and force light on bootstrap. Leftover
        // localStorage.alfanumrik_theme values are harmless; we just stop
        // reading them. A future cleanup can localStorage.removeItem() it.
        applyThemeToDOM('light');
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
        bootstrapAttemptedRef.current = false;
        // P13: clear PostHog identity on cross-tab signout too.
        try { posthogReset(); } catch { /* never throw from analytics */ }
      } else if (event === 'TOKEN_REFRESHED') {
        fetchUser();
      } else if (event === 'SIGNED_IN') {
        // ⚠️ CRITICAL: Set isLoading=true BEFORE fetchUser to prevent race condition.
        // Without this, pages like /dashboard see isLoading=false + isLoggedIn=false
        // during the gap between SIGNED_IN and fetchUser completion, and redirect to /.
        setIsLoading(true);
        // Allow bootstrap for the new sign-in session
        bootstrapAttemptedRef.current = false;
        // Register device session for 2-device limit enforcement
        fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_label: navigator.userAgent }),
        }).catch((err: unknown) => {
          console.warn('[auth-session] session POST failed:', err instanceof Error ? err.message : String(err));
        }); // Best-effort, non-blocking
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
        // B7: isLoggedIn requires a verified profile, not just an auth token.
        // An auth user with no profile rows is NOT considered logged in — this
        // prevents profileless users from reaching protected routes.
        isLoggedIn: roles.length > 0,
        isLoading,
        isHi: language === 'hi',
        isDemoUser: false,
        language,
        setLanguage,
        theme,
        toggleTheme,
        refreshStudent: fetchUser,
        refreshSnapshot,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
