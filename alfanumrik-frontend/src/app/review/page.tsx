'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import BottomNav from '@/components/BottomNav';
import { getDueReviews } from '@/lib/supabase';

export default function ReviewPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const [cards, setCards] = useState<Array<{ topic_id: string; title: string; title_hi: string; mastery_probability: number }>>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { if (!isLoading && !isLoggedIn) router.replace('/'); }, [isLoading, isLoggedIn, router]);
  useEffect(() => {
    if (!student) return;
    getDueReviews(student.id, undefined, 20).then(r => { setCards(r as any); setLoaded(true); });
  }, [student?.id]); // eslint-disable-line

  if (isLoading || !student) return <div className="mesh-bg min-h-dvh flex items-center justify-center"><div className="text-5xl animate-float">🦊</div></div>;

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="glass border-b border-[var(--border)]">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">←</button>
          <h1 className="font-bold text-lg" style={{ fontFamily: 'var(--font-display)' }}>
            🔄 {isHi ? 'स्पेस्ड रिव्यू' : 'Spaced Review'}
          </h1>
          {cards.length > 0 && <span className="ml-auto text-xs px-2 py-1 rounded-full" style={{ background: 'rgba(255,107,53,0.15)', color: 'var(--orange)' }}>{cards.length} {isHi ? 'बाकी' : 'due'}</span>}
        </div>
      </header>
      <div className="max-w-lg mx-auto px-4 py-6">
        {!loaded ? (
          <div className="flex justify-center pt-12"><div className="text-4xl animate-float">🔄</div></div>
        ) : cards.length === 0 ? (
          <div className="glass rounded-3xl p-10 text-center">
            <div className="text-6xl mb-4">✅</div>
            <h2 className="text-xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>{isHi ? 'सब पूरा!' : 'All Caught Up!'}</h2>
            <p className="text-sm text-[var(--text-3)]">{isHi ? 'कोई रिव्यू बाकी नहीं। कल वापस आओ!' : 'No reviews due. Come back tomorrow!'}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-[var(--text-3)] mb-3">{isHi ? 'इन विषयों को दोहराओ:' : 'Review these topics to strengthen memory:'}</p>
            {cards.map(c => (
              <button key={c.topic_id} onClick={() => router.push('/foxy')}
                className="glass-mid w-full rounded-xl p-4 flex items-center gap-3 card-hover">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: `rgba(255,184,0,${0.1 + (1 - (c.mastery_probability ?? 0.5)) * 0.2})` }}>🔄</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{(isHi && c.title_hi) ? c.title_hi : c.title}</div>
                  <div className="text-xs text-[var(--text-3)]">
                    {isHi ? 'महारत:' : 'Mastery:'} {Math.round((c.mastery_probability ?? 0) * 100)}%
                  </div>
                </div>
                <span className="text-[var(--text-3)]">→</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
