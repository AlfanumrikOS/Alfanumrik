'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useTenant } from '@/lib/tenant-context';
import { supabase } from '@/lib/supabase';

/* ─── P7: Bilingual labels ─── */
const NAV_ITEMS = [
  { href: '/school-admin', label: 'Dashboard', labelHi: 'डैशबोर्ड', icon: '▦' },
  { href: '/school-admin/students', label: 'Students', labelHi: 'छात्र', icon: '⊕' },
  { href: '/school-admin/teachers', label: 'Teachers', labelHi: 'शिक्षक', icon: '⊛' },
  { href: '/school-admin/classes', label: 'Classes', labelHi: 'कक्षाएँ', icon: '⊞' },
  { href: '/school-admin/invite-codes', label: 'Invite Codes', labelHi: 'आमंत्रण कोड', icon: '⊡' },
  { href: '/school-admin/setup', label: 'Branding', labelHi: 'ब्रांडिंग', icon: '◎' },
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
            const s = data.schools as { name: string; logo_url: string | null; primary_color: string | null };
            setSchoolName(s.name);
            if (s.logo_url) setLogoUrl(s.logo_url);
          }
        });
    }
  }, [authUserId, tenant.schoolName, router]);

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
          {NAV_ITEMS.map(item => {
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
