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
  student: { id: string; name: string; grade: string } | null;
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

/** Synchronously read whether the cosmic redesign flag resolved ON for this
 *  browser, from the 1-hour localStorage cache that CosmicThemeProvider writes.
 *  Absent/unknown ⇒ false (production truth). This lets applyThemeToDOM avoid
 *  clobbering the cosmic data-theme when the redesign is live, WITHOUT importing
 *  the cosmic module (keeps the auth-critical path dependency-free). */
function cosmicFlagOnSync(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem('alfanumrik_cosmic_flag_v1');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { on?: boolean; ts?: number };
    if (!parsed || typeof parsed.ts !== 'number') return false;
    if (Date.now() - parsed.ts > 60 * 60 * 1000) return false;
    return Boolean(parsed.on);
  } catch {
    return false;
  }
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
  if (cosmicFlagOnSync()) {
    // Cosmic is live — CosmicThemeProvider is the authority over data-theme.
    // If a cosmic theme is already set, leave it; otherwise seed a sane
    // default so there's never an unstyled flash before the provider mounts.
    const html = document.documentElement;
    if (html.getAttribute('data-design') !== 'cosmic') {
      html.setAttribute('data-design', 'cosmic');
    }
    if (!html.getAttribute('data-theme')) {
      html.setAttribute('data-theme', 'dark');
    }
    return;
  }
  // Legacy force-light path (see resolveTheme rationale above).
  document.documentElement.setAttribute('data-theme', 'light');
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
  // Reset to false on each fresh fetchUser invocation; set to true after bootstrap attempt.
  const bootstrapAttemptedRef = useRef(false);

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
              const { data: studentData } = await supabase
                .from('students')
                .select('*')
                .eq('id', rd.student.id)
                .single();
              if (studentData) {
                // P5 read-time coercion: legacy rows may hold "Grade 9";
                // normalizeGrade returns the bare "6".."12" form so the UI
                // never sees a prefixed/invalid grade. Only the grade field
                // is touched — all other columns pass through untouched.
                setStudent({ ...studentData, grade: normalizeGrade(studentData.grade) } as Student);
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
            // User is authenticated but has no profile yet.
            // B10: Route through /api/auth/bootstrap (server-side, admin client, idempotent)
            // instead of inserting directly via browser client (which bypasses RLS, triggers,
            // and onboarding_state creation).
            // Guard: only attempt bootstrap once to prevent infinite recursion if
            // bootstrap succeeds but the subsequent profile query still fails.
            bootstrapAttemptedRef.current = true;
            const metaRole = user.user_metadata?.role as string | undefined;
            const metaName = user.user_metadata?.name as string || user.email?.split('@')[0] || 'Student';
            // R2: normalizeGrade is the canonical grade coercion (defaults to '9',
            // matching the callback/confirm/bootstrap-route failsafe layers).
            // Grades stay strings per P5.
            const metaGrade = normalizeGrade(user.user_metadata?.grade);
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

              // M3: attach the session access token as a Bearer header so
              // localStorage-session users (password logins, no auth cookie)
              // don't 401 — the bootstrap route accepts `Authorization: Bearer`
              // as a fallback when no cookie session is present. Cookie
              // behavior is unchanged (same-origin fetch still sends cookies).
              // The session was already resolved by the getSession() call at
              // the top of fetchUser, so this re-read hits the in-memory cache;
              // the 3s race is a safety net so a stalled refresh can't burn
              // the outer 12s budget. If no token is available, send the
              // request exactly as before (graceful degradation).
              let bootstrapToken: string | null = null;
              try {
                bootstrapToken = await Promise.race([
                  supabase.auth.getSession().then((r) => r.data.session?.access_token ?? null),
                  new Promise<null>((resolve) => { setTimeout(() => resolve(null), 3_000); }),
                ]);
              } catch { /* degrade gracefully — request goes out without Authorization */ }

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
                // Analytics: F16 — see audit 2026-04-27.
                // Bootstrap is the first successful server-side write of a profile,
                // gated by Redis idempotency lock — fires exactly once per new user.
                try {
                  // AO-9: fire `signup_complete` AT MOST ONCE per user.
                  // `bootstrapAttemptedRef` only dedupes within a single session —
                  // it is reset to false on every SIGNED_IN and on signOut. So if a
                  // user's profile row stays missing (e.g. a silent bootstrap
                  // failure, or a fresh sign-in racing profile creation), this block
                  // re-enters on each new session, sees res.ok, and re-fires the
                  // event — over-counting activation. A durable per-user key makes
                  // the emission idempotent across re-mounts, reloads, and repeated
                  // sign-ins. The key uses the auth UUID only; the event payload
                  // carries no PII (P13) and a storage failure must never break the
                  // funnel (P15) — on storage error we degrade to the prior
                  // fire-each-time behavior rather than throwing.
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
