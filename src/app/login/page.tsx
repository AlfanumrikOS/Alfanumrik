'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { LoadingFoxy } from '@/components/ui';

export default function LoginPage() {
  const { isLoggedIn, isLoading, activeRole } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const roleParam = searchParams.get('role');
  const initialRole: 'student' | 'teacher' | 'parent' =
    roleParam === 'teacher' ? 'teacher'
    : roleParam === 'parent' ? 'parent'
    : 'student';

  useEffect(() => {
    if (!isLoading && isLoggedIn) {
      if (activeRole === 'teacher') router.replace('/teacher');
      else if (activeRole === 'guardian') router.replace('/parent');
      else router.replace('/dashboard');
    }
  }, [isLoggedIn, isLoading, activeRole, router]);

  if (isLoading) return <LoadingFoxy />;

  // If logged in, the useEffect will redirect — show loading briefly
  if (isLoggedIn) {
    router.replace('/dashboard');
    return <LoadingFoxy />;
  }

  return (
    <AuthScreen
      initialRole={initialRole}
      onSuccess={() => {
        // Trigger auth state refresh — AuthContext will detect the new session
        // and the useEffect above will redirect to the correct dashboard
        router.refresh();
        router.replace('/dashboard');
      }}
    />
  );
}
