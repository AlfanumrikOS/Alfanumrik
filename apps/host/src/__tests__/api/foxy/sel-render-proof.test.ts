/**
 * REG-434 / REG-435 — SEL (`ff_foxy_sel_v1`) render proof + gate pins.
 *
 * ADOPTED 2026-08-31 (testing agent) from the ai-engineer's throwaway wiring
 * harness. Promoted verbatim into the permanent suite because its four gate
 * cases are the ONLY thing standing between a flag flip and an SEL section
 * appearing on turns it was explicitly designed to stay out of. Extended here
 * with the REG-435 `cache_scope` block, which the harness did not cover.
 *
 * Proves, against the REAL /api/foxy route and the REAL grounded-answer prompt
 * loader:
 *   1. flag ON + explicit-confusion turn -> the REAL route-produced
 *      template_variables.cognitive_context_section carries the SEL section;
 *   2. resolving foxy_tutor_teach_v1 through the REAL loader with those REAL
 *      vars renders "## SEL MOMENT" AFTER "## Safety Rails" and AFTER
 *      "## Language", with zero unresolved {{...}};
 *   3. flag OFF -> cognitive_context_section is byte-identical to the
 *      pre-change composition (base + twin + director, i.e. just the base here);
 *   4. buildSelSection carries no crisis vocabulary and no prohibited phrases.
 *
 * Harness mirrors digital-twin-prompt-integration.test.ts exactly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  loadTemplate,
  resolveTemplate,
} from '../../../../../../supabase/functions/grounded-answer/prompts/index';
import {
  buildSelSection,
  buildColdStartPromptSection,
  FOXY_SAFETY_RAILS,
} from '@alfanumrik/lib/foxy/prompt-sections';
import { findProhibitedPhrases } from '@alfanumrik/lib/policy/prohibited-inferences';

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

const _authorizeImpl = vi.fn();
const _logAuditImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: (...args: unknown[]) => _logAuditImpl(...args),
}));

const _isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

const _isCurriculumGuardEnabled = vi.fn();
const _isMathPipelineEnabled = vi.fn();
vi.mock('@alfanumrik/lib/foxy/math-flag', () => ({
  isCurriculumGuardEnabled: (...args: unknown[]) => _isCurriculumGuardEnabled(...args),
  isMathPipelineEnabled: (...args: unknown[]) => _isMathPipelineEnabled(...args),
}));

vi.mock('@alfanumrik/lib/subjects', () => ({
  validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alfanumrik/lib/foxy/recent-lab-context', () => ({
  fetchRecentLabContext: vi.fn().mockResolvedValue([]),
}));

const _classifyMathSolve = vi.fn();
vi.mock('@alfanumrik/lib/ai/workflows/foxy-router', () => ({
  QUIZ_PATTERNS: /\bquiz\b/i,
  classifyMathSolve: (...args: unknown[]) => _classifyMathSolve(...args),
}));
vi.mock('@alfanumrik/lib/ai/math/solve-math', () => ({ solveMath: vi.fn() }));
vi.mock('@alfanumrik/lib/math-python-client', () => ({ verifyMath: vi.fn() }));
vi.mock('@alfanumrik/lib/ai/math/solve-pipeline', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, runMathSolvePipeline: vi.fn() };
});

const _callGroundedAnswer = vi.fn();
let _groundedReturn: Record<string, unknown> = {};
vi.mock('@alfanumrik/lib/ai/grounded-client', () => ({
  callGroundedAnswer: (...args: unknown[]) => {
    _callGroundedAnswer(...args);
    return Promise.resolve(_groundedReturn);
  },
  callGroundedAnswerStream: () => Promise.resolve({ ok: false, reason: 'not-used' }),
}));

vi.mock('@alfanumrik/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    classifyIntent: () => Promise.resolve({ intent: 'explain' }),
    routeIntent: () => Promise.resolve({ response: 'LEGACY', intent: 'explain', sources: [], tokensUsed: 1, model: 'x', latencyMs: 0, traceId: 't' }),
  };
});

// safeguarding boundary — Tier-1 screen + Tier-2 classifier, both configurable
const _screenHit = { value: false };
vi.mock('@alfanumrik/lib/ai/validation/safeguarding-screen', () => ({
  screenForSafeguarding: () =>
    _screenHit.value ? { hit: true, categories: ['acute_distress'] } : { hit: false, categories: [] },
}));
const _classifyThrows = { value: false };
vi.mock('@alfanumrik/lib/ai/validation/safeguarding-classify', () => ({
  classifySafeguarding: () => {
    if (_classifyThrows.value) return Promise.reject(new Error('classifier down'));
    return Promise.resolve({ confirmed: false, category: null, tier: 'llm', confidence: 0.1 });
  },
}));

let _studentRow: Record<string, unknown> | null = null;
let _historyRows: Array<{ role: string; content: string }> = [];

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const resolveDefault = (): { data: unknown; error: unknown } => {
    if (table === 'students') return { data: _studentRow, error: null };
    if (table === 'foxy_sessions') return { data: { id: 'session-uuid-1' }, error: null };
    if (table === 'student_daily_usage') return { data: { usage_count: 5 }, error: null };
    if (table === 'foxy_chat_messages') return { data: _historyRows, error: null };
    return { data: [], error: null };
  };
  for (const m of ['select', 'eq', 'neq', 'in', 'ilike', 'order', 'limit', 'gte', 'lte', 'not', 'is']) {
    chain[m] = () => chain;
  }
  const recordWrite = () => ({
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve, reject),
    eq: () => ({
      eq: () => ({
        eq: () => ({
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve, reject),
        }),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve, reject),
      }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve, reject),
    }),
    select: () => ({
      single: () => Promise.resolve({ data: { id: 'session-uuid-1' }, error: null }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({
          data: [
            { id: 'msg-user', role: 'user' },
            { id: 'msg-assistant', role: 'assistant' },
          ],
          error: null,
        }).then(resolve, reject),
    }),
  });
  chain.insert = () => recordWrite();
  chain.update = () => recordWrite();
  chain.upsert = () => recordWrite();
  chain.delete = () => recordWrite();
  chain.single = () => Promise.resolve(resolveDefault());
  chain.maybeSingle = () => Promise.resolve(resolveDefault());
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(resolveDefault()).then(resolve, reject);
  return chain;
}

const rpcImpl = vi.fn((name: string) => {
  if (name === 'check_and_record_usage') {
    return Promise.resolve({ data: [{ allowed: true, used_count: 1 }], error: null });
  }
  if (name === 'get_plan_limit') return Promise.resolve({ data: 10, error: null });
  return Promise.resolve({ data: [{ allowed: true, used_count: 1 }], error: null });
});

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => makeChain(table),
    rpc: (...args: unknown[]) => rpcImpl(...(args as [string])),
  },
}));

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/foxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-jwt' },
    body: JSON.stringify(body),
  });
}

async function postFoxy(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/foxy/route');
  const res = await POST(makePostRequest(body));
  const parsed = (await res.json()) as Record<string, unknown>;
  return { res, body: parsed };
}

function capturedVars(): Record<string, string> {
  const [outbound] = _callGroundedAnswer.mock.calls[0] as [
    { generation?: { template_variables?: Record<string, string> } },
  ];
  return outbound?.generation?.template_variables ?? {};
}

function setFlags(sel: boolean, safeguarding = false) {
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'ai_usage_global') return Promise.resolve(true);
    if (flag === 'ff_grounded_ai_foxy') return Promise.resolve(true);
    if (flag === 'ff_foxy_sel_v1') return Promise.resolve(sel);
    if (flag === 'ff_safeguarding_v1') return Promise.resolve(safeguarding);
    return Promise.resolve(false);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _historyRows = [];
  _screenHit.value = false;
  _classifyThrows.value = false;
  _studentRow = {
    subscription_plan: 'free',
    account_status: 'active',
    academic_goal: null,
    name: null,
    grade: '8',
    onboarding_completed: true,
  };
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-uuid-1',
    schoolId: null,
    roles: ['student'],
    permissions: ['foxy.chat'],
  });
  setFlags(true);
  _isCurriculumGuardEnabled.mockResolvedValue(false);
  _isMathPipelineEnabled.mockResolvedValue(false);
  _classifyMathSolve.mockResolvedValue({ isMathSolve: false });
  _groundedReturn = {
    grounded: true,
    answer: 'Light bends when it changes medium.',
    citations: [],
    confidence: 0.9,
    groundedFromChunks: true,
    trace_id: 'trace-sel-1',
    suggested_alternatives: [],
    meta: { claude_model: 'haiku', tokens_used: 40, latency_ms: 90 },
  };
});

const CONFUSION_BODY = {
  message: "I don't get this at all",
  subject: 'science',
  grade: '8',
  mode: 'learn',
};

/** Extras the Edge pipeline (not the route) supplies at render time. */
const PIPELINE_VARS: Record<string, string> = {
  chapter_suffix: ' — Light: Reflection and Refraction',
  board: 'CBSE',
  mode_instruction:
    'You MUST answer ONLY from the Reference Material provided above.',
  prereq: 'Reflection',
  reference_material_section:
    '=== REFERENCE MATERIAL ===\n[1] Light bends when it changes medium.\n=== END REFERENCE MATERIAL ===',
};

describe('SEL render proof', () => {
  it('flag ON: real route vars carry the SEL section, and it renders after Safety Rails + Language with zero unresolved slots', async () => {
    const { res } = await postFoxy(CONFUSION_BODY);
    expect(res.status).toBe(200);
    expect(_callGroundedAnswer).toHaveBeenCalledTimes(1);

    const vars = capturedVars();
    const section = String(vars.cognitive_context_section ?? '');

    // (0) the REAL route produced the EXACT expected composition.
    expect(section).toBe(
      `${buildColdStartPromptSection()}\n\n${buildSelSection('explicit_confusion')}`,
    );
    console.log('\n===== ROUTE-PRODUCED cognitive_context_section (flag ON) =====\n' + section);
    console.log('\n===== template_variables KEYS =====\n' + JSON.stringify(Object.keys(vars).sort()));

    // (1) render through the REAL loader with the REAL route vars.
    const template = await loadTemplate('foxy_tutor_teach_v1');
    const rendered = resolveTemplate(template, { ...PIPELINE_VARS, ...vars });

    const iSel = rendered.indexOf('## SEL MOMENT');
    const iRails = rendered.indexOf('## Safety Rails');
    const iLang = rendered.indexOf('## Language');
    console.log(
      `\n===== RENDER OFFSETS ===== SafetyRails=${iRails} Language=${iLang} SELMOMENT=${iSel}`,
    );
    expect(iSel).toBeGreaterThan(-1);
    expect(iRails).toBeGreaterThan(-1);
    expect(iLang).toBeGreaterThan(-1);
    expect(iSel).toBeGreaterThan(iRails);
    expect(iSel).toBeGreaterThan(iLang);

    // rails really rendered (sanity that the ordering comparison is meaningful)
    expect(rendered).toContain(FOXY_SAFETY_RAILS.slice(0, 60));

    // (2) zero unresolved placeholders.
    const unresolved = rendered.match(/\{\{[^}]*\}\}/g) ?? [];
    console.log('===== UNRESOLVED PLACEHOLDERS ===== ' + JSON.stringify(unresolved));
    expect(unresolved).toEqual([]);

    console.log(
      '\n===== RENDERED TAIL (from ## Safety Rails onward) =====\n' + rendered.slice(iRails),
    );
  });

  it('flag OFF: cognitive_context_section is byte-identical to the pre-change composition', async () => {
    setFlags(false);
    const { res } = await postFoxy(CONFUSION_BODY);
    expect(res.status).toBe(200);
    const vars = capturedVars();
    const section = String(vars.cognitive_context_section ?? '');
    // Pre-change formula: base + twin + director. twin/director are '' here, so
    // the pre-change value is exactly the base cognitive section.
    expect(section).toBe(buildColdStartPromptSection());
    expect(section).not.toContain('## SEL MOMENT');
    console.log(
      '\n===== FLAG OFF: byte-identical to pre-change base section? ' +
        String(section === buildColdStartPromptSection()) +
        ' (len=' + section.length + ') =====',
    );
  });

  it('GATE: edge-transition only — prior turn already confused => NO SEL (anti-spam)', async () => {
    _historyRows = [
      { role: 'assistant', content: 'Light bends when it changes medium.' },
      { role: 'user', content: "I don't understand this" },
    ];
    const { res } = await postFoxy(CONFUSION_BODY);
    expect(res.status).toBe(200);
    const section = String(capturedVars().cognitive_context_section ?? '');
    console.log('===== EDGE-TRANSITION GATE: SEL present? ' + section.includes('## SEL MOMENT'));
    expect(section).not.toContain('## SEL MOMENT');
  });

  it('GATE: non-teaching turn (mode=practice) => NO SEL', async () => {
    const { res } = await postFoxy({ ...CONFUSION_BODY, mode: 'practice' });
    expect(res.status).toBe(200);
    const section = String(capturedVars().cognitive_context_section ?? '');
    console.log('===== isTeachingTurn GATE: SEL present? ' + section.includes('## SEL MOMENT'));
    expect(section).not.toContain('## SEL MOMENT');
  });

  it('GATE: safeguarding Tier-1 hit + Tier-2 classifier failure => SEL SUPPRESSED', async () => {
    setFlags(true, true);
    _screenHit.value = true;
    _classifyThrows.value = true;
    const { res } = await postFoxy(CONFUSION_BODY);
    expect(res.status).toBe(200);
    const section = String(capturedVars().cognitive_context_section ?? '');
    console.log('===== SAFEGUARDING-FAILURE GATE: SEL present? ' + section.includes('## SEL MOMENT'));
    expect(section).not.toContain('## SEL MOMENT');
    expect(section).toBe(buildColdStartPromptSection());
  });

  it('CONTROL: safeguarding Tier-1 hit + classifier returns ambiguous => SEL still injected', async () => {
    setFlags(true, true);
    _screenHit.value = true;
    _classifyThrows.value = false;
    const { res } = await postFoxy(CONFUSION_BODY);
    expect(res.status).toBe(200);
    const section = String(capturedVars().cognitive_context_section ?? '');
    console.log('===== AMBIGUOUS-VERDICT CONTROL: SEL present? ' + section.includes('## SEL MOMENT'));
    expect(section).toContain('## SEL MOMENT');
  });

  it('SEL section contains no crisis vocabulary and no prohibited phrases', () => {
    const CRISIS = /1098|helpline|trusted adult|counsell?or|you are not alone|हेल्पलाइन/i;
    for (const sig of ['explicit_confusion', 'repeated_hint'] as const) {
      const text = buildSelSection(sig);
      const hits = text.match(new RegExp(CRISIS.source, 'gi')) ?? [];
      console.log(`===== CRISIS MATCHES [${sig}] ===== ${JSON.stringify(hits)}`);
      expect(hits).toEqual([]);
      const banned = findProhibitedPhrases(text);
      console.log(`===== findProhibitedPhrases [${sig}] ===== ${JSON.stringify(banned)}`);
      expect(banned).toEqual([]);
    }
  });
});

/**
 * REG-435 — an SEL-bearing turn can never be cached as `cache_scope: 'shared'`.
 *
 * WHY THIS IS SEPARATE FROM THE RENDER PROOF ABOVE. The SEL section is derived
 * from THIS student's observed struggle signal, so an SEL-bearing turn is
 * personal by construction. `selSection !== ''` is a term of the route's
 * `cognitiveSectionIsPersonal` predicate for exactly that reason. Drop that one
 * term and the turn is declared `'shared'` — and a response shaped by one
 * child's confusion gets served to a different child. That is a P13 disclosure,
 * not a caching inefficiency.
 *
 * THE EXISTING COVERAGE DOES NOT CATCH THIS. `response-cache-v2-callers.test.ts`
 * asserts that `!cognitiveSectionIsPersonal` is a conjunct of `foxyCacheScope`
 * by matching the declaration's SOURCE TEXT. That assertion still passes with
 * `selSection !== ''` deleted from the predicate, because the conjunct it greps
 * for (`!cognitiveSectionIsPersonal`) is still right there in the source. The
 * hole is one level down, inside the predicate it delegates to.
 *
 * These tests are behavioural: they read `cache_scope` off the REAL outbound
 * GroundedRequest built by the REAL route, not off source text.
 *
 * NON-VACUITY / DISCRIMINATION. The flag-OFF case asserts the SAME request on
 * the SAME fixtures yields `'shared'`. That is what makes the flag-ON `'none'`
 * assertion load-bearing: it proves the SEL section is the SOLE cause of the
 * scope flip, rather than some other personal section (history, tenant
 * override, academic goal, misconception, ...) incidentally forcing `'none'`
 * and making the test pass for a reason unrelated to SEL.
 */
describe('REG-435 — SEL turns are never cache_scope shared (P13)', () => {
  function capturedCacheScope(): string {
    const [outbound] = _callGroundedAnswer.mock.calls[0] as [{ cache_scope?: string }];
    return String(outbound?.cache_scope ?? '');
  }

  it('flag OFF on an otherwise-shareable turn: cache_scope is "shared" (discrimination control)', async () => {
    setFlags(false);
    const { res } = await postFoxy(CONFUSION_BODY);
    expect(res.status).toBe(200);
    // Precondition: no SEL section on this turn.
    expect(String(capturedVars().cognitive_context_section ?? '')).not.toContain('## SEL MOMENT');
    // ...and every OTHER personal-section term is empty, so this fixture really
    // is shareable. If this ever flips to 'none', the test below stops proving
    // anything about SEL and must be re-derived rather than re-baselined.
    expect(capturedCacheScope()).toBe('shared');
  });

  it('flag ON + SEL-bearing turn: cache_scope is "none" — SEL alone forces it', async () => {
    const { res } = await postFoxy(CONFUSION_BODY);
    expect(res.status).toBe(200);
    // The SEL section really is present (guards against a vacuous pass where
    // SEL never rendered and 'none' came from somewhere else).
    expect(String(capturedVars().cognitive_context_section ?? '')).toContain('## SEL MOMENT');
    expect(capturedCacheScope()).toBe('none');
  });

  it('a suppressed-SEL turn returns to "shared" — the scope tracks the SECTION, not the flag', async () => {
    // Flag ON, but mode=practice trips the isTeachingTurn gate, so no SEL.
    // If cache_scope keyed off the FLAG rather than off `selSection !== ''`,
    // this would be 'none' and the personalisation signal would be wrong in the
    // conservative direction — masking a later regression in the other one.
    const { res } = await postFoxy({ ...CONFUSION_BODY, mode: 'practice' });
    expect(res.status).toBe(200);
    expect(String(capturedVars().cognitive_context_section ?? '')).not.toContain('## SEL MOMENT');
    expect(capturedCacheScope()).toBe('shared');
  });
});
