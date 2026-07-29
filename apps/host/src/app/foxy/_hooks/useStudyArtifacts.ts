'use client';

/**
 * useStudyArtifacts — the open/fetch/retry state owner for the two GenAI
 * student-facing affordances in the /foxy workspace ("Diagram" and
 * "Lesson notes").
 *
 * Owns nothing but UI orchestration:
 *   - which artifact sheet is open (`openKind`, null = closed)
 *   - the per-artifact four-state machine (loading / ready / abstained / error)
 *   - stale-response guarding, so switching chapter mid-flight can never paint
 *     the previous chapter's result
 *
 * It defines NO pedagogy and computes NO score/XP/mastery — it renders exactly
 * what the sanctioned orchestrators returned. Results are cached per
 * subject+chapter+language key for the lifetime of the mount so re-opening the
 * same sheet does not re-spend an LLM call; "Regenerate" is the explicit,
 * student-initiated way to force a fresh generation.
 *
 * `deps` is injectable so this hook is testable without a browser session.
 */

import { useCallback, useRef, useState } from 'react';
import type { DiagramSpec } from '@alfanumrik/lib/diagram/types';
import type { LessonNotes } from '@alfanumrik/lib/lesson/types';
import {
  fetchDiagramSpec,
  fetchLessonNotes,
  type ArtifactContext,
  type ArtifactFetchDeps,
  type ArtifactKind,
  type ArtifactState,
} from '../_lib/study-artifacts';

const IDLE = { status: 'idle' } as const;

function cacheKey(ctx: ArtifactContext): string {
  return `${ctx.subject}::${ctx.chapterNumber}::${ctx.chapterTitle}::${ctx.language}`;
}

export interface UseStudyArtifactsResult {
  /** null when no sheet is open. */
  openKind: ArtifactKind | null;
  diagram: ArtifactState<DiagramSpec>;
  lesson: ArtifactState<LessonNotes>;
  /** Open a sheet and fetch (or reuse the cached result for this context). */
  open: (kind: ArtifactKind, ctx: ArtifactContext) => void;
  /** Close the sheet. Results stay cached so re-opening is instant. */
  close: () => void;
  /** Force a fresh generation for the currently-open sheet. */
  regenerate: () => void;
}

export function useStudyArtifacts(
  deps?: ArtifactFetchDeps,
): UseStudyArtifactsResult {
  const [openKind, setOpenKind] = useState<ArtifactKind | null>(null);
  const [diagram, setDiagram] = useState<ArtifactState<DiagramSpec>>(IDLE);
  const [lesson, setLesson] = useState<ArtifactState<LessonNotes>>(IDLE);

  // Monotonic request ids per artifact — a response whose id is no longer the
  // latest is DROPPED (stale-while-switching guard).
  const seqRef = useRef<Record<ArtifactKind, number>>({ diagram: 0, lesson: 0 });
  // The context key each artifact's current state was produced for.
  const keyRef = useRef<Record<ArtifactKind, string | null>>({
    diagram: null,
    lesson: null,
  });
  // The last context each artifact was asked for — powers `regenerate`.
  const ctxRef = useRef<Record<ArtifactKind, ArtifactContext | null>>({
    diagram: null,
    lesson: null,
  });

  const run = useCallback(
    (kind: ArtifactKind, ctx: ArtifactContext) => {
      const id = (seqRef.current[kind] += 1);
      keyRef.current[kind] = cacheKey(ctx);
      ctxRef.current[kind] = ctx;

      if (kind === 'diagram') setDiagram({ status: 'loading' });
      else setLesson({ status: 'loading' });

      const promise =
        kind === 'diagram'
          ? fetchDiagramSpec(ctx, deps)
          : fetchLessonNotes(ctx, deps);

      void promise.then((next) => {
        // Drop a stale response (student changed chapter / hit regenerate).
        if (seqRef.current[kind] !== id) return;
        if (kind === 'diagram') setDiagram(next as ArtifactState<DiagramSpec>);
        else setLesson(next as ArtifactState<LessonNotes>);
      });
    },
    [deps],
  );

  const open = useCallback(
    (kind: ArtifactKind, ctx: ArtifactContext) => {
      setOpenKind(kind);
      const current = kind === 'diagram' ? diagram : lesson;
      const sameContext = keyRef.current[kind] === cacheKey(ctx);
      // Reuse a settled result for the SAME context (no repeat LLM spend).
      // Re-run on a context change, or when the previous attempt errored.
      if (sameContext && (current.status === 'ready' || current.status === 'abstained')) {
        ctxRef.current[kind] = ctx;
        return;
      }
      if (sameContext && current.status === 'loading') {
        return;
      }
      run(kind, ctx);
    },
    [diagram, lesson, run],
  );

  const close = useCallback(() => setOpenKind(null), []);

  const regenerate = useCallback(() => {
    if (!openKind) return;
    const ctx = ctxRef.current[openKind];
    if (!ctx) return;
    run(openKind, ctx);
  }, [openKind, run]);

  return { openKind, diagram, lesson, open, close, regenerate };
}
