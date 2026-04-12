'use client';

import { usePathname } from 'next/navigation';
import { colors } from '../../_components/admin-styles';

const TABS = [
  { key: 'dashboard', label: 'Dashboard', href: 'dashboard' },
  { key: 'progress', label: 'Progress', href: 'progress' },
  { key: 'foxy', label: 'Foxy', href: 'foxy' },
  { key: 'quizzes', label: 'Quizzes', href: 'quizzes' },
] as const;

export default function ViewAsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Determine active tab from path
  const activeTab =
    TABS.find((t) => pathname.endsWith(`/${t.key}`))?.key || 'dashboard';

  // Extract studentId from pathname: /super-admin/view-as/[studentId]/...
  const segments = pathname.split('/');
  const viewAsIdx = segments.indexOf('view-as');
  const studentId = viewAsIdx >= 0 ? segments[viewAsIdx + 1] : '';

  return (
    <div
      style={{
        fontFamily:
          "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
        minHeight: '100vh',
        background: colors.bg,
        color: colors.text1,
        colorScheme: 'light',
      }}
    >
      {/* Red banner */}
      <div
        style={{
          background: colors.danger,
          color: '#fff',
          padding: '8px 16px',
          fontSize: 12,
          fontWeight: 600,
          textAlign: 'center',
          letterSpacing: 0.5,
        }}
      >
        READ-ONLY VIEW &mdash; Admin impersonation active
      </div>

      {/* Tab navigation */}
      <nav
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: `1px solid ${colors.border}`,
          background: colors.surface,
          padding: '0 16px',
        }}
      >
        {TABS.map((tab) => (
          <a
            key={tab.key}
            href={`/super-admin/view-as/${studentId}/${tab.href}`}
            style={{
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? colors.text1 : colors.text2,
              borderBottom:
                activeTab === tab.key
                  ? `2px solid ${colors.text1}`
                  : '2px solid transparent',
              textDecoration: 'none',
            }}
          >
            {tab.label}
          </a>
        ))}
      </nav>

      {/* Page content */}
      <main style={{ padding: '20px 24px', maxWidth: 1200 }}>
        {children}
      </main>
    </div>
  );
}