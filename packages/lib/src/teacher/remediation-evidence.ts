/**
 * packages/lib/src/teacher/remediation-evidence.ts
 *
 * Phase 5 (Foxy North-Star), lane K3.
 *
 * Pure, dependency-free "evidence" builder for the teacher Assign flow.
 * The API route (`apps/host/src/app/api/teacher/remediation/route.ts`) and the
 * teacher-dashboard Edge Function's `deploy_intervention` handler BOTH stamp
 * this same shape onto `teacher_remediation_assignments.evidence` (JSONB —
 * added by the parallel architect migration). This module owns the shape;
 * the Deno EF carries a byte-for-byte mirror of the pure builder in its
 * `_shared/` tree (Deno can't import packages/lib) — if you change one,
 * change both in the same PR.
 *
 * Contract (P13): UUIDs, counts, and timestamps only. No question text, no
 * answer strings, no PII. Rows never match /name|email|phone/i.
 *
 * Aggregation window: last 14 days of `quiz_responses` (default). Callers
 * that want a smaller / larger window pass `sinceDays`.
 *
 * Aggregated shape per student:
 *   {
 *     attempts:          number,          // total quiz_responses rows
 *     incorrect:         number,          // rows with is_correct = false
 *     hintLevelMax:      number | null,   // max hint_level observed (0..5) or null
 *     misconceptionIds:  string[],        // distinct non-null misconception_id UUIDs
 *     firstSeen:         string | null,   // ISO timestamp of oldest quiz_response in window
 *     lastSeen:          string | null,   // ISO timestamp of most recent quiz_response in window
 *     sinceDays:         number,          // window used (echoed for auditability)
 *   }
 *
 * Callers that have already loaded the raw rows (a batched fan-out over many
 * students) pass them via `buildEvidenceFromRows`. Callers that only have a
 * Supabase-shaped `.from('quiz_responses').select(...)` executor pass it via
 * `buildEvidenceForStudents`.
 */

export interface Evidence {
  attempts: number;
  incorrect: number;
  hintLevelMax: number | null;
  misconceptionIds: string[];
  firstSeen: string | null;
  lastSeen: string | null;
  sinceDays: number;
}

/** A row shape compatible with what both the API route and EF actually SELECT. */
export interface EvidenceRow {
  student_id: string;
  is_correct: boolean | null;
  hint_level: number | null;
  misconception_id: string | null;
  created_at: string; // ISO
}

/**
 * Aggregate raw rows (already fetched, already scoped to `sinceDays`) into
 * per-student Evidence. Pure — safe to unit-test.
 */
export function buildEvidenceFromRows(
  rows: readonly EvidenceRow[],
  studentIds: readonly string[],
  sinceDays: number,
): Map<string, Evidence> {
  const internal = new Map<string, EvidenceInternal>();
  // Seed a zero-evidence entry for every requested student so callers get
  // deterministic output even when the student has no responses in-window.
  for (const id of studentIds) internal.set(id, emptyEvidence(sinceDays));

  for (const row of rows) {
    if (!row?.student_id) continue;
    const ev = internal.get(row.student_id);
    if (!ev) continue; // student not in requested scope

    ev.attempts += 1;
    if (row.is_correct === false) ev.incorrect += 1;

    if (row.hint_level != null && Number.isFinite(row.hint_level)) {
      const hl = Number(row.hint_level);
      if (ev.hintLevelMax == null || hl > ev.hintLevelMax) ev.hintLevelMax = hl;
    }

    if (row.misconception_id && !ev._misconceptionSet.has(row.misconception_id)) {
      ev._misconceptionSet.add(row.misconception_id);
      ev.misconceptionIds.push(row.misconception_id);
    }

    if (row.created_at) {
      if (ev.firstSeen == null || row.created_at < ev.firstSeen) ev.firstSeen = row.created_at;
      if (ev.lastSeen == null || row.created_at > ev.lastSeen) ev.lastSeen = row.created_at;
    }
  }

  // Strip the internal dedupe set before returning: return a fresh Map<string, Evidence>.
  const out = new Map<string, Evidence>();
  for (const [id, ev] of internal.entries()) {
    const { _misconceptionSet: _unused, ...clean } = ev;
    void _unused;
    out.set(id, clean);
  }
  return out;
}

/**
 * Minimal Supabase-client shape this module needs. Matches the surface both
 * `@supabase/supabase-js` clients (browser + service-role) expose. Kept
 * dependency-free so this module doesn't drag a full Supabase type into
 * every consumer.
 */
export interface EvidenceQueryClient {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: readonly string[]): {
        gte(column: string, value: string): Promise<{
          data: EvidenceRow[] | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

/**
 * Fetch and aggregate evidence for a batch of students in ONE round-trip.
 * Uses `quiz_responses` — the canonical answer-attempt ledger. Falls back to
 * zero-evidence for every student when the query errors (fail-soft — the
 * Assign flow must never break because evidence is unavailable).
 */
export async function buildEvidenceForStudents(
  supabase: EvidenceQueryClient,
  studentIds: readonly string[],
  sinceDays = 14,
): Promise<Map<string, Evidence>> {
  const window = Math.max(1, Math.min(90, Math.trunc(sinceDays))); // clamp 1..90
  if (studentIds.length === 0) return new Map();

  const sinceIso = new Date(Date.now() - window * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('quiz_responses')
    .select('student_id, is_correct, hint_level, misconception_id, created_at')
    .in('student_id', studentIds)
    .gte('created_at', sinceIso);

  if (error) {
    // Fail-soft — return zero-evidence for every requested student.
    const out = new Map<string, Evidence>();
    for (const id of studentIds) out.set(id, emptyEvidence(window));
    return out;
  }

  return buildEvidenceFromRows((data ?? []) as EvidenceRow[], studentIds, window);
}

/**
 * Serializable form suitable for `teacher_remediation_assignments.evidence`
 * (JSONB). Callers should NOT stamp the raw `Evidence` object because the
 * internal `_misconceptionSet` (which is already stripped) would drag a Set
 * into JSON.stringify if we ever changed the impl.
 */
export function evidenceToJsonb(ev: Evidence): Record<string, unknown> {
  return {
    attempts: ev.attempts,
    incorrect: ev.incorrect,
    hint_level_max: ev.hintLevelMax,
    misconception_ids: ev.misconceptionIds,
    first_seen: ev.firstSeen,
    last_seen: ev.lastSeen,
    since_days: ev.sinceDays,
    schema_version: 1,
  };
}

// ─── internals ──────────────────────────────────────────────────────
type EvidenceInternal = Evidence & { _misconceptionSet: Set<string> };

function emptyEvidence(sinceDays: number): EvidenceInternal {
  return {
    attempts: 0,
    incorrect: 0,
    hintLevelMax: null,
    misconceptionIds: [],
    firstSeen: null,
    lastSeen: null,
    sinceDays,
    _misconceptionSet: new Set<string>(),
  };
}
