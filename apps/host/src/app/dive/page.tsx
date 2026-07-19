'use client';

/**
 * Pedagogy v2 — Wave 2 Task 5b
 * /dive — weekly Curiosity Dive surface.
 *
 * State machine (client-side):
 *   loading -> picker | completed | flag_off
 *      picker -> dive_active (post /api/dive/start)
 *      dive_active -> just_saved (post /api/dive/artifact 200)
 *      dive_active -> dive_active (artifact composer error)
 *
 * Wave 2 v1 simplification: the Foxy explorer chat opens in a new tab
 * (`/foxy?mode=explorer&...`). Embedding the chat directly inside /dive is a
 * follow-on enhancement — the artifact composer is fully usable on its own
 * once the student has had the chat.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import Picker, { type PickerPhenomenon, type PickerWeakTopic } from '@alfanumrik/ui/dive/Picker';
import ArtifactComposer from '@alfanumrik/ui/dive/ArtifactComposer';

interface DiveStateResponse {
  state: 'open' | 'completed';
  currentIsoWeek: string;
  lastCompletedIsoWeek: string | null;
  weeklyStreakCount: number;
  defaultPicker: 'phenomenon' | 'weak_topic' | 'own_topic';
  showPhenomenonOption: boolean;
  showWeakTopicOption: boolean;
  showOwnTopicOption: boolean;
  eligiblePhenomena: PickerPhenomenon[];
  weakTopics: PickerWeakTopic[];
}

interface ResolvedDive {
  pickerOption: 'phenomenon' | 'weak_topic' | 'own_topic';
  diveTopic: string;
  diveSubjects: string[];
  phenomenonSlug: string | null;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'flag_off' }
  | { kind: 'completed'; weeklyStreakCount: number; isoWeek: string }
  | { kind: 'picker'; state: DiveStateResponse }
  | { kind: 'dive_active'; resolved: ResolvedDive; state: DiveStateResponse }
  | { kind: 'just_saved'; weeklyStreakCount: number; isoWeek: string };

export default function DivePage() {
  const router = useRouter();
  const { isHi, isLoggedIn, isLoading } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [pickerError, setPickerError] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!isLoggedIn) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dive/state', { credentials: 'same-origin' });
        if (cancelled) return;
        if (res.status === 404) {
          setPhase({ kind: 'flag_off' });
          return;
        }
        if (!res.ok) {
          setPhase({ kind: 'flag_off' });
          return;
        }
        const data = (await res.json()) as DiveStateResponse;
        if (data.state === 'completed') {
          setPhase({ kind: 'completed', weeklyStreakCount: data.weeklyStreakCount, isoWeek: data.currentIsoWeek });
        } else {
          setPhase({ kind: 'picker', state: data });
        }
      } catch {
        if (!cancelled) setPhase({ kind: 'flag_off' });
      }
    })();
    return () => { cancelled = true; };
  }, [isLoading, isLoggedIn, router]);

  async function handlePickerCommit(payload:
    | { pickerOption: 'phenomenon'; phenomenonSlug: string }
    | { pickerOption: 'weak_topic'; weakTopicId: string }
    | { pickerOption: 'own_topic'; ownTopic: string },
  ) {
    if (phase.kind !== 'picker') return;
    const res = await fetch('/api/dive/start', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setPickerError(true);
      setTimeout(() => setPickerError(false), 4000);
      return;
    }
    const resolved = (await res.json()) as Omit<ResolvedDive, 'pickerOption'> & { phenomenonSlug: string | null };
    setPhase({
      kind: 'dive_active',
      state: phase.state,
      resolved: {
        pickerOption: payload.pickerOption,
        diveTopic: resolved.diveTopic,
        diveSubjects: resolved.diveSubjects,
        phenomenonSlug: resolved.phenomenonSlug,
      },
    });
  }

  if (phase.kind === 'loading') {
    return (
      <main className="app-container py-8" data-testid="dive-loading">
        <div className="h-32 rounded-3xl animate-pulse" style={{ background: 'var(--surface-2)' }} aria-hidden="true" />
      </main>
    );
  }

  if (phase.kind === 'flag_off') {
    return (
      <main className="app-container py-8" data-testid="dive-flag-off">
        <p className="text-sm text-[var(--text-2)]">
          {isHi ? 'यह सुविधा अभी आपके लिए उपलब्ध नहीं है।' : 'This feature is not available for you yet.'}
        </p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-purple-700 underline">
          {isHi ? '← डैशबोर्ड पर वापस जाओ' : '← Back to dashboard'}
        </Link>
      </main>
    );
  }

  if (phase.kind === 'completed' || phase.kind === 'just_saved') {
    return (
      <main className="app-container py-8 max-w-lg mx-auto" data-testid="dive-completed">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-purple-900" style={{ fontFamily: 'var(--font-display)' }}>
            {phase.kind === 'just_saved'
              ? (isHi ? 'इस सप्ताह की डाइव हो गई!' : 'This week\'s dive: done!')
              : (isHi ? 'इस सप्ताह की डाइव पूरी' : "This week's dive is complete")}
          </h1>
          <p className="text-sm text-purple-700 mt-1">
            {isHi
              ? `सप्ताह ${phase.isoWeek} · ${phase.weeklyStreakCount}-सप्ताह की लय`
              : `Week ${phase.isoWeek} · ${phase.weeklyStreakCount}-week rhythm`}
          </p>
        </header>
        <div
          className="rounded-3xl border border-purple-200 bg-gradient-to-br from-purple-50 to-orange-50 p-5"
          data-testid="dive-streak-badge"
        >
          <p className="text-sm text-purple-900">
            {isHi
              ? 'अगले सोमवार को नई डाइव शुरू कर सकते हो।'
              : 'A new dive opens next Monday.'}
          </p>
        </div>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-purple-700 underline">
          {isHi ? '← डैशबोर्ड पर वापस जाओ' : '← Back to dashboard'}
        </Link>
      </main>
    );
  }

  if (phase.kind === 'picker') {
    return (
      <main className="app-container py-8 max-w-lg mx-auto" data-testid="dive-picker-host">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-purple-900" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'इस सप्ताह की 60-मिनट डाइव' : "This week's 60-minute dive"}
          </h1>
          <p className="text-sm text-purple-700 mt-1">
            {isHi
              ? 'एक विषय चुनो, फॉक्सी से बात करो, और एक छोटी कलाकृति सेव करो।'
              : 'Pick a topic, talk to Foxy, save a short artifact.'}
          </p>
        </header>
        {pickerError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-4 text-sm text-red-800" role="alert">
            {isHi ? 'कुछ गलत हो गया — फिर से कोशिश करो।' : 'Something went wrong — please try again.'}
          </div>
        )}
        <Picker
          defaultPicker={phase.state.defaultPicker}
          showPhenomenonOption={phase.state.showPhenomenonOption}
          showWeakTopicOption={phase.state.showWeakTopicOption}
          showOwnTopicOption={phase.state.showOwnTopicOption}
          eligiblePhenomena={phase.state.eligiblePhenomena}
          weakTopics={phase.state.weakTopics}
          onCommit={handlePickerCommit}
        />
      </main>
    );
  }

  // dive_active
  const foxyHref = `/foxy?mode=explorer&topic=${encodeURIComponent(phase.resolved.diveTopic)}`;
  return (
    <main className="app-container py-8 max-w-lg mx-auto" data-testid="dive-active">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-purple-900" style={{ fontFamily: 'var(--font-display)' }}>
          {phase.resolved.diveTopic}
        </h1>
        <p className="text-sm text-purple-700 mt-1">
          {phase.resolved.diveSubjects.length > 0
            ? phase.resolved.diveSubjects.join(' · ')
            : (isHi ? 'खुली खोज' : 'Open exploration')}
        </p>
      </header>

      <section
        className="rounded-2xl border border-purple-200 bg-purple-50 p-4 mb-6"
        data-testid="dive-foxy-cta"
      >
        <p className="text-sm font-semibold text-purple-900 mb-1">
          {isHi ? '1. फॉक्सी के साथ बात करो' : '1. Talk to Foxy'}
        </p>
        <p className="text-xs text-purple-700 mb-3">
          {isHi
            ? 'नए टैब में फॉक्सी खोलो, इस विषय को समझो। फिर यहाँ वापस आकर आर्टिफ़ैक्ट लिखो।'
            : 'Open Foxy in a new tab, explore this topic, then come back to write the artifact.'}
        </p>
        <a
          href={foxyHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded-lg bg-purple-700 text-white px-4 py-2 text-sm font-semibold"
          data-testid="dive-foxy-link"
        >
          🦊 {isHi ? 'फॉक्सी खोलो (नया टैब)' : 'Open Foxy (new tab)'}
        </a>
      </section>

      <section data-testid="dive-composer-section">
        <p className="text-sm font-semibold text-purple-900 mb-2">
          {isHi ? '2. आर्टिफ़ैक्ट लिखो' : '2. Write the artifact'}
        </p>
        <ArtifactComposer
          pickerOption={phase.resolved.pickerOption}
          diveTopic={phase.resolved.diveTopic}
          diveSubjects={phase.resolved.diveSubjects}
          phenomenonSlug={phase.resolved.phenomenonSlug}
          onSaved={(result) => setPhase({
            kind: 'just_saved',
            weeklyStreakCount: result.weeklyStreakCount,
            isoWeek: result.isoWeek,
          })}
        />
      </section>
    </main>
  );
}
