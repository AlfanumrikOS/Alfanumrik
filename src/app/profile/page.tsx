'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { Card, Button, Avatar, SectionHeader, LoadingFoxy, BottomNav } from '@/components/ui';

export default function ProfilePage() {
  const { student, isLoggedIn, isLoading, isHi, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => { if (!isLoading && !isLoggedIn) router.replace('/'); }, [isLoading, isLoggedIn, router]);
  if (isLoading || !student) return <LoadingFoxy />;

  const handleSignOut = async () => { await signOut(); router.replace('/'); };

  const fields = [
    { label: isHi ? 'नाम' : 'Name', value: student.name },
    { label: isHi ? 'ईमेल' : 'Email', value: student.email ?? '—' },
    { label: isHi ? 'कक्षा' : 'Grade', value: `Grade ${student.grade}` },
    { label: isHi ? 'बोर्ड' : 'Board', value: student.board ?? '—' },
    { label: isHi ? 'भाषा' : 'Language', value: student.preferred_language },
    { label: isHi ? 'विषय' : 'Subject', value: student.preferred_subject ?? '—' },
    { label: isHi ? 'स्कूल' : 'School', value: student.school_name ?? '—' },
    { label: isHi ? 'शहर' : 'City', value: student.city ?? '—' },
  ];

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="sticky top-0 z-40 border-b" style={{ background: 'rgba(251,248,244,0.88)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">←</button>
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>👤 {isHi ? 'प्रोफ़ाइल' : 'Profile'}</h1>
        </div>
      </header>
      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Avatar + Name */}
        <div className="text-center">
          <div className="inline-block"><Avatar name={student.name} size={72} /></div>
          <h2 className="text-xl font-bold mt-3" style={{ fontFamily: 'var(--font-display)' }}>{student.name}</h2>
          <p className="text-sm text-[var(--text-3)]">Grade {student.grade} · {student.board ?? 'CBSE'}</p>
          <div className="flex justify-center gap-2 mt-2">
            <span className="text-sm font-semibold gradient-text">{student.xp_total ?? 0} XP</span>
            <span className="text-[var(--text-3)]">·</span>
            <span className="text-sm font-semibold">🔥 {student.streak_days ?? 0}</span>
          </div>
        </div>

        {/* Details */}
        <Card>
          <SectionHeader>{isHi ? 'विवरण' : 'Details'}</SectionHeader>
          <div className="space-y-3 mt-3">
            {fields.map((f) => (
              <div key={f.label} className="flex justify-between items-center text-sm">
                <span className="text-[var(--text-3)]">{f.label}</span>
                <span className="font-medium">{f.value}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Actions */}
        <div className="space-y-2">
          <Button variant="ghost" fullWidth onClick={handleSignOut}>
            {isHi ? 'लॉग आउट' : 'Sign Out'}
          </Button>
        </div>

        <p className="text-center text-xs text-[var(--text-3)] pt-4">
          Alfanumrik Learning OS v1.0 · Built with ❤️ in India
        </p>
      </main>
      <BottomNav />
    </div>
  );
}
