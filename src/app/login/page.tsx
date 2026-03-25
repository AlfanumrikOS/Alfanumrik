'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { LoadingFoxy } from '@/components/ui';

export default function LoginPage() {
  const { isLoggedIn, isLoading, activeRole } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isLoggedIn) {
      // Already logged in — redirect to appropriate dashboard
      if (activeRole === 'teacher') router.replace('/teacher');
      else if (activeRole === 'guardian') router.replace('/parent');
      else router.replace('/dashboard');
    }
  }, [isLoggedIn, isLoading, activeRole, router]);

  if (isLoading) return <LoadingFoxy />;
  if (isLoggedIn) return <LoadingFoxy />; // Brief flash while redirecting

  return <AuthScreen onSuccess={() => window.location.reload()} />;
}
