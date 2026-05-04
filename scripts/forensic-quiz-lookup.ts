/**
 * Forensic Quiz Lookup — Phase 0 of marking-authenticity remediation.
 *
 * Pulls the last 30 days of quiz_sessions for a given student and validates
 * each session against the P-invariants (P1 score formula, P3 anti-cheat,
 * P6 question quality via snapshot integrity). Outputs a redacted Markdown
 * report to tmp/forensic-${student_id}-${ISO_date}.md.
 *
 * Usage:
 *   npm run forensic:quiz -- --student-id <UUID>
 *   npm run forensic:quiz -- --name "Hridaan Kaushik"
 *
 * Exit codes:
 *   0 — CLEAN (no anomalies)
 *   1 — FAIL (score-formula mismatch, snapshot drift, or anti-cheat violation)
 *
 * Privacy posture (P13):
 *   The report contains the student_id UUID and student initials only.
 *   Never email, full name, phone, or auth_user_id. Use UUIDs for rerun.
 *
 * Lookup constraint (per founder spec):
 *   We support `--name` for ops convenience, but the report only ever shows
 *   initials. There is NO `--email` / `--phone` flag — we don't grant
 *   ops a name→PII reverse channel.
 */

/* eslint-disable no-console */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// ─── CLI parsing ────────────────────────────────────────────────────────────

interface Args {
  studentId?: string;
  name?: string;
  days: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { days: 30 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--student-id' && argv[i + 1]) {
      args.studentId = argv[++i];
    } else if (a === '--name' && argv[i + 1]) {
      args.name = argv[++i];
    } else if (a === '--days' && argv[i + 1]) {
      args.days = Math.max(1, Math.min(90, Number(argv[++i]) || 30));
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: npm run forensic:quiz -- --student-id <UUID> [--days 30]');
      console.log('       npm run forensic:quiz -- --name "Student Name" [--days 30]');
      process.exit(0);
    }
  }
  if (!args.studentId && !args.name) {
    console.error('ERROR: provide --student-id <UUID> or --name "Full Name"');
    process.exit(2);
  }
  return args;
}

// ─── Supabase admin client (service role) ──────────────────────────────────

function getAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(2);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ─── Lookup helpers ────────────────────────────────────────────────────────

interface StudentLookup {
  id: string;
  initials: string;
  grade: string | null;
}

async function resolveStudent(admin: SupabaseClient, args: Args): Promise<StudentLookup | null> {
  if (args.studentId) {
    const { data, error } = await admin
      .from('students')
      .select('id, full_name, grade')
      .eq('id', args.studentId)
      .maybeSingle();
    if (error || !data) return null;
    return { id: data.id, initials: deriveInitials(data.full_name), grade: data.grade };
  }
  if (args.name) {
    // ILIKE-style match. Limit 5 — if more than one matches we abort to avoid
    // ambiguity (ops should re-run with the UUID).
    const { data, error } = await admin
      .from('students')
      .select('id, full_name, grade')
      .ilike('full_name', `%${args.name}%`)
      .limit(5);
    if (error || !data || data.length === 0) return null;
    if (data.length > 1) {
      console.error(`ERROR: --name matched ${data.length} students. Re-run with --student-id <UUID>.`);
      console.error('Candidates (initials only):');
      for (const s of data) {
        console.error(`  ${s.id} — ${deriveInitials(s.full_name)} (grade ${s.grade ?? '?'})`);
      }
      process.exit(2);
    }
    return { id: data[0].id, initials: deriveInitials(data[0].full_name), grade: data[0].grade };
  }
  return null;
}

function deriveInitials(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return 'XX';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'XX';
  if (parts.length === 1) return (parts[0][0] || 'X').toUpperCase() + 'X';
  return (parts[0][0] || 'X').toUpperCase() + (parts[parts.length - 1][0] || 'X').toUpperCase();
}

// ─── Validation logic ─────────────────────────────────────────────────────

interface QuizSessionRow {
  id: string;
  student_id: string;
  subject: string;
  total_questions: number;
  correct_answers: number;
  score_percent: number;
  score: number;
  time_taken_seconds: number;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
  idempotency_key: string | null;
}

interface QuizResponseRow {
  quiz_session_id: string;
  question_id: string;
  selected_option: number;
  is_correct: boolean;
  question_number: number | null;
}

interface ShuffleRow {
  session_id: string;
  question_id: string;
  shuffle_map: number[] | null;
  correct_answer_index_snapshot: number | null;
  options_snapshot: unknown;
}

interface SessionFinding {
  session_id: string;
  subject: string;
  total: number;
  correct: number;
  score_percent: number;
  expected_score_percent: number;
  score_formula_ok: boolean;
  avg_seconds_per_q: number;
  anti_cheat_ok: boolean;
  snapshot_integrity_ok: boolean;
  snapshot_issues: string[];
  responses_count: number;
  shuffle_count: number;
  completed_at: string | null;
}

function validateSession(
  session: QuizSessionRow,
  responses: QuizResponseRow[],
  shuffles: ShuffleRow[],
): SessionFinding {
  // P1 — score formula
  const expectedPct = session.total_questions > 0
    ? Math.round((session.correct_answers / session.total_questions) * 100)
    : 0;
  const scoreOk = expectedPct === session.score_percent;

  // P3 — anti-cheat
  const avg = session.total_questions > 0
    ? session.time_taken_seconds / session.total_questions
    : 0;
  const antiCheatOk = avg >= 3.0;

  // P6 — snapshot integrity: every recorded response's is_correct must match
  // (selected_displayed_index → shuffle_map[selected] === correct_answer_index_snapshot).
  const shuffleByQ = new Map<string, ShuffleRow>();
  for (const s of shuffles) shuffleByQ.set(s.question_id, s);

  const snapshotIssues: string[] = [];
  for (const r of responses) {
    const snap = shuffleByQ.get(r.question_id);
    if (!snap) {
      snapshotIssues.push(`q=${r.question_id.slice(0, 8)}: missing shuffle snapshot`);
      continue;
    }
    if (snap.correct_answer_index_snapshot === null) {
      snapshotIssues.push(`q=${r.question_id.slice(0, 8)}: snapshot has null correct_answer_index`);
      continue;
    }
    const shuffle = snap.shuffle_map;
    let selectedOriginal = r.selected_option;
    if (Array.isArray(shuffle) && shuffle.length === 4 &&
        r.selected_option >= 0 && r.selected_option < 4) {
      selectedOriginal = shuffle[r.selected_option];
    }
    const expectedIsCorrect = selectedOriginal === snap.correct_answer_index_snapshot;
    if (expectedIsCorrect !== r.is_correct) {
      snapshotIssues.push(
        `q=${r.question_id.slice(0, 8)}: stored is_correct=${r.is_correct} ` +
          `but snapshot says ${expectedIsCorrect} (selected_disp=${r.selected_option}, ` +
          `selected_orig=${selectedOriginal}, correct_orig=${snap.correct_answer_index_snapshot})`,
      );
    }
  }

  return {
    session_id: session.id,
    subject: session.subject,
    total: session.total_questions,
    correct: session.correct_answers,
    score_percent: session.score_percent,
    expected_score_percent: expectedPct,
    score_formula_ok: scoreOk,
    avg_seconds_per_q: Math.round(avg * 10) / 10,
    anti_cheat_ok: antiCheatOk,
    snapshot_integrity_ok: snapshotIssues.length === 0,
    snapshot_issues: snapshotIssues,
    responses_count: responses.length,
    shuffle_count: shuffles.length,
    completed_at: session.completed_at,
  };
}

// ─── Markdown report ──────────────────────────────────────────────────────

function buildReport(
  student: StudentLookup,
  sinceIso: string,
  findings: SessionFinding[],
  opsEvents: Array<{ category: string; severity: string; message: string; created_at: string }>,
  verdict: 'CLEAN' | 'SUSPECT' | 'FAIL',
): string {
  const lines: string[] = [];
  lines.push(`# Forensic Quiz Report — Student ${student.initials}`);
  lines.push('');
  lines.push(`- student_id: \`${student.id}\``);
  lines.push(`- grade: ${student.grade ?? 'unknown'}`);
  lines.push(`- window: since \`${sinceIso}\``);
  lines.push(`- sessions analyzed: **${findings.length}**`);
  lines.push(`- verdict: **${verdict}**`);
  lines.push('');
  lines.push('## Per-session validation');
  lines.push('');
  lines.push('| session_id | subject | total | correct | score% | expected% | P1 ok | avg s/q | P3 ok | snapshot ok | issues |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const f of findings) {
    lines.push(
      `| \`${f.session_id.slice(0, 8)}…\` | ${f.subject} | ${f.total} | ${f.correct} | ` +
      `${f.score_percent} | ${f.expected_score_percent} | ${f.score_formula_ok ? 'YES' : 'NO'} | ` +
      `${f.avg_seconds_per_q} | ${f.anti_cheat_ok ? 'YES' : 'NO'} | ` +
      `${f.snapshot_integrity_ok ? 'YES' : 'NO'} | ${f.snapshot_issues.length} |`,
    );
  }
  lines.push('');

  const failed = findings.filter(f => !f.score_formula_ok || !f.snapshot_integrity_ok || !f.anti_cheat_ok);
  if (failed.length > 0) {
    lines.push('## Anomalies');
    lines.push('');
    for (const f of failed) {
      lines.push(`### Session \`${f.session_id}\``);
      lines.push('');
      if (!f.score_formula_ok) {
        lines.push(`- **P1 score formula MISMATCH**: stored ${f.score_percent}%, expected ${f.expected_score_percent}%`);
      }
      if (!f.anti_cheat_ok) {
        lines.push(`- **P3 anti-cheat**: avg ${f.avg_seconds_per_q}s per question (< 3s threshold)`);
      }
      if (!f.snapshot_integrity_ok) {
        lines.push(`- **P6 snapshot integrity** (${f.snapshot_issues.length} issues):`);
        for (const issue of f.snapshot_issues.slice(0, 10)) {
          lines.push(`  - ${issue}`);
        }
        if (f.snapshot_issues.length > 10) {
          lines.push(`  - …and ${f.snapshot_issues.length - 10} more`);
        }
      }
      if (f.responses_count !== f.total) {
        lines.push(`- response count drift: stored ${f.responses_count} responses for ${f.total} questions`);
      }
      lines.push('');
    }
  }

  if (opsEvents.length > 0) {
    lines.push('## Recent ops_events (quiz/grounding)');
    lines.push('');
    lines.push('| when | category | severity | message |');
    lines.push('|---|---|---|---|');
    for (const e of opsEvents.slice(0, 50)) {
      lines.push(`| ${e.created_at} | ${e.category} | ${e.severity} | ${e.message} |`);
    }
    if (opsEvents.length > 50) {
      lines.push('');
      lines.push(`(${opsEvents.length - 50} additional events truncated)`);
    }
  }

  return lines.join('\n') + '\n';
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const admin = getAdmin();

  const student = await resolveStudent(admin, args);
  if (!student) {
    console.error('ERROR: student not found');
    process.exit(2);
  }

  const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000).toISOString();

  // Pull sessions in window.
  const { data: sessions, error: sErr } = await admin
    .from('quiz_sessions')
    .select('id, student_id, subject, total_questions, correct_answers, score_percent, score, time_taken_seconds, is_completed, completed_at, created_at, idempotency_key')
    .eq('student_id', student.id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);
  if (sErr) {
    console.error('ERROR: quiz_sessions fetch failed:', sErr.message);
    process.exit(2);
  }

  const sessionRows = (sessions ?? []) as QuizSessionRow[];
  const sessionIds = sessionRows.map(s => s.id);

  // Pull responses + shuffles for these sessions.
  let responses: QuizResponseRow[] = [];
  let shuffles: ShuffleRow[] = [];
  if (sessionIds.length > 0) {
    const { data: rData } = await admin
      .from('quiz_responses')
      .select('quiz_session_id, question_id, selected_option, is_correct, question_number')
      .in('quiz_session_id', sessionIds);
    responses = (rData ?? []) as QuizResponseRow[];
    const { data: shData } = await admin
      .from('quiz_session_shuffles')
      .select('session_id, question_id, shuffle_map, correct_answer_index_snapshot, options_snapshot')
      .in('session_id', sessionIds);
    shuffles = (shData ?? []) as ShuffleRow[];
  }

  // Group by session.
  const respBySession = new Map<string, QuizResponseRow[]>();
  for (const r of responses) {
    const a = respBySession.get(r.quiz_session_id) ?? [];
    a.push(r);
    respBySession.set(r.quiz_session_id, a);
  }
  const shuffBySession = new Map<string, ShuffleRow[]>();
  for (const s of shuffles) {
    const a = shuffBySession.get(s.session_id) ?? [];
    a.push(s);
    shuffBySession.set(s.session_id, a);
  }

  const findings: SessionFinding[] = [];
  for (const sess of sessionRows) {
    findings.push(validateSession(
      sess,
      respBySession.get(sess.id) ?? [],
      shuffBySession.get(sess.id) ?? [],
    ));
  }

  // Recent ops_events for quiz/grounding categories.
  let opsEvents: Array<{ category: string; severity: string; message: string; created_at: string }> = [];
  try {
    const { data: opsData } = await admin
      .from('ops_events')
      .select('category, severity, message, created_at')
      .or('category.like.quiz.%,category.like.grounding.%,category.eq.quiz,category.eq.grounding')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200);
    opsEvents = (opsData ?? []) as typeof opsEvents;
  } catch {
    // ops_events table may have a different schema in some envs; ignore.
  }

  // Verdict.
  const hasFail = findings.some(f => !f.score_formula_ok || !f.snapshot_integrity_ok);
  const hasSuspect = findings.some(f => !f.anti_cheat_ok);
  const verdict: 'CLEAN' | 'SUSPECT' | 'FAIL' = hasFail ? 'FAIL' : hasSuspect ? 'SUSPECT' : 'CLEAN';

  const report = buildReport(student, since, findings, opsEvents, verdict);

  // Write report.
  const outPath = resolve(
    process.cwd(),
    'tmp',
    `forensic-${student.id}-${new Date().toISOString().slice(0, 10)}.md`,
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, report, 'utf8');

  // Stdout summary.
  console.log(`Student: ${student.initials} (${student.id})`);
  console.log(`Window:  since ${since}`);
  console.log(`Sessions analyzed: ${findings.length}`);
  console.log(`P1 mismatches:     ${findings.filter(f => !f.score_formula_ok).length}`);
  console.log(`P3 anti-cheat:     ${findings.filter(f => !f.anti_cheat_ok).length}`);
  console.log(`P6 snapshot drift: ${findings.filter(f => !f.snapshot_integrity_ok).length}`);
  console.log(`Verdict: ${verdict}`);
  console.log(`Report:  ${outPath}`);

  process.exit(verdict === 'FAIL' ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(2);
});
