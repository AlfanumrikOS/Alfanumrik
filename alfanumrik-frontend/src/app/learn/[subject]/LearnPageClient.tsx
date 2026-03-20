'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import BottomNav from '@/components/BottomNav';
import { supabase } from '@/lib/supabase';

export default function LearnPageClient() {
  const params = useParams();
  const subject = params?.subject as string;
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const [topics, setTopics] = useState<any[]>([]);
  const [subjectData, setSubjectData] = useState<any>(null);

  useEffect(() => { if (!isLoading && !isLoggedIn) router.replace('/'); }, [isLoading, isLoggedIn, router]);
  useEffect(() => {
    if (!subject) return;
    supabase.from('subjects').select('*').eq('code', subject).single().then(({ data }) => setSubjectData(data));
    if (student) {
      supabase.from('curriculum_topics').select('*').eq('is_active', true)
        .order('display_order').limit(30)
        .then(({ data }) => setTopics(data ?? []));
    }
    if (student) supabase.from('students').update({ preferred_subject: subject }).eq('id', student.id);
  }, [subject, student?.id]); // eslint-disable-line

  if (isLoading || !student) return <div className="mesh-bg min-h-dvh flex items-center justify-center"><div className="text-5xl animate-float">🦊</div></div>;

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="glass border-b border-[var(--border)]">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">←</button>
          <span className="text-xl">{subjectData?.icon ?? '📚'}</span>
          <h1 className="font-bold text-lg" style={{ fontFamily: 'var(--font-display)' }}>{subjectData?.name ?? subject}</h1>
        </div>
      </header>
      <div className="max-w-lg mx-auto px-4 py-4">
        <div className="flex gap-3 mb-4">
          <button className="btn-primary flex-1" onClick={() => router.push('/foxy')}>🦊 {isHi ? 'फॉक्सी से सीखो' : 'Learn with Foxy'}</button>
          <button className="btn-ghost flex-1" onClick={() => router.push('/quiz')}>⚡ {isHi ? 'क्विज़' : 'Quiz'}</button>
        </div>
        {topics.length > 0 && (
          <div className="glass rounded-2xl p-4 space-y-2">
            <h2 className="font-bold mb-3">{isHi ? 'विषय सूची' : 'Topics'}</h2>
            {topics.slice(0,10).map((t, i) => (
              <button key={t.id} onClick={() => router.push('/foxy')}
                className="w-full glass-mid rounded-xl p-3 text-left flex items-center gap-3 card-hover">
                <span className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: `${subjectData?.color ?? 'var(--orange)'}20`, color: subjectData?.color ?? 'var(--orange)' }}>{i+1}</span>
                <span className="text-sm font-medium">{(isHi && t.title_hi) ? t.title_hi : t.title}</span>
                <span className="ml-auto text-[var(--text-3)]">→</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
