'use client';

/**
 * /hpc — the "ready" report body, split out of `page.tsx` (P10 ratchet fix,
 * 2026-08-24).
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * The page rebuild for CEO defect #12 (see `page.tsx`'s header comment) added
 * real per-section markup — Bloom's ramp, subject cards, CBSE readiness bars,
 * behaviour ratings, holistic stats, portfolio highlights — plus the small
 * presentational primitives that render them (`Card`, `SectionEmpty`, `Stat`,
 * `BehaviorRating`, `CompetencyBadge`) and the palette tokens they use. None
 * of that is needed for the loading / error / empty states, which are the
 * ONLY thing a student sees until the `get_hpc` read resolves. Keeping it
 * inline in `page.tsx` put it in the route's first-load JS unconditionally,
 * which pushed `/hpc` 3.8 kB over its P10 ratchet baseline (121.4 kB).
 *
 * This component is loaded via `next/dynamic(..., { ssr: false })` from
 * `page.tsx` ONLY once `phase.kind === 'ready'` — i.e. after data already
 * exists to render. It carries zero data-fetching of its own; everything
 * here is pure presentation over props the page already computed.
 */

import {
  WARM,
  MASTERY_STRONG,
  MASTERY_LEARNING,
  MASTERY_REVISE,
  STATUS_CRITICAL,
  tint,
} from '@alfanumrik/ui/dashboard/os/palette';

type HpcPayload = Record<string, unknown>;

/** A number is printed only when the backend actually supplied one. `0` is real. */
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

// ─── Bloom's ─────────────────────────────────────────────────────────────────

const BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const;

const BLOOM_LABELS: Record<string, { en: string; hi: string }> = {
  remember:   { en: 'Remember',   hi: 'याद' },
  understand: { en: 'Understand', hi: 'समझ' },
  apply:      { en: 'Apply',      hi: 'प्रयोग' },
  analyze:    { en: 'Analyse',    hi: 'विश्लेषण' },
  evaluate:   { en: 'Evaluate',   hi: 'मूल्यांकन' },
  create:     { en: 'Create',     hi: 'सृजन' },
};

/**
 * Bloom's levels are an ORDERED ladder, not six unrelated categories, so the
 * ramp is one hue at increasing strength rather than six arbitrary hexes (the
 * old `BLOOM_COLORS` map was six raw literals). Opaque blend against the card
 * surface, so a faint segment is still visible. Every segment also carries a
 * text label in the legend — colour is never the sole carrier (WCAG 1.4.1).
 */
function bloomRamp(index: number): string {
  const pct = 30 + index * 14; // 30 → 100
  return `color-mix(in srgb, ${WARM} ${pct}%, var(--surface-2))`;
}

// ─── Competency ──────────────────────────────────────────────────────────────

const COMPETENCY_CFG: Record<string, { color: string; en: string; hi: string }> = {
  advanced:   { color: MASTERY_STRONG,   en: 'Advanced',   hi: 'उन्नत' },
  proficient: { color: MASTERY_REVISE,   en: 'Proficient', hi: 'कुशल' },
  developing: { color: MASTERY_LEARNING, en: 'Developing', hi: 'विकासशील' },
  beginning:  { color: STATUS_CRITICAL,  en: 'Beginning',  hi: 'प्रारंभिक' },
};

function CompetencyBadge({ level, isHi }: { level: string; isHi: boolean }) {
  const cfg = COMPETENCY_CFG[level] ?? COMPETENCY_CFG.beginning;
  return (
    <span
      className="text-fluid-2xs font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: tint(cfg.color, 14), color: cfg.color }}
    >
      {isHi ? cfg.hi : cfg.en}
    </span>
  );
}

// ─── Small presentational primitives ─────────────────────────────────────────

function Card({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-3xl p-5"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      data-testid={testId}
      aria-label={title}
    >
      <h2
        className="text-fluid-2xs font-bold uppercase tracking-widest mb-3"
        style={{ color: 'var(--text-3)' }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Per-section empty state. Distinct from the page-level error state: this says
 * "there is nothing here yet", never "something went wrong".
 */
function SectionEmpty({ isHi, hint, testId }: { isHi: boolean; hint?: boolean; testId: string }) {
  return (
    <div
      className="rounded-2xl px-4 py-4 text-center"
      style={{ border: '1px dashed var(--border)' }}
      data-testid={testId}
    >
      <p className="text-fluid-xs" style={{ color: 'var(--text-3)' }}>
        {isHi ? 'इस हिस्से के लिए अभी पर्याप्त डेटा नहीं है।' : 'Not enough data for this section yet.'}
      </p>
      {hint && (
        <p className="text-fluid-xs mt-1" style={{ color: 'var(--text-3)' }}>
          {isHi ? 'कुछ क्विज़ पूरे करो — यह अपने आप भर जाएगा।' : 'Finish a few quizzes and it fills in on its own.'}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p
        className="text-fluid-2xs font-bold uppercase tracking-wide mb-0.5"
        style={{ color: 'var(--text-3)' }}
      >
        {label}
      </p>
      <p
        className="text-fluid-lg font-bold font-data"
        style={{ color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </p>
    </div>
  );
}

function BehaviorRating({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-fluid-xs flex-1 min-w-0 truncate" style={{ color: 'var(--text-2)' }}>
        {label}
      </span>
      <div
        className="flex gap-1 flex-shrink-0"
        role="img"
        aria-label={`${label}: ${value ?? '—'}/5`}
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            aria-hidden="true"
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              background: value != null && i <= value ? MASTERY_REVISE : 'var(--surface-2)',
              border: '1px solid var(--border)',
            }}
          />
        ))}
      </div>
      <span
        className="text-fluid-xs font-bold font-data flex-shrink-0"
        style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums', minWidth: 32, textAlign: 'right' }}
      >
        {value ?? '—'}/5
      </span>
    </div>
  );
}

// ─── Report body ─────────────────────────────────────────────────────────────

export default function HpcReportBody({
  hpc,
  isHi,
  synthesisChip,
  onOpenSynthesis,
}: {
  hpc: HpcPayload;
  isHi: boolean;
  synthesisChip: { month: string } | null;
  onOpenSynthesis: () => void;
}) {
  const stu = hpc.student as Record<string, unknown> | undefined;
  const comp = (hpc.competency_levels ?? {}) as Record<string, Record<string, string>>;
  const subPerf = (hpc.subject_performance ?? {}) as Record<string, Record<string, number>>;
  const behaviors = (hpc.learning_behaviors ?? {}) as Record<string, number | null>;
  const holistic = (hpc.holistic_indicators ?? {}) as Record<string, number | string>;
  const cbse = (hpc.cbse_readiness ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  const portfolio = Array.isArray(hpc.portfolio_highlights)
    ? (hpc.portfolio_highlights as Array<{ type?: string; description?: string; date?: string }>)
    : [];

  const bloom = hpc.bloom_distribution as Record<string, number> | null | undefined;
  const bloomTotal = toFiniteNumber(bloom?.total) ?? 0;

  const classPercentile = toFiniteNumber(hpc.class_percentile);

  const gradeLabel = stu?.grade != null && String(stu.grade).trim() !== ''
    ? (isHi ? `कक्षा ${String(stu.grade)}` : `Grade ${String(stu.grade)}`)
    : null;
  const boardLabel = stu?.board != null && String(stu.board).trim() !== '' ? String(stu.board) : null;
  const yearTerm = [hpc.academic_year, hpc.term]
    .filter((v) => v != null && String(v).trim() !== '')
    .map((v) => String(v))
    .join(' ');
  const identitySegments = [gradeLabel, boardLabel, yearTerm || null].filter(Boolean) as string[];

  const subjectEntries = Object.entries(subPerf).filter(
    ([, v]) => (toFiniteNumber(v?.concepts_attempted) ?? 0) > 0,
  );

  const cbseEntries = Object.entries(cbse).filter(([, sections]) =>
    Object.values(sections as Record<string, Record<string, unknown>>).some(
      (s) => s.readiness_pct != null,
    ),
  );

  const generatedAt = typeof hpc.generated_at === 'string' && hpc.generated_at.trim() !== ''
    ? new Date(hpc.generated_at)
    : null;
  const generatedLabel = generatedAt && !Number.isNaN(generatedAt.getTime())
    ? generatedAt.toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

  const holisticStats: Array<{ label: string; value: string }> = [
    {
      label: isHi ? 'सत्र' : 'Sessions',
      value: String(toFiniteNumber(holistic.total_sessions) ?? '—'),
    },
    {
      label: isHi ? 'सक्रिय दिन' : 'Active days',
      value: String(toFiniteNumber(holistic.active_days) ?? '—'),
    },
    {
      label: isHi ? 'सबसे लंबी लय' : 'Best streak',
      value: toFiniteNumber(holistic.streak_best) != null ? `${toFiniteNumber(holistic.streak_best)}d` : '—',
    },
    {
      label: isHi ? 'नोट्स' : 'Notes',
      value: String(toFiniteNumber(holistic.notes_created) ?? '—'),
    },
    {
      label: isHi ? 'कुल XP' : 'Total XP',
      value: String(toFiniteNumber(holistic.xp_total) ?? '—'),
    },
    {
      label: isHi ? 'नियमितता' : 'Regularity',
      value: toFiniteNumber(holistic.study_regularity_pct) != null
        ? `${toFiniteNumber(holistic.study_regularity_pct)}%`
        : '—',
    },
  ];
  const hasHolistic = holisticStats.some((s) => s.value !== '—');
  const hasBehaviors = ['consistency', 'curiosity', 'self_regulation', 'collaboration']
    .some((k) => toFiniteNumber(behaviors[k]) != null);

  return (
    <>
      {/* Monthly synthesis chip (Pedagogy v2 Wave 3). */}
      {synthesisChip && (
        <button
          type="button"
          onClick={onOpenSynthesis}
          data-testid="hpc-synthesis-chip"
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 min-h-tap-min text-fluid-xs font-bold"
          style={{
            background: tint(MASTERY_REVISE, 12),
            color: MASTERY_REVISE,
            border: `1px solid ${tint(MASTERY_REVISE, 30)}`,
          }}
        >
          <span>
            {isHi ? `मासिक सारांश तैयार · ${synthesisChip.month}` : `Monthly synthesis ready · ${synthesisChip.month}`}
          </span>
          <span aria-hidden="true">→</span>
        </button>
      )}

      {/* ── Identity header ── */}
      <header
        className="rounded-3xl p-5 flex items-start justify-between gap-4"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        <div className="min-w-0">
          <p
            className="text-fluid-2xs font-bold uppercase tracking-widest"
            style={{ color: MASTERY_REVISE }}
          >
            NEP 2020 · {isHi ? 'समग्र प्रगति कार्ड' : 'Holistic Progress Card'}
          </p>
          <h1
            className="text-fluid-xl font-bold mt-1 truncate"
            style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}
          >
            {String(stu?.name || (isHi ? 'विद्यार्थी' : 'Student'))}
          </h1>
          {/* Every identity segment is OMITTED when unknown — the card must
              not assert a board or a grade it does not hold. */}
          <p data-testid="hpc-identity" className="text-fluid-xs mt-1" style={{ color: 'var(--text-3)' }}>
            {identitySegments.join(' | ')}
          </p>
        </div>

        <div className="text-right flex-shrink-0" style={{ maxWidth: 170 }}>
          {classPercentile !== null ? (
            <>
              <div
                className="text-fluid-2xl font-bold font-data"
                style={{ color: MASTERY_REVISE, fontVariantNumeric: 'tabular-nums' }}
              >
                P{classPercentile}
              </div>
              <div className="text-fluid-2xs" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'कक्षा में स्थान' : 'Class percentile'}
              </div>
            </>
          ) : (
            <div role="status" data-testid="class-percentile-unavailable">
              <div className="text-fluid-xs font-bold" style={{ color: 'var(--text-2)' }}>
                {isHi ? 'कक्षा में स्थान अभी उपलब्ध नहीं' : 'Class percentile not available yet'}
              </div>
              <div className="text-fluid-2xs mt-0.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'तुलना के लिए कक्षा का पर्याप्त डेटा नहीं है।' : 'Not enough class data to compare yet.'}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ── Bloom's distribution ── */}
      <Card
        title={isHi ? "Bloom's स्तर वितरण" : "Bloom's taxonomy distribution"}
        testId="hpc-section-bloom"
      >
        {bloomTotal > 0 ? (
          <div>
            <div className="flex rounded-lg overflow-hidden mb-3" style={{ height: 22 }}>
              {BLOOM_LEVELS.map((level, i) => {
                const count = toFiniteNumber(bloom?.[level]) ?? 0;
                const pct = (count / bloomTotal) * 100;
                if (pct <= 0) return null;
                return (
                  <div
                    key={level}
                    style={{ width: `${pct}%`, minWidth: 2, background: bloomRamp(i) }}
                    title={`${isHi ? BLOOM_LABELS[level].hi : BLOOM_LABELS[level].en}: ${count}`}
                  />
                );
              })}
            </div>
            <ul className="flex gap-x-4 gap-y-1 flex-wrap list-none p-0 m-0">
              {BLOOM_LEVELS.map((level, i) => (
                <li key={level} className="flex items-center gap-1.5 text-fluid-2xs" style={{ color: 'var(--text-3)' }}>
                  <span
                    aria-hidden="true"
                    style={{ width: 8, height: 8, borderRadius: 2, background: bloomRamp(i), display: 'inline-block' }}
                  />
                  {isHi ? BLOOM_LABELS[level].hi : BLOOM_LABELS[level].en}: {toFiniteNumber(bloom?.[level]) ?? 0}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <SectionEmpty isHi={isHi} hint testId="hpc-empty-bloom" />
        )}
      </Card>

      {/* ── Subject performance ── */}
      <Card title={isHi ? 'विषयवार प्रदर्शन' : 'Subject performance'} testId="hpc-section-subjects">
        {subjectEntries.length > 0 ? (
          <div className="space-y-3">
            {subjectEntries.map(([subject, perf]) => (
              <div
                key={subject}
                className="rounded-2xl p-4"
                style={{ background: 'var(--surface-2)' }}
              >
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3
                    className="text-fluid-sm font-bold capitalize truncate min-w-0"
                    style={{ color: 'var(--text-1)' }}
                  >
                    {subject}
                  </h3>
                  {comp[subject]?.overall_level && (
                    <CompetencyBadge level={comp[subject].overall_level} isHi={isHi} />
                  )}
                </div>
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))' }}>
                  <Stat
                    label={isHi ? 'महारत' : 'Mastery'}
                    value={toFiniteNumber(perf.avg_mastery_pct) != null ? `${toFiniteNumber(perf.avg_mastery_pct)}%` : '—'}
                  />
                  <Stat
                    label={isHi ? 'अवधारणाएँ' : 'Concepts'}
                    value={`${toFiniteNumber(perf.concepts_attempted) ?? '—'}/${toFiniteNumber(perf.concepts_total) ?? '—'}`}
                  />
                  <Stat
                    label={isHi ? 'अध्याय' : 'Chapters'}
                    value={`${toFiniteNumber(perf.chapters_covered) ?? '—'}/${toFiniteNumber(perf.chapters_total) ?? '—'}`}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <SectionEmpty isHi={isHi} hint testId="hpc-empty-subjects" />
        )}
      </Card>

      {/* ── CBSE board readiness (only for subjects that actually have it) ── */}
      {cbseEntries.map(([subject, sections]) => {
        const secs = sections as Record<string, Record<string, unknown>>;
        return (
          <Card
            key={subject}
            title={`${isHi ? 'CBSE बोर्ड परीक्षा तैयारी' : 'CBSE board exam readiness'} — ${subject}`}
            testId={`hpc-section-cbse-${subject}`}
          >
            <div className="space-y-1.5">
              {Object.entries(secs).map(([key, s]) => {
                const readiness = toFiniteNumber(s.readiness_pct);
                const width = readiness ?? 0;
                const color = width >= 70 ? MASTERY_STRONG : width >= 40 ? MASTERY_LEARNING : STATUS_CRITICAL;
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span
                      className="text-fluid-2xs flex-shrink-0"
                      style={{ color: 'var(--text-3)', minWidth: 150 }}
                    >
                      {String(s.section)} ({String(s.marks)}m)
                    </span>
                    <div
                      className="flex-1 rounded-full overflow-hidden"
                      style={{ height: 8, background: 'var(--surface-2)' }}
                      role="progressbar"
                      aria-valuenow={width}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={String(s.section)}
                    >
                      <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
                    </div>
                    <span
                      className="text-fluid-xs font-bold font-data flex-shrink-0 text-right"
                      style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums', minWidth: 42 }}
                    >
                      {readiness != null ? `${readiness}%` : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      {/* ── Learning behaviours ── */}
      <Card title={isHi ? 'सीखने की आदतें (NCF 2023)' : 'Learning behaviours (NCF 2023)'} testId="hpc-section-behaviors">
        {hasBehaviors ? (
          <div>
            <BehaviorRating label={isHi ? 'निरंतरता' : 'Consistency'} value={toFiniteNumber(behaviors.consistency)} />
            <BehaviorRating label={isHi ? 'जिज्ञासा' : 'Curiosity'} value={toFiniteNumber(behaviors.curiosity)} />
            <BehaviorRating label={isHi ? 'आत्म-नियंत्रण' : 'Self-regulation'} value={toFiniteNumber(behaviors.self_regulation)} />
            <BehaviorRating label={isHi ? 'सहयोग' : 'Collaboration'} value={toFiniteNumber(behaviors.collaboration)} />
          </div>
        ) : (
          <SectionEmpty isHi={isHi} hint testId="hpc-empty-behaviors" />
        )}
      </Card>

      {/* ── Holistic indicators ── */}
      <Card title={isHi ? 'समग्र संकेतक' : 'Holistic indicators'} testId="hpc-section-holistic">
        {hasHolistic ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))' }}>
            {holisticStats.map((s) => (
              <Stat key={s.label} label={s.label} value={s.value} />
            ))}
          </div>
        ) : (
          <SectionEmpty isHi={isHi} hint testId="hpc-empty-holistic" />
        )}
      </Card>

      {/* ── Portfolio highlights (supplementary — omitted when absent) ── */}
      {portfolio.length > 0 && (
        <Card title={isHi ? 'खास उपलब्धियाँ' : 'Portfolio highlights'} testId="hpc-section-portfolio">
          <ul className="list-none p-0 m-0">
            {portfolio.map((p, i) => (
              <li
                key={`${p.date ?? ''}-${i}`}
                className="flex items-center gap-3 py-2"
                style={{ borderBottom: i < portfolio.length - 1 ? '1px solid var(--border)' : 'none' }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: p.type === 'mastery' ? MASTERY_STRONG : MASTERY_REVISE,
                  }}
                />
                <span className="text-fluid-xs flex-1 min-w-0" style={{ color: 'var(--text-2)' }}>
                  {p.description}
                </span>
                <span className="text-fluid-2xs flex-shrink-0" style={{ color: 'var(--text-3)' }}>
                  {p.date}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-center text-fluid-2xs py-2" style={{ color: 'var(--text-3)' }}>
        {generatedLabel
          ? (isHi ? `${generatedLabel} को बनाया गया` : `Generated ${generatedLabel}`)
          : (isHi ? 'Alfanumrik Learning OS' : 'Alfanumrik Learning OS')}
        {' · NEP 2020'}
      </p>
    </>
  );
}
