'use client';

/**
 * useMockTestState — the timer + responses + navigation state machine for
 * the mock-test runner. Extracted so <MockTestRunner /> stays under the
 * frontend agent's per-file LOC budget.
 *
 * Keeps the hook framework-pure (no Tailwind, no JSX) so it can be unit-
 * tested with a renderer like @testing-library/react-hooks in a future PR.
 *
 * Submit flow (PR-6):
 *   - localStorage write happens BEFORE the network call so a fetch failure
 *     never loses the student's responses.
 *   - 200 → stash full result in sessionStorage + route to /results page.
 *   - 402 → upgrade upsell. 401 → login. 500 → inline retry banner.
 *
 * P13 — neither the localStorage backup nor the sessionStorage stash logs
 *       student responses to console/Sentry; both are same-origin storage.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  MockTestPaper,
  MockTestQuestion,
  ResponseEntry,
  Status,
  SubmitResult,
} from './mock-test-types';

export function deriveStatus(r: ResponseEntry): Status {
  if (r.marked) return 'marked';
  if (r.selectedIndex !== null && r.selectedIndex !== undefined) return 'attempted';
  if (r.visited) return 'skipped';
  return 'unattempted';
}

export const RESULT_STORAGE_PREFIX = 'alfanumrik_mock_result_';

export interface MockTestState {
  cursor: number;
  remaining: number;
  submitted: boolean;
  submitting: boolean;
  submitError: string | null;
  submitResult: SubmitResult | null;
  responses: ResponseEntry[];
  navigateTo: (index: number) => void;
  selectOption: (optionIndex: number) => void;
  toggleMarked: () => void;
  skip: () => void;
  handleSubmit: () => void;
  retrySubmit: () => void;
}

export interface MockTestStateOptions {
  /** Injected so the hook stays framework-pure and tests can stub it. */
  onNavigate?: (path: string) => void;
}

export function useMockTestState(
  paper: MockTestPaper,
  questions: MockTestQuestion[],
  options: MockTestStateOptions = {},
): MockTestState {
  const totalSeconds = paper.duration_minutes * 60;
  const [remaining, setRemaining] = useState(totalSeconds);
  const [cursor, setCursor] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [responses, setResponses] = useState<ResponseEntry[]>(() =>
    questions.map(() => ({ selectedIndex: null, selectedIndices: [], marked: false, visited: false })),
  );

  // Mark first question visited on mount.
  useEffect(() => {
    setResponses(prev => {
      if (prev[0]?.visited) return prev;
      const next = [...prev];
      if (next[0]) next[0] = { ...next[0], visited: true };
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer in useRef to prevent drift across re-renders (mirrors quiz/page.tsx).
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (submitted) return;
    timerRef.current = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [submitted]);

  // Stash latest responses in a ref so the async submit reads the current
  // snapshot without re-binding the callback.
  const responsesRef = useRef(responses);
  responsesRef.current = responses;
  const remainingRef = useRef(remaining);
  remainingRef.current = remaining;

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    const snapshotResponses = responsesRef.current;
    const elapsed = totalSeconds - remainingRef.current;

    // ── Local backup BEFORE the network call (so a fetch failure doesn't lose work) ─
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(`alfanumrik_mock_pending_${paper.id}`, JSON.stringify({
          paper_id: paper.id,
          paper_code: paper.paper_code,
          submitted_at: new Date().toISOString(),
          duration_used_seconds: elapsed,
          responses: snapshotResponses.map((r, i) => ({
            question_id: questions[i]?.id,
            question_number: questions[i]?.question_number,
            selected_index: r.selectedIndex,
            selected_indices: r.selectedIndices,
            marked: r.marked,
          })),
        }));
      }
    } catch { /* private mode — not fatal */ }

    // ── Build payload ─────────────────────────────────────────────────────────
    const payload = {
      responses: snapshotResponses.map((r, i) => ({
        question_id: questions[i]?.id ?? '',
        response_index: r.selectedIndex,
        time_taken_seconds: undefined as number | undefined,
        marked_for_review: r.marked,
      })),
      time_taken_seconds: elapsed,
      client_metadata: typeof window !== 'undefined' ? {
        user_agent: (navigator.userAgent || '').slice(0, 200),
        screen: `${window.innerWidth}x${window.innerHeight}`,
      } : {},
    };

    // ── POST ──────────────────────────────────────────────────────────────────
    try {
      const res = await fetch(`/api/exams/papers/${paper.id}/submit`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        if (options.onNavigate) options.onNavigate(`/login?next=/exams/mock/${paper.id}`);
        setSubmitting(false);
        return;
      }
      if (res.status === 402) {
        let upgradeUrl = `/upgrade?from=mock&paper=${encodeURIComponent(paper.paper_code)}`;
        try {
          const body = await res.json();
          if (body?.upgrade_url) upgradeUrl = body.upgrade_url;
        } catch { /* ignore */ }
        if (options.onNavigate) options.onNavigate(upgradeUrl);
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        // P13: do not log response body (may contain question_text / answers).
        setSubmitError(`submit_failed_${res.status}`);
        setSubmitting(false);
        return;
      }

      const result = (await res.json()) as SubmitResult;
      setSubmitResult(result);

      // Stash for the Results page — same-origin sessionStorage only.
      try {
        if (typeof window !== 'undefined' && result?.attempt_id) {
          sessionStorage.setItem(
            `${RESULT_STORAGE_PREFIX}${result.attempt_id}`,
            JSON.stringify(result),
          );
        }
      } catch { /* private mode — not fatal */ }

      setSubmitted(true);
      setSubmitting(false);
      if (options.onNavigate) {
        options.onNavigate(`/exams/mock/${paper.id}/results?attempt=${result.attempt_id}`);
      }
    } catch {
      // Network failure — keep localStorage backup, surface inline retry.
      setSubmitError('network_error');
      setSubmitting(false);
    }
  }, [submitting, paper.id, paper.paper_code, questions, totalSeconds, options]);

  const handleSubmit = useCallback(() => {
    if (submitted || submitting) return;
    void submit();
  }, [submitted, submitting, submit]);

  const retrySubmit = useCallback(() => {
    if (submitting) return;
    setSubmitError(null);
    void submit();
  }, [submitting, submit]);

  // Auto-submit at timeout.
  useEffect(() => {
    if (remaining === 0 && !submitted && !submitting) handleSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  function navigateTo(index: number) {
    if (index < 0 || index >= questions.length) return;
    setResponses(prev => {
      const next = [...prev];
      if (next[index] && !next[index].visited) next[index] = { ...next[index], visited: true };
      return next;
    });
    setCursor(index);
  }

  function selectOption(optionIndex: number) {
    if (submitted) return;
    setResponses(prev => {
      const next = [...prev];
      const r = next[cursor];
      if (!r) return prev;
      if (questions[cursor]?.question_type === 'mcq_multi') {
        const set = new Set(r.selectedIndices ?? []);
        if (set.has(optionIndex)) set.delete(optionIndex); else set.add(optionIndex);
        next[cursor] = { ...r, selectedIndices: Array.from(set).sort(), selectedIndex: optionIndex, visited: true };
      } else {
        next[cursor] = { ...r, selectedIndex: optionIndex, visited: true };
      }
      return next;
    });
  }

  function toggleMarked() {
    if (submitted) return;
    setResponses(prev => {
      const next = [...prev];
      const r = next[cursor];
      if (!r) return prev;
      next[cursor] = { ...r, marked: !r.marked, visited: true };
      return next;
    });
  }

  function skip() {
    if (submitted) return;
    setResponses(prev => {
      const next = [...prev];
      const r = next[cursor];
      if (r) next[cursor] = { ...r, visited: true };
      return next;
    });
    navigateTo(cursor + 1);
  }

  return {
    cursor,
    remaining,
    submitted,
    submitting,
    submitError,
    submitResult,
    responses,
    navigateTo,
    selectOption,
    toggleMarked,
    skip,
    handleSubmit,
    retrySubmit,
  };
}
