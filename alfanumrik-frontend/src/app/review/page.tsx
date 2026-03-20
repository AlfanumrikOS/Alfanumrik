'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { getDueReviews } from '@/lib/supabase';
import { ArrowLeft, RotateCcw, CheckCircle2 } from 'lucide-react';

export default function ReviewPage() {
  const { student, isLoggedIn, isLoading, isHi } = useStudent();
  const router = useRouter();
  const [dueCount, setDueCount] = useState(0);
  const [cards, setCards] = useState<Array<{card_id:string;concept_id:string;title_en:string;title_hi:string}>>([]);

  useEffect(() => {
    if (!isLoggedIn && !isLoading) { router.push('/'); return; }
    if (student?.id) getDueReviews(student.id, 20).then(r => { if (r) { setDueCount(r.due_count); setCards(r.cards); } });
  }, [isLoggedIn, isLoading, student?.id]);

  if (isLoading || !student) return <div className="min-h-screen flex items-center justify-center"><div className="text-2xl animate-pulse">🦊</div></div>;

  return (
    <div className="min-h-screen pb-24">
      <div className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button>
          <RotateCcw className="w-5 h-5" style={{color:'#FFB800'}} />
          <span className="font-bold">{isHi ? 'रिव्यू' : 'Spaced Review'}</span>
          <span className="text-xs text-white/30 ml-auto">{dueCount} {isHi ? 'बाकी' : 'due'}</span>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 pt-6">
        {dueCount === 0 ? (
          <div className="glass rounded-2xl p-8 text-center">
            <CheckCircle2 className="w-16 h-16 mx-auto mb-4 text-green-400" />
            <h2 className="text-xl font-bold mb-2">{isHi ? 'सब पूरा!' : 'All Caught Up!'}</h2>
            <p className="text-sm text-white/40">{isHi ? 'कोई रिव्यू बाकी नहीं। बाद में वापस आओ!' : 'No reviews due. Come back later!'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {cards.map(card => (
              <button key={card.card_id} onClick={() => router.push('/quiz')} className="w-full glass rounded-xl p-4 text-left flex items-center gap-3 transition-all hover:scale-[1.01]">
                <RotateCcw className="w-5 h-5 flex-shrink-0" style={{color:'#FFB800'}} />
                <div><div className="font-bold text-sm">{isHi && card.title_hi ? card.title_hi : card.title_en}</div><div className="text-xs text-white/25">{isHi ? 'रिव्यू करो' : 'Review now'}</div></div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
