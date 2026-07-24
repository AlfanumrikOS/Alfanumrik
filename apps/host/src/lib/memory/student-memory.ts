/**
 * Unified Student Memory read-API — orchestrator + renderer (GenAI arch Phase 2).
 *
 * A single `getStudentMemory(...)` that WRAPS the three existing Foxy-family
 * learner-state readers into one typed `StudentMemory`, plus a PII-safe prompt
 * renderer and the DPDP erasure guard. Gated by `ff_unified_memory_v1` (default
 * OFF). OFF = today's per-reader behavior, byte-identical; this module is not on
 * any hot path when OFF.
 *
 * ── PLACEMENT ────────────────────────────────────────────────────────────────
 * This orchestrator lives in the APP layer (apps/host/src/lib/memory) — NOT in
 * packages/lib — because it composes the APP-LAYER `CognitiveContext` type and
 * `loadCognitiveContext` reader (apps/host/src/app/api/foxy/_lib/*), which are
 * deliberately out of scope for packages/lib (task: do NOT force
 * loadCognitiveContext into packages/lib). The two cleanly app-independent
 * pieces live in packages/lib/src/memory/*:
 *   - the DPDP erasure guard    → @alfanumrik/lib/memory/erasure-guard
 *   - the preferences reader    → @alfanumrik/lib/memory/preferences
 * The renderer reuses the EXISTING per-slice renderers (buildCognitivePromptSection,
 * renderTwinPromptSection, buildLongMemoryPromptSection) so output is identical
 * to today's per-reader assembly for the same inputs.
 *
 * ── DESIGN STANCE (spec §0, non-negotiable) ──────────────────────────────────
 *  1. WRAP, do not re-derive. Every field is projected verbatim from an existing
 *     reader. This module invents NO new mastery math and NO new thresholds /
 *     numeric literals (spec §7).
 *  2. READ-ONLY context. Nothing here writes mastery, progression, XP, gaps, or
 *     review schedules (spec §6).
 *  3. FAIL-SOFT, never throw. Any sub-read failure degrades that slice to its
 *     empty value; the whole call never rejects into the caller (spec §2.2).
 *  4. PII-clean rendered output (spec §4 / P13).
 *  5. Authorization is UPSTREAM.
 *
 * ── PRECONDITION (spec §2.1 / REG-121) ───────────────────────────────────────
 * The caller MUST have already enforced `canAccessStudent` on the user-JWT
 * boundary. `getStudentMemory` does NOT re-authorize and does NOT accept an
 * authUserId — it reads with the service-role client. Passing an unauthorized
 * studentId is a caller bug, not something this function guards.
 *
 * ── DPDP ERASURE GUARD (spec §3, the one new behavior) ───────────────────────
 * The erasure-pending check runs BEFORE any sub-read. If the student has an
 * in-flight erasure row (status pending|purging) — or if the check itself errors
 * (FAIL-CLOSED) — the sub-reads are SKIPPED and fully-empty memory is returned.
 */
import {
  type CognitiveContext,
  EMPTY_COGNITIVE_CONTEXT,
} from '@/app/api/foxy/_lib/constants';
import {
  loadCognitiveContext,
  loadTwinContextForFoxy,
} from '@/app/api/foxy/_lib/cognitive-context';
import {
  type TwinContext,
  renderTwinPromptSection,
} from '@alfanumrik/lib/learn/build-twin-context';
import {
  type LongMemorySnapshot,
  EMPTY_LONG_MEMORY,
  loadLongMemorySnapshot,
  buildLongMemoryPromptSection,
} from '@alfanumrik/lib/learn/foxy-long-memory';
import { buildCognitivePromptSection } from '@alfanumrik/lib/foxy/prompt-sections';
import {
  type StudentPreferences,
  EMPTY_PREFERENCES,
  loadStudentPreferences,
} from '@alfanumrik/lib/memory/preferences';
import { isErasurePending } from '@alfanumrik/lib/memory/erasure-guard';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';

export type { StudentPreferences } from '@alfanumrik/lib/memory/preferences';

// ─── The composite read-model (spec §1) ──────────────────────────────────────
//
// StudentMemory is a COMPOSITION of the three existing sub-types embedded WHOLE
// (by reference). It does NOT flatten or redefine their fields — mastery math
// stays in exactly one place.
export interface StudentMemory {
  // identity keys (spec §1 Group F)
  studentId: string;
  subject: string;
  /** P5: STRING "6".."12", never int. */
  grade: string;
  chapter: string | null;

  // mastery (whole CognitiveContext, by composition)
  cognitive: CognitiveContext;
  // longitudinal / retention-decay / episodic (null when twin OFF or no snapshot)
  twin: TwinContext | null;
  // cross-session ~30d memory (EMPTY_LONG_MEMORY when unavailable)
  longMemory: LongMemorySnapshot;
  // advisory preferences (spec §1.5)
  preferences: StudentPreferences;

  // true when every slice is empty
  isEmpty: boolean;
}

// ─── Injectable sub-reads (testability) ──────────────────────────────────────
//
// Each sub-read is injectable so tests can fake it and so the Foxy proof
// consumer can inject its already-loaded, already-per-user-flag-gated contexts
// (guaranteeing byte-identity without re-doing DB work). Production defaults
// wire to the real readers via the service-role client.
export interface StudentMemoryDeps {
  loadCognitive: (
    studentId: string,
    subject: string,
    grade: string,
    chapter: string | null,
  ) => Promise<CognitiveContext>;
  loadTwin: (studentId: string) => Promise<TwinContext | null>;
  loadLongMemory: (
    studentId: string,
    subject: string,
    misconceptionLabels: string[],
  ) => Promise<LongMemorySnapshot>;
  loadPreferences: (studentId: string) => Promise<StudentPreferences>;
  erasurePending: (studentId: string) => Promise<boolean>;
}

// Production defaults. Twin + long-memory preserve their EXISTING flag gating
// (spec §2.2): the unified flag gates the composition + DPDP guard, NOT the
// pre-existing readers' own flags. These global-context flag reads are the
// standalone default; the Foxy proof consumer instead INJECTS its already
// per-user-gated values (see route.ts), so exact gating is preserved there.
const defaultDeps: StudentMemoryDeps = {
  loadCognitive: (studentId, subject, grade, chapter) =>
    loadCognitiveContext(studentId, subject, grade, chapter),

  loadTwin: async (studentId) => {
    const on = await isFeatureEnabled('ff_digital_twin_v1');
    if (!on) return null;
    return loadTwinContextForFoxy(studentId);
  },

  loadLongMemory: async (studentId, subject, misconceptionLabels) => {
    const on = await isFeatureEnabled('ff_foxy_long_memory_v1');
    if (!on) return EMPTY_LONG_MEMORY;
    // studentName is used only to scrub the synthesis free-text; best-effort.
    let studentName: string | null = null;
    try {
      const { data } = await supabaseAdmin
        .from('students')
        .select('name')
        .eq('id', studentId)
        .maybeSingle();
      studentName = (data as { name?: string | null } | null)?.name ?? null;
    } catch {
      // generic address-line scrub still applies inside loadLongMemorySnapshot
    }
    return loadLongMemorySnapshot(
      supabaseAdmin,
      studentId,
      subject,
      studentName,
      misconceptionLabels,
    );
  },

  loadPreferences: (studentId) => loadStudentPreferences(studentId),

  erasurePending: (studentId) => isErasurePending(studentId),
};

// ─── Emptiness predicates (structural equality to the canonical EMPTY values) ─
// No new thresholds — these only compare array lengths / null scalars.
function cognitiveIsEmpty(c: CognitiveContext): boolean {
  return (
    c.weakTopics.length === 0 &&
    c.strongTopics.length === 0 &&
    c.knowledgeGaps.length === 0 &&
    c.revisionDue.length === 0 &&
    c.recentErrors.length === 0 &&
    c.nextAction === null &&
    c.masteryLevel === EMPTY_COGNITIVE_CONTEXT.masteryLevel &&
    c.loSkills.length === 0 &&
    c.recentMisconceptions.length === 0
  );
}

function longMemoryIsEmpty(m: LongMemorySnapshot): boolean {
  return (
    m.synthesis_month === null &&
    m.synthesis_summary === null &&
    m.high_concepts.length === 0 &&
    m.low_concepts.length === 0 &&
    m.top_misconceptions.length === 0
  );
}

function preferencesIsEmpty(p: StudentPreferences): boolean {
  return p.learningStyle === null && p.preferredExplanationDepth === null;
}

function emptyMemory(
  studentId: string,
  subject: string,
  grade: string,
  chapter: string | null,
): StudentMemory {
  return {
    studentId,
    subject,
    grade,
    chapter,
    cognitive: EMPTY_COGNITIVE_CONTEXT,
    twin: null,
    longMemory: EMPTY_LONG_MEMORY,
    preferences: EMPTY_PREFERENCES,
    isEmpty: true,
  };
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Compose the three existing learner-state readers into one `StudentMemory`.
 * Service-role read (see PRECONDITION in the file header — authorize upstream).
 * Fail-soft on every sub-read; fail-CLOSED on the DPDP erasure guard.
 *
 * @param studentId students.id (the Foxy-family key — spec §5)
 * @param opts      { subject, grade (STRING, P5), chapter? }
 * @param deps      injectable sub-reads (tests / the Foxy proof consumer)
 */
export async function getStudentMemory(
  studentId: string,
  opts: { subject: string; grade: string; chapter?: string | null },
  deps: Partial<StudentMemoryDeps> = {},
): Promise<StudentMemory> {
  const { subject, grade } = opts;
  const chapter = opts.chapter ?? null;
  const d: StudentMemoryDeps = { ...defaultDeps, ...deps };

  // ── DPDP erasure guard (spec §3) — BEFORE any sub-read; FAIL-CLOSED ──
  let erasurePending: boolean;
  try {
    erasurePending = await d.erasurePending(studentId);
  } catch {
    // Defense-in-depth: the guard itself already fails closed, but if the
    // injected check throws we still trip the guard.
    erasurePending = true;
  }
  if (erasurePending) {
    // Skip ALL sub-reads — do not even query the learner-state tables.
    return emptyMemory(studentId, subject, grade, chapter);
  }

  // ── Fail-soft sub-reads (spec §2.2) ──
  // cognitive + twin + preferences are independent → parallel fan-out.
  // long-memory depends on cognitive's misconception labels (spec Group C) →
  // runs AFTER cognitive resolves, mirroring the route's existing ordering.
  const [cognitive, twin, preferences] = await Promise.all([
    d.loadCognitive(studentId, subject, grade, chapter).catch(() => EMPTY_COGNITIVE_CONTEXT),
    d.loadTwin(studentId).catch(() => null),
    d.loadPreferences(studentId).catch(() => EMPTY_PREFERENCES),
  ]);

  const misconceptionLabels = cognitive.recentMisconceptions.map((m) => m.label);
  const longMemory = await d
    .loadLongMemory(studentId, subject, misconceptionLabels)
    .catch(() => EMPTY_LONG_MEMORY);

  const isEmpty =
    cognitiveIsEmpty(cognitive) &&
    (twin === null || twin.isEmpty) &&
    longMemoryIsEmpty(longMemory) &&
    preferencesIsEmpty(preferences);

  return {
    studentId,
    subject,
    grade,
    chapter,
    cognitive,
    twin,
    longMemory,
    preferences,
    isEmpty,
  };
}

// ─── Renderer ────────────────────────────────────────────────────────────────

/**
 * Render a `StudentMemory` into a single prompt block by composing the EXISTING
 * per-slice renderers — so output is identical to today's per-reader assembly
 * for the same inputs. PII-safe by construction (spec §4):
 *   - buildCognitivePromptSection → concept titles + counts only.
 *   - renderTwinPromptSection     → counts + enum codes only, never raw UUIDs;
 *                                    cohort percentile keeps its "never disclose"
 *                                    guardrail.
 *   - buildLongMemoryPromptSection→ curated labels + ALREADY-scrubbed synthesis
 *                                    text (scrubStudentName applied upstream).
 * Preferences are advisory hints consumed elsewhere (tone/depth) and have no
 * existing renderer — they are intentionally NOT emitted here.
 *
 * Returns '' when the memory is empty (so callers can append unconditionally and
 * stay byte-identical when there is no signal). Adds no thresholds/magic numbers.
 *
 * NOTE for the Foxy route: /api/foxy renders the cognitive and long-memory
 * slices into TWO DISTINCT template slots (cognitive_context_section vs.
 * learner_memory_section) that are non-adjacent in the template. To preserve
 * byte-identity across BOTH slots it sources the sub-contexts from
 * getStudentMemory and feeds the SAME per-slice renderers this function wraps
 * (rather than this single combined string). This renderer is the canonical
 * single-slot form for future consumers and for co-validating renderer parity.
 */
export function renderStudentMemoryPromptSection(memory: StudentMemory): string {
  if (memory.isEmpty) return '';

  const parts: string[] = [];

  const cognitive = buildCognitivePromptSection(memory.cognitive);
  if (cognitive) parts.push(cognitive);

  if (memory.twin && !memory.twin.isEmpty) {
    const twinSection = renderTwinPromptSection(memory.twin);
    if (twinSection) parts.push(twinSection);
  }

  const longMem = buildLongMemoryPromptSection(memory.longMemory);
  if (longMem) parts.push(longMem);

  return parts.join('\n\n');
}
