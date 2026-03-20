'use client';

import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { SUBJECT_CONFIG, type Subject } from '@/lib/types';
import { ArrowLeft, Activity, Brain } from 'lucide-react';

export default function DiagnosticPage() {
  const { student, isLoggedIn, isLoading, isHi } = useStudent();
  const router = useRouter();

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><div className="text-2xl animate-pulse">🦊</div></div>;
  if (!isLoggedIn || !student) { router.push('/'); return null; }

  const subjectCfg = SUBJECT_CONFIG[(student.subject as Subject) || 'math'];

  return (
    <div className="min-h-screen pb-24">
      <div className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button>
          <Activity className="w-5 h-5" style={{color: subjectCfg.color}} />
          <span className="font-bold">{isHi ? 'डायग्नोस्टिक टेस्ट' : 'Diagnostic Test'}</span>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 pt-8">
        <div className="glass rounded-2xl p-8 text-center">
          <Brain className="w-16 h-16 mx-auto mb-4 text-white/20" />
          <h2 className="text-xl font-bold mb-2">{isHi ? 'डायग्नोस्टिक टेस्ट' : 'Diagnostic Assessment'}</h2>
          <p className="text-sm text-white/40 mb-6">{isHi ? 'यह फीचर जल्द आ रहा है! अभी क्विज़ खेलो या फॉक्सी से बात करो।' : 'Coming soon! For now, try the Quiz or chat with Foxy to test your knowledge.'}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => router.push('/quiz')} className="px-6 py-3 rounded-xl font-bold text-white" style={{background:'linear-gradient(135deg,#FF6B35,#FFB800)'}}>{isHi ? 'क्विज़ खेलो' : 'Play Quiz'}</button>
            <button onClick={() => router.push('/foxy')} className="px-6 py-3 rounded-xl font-bold border border-white/10 text-white/60">{isHi ? 'फॉक्सी से पूछो' : 'Ask Foxy'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
