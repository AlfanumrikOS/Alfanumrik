'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useTenant } from '@/lib/tenant-context';
import { supabase } from '@/lib/supabase';
import { authedFetch } from '@/lib/school-admin/authed-fetch';
import { useSchoolReportsDepth } from '@/lib/use-school-reports-depth';
import { useSchoolAdminRbac } from '@/lib/use-school-admin-rbac';
import { useSchoolAdminRole } from '@/lib/use-school-admin-role';
import { usePrincipalAi } from '@/lib/use-principal-ai';
import { useCosmicTheme } from '@/lib/cosmic-theme';
import { Starfield } from '@/components/cosmic';
import ConsolidatedSchoolNav from './ConsolidatedSchoolNav';
import { SchoolAdminContext } from '@/lib/school-admin/school-admin-context';

/* ─── School identity: ONE authoritative resolution (stop the flip) ───
 *
 * The sidebar brand used to flip "School Admin" (avatar "S") → "Demo School"
 * (avatar "D") across hydration because the literal 'School Admin' fallback
 * was painted FIRST and the async DB name resolved SECOND — two values with
 * different first letters. We now resolve the displayed school name through a
 * single priority chain and, crucially, never paint a misleading literal that
 * later changes its first letter.
 *
 * Resolution priority (highest first):
 *   1. useTenant().schoolName            (present once SchoolThemeProvider hydrates)
 *   2. school_admins → schools(name) DB  (direct-URL access fallback)
 *   3. a synchronous per-user cache      (so repeat visits paint the resolved name)
 *   4. email-prefix of the admin's email (humane last-resort label)
 *   5. a neutral, stable placeholder     (em-dash — never a fake-name first letter)
 *
 * The cache mirrors the localStorage pattern in `useSchoolCommandCenter`: a
 * synchronous read on mount means the first paint on a repeat visit already
 * matches the resolved name, so the user never sees an S→D swap. Other
 * school-admin surfaces read the SAME cache so the school name shown anywhere
 * is identical — no third divergent source.
 */
const SCHOOL_IDENTITY_CACHE_PREFIX = 'alfanumrik_school_identity_v1'; // gitleaks:allow — sessionStorage key, not a secret
const SCHOOL_IDENTITY_TTL_MS = 12 * 60 * 60 * 1000; // 12h — identity rarely changes within a session

const MODULE_CACHE_KEY_PREFIX = 'alfanumrik_modules_v1'; // gitleaks:allow — sessionStorage key
const MODULE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — modules rarely change mid-session

interface CachedModules {
  data: Record<string, boolean>;
  ts: number;
}

function readModuleCache(authUserId: string | null): Record<string, boolean> | null {
  if (typeof window === 'undefined' || !authUserId) return null;
  try {
    const raw = window.sessionStorage.getItem(`${MODULE_CACHE_KEY_PREFIX}:${authUserId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedModules;
    if (!parsed || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > MODULE_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch { return null; }
}

function writeModuleCache(authUserId: string | null, data: Record<string, boolean>) {
  if (typeof window === 'undefined' || !authUserId) return;
  try {
    window.sessionStorage.setItem(
      `${MODULE_CACHE_KEY_PREFIX}:${authUserId}`,
      JSON.stringify({ data, ts: Date.now() } satisfies CachedModules),
    );
  } catch { /* quota / disabled — fail silently */ }
}
/** Neutral, stable placeholder painted while the name is genuinely unresolved.
 *  An em-dash reads as "loading" and never masquerades as a real school whose
 *  first letter would later change. */
export const SCHOOL_NAME_PLACEHOLDER = '—';

interface CachedSchoolIdentity {
  name: string;
  logoUrl: string | null;
  ts: number;
}

function schoolIdentityCacheKey(authUserId: string | null): string | null {
  return authUserId ? `${SCHOOL_IDENTITY_CACHE_PREFIX}:${authUserId}` : null;
}

/** Synchronous read of the cached school identity for this user; null when
 *  absent, malformed, or stale. Safe in SSR (returns null). */
export function readSchoolIdentityCache(authUserId: string | null): CachedSchoolIdentity | null {
  if (typeof window === 'undefined') return null;
  const key = schoolIdentityCacheKey(authUserId);
  if (!key) return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSchoolIdentity;
    if (!parsed || typeof parsed.name !== 'string' || typeof parsed.ts !== 'number') return null;
    if (Date.now() - parsed.ts > SCHOOL_IDENTITY_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSchoolIdentityCache(authUserId: string | null, name: string, logoUrl: string | null) {
  if (typeof window === 'undefined') return;
  const key = schoolIdentityCacheKey(authUserId);
  if (!key || !name) return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ name, logoUrl, ts: Date.now() } satisfies CachedSchoolIdentity));
  } catch {
    /* quota or disabled storage — fall back to per-request resolution */
  }
}

/** The single resolver other school-admin surfaces should call so the school
 *  name they display matches the shell exactly. Returns the resolved name, or
 *  null when nothing authoritative is known yet (caller decides the label). */
export function resolveCachedSchoolName(authUserId: string | null, tenantSchoolName?: string | null): string | null {
  if (tenantSchoolName) return tenantSchoolName;
  return readSchoolIdentityCache(authUserId)?.name ?? null;
}

/**
 * School Admin Shell — branded consolidated nav layout.
 *
 * Renders the consolidated 5-section `<ConsolidatedSchoolNav>` (the purple
 * School Command Center nav) and supplies tenant-driven branding:
 * - School logo / initial-letter tile
 * - School primary color for active nav highlight
 * - "Powered by Alfanumrik" footer for B2B tenants
 *
 * Falls back to a DB lookup if tenant context is null (e.g. direct URL
 * access before SchoolThemeProvider hydrates). The nav's own items are
 * gated by module enablement (fail-open when /api/school-admin/modules
 * errors or returns 403) and by the per-section sub-flags
 * (rbacEnabled/reportsDepthEnabled/principalAiEnabled).
 */
export default function SchoolAdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { authUserId, isHi, setLanguage } = useAuth();
  const tenant = useTenant();
  // Cosmic Phase 3: flag-gated dark reskin (gold/steel via data-role="school").
  // OFF ⇒ cosmicEnabled false ⇒ byte-identical to before this change.
  const { cosmicEnabled } = useCosmicTheme();
  // Seed from the SAME authoritative chain we resolve below so the first paint
  // on a repeat visit already shows the resolved name (no S→D flip):
  //   tenant.schoolName → synchronous per-user identity cache → ''(unresolved).
  const cachedIdentity = readSchoolIdentityCache(authUserId);
  const [schoolName, setSchoolName] = useState<string>(tenant.schoolName || cachedIdentity?.name || '');
  const [logoUrl, setLogoUrl] = useState<string | null>(tenant.branding.logoUrl || cachedIdentity?.logoUrl || null);
  // Email-prefix is the humane last-resort label (priority 4). Sourced from the
  // SAME school_admins row the direct-URL fallback already reads — no new query
  // pattern, no auth-flow change.
  const [emailPrefix, setEmailPrefix] = useState<string>('');
  /** Resolved school_id — shared with child pages via SchoolAdminContext. */
  const [schoolId, setSchoolId] = useState<string | null>(null);
  /** true while we're still resolving identity (tenant OR direct-URL DB path). */
  const [identityLoading, setIdentityLoading] = useState<boolean>(true);

  // null while loading or on fetch failure (fail-open: show all items).
  // Otherwise a partial map of moduleKey → enabled. Only modules that
  // resolve to `false` are filtered out of the sidebar.
  const [moduleEnablement, setModuleEnablement] = useState<Record<string, boolean> | null>(null);

  // Phase 3B Wave D — deep school-wide reporting nav entry. Sync-paints
  // DEFAULT_OFF (1h cache), so for every current (flag-absent) user this is false
  // on the first paint and the Academics section omits the School Report entry
  // byte-identically. When ON, the entry appears (the route + read APIs are
  // themselves flag-gated server-side). The entry lives in the consolidated
  // nav, which is now the sole school-admin nav.
  const reportsDepthOn = useSchoolReportsDepth();

  // Phase 3B Wave C — role-aware nav gating. Sync-paints DEFAULT_OFF (1h cache),
  // so for every current (flag-absent) user this is false on the first paint and
  // the consolidated nav renders Wave A byte-identically (no Staff entry, no
  // capability filtering). When ON, the Staff entry appears and capability-tagged
  // items hide for roles that lack the capability. The caller's role comes from an
  // RLS-bounded self-read (UI polish only — server enforces regardless, P9).
  const rbacOn = useSchoolAdminRbac();
  // Track 2 — Principal AI Assistant nav entry. Sync-paints DEFAULT_OFF (1h cache),
  // so for every current (flag-absent) user this is false on the first paint and
  // the Academics section omits the Principal Assistant entry byte-identically.
  // When ON, the entry appears ONLY for a principal (the route 404s/403s
  // server-side regardless — P9).
  const principalAiOn = usePrincipalAi();
  // Resolve the caller's role when EITHER the RBAC flag OR the Principal-AI flag is
  // ON — both gate nav entries by role. Passing null while both are OFF suppresses
  // the self-read entirely, so the OFF portal is byte-identical (no extra network
  // request) to before these features.
  const { role: adminRole } = useSchoolAdminRole(rbacOn || principalAiOn ? authUserId : null);

  const primaryColor = tenant.branding.primaryColor || '#7C3AED';

  // ─── Single authoritative brand title (the value the avatar initial derives
  // from). Priority: tenant → DB-resolved name → email-prefix → neutral
  // placeholder. We deliberately do NOT fall back to the old 'School Admin'
  // literal: it had a different first letter than the resolved name and was the
  // sole cause of the S→D avatar flip. The sub-line keeps the static
  // "School Administration" label, so context is never lost. ───
  const resolvedSchoolName =
    tenant.schoolName || schoolName || emailPrefix || SCHOOL_NAME_PLACEHOLDER;

  useEffect(() => {
    if (!authUserId) {
      router.push('/login');
      return;
    }
    // Tenant context is authoritative when present — mirror it into the cache so
    // repeat visits + sibling surfaces paint the same name.
    if (tenant.schoolName) {
      writeSchoolIdentityCache(authUserId, tenant.schoolName, tenant.branding.logoUrl ?? null);
      // Resolve schoolId from tenant context when available
      if (tenant.schoolId) {
        setSchoolId(tenant.schoolId as string);
      }
      setIdentityLoading(false);
      return;
    }
    // If no tenant context (direct URL access), fetch school info from DB. We
    // also pull the admin's email so the email-prefix last-resort label can be
    // derived from the SAME row (no extra query, no auth-flow change).
    if (authUserId) {
      void supabase
        .from('school_admins')
        .select('school_id, email, schools(name, logo_url, primary_color)')
        .eq('auth_user_id', authUserId)
        .eq('is_active', true)
        .single()
        .then(
          ({ data }) => {
            const adminEmail = typeof data?.email === 'string' ? data.email : '';
            if (adminEmail) setEmailPrefix(adminEmail.split('@')[0] ?? '');
            if (data?.school_id) {
              setSchoolId(data.school_id as string);
            }
            if (data?.schools && typeof data.schools === 'object') {
              // Supabase FK join may return array or object depending on relation type
              const raw = data.schools as unknown;
              const s = Array.isArray(raw) ? raw[0] : raw;
              if (s && typeof s === 'object' && 'name' in s) {
                const school = s as { name: string; logo_url: string | null; primary_color: string | null };
                setSchoolName(school.name);
                if (school.logo_url) setLogoUrl(school.logo_url);
                // Persist the resolved identity so the next paint (and sibling
                // surfaces) never see the S→D flip.
                writeSchoolIdentityCache(authUserId, school.name, school.logo_url ?? null);
              }
            }
            setIdentityLoading(false);
          },
          () => {
            setIdentityLoading(false);
          },
        );
    }
  }, [authUserId, tenant.schoolName, tenant.branding.logoUrl, tenant.schoolId, router]);

  // Fetch module enablement once per shell mount. /api/school-admin/modules
  // requires `school.manage_modules` permission; admins without it land
  // here (fail-open: every nav item shows) — the API would return 403 and
  // moduleEnablement stays null. Cached 5 min server-side via the registry.
  useEffect(() => {
    if (!authUserId) return;
    // Seed from cache so nav items appear instantly on repeat visits (no flash).
    const cached = readModuleCache(authUserId);
    if (cached) setModuleEnablement(cached);

    let cancelled = false;
    authedFetch('/api/school-admin/modules')
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        if (cancelled || !body?.success) return;
        const map: Record<string, boolean> = {};
        for (const m of body.data?.modules ?? []) {
          if (m && typeof m.key === 'string' && typeof m.isEnabled === 'boolean') {
            map[m.key] = m.isEnabled;
          }
        }
        setModuleEnablement(map);
        writeModuleCache(authUserId, map);
      })
      .catch(() => {
        // Fail-open — moduleEnablement stays null/cached and all items render.
      });
    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  // NOTE: this shell intentionally does NOT short-circuit on any Editorial-Atlas
  // flag. The teacher/parent shells dispatch to their own Atlas bodies that carry
  // their own nav, but the school-admin page renders ONLY <CommandCenter />, which
  // has no sidebar of its own. Returning bare {children} here stripped the entire
  // purple sidebar, leaving a brand-new school admin with NO way to reach
  // Enrollment / Invite-Codes / Setup (P0 launch blocker). ConsolidatedSchoolNav
  // must ALWAYS render around children regardless of any atlas flag.
  return (
    <div
      className={`flex min-h-screen bg-surface-2${cosmicEnabled ? ' school-admin-portal' : ''}`}
      style={cosmicEnabled ? { position: 'relative' } : undefined}
    >
      {/* Cosmic dark canvas — decorative starfield behind the portal. Hidden in
          light/HC + reduced-motion via globals.css. */}
      {cosmicEnabled && <Starfield className="!fixed inset-0 -z-0" />}
      {/* School Command Center is the sole school-admin nav. The
          ff_school_command_center flag is globally ON in prod, so the legacy
          flat-nav dispatch (and its first-paint flag race) is removed: the
          consolidated 5-section ConsolidatedSchoolNav always renders. Per-item
          gating is preserved via moduleEnablement + the sub-flags
          (rbacEnabled/reportsDepthEnabled/principalAiEnabled) below. */}
      <ConsolidatedSchoolNav
        brandTitle={resolvedSchoolName}
        brandSubtitle={isHi ? 'स्कूल प्रशासन' : 'School Administration'}
        logoUrl={logoUrl}
        primaryColor={primaryColor}
        currentPath={pathname || ''}
        isHi={isHi}
        moduleEnablement={moduleEnablement}
        rbacEnabled={rbacOn}
        adminRole={adminRole}
        reportsDepthEnabled={reportsDepthOn}
        principalAiEnabled={principalAiOn}
        footer={
          <div className="flex items-center justify-between gap-2">
            {(tenant.branding.showPoweredBy || tenant.schoolId) ? (
              <div className="text-[10px] text-muted-foreground">
                Powered by{' '}
                <a href="https://alfanumrik.com" className="text-primary no-underline">
                  Alfanumrik
                </a>
              </div>
            ) : <span />}
            <button
              type="button"
              onClick={() => setLanguage(isHi ? 'en' : 'hi')}
              className="text-[11px] font-semibold rounded-lg px-2 py-1 transition-colors hover:bg-surface-2 flex-shrink-0"
              style={{ color: 'var(--text-3)', border: '1px solid var(--border)' }}
              aria-label={isHi ? 'Switch to English' : 'हिन्दी में बदलें'}
            >
              {isHi ? 'EN' : 'हि'}
            </button>
          </div>
        }
      />
      <SchoolAdminContext.Provider
        value={{
          schoolId,
          schoolName: tenant.schoolName || schoolName || null,
          isLoading: identityLoading,
        }}
      >
        <main className={`flex-1 max-w-screen-xl overflow-auto p-6${cosmicEnabled ? ' relative z-10' : ''}`}>{children}</main>
      </SchoolAdminContext.Provider>
    </div>
  );
}
