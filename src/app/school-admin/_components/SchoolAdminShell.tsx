'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useTenant } from '@/lib/tenant-context';
import { supabase } from '@/lib/supabase';
import type { ModuleKey } from '@/lib/modules/registry';

/* ─── P7: Bilingual labels ───────────────────────────────────────────
 *
 * `moduleKey` (optional) maps a nav entry to a module from the registry
 * (src/lib/modules/registry.ts). When set, the entry is hidden in the
 * sidebar if `enabledModulesFor(schoolId, tenantType)` reports that
 * module as disabled. Items WITHOUT a moduleKey are always shown — they
 * cover platform-core admin functions (dashboard, students, teachers,
 * classes, branding, etc.) that are not gated by module enablement.
 *
 * Defensive fallback: when the /api/school-admin/modules fetch fails
 * for any reason, we render every item — favouring availability over
 * confusion. (Same fail-open semantics as the registry resolver.)
 */
type SchoolAdminNavItem = {
  href: string;
  label: string;
  labelHi: string;
  icon: string;
  /** When set: hide this item if the module is disabled for this tenant. */
  moduleKey?: ModuleKey;
};

const NAV_ITEMS: ReadonlyArray<SchoolAdminNavItem> = [
  { href: '/school-admin', label: 'Dashboard', labelHi: 'डैशबोर्ड', icon: '▦' },
  { href: '/school-admin/students', label: 'Students', labelHi: 'छात्र', icon: '⊕' },
  { href: '/school-admin/teachers', label: 'Teachers', labelHi: 'शिक्षक', icon: '⊛' },
  { href: '/school-admin/classes', label: 'Classes', labelHi: 'कक्षाएँ', icon: '⊞' },
  { href: '/school-admin/invite-codes', label: 'Invite Codes', labelHi: 'आमंत्रण कोड', icon: '⊡' },
  { href: '/school-admin/announcements', label: 'Announcements', labelHi: 'घोषणाएँ', icon: '⊜', moduleKey: 'communication' },
  { href: '/school-admin/parents', label: 'Parents', labelHi: 'अभिभावक', icon: '⊗' },
  { href: '/school-admin/reports', label: 'Reports', labelHi: 'रिपोर्ट', icon: '⊘', moduleKey: 'analytics' },
  { href: '/school-admin/content', label: 'Content', labelHi: 'सामग्री', icon: '⊠', moduleKey: 'lms' },
  { href: '/school-admin/exams', label: 'Exams', labelHi: 'परीक्षा', icon: '⊙', moduleKey: 'testing_engine' },
  { href: '/school-admin/setup', label: 'Setup', labelHi: 'सेटअप', icon: '◎' },
  { href: '/school-admin/branding', label: 'Branding', labelHi: 'ब्रांडिंग', icon: '◐' },
  { href: '/school-admin/modules', label: 'Modules', labelHi: 'मॉड्यूल', icon: '◍' },
  { href: '/school-admin/ai-config', label: 'AI Config', labelHi: 'AI कॉन्फ़िग', icon: '◈', moduleKey: 'ai_tutor' },
  { href: '/school-admin/enroll', label: 'Enrollment', labelHi: 'नामांकन', icon: '◉' },
];

/**
 * School Admin Shell — branded sidebar layout
 *
 * Uses the tenant context from SchoolThemeProvider for:
 * - School logo in sidebar header
 * - School colors for active nav highlight
 * - "Powered by Alfanumrik" footer for B2B
 *
 * Falls back to DB lookup if tenant context is null (direct URL access).
 */
export default function SchoolAdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { authUserId, isHi } = useAuth();
  const tenant = useTenant();
  const [schoolName, setSchoolName] = useState<string>(tenant.schoolName || '');
  const [logoUrl, setLogoUrl] = useState<string | null>(tenant.branding.logoUrl);
  const [collapsed, setCollapsed] = useState(false);

  // null while loading or on fetch failure (fail-open: show all items).
  // Otherwise a partial map of moduleKey → enabled. Only modules that
  // resolve to `false` are filtered out of the sidebar.
  const [moduleEnablement, setModuleEnablement] = useState<Record<string, boolean> | null>(null);

  const primaryColor = tenant.branding.primaryColor || '#7C3AED';

  useEffect(() => {
    if (!authUserId) {
      router.push('/login');
      return;
    }
    // If no tenant context (direct URL access), fetch school info from DB
    if (!tenant.schoolName && authUserId) {
      supabase
        .from('school_admins')
        .select('school_id, schools(name, logo_url, primary_color)')
        .eq('auth_user_id', authUserId)
        .eq('is_active', true)
        .single()
        .then(({ data }) => {
          if (data?.schools && typeof data.schools === 'object') {
            // Supabase FK join may return array or object depending on relation type
            const raw = data.schools as unknown;
            const s = Array.isArray(raw) ? raw[0] : raw;
            if (s && typeof s === 'object' && 'name' in s) {
              const school = s as { name: string; logo_url: string | null; primary_color: string | null };
              setSchoolName(school.name);
              if (school.logo_url) setLogoUrl(school.logo_url);
            }
          }
        });
    }
  }, [authUserId, tenant.schoolName, router]);

  // Fetch module enablement once per shell mount. /api/school-admin/modules
  // requires `school.manage_modules` permission; admins without it land
  // here (fail-open: every nav item shows) — the API would return 403 and
  // moduleEnablement stays null. Cached 5 min server-side via the registry.
  useEffect(() => {
    if (!authUserId) return;
    let cancelled = false;
    fetch('/api/school-admin/modules', { credentials: 'same-origin' })
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
      })
      .catch(() => {
        // Fail-open — moduleEnablement stays null and all items render.
      });
    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  // Apply the module filter. Items without `moduleKey` always render.
  // Items WITH a moduleKey render only when:
  //   (a) we haven't loaded enablement yet (null) → fail-open, or
  //   (b) the module is enabled.
  const visibleNavItems = NAV_ITEMS.filter(item => {
    if (!item.moduleKey) return true;
    if (moduleEnablement === null) return true;
    return moduleEnablement[item.moduleKey] !== false;
  });

  const t = (en: string, hi: string) => (isHi ? hi : en);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#fafafa' }}>
      {/* ── Sidebar ── */}
      <aside
        style={{
          width: collapsed ? 56 : 220,
          background: '#fff',
          borderRight: '1px solid #e5e7eb',
          padding: '16px 0',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.2s ease',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* School branding header */}
        <div style={{ padding: '0 12px 16px', borderBottom: '1px solid #e5e7eb', minHeight: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={schoolName}
                style={{ height: 28, width: 28, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
              />
            ) : (
              <div
                style={{
                  height: 28,
                  width: 28,
                  borderRadius: 6,
                  background: primaryColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {(schoolName || 'S')[0]}
              </div>
            )}
            {!collapsed && (
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                  {schoolName || t('School Admin', 'स्कूल प्रशासन')}
                </div>
                <div style={{ fontSize: 10, color: '#888' }}>
                  {t('School Administration', 'स्कूल प्रशासन')}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(c => !c)}
          style={{
            padding: '6px 12px',
            fontSize: 11,
            color: '#888',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          {collapsed ? '→' : '←'}
        </button>

        {/* Navigation items */}
        <nav style={{ flex: 1, paddingTop: 4 }}>
          {visibleNavItems.map(item => {
            const isActive = pathname === item.href ||
              (item.href !== '/school-admin' && pathname.startsWith(item.href));
            return (
              <a
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: collapsed ? '10px 16px' : '10px 12px',
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? primaryColor : '#555',
                  background: isActive ? `${primaryColor}10` : 'transparent',
                  borderLeft: isActive ? `3px solid ${primaryColor}` : '3px solid transparent',
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  transition: 'background 0.15s',
                }}
                title={isHi ? item.labelHi : item.label}
              >
                <span style={{ fontSize: 15, flexShrink: 0 }}>{item.icon}</span>
                {!collapsed && <span>{isHi ? item.labelHi : item.label}</span>}
              </a>
            );
          })}
        </nav>

        {/* Powered by footer */}
        {(tenant.branding.showPoweredBy || tenant.schoolId) && !collapsed && (
          <div style={{ padding: '12px', fontSize: 10, color: '#aaa', borderTop: '1px solid #e5e7eb' }}>
            Powered by{' '}
            <a href="https://alfanumrik.com" style={{ color: '#7C3AED', textDecoration: 'none' }}>
              Alfanumrik
            </a>
          </div>
        )}
      </aside>

      {/* ── Main content ── */}
      <main style={{ flex: 1, padding: 24, maxWidth: 1200, overflow: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
