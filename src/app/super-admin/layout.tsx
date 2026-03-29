import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'System Administration',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ colorScheme: 'light', background: '#FFFFFF', color: '#111827', minHeight: '100vh' }}>
      {children}
    </div>
  );
}
