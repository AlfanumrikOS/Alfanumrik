'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { EmptyState, Button, LoadingFoxy, BottomNav } from '@/components/ui';

export default function Page() {
  const { isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!isLoading && !isLoggedIn) router.replace('/'); }, [isLoading, isLoggedIn, router]);
  if (isLoading) return <LoadingFoxy />;
  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="sticky top-0 z-40 border-b" style={{ background: 'rgba(251,248,244,0.88)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">←</button>
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>Coming Soon</h1>
        </div>
      </header>
      <main className="max-w-lg mx-auto px-4 py-6">
        <EmptyState icon="🚀" title="Coming Soon!" description="We are building this feature"
          action={<Button onClick={() => router.push('/dashboard')}>Go to Dashboard</Button>} />
      </main>
      <BottomNav />
    </div>
  );
}
