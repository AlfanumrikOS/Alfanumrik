'use client';

/**
 * /memory — "What Foxy remembers about me" (Foxy North-Star Phase 1).
 *
 * Student-facing transparency surface over Foxy's learner memory (read-only —
 * the per-layer erase control was removed 2026-08-30 along with the DPDP
 * erasure subsystem it was built on; see
 * supabase/migrations/20260830172610_remove_dpdp_erasure_system.sql).
 *
 * Data: GET /api/learner/memory?subject=<code> →
 *   { cognitive: { weakTopics, strongTopics, revisionDue, recentErrors },
 *     longMemory: { summary, highConcepts, lowConcepts, topMisconceptions },
 *     preferences: { learningStyle, preferredExplanationDepth },
 *     twin: null }
 *
 * Vocabulary rule (assessment-owned): topic lists use the growth-mindset
 * mastery-band labels (packages/lib/src/dashboard/mastery-band-labels.ts) —
 * "Building it" / "Strong" — NEVER "weak" framing on any student surface.
 *
 * Subject picker mirrors the house pattern from /library (useAllowedSubjects
 * chip tabs). Loading / error / empty states per house style.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';
import { supabase } from '@alfanumrik/lib/supabase';
import { MASTERY_BAND_LABELS } from '@alfanumrik/lib/dashboard/mastery-band-labels';
import MemoryLayerCard, { MemoryChip } from '@alfanumrik/ui/memory/MemoryLayerCard';

// ─── Wire types (fixed API contract) ─────────────────────────────────────────

interface LearnerMemoryPayload {
  cognitive: {
    weakTopics: string[];
    strongTopics: string[];
    revisionDue: string[] | number | null;
    recentErrors: string[];
  } | null;
  longMemory: {
    summary: string | null;
    highConcepts: string[];
    lowConcepts: string[];
    topMisconceptions: string[];
  } | null;
  preferences: {
    learningStyle: string | null;
    preferredExplanationDepth: string | null;
  } | null;
  twin: null;
}

function asList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MemoryPage() {
  const router = useRouter();
  const { student, isLoggedIn, isLoading: authLoading, isHi } = useAuth();
  const { unlocked: allowedSubjects, isLoading: subjectsLoading } = useAllowedSubjects();

  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [memory, setMemory] = useState<LearnerMemoryPayload | null>(null);
  const [loadingMemory, setLoadingMemory] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Auth guard (house pattern)
  useEffect(() => {
    if (!authLoading && !isLoggedIn) router.replace('/login');
  }, [authLoading, isLoggedIn, router]);

  // Default subject: first unlocked subject
  useEffect(() => {
    if (!selectedSubject && allowedSubjects.length > 0) {
      setSelectedSubject(allowedSubjects[0].code);
    }
  }, [selectedSubject, allowedSubjects]);

  const getToken = useCallback(async (): Promise<string | null> => {
    try {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    } catch {
      return null;
    }
  }, []);

  const fetchMemory = useCallback(async () => {
    if (!selectedSubject) return;
    setLoadingMemory(true);
    setApiError(null);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`/api/learner/memory?subject=${encodeURIComponent(selectedSubject)}`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const json = await res.json();
      setMemory((json?.data ?? json) as LearnerMemoryPayload);
    } catch (err: any) {
      setApiError(err.message || (isHi ? 'मेमोरी लोड नहीं हो पाई' : 'Could not load memory'));
      setMemory(null);
    } finally {
      setLoadingMemory(false);
    }
  }, [selectedSubject, getToken, isHi]);

  useEffect(() => {
    if (!authLoading && isLoggedIn && selectedSubject) fetchMemory();
  }, [authLoading, isLoggedIn, selectedSubject, fetchMemory]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (authLoading || subjectsLoading || (!memory && loadingMemory && !apiError)) {
    return (
      <div className="min-h-screen px-4 py-6 max-w-2xl mx-auto" style={{ background: 'var(--bg)' }} aria-busy="true">
        <div className="animate-pulse space-y-4">
          <div className="h-7 rounded-xl w-2/3" style={{ background: 'var(--surface-2)' }} />
          <div className="h-10 rounded-xl" style={{ background: 'var(--surface-2)' }} />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-2xl" style={{ background: 'var(--surface-2)' }} />
          ))}
        </div>
      </div>
    );
  }

  const cognitive = memory?.cognitive ?? null;
  const longMemory = memory?.longMemory ?? null;
  const preferences = memory?.preferences ?? null;

  const weakTopics = asList(cognitive?.weakTopics);
  const strongTopics = asList(cognitive?.strongTopics);
  const revisionDueList = asList(cognitive?.revisionDue);
  const revisionDueCount =
    typeof cognitive?.revisionDue === 'number' ? cognitive.revisionDue : revisionDueList.length;
  const recentErrors = asList(cognitive?.recentErrors);
  const highConcepts = asList(longMemory?.highConcepts);
  const lowConcepts = asList(longMemory?.lowConcepts);
  const topMisconceptions = asList(longMemory?.topMisconceptions);

  const hasAnyMemory =
    weakTopics.length > 0 ||
    strongTopics.length > 0 ||
    recentErrors.length > 0 ||
    revisionDueCount > 0 ||
    Boolean(longMemory?.summary) ||
    highConcepts.length > 0 ||
    lowConcepts.length > 0 ||
    topMisconceptions.length > 0 ||
    Boolean(preferences?.learningStyle) ||
    Boolean(preferences?.preferredExplanationDepth);

  const selectedSubjectMeta = allowedSubjects.find((s) => s.code === selectedSubject);
  const subjectLabel = selectedSubjectMeta
    ? (isHi && selectedSubjectMeta.nameHi) || selectedSubjectMeta.name
    : undefined;

  return (
    <div className="min-h-screen px-4 py-6 max-w-2xl mx-auto" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}>
          🦊 {isHi ? 'फॉक्सी क्या याद रखता है' : 'What Foxy remembers about me'}
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? 'यह तुम्हारा डेटा है। देखो फॉक्सी तुम्हारी पढ़ाई के बारे में क्या जानता है — और चाहो तो मिटा दो।'
            : "This is your data. See what Foxy knows about your learning — and erase it if you want."}
        </p>
      </div>

      {/* Subject picker (house chip-tab pattern) */}
      {allowedSubjects.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-4 no-scrollbar" role="tablist" aria-label={isHi ? 'विषय' : 'Subjects'}>
          {allowedSubjects.map((s) => {
            const isSelected = s.code === selectedSubject;
            return (
              <button
                key={s.code}
                role="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedSubject(s.code)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-xl text-xs font-bold transition-all active:scale-[0.96]"
                style={
                  isSelected
                    // DD-16: fallback was --orange (#fff = 3.59:1, sub-AA). s.color is
                    // DB-supplied — residual DD-16 item, see the inventory.
                    ? { background: s.color || 'var(--accent-warm-strong)', color: 'var(--on-accent)', border: '1.5px solid transparent' }
                    : { background: 'var(--surface-1)', color: 'var(--text-2)', border: '1.5px solid var(--border)' }
                }
              >
                <span>{s.icon}</span>
                <span>{(isHi && s.nameHi) || s.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Error state */}
      {apiError && !loadingMemory && (
        <div
          className="rounded-2xl p-6 text-center mb-4"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        >
          <div className="text-4xl mb-2" aria-hidden="true">⚠️</div>
          <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>{apiError}</p>
          <button
            onClick={fetchMemory}
            className="px-5 py-2.5 min-h-[44px] rounded-xl text-sm font-bold text-on-accent transition-all active:scale-95"
            style={{ background: 'var(--accent-warm-strong)' }}
          >
            {isHi ? 'दोबारा कोशिश करें' : 'Retry'}
          </button>
        </div>
      )}

      {/* Inline loading (subject switch) */}
      {loadingMemory && memory && (
        <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }} aria-busy="true">
          {isHi ? 'लोड हो रहा है…' : 'Loading…'}
        </p>
      )}

      {!apiError && memory && !hasAnyMemory && (
        <div
          className="rounded-2xl p-8 text-center mb-4"
          data-testid="memory-empty-state"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
        >
          <div className="text-5xl mb-3" aria-hidden="true">🌱</div>
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-2)' }}>
            {isHi ? 'फॉक्सी अभी तुम्हें जान रहा है' : 'Foxy is still getting to know you'}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            {isHi
              ? 'जैसे-जैसे तुम पढ़ोगे और अभ्यास करोगे, यहाँ फॉक्सी की याददाश्त दिखेगी।'
              : "As you learn and practice, what Foxy remembers will appear here."}
          </p>
        </div>
      )}

      {!apiError && memory && hasAnyMemory && (
        <>
          {/* Layer 1 — cognitive */}
          <MemoryLayerCard
            icon="🧠"
            title={isHi ? 'फॉक्सी मेरी पढ़ाई के बारे में क्या जानता है' : 'What Foxy knows about my learning'}
            subtitle={subjectLabel}
          >
            {strongTopics.length > 0 && (
              <div className="mb-3">
                <p className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-3)' }}>
                  {isHi ? MASTERY_BAND_LABELS.high.hi : MASTERY_BAND_LABELS.high.en}
                </p>
                <div>
                  {strongTopics.map((topic) => (
                    <MemoryChip key={topic} label={topic} tone="positive" />
                  ))}
                </div>
              </div>
            )}
            {weakTopics.length > 0 && (
              <div className="mb-3">
                {/* Growth-mindset vocabulary (mastery-band-labels): "Building it",
                    never "weak" framing on a student surface. */}
                <p className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-3)' }}>
                  {isHi ? MASTERY_BAND_LABELS.mid.hi : MASTERY_BAND_LABELS.mid.en}
                </p>
                <div>
                  {weakTopics.map((topic) => (
                    <MemoryChip key={topic} label={topic} tone="building" />
                  ))}
                </div>
              </div>
            )}
            {revisionDueCount > 0 && (
              <p className="text-xs mb-2" style={{ color: 'var(--text-2)' }}>
                🔁{' '}
                {isHi
                  ? `${revisionDueCount} टॉपिक दोहराने के लिए तैयार हैं`
                  : `${revisionDueCount} topic${revisionDueCount !== 1 ? 's' : ''} ready for revision`}
                {revisionDueList.length > 0 && `: ${revisionDueList.join(', ')}`}
              </p>
            )}
            {recentErrors.length > 0 && (
              <div>
                <p className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-3)' }}>
                  {isHi ? 'हाल की गलतियाँ जिनसे हम सीख रहे हैं' : "Recent slips we're learning from"}
                </p>
                <ul className="list-disc pl-4 text-xs space-y-1" style={{ color: 'var(--text-2)' }}>
                  {recentErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </MemoryLayerCard>

          {/* Layer 2 — monthly summary */}
          <MemoryLayerCard
            icon="📅"
            title={isHi ? 'फॉक्सी का मासिक सारांश' : "Foxy's monthly summary"}
          >
            {longMemory?.summary ? (
              <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-2)' }}>
                {longMemory.summary}
              </p>
            ) : (
              <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'इस महीने का सारांश अभी नहीं बना है।' : 'No summary for this month yet.'}
              </p>
            )}
            {highConcepts.length > 0 && (
              <div className="mb-2">
                <p className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-3)' }}>
                  {isHi ? MASTERY_BAND_LABELS.high.hi : MASTERY_BAND_LABELS.high.en}
                </p>
                <div>{highConcepts.map((c) => <MemoryChip key={c} label={c} tone="positive" />)}</div>
              </div>
            )}
            {lowConcepts.length > 0 && (
              <div className="mb-2">
                <p className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-3)' }}>
                  {isHi ? MASTERY_BAND_LABELS.mid.hi : MASTERY_BAND_LABELS.mid.en}
                </p>
                <div>{lowConcepts.map((c) => <MemoryChip key={c} label={c} tone="building" />)}</div>
              </div>
            )}
            {topMisconceptions.length > 0 && (
              <div>
                <p className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-3)' }}>
                  {isHi ? 'जिन उलझनों पर हम काम कर रहे हैं' : "Mix-ups we're working on"}
                </p>
                <div>{topMisconceptions.map((m) => <MemoryChip key={m} label={m} tone="neutral" />)}</div>
              </div>
            )}
          </MemoryLayerCard>

          {/* Layer 3 — preferences (display-only in v1) */}
          <MemoryLayerCard
            icon="🎨"
            title={isHi ? 'मेरी पसंद' : 'My preferences'}
            footer={
              <Link href="/notifications" className="text-xs font-bold" style={{ color: 'var(--orange, #F97316)' }}>
                {isHi ? 'सेटिंग्स में बदलो →' : 'Change in settings →'}
              </Link>
            }
          >
            <dl className="text-sm space-y-1.5" style={{ color: 'var(--text-2)' }}>
              <div>
                <dt className="inline font-semibold">{isHi ? 'सीखने का तरीका' : 'Learning style'}: </dt>
                <dd className="inline">{preferences?.learningStyle || (isHi ? 'अभी तय नहीं' : 'Not set yet')}</dd>
              </div>
              <div>
                <dt className="inline font-semibold">{isHi ? 'समझाने की गहराई' : 'Explanation depth'}: </dt>
                <dd className="inline">{preferences?.preferredExplanationDepth || (isHi ? 'अभी तय नहीं' : 'Not set yet')}</dd>
              </div>
            </dl>
          </MemoryLayerCard>
        </>
      )}

    </div>
  );
}
