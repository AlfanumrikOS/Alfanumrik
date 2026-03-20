'use client';

import { useRouter } from 'next/navigation';
import { useStudent } from '@/components/StudentProvider';
import { ArrowLeft, FlaskConical } from 'lucide-react';

const SIMS = [
  { id: 'ohm', title: "Ohm's Law Circuit", titleHi: 'ओम का नियम', icon: '⚡', color: '#00B4D8' },
  { id: 'projectile', title: 'Projectile Motion', titleHi: 'प्रक्षेप्य गति', icon: '🚀', color: '#FF6B35' },
  { id: 'lens', title: 'Lens Ray Diagram', titleHi: 'लेंस किरण आरेख', icon: '🔍', color: '#9B4DAE' },
];

export default function SimulationsPage() {
  const { student, isLoggedIn, isLoading, isHi } = useStudent();
  const router = useRouter();

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><div className="text-2xl animate-pulse">🦊</div></div>;
  if (!isLoggedIn || !student) { router.push('/'); return null; }

  return (
    <div className="min-h-screen pb-24">
      <div className="sticky top-0 z-50 glass border-b border-white/5">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')}><ArrowLeft className="w-5 h-5 text-white/40" /></button>
          <FlaskConical className="w-5 h-5" style={{color:'#00B4D8'}} />
          <span className="font-bold">{isHi ? 'सिमुलेशन लैब' : 'Simulation Lab'}</span>
        </div>
      </div>
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-3">
        <p className="text-sm text-white/40 mb-4">{isHi ? 'इंटरैक्टिव प्रयोग — जल्द आ रहे हैं!' : 'Interactive experiments — coming soon!'}</p>
        {SIMS.map(sim => (
          <div key={sim.id} className="glass rounded-xl p-5 flex items-center gap-4" style={{opacity: 0.5}}>
            <span className="text-3xl">{sim.icon}</span>
            <div><div className="font-bold">{isHi ? sim.titleHi : sim.title}</div><div className="text-xs text-white/25">{isHi ? 'जल्द आ रहा है' : 'Coming soon'}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}
