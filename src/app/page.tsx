'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';

/**
 * Root page — redirects to the correct destination:
 * - Authenticated → /dashboard
 * - Unauthenticated → /welcome (handled by middleware, this is fallback)
 */
export default function RootPage() {
  const { isLoggedIn, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      router.replace(isLoggedIn ? '/dashboard' : '/welcome');
    }
  }, [isLoggedIn, isLoading, router]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--bg, #FBF8F4)',
    }}>
      <div style={{ width: 40, height: 40, borderRadius: '50%', border: '3px solid var(--surface-2)', borderTopColor: 'var(--orange)', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
