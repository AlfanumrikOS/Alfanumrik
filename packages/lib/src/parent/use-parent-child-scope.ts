'use client';

/**
 * useParentChildScope — shared hook that resolves the parent's guardian +
 * child scope for any parent-portal page. Extracted from
 * `parent/reports/page.tsx` (the 1455-1509 block) so `parent/progress/page.tsx`
 * and any future parent surface stop duplicating the flow.
 *
 * Responsibilities:
 *   1. Wait for AuthContext to resolve.
 *   2. If guardian → call parent-portal `get_children`, resolve requested
 *      childId against the authorized list, fall back to first child.
 *   3. If link-code session → load pinned single child from sessionStorage.
 *
 * P13: no PII in logs. All names/ids come from the authenticated server call.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { usePortalAction } from '@alfanumrik/lib/usePortalFetch';

export interface ParentScopeChild {
  id: string;
  name: string;
  grade: string;
}
export interface ParentScopeGuardian {
  id: string;
  name?: string;
}
export interface ParentScopeSessionLoader {
  loadPinnedSession: () => Promise<{
    guardian: ParentScopeGuardian;
    student: ParentScopeChild;
  } | null>;
}

export interface UseParentChildScopeOptions {
  isHi: boolean;
  requestedChildId: string | null;
  timeoutMs?: number;
  /** Optional loader for the link-code (anonymous) parent session. */
  sessionLoader?: ParentScopeSessionLoader;
}

export interface ParentChildScope {
  guardian: ParentScopeGuardian | null;
  student: ParentScopeChild | null;
  children: ParentScopeChild[];
  checking: boolean;
  scopeError: string;
  /** Force re-resolve (e.g. after a retry click). */
  retry: () => void;
  /** Select a different linked child (guardian-mode). */
  selectChild: (childId: string) => void;
}

function firstLinkedFallback(
  list: ParentScopeChild[],
  requested: string | null,
): ParentScopeChild | null {
  if (list.length === 0) return null;
  if (requested) {
    const match = list.find((c) => c.id === requested);
    if (match) return match;
  }
  return list[0];
}

export function useParentChildScope(
  opts: UseParentChildScopeOptions,
): ParentChildScope {
  const { isHi, requestedChildId, timeoutMs = 20_000, sessionLoader } = opts;
  const auth = useAuth();
  const api = usePortalAction('/functions/v1/parent-portal', isHi, timeoutMs);
  const [guardian, setGuardian] = useState<ParentScopeGuardian | null>(null);
  const [student, setStudent] = useState<ParentScopeChild | null>(null);
  const [children, setChildren] = useState<ParentScopeChild[]>([]);
  const [checking, setChecking] = useState(true);
  const [scopeError, setScopeError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const requestedRef = useRef(requestedChildId);
  requestedRef.current = requestedChildId;

  useEffect(() => {
    if (auth.isLoading) return;
    let cancelled = false;
    const run = async () => {
      setChecking(true);
      setScopeError('');
      if (auth.guardian) {
        setGuardian({ id: auth.guardian.id, name: auth.guardian.name });
        try {
          const res = await api('get_children', { guardian_id: auth.guardian.id });
          if (cancelled) return;
          const list: ParentScopeChild[] = Array.isArray(res?.children)
            ? res.children
                .map((c: Record<string, unknown>) => ({
                  id: String(c.id ?? ''),
                  name: String(c.name ?? ''),
                  grade: String(c.grade ?? ''),
                }))
                .filter((c: ParentScopeChild) => Boolean(c.id))
            : [];
          setChildren(list);
          const scoped = firstLinkedFallback(list, requestedRef.current);
          setStudent(scoped);
          if (!scoped) {
            setScopeError(
              isHi ? 'कोई जुड़ा हुआ बच्चा नहीं मिला।' : 'No linked child was found.',
            );
          }
        } catch {
          if (!cancelled) {
            setChildren([]);
            setStudent(null);
            setScopeError(
              isHi
                ? 'जुड़े हुए बच्चों को लोड नहीं किया जा सका।'
                : 'Could not load linked children.',
            );
          }
        } finally {
          if (!cancelled) setChecking(false);
        }
        return;
      }
      if (sessionLoader) {
        const session = await sessionLoader.loadPinnedSession();
        if (cancelled) return;
        if (session) {
          setGuardian(session.guardian);
          setChildren([session.student]);
          setStudent(session.student);
        }
      }
      if (!cancelled) setChecking(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [api, auth.isLoading, auth.guardian, isHi, attempt, sessionLoader]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const selectChild = useCallback(
    (childId: string) => {
      const c = children.find((x) => x.id === childId);
      if (c) setStudent(c);
    },
    [children],
  );

  return { guardian, student, children, checking, scopeError, retry, selectChild };
}
