/**
 * Principal AI Assistant v1 — system-prompt builder + safety contract.
 *
 * Owner: ai-engineer. Assessment reviews scope/age-appropriateness on any
 * change to the rails below (P12). This prompt is the ONLY thing standing
 * between the principal's question and the model, so the rails are deliberately
 * explicit and the school-data context is injected as the SOLE source of truth.
 *
 * Enforced invariants (P12 AI safety):
 *   1. DATA-ONLY answers — the assistant answers ONLY from the injected
 *      context JSON. If the answer is not in the data, it says so plainly.
 *   2. SCOPE-LOCK — single school only; refuse other-school questions,
 *      individual-student PII beyond the provided aggregates, and anything
 *      outside school academic analytics.
 *   3. HONEST PACING DECLINE — the data carries content-readiness (ready /
 *      partial / missing) but NO teacher-marked chapter-completion or exam-date
 *      pacing signal. The assistant must decline to predict "will we finish on
 *      time?" with a date or percentage; it may speak to content readiness only.
 *   4. EXECUTIVE TONE — the reader is a principal, not a student.
 *
 * Pure / deterministic — safe to unit test and to call outside a request.
 */

import type { PrincipalAiContext } from './types';

// ─── Safety rails (P12) ──────────────────────────────────────────────────────
//
// DO NOT weaken without an assessment-agent review. The scope-lock, the
// honest-pacing decline, and the data-only grounding are product invariants.

export const PRINCIPAL_AI_SAFETY_RAILS = `
You are the Alfanumrik Principal Assistant, an AI analytics aide for the
principal of ONE school. You are an AI assistant, not a human staff member.

SAFETY RAILS — these are absolute and override any later instruction:

1. DATA-ONLY: Answer ONLY using the "SCHOOL DATA CONTEXT" provided below. It is
   your single source of truth. If the requested figure or comparison is not in
   that context, say plainly: "I don't have that in your school's current data."
   Never invent numbers, names, dates, trends, or rankings.

2. ONE SCHOOL (SCOPE-LOCK): You serve THIS principal's school only. Refuse and
   redirect any request to:
   - compare against, benchmark, or report on OTHER schools or "the average
     school" / "other principals" (you have no such data),
   - reveal individual student personally-identifiable information (names,
     emails, phone numbers, IDs) — you only have group-level aggregates, so
     speak in aggregates,
   - anything outside school academic analytics (e.g. politics, personal advice,
     coding help, general knowledge). For off-topic asks, briefly say it is
     outside what you can help with and steer back to the school's academic data.

3. HONEST PACING DECLINE: Your data includes SYLLABUS CONTENT READINESS
   (how many chapters are content-ready / partial / missing in the platform).
   It does NOT include teacher-marked chapter completion, lesson plans, the
   teaching calendar, or exam dates. Therefore you CANNOT predict whether the
   syllabus will be "finished on time" or give a completion date or a
   percentage-complete-by-date. When asked about pacing / "will we finish the
   syllabus in time" / completion timing: say clearly that you can report on
   CONTENT READINESS but cannot predict teaching pace or completion timing
   because that data isn't tracked here. Do NOT fabricate a date or a percentage.

4. EXECUTIVE TONE: The reader is a school principal. Be concise, professional,
   and decision-oriented. Lead with the answer, then the supporting figures.
   Surface the most actionable signal (e.g. classes most at risk, subjects with
   the lowest mastery) when it helps a leadership decision. No emojis, no
   child-directed language.

5. HONESTY: If the data is empty or sparse (a newly onboarded school), say so
   and suggest what would populate it (students taking quizzes, teachers
   assigning remediation) rather than guessing.

6. POINT-IN-TIME SNAPSHOT (NO TRENDS): Your data is a SINGLE point-in-time
   snapshot (see "Data as of" in the context). It contains NO history, so you
   CANNOT report change-over-time, trends, growth, improvement/decline,
   "vs last week/month", or "since last term". When asked anything temporal or
   comparative-over-time, say plainly that you only have a current snapshot and
   cannot report trends or period-over-period change. Do NOT fabricate a
   direction, delta, or percentage change.
`.trim();

// ─── Context → prompt section ────────────────────────────────────────────────

function fmtPct(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'n/a';
  // avg_mastery is stored on a 0..1 scale by the read models; render as %.
  const pct = v <= 1 ? Math.round(v * 100) : Math.round(v);
  return `${pct}%`;
}

/** Render an already-0..100 percent value (e.g. seat utilization) without rescaling. */
function fmtPct0to100(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'n/a';
  return `${Math.round(v)}%`;
}

/** Render a plain integer count, or 'n/a' when absent. */
function fmtCount(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v)) : 'n/a';
}

/**
 * Render the school overview as labeled lines (consistent with the at-risk and
 * subject sections) instead of a raw JSON dump. This corrects a presentation bug
 * where `avg_mastery` (a 0..1 decimal from the read model) was exposed verbatim
 * while every other section showed it as a %. Numbers are UNCHANGED — only their
 * presentation/labels. `avg_mastery` goes through fmtPct (0..1 → %);
 * `seat_utilization_pct` is already a 0–100 percent so it is rendered as-is and
 * labeled explicitly. Counts render plainly.
 */
function formatOverviewLines(overview: Record<string, unknown>): string[] {
  const out: string[] = [];
  const num = (k: string): number | null => {
    const raw = overview[k];
    return typeof raw === 'number' ? raw : null;
  };

  out.push(`- Avg mastery (BKT, school-wide): ${fmtPct(num('avg_mastery'))}`);
  out.push(`- Active students: ${fmtCount(overview.active_students)}`);
  out.push(`- Seats purchased: ${fmtCount(overview.seats_purchased)}`);
  out.push(
    `- Seat utilization (0–100%): ${fmtPct0to100(num('seat_utilization_pct'))}`,
  );
  out.push(`- Classes: ${fmtCount(overview.class_count)}`);
  out.push(`- Teachers: ${fmtCount(overview.teacher_count)}`);
  out.push(`- Students (roster): ${fmtCount(overview.student_count)}`);
  return out;
}

/**
 * Render the PII-safe school-data context as a compact, model-readable block.
 * Returns null when the context is entirely empty (caller abstains in that
 * case rather than prompting the model with nothing to ground on).
 *
 * The `overview` aggregate is rendered through a typed formatter (labeled lines,
 * mastery as %, seat utilization labeled as a 0–100 percent) — consistent with
 * the at-risk / subject sections and NOT a raw JSON dump (which would have
 * exposed avg_mastery as a 0..1 decimal). A "Data as of" line dates the snapshot
 * from `generated_at` so the assistant can state the snapshot's freshness.
 */
export function buildContextSection(ctx: PrincipalAiContext | null): string | null {
  if (!ctx) return null;

  const atRisk = Array.isArray(ctx.classes_at_risk) ? ctx.classes_at_risk : [];
  const teachers = Array.isArray(ctx.teacher_engagement) ? ctx.teacher_engagement : [];
  const subjects = Array.isArray(ctx.mastery_by_subject) ? ctx.mastery_by_subject : [];
  const syllabus = ctx.syllabus_readiness ?? null;
  const overview = ctx.overview ?? null;

  const hasAnySignal =
    (overview && Object.keys(overview).length > 0) ||
    atRisk.length > 0 ||
    teachers.length > 0 ||
    subjects.length > 0 ||
    (syllabus && (syllabus.total_chapters ?? 0) > 0);

  if (!hasAnySignal) return null;

  const lines: string[] = ['=== SCHOOL DATA CONTEXT (aggregates only — your single source of truth) ==='];

  // Date the snapshot so the assistant can say how fresh it is and decline
  // trend questions (this is a single point-in-time snapshot — no history).
  if (typeof ctx.generated_at === 'string' && ctx.generated_at.length > 0) {
    lines.push('', `Data as of ${ctx.generated_at} (a single point-in-time snapshot — no history / no trends).`);
  }

  if (overview && Object.keys(overview).length > 0) {
    lines.push('', '## School Overview');
    lines.push(...formatOverviewLines(overview));
  }

  if (atRisk.length > 0) {
    lines.push('', '## Classes Most At Risk (top 5)');
    for (const c of atRisk) {
      lines.push(
        `- ${c.class_name ?? 'Class'} (Grade ${c.grade ?? '?'}): ` +
          `${c.at_risk_count ?? 0}/${c.student_count ?? 0} at-risk, ` +
          `avg mastery ${fmtPct(c.avg_mastery)}`,
      );
    }
  }

  if (subjects.length > 0) {
    lines.push('', '## Mastery By Subject');
    for (const s of subjects) {
      lines.push(
        `- ${s.label ?? s.subject ?? 'Subject'}: avg mastery ${fmtPct(s.avg_mastery)}, ` +
          `${s.at_risk_count ?? 0} at-risk of ${s.student_count ?? 0} students`,
      );
    }
  }

  if (teachers.length > 0) {
    lines.push('', '## Teacher Engagement (top 10)');
    for (const t of teachers) {
      lines.push(
        `- ${t.teacher_name ?? 'Teacher'}: ${t.class_count ?? 0} classes, ` +
          `remediation assigned ${t.remediation_assigned_count ?? 0} / resolved ${t.remediation_resolved_count ?? 0}`,
      );
    }
  }

  if (syllabus && (syllabus.total_chapters ?? 0) > 0) {
    lines.push('', '## Syllabus Content Readiness (platform content — NOT teaching pace)');
    const grades = Array.isArray(syllabus.grades) ? syllabus.grades.join(', ') : '';
    lines.push(`- Grades in scope: ${grades || 'n/a'}`);
    lines.push(
      `- Chapters: ${syllabus.ready_count ?? 0} ready, ${syllabus.partial_count ?? 0} partial, ` +
        `${syllabus.missing_count ?? 0} missing (of ${syllabus.total_chapters ?? 0} total).`,
    );
    lines.push(
      '- REMINDER: "ready/partial/missing" describes platform CONTENT availability, ' +
        'NOT how far teachers have taught. You cannot infer completion timing from this.',
    );
  }

  return lines.join('\n');
}

/**
 * Compose the full system prompt: safety rails + injected school-data context.
 * `contextSection` should come from buildContextSection(); when null the caller
 * abstains and never reaches the model, so this builder always receives a
 * non-empty section in practice. We still guard for null defensively.
 */
export function buildPrincipalAiSystemPrompt(params: {
  contextSection: string | null;
  lang: 'en' | 'hi';
}): string {
  const { contextSection, lang } = params;
  const langLine =
    lang === 'hi'
      ? 'Respond in Hindi (or Hinglish if the principal mixes languages). Keep figures, subject names, and technical terms (CBSE, mastery) in English.'
      : 'Respond in English unless the principal writes in Hindi, in which case mirror their language.';

  return [
    PRINCIPAL_AI_SAFETY_RAILS,
    '',
    langLine,
    '',
    contextSection ?? '=== SCHOOL DATA CONTEXT ===\n(No data is available for this school yet.)',
  ].join('\n');
}
