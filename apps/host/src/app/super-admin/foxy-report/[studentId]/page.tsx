'use client';

/**
 * Super Admin — Foxy Learning Report (Phase 3.1)
 *
 * Read-only at-a-glance view of what the Foxy learning loop has captured for a
 * single student. Renders the six DTO sections as clean cards/metrics.
 *
 * Route: /super-admin/foxy-report/[studentId]
 *
 * Backend contract (already shipped):
 *   GET /api/super-admin/foxy-report/[studentId]
 *   => { success: true, data: FoxyLearningReport } | { success: false, error }
 *   Auth: `super_admin.access` (server-enforced on the route). No new permission.
 *
 * Sibling pattern matched: super-admin/marking-integrity/[studentId]/page.tsx
 *   (AdminShell + useAdmin.apiFetch + useSWR fetcher + inline design tokens +
 *   StatusBadge from @alfanumrik/ui/admin-ui + three page states).
 *
 * DARK-LEDGER degradation (P-invariant of this surface): the perception/struggle
 * event ledger is dark in production until ramped. When `ledgerAvailable` is
 * false — or an individual section has no rows yet — we render a subtle
 * "No signal yet" / "आंकड़े अभी नहीं" placeholder instead of an empty void. The
 * live sections (engagement / evidential / mastery / lesson) ALWAYS render.
 *
 * P5: `grade` is a string, passed through untouched.
 * P7: bilingual via AuthContext.isHi; misconception labels use the DTO's
 *   label/labelHi; mastery bands render via MASTERY_BAND_LABELS.
 * P13: renders only codes / ids / enums / aggregates the route already returns —
 *   never message text, item stems, or free-text misconception columns.
 */

import { useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import {
  MASTERY_BAND_LABELS,
  type MasteryBand,
} from '@alfanumrik/lib/dashboard/mastery-band-labels';
import type {
  FoxyLearningReport,
  FoxyReportMisconceptionSource,
} from '@alfanumrik/lib/foxy/foxy-report';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { StatusBadge, type StatusBadgeVariant } from '@alfanumrik/ui/admin-ui';

/* ── Design tokens (mirror the marking-integrity sibling) ───────────────── */

const colors = {
  bg: '#FFFFFF',
  text1: '#111827',
  text2: '#6B7280',
  text3: '#9CA3AF',
  border: '#E5E7EB',
  borderStrong: '#D1D5DB',
  borderLight: '#F3F4F6',
  surface: '#F9FAFB',
  surfaceHover: '#F3F4F6',
  accent: '#2563EB',
  accentLight: '#EFF6FF',
  success: '#16A34A',
  successLight: '#F0FDF4',
  warning: '#D97706',
  warningLight: '#FFFBEB',
  danger: '#DC2626',
  dangerLight: '#FEF2F2',
  purple: '#7C3AED',
} as const;

const S = {
  h1: {
    fontSize: 20,
    fontWeight: 700,
    color: colors.text1,
    marginBottom: 4,
    letterSpacing: -0.3,
  } as React.CSSProperties,
  card: {
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    background: colors.bg,
    padding: 18,
  } as React.CSSProperties,
  cardTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: colors.text1,
    margin: 0,
    letterSpacing: -0.1,
  } as React.CSSProperties,
  eyebrow: {
    fontSize: 11,
    fontWeight: 600,
    color: colors.text3,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  } as React.CSSProperties,
  metricValue: {
    fontSize: 24,
    fontWeight: 700,
    color: colors.text1,
    lineHeight: 1.1,
  } as React.CSSProperties,
  metricLabel: {
    fontSize: 11,
    color: colors.text3,
    marginTop: 2,
  } as React.CSSProperties,
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    borderRadius: 6,
    border: `1px solid ${colors.border}`,
    background: colors.surface,
    fontSize: 11,
    color: colors.text2,
  } as React.CSSProperties,
};

/* ── Helpers ────────────────────────────────────────────────────────────── */

function shortUuid(uuid: string | null): string {
  if (!uuid) return '—';
  return `${uuid.slice(0, 8)}…`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}Z`;
  } catch {
    return iso;
  }
}

/** BKT mastery mean (0..1) → whole-percent display. */
function pctFromMean(mean: number | null): string {
  if (mean === null) return '—';
  return `${Math.round(mean * 100)}%`;
}

/** Signed 2-dp delta with a direction glyph. */
function formatDelta(delta: number | null): { text: string; color: string } {
  if (delta === null) return { text: '—', color: colors.text3 };
  const rounded = Math.round(delta * 100) / 100;
  if (rounded > 0) return { text: `▲ +${rounded.toFixed(2)}`, color: colors.success };
  if (rounded < 0) return { text: `▼ ${rounded.toFixed(2)}`, color: colors.danger };
  return { text: `0.00`, color: colors.text3 };
}

/** Growth-mindset band → badge variant (never "red = bad kid"). */
function bandVariant(band: MasteryBand | null): StatusBadgeVariant {
  if (band === 'high') return 'success';
  if (band === 'mid') return 'warning';
  return 'neutral';
}

function sourceVariant(source: FoxyReportMisconceptionSource): StatusBadgeVariant {
  if (source === 'both') return 'danger';
  if (source === 'detected') return 'warning';
  return 'info';
}

/* ── Small building blocks ──────────────────────────────────────────────── */

function SectionCard({
  title,
  meta,
  testId,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section style={S.card} data-testid={testId} aria-label={title}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 14,
        }}
      >
        <h2 style={S.cardTitle}>{title}</h2>
        {meta}
      </div>
      {children}
    </section>
  );
}

/** Subtle dark-ledger / empty placeholder — never an empty void. */
function NoSignal({ isHi, testId }: { isHi: boolean; testId?: string }) {
  return (
    <div
      data-testid={testId}
      style={{
        padding: '18px 14px',
        borderRadius: 8,
        border: `1px dashed ${colors.borderStrong}`,
        background: colors.surface,
        color: colors.text3,
        fontSize: 12,
        textAlign: 'center',
        fontStyle: 'italic',
      }}
    >
      {isHi ? 'आंकड़े अभी नहीं' : 'No signal yet'}
    </div>
  );
}

function Metric({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div>
      <div style={S.metricValue}>{value}</div>
      <div style={S.metricLabel}>{label}</div>
    </div>
  );
}

function ChipRow({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (items.length === 0) {
    return <span style={{ fontSize: 12, color: colors.text3 }}>{emptyText}</span>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((it) => (
        <span key={it} style={S.chip}>
          {it}
        </span>
      ))}
    </div>
  );
}

/* ── Skeleton ───────────────────────────────────────────────────────────── */

function ReportSkeleton() {
  return (
    <div
      data-testid="foxy-report-skeleton"
      role="status"
      aria-live="polite"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 16,
        opacity: 0.6,
      }}
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} style={{ ...S.card, height: 150 }}>
          <div
            style={{
              height: 12,
              width: 120,
              background: colors.borderStrong,
              borderRadius: 4,
              opacity: 0.5,
              marginBottom: 16,
            }}
          />
          {[0, 1, 2].map((j) => (
            <div
              key={j}
              style={{
                height: 10,
                width: `${80 - j * 15}%`,
                background: colors.borderStrong,
                borderRadius: 4,
                opacity: 0.35,
                marginBottom: 10,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Fetcher ────────────────────────────────────────────────────────────── */

type ReportEnvelope = { success: boolean; data?: FoxyLearningReport; error?: string };

/* ── Main content ───────────────────────────────────────────────────────── */

function FoxyReportContent() {
  const { isHi } = useAuth();
  const { apiFetch } = useAdmin();
  const params = useParams();

  const studentId = typeof params.studentId === 'string' ? params.studentId : '';
  const apiUrl = `/api/super-admin/foxy-report/${studentId}`;

  const fetcher = useCallback(
    async (url: string): Promise<FoxyLearningReport> => {
      const res = await apiFetch(url);
      const body = (await res.json().catch(() => ({}))) as ReportEnvelope;
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      return body.data;
    },
    [apiFetch],
  );

  const { data, error, isLoading, mutate } = useSWR<FoxyLearningReport>(
    studentId ? apiUrl : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 5000 },
  );

  if (!studentId) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: colors.danger, fontSize: 14 }}>
        {isHi ? 'Student ID नहीं मिला।' : 'No student ID in the URL.'}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div>
          <Link
            href="/super-admin/students"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: colors.accent,
              textDecoration: 'none',
              marginBottom: 10,
            }}
          >
            &#8592; {isHi ? 'वापस Students' : 'Back to Students'}
          </Link>
          <h1 style={S.h1}>{isHi ? 'Foxy लर्निंग रिपोर्ट' : 'Foxy Learning Report'}</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            {isHi
              ? 'Foxy लर्निंग लूप ने इस student के लिए जो पकड़ा है — एक नज़र में। केवल पढ़ने के लिए, कोई PII नहीं।'
              : 'What the Foxy learning loop has captured for this student — at a glance. Read-only, no PII.'}
          </p>
        </div>
        <button
          onClick={() => mutate()}
          disabled={isLoading}
          className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
        >
          {isLoading ? (isHi ? 'लोड हो रहा है...' : 'Loading...') : isHi ? 'रिफ्रेश' : 'Refresh'}
        </button>
      </div>

      {/* Identity strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={{ ...S.card, padding: '14px 18px' }}>
          <div style={S.eyebrow}>{isHi ? 'Student ID' : 'Student ID'}</div>
          <code style={{ fontSize: 12, color: colors.text1, wordBreak: 'break-all' }}>
            {studentId}
          </code>
        </div>
        <div style={{ ...S.card, padding: '14px 18px' }}>
          <div style={S.eyebrow}>{isHi ? 'ग्रेड' : 'Grade'}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: colors.text1 }}>
            {data?.grade ?? '—'}
          </div>
        </div>
        <div style={{ ...S.card, padding: '14px 18px' }}>
          <div style={S.eyebrow}>{isHi ? 'रिपोर्ट बनी' : 'Generated At'}</div>
          <div style={{ fontSize: 13, color: colors.text2 }}>
            {formatTimestamp(data?.generatedAt ?? null)}
          </div>
        </div>
      </div>

      {/* Loading */}
      {isLoading && !data && <ReportSkeleton />}

      {/* Error */}
      {error && !isLoading && (
        <div
          data-testid="foxy-report-error"
          role="alert"
          style={{
            padding: 20,
            borderRadius: 8,
            background: colors.dangerLight,
            border: `1px solid ${colors.danger}`,
            color: colors.danger,
            fontSize: 13,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div>
            <strong>{isHi ? 'रिपोर्ट लोड नहीं हुई।' : 'Failed to load the report.'}</strong>
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
              {error instanceof Error ? error.message : String(error)}
            </div>
          </div>
          <button
            onClick={() => mutate()}
            className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
          >
            {isHi ? 'दोबारा कोशिश करें' : 'Retry'}
          </button>
        </div>
      )}

      {/* Report body */}
      {!isLoading && !error && data && (
        <>
          {/* Dark-ledger banner (subtle) */}
          {!data.ledgerAvailable && (
            <div
              data-testid="foxy-report-dark-ledger"
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px dashed ${colors.borderStrong}`,
                background: colors.surface,
                color: colors.text2,
                fontSize: 12,
                marginBottom: 16,
              }}
            >
              {isHi
                ? 'परसेप्शन/स्ट्रगल इवेंट लेजर अभी ramped नहीं है — कुछ सेक्शन में "आंकड़े अभी नहीं" दिखेगा।'
                : 'The perception/struggle event ledger is not ramped yet — some sections will show "No signal yet".'}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: 16,
              alignItems: 'start',
            }}
          >
            {/* 1. Engagement (live — always renders) */}
            <SectionCard
              title={isHi ? 'सहभागिता' : 'Engagement'}
              testId="section-engagement"
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 14,
                  marginBottom: 14,
                }}
              >
                <Metric
                  value={data.engagement.sessionCount}
                  label={isHi ? 'सेशन' : 'Sessions'}
                />
                <Metric
                  value={data.engagement.turnCount}
                  label={isHi ? 'छात्र के संदेश' : 'Student turns'}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={S.eyebrow}>{isHi ? 'आखिरी सक्रियता' : 'Last active'}</div>
                <div style={{ fontSize: 13, color: colors.text2 }}>
                  {formatTimestamp(data.engagement.lastActiveAt)}
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={S.eyebrow}>{isHi ? 'विषय' : 'Subjects'}</div>
                <ChipRow
                  items={data.engagement.subjects}
                  emptyText={isHi ? 'कोई नहीं' : 'None'}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={S.eyebrow}>{isHi ? 'अध्याय' : 'Chapters'}</div>
                <ChipRow
                  items={data.engagement.chapters}
                  emptyText={isHi ? 'कोई नहीं' : 'None'}
                />
              </div>
              <div>
                <div style={S.eyebrow}>{isHi ? 'मोड' : 'Modes'}</div>
                <ChipRow
                  items={data.engagement.modes}
                  emptyText={isHi ? 'कोई नहीं' : 'None'}
                />
              </div>
            </SectionCard>

            {/* 2. Evidential practice (live — always renders) */}
            <SectionCard
              title={isHi ? 'साक्ष्य-आधारित अभ्यास' : 'Evidential Practice'}
              testId="section-evidential"
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 14,
                }}
              >
                <Metric
                  value={data.evidentialPractice.served}
                  label={isHi ? 'दिए गए' : 'Served'}
                />
                <Metric
                  value={data.evidentialPractice.answered}
                  label={isHi ? 'उत्तर दिए' : 'Answered'}
                />
                <Metric
                  value={data.evidentialPractice.correct}
                  label={isHi ? 'सही' : 'Correct'}
                />
                <Metric
                  value={
                    data.evidentialPractice.accuracyPct === null
                      ? '—'
                      : `${data.evidentialPractice.accuracyPct}%`
                  }
                  label={isHi ? 'सटीकता' : 'Accuracy'}
                />
              </div>
              {data.evidentialPractice.answered === 0 && (
                <div style={{ marginTop: 12, fontSize: 12, color: colors.text3 }}>
                  {isHi
                    ? 'अभी तक कोई साक्ष्य-आधारित आइटम ग्रेड नहीं हुआ।'
                    : 'No evidential items graded yet.'}
                </div>
              )}
            </SectionCard>

            {/* 3. Mastery movement (live — always renders) */}
            <SectionCard
              title={isHi ? 'महारत की गति' : 'Mastery Movement'}
              testId="section-mastery"
              meta={
                <span style={{ fontSize: 12, color: colors.text3 }}>
                  {data.masteryMovement.conceptsPracticed}{' '}
                  {isHi ? 'concepts' : 'concepts'}
                </span>
              }
            >
              {data.masteryMovement.concepts.length === 0 ? (
                <div style={{ fontSize: 12, color: colors.text3 }}>
                  {isHi
                    ? 'अभी तक कोई concept अभ्यास नहीं हुआ।'
                    : 'No concepts practiced yet.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {data.masteryMovement.concepts.slice(0, 8).map((c) => {
                    const delta = formatDelta(c.recentDelta);
                    return (
                      <div
                        key={c.conceptId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 10,
                          paddingBottom: 8,
                          borderBottom: `1px solid ${colors.borderLight}`,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              color: colors.text1,
                              fontWeight: 600,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={c.conceptName ?? c.conceptId}
                          >
                            {c.conceptName ?? shortUuid(c.conceptId)}
                          </div>
                          <div style={{ fontSize: 11, color: colors.text3, marginTop: 2 }}>
                            {isHi ? 'प्रयास' : 'Attempts'}: {c.attempts} · {isHi ? 'बदलाव' : 'Δ'}:{' '}
                            <span style={{ color: delta.color, fontWeight: 600 }}>{delta.text}</span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: colors.text1 }}>
                            {pctFromMean(c.masteryMean)}
                          </div>
                          {c.band && (
                            <StatusBadge
                              label={MASTERY_BAND_LABELS[c.band][isHi ? 'hi' : 'en']}
                              variant={bandVariant(c.band)}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            {/* 4. Misconceptions (detected always; perception degrades) */}
            <SectionCard
              title={isHi ? 'भ्रांतियाँ' : 'Misconceptions'}
              testId="section-misconceptions"
              meta={
                <div style={{ display: 'flex', gap: 6 }}>
                  <StatusBadge
                    label={`${data.misconceptions.open} ${isHi ? 'खुली' : 'open'}`}
                    variant={data.misconceptions.open > 0 ? 'warning' : 'neutral'}
                  />
                  <StatusBadge
                    label={`${data.misconceptions.total} ${isHi ? 'कुल' : 'total'}`}
                    variant="neutral"
                  />
                </div>
              }
            >
              {data.misconceptions.items.length === 0 ? (
                <NoSignal isHi={isHi} testId="misconceptions-no-signal" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {data.misconceptions.items.slice(0, 8).map((m) => (
                    <div
                      key={m.code}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 10,
                        paddingBottom: 8,
                        borderBottom: `1px solid ${colors.borderLight}`,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: colors.text1, fontWeight: 600 }}>
                          {(isHi ? m.labelHi : m.label) ?? m.code}
                        </div>
                        <div style={{ fontSize: 11, color: colors.text3, marginTop: 2 }}>
                          <code>{m.code}</code>
                          {m.concept ? ` · ${m.concept}` : ''} · {isHi ? 'बार' : '×'}
                          {m.occurrences} · {formatTimestamp(m.lastSeenAt)}
                        </div>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          alignItems: 'flex-end',
                          flexShrink: 0,
                        }}
                      >
                        <StatusBadge label={m.source} variant={sourceVariant(m.source)} />
                        {m.resolved ? (
                          <StatusBadge
                            label={isHi ? 'हल हुई' : 'resolved'}
                            variant="success"
                          />
                        ) : (
                          <StatusBadge label={isHi ? 'खुली' : 'open'} variant="warning" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* 5. Lesson progress (live — always renders) */}
            <SectionCard
              title={isHi ? 'पाठ प्रगति' : 'Lesson Progress'}
              testId="section-lesson"
            >
              {data.lessonProgress && data.lessonProgress.active ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div style={S.eyebrow}>{isHi ? 'उद्देश्य concept' : 'Objective concept'}</div>
                    <div style={{ fontSize: 14, color: colors.text1, fontWeight: 600 }}>
                      {data.lessonProgress.objectiveConceptName ??
                        shortUuid(data.lessonProgress.objectiveConceptId)}
                    </div>
                  </div>
                  <div>
                    <div style={S.eyebrow}>{isHi ? 'पाठ चरण' : 'Lesson step'}</div>
                    <div style={{ fontSize: 13, color: colors.text2 }}>
                      {data.lessonProgress.lessonStep ?? '—'}
                    </div>
                  </div>
                  <div>
                    <div style={S.eyebrow}>{isHi ? 'सेशन' : 'Session'}</div>
                    <code style={{ fontSize: 11, color: colors.text3 }}>
                      {shortUuid(data.lessonProgress.sessionId)}
                    </code>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: colors.text3 }}>
                  {isHi ? 'कोई पाठ प्रगति पर नहीं।' : 'No lesson in progress.'}
                </div>
              )}
            </SectionCard>

            {/* 6. Struggle signals (ledger-derived — degrades) */}
            <SectionCard
              title={isHi ? 'संघर्ष संकेत' : 'Struggle Signals'}
              testId="section-struggle"
            >
              {!data.struggleSignals.available || data.struggleSignals.signals.length === 0 ? (
                <NoSignal isHi={isHi} testId="struggle-no-signal" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.struggleSignals.signals.map((sig) => (
                    <div
                      key={sig.signal}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 0',
                        borderBottom: `1px solid ${colors.borderLight}`,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, color: colors.text1, fontWeight: 600 }}>
                          {sig.signal}
                        </div>
                        <div style={{ fontSize: 11, color: colors.text3 }}>
                          {formatTimestamp(sig.lastObservedAt)}
                        </div>
                      </div>
                      <StatusBadge label={String(sig.count)} variant="info" />
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        </>
      )}
    </div>
  );
}

export default function FoxyReportPage() {
  return (
    <AdminShell>
      <FoxyReportContent />
    </AdminShell>
  );
}
