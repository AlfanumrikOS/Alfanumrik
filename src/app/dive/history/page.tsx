'use client';

/**
 * Pedagogy v2 — Wave 2 Task 6
 * /dive/history — list of the student's past weekly Curiosity Dive artifacts.
 *
 * Reads from /api/dive/history (server-gated by ff_pedagogy_v2_weekly_dive).
 * On 404 (flag off), renders a soft fallback. Empty state when the student
 * has no artifacts yet directs them to /dive.
 *
 * Wave 3 (Monthly Synthesis) will compile artifacts into a parent-shareable
 * monthly bundle. This surface is the student's own scrollback.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';

interface ArtifactRow {
  id: string;
  isoWeek: string;
  pickerOption: 'phenomenon' | 'weak_topic' | 'own_topic';
  diveTopic: string;
  diveSubjects: string[];
  phenomenonSlug: string | null;
  title: string;
  createdAt: string;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'flag_off' }
  | { kind: 'empty' }
  | { kind: 'list'; rows: ArtifactRow[] };

const PICKER_LABEL_EN: Record<ArtifactRow['pickerOption'], string> = {
  phenomenon: 'Phenomenon',
  weak_topic: 'Weak topic',
  own_topic: 'Own topic',
};
const PICKER_LABEL_HI: Record<ArtifactRow['pickerOption'], string> = {
  phenomenon: 'सिलसिला',
  weak_topic: 'कमज़ोर विषय',
  own_topic: 'अपना विषय',
};

export default function DiveHistoryPage() {
  const router = useRouter();
  const { isHi, isLoggedIn, isLoading } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    if (isLoading) return;
    if (!isLoggedIn) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dive/history?limit=60', { credentials: 'same-origin' });
        if (cancelled) return;
        if (res.status === 404) {
          setPhase({ kind: 'flag_off' });
          return;
        }
        if (!res.ok) {
          setPhase({ kind: 'empty' });
          return;
        }
        const data = (await res.json()) as { artifacts: ArtifactRow[] };
        if (!data.artifacts || data.artifacts.length === 0) {
          setPhase({ kind: 'empty' });
          return;
        }
        setPhase({ kind: 'list', rows: data.artifacts });
      } catch {
        if (!cancelled) setPhase({ kind: 'empty' });
      }
    })();
    return () => { cancelled = true; };
  }, [isLoading, isLoggedIn]);

  if (phase.kind === 'loading') {
    return (
      <main className="app-container py-8" data-testid="dive-history-loading">
        <div className="h-32 rounded-3xl animate-pulse" style={{ background: 'var(--surface-2)' }} aria-hidden="true" />
      </main>
    );
  }

  if (phase.kind === 'flag_off') {
    return (
      <main className="app-container py-8" data-testid="dive-history-flag-off">
        <p className="text-sm text-[var(--text-2)]">
          {isHi ? 'यह सुविधा अभी आपके लिए उपलब्ध नहीं है।' : 'This feature is not available for you yet.'}
        </p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-purple-700 underline">
          {isHi ? '← डैशबोर्ड' : '← Dashboard'}
        </Link>
      </main>
    );
  }

  if (phase.kind === 'empty') {
    return (
      <main className="app-container py-8 max-w-lg mx-auto" data-testid="dive-history-empty">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-purple-900" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'मेरी डाइव डायरी' : 'My dive journal'}
          </h1>
        </header>
        <p className="text-sm text-purple-700 mb-4">
          {isHi
            ? 'अभी कोई आर्टिफ़ैक्ट नहीं है। इस सप्ताह की डाइव शुरू करो।'
            : 'No artifacts yet. Start this week\'s dive.'}
        </p>
        <Link
          href="/dive"
          className="inline-block rounded-lg bg-purple-700 text-white px-4 py-2 text-sm font-semibold"
        >
          {isHi ? 'डाइव खोलो →' : 'Open dive →'}
        </Link>
      </main>
    );
  }

  // list
  return (
    <main className="app-container py-8 max-w-lg mx-auto" data-testid="dive-history-list">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-purple-900" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? 'मेरी डाइव डायरी' : 'My dive journal'}
        </h1>
        <span className="text-xs text-purple-700">
          {isHi ? `${phase.rows.length} आर्टिफ़ैक्ट` : `${phase.rows.length} artifact${phase.rows.length === 1 ? '' : 's'}`}
        </span>
      </header>

      <ul className="space-y-3">
        {phase.rows.map((row) => (
          <li
            key={row.id}
            className="rounded-2xl border border-purple-200 bg-white p-4"
            data-testid="dive-history-item"
          >
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600">
                {row.isoWeek}
                {' · '}
                {isHi ? PICKER_LABEL_HI[row.pickerOption] : PICKER_LABEL_EN[row.pickerOption]}
              </span>
              <time className="text-[10px] text-purple-500" dateTime={row.createdAt}>
                {new Date(row.createdAt).toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
                  year: 'numeric', month: 'short', day: 'numeric',
                })}
              </time>
            </div>
            <h2 className="text-sm font-semibold text-purple-900 leading-snug mb-1">{row.title}</h2>
            <p className="text-xs text-purple-700">
              {row.diveSubjects.length > 0
                ? row.diveSubjects.join(' · ')
                : (isHi ? 'खुली खोज' : 'Open exploration')}
            </p>
          </li>
        ))}
      </ul>

      <Link href="/dashboard" className="mt-6 inline-block text-sm text-purple-700 underline">
        {isHi ? '← डैशबोर्ड' : '← Dashboard'}
      </Link>
    </main>
  );
}
