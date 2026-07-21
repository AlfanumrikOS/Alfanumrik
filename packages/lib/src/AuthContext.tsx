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
import { normalizeGrade } from './identity/constants';
import { clearAllCache } from './swr';
import { clearAtlasFlagCache } from './use-atlas-flag';
import { track } from './analytics';
import { identify as posthogIdentify, reset as posthogReset } from './posthog/client';
import { redeemPendingInvite, clearPendingInvite } from './school/pending-invite';
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
  // onboarding_completed is carried in the get_user_role RPC payload
  // (migration 20260610090000, COALESCE(...,false)). It is the authoritative
  // signal for the dashboard's `student && !student.onboarding_completed`
  // redirect, so it must survive into the fallback student built below when
  // the secondary full-row read returns 0 rows.
  student: { id: string; name: string; grade: string; onboarding_completed: boolean | null } | null;
  teacher: { id: string; name: string } | null;
  guardian: { id: string; name: string } | null;
}

/* ─── Theme Type ─── */
//  'light' / 'dark' / 'system' are the legacy preferences. 'hc' (high-contrast)
//  is added for the cosmic redesign's visibility requirement — see
//  src/lib/cosmic-theme.tsx. When ff_cosmic_redesign_v1 is OFF the theme is
//  force-light (legacy behavior); when ON, CosmicThemeProvider owns the
//  resolved data-theme and these three cosmic values become meaningful.
export type ThemePreference = 'light' | 'dark' | 'hc' | 'system';

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
 *
 *  Cosmic redesign (2026-06-05): the behavior now forks on
 *  `ff_cosmic_redesign_v1`:
 *
 *    FLAG OFF (default / production today): unconditionally write
 *      data-theme="light" — identical to the force-light behavior shipped
 *      2026-05-11. The app is pixel-identical to today.
 *
 *    FLAG ON: DO NOT write data-theme here. The cosmic theme runtime
 *      (CosmicThemeProvider) owns data-design / data-theme / data-role and
 *      honors the user's CosmicThemePreference ('dark' default | 'light' |
 *      'hc'). Writing 'light' here would clobber that, so we defer entirely.
 *
 *  Kept as a function (not inlined) so the fork stays in one place. */
function applyThemeToDOM(pref: ThemePreference) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.removeAttribute('data-design');
  html.removeAttribute('data-role');
  html.setAttribute('data-theme', 'light');
  void pref;
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
  // Reset to false on each fresh fetchUser invocation; set to true after 3 consecutive
  // bootstrap failures (not after the first failure) to handle transient DB errors.
  const bootstrapAttemptedRef = useRef(false);
  const bootstrapRetryCountRef = useRef(0);
  const MAX_BOOTSTRAP_RETRIES = 3;

  // P15 (school invite-code redemption): guard so the pending-invite POST to
  // /api/schools/join fires at most once per signed-in session. A transient
  // failure does NOT set this (the code stays in localStorage and the next
  // load retries); a definitive verdict clears the code AND sets this ref.
  const inviteRedeemedRef = useRef(false);

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
    // Hard timeout — if any await stalls (network, RLS hang, Supabase outage)
    // we fail open to a logged-out state so /dashboard's existing redirect
    // takes the user to /login rather than spinning forever on a skeleton.
    // 12s is fast enough that the user isn't stuck, generous enough that a
    // slow connection still completes normally.
    const TIMEOUT_MS = 12_000;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<void>((resolve) => {
      timeoutId = setTimeout(() => {
        console.warn(`[AuthContext] fetchUser exceeded ${TIMEOUT_MS}ms — failing open`);
        setStudent(null);
        setTeacher(null);
        setGuardian(null);
        setRoles([]);
        setActiveRoleState('none');
        setIsLoading(false);
        resolve();
      }, TIMEOUT_MS);
    });

    const work = (async () => {
      let hasUser = false;
      try {
        // getSession() is fast when the token is fresh (localStorage read, ~0 ms).
        // When the token is expired it makes a network call for refresh which can
        // stall. We race it against a 4 s timeout as a safety net: if it hasn't
        // returned in 4 s, we treat the user as not logged in and return early —
        // the auth event system (SIGNED_IN / TOKEN_REFRESHED) will re-trigger
        // fetchUser once the session resolves, recovering automatically.
        const sessionUser = await Promise.race([
          supabase.auth.getSession().then((r) => r.data.session?.user ?? null),
          new Promise<null>((resolve) => { setTimeout(() => resolve(null), 4_000); }),
        ]);
        const user = sessionUser;
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
          // Hard 5 s abort on the RPC. If the Supabase connection stalls, the
          // AbortError falls to catch(rpcErr) → rolesResolved stays false →
          // the parallel fallback block fires instead of blocking until the
          // outer 12 s timer fires and logs the user out entirely.
          const rpcAC = new AbortController();
          const rpcAbortTimer = setTimeout(() => rpcAC.abort(), 5_000);
          let roleData: unknown = null;
          try {
            const result = await supabase
              .rpc('get_user_role', { p_auth_user_id: user.id })
              .abortSignal(rpcAC.signal);
            roleData = result.data;
          } finally {
            clearTimeout(rpcAbortTimer);
          }

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
              // P15-critical: this secondary read MUST use maybeSingle(), not
              // single(). single() rejects with PGRST116 when 0 rows come back,
              // and a 0-row result here is a RECOVERABLE edge — a transient
              // client-RLS / auth.uid() skew on the PostgREST call, replica lag
              // immediately after signup, etc. — NOT proof the student is gone.
              // The throw would abort this whole branch, and because the
              // parallel rescue block below is guarded by `if (!rolesResolved)`
              // (rolesResolved is already true here), the student would be left
              // permanently null while isLoggedIn stays true → the dashboard
              // skeletons forever. We therefore never let a resolved student
              // role end this branch with a null `student`.
              let { data: studentData } = await supabase
                .from('students')
                .select('*')
                .eq('id', rd.student.id)
                .maybeSingle();

              // Defensive re-read by auth_user_id if the PK lookup came back
              // empty — this is the exact query the parallel fallback block
              // uses, and it can succeed when the by-id read momentarily did
              // not (different RLS predicate path). Gives us the full, richest
              // row whenever possible.
              if (!studentData) {
                const reread = await supabase
                  .from('students')
                  .select('*')
                  .eq('auth_user_id', user.id)
                  .maybeSingle();
                studentData = reread.data;
              }

              if (studentData) {
                // P5 read-time coercion: legacy rows may hold "Grade 9";
                // normalizeGrade returns the bare "6".."12" form so the UI
                // never sees a prefixed/invalid grade. Only the grade field
                // is touched — all other columns pass through untouched.
                setStudent({ ...studentData, grade: normalizeGrade(studentData.grade) } as Student);
                setLanguageState(studentData.preferred_language ?? 'en');
              } else {
                // Both full-row reads returned 0 rows even though get_user_role
                // resolved a student role. NEVER leave a logged-in student with
                // a null `student` (P15 — the dashboard would skeleton forever).
                // Fall back to the RPC's own student payload, which already
                // carries id/name/grade/onboarding_completed. onboarding_completed
                // is taken VERBATIM from the RPC (never hardcoded) so the
                // dashboard's `student && !student.onboarding_completed` redirect
                // to /onboarding stays correct. The remaining Student columns are
                // not available here; this is an intentional, documented partial
                // (it mirrors how the metadata-fallback block below sets reduced
                // state) and is upgraded to a full row on the next fetchUser /
                // refreshStudent. grade still passes through normalizeGrade (P5).
                setStudent({ ...rd.student, grade: normalizeGrade(rd.student.grade) } as Student);
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

          // Run all four role-table lookups in parallel instead of sequentially.
          // On Indian 4G each PostgREST round-trip is ~500 ms; 4 sequential
          // awaits was ~2 000 ms minimum, which — combined with getUser(),
          // rpc(), and any bootstrap path — easily exceeded the 12 s hard
          // timeout. One Promise.all batch collapses to a single ~500 ms
          // window, keeping the total well within the timeout budget.
          const [
            { data: studentData },
            { data: teacherData },
            { data: guardianData },
            { data: schoolAdminData },
          ] = await Promise.all([
            supabase
              .from('students')
              .select('*')
              .eq('auth_user_id', user.id)
              .maybeSingle(),
            supabase
              .from('teachers')
              .select('id, name, school_name, subjects_taught, grades_taught, email, phone')
              .eq('auth_user_id', user.id)
              .maybeSingle(),
            supabase
              .from('guardians')
              .select('id, name, email, phone')
              .eq('auth_user_id', user.id)
              .maybeSingle(),
            // get_user_role RPC (extended 2026-06-09) now covers school_admins,
            // so this branch fires only when the RPC errored or for brand-new
            // accounts racing their first login before the RPC sees the row.
            supabase
              .from('school_admins')
              .select('id, school_id')
              .eq('auth_user_id', user.id)
              .eq('is_active', true)
              .maybeSingle(),
          ]);

          if (studentData) {
            // P5 read-time coercion: legacy rows may hold "Grade 9";
            // normalizeGrade returns the bare "6".."12" form so the UI
            // never sees a prefixed/invalid grade. Only the grade field
            // is touched — all other columns pass through untouched.
            setStudent({ ...studentData, grade: normalizeGrade(studentData.grade) } as Student);
            detectedRoles.push('student');
            detectedPrimary = 'student';
            setLanguageState(studentData.preferred_language ?? 'en');
          }
          if (teacherData) {
            setTeacher(teacherData as TeacherProfile);
            detectedRoles.push('teacher');
            detectedPrimary = 'teacher'; // teacher takes priority
          }
          if (guardianData) {
            setGuardian(guardianData as GuardianProfile);
            detectedRoles.push('guardian');
            if (detectedPrimary === 'none') detectedPrimary = 'guardian';
          }
          if (schoolAdminData) {
            detectedRoles.push('institution_admin');
            if (detectedPrimary === 'none') detectedPrimary = 'institution_admin';
          }

          if (detectedRoles.length > 0) {
            setRoles(detectedRoles);
            setActiveRoleState(detectedPrimary);
          } else if (!bootstrapAttemptedRef.current) {
            // P15 guard (2026-07-20, admin-user-invite-flow incident): before
            // silently bootstrapping a profile-less authenticated user as
            // role:'student', check whether this identity has an admin_users
            // row at all (active OR inactive — any row disqualifies the
            // student auto-bootstrap). This does NOT change the 3-layer P15
            // failsafe below, which remains load-bearing for genuine student
            // signups — it only adds a short-circuit so a profile-less ADMIN
            // identity is never silently turned into a student account.
            // Consistent with the existing students/teachers/guardians/
            // school_admins lookup pattern above (own-row RLS select).
            let hasAdminUserRow = false;
            try {
              const { data: adminUserRow } = await supabase
                .from('admin_users')
                .select('id')
                .eq('auth_user_id', user.id)
                .maybeSingle();
              hasAdminUserRow = !!adminUserRow;
            } catch {
              // Fail open to the existing failsafe below — this probe must
              // never itself break the P15 onboarding funnel.
            }

            if (hasAdminUserRow) {
              // Leave unclassified rather than defaulting to student. Admin
              // identities authenticate through /super-admin/login, not the
              // student/teacher/parent onboarding funnel.
              bootstrapAttemptedRef.current = true;
              setRoles([]);
              setActiveRoleState('none');
              return;
            }

            // User is authenticated but has no profile yet.
            // B10: Route through /api/auth/bootstrap (server-side, admin client, idempotent)
            // instead of inserting directly via browser client (which bypasses RLS, triggers,
            // and onboarding_state creation).
            // Guard: only mark as attempted after MAX_BOOTSTRAP_RETRIES consecutive failures
            // to handle transient errors (e.g. FK violations from stale defaults).
            const metaRole = user.user_metadata?.role as string | undefined;
            const metaName = user.user_metadata?.name as string || user.email?.split('@')[0] || 'Student';
            // R2: normalizeGrade is the canonical grade coercion (defaults to '9',
            // matching the callback/confirm/bootstrap-route failsafe layers).
            // Grades stay strings per P5.
            const metaGrade = normalizeGrade(user.user_metadata?.grade);
            const metaBoard = user.user_metadata?.board as string || 'CBSE';

            let bootstrapSucceeded = false;
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

            // Retry bootstrap up to MAX_BOOTSTRAP_RETRIES times with 2s delays.
            // Transient DB errors (e.g. FK violations from stale defaults, replica
            // lag) resolve within seconds — retrying prevents permanent stuck state.
            for (let attempt = 1; attempt <= MAX_BOOTSTRAP_RETRIES; attempt++) {
              try {
                // M3: attach the session access token as a Bearer header so
                // localStorage-session users (password logins, no auth cookie)
                // don't 401.
                let bootstrapToken: string | null = null;
                try {
                  bootstrapToken = await Promise.race([
                    supabase.auth.getSession().then((r) => r.data.session?.access_token ?? null),
                    new Promise<null>((resolve) => { setTimeout(() => resolve(null), 3_000); }),
                  ]);
                } catch { /* degrade gracefully */ }

                const res = await fetch('/api/auth/bootstrap', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(bootstrapToken ? { Authorization: `Bearer ${bootstrapToken}` } : {}),
                  },
                  body: JSON.stringify(payload),
                });
                if (res.ok) {
                  bootstrapSucceeded = true;
                  bootstrapRetryCountRef.current = 0;
                  break;
                }
                // Non-ok response — retry after delay (unless last attempt)
                if (attempt < MAX_BOOTSTRAP_RETRIES) {
                  await new Promise((resolve) => { setTimeout(resolve, 2_000); });
                }
              } catch (bootstrapErr) {
                console.warn(`[Auth] Bootstrap attempt ${attempt}/${MAX_BOOTSTRAP_RETRIES} failed:`, bootstrapErr);
                if (attempt < MAX_BOOTSTRAP_RETRIES) {
                  await new Promise((resolve) => { setTimeout(resolve, 2_000); });
                }
              }
            }

            if (bootstrapSucceeded) {
              // Mark as attempted so recursive fetchUser won't re-enter bootstrap
              bootstrapAttemptedRef.current = true;
              // Analytics: F16 — fire signup_complete AT MOST ONCE per user (AO-9).
              try {
                const signupFlagKey = `alfanumrik_signup_complete:${user.id}`;
                let alreadyFired = false;
                try {
                  alreadyFired = typeof window !== 'undefined'
                    && window.localStorage.getItem(signupFlagKey) === '1';
                } catch { /* storage unavailable — fall through and fire */ }
                if (!alreadyFired) {
                  const role: 'student' | 'teacher' | 'parent' | 'guardian' =
                    metaRole === 'teacher' ? 'teacher'
                      : metaRole === 'parent' || metaRole === 'guardian' ? 'guardian'
                      : 'student';
                  track('signup_complete', { role, method: 'email' });
                  try {
                    if (typeof window !== 'undefined') {
                      window.localStorage.setItem(signupFlagKey, '1');
                    }
                  } catch { /* best-effort: persistence is non-critical */ }
                }
              } catch { /* analytics is non-critical */ }
              // Re-run fetchUser ONE MORE TIME to pick up newly created profile.
              // bootstrapAttemptedRef.current is already true, so the recursive call
              // will skip this bootstrap block — preventing infinite recursion.
              await fetchUser();
              return; // fetchUser will set all state; don't double-set below
            }

            // All retries exhausted — mark as attempted so we don't infinite-loop
            bootstrapAttemptedRef.current = true;
            bootstrapRetryCountRef.current += 1;
            console.warn(`[Auth] Bootstrap failed after ${MAX_BOOTSTRAP_RETRIES} attempts — falling back to metadata`);
            const fallbackRole: UserRole = metaRole === 'teacher' ? 'teacher'
              : (metaRole === 'parent' || metaRole === 'guardian') ? 'guardian'
              : 'student';
            setRoles([fallbackRole]);
            setActiveRoleState(fallbackRole);
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
    })();

    await Promise.race([work, timeoutPromise]);
    if (timeoutId) clearTimeout(timeoutId);
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!student) return;
    const snap = await getStudentSnapshot(student.id);
    if (snap) setSnapshot(snap);
  }, [student]);

  // ── PostHog identify on auth + language change (Marking-Authenticity Wave 2) ──
  // Fires once the role has resolved on:
  //  - SIGNED_IN / initial session load (when authUserId + activeRole resolve)
  //  - Profile load (so grade/board/plan land on the person profile)
  //  - Language toggle (so the preferred_language person property updates live)
  // Reset is handled in signOut() below.
  //
  // Why gate on a resolved role (B2C funnel Wave 2b): the typed identify() in
  // ./posthog/client is idempotent — it dedups on the raw user id, so ONLY the
  // FIRST call per user actually stamps person properties. authUserId is set
  // (line ~273) BEFORE the get_user_role RPC awaits, and activeRole is set
  // AFTER it. Firing at authUserId-resolve would lock in the dedup with role
  // still 'none', and the later role-driven re-fire would be a silent no-op —
  // so `role` would never reach the person. Deferring the first identify until
  // `activeRole !== 'none'` guarantees the role facet lands. A persistent
  // 'none' means role resolution failed entirely (no role to segment on), so we
  // skip identify in that rare path rather than stamp a useless profile.
  //
  // Allowlist enforced inside posthogIdentify() — only fields in
  // PERSON_PROPERTY_ALLOWLIST (role, grade, board, plan, preferred_language,
  // signup_date) make it onto the person profile. P13: NEVER include
  // email, full_name, phone, parent_phone — and the wrapper drops them
  // even if a future edit accidentally passes them.
  useEffect(() => {
    if (!authUserId) return;
    if (activeRole === 'none') return;
    try {
      // We re-read the auth user (already cached by Supabase) to pull
      // created_at without threading it through provider state.
      void supabase.auth.getUser().then(({ data }) => {
        const signupDate = data?.user?.created_at?.split('T')[0];
        posthogIdentify(authUserId, {
          // Coarse role enum (P13 — 4 low-cardinality values, NOT PII). Reuses
          // the already-normalized activeRole (parent is internally 'guardian'),
          // so it shares ONE vocabulary with the funnel events signup_complete +
          // email_verified. Only the three B2C funnel roles are stamped;
          // institution_admin (B2B) is omitted so the person `role` facet matches
          // the funnel events exactly. undefined is dropped by the allowlist filter.
          role:
            activeRole === 'student' || activeRole === 'teacher' || activeRole === 'guardian'
              ? activeRole
              : undefined,
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
  }, [authUserId, activeRole, student?.grade, student?.board, student?.subscription_plan, language]);

  // ── School invite-code redemption (P15 day-1 B2B path) ──
  // A fresh student/teacher who signed up via /join?code=… → /login?code=…
  // has the code persisted in localStorage. /api/schools/join links by
  // auth_user_id, so it can only run AFTER the profile row exists. We gate on
  // roles.length > 0 (profile confirmed by fetchUser) and authUserId, then
  // redeem with the session Bearer token (the app's session lives in
  // localStorage, not cookies). Fire-and-forget: this NEVER blocks render and
  // NEVER throws — onboarding integrity is preserved even if the link fails.
  useEffect(() => {
    if (!authUserId || roles.length === 0) return;
    if (inviteRedeemedRef.current) return;
    // Only students and teachers are linked to a school by invite code; the
    // institution_admin who created the school is already linked, and a
    // guardian links to a child via a separate link-code flow at signup.
    const linkable = roles.includes('student') || roles.includes('teacher');
    if (!linkable) return;

    let cancelled = false;
    void (async () => {
      try {
        const outcome = await redeemPendingInvite();
        if (cancelled) return;
        // 'retry' leaves the code in place for the next load; everything else
        // (linked / cleared / none) is terminal for this session.
        if (outcome !== 'retry') {
          inviteRedeemedRef.current = true;
        }
        if (outcome === 'linked') {
          // Pull the freshly-set school_id into client state.
          try { await fetchUser(); } catch { /* non-fatal */ }
        }
      } catch {
        /* redeemPendingInvite never throws, but be defensive — P15 */
      }
    })();

    return () => { cancelled = true; };
  }, [authUserId, roles, fetchUser]);

  const signOut = useCallback(async () => {
    // Deregister device session
    try {
      await fetch('/api/auth/session', { method: 'DELETE' });
    } catch { /* best-effort */ }
    await supabase.auth.signOut();
    // Reset bootstrap guard so a new sign-in can trigger bootstrap if needed
    bootstrapAttemptedRef.current = false;
    // Reset invite-redemption guard and drop any pending invite code so it can
    // never be applied to a different account that signs in on this device.
    inviteRedeemedRef.current = false;
    clearPendingInvite();
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setAuthUserId(null);
        setStudent(null);
        setSnapshot(null);
        setTeacher(null);
        setGuardian(null);
        setRoles([]);
        setActiveRoleState('none');
        bootstrapAttemptedRef.current = false;
        // Reset invite-redemption guard + drop any pending code on cross-tab
        // signout so it can't bleed into the next account on this device.
        inviteRedeemedRef.current = false;
        clearPendingInvite();
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
        // Allow invite redemption to fire for this new session (the guard is
        // per-session; the redeem effect re-checks once roles resolve).
        inviteRedeemedRef.current = false;
        // Register device session for 2-device limit enforcement.
        //
        // Auth token is forwarded as Authorization: Bearer so the server can
        // validate the session even when supabase.auth.signInWithPassword wrote
        // it to localStorage (the default) instead of cookies. Without this the
        // server's cookie-based getUser() returned 401 on every page load and
        // polluted browser consoles with 3+ entries per session. The server
        // now returns 200/no_session_yet if both cookie and Bearer paths fail.
        // 2026-05-20 — see api/auth/session/route.ts resolveAuthUser().
        // Use the session provided by the SIGNED_IN event directly.
        // Previously this called supabase.auth.getSession() which acquires the
        // Supabase auth lock (_acquireLock) concurrently with fetchUser()'s own
        // getSession() call. If a token refresh was in-progress, the lock was
        // held until the refresh completed or timed out — blocking fetchUser()
        // for 12+ seconds. Using the event session eliminates the second lock
        // acquisition entirely.
        void (async () => {
          const token = session?.access_token;
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;
          try {
            await fetch('/api/auth/session', {
              method: 'POST',
              headers,
              body: JSON.stringify({ device_label: navigator.userAgent }),
            });
          } catch (err: unknown) {
            console.warn('[auth-session] session POST failed:', err instanceof Error ? err.message : String(err));
          }
        })();
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
