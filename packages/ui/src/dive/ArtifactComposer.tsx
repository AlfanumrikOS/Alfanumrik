'use client';

/**
 * Pedagogy v2 — Wave 2 Task 5b
 * <ArtifactComposer/> — student-edited form that becomes a dive_artifacts row.
 *
 * Posts to /api/dive/artifact. Surfaces the route's validation errors as
 * inline messages. On success, calls onSaved with the new streak count
 * and isoWeek so the parent can transition to the "completed" state.
 */
import { useState } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';

export interface ArtifactComposerProps {
  pickerOption: 'phenomenon' | 'weak_topic' | 'own_topic';
  diveTopic: string;
  diveSubjects: string[];
  phenomenonSlug: string | null;
  onSaved: (result: { artifactId: string; weeklyStreakCount: number; isoWeek: string }) => void;
}

const KEY_CONCEPTS_MIN = 1;
const KEY_CONCEPTS_MAX = 12;

export default function ArtifactComposer(props: ArtifactComposerProps) {
  const { isHi } = useAuth();
  const [title, setTitle] = useState<string>(props.diveTopic);
  const [keyConceptsText, setKeyConceptsText] = useState<string>('');
  const [workedExample, setWorkedExample] = useState<string>('');
  const [studentVoice, setStudentVoice] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keyConcepts = keyConceptsText
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const conceptsValid = keyConcepts.length >= KEY_CONCEPTS_MIN && keyConcepts.length <= KEY_CONCEPTS_MAX;
  const studentVoiceValid = studentVoice.trim().length >= 20;
  const canSubmit = !submitting && title.trim().length > 0 && conceptsValid && studentVoiceValid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/dive/artifact', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickerOption: props.pickerOption,
          diveTopic: props.diveTopic,
          diveSubjects: props.diveSubjects,
          phenomenonSlug: props.phenomenonSlug,
          title: title.trim(),
          keyConcepts,
          workedExample: workedExample.trim() || undefined,
          studentVoice: studentVoice.trim(),
        }),
      });
      if (res.status === 409) {
        setError(isHi ? 'इस सप्ताह का आर्टिफ़ैक्ट पहले ही सेव हो चुका है।' : 'You already saved this week\'s artifact.');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error || 'save_failed');
        return;
      }
      const data = (await res.json()) as { artifactId: string; weeklyStreakCount: number; isoWeek: string };
      props.onSaved(data);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'fetch_failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="dive-artifact-composer">
      <Field label={isHi ? 'शीर्षक' : 'Title'}>
        <input
          type="text"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm"
          required
          data-testid="dive-artifact-title"
        />
      </Field>

      <Field
        label={isHi ? 'मुख्य अवधारणाएँ (एक प्रति पंक्ति)' : 'Key concepts (one per line)'}
        hint={
          isHi
            ? `${keyConcepts.length}/${KEY_CONCEPTS_MAX} पंक्तियाँ`
            : `${keyConcepts.length}/${KEY_CONCEPTS_MAX} lines`
        }
      >
        <textarea
          value={keyConceptsText}
          onChange={(e) => setKeyConceptsText(e.target.value)}
          rows={4}
          placeholder={isHi ? 'पहली अवधारणा\nदूसरी अवधारणा' : 'first concept\nsecond concept'}
          className="w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm font-mono"
          data-testid="dive-artifact-keyconcepts"
        />
      </Field>

      <Field label={isHi ? 'हल किया गया उदाहरण (वैकल्पिक)' : 'Worked example (optional)'}>
        <textarea
          value={workedExample}
          onChange={(e) => setWorkedExample(e.target.value)}
          rows={4}
          maxLength={4000}
          className="w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm"
          data-testid="dive-artifact-workedexample"
        />
      </Field>

      <Field
        label={isHi ? 'मैंने क्या समझा (अपने शब्दों में)' : 'What I figured out (in your own words)'}
        hint={isHi ? 'कम से कम एक वाक्य' : 'at least one sentence'}
      >
        <textarea
          value={studentVoice}
          onChange={(e) => setStudentVoice(e.target.value)}
          rows={5}
          minLength={20}
          maxLength={4000}
          required
          className="w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm"
          data-testid="dive-artifact-studentvoice"
        />
      </Field>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800" data-testid="dive-artifact-error">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-xl bg-purple-700 text-white py-3 text-sm font-semibold disabled:opacity-50"
        data-testid="dive-artifact-save"
      >
        {submitting
          ? (isHi ? 'सेव हो रहा है…' : 'Saving…')
          : (isHi ? 'इस सप्ताह का आर्टिफ़ैक्ट सेव करो' : "Save this week's artifact")}
      </button>
    </form>
  );
}

function Field(props: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-semibold text-purple-900">{props.label}</span>
        {props.hint && <span className="text-[10px] text-purple-600">{props.hint}</span>}
      </div>
      {props.children}
    </label>
  );
}
