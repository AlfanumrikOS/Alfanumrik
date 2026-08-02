'use client';

/**
 * usePlacement — drives the six-probe placement check for one subject.
 *
 * Fetches the probes, holds the index, posts each answer with an idempotency
 * key generated AT ANSWER TIME (never at retry time), and reports completion.
 * Failure to post never blocks the student: the flow moves on and the event is
 * simply absent, which the projector treats as no signal rather than a wrong
 * answer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { authHeader } from '@alfanumrik/lib/api/auth-header';
import type { PlacementQuestion, PlacementAnswer } from './types';

interface PlacementResponse {
  schemaVersion: 1;
  subject: string;
  grade: string;
  questions: Array<{
    id: string;
    topicId: string | null;
    chapterNumber: number | null;
    stem: string;
    options: Array<{ id: string; label: string }>;
  }>;
}

async function fetchPlacement(key: string): Promise<PlacementResponse | null> {
  const subject = key.split('|')[1];
  const res = await fetch('/api/v2/placement?subject=' + encodeURIComponent(subject ?? ''), {
    credentials: 'same-origin',
    headers: { ...(await authHeader()) },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('placement.fetch_failed');
  const body = await res.json();
  return (body.data ?? body) as PlacementResponse;
}

export function usePlacement(subject: string | null, onComplete: () => void) {
  const { data, error, isLoading } = useSWR<PlacementResponse | null>(
    subject ? 'v2/placement|' + subject : null,
    fetchPlacement,
    { revalidateOnFocus: false },
  );

  const [index, setIndex] = useState(0);
  // `subject` is a deliberate re-key, not a stale-closure read: a new
  // placement session (and a fresh id) is minted whenever the caller switches
  // subjects, even though the generator itself never reads `subject`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sessionId = useMemo(() => crypto.randomUUID(), [subject]);

  useEffect(() => {
    setIndex(0);
  }, [subject]);

  const questions: PlacementQuestion[] = (data?.questions ?? []).map((q) => ({
    id: q.id,
    // Pass through verbatim — do NOT fall back to q.id. A question's own id
    // is never a valid curriculum_topics.id, and defaulting to it here used
    // to produce a fake topic id that always failed the learning_events
    // topic_id FK on submit (silently swallowed by submit()'s try/catch).
    topicId: q.topicId,
    stem: q.stem,
    options: q.options,
  }));

  const submit = useCallback(
    async (answer: PlacementAnswer) => {
      // Key minted here, at the moment the student answered. A key minted on
      // retry would let one answer count twice.
      const idempotencyKey = crypto.randomUUID();
      const occurredAt = new Date().toISOString();

      // Advance immediately — the network must never make the student wait.
      setIndex((i) => {
        const next = i + 1;
        if (next >= questions.length) onComplete();
        return next;
      });

      try {
        await fetch('/api/v2/placement/answer', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({
            sessionId,
            questionId: answer.questionId,
            topicId: answer.topicId,
            optionId: answer.optionId,
            unseen: answer.unseen,
            idempotencyKey,
            occurredAt,
          }),
        });
      } catch {
        // No signal is fine. A blocked student is not.
      }
    },
    [questions.length, onComplete, sessionId],
  );

  return { questions, index, isLoading, error, submit, skipAll: onComplete };
}
