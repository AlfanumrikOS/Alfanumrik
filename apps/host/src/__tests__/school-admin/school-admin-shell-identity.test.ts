/**
 * SchoolAdminShell — school-identity resolution helpers (unit, no render).
 *
 * WHY THIS EXISTS
 *   The sidebar brand used to FLIP its avatar initial: the literal 'School Admin'
 *   (avatar "S") painted first, then the async DB name (e.g. 'Demo School',
 *   avatar "D") resolved second — two values with different first letters. The
 *   fix introduces ONE authoritative resolution chain and a per-user
 *   sessionStorage identity cache, and replaces the premature 'School Admin'
 *   literal with a NEUTRAL em-dash placeholder that never masquerades as a real
 *   school whose first letter would later change.
 *
 *   These tests pin the pure, exported pieces of that fix:
 *     - resolveCachedSchoolName precedence: tenant.schoolName → cache → null
 *     - SCHOOL_NAME_PLACEHOLDER is the neutral '—' (NOT the old 'School Admin')
 *     - readSchoolIdentityCache key shape, per-user isolation, TTL, malformed
 *       payload + SSR safety
 *
 * The component pulls in many client-only hooks at module scope. We mock those
 * seams so importing the module to reach its pure helpers does not drag in real
 * Supabase / tenant / cosmic wiring. The helpers under test touch only
 * window.sessionStorage (the in-memory mock from setup.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the heavy client seams the module imports at top level. We never
//    render the component here, so these only need to exist as importable stubs.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/school-admin',
}));
vi.mock('@alfanumrik/lib/AuthContext', () => ({ useAuth: () => ({ authUserId: null, isHi: false }) }));
vi.mock('@alfanumrik/lib/tenant-context', () => ({
  useTenant: () => ({ schoolName: '', schoolId: null, branding: { primaryColor: '#7C3AED', logoUrl: null, showPoweredBy: false } }),
}));
vi.mock('@alfanumrik/lib/supabase', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@alfanumrik/lib/use-atlas-flag', () => ({ useAtlasFlag: () => false }));
vi.mock('@alfanumrik/lib/use-school-command-center', () => ({ useSchoolCommandCenter: () => false }));
vi.mock('@alfanumrik/lib/use-school-reports-depth', () => ({ useSchoolReportsDepth: () => false }));
vi.mock('@alfanumrik/lib/use-school-admin-rbac', () => ({ useSchoolAdminRbac: () => false }));
vi.mock('@alfanumrik/lib/use-school-admin-role', () => ({ useSchoolAdminRole: () => ({ role: null }) }));
vi.mock('@alfanumrik/lib/use-principal-ai', () => ({ usePrincipalAi: () => false }));
vi.mock('@alfanumrik/lib/cosmic-theme', () => ({ useCosmicTheme: () => ({ cosmicEnabled: false }) }));
vi.mock('@alfanumrik/ui/cosmic', () => ({ Starfield: () => null }));
vi.mock('@alfanumrik/ui/admin-ui/DashboardSidebar', () => ({ default: () => null }));
vi.mock('./ConsolidatedSchoolNav', () => ({ default: () => null }));

import {
  resolveCachedSchoolName,
  readSchoolIdentityCache,
  SCHOOL_NAME_PLACEHOLDER,
} from '@/app/school-admin/_components/SchoolAdminShell';

const CACHE_PREFIX = 'alfanumrik_school_identity_v1';
const USER = 'auth-user-aaa';
const cacheKey = (uid: string) => `${CACHE_PREFIX}:${uid}`;

function seedCache(uid: string, payload: Record<string, unknown>) {
  window.sessionStorage.setItem(cacheKey(uid), JSON.stringify(payload));
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('SCHOOL_NAME_PLACEHOLDER — neutral, not a premature literal', () => {
  it('is the em-dash placeholder', () => {
    expect(SCHOOL_NAME_PLACEHOLDER).toBe('—');
  });

  it('is NOT the old "School Admin" literal that caused the S→D flip', () => {
    expect(SCHOOL_NAME_PLACEHOLDER).not.toBe('School Admin');
    // First char is the em-dash, never a real-school first letter.
    expect(SCHOOL_NAME_PLACEHOLDER.charAt(0)).toBe('—');
  });
});

describe('resolveCachedSchoolName — precedence', () => {
  it('1. tenant.schoolName wins over everything (even a populated cache)', () => {
    seedCache(USER, { name: 'Cached School', logoUrl: null, ts: Date.now() });
    expect(resolveCachedSchoolName(USER, 'Tenant School')).toBe('Tenant School');
  });

  it('2. falls back to the cached name when tenant.schoolName is absent', () => {
    seedCache(USER, { name: 'Cached School', logoUrl: null, ts: Date.now() });
    expect(resolveCachedSchoolName(USER, null)).toBe('Cached School');
    expect(resolveCachedSchoolName(USER, undefined)).toBe('Cached School');
    expect(resolveCachedSchoolName(USER, '')).toBe('Cached School');
  });

  it('3. returns null when neither tenant nor cache is available (caller picks the label)', () => {
    expect(resolveCachedSchoolName(USER, null)).toBeNull();
  });

  it('does NOT synthesize the placeholder itself — that decision is the caller’s', () => {
    expect(resolveCachedSchoolName(USER, null)).not.toBe(SCHOOL_NAME_PLACEHOLDER);
  });

  it('returns null for a null authUserId with no tenant name', () => {
    expect(resolveCachedSchoolName(null, null)).toBeNull();
  });
});

describe('readSchoolIdentityCache — per-user key, TTL, robustness', () => {
  it('reads back a fresh cached identity by the per-user key', () => {
    const now = Date.now();
    seedCache(USER, { name: 'Greenwood High', logoUrl: 'https://x/logo.png', ts: now });
    const got = readSchoolIdentityCache(USER);
    expect(got?.name).toBe('Greenwood High');
    expect(got?.logoUrl).toBe('https://x/logo.png');
  });

  it('is isolated per auth user (no cross-user bleed)', () => {
    seedCache('user-A', { name: 'School A', logoUrl: null, ts: Date.now() });
    expect(readSchoolIdentityCache('user-A')?.name).toBe('School A');
    expect(readSchoolIdentityCache('user-B')).toBeNull();
  });

  it('returns null when the cached entry is stale (older than the 12h TTL)', () => {
    const thirteenHoursAgo = Date.now() - 13 * 60 * 60 * 1000;
    seedCache(USER, { name: 'Stale School', logoUrl: null, ts: thirteenHoursAgo });
    expect(readSchoolIdentityCache(USER)).toBeNull();
  });

  it('returns null for a null authUserId (no key to read)', () => {
    seedCache(USER, { name: 'School', logoUrl: null, ts: Date.now() });
    expect(readSchoolIdentityCache(null)).toBeNull();
  });

  it('returns null for a malformed JSON payload (does not throw)', () => {
    window.sessionStorage.setItem(cacheKey(USER), '{not valid json');
    expect(() => readSchoolIdentityCache(USER)).not.toThrow();
    expect(readSchoolIdentityCache(USER)).toBeNull();
  });

  it('returns null when required fields are missing/wrong-typed', () => {
    seedCache(USER, { logoUrl: null, ts: Date.now() }); // no name
    expect(readSchoolIdentityCache(USER)).toBeNull();
    seedCache(USER, { name: 'X', logoUrl: null }); // no ts
    expect(readSchoolIdentityCache(USER)).toBeNull();
  });

  it('returns null when there is no cached entry at all', () => {
    expect(readSchoolIdentityCache(USER)).toBeNull();
  });
});
