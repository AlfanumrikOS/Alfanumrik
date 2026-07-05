import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'System Administration',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * Phase G.3 (Super-Admin Production-Readiness Plan, 2026-05-17): server-side
 * gate intentionally NOT placed here.
 *
 * The login page at /super-admin/login inherits this same layout (App Router
 * layouts cascade), and a redirect from this layout would infinite-loop the
 * login URL. The clean Next.js fix is route groups
 * (super-admin/(gated)/... + super-admin/(public)/login/...), which is a
 * 50-file folder move tracked as a Phase H follow-up.
 *
 * Today the data-protecting gate is `authorizeAdmin` on every
 * /api/super-admin/* route (verified by the Phase G.1 sweep) plus the
 * client-side AdminShell session check (defence in depth). The page chrome
 * structure can be observed by an unauthenticated visitor for ~150ms before
 * the client-side redirect fires; no PII leaks because every backing fetch
 * is server-gated.
 *
 * `src/lib/admin-auth-server.ts` is built and ready; Phase G.7's
 * server-action login wrapper and Phase H's route-group restructure will
 * adopt it.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ colorScheme: 'light', background: 'var(--surface-1)', color: 'var(--text-1)', minHeight: '100vh' }}>
      {children}
    </div>
  );
}
