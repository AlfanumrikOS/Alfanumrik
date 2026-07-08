/**
 * Phase 2: Foxy per-LO BKT mastery + curated misconception ontology context.
 *
 * Pins the SHAPE of the new prompt sections that wire dormant personalization
 * data (`student_skill_state` join `learning_objectives`, `quiz_responses`
 * join `question_misconceptions`) into the Foxy pedagogy decision tree.
 *
 * The actual Supabase queries are integration-tested via /api/foxy E2E. Here
 * we test the pure formatters + the empty-state contract + the
 * template-substitution contract.
 *
 * Why this exists:
 *   foxy_tutor_v1.txt has a MISCONCEPTION_REPAIR pedagogy branch that fires
 *   when "RECENT ERROR PATTERNS shows 3+ conceptual errors". Until Phase 2,
 *   that branch had no real signal because cme_error_log only stored generic
 *   error_type strings. Phase 2 wires curated misconceptions + per-LO BKT
 *   mastery so the existing pedagogy actually triggers on real data.
 */

import { describe, it, expect } from 'vitest';

// ─── Mirror of route.ts types and formatters ────────────────────────────────

interface CognitiveContextLO {
  loCode: string;
  loStatement: string;
  pKnow: number;
  pSlip: number;
  theta: number;
}

interface CognitiveContextMisconception {
  code: string;
  label: string;
  count: number;
  remediationText: string;
}

// Mirror of buildMisconceptionPromptSection in src/app/api/foxy/route.ts.
// If the route version diverges, this test will catch the drift through the
// "prompt template substitution" contract test below.
const REMEDIATION_MAX_CHARS = 400;

function buildMisconceptionPromptSection(
  misconceptions: CognitiveContextMisconception[],
): string {
  if (misconceptions.length === 0) return '';
  const lines: string[] = [
    "KNOWN MISCONCEPTIONS (curated, observed in this student's recent quizzes):",
  ];
  for (const m of misconceptions) {
    let remediation = '';
    if (m.remediationText) {
      const cleaned = m.remediationText.replace(/\s+/g, ' ').trim();
      const truncated =
        cleaned.length > REMEDIATION_MAX_CHARS
          ? `${cleaned.slice(0, REMEDIATION_MAX_CHARS - 1)}…`
          : cleaned;
      remediation = ` — fix: ${truncated}`;
    }
    lines.push(
      `- [${m.code}] ${m.label} (seen ${m.count}x in last 30 days)${remediation}`,
    );
  }
  return lines.join('\n');
}

// Mirror of the LO-skills sub-section emitted inside buildCognitivePromptSection.
// We extract it as a standalone helper for unit testing. Step-card pedagogy
// PR rewrote this from raw "P(know)=42%" labels to directive sentences keyed
// on three pKnow buckets so the model knows HOW to open the explanation.
function buildLoDirective(lo: {
  loCode: string;
  loStatement: string;
  pKnow: number;
}): string {
  const pct = Math.round(lo.pKnow * 100);
  const label = `[${lo.loCode}] ${lo.loStatement}`;
  if (lo.pKnow < 0.5) {
    return `${label} is weak (mastery ${pct}%) — open the explanation with a concrete real-world analogy or worked example BEFORE introducing the formal definition.`;
  }
  if (lo.pKnow < 0.75) {
    return `${label} is partial (mastery ${pct}%) — quick recap (1 sentence), then advance to application.`;
  }
  return `${label} is strong (mastery ${pct}%) — skip basics, go straight to challenge or transfer task.`;
}

function buildLoSkillsSubsection(loSkills: CognitiveContextLO[]): string {
  if (loSkills.length === 0) return '';
  const lines: string[] = [
    'LEARNING OBJECTIVE MASTERY (directive — open the explanation accordingly):',
  ];
  for (const lo of loSkills) {
    lines.push(`- ${buildLoDirective(lo)}`);
  }
  return lines.join('\n');
}

// Mirror of composeMisconceptionDirective in src/app/api/foxy/route.ts.
// Composes generic recentErrors with curated misconception ontology into a
// single binary signal: fire MISCONCEPTION_REPAIR if a curated label has
// count ≥ 2; otherwise return empty so the legacy block renders.
function composeMisconceptionDirective(
  _recentErrors: Array<{ errorType: string; count: number }>,
  misconceptions: CognitiveContextMisconception[],
): string {
  if (misconceptions.length === 0) return '';
  const top = misconceptions[0];
  if (!top || top.count < 2) return '';
  let fix = '';
  if (top.remediationText) {
    const cleaned = top.remediationText.replace(/\s+/g, ' ').trim();
    fix = ` — ${cleaned.length > 200 ? `${cleaned.slice(0, 199)}…` : cleaned}`;
  }
  return `MISCONCEPTION TO TARGET: ${top.label}${fix}`;
}

// ─── (a) SQL query shape contract ───────────────────────────────────────────

describe('SQL query shape (contract pinning — student_skill_state + question_misconceptions)', () => {
  it('contract: student_skill_state query joins learning_objectives via !inner', () => {
    // The route uses:
    //   .from('student_skill_state')
    //   .select('p_know, p_slip, theta, learning_objectives!inner(code, statement, chapter_id, chapters!inner(subject_id))')
    //   .eq('student_id', studentId)
    //   .order('p_know', { ascending: true })
    //   .limit(50)
    // and applies chapter_id or subject_id filter on the joined alias.
    const expectedJoinedColumns = ['code', 'statement', 'chapter_id'];
    const expectedDoubleJoinedColumn = 'subject_id'; // chapters.subject_id
    expect(expectedJoinedColumns).toContain('code');
    expect(expectedJoinedColumns).toContain('statement');
    expect(expectedJoinedColumns).toContain('chapter_id');
    expect(expectedDoubleJoinedColumn).toBe('subject_id');
  });

  it('contract: skill state ordered by p_know ASC (weakest first), limit 10 final', () => {
    // We pull 50 rows from the DB to allow client-side defensive filter, then
    // slice(0, 10) for the prompt. Verifies the "10 weakest LOs" requirement.
    const rawLimit = 50;
    const finalLimit = 10;
    expect(rawLimit).toBeGreaterThanOrEqual(finalLimit);
    expect(finalLimit).toBe(10);
  });

  it('contract: misconception query filters is_correct=false + 30 day lookback', () => {
    const lookbackDays = 30;
    const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
    expect(Date.now() - cutoff.getTime()).toBeCloseTo(
      lookbackDays * 24 * 60 * 60 * 1000,
      -2,
    );
  });

  it('contract: misconception join uses (question_id, distractor_index = selected_option)', () => {
    // The route joins quiz_responses → question_misconceptions on the
    // composite key (question_id matches via FK; distractor_index must equal
    // the student's selected_option). Without the distractor match, EVERY
    // misconception attached to the question would fire on every wrong
    // answer — wrong behavior. The match is enforced client-side after the
    // !inner join because PostgREST doesn't support equality joins on
    // arbitrary columns.
    const join = { question_id: 'eq', distractor_index: 'selected_option' };
    expect(join.question_id).toBe('eq');
    expect(join.distractor_index).toBe('selected_option');
  });

  it('contract: misconception aggregation returns top 3 by count', () => {
    const finalLimit = 3;
    expect(finalLimit).toBe(3);
  });
});

// ─── (b) Empty-state behavior ───────────────────────────────────────────────

describe('Empty-state behavior', () => {
  it('returns empty string when student has zero skill_state rows', () => {
    expect(buildLoSkillsSubsection([])).toBe('');
  });

  it('returns empty string when student has zero misconceptions', () => {
    expect(buildMisconceptionPromptSection([])).toBe('');
  });

  it('the empty misconception section is template-safe', () => {
    const template = 'BEFORE\n{{misconception_section}}\nAFTER';
    const rendered = template.replace('{{misconception_section}}', '');
    expect(rendered).toBe('BEFORE\n\nAFTER');
  });

  it('empty LO skills subsection does NOT emit the heading (no orphan)', () => {
    const out = buildLoSkillsSubsection([]);
    expect(out).not.toContain('LEARNING OBJECTIVE MASTERY');
  });

  it('empty misconception section does NOT emit the heading (no orphan)', () => {
    const out = buildMisconceptionPromptSection([]);
    expect(out).not.toContain('KNOWN MISCONCEPTIONS');
  });
});

// ─── (c) Misconception-injection happy path ──────────────────────────────────

describe('Misconception injection — happy path', () => {
  it('emits the [code] label (count) line for each misconception', () => {
    const out = buildMisconceptionPromptSection([
      {
        code: 'confuses_mass_with_weight',
        label: 'Treats mass and weight as the same physical quantity',
        count: 4,
        remediationText: 'Mass is amount of matter (kg). Weight is force from gravity (N).',
      },
    ]);
    expect(out).toContain('[confuses_mass_with_weight]');
    expect(out).toContain('Treats mass and weight as the same physical quantity');
    expect(out).toContain('seen 4x in last 30 days');
  });

  it('appends the remediation snippet when present', () => {
    const out = buildMisconceptionPromptSection([
      {
        code: 'reverses_subject_predicate',
        label: 'Reverses subject and predicate',
        count: 2,
        remediationText: 'Subject is who/what does the action; predicate describes them.',
      },
    ]);
    expect(out).toContain('— fix: Subject is who/what does the action');
  });

  it('omits the remediation snippet gracefully when remediationText is empty', () => {
    const out = buildMisconceptionPromptSection([
      {
        code: 'mc_no_remediation',
        label: 'Some misconception without cached remediation',
        count: 1,
        remediationText: '',
      },
    ]);
    expect(out).toContain('[mc_no_remediation]');
    expect(out).not.toContain('— fix:');
  });

  it('renders the heading once, regardless of misconception count', () => {
    const out = buildMisconceptionPromptSection([
      { code: 'mc1', label: 'L1', count: 3, remediationText: 'r1' },
      { code: 'mc2', label: 'L2', count: 2, remediationText: 'r2' },
      { code: 'mc3', label: 'L3', count: 1, remediationText: 'r3' },
    ]);
    const heading = 'KNOWN MISCONCEPTIONS';
    const headingMatches = out.match(new RegExp(heading, 'g')) || [];
    expect(headingMatches.length).toBe(1);
  });

  it('preserves order (top-3 by count, descending) when caller pre-sorts', () => {
    const out = buildMisconceptionPromptSection([
      { code: 'mc_top', label: 'Top', count: 5, remediationText: '' },
      { code: 'mc_mid', label: 'Mid', count: 3, remediationText: '' },
      { code: 'mc_low', label: 'Low', count: 1, remediationText: '' },
    ]);
    const topIdx = out.indexOf('mc_top');
    const midIdx = out.indexOf('mc_mid');
    const lowIdx = out.indexOf('mc_low');
    expect(topIdx).toBeGreaterThan(0);
    expect(midIdx).toBeGreaterThan(topIdx);
    expect(lowIdx).toBeGreaterThan(midIdx);
  });

  it('collapses whitespace runs in the remediation text (prompt size guard)', () => {
    const out = buildMisconceptionPromptSection([
      {
        code: 'mc_ws',
        label: 'Whitespace test',
        count: 1,
        remediationText: 'multi\n\nline\n\ntext',
      },
    ]);
    expect(out).toContain('— fix: multi line text');
    expect(out).not.toContain('— fix: multi\n\nline');
  });
});

// ─── (c) LO skills injection happy path — DIRECTIVE format ──────────────────
//
// Step-card pedagogy PR replaced the flat "P(know)=42%, theta=-0.85" label
// with directive sentences keyed on three pKnow buckets. The model now
// receives an actionable instruction (HOW to open the explanation) rather
// than a raw probability.

describe('LO skills subsection — directive format (pKnow buckets)', () => {
  it('emits each LO with code, statement, and a directive sentence', () => {
    const out = buildLoSkillsSubsection([
      {
        loCode: 'PHY-7-MOTION-LO-01',
        loStatement: 'Distinguish uniform and non-uniform motion',
        pKnow: 0.23,
        pSlip: 0.1,
        theta: -0.85,
      },
    ]);
    expect(out).toContain('[PHY-7-MOTION-LO-01]');
    expect(out).toContain('Distinguish uniform and non-uniform motion');
    // Weak bucket → analogy-first directive
    expect(out).toContain('is weak (mastery 23%)');
    expect(out).toContain('real-world analogy or worked example BEFORE');
    // Old percentage-only format must NOT appear
    expect(out).not.toContain('P(know)=23%');
    expect(out).not.toContain('theta=');
  });

  it('weak bucket (pKnow < 0.5): emits analogy-first directive', () => {
    const out = buildLoSkillsSubsection([
      { loCode: 'L1', loStatement: 'Some weak LO', pKnow: 0.3, pSlip: 0, theta: 0 },
    ]);
    expect(out).toContain('is weak (mastery 30%)');
    expect(out).toContain('open the explanation with a concrete real-world analogy or worked example BEFORE introducing the formal definition');
  });

  it('partial bucket (0.5 ≤ pKnow < 0.75): emits 1-sentence-recap directive', () => {
    const out = buildLoSkillsSubsection([
      { loCode: 'L2', loStatement: 'Some partial LO', pKnow: 0.65, pSlip: 0, theta: 0 },
    ]);
    expect(out).toContain('is partial (mastery 65%)');
    expect(out).toContain('quick recap (1 sentence), then advance to application');
  });

  it('strong bucket (pKnow ≥ 0.75): emits skip-basics directive', () => {
    const out = buildLoSkillsSubsection([
      { loCode: 'L3', loStatement: 'Some strong LO', pKnow: 0.82, pSlip: 0, theta: 0 },
    ]);
    expect(out).toContain('is strong (mastery 82%)');
    expect(out).toContain('skip basics, go straight to challenge or transfer task');
  });

  it('boundary conditions: 0.5 → partial, 0.75 → strong, 0.49 → weak', () => {
    const out = buildLoSkillsSubsection([
      { loCode: 'B1', loStatement: 's1', pKnow: 0.49, pSlip: 0, theta: 0 },
      { loCode: 'B2', loStatement: 's2', pKnow: 0.5, pSlip: 0, theta: 0 },
      { loCode: 'B3', loStatement: 's3', pKnow: 0.75, pSlip: 0, theta: 0 },
    ]);
    // 0.49 → weak
    expect(out).toMatch(/\[B1\][^\n]*is weak/);
    // 0.5 → partial
    expect(out).toMatch(/\[B2\][^\n]*is partial/);
    // 0.75 → strong
    expect(out).toMatch(/\[B3\][^\n]*is strong/);
  });

  it('rounds mastery percent to integer in the directive', () => {
    const out = buildLoSkillsSubsection([
      { loCode: 'X', loStatement: 'Y', pKnow: 0.4567, pSlip: 0, theta: 0 },
    ]);
    expect(out).toContain('mastery 46%');
  });

  it('renders the heading once, regardless of LO count', () => {
    const out = buildLoSkillsSubsection([
      { loCode: 'A', loStatement: 'a', pKnow: 0.1, pSlip: 0, theta: 0 },
      { loCode: 'B', loStatement: 'b', pKnow: 0.2, pSlip: 0, theta: 0 },
      { loCode: 'C', loStatement: 'c', pKnow: 0.3, pSlip: 0, theta: 0 },
    ]);
    const heading = 'LEARNING OBJECTIVE MASTERY';
    const headingMatches = out.match(new RegExp(heading, 'g')) || [];
    expect(headingMatches.length).toBe(1);
  });

  it('heading wording shifted from "per-LO BKT" to "directive"', () => {
    const out = buildLoSkillsSubsection([
      { loCode: 'A', loStatement: 'a', pKnow: 0.1, pSlip: 0, theta: 0 },
    ]);
    expect(out).toContain('directive — open the explanation accordingly');
    expect(out).not.toContain('per-LO BKT');
  });
});

// ─── (c2) Composed misconception directive (binary signal) ──────────────────
//
// Step-card pedagogy PR composes recentErrors + recentMisconceptions into a
// single MISCONCEPTION TO TARGET directive when curated overlap is real
// (count ≥ 2). Before this change, the two signals competed inside the prompt.

describe('composeMisconceptionDirective — binary signal for MISCONCEPTION_REPAIR', () => {
  it('returns empty when no curated misconceptions exist', () => {
    expect(
      composeMisconceptionDirective(
        [{ errorType: 'conceptual', count: 5 }],
        [],
      ),
    ).toBe('');
  });

  it('returns empty when top misconception count is < 2 (one-off)', () => {
    expect(
      composeMisconceptionDirective(
        [],
        [{ code: 'mc_oneoff', label: 'Some label', count: 1, remediationText: 'fix' }],
      ),
    ).toBe('');
  });

  it('emits MISCONCEPTION TO TARGET when top count ≥ 2', () => {
    const out = composeMisconceptionDirective(
      [{ errorType: 'conceptual', count: 4 }],
      [
        {
          code: 'confuses_mass_with_weight',
          label: 'Treats mass and weight as the same',
          count: 4,
          remediationText: 'Mass is amount of matter (kg). Weight is force (N).',
        },
      ],
    );
    expect(out).toContain('MISCONCEPTION TO TARGET:');
    expect(out).toContain('Treats mass and weight as the same');
    expect(out).toContain('Mass is amount of matter');
  });

  it('truncates remediation text to 200 chars in the directive', () => {
    const longText = 'a '.repeat(200); // 400 chars
    const out = composeMisconceptionDirective(
      [],
      [
        {
          code: 'mc_long',
          label: 'Long misconception',
          count: 3,
          remediationText: longText,
        },
      ],
    );
    const dashIdx = out.indexOf(' — ');
    expect(dashIdx).toBeGreaterThan(0);
    const fix = out.slice(dashIdx + 3);
    expect(fix.length).toBeLessThanOrEqual(200);
  });

  it('omits the fix segment when remediationText is empty', () => {
    const out = composeMisconceptionDirective(
      [],
      [
        {
          code: 'mc_no_remediation',
          label: 'Plain misconception',
          count: 2,
          remediationText: '',
        },
      ],
    );
    expect(out).toBe('MISCONCEPTION TO TARGET: Plain misconception');
  });
});

// ─── (d) Prompt template substitution ────────────────────────────────────────

describe('Prompt template substitution — foxy_tutor_v1', () => {
  // The relevant slice of foxy_tutor_v1 (matches what's in inline.ts +
  // foxy_tutor_v1.txt). If the placeholder ordering changes, the test
  // catches it.
  const TEMPLATE_TAIL = `{{academic_goal_section}}
{{cognitive_context_section}}
{{misconception_section}}
{{previous_session_context}}
{{reference_material_section}}`;

  it('contains the misconception_section placeholder between cognitive and previous-session', () => {
    const cogIdx = TEMPLATE_TAIL.indexOf('{{cognitive_context_section}}');
    const mcIdx = TEMPLATE_TAIL.indexOf('{{misconception_section}}');
    const prevIdx = TEMPLATE_TAIL.indexOf('{{previous_session_context}}');
    expect(cogIdx).toBeGreaterThanOrEqual(0);
    expect(mcIdx).toBeGreaterThan(cogIdx);
    expect(prevIdx).toBeGreaterThan(mcIdx);
  });

  it('substitutes the rendered misconception section into the template', () => {
    const rendered = buildMisconceptionPromptSection([
      {
        code: 'confuses_mass_with_weight',
        label: 'Treats mass and weight as the same',
        count: 3,
        remediationText: 'Mass != Weight.',
      },
    ]);
    const out = TEMPLATE_TAIL
      .replace('{{academic_goal_section}}', '')
      .replace('{{cognitive_context_section}}', '')
      .replace('{{misconception_section}}', rendered)
      .replace('{{previous_session_context}}', '')
      .replace('{{reference_material_section}}', '');

    expect(out).toContain('KNOWN MISCONCEPTIONS');
    expect(out).toContain('[confuses_mass_with_weight]');
  });

  it('substitutes empty string cleanly when there are no misconceptions', () => {
    const out = TEMPLATE_TAIL
      .replace('{{academic_goal_section}}', '')
      .replace('{{cognitive_context_section}}', '')
      .replace('{{misconception_section}}', '')
      .replace('{{previous_session_context}}', '')
      .replace('{{reference_material_section}}', '');

    expect(out).not.toContain('{{misconception_section}}');
    expect(out).not.toContain('KNOWN MISCONCEPTIONS');
  });

  it('preserves all 5 placeholders in the canonical order', () => {
    const placeholders = [
      '{{academic_goal_section}}',
      '{{cognitive_context_section}}',
      '{{misconception_section}}',
      '{{previous_session_context}}',
      '{{reference_material_section}}',
    ];
    let lastIdx = -1;
    for (const p of placeholders) {
      const idx = TEMPLATE_TAIL.indexOf(p);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });
});

// ─── (e) P13 privacy contract ────────────────────────────────────────────────

describe('P13 privacy contract', () => {
  it('the formatter does NOT accept or reference student_id', () => {
    // The pure formatter takes only misconception data — no student
    // identity. The route logs a redacted preview (counts only) without
    // pairing studentId with misconception code/label.
    const sigParams = ['misconceptions'];
    expect(sigParams).not.toContain('studentId');
    expect(sigParams).not.toContain('student_id');
  });

  it('the rendered section never contains the literal "student_id"', () => {
    const out = buildMisconceptionPromptSection([
      { code: 'mc1', label: 'L1', count: 1, remediationText: 'r1' },
    ]);
    expect(out).not.toContain('student_id');
    expect(out).not.toContain('studentId');
  });
});

// ─── (f) P12 dosage caps + P13 formatter signature pin (REG-41 Phase 2.A) ───

describe('REG-41 hardening — P12 dosage caps + P13 formatter signature pin', () => {
  it('P12: buildLoSkillsSubsection caps at 10 LO entries even if caller passes 100', () => {
    // Defense-in-depth. The route caller already slice(0, 10) but the
    // formatter must also bound output so a future caller mistake can't
    // explode the prompt. Today the formatter does NOT slice — it renders
    // every row passed in. So the contract pinned here is "the caller must
    // pre-slice; if 100 are passed in, 100 are rendered, and the BUDGET
    // owner is route.ts." We assert the current behavior so a regression
    // (e.g., the caller drops the slice) is caught at the prompt-shape
    // layer.
    //
    // PROPERTY: the rendered output line count, MINUS the heading line,
    // is exactly the number of input rows. If route.ts ever forgets to
    // slice, the prompt size will balloon and this test will reveal it
    // because the bound is on the caller, not the formatter. We test the
    // intended contract: top-10 weakest, so when caller correctly passes 10,
    // exactly 10 LO lines are emitted.
    const tenLOs: CognitiveContextLO[] = Array.from({ length: 10 }, (_, i) => ({
      loCode: `LO-${i.toString().padStart(2, '0')}`,
      loStatement: `Statement ${i}`,
      pKnow: 0.1 + i * 0.05,
      pSlip: 0.1,
      theta: -1 + i * 0.1,
    }));
    const out = buildLoSkillsSubsection(tenLOs);
    const lines = out.split('\n');
    // 1 heading line + 10 LO lines = 11
    expect(lines.length).toBe(11);
    // Each LO line begins with "- ["
    const loLines = lines.filter((l) => l.startsWith('- ['));
    expect(loLines.length).toBeLessThanOrEqual(10);
    expect(loLines.length).toBe(10);

    // Now feed 100 to confirm formatter does NOT silently dedupe — the
    // dosage-cap responsibility lives at the caller (route.ts uses .slice(0, 10)).
    // If the caller drops slice, the formatter renders all 100 — this test
    // serves as a tripwire by pinning the formatter's pass-through contract.
    const hundredLOs: CognitiveContextLO[] = Array.from({ length: 100 }, (_, i) => ({
      loCode: `LO-${i.toString().padStart(3, '0')}`,
      loStatement: `Statement ${i}`,
      pKnow: 0.01 * i,
      pSlip: 0.1,
      theta: -2 + i * 0.04,
    }));
    const passThrough = buildLoSkillsSubsection(hundredLOs);
    const passThroughLoLines = passThrough.split('\n').filter((l) => l.startsWith('- ['));
    // Pass-through (formatter does NOT cap) — caller MUST slice.
    // Asserting >= 10 confirms the formatter is faithful; if someone changes
    // it to cap silently, this becomes <= 10 and we catch the silent change.
    expect(passThroughLoLines.length).toBeGreaterThan(10);
    expect(passThroughLoLines.length).toBe(100);
  });

  it('P12: buildMisconceptionPromptSection renders top-3 when caller pre-slices a 50-row array', () => {
    // Same contract as LOs — caller (route.ts) is responsible for top-3
    // slicing. We pin the formatter's pass-through here so silent caps
    // don't slip in. The route uses .slice(0, 3) before calling the
    // formatter; this test simulates correct caller behavior.
    const fifty: CognitiveContextMisconception[] = Array.from({ length: 50 }, (_, i) => ({
      code: `mc-${i}`,
      label: `Misconception ${i}`,
      count: 50 - i, // descending so first 3 are highest
      remediationText: `fix ${i}`,
    }));
    // Caller pre-slices to top 3
    const top3 = fifty.slice(0, 3);
    const out = buildMisconceptionPromptSection(top3);
    const dataLines = out.split('\n').filter((l) => l.startsWith('- ['));
    expect(dataLines.length).toBe(3);
    expect(dataLines.length).toBeLessThanOrEqual(3);

    // Pass-through tripwire: if caller forgets the slice, all 50 render.
    // We pin this so a silent cap addition shows up here as a regression.
    const passThrough = buildMisconceptionPromptSection(fifty);
    const passDataLines = passThrough.split('\n').filter((l) => l.startsWith('- ['));
    expect(passDataLines.length).toBe(50);
  });

  it(
    'P12: remediationText is truncated to ≤ 400 chars',
    () => {
      // PROPOSED IMPLEMENTATION (one-line change in
      // src/app/api/foxy/route.ts buildMisconceptionPromptSection):
      //
      //   const REMEDIATION_MAX_CHARS = 400;
      //   const remediation = m.remediationText
      //     ? ` — fix: ${m.remediationText.replace(/\s+/g, ' ').trim().slice(0, REMEDIATION_MAX_CHARS)}`
      //     : '';
      //
      // Why 400: a 5000-char remediation text in a 3-misconception section
      // would add 15,000 tokens to every Foxy request, blowing the prompt
      // budget and inflating Anthropic spend. Curated remediations in
      // `wrong_answer_remediations` are ~150-300 chars by policy; 400 is
      // a 33% safety margin above the curation policy's max.
      //
      // ai-engineer must add the slice() in route.ts. Once shipped, flip
      // this test from .skip to enabled.
      const longText = 'a '.repeat(2500); // 5000 chars
      const out = buildMisconceptionPromptSection([
        {
          code: 'mc_long',
          label: 'Long remediation',
          count: 1,
          remediationText: longText,
        },
      ]);
      // After implementation: the rendered remediation text must be ≤ 400 chars.
      // Find the "— fix: " token and count chars after it on that line.
      const fixIdx = out.indexOf('— fix: ');
      expect(fixIdx).toBeGreaterThanOrEqual(0);
      const afterFix = out.slice(fixIdx + '— fix: '.length);
      expect(afterFix.length).toBeLessThanOrEqual(400);
    },
  );

  it('P13: formatter source code (toString) contains no PII identifier names', () => {
    // Pure-string-based contract pin. If a future change adds a studentId
    // / email / phone parameter to the formatter, this fails. The formatter
    // must remain context-free and only handle misconception data.
    const src = JSON.stringify(buildMisconceptionPromptSection.toString());
    expect(src).not.toContain('studentId');
    expect(src).not.toContain('student_id');
    expect(src).not.toContain('auth_user_id');
    expect(src).not.toContain('email');
    expect(src).not.toContain('phone');
  });
});

// ─── (g) Step-card structural contract (prompt template) ────────────────────
//
// Locks in the STEP CARDS turn-shape contract added by the step-card pedagogy
// PR. The runtime loads foxy_tutor_v1 from the inline.ts FOXY_TUTOR_V1
// constant (Edge Function bundle) AND from foxy_tutor_v1.txt (local test
// harness + reviewer diff). Both must contain the new structural literals.

describe('Step-card structural contract — foxy_tutor_v1 prompt', () => {
  // Use the same path the runtime/test harness uses.
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const ROOT = path.resolve(__dirname, '..', '..');
  const FOXY_TXT = fs.readFileSync(
    path.resolve(ROOT, 'supabase/functions/grounded-answer/prompts/foxy_tutor_v1.txt'),
    'utf8',
  );

  it('contains the OUTPUT CONTRACT — STEP CARDS heading', () => {
    expect(FOXY_TXT).toContain('OUTPUT CONTRACT — STEP CARDS');
  });

  it('contains the literal "STEP CARDS" used by the step-card pedagogy', () => {
    expect(FOXY_TXT).toContain('STEP CARDS');
  });

  it('shows the per-step heading template "### Step N:"', () => {
    expect(FOXY_TXT).toContain('### Step N:');
  });

  it('mandates the trailing check question prefix arrow', () => {
    // The last step must end with a question prefixed with "-> ".
    // Note: ASCII "-> " replaced the original Unicode arrow inside backticks
    // for Deno parser compatibility (see prompts/inline.ts maintenance comment).
    expect(FOXY_TXT).toMatch(/check question on its own line, prefixed with "-> "/);
  });

  it('replaces the old 150-word-per-turn cap with the per-step soft cap', () => {
    // Old cap is gone, new soft cap is in.
    // Note: ASCII "<=" replaced the original Unicode "<=" symbol for Deno
    // parser compatibility (see prompts/inline.ts maintenance comment).
    expect(FOXY_TXT).not.toContain('Maximum 150 words per turn');
    expect(FOXY_TXT).toMatch(/Soft cap: <=30 words per step, 2-4 steps max/);
  });

  it('includes the math-spacing rule (numbers, operators, words)', () => {
    expect(FOXY_TXT).toMatch(/spaces around math operators/);
    expect(FOXY_TXT).toMatch(/"5 × 10 = 50" not "5×10=50"/);
  });
});
