import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'System Administration',
  robots: { index: false, follow: false },
};

// Force dynamic rendering — these pages use Supabase client which
// requires runtime env vars not available during static generation
export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
