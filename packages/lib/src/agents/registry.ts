/**
 * GenAI Agent Registry + WHAT/HOW boundary detector (GenAI Phase 3).
 *
 * Spec: docs/superpowers/specs/2026-07-24-agent-registry-what-how-contract.md
 *
 * This module is PURE METADATA + a reusable pure detector. It is ADDITIVE and
 * INERT at runtime: it adds NO feature flag, NO migration, NO orchestrator
 * activation, and changes NO agent's runtime behavior. Its only consumers are
 * the Phase-3 conformance tests (owned by the testing agent) and future GenAI
 * phases.
 *
 * Placement note (verified 2026-07-24): this lives at
 * `packages/lib/src/agents/registry.ts` — a NEW directory. It deliberately does
 * NOT collide with:
 *   - `packages/lib/src/ai/agents/registry.ts` — the Phase-1 tool-dispatch
 *     framework (circuit-breaker `createRegistry(tools)`), a different concern.
 *   - `agents/runtime/` — the repo-root mesh automation runtime.
 *
 * The registry encodes the platform's central learner-state invariant per-agent:
 *
 *   > The adaptive engine decides WHAT the student learns; GenAI agents decide
 *   > only HOW — and MAY NOT write mastery / progression.
 *
 * The `decides: 'HOW'` and `mayWriteMastery: false` fields are LITERAL types, so
 * a WHAT-deciding or mastery-writing agent is unrepresentable at compile time.
 */

// ---------------------------------------------------------------------------
// Stable agent ids (immutable once shipped) — §1.2
// ---------------------------------------------------------------------------

export type AgentId =
  | 'tutor'
  | 'assessment'
  | 'teacher_copilot'
  | 'parent_intelligence'
  | 'lesson'
  | 'outcome_prediction'
  | 'content_generation';

/**
 * HOW-level capability verbs (§1.1). Every capability describes HOW an agent
 * teaches / explains / formats — never WHAT the student studies next, and never
 * a mastery mutation. Closed set; extend here (in the registry PR), not ad hoc.
 *
 * Note: `generate_questions` (Assessment agent) produces question *content*; it
 * does NOT grade or persist mastery. Grading remains in the deterministic
 * `submitQuizResults()` -> `atomic_quiz_profile_update()` path (P1/P2/P4).
 */
export type AgentCapability =
  | 'explain'
  | 'tutor_turn'
  | 'generate_questions'
  | 'summarize_progress'
  | 'compose_report'
  | 'predict_outcome'
  | 'assemble_prompt'
  | 'select_pedagogy'
  | 'format_content'
  | 'generate_content';

/**
 * A single GenAI agent's typed descriptor — §1.
 *
 * `decides` and `mayWriteMastery` are LITERAL types (`'HOW'` / `false`), not
 * `string` / `boolean`: the type system alone forbids a WHAT-deciding or
 * mastery-writing agent. Conformance invariant (b) re-asserts these at runtime
 * to catch any `as`-cast escape.
 */
export interface AgentDescriptor {
  /** Stable, immutable id. One of the 7 in §1.2. */
  id: AgentId;
  /** Human-readable label (not a translation key; UI surfacing is out of scope). */
  displayName: string;
  /** Who the agent serves. Informational in Phase 3 (drives future routing/RBAC). */
  audience: 'student' | 'teacher' | 'parent' | 'admin';
  /** The WHAT/HOW invariant, encoded per-agent. LITERAL — no 'WHAT' variant exists. */
  decides: 'HOW';
  /** The mastery-write prohibition, encoded per-agent. LITERAL `false` — never `true`. */
  mayWriteMastery: false;
  /** What the agent is allowed to DO (all HOW-level). */
  capabilities: readonly AgentCapability[];
  /**
   * Which shared substrate the agent reads (informational; not asserted by the
   * conformance invariants a-f). Semantics:
   *   - `modelGateway`: consumes the shared LLM/model layer (Phase 1 gateway
   *     `packages/lib/src/ai/gateway/`, or a direct Claude call for the
   *     edge-function agents, which cannot import the TS gateway module).
   *   - `studentMemory`: reads the Phase-2 read-only student memory substrate
   *     (`apps/host/src/lib/memory/student-memory.ts` + `packages/lib/src/memory/`).
   * Memory access is read-only by construction; the registry grants no write.
   * For `planned` agents these are the *intended* consumptions.
   */
  consumes: { modelGateway: boolean; studentMemory: boolean };
  /** `live` = real entry point on disk today; `planned` = no surface yet. */
  status: 'live' | 'planned';
  /** Repo-relative entry file. Non-null for `live`; `null` for `planned`. */
  entryPoint: string | null;
  /**
   * Feature flag that gates the agent, or `null` if ungated. When non-null it
   * MUST exist in the flag registry / `packages/lib/src/flags/defaults.ts`
   * (conformance invariant (f)). No descriptor may reference `ff_orchestrator_v1`
   * (the orchestrator is not an agent and stays dormant).
   */
  gatingFlag: string | null;
}

// ---------------------------------------------------------------------------
// The 7 agents — §1.2 (verified 2026-07-24)
// ---------------------------------------------------------------------------

export const AGENT_REGISTRY: Record<AgentId, AgentDescriptor> = {
  tutor: {
    id: 'tutor',
    displayName: 'Foxy Tutor',
    audience: 'student',
    decides: 'HOW',
    mayWriteMastery: false,
    capabilities: ['explain', 'tutor_turn', 'assemble_prompt', 'select_pedagogy'],
    // Calls Claude (route.ts) + reads Phase-2 memory via getStudentMemory.
    consumes: { modelGateway: true, studentMemory: true },
    status: 'live',
    entryPoint: 'apps/host/src/app/api/foxy/route.ts',
    // No single master flag gates the /api/foxy route (it is always-live; its
    // sub-features ramp on independent flags). `ff_grounded_ai_foxy` from the
    // implementation brief does NOT exist in the flag registry, so per invariant
    // (f) this is null (ungated) rather than a phantom flag reference.
    gatingFlag: null,
  },
  assessment: {
    id: 'assessment',
    displayName: 'Quiz Generator',
    audience: 'student',
    decides: 'HOW',
    mayWriteMastery: false,
    // Generates question content; never grades / persists mastery.
    capabilities: ['generate_questions'],
    // Algorithmic selection — "zero Claude calls"; reads concept_mastery
    // directly (not via the Phase-2 memory module).
    consumes: { modelGateway: false, studentMemory: false },
    status: 'live',
    entryPoint: 'supabase/functions/quiz-generator/index.ts',
    gatingFlag: null,
  },
  teacher_copilot: {
    id: 'teacher_copilot',
    displayName: 'Teacher Copilot',
    audience: 'teacher',
    decides: 'HOW',
    mayWriteMastery: false,
    capabilities: ['summarize_progress', 'compose_report'],
    // Deterministic analytics composition — no Claude call in the function.
    consumes: { modelGateway: false, studentMemory: false },
    status: 'live',
    entryPoint: 'supabase/functions/teacher-dashboard/index.ts',
    gatingFlag: null,
  },
  parent_intelligence: {
    id: 'parent_intelligence',
    displayName: 'Parent Intelligence',
    audience: 'parent',
    decides: 'HOW',
    mayWriteMastery: false,
    capabilities: ['summarize_progress', 'compose_report'],
    // Calls Claude Haiku to compose the parent report narrative; reads
    // concept_mastery directly (not the Phase-2 memory module).
    consumes: { modelGateway: true, studentMemory: false },
    status: 'live',
    entryPoint: 'supabase/functions/parent-report-generator/index.ts',
    gatingFlag: null,
  },
  lesson: {
    id: 'lesson',
    displayName: 'Lesson',
    audience: 'student',
    decides: 'HOW',
    mayWriteMastery: false,
    capabilities: ['format_content', 'assemble_prompt', 'select_pedagogy'],
    // Intended (planned): assembles lesson presentation over adaptive WHAT.
    consumes: { modelGateway: true, studentMemory: true },
    status: 'planned',
    entryPoint: null,
    gatingFlag: null,
  },
  outcome_prediction: {
    id: 'outcome_prediction',
    displayName: 'Outcome Prediction',
    audience: 'teacher',
    decides: 'HOW',
    mayWriteMastery: false,
    capabilities: ['predict_outcome', 'summarize_progress'],
    // Intended (planned): composes existing deterministic predictors + reads
    // learner memory; no LLM by design.
    consumes: { modelGateway: false, studentMemory: true },
    status: 'planned',
    entryPoint: null,
    gatingFlag: null,
  },
  content_generation: {
    id: 'content_generation',
    displayName: 'Content Generation',
    audience: 'admin',
    decides: 'HOW',
    mayWriteMastery: false,
    capabilities: ['generate_content', 'generate_questions'],
    // Intended (planned): consolidates the scattered bulk-gen edge functions.
    consumes: { modelGateway: true, studentMemory: false },
    status: 'planned',
    entryPoint: null,
    gatingFlag: null,
  },
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up a single agent descriptor by id. */
export function getAgent(id: AgentId): AgentDescriptor {
  return AGENT_REGISTRY[id];
}

/** All agent descriptors (stable insertion order). */
export function listAgents(): AgentDescriptor[] {
  return Object.values(AGENT_REGISTRY);
}

/** Only the agents with a real entry point on disk today. */
export function liveAgents(): AgentDescriptor[] {
  return listAgents().filter((a) => a.status === 'live');
}

// ---------------------------------------------------------------------------
// Forbidden mastery-write table set — §2.1 (all 9 verified against schema)
// ---------------------------------------------------------------------------

/**
 * The 9 mastery/progression tables an AI agent surface MUST NEVER directly
 * WRITE (INSERT / UPDATE / UPSERT / DELETE). Reads are permitted. Mastery moves
 * onto these tables ONLY through the concept-check / BKT projector path
 * (`learner.concept_check_answered` -> `concept-mastery-projector`) and the
 * `mastery-state-writer` (`learner.mastery_changed`), both under
 * `packages/lib/src/state/subscribers/`. No agent is on that allowlist.
 *
 * All 9 confirmed real in the current schema (§2.1); none is a phantom.
 */
export const FORBIDDEN_MASTERY_WRITE_TABLES = [
  'concept_mastery',
  'learner_mastery',
  'cme_concept_state',
  'student_skill_state',
  'knowledge_gaps',
  'cme_error_log',
  'bloom_progression',
  'adaptive_mastery',
  'student_learning_profiles',
] as const;

// ---------------------------------------------------------------------------
// Reusable pure detector — §3(e)
// ---------------------------------------------------------------------------

const MUTATING_METHODS = new Set(['insert', 'update', 'upsert', 'delete']);

/**
 * Statically scan a source string for direct writes to forbidden mastery
 * tables. Mirrors the intent of the `no-canonical-write-outside-projector`
 * ESLint rule, but as a string-based detector so the testing agent can scan
 * edge-function sources (which sit outside the ESLint `src/` glob).
 *
 * Matches the Supabase query-builder write pattern:
 *
 *   .from('<table>').insert(   |  .update(  |  .upsert(  |  .delete(
 *
 * with arbitrary whitespace/newlines between `.from(...)` and the operation
 * method (the operation method always directly follows `.from()` in Supabase;
 * filters like `.eq()` come AFTER the operation). Reads — `.from('x').select(` —
 * are NOT matched.
 *
 * @param source  Source text to scan.
 * @param tables  Forbidden table set (defaults to FORBIDDEN_MASTERY_WRITE_TABLES).
 * @returns       Sorted, de-duplicated list of forbidden tables that are WRITTEN
 *                in `source`. Empty array == the boundary holds.
 */
export function findMasteryWrites(
  source: string,
  tables: readonly string[] = FORBIDDEN_MASTERY_WRITE_TABLES,
): string[] {
  const forbidden = new Set(tables);
  const hits = new Set<string>();

  // Capture group 1 = table name, group 2 = the method chained directly after
  // `.from('<table>')`. `[\s\S]*?` is not used between from() and the method:
  // we require the operation method to be the *next* chained call (Supabase's
  // shape), tolerating only whitespace/newlines, to avoid matching a later
  // unrelated write in the same statement.
  const re = /\.from\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)\s*\.\s*([A-Za-z_]\w*)\s*\(/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const table = m[1];
    const method = m[2];
    if (forbidden.has(table) && MUTATING_METHODS.has(method)) {
      hits.add(table);
    }
  }

  return [...hits].sort();
}
