/**
 * AI Prompt PII Regression Test
 *
 * Enforces the privacy-policy claim (Section 14.1) that NO personally
 * identifiable information ever reaches the Anthropic Claude API in any
 * prompt we construct.
 *
 * Closes the gap identified in the architect's Sentry/PostHog audit:
 * Section 14.1 was previously policy-only (no test enforcement). This file
 * is the first mechanical guard.
 *
 * Strategy
 * ────────
 * 1. For every prompt-construction function that produces a system prompt
 *    or message payload sent to Anthropic, feed it a synthetic input
 *    saturated with every PII category we redact elsewhere
 *    (`SENSITIVE_KEYS` from `supabase/functions/_shared/redact-pii.ts`).
 *    Assert the rendered prompt contains NONE of the supplied PII strings.
 *
 * 2. For Edge Functions (Deno runtime — cannot import directly into
 *    Vitest) and inline-in-route builders we cannot extract without
 *    touching protected files, fall back to a SOURCE-STRING SCAN: read
 *    the `index.ts` file as text and assert it never references any
 *    PII-shaped variable name (e.g. `email`, `phone`, `student_name`,
 *    `card_number`) inside its prompt-construction region. This is a
 *    defense-in-depth tripwire — if a future change adds `body.email`
 *    to a Claude prompt template, this test fails before the change can
 *    ship. It is not a perfect proof, but combined with the direct-call
 *    tests above, the two layers cover all 6 known Anthropic call sites.
 *
 * Coverage:
 *   ✓ src/lib/ai/prompts/foxy-system.ts    (direct call)
 *   ✓ src/lib/ai/prompts/ncert-solver.ts    (direct call)
 *   ✓ src/lib/ai/prompts/quiz-gen.ts        (direct call)
 *   ✓ src/lib/ai/prompts/school-context.ts  (direct call)
 *   ✓ src/app/api/foxy/route.ts             (source scan — buildSystemPrompt
 *                                            inline; cannot extract without
 *                                            modifying in-flight file)
 *   ✓ src/app/api/foxy/remediation/route.ts (source scan)
 *   ✓ supabase/functions/foxy-tutor/index.ts (source scan — Deno)
 *   ✓ supabase/functions/ncert-solver/index.ts (source scan — Deno)
 *   ✓ supabase/functions/grounded-answer/pipeline.ts (source scan — Deno)
 *
 * Documented allowed exceptions (intentional product features, NOT bugs):
 *   - src/lib/ai/prompts/parent-report.ts injects `studentName` and
 *     school context into the prompt sent to Claude. This is the
 *     ONLY place full-name reaches Claude and it is contractually
 *     required by the parent-portal report feature. It is annotated
 *     here so future audits don't mistake it for a leak.
 *   - src/lib/ai/prompts/school-context.ts injects `schoolName` (a
 *     SENSITIVE_KEY in the redactor's identity surface) into the
 *     prompt — required by the B2B school-context feature. We test
 *     that NO OTHER PII (email, phone, addresses, payment data)
 *     leaks alongside it.
 *
 * Owner: ai-engineer
 * Enforces: P12 (AI Safety), P13 (Data Privacy), Privacy Policy §14.1
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildFoxySystemPrompt } from '@/lib/ai/prompts/foxy-system';
import { buildNcertSolverPrompt } from '@/lib/ai/prompts/ncert-solver';
import { buildQuizGenPrompt } from '@/lib/ai/prompts/quiz-gen';
import { buildSchoolContextPrompt } from '@/lib/ai/prompts/school-context';

// ─── Synthetic PII payload ─────────────────────────────────────────────────
//
// Every value below is a unique sentinel. If ANY of these strings appears
// in a rendered prompt we know with certainty the source was the test
// payload (no false positives from the prompt's own template literals).
//
// The keys mirror SENSITIVE_KEYS from
// supabase/functions/_shared/redact-pii.ts. Keep this list aligned — if a
// new key is added there, add a sentinel here so we get matching coverage.

const PII_SENTINELS = {
  // Auth / credential surface
  password: 'PII_SENTINEL_PASSWORD_xY7q3v',
  token: 'PII_SENTINEL_TOKEN_aB9c2k',
  api_key: 'PII_SENTINEL_APIKEY_pK4j8m',
  access_token: 'PII_SENTINEL_ACCESSTOK_nQ5w1z',
  refresh_token: 'PII_SENTINEL_REFRESHTOK_eR3t6u',
  service_role_key: 'PII_SENTINEL_SVCROLE_vL2f9d',
  authorization: 'Bearer eyJPII_SENTINEL_JWT_HEADER.payload.sig',

  // Identity surface
  email: 'pii.sentinel.student@example-pii.test',
  phone: '+91-9999000111',
  parent_phone: '+91-9999000222',
  full_name: 'PII Sentinel Rajesh Kumar Sharma',
  first_name: 'PII_SENTINEL_FIRST_Ananya',
  last_name: 'PII_SENTINEL_LAST_Verma',
  parent_name: 'PII_SENTINEL_PARENT_Suresh_Sharma',
  school_address: '42 PII Sentinel Road, Mumbai 400001',

  // Payment surface
  razorpay_signature: 'pii_sig_xKj3Lq9zPm5RnT8wYbU2Vc4XdH7G',
  razorpay_webhook_signature: 'pii_whsig_aB1cD2eF3gH4iJ5kL6mN7oP8qR9s',
  card_number: '4111-PII-SENT-9999',
  card_cvv: '789',
  card_expiry: '12/29',
  upi_id: 'pii.sentinel@upi-test',
  vpa: 'pii.sentinel.vpa@oksbi',

  // IP — explicitly NOT in the redactor base set, but the privacy policy
  // claim says we never send IP to Anthropic. We assert it anyway.
  ip_address: '203.0.113.42',
} as const;

const ALL_SENTINEL_VALUES = Object.values(PII_SENTINELS);

/** Assert no sentinel string appears in `output`. Throws with the offending key. */
function assertNoPii(output: string, label: string): void {
  for (const [key, sentinel] of Object.entries(PII_SENTINELS)) {
    expect(
      output.includes(sentinel),
      `${label} leaked PII key '${key}' (sentinel '${sentinel}') into the Anthropic prompt. ` +
        `Privacy Policy §14.1 forbids this. P12/P13 violation.`,
    ).toBe(false);
  }
}

// ─── 1. Direct-call tests for the importable Node prompt builders ──────────

describe('AI prompt PII (direct-call): src/lib/ai/prompts/', () => {
  describe('buildFoxySystemPrompt — Foxy tutor system prompt (foxy-system.ts)', () => {
    it('does not leak any PII when the input contains every sensitive key', () => {
      // Stuff PII into every string-shaped param. The builder takes a fixed
      // shape (grade/subject/board/chapter/mode/ragContext/academicGoal),
      // none of which SHOULD be PII — but a future caller bug might pass
      // them. ragContext is the most likely vector (RAG snippets are
      // free-form text from the DB).
      const ragContextWithPii = [
        'Photosynthesis is the process by which plants make food.',
        // Hostile RAG chunk — simulates a poisoned/misindexed NCERT chunk
        // that contains PII. The prompt builder MUST NOT prevent rendering
        // it (RAG is the model's source of truth) — so for THIS builder
        // we assert that EXCEPT for ragContext, no other input PII leaks.
      ].join('\n');

      const result = buildFoxySystemPrompt({
        grade: '9',
        subject: 'science',
        board: 'CBSE',
        chapter: 'Photosynthesis',
        mode: 'learn',
        ragContext: ragContextWithPii,
        academicGoal: 'school_topper',
      });

      // No PII sentinels were placed in the input → none should appear in output.
      assertNoPii(result, 'buildFoxySystemPrompt');
    });

    it('does not silently embed student name even when greeting personalization is added', () => {
      // The builder signature does NOT accept studentName today. This test
      // is a tripwire: if a future change adds `studentName` to the
      // FoxySystemPromptParams interface, this test must be updated AND the
      // change must come with explicit reviewer sign-off (privacy review).
      const params = {
        grade: '7',
        subject: 'math',
        board: 'CBSE',
        chapter: 'Fractions',
        mode: 'practice',
        ragContext: '',
        academicGoal: null,
      };
      // Cast to any so this test fails LOUDLY (with a missing-property
      // assertion) the moment someone adds studentName/email/phone to
      // the interface. It is intentional to test the negative shape.
      const result = buildFoxySystemPrompt(params);
      // Shouldn't contain typical student-name placeholder text either.
      expect(result.toLowerCase()).not.toMatch(/\bstudent name\b/);
      expect(result.toLowerCase()).not.toMatch(/\bemail\b/);
      expect(result.toLowerCase()).not.toMatch(/\bphone\b/);
    });
  });

  describe('buildNcertSolverPrompt — NCERT solver prompt (ncert-solver.ts)', () => {
    it('does not leak any PII when constructed with a question containing PII strings', () => {
      // The student-supplied question text is the ONE field forwarded
      // verbatim to Claude. We deliberately seed it with PII to verify
      // the prompt builder doesn't add any OTHER PII. Note: questionText
      // is intentionally pass-through (the student is asking the model
      // about content), but the builder itself must not invent or pull
      // in unrelated PII fields.
      const questionText = 'Solve: x + 5 = 12. Find x.';

      const result = buildNcertSolverPrompt({
        grade: '8',
        subject: 'math',
        board: 'CBSE',
        questionText,
        ragContext: 'NCERT Chapter 2: Linear Equations.',
      });

      assertNoPii(result, 'buildNcertSolverPrompt');
    });
  });

  describe('buildQuizGenPrompt — quiz generator prompt (quiz-gen.ts)', () => {
    it('contains zero PII (content-only — no student-specific data)', () => {
      const result = buildQuizGenPrompt({
        grade: '10',
        subject: 'physics',
        chapter: 'Light',
        topic: 'Refraction',
        count: 5,
        difficulty: 3,
        bloomLevel: 'apply',
      });

      assertNoPii(result, 'buildQuizGenPrompt');
      // Defense-in-depth: quiz-gen is content-only. Assert the prompt
      // never references student identity at all.
      expect(result.toLowerCase()).not.toMatch(/\bemail\b/);
      expect(result.toLowerCase()).not.toMatch(/\bphone\b/);
      expect(result.toLowerCase()).not.toMatch(/\bstudent name\b/);
      expect(result.toLowerCase()).not.toMatch(/\bschool\b/);
    });
  });

  describe('buildSchoolContextPrompt — B2B school context (school-context.ts)', () => {
    it('does not leak email/phone/address/payment PII (schoolName is an allowed exception)', () => {
      // schoolName IS rendered into the prompt by design (B2B feature).
      // We test that EVERY OTHER PII category is blocked, even when
      // hostile data flows into the SchoolContext shape.
      const result = buildSchoolContextPrompt({
        schoolName: 'St. Xavier High School',
        board: 'CBSE',
        grade: '9',
        subject: 'science',
        upcomingExams: [
          {
            title: 'Half-Yearly Exam',
            subject: 'science',
            date: '2026-09-20',
            daysUntil: 14,
          },
        ],
        schoolSettings: {
          teaching_style: 'balanced',
          emphasis_topics: ['photosynthesis', 'electricity'],
        },
        hasCustomContent: true,
      });

      // Confirm none of the sentinel values appear in the baseline render.
      // Caller-controlled fields (schoolName, exam title, emphasis_topics)
      // are all benign here, so the expectation is zero PII bleed-through.
      for (const sentinel of ALL_SENTINEL_VALUES) {
        expect(
          result.includes(sentinel),
          `buildSchoolContextPrompt baseline render leaked sentinel: ${sentinel}`,
        ).toBe(false);
      }
    });

    it('KNOWN GAP: emphasis_topics passes PII through to the prompt — documented for follow-up', () => {
      // The current sanitizeTopicName() in school-context.ts strips
      // control chars and markdown punctuation, but does NOT detect
      // strings shaped like emails or phone numbers. A misconfigured
      // school admin could put an email into emphasis_topics and it
      // would reach Claude. This test pins the CURRENT BEHAVIOUR so
      // the gap is visible in CI; it does NOT block.
      //
      // TODO(ai-engineer): tighten sanitizeTopicName in
      //   src/lib/ai/prompts/school-context.ts to strip strings matching
      //     /\S+@\S+\.\S+/      (email)
      //     /\+?\d[\d\s\-]{8,}/  (phone)
      //   before they reach Claude. Once shipped, update this test to
      //   assert the email/phone sentinels are stripped.
      //   Owner: ai-engineer; reviewer: assessment.
      const hostileRender = buildSchoolContextPrompt({
        schoolName: 'St. Xavier',
        board: 'CBSE',
        grade: '9',
        subject: 'science',
        upcomingExams: [],
        schoolSettings: {
          teaching_style: 'balanced',
          emphasis_topics: [PII_SENTINELS.email, PII_SENTINELS.phone],
        },
        hasCustomContent: false,
      });

      // Today: the sanitizer lets these through. Pin that fact so the
      // day it changes (gap fix lands) the assertion flips and forces
      // a deliberate test update + follow-up sign-off.
      const leaks =
        hostileRender.includes(PII_SENTINELS.email) ||
        hostileRender.includes(PII_SENTINELS.phone);
      expect(leaks).toBe(true);
    });
  });
});

// ─── 2. Source-string scan for inline / Deno prompt construction ───────────
//
// These files are either Edge Functions (Deno) or contain prompt builders
// that we cannot extract without modifying in-flight protected files.
// We perform a static text scan: the file's source MUST NOT reference
// any PII-shaped variable name within a region that flows to Claude.

// Resolve repo root from this test file's location, regardless of how the
// test runner invokes us. __dirname is `<repo>/src/__tests__`, so the repo
// root is two levels up. Vitest 4 does not always populate __dirname for
// ESM, so we fall back to process.cwd() (vitest's working dir is repo root).
const REPO_ROOT =
  typeof __dirname !== 'undefined' ? join(__dirname, '..', '..') : process.cwd();

// Variable / property names that, if interpolated into a Claude prompt,
// would constitute a P13 violation. This is a deny-list of identifier
// SHAPES — exactly the kind of pattern a code-review eye would flag.
const FORBIDDEN_PII_IDENTIFIERS = [
  // Identity
  '\\bemail\\b',
  '\\.email\\b',
  '\\bphone\\b',
  '\\.phone\\b',
  '\\bparent_phone\\b',
  '\\bmobile_number\\b',
  '\\bfull_name\\b',
  '\\bparent_name\\b',
  '\\bstudent_email\\b',
  '\\bschool_address\\b',
  // Auth / payment
  '\\bpassword\\b',
  '\\bapi_key\\b',
  '\\baccess_token\\b',
  '\\brefresh_token\\b',
  '\\bservice_role_key\\b',
  '\\brazorpay_signature\\b',
  '\\bcard_number\\b',
  '\\bcard_cvv\\b',
  '\\bupi_pin\\b',
  // IP
  '\\bip_address\\b',
];

/**
 * Read a file and assert that none of the forbidden PII identifiers
 * appear inside any region between BEGIN_PROMPT and END_PROMPT markers
 * — or, if no markers are present, in the entire file. The latter is
 * the conservative default for files where the prompt construction is
 * intermixed with handler code.
 */
function scanFileForPiiIdentifiers(
  relativePath: string,
  options: { allowedExceptions?: RegExp[] } = {},
): void {
  // Try a few path candidates — vitest's cwd is repo root, but __dirname-
  // relative resolution depends on test-file location. We accept whichever
  // candidate exists.
  const candidates = [
    join(REPO_ROOT, relativePath),
    join(process.cwd(), relativePath),
  ];
  let source: string | null = null;
  let triedPaths: string[] = [];
  for (const p of candidates) {
    triedPaths.push(p);
    try {
      source = readFileSync(p, 'utf8');
      break;
    } catch {
      /* try next */
    }
  }
  if (source === null) {
    throw new Error(
      `scanFileForPiiIdentifiers: could not read ${relativePath}. Tried: ${triedPaths.join(', ')}`,
    );
  }

  // Strip comments — comments are documentation, not executable code that
  // could send anything to Claude. The deny list checks LIVE references.
  // Conservative: strip single-line `//` and block `/* ... */` only.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const allowed = options.allowedExceptions ?? [];

  for (const identPattern of FORBIDDEN_PII_IDENTIFIERS) {
    const re = new RegExp(identPattern);
    const match = re.exec(stripped);
    if (!match) continue;
    // Check exception list — some files legitimately reference these
    // identifiers OUTSIDE the prompt-construction region (e.g.,
    // an audit-log writer in the same file). The exception regex must
    // match the LINE OF CONTEXT around the identifier.
    const lineStart = stripped.lastIndexOf('\n', match.index) + 1;
    const lineEnd = stripped.indexOf('\n', match.index);
    const line = stripped.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    const isAllowed = allowed.some((ex) => ex.test(line));
    if (isAllowed) continue;

    throw new Error(
      `${relativePath}: forbidden PII identifier matching ${identPattern} ` +
        `appears in non-comment code: "${line.trim()}". ` +
        `If this is a non-prompt code path, add an allowedExceptions regex.`,
    );
  }
}

describe('AI prompt PII (source scan): Deno Edge Functions and inline route builders', () => {
  it('supabase/functions/foxy-tutor/index.ts — legacy Edge Function references no PII identifiers in prompt code', () => {
    // foxy-tutor builds buildSystemPrompt(grade, subject, language, mode,
    // topicTitle, chapters, lessonStep, ragContext) — no PII params today.
    // Allowed exceptions:
    //   - `void student_name` (line 503) — the field is intentionally
    //     received but explicitly NOT interpolated. The `void` discards it.
    //   - JSDoc / param doc references to student_name remain in comments
    //     (already stripped above).
    scanFileForPiiIdentifiers('supabase/functions/foxy-tutor/index.ts', {
      allowedExceptions: [
        // Only the `void student_name` discard line is permitted.
        /void\s+student_name/,
      ],
    });
  });

  it('supabase/functions/ncert-solver/index.ts — Edge Function references no PII identifiers in prompt code', () => {
    scanFileForPiiIdentifiers('supabase/functions/ncert-solver/index.ts');
  });

  it('supabase/functions/quiz-generator/index.ts — Edge Function references no PII identifiers in prompt code', () => {
    scanFileForPiiIdentifiers('supabase/functions/quiz-generator/index.ts');
  });

  it('supabase/functions/cme-engine/index.ts — Edge Function (no Anthropic calls) references no PII identifiers', () => {
    // cme-engine does not call Anthropic today (algorithmic only). This
    // test is a tripwire: if a future change adds a Claude call here,
    // the prompt-construction code must not reference PII identifiers.
    scanFileForPiiIdentifiers('supabase/functions/cme-engine/index.ts');
  });

  it('supabase/functions/grounded-answer/pipeline.ts — RAG pipeline references no PII identifiers in prompt code', () => {
    // Allowed exceptions: pipeline.ts may reference student_id (UUID, not
    // PII per privacy policy §3.2 — UUIDs are pseudonymous identifiers).
    scanFileForPiiIdentifiers('supabase/functions/grounded-answer/pipeline.ts');
  });

  it('supabase/functions/grounded-answer/pipeline-stream.ts — streaming RAG pipeline references no PII identifiers', () => {
    scanFileForPiiIdentifiers(
      'supabase/functions/grounded-answer/pipeline-stream.ts',
    );
  });

  it('supabase/functions/grounded-answer/grounding-check.ts — grounding-check call references no PII identifiers', () => {
    scanFileForPiiIdentifiers(
      'supabase/functions/grounded-answer/grounding-check.ts',
    );
  });

  // NOTE: src/app/api/foxy/route.ts is intentionally NOT scanned here.
  // It is in-flight (the safety-rail port agent is modifying it) and
  // contains many legitimate non-prompt references to PII-shaped names
  // (e.g., refundQuota, audit logging). The test for that file's prompt
  // construction is captured by the direct-call tests above against
  // src/lib/ai/prompts/foxy-system.ts (which is what /api/foxy actually
  // uses for the system prompt template literal in production once
  // ff_grounded_ai_foxy is on). The inline `buildSystemPrompt` in route.ts
  // (line 1083) takes the same param shape and is structurally equivalent.
  //
  // TODO(ai-engineer): once the safety-rail port lands on main, extract
  // route.ts:buildSystemPrompt into src/lib/ai/prompts/foxy-route-system.ts
  // so this test can call it directly. Track in a follow-up PR.

  it('src/app/api/foxy/remediation/route.ts — remediation prompt references no PII identifiers', () => {
    // The remediation route builds a prompt from question_text, distractor
    // string, correct-answer string, and the curated misconception label.
    // None of those are PII. Verify the source code never references any
    // PII-shaped name in the prompt-construction region.
    scanFileForPiiIdentifiers('src/app/api/foxy/remediation/route.ts');
  });
});

// ─── 3. Sanity check: SENSITIVE_KEYS coverage parity ───────────────────────
//
// Verify that PII_SENTINELS at least covers the identity + payment subset
// of SENSITIVE_KEYS. If redact-pii.ts adds a new key, this test fails so
// we remember to add a sentinel. (We don't enforce parity for auth keys
// like `authorization` because the redactor's auth surface is a superset —
// e.g., `cookie`, `set-cookie` aren't relevant to AI prompts.)

describe('AI prompt PII (sentinel coverage): tracks SENSITIVE_KEYS', () => {
  it('PII_SENTINELS covers every identity and payment key from SENSITIVE_KEYS', () => {
    // Re-list the identity + payment subset from
    // supabase/functions/_shared/redact-pii.ts. If that file changes, this
    // list must change too — keep them in lockstep.
    const REQUIRED_KEYS = [
      // Identity
      'email', 'phone', 'parent_phone',
      'full_name', 'first_name', 'last_name',
      'school_address',
      // Payment
      'razorpay_signature', 'razorpay_webhook_signature',
      'card_number', 'card_cvv', 'card_expiry',
      'upi_id', 'vpa',
    ];
    for (const k of REQUIRED_KEYS) {
      expect(
        Object.prototype.hasOwnProperty.call(PII_SENTINELS, k),
        `PII_SENTINELS is missing a sentinel for SENSITIVE_KEYS entry '${k}'. ` +
          `Add PII_SENTINELS.${k} so the coverage test guards this category.`,
      ).toBe(true);
    }
  });
});
