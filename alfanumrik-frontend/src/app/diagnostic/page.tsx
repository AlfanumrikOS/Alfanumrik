'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import BottomNav from '@/components/BottomNav';
import { useEffect } from 'react';

export default function Page() {
  const { isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!isLoading && !isLoggedIn) router.replace('/'); }, [isLoading, isLoggedIn, router]);
  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="glass border-b border-[var(--border)]">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">←</button>
          <h1 className="font-bold text-lg capitalize" style={{ fontFamily: 'var(--font-display)' }}>diagnostic</h1>
        </div>
      </header>
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <div className="text-5xl mb-4 animate-float">🦊</div>
        <h2 className="font-bold text-xl mb-2" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? 'जल्द आ रहा है!' : 'Coming Soon!'}</h2>
        <p className="text-sm text-[var(--text-3)]">{isHi ? 'यह फीचर जल्दी आएगा।' : 'This feature is on the way.'}</p>
        <button className="btn-primary mt-6" onClick={() => router.push('/foxy')}>{isHi ? 'फॉक्सी से पूछो' : 'Ask Foxy Instead'}</button>
      </div>
      <BottomNav />
    </div>
  );
}
