'use client';

/**
 * Alfanumrik — Goal-Adaptive Learning Layers / Phase 0
 * Super-admin Goal Profile Preview.
 *
 * Owner: frontend (per ops, who owns reporting). Pure-new page. Reads the
 * read-only API at /api/super-admin/goal-profiles. Lets reviewers see exactly
 * what each of the 6 goal profiles resolves to BEFORE the master flag flip.
 *
 * Flag: `ff_goal_profiles` (architect seeds disabled in staging + prod).
 *   - flag OFF → render the disabled-feature notice (en + hi). The data is
 *     still fetched server-side so admins know the wiring works, but the
 *     payload is hidden behind the notice to keep the surface honest.
 *   - flag ON  → render the full preview: config table per profile, expanded
 *     persona viewer with mode selector, sample scorecard sentence (en + hi).
 *
 * No PII. No mutations. No DB writes. No student data.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  buildExpandedPersona,
  type FoxyMode,
} from '@alfanumrik/lib/goals/goal-personas';
import { buildScorecardSentence } from '@alfanumrik/lib/goals/scorecard-sentence';
import type { GoalProfile, GoalCode } from '@alfanumrik/lib/goals/goal-profile';

interface ApiResponse {
  success: boolean;
  data?: {
    flagEnabled: boolean;
    profiles: GoalProfile[];
  };
  error?: string;
}

const MODES: FoxyMode[] = [
  'learn',
  'explain',
  'practice',
  'revise',
  'doubt',
  'homework',
  'explorer',
];

const MODE_LABELS: Record<FoxyMode, { en: string; hi: string }> = {
  learn:    { en: 'Learn',    hi: 'सीखो' },
  explain:  { en: 'Explain',  hi: 'समझाओ' },
  practice: { en: 'Practice', hi: 'अभ्यास' },
  revise:   { en: 'Revise',   hi: 'दोहराओ' },
  doubt:    { en: 'Doubt',    hi: 'संदेह' },
  homework: { en: 'Homework', hi: 'गृहकार्य' },
  explorer: { en: 'Explorer', hi: 'खोज' },
};

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function formatBloomBand(b: GoalProfile['bloomBand']): string {
  return b.min === b.max ? `${b.min}` : `${b.min}-${b.max}`;
}

interface ProfileCardProps {
  profile: GoalProfile;
}

function ProfileCard({ profile }: ProfileCardProps) {
  const [mode, setMode] = useState<FoxyMode>('learn');

  const expandedPersona = useMemo(
    () => buildExpandedPersona(profile.code, mode),
    [profile.code, mode],
  );

  // Sample scorecard — fixed inputs so reviewers can compare across profiles.
  // 4/5 correct → 80% (triggers high-score bonus in real life), XP=50.
  const sampleEn = useMemo(
    () => buildScorecardSentence({
      goal: profile.code as GoalCode,
      correct: 4,
      total: 5,
      scorePercent: 80,
      xpEarned: 50,
      isHi: false,
    }),
    [profile.code],
  );
  const sampleHi = useMemo(
    () => buildScorecardSentence({
      goal: profile.code as GoalCode,
      correct: 4,
      total: 5,
      scorePercent: 80,
      xpEarned: 50,
      isHi: true,
    }),
    [profile.code],
  );

  return (
    <section
      className="rounded-2xl border border-surface-3 bg-surface-1 p-5 mb-5"
      data-testid={`goal-profile-card-${profile.code}`}
    >
      <header className="mb-4">
        <h2 className="text-lg font-bold text-foreground">{profile.labelEn}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{profile.labelHi}</p>
        <code className="text-[11px] text-muted-foreground mt-1 inline-block">{profile.code}</code>
      </header>

      {/* Config table */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 text-sm">
        <div className="rounded-lg bg-surface-2 border border-surface-3 p-3">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Difficulty Mix / कठिनाई वितरण
          </div>
          <div className="flex gap-3 text-xs">
            <span><span className="font-bold text-success">Easy</span> {formatPercent(profile.difficultyMix.easy)}</span>
            <span><span className="font-bold text-warning">Med</span> {formatPercent(profile.difficultyMix.medium)}</span>
            <span><span className="font-bold text-danger">Hard</span> {formatPercent(profile.difficultyMix.hard)}</span>
          </div>
        </div>

        <div className="rounded-lg bg-surface-2 border border-surface-3 p-3">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Bloom Band / ब्लूम स्तर
          </div>
          <div className="text-xs text-foreground font-mono">{formatBloomBand(profile.bloomBand)}</div>
        </div>

        <div className="rounded-lg bg-surface-2 border border-surface-3 p-3 md:col-span-2">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            Source Priority / स्रोत प्राथमिकता
          </div>
          <div className="flex flex-wrap gap-1.5">
            {profile.sourcePriority.map((src, idx) => (
              <span
                key={src}
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--secondary) 8%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--secondary) 30%, transparent)',
                  color: 'color-mix(in srgb, var(--secondary) 70%, var(--text-1))',
                }}
              >
                <span className="font-mono" style={{ color: 'var(--secondary)' }}>{idx + 1}.</span> {src}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-surface-2 border border-surface-3 p-3">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Mastery Threshold / दक्षता कटऑफ़
          </div>
          <div className="text-xs text-foreground font-mono">{formatPercent(profile.masteryThreshold)}</div>
        </div>

        <div className="rounded-lg bg-surface-2 border border-surface-3 p-3">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Daily Target / दैनिक लक्ष्य
          </div>
          <div className="text-xs text-foreground font-mono">{profile.dailyTargetMinutes} min</div>
        </div>

        <div className="rounded-lg bg-surface-2 border border-surface-3 p-3">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Pace Policy / गति नीति
          </div>
          <div className="text-xs text-foreground font-mono">{profile.pacePolicy}</div>
        </div>

        <div className="rounded-lg bg-surface-2 border border-surface-3 p-3">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Scorecard Tone / स्कोरकार्ड शैली
          </div>
          <div className="text-xs text-foreground font-mono">{profile.scorecardTone}</div>
        </div>
      </div>

      {/* Dashboard callout */}
      <div className="mb-4">
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
          Dashboard Callout / डैशबोर्ड संदेश
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          <div
            className="rounded-lg border p-3 text-foreground"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--primary) 8%, transparent)',
              borderColor: 'color-mix(in srgb, var(--primary) 30%, transparent)',
            }}
          >
            <div className="text-[10px] uppercase font-bold tracking-wider mb-1" style={{ color: 'color-mix(in srgb, var(--primary) 70%, var(--text-1))' }}>EN</div>
            {profile.dashboardCalloutEn}
          </div>
          <div
            className="rounded-lg border p-3 text-foreground"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--primary) 8%, transparent)',
              borderColor: 'color-mix(in srgb, var(--primary) 30%, transparent)',
            }}
          >
            <div className="text-[10px] uppercase font-bold tracking-wider mb-1" style={{ color: 'color-mix(in srgb, var(--primary) 70%, var(--text-1))' }}>हिंदी</div>
            {profile.dashboardCalloutHi}
          </div>
        </div>
      </div>

      {/* Sample scorecard sentence (en + hi) */}
      <div className="mb-4">
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
          Sample Scorecard Sentence — 4/5 correct, 80%, +50 XP
          {' / '}
          नमूना स्कोरकार्ड वाक्य — 4/5 सही, 80%, +50 XP
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
          <div
            className="rounded-lg border p-3 text-foreground"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--info) 8%, transparent)',
              borderColor: 'color-mix(in srgb, var(--info) 30%, transparent)',
            }}
          >
            <div className="text-[10px] uppercase font-bold tracking-wider mb-1" style={{ color: 'color-mix(in srgb, var(--info) 65%, var(--text-1))' }}>
              EN ({sampleEn.tone})
            </div>
            {sampleEn.en}
          </div>
          <div
            className="rounded-lg border p-3 text-foreground"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--info) 8%, transparent)',
              borderColor: 'color-mix(in srgb, var(--info) 30%, transparent)',
            }}
          >
            <div className="text-[10px] uppercase font-bold tracking-wider mb-1" style={{ color: 'color-mix(in srgb, var(--info) 65%, var(--text-1))' }}>
              हिंदी ({sampleHi.tone})
            </div>
            {sampleHi.hi}
          </div>
        </div>
      </div>

      {/* Expanded persona viewer */}
      <div>
        <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
          Expanded Foxy Persona / विस्तृत Foxy व्यक्तित्व
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {MODES.map(m => {
            const isActive = mode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                data-testid={`persona-mode-${profile.code}-${m}`}
                className={
                  isActive
                    ? 'px-3 py-1 text-xs font-bold rounded-full bg-foreground text-surface-1 border border-foreground'
                    : 'px-3 py-1 text-xs font-medium rounded-full bg-surface-1 text-foreground border border-surface-3 hover:bg-surface-2'
                }
                aria-pressed={isActive}
                title={MODE_LABELS[m].hi}
              >
                {MODE_LABELS[m].en}
              </button>
            );
          })}
        </div>
        <pre className="whitespace-pre-wrap text-[12px] leading-relaxed font-mono text-foreground bg-surface-2 border border-surface-3 rounded-lg p-3 overflow-x-auto">
{expandedPersona}
        </pre>
      </div>
    </section>
  );
}

export default function GoalProfilesPage() {
  const [data, setData] = useState<ApiResponse['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/super-admin/goal-profiles');
      const j: ApiResponse = await res.json();
      if (!res.ok || !j.success || !j.data) {
        setError(j.error ?? `request_failed_${res.status}`);
      } else {
        setData(j.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Goal Profile Preview</h1>
        <p className="text-sm text-muted-foreground mt-0.5">लक्ष्य प्रोफ़ाइल पूर्वावलोकन</p>
        <p className="text-sm text-muted-foreground mt-3 max-w-2xl">
          Phase 0 of the Goal-Adaptive Learning Layers spec. Each card below
          shows exactly what students mapped to that goal will experience —
          difficulty mix, Bloom band, source priority, scorecard tone, and the
          expanded Foxy persona that Claude sees per mode. No student PII.
        </p>
      </header>

      {loading && (
        <div className="rounded-xl border border-surface-3 bg-surface-1 p-6 text-center text-sm text-muted-foreground">
          Loading… / लोड हो रहा है…
        </div>
      )}

      {error && !loading && (
        <div
          role="alert"
          className="rounded-xl border p-4 text-sm text-danger mb-4"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--danger) 8%, transparent)',
            borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)',
          }}
        >
          <div className="font-bold">Failed to load goal profiles</div>
          <div className="font-mono text-xs mt-1">{error}</div>
          <button
            type="button"
            onClick={load}
            className="mt-2 inline-block text-xs underline font-bold"
          >
            Retry / पुनः प्रयास करें
          </button>
        </div>
      )}

      {!loading && !error && data && !data.flagEnabled && (
        <div
          role="status"
          data-testid="goal-profiles-disabled-notice"
          className="rounded-xl border p-5 text-foreground"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--warning) 10%, transparent)',
            borderColor: 'color-mix(in srgb, var(--warning) 35%, transparent)',
          }}
        >
          <h2 className="text-base font-bold mb-1">
            Goal Profile Preview is disabled
          </h2>
          <p className="text-sm leading-relaxed">
            Enable the <code className="px-1 py-0.5 rounded text-[12px]" style={{ backgroundColor: 'color-mix(in srgb, var(--warning) 20%, transparent)' }}>ff_goal_profiles</code>
            {' '}flag in <a href="/super-admin/flags" className="underline font-bold">Feature Flags</a>
            {' '}to view the resolved profile table.
          </p>
          <h3 className="text-sm font-bold mt-3 mb-1">यह सुविधा बंद है</h3>
          <p className="text-sm leading-relaxed">
            लक्ष्य प्रोफ़ाइल तालिका देखने के लिए <a href="/super-admin/flags" className="underline font-bold">Feature Flags</a>
            {' '}में <code className="px-1 py-0.5 rounded text-[12px]" style={{ backgroundColor: 'color-mix(in srgb, var(--warning) 20%, transparent)' }}>ff_goal_profiles</code>
            {' '}चालू करें।
          </p>
        </div>
      )}

      {!loading && !error && data && data.flagEnabled && (
        <div data-testid="goal-profiles-list">
          {data.profiles.map(profile => (
            <ProfileCard key={profile.code} profile={profile} />
          ))}
        </div>
      )}
    </main>
  );
}
