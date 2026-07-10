/**
 * Output Screen — deterministic, fail-safe content backstop for the LIVE
 * grounded Foxy path (P12: "No unfiltered LLM output to students").
 *
 * WHY THIS EXISTS (FOX-1, engineering-audit Cycle 4)
 * --------------------------------------------------
 * The original `validateOutput` (./output-guard.ts) is wired ONLY into the
 * legacy `ff_grounded_ai_foxy`-OFF intent-router flow. The live grounded
 * pipeline (route.ts structured path + the streaming path) had NO deterministic
 * profanity / age-appropriateness backstop — only prompt-level safety rails +
 * structured-JSON shape validation. This module is the missing backstop.
 *
 * WHY A NEW MODULE INSTEAD OF CALLING `validateOutput` AS THE BLOCKER
 * ------------------------------------------------------------------
 * `validateOutput`'s BLOCKLIST matches BARE SUBSTRINGS (`lower.includes('ass')`,
 * `'hell'`, `'sex'`, `'alcohol'`, `'weapon'`...). On a CBSE grade 6-12 tutor
 * those collide catastrophically with legitimate curriculum vocabulary:
 *   - 'ass'     → cl[ass], m[ass], p[ass]age, [ass]ess, the [ass] (donkey, NCERT fables)
 *   - 'hell'    → s[hell] (electron shell — core chemistry), [hell]o
 *   - 'sex'     → [sex]ual reproduction (grade 8 Biology), the [sex] of offspring
 *   - 'alcohol' → core Class 10/12 chemistry
 *   - 'weapon'/'murder'/'drug' → History / Civics / Political Science
 * Using `validateOutput`'s pass/fail (or its `***`-sanitizer, which rewrites
 * "class" → "cl***") as the blocking decision would OVER-BLOCK real lessons,
 * violating the P12 requirement that legitimate curriculum MUST pass.
 *
 * THE THRESHOLD (documented, conservative — does NOT loosen safety)
 * ----------------------------------------------------------------
 * We BLOCK only on a high-precision, WORD-BOUNDARY-matched set of tokens that
 * are NEVER part of legitimate CBSE 6-12 content: unambiguous profanity,
 * slurs, directed self-harm incitement, and chat/template injection tokens that
 * should never reach a student. Borderline curriculum-legitimate terms (sex,
 * alcohol, weapon, drug, murder, suicide-as-clinical-topic) are intentionally
 * NOT in the hard-block set — the prompt-level `FOXY_SAFETY_RAILS`, the
 * grade/subject scope gate, and grounding already constrain those, and blocking
 * them deterministically would break biology/chemistry/history answers.
 *
 * CYCLE 4 REFINEMENT (FOX-1, CS curriculum exemption, assessment-approved)
 * -----------------------------------------------------------------------
 * The earlier injection-token set included the over-broad patterns
 * `/<\/?\s*system\s*>/i` (bare `<system>`/`</system>`) and `/\[\/?\s*inst\s*\]/i`
 * (bare `[inst]`/`[/inst]`). A legitimate grade 11-12 Computer Science answer can
 * display such literal markup as a pedagogical example (XML tags, template
 * syntax), so those patterns risked OVER-BLOCKING real CS/coding content. They
 * are replaced with the UNAMBIGUOUS chat-template framing markers only — `<<SYS>>`,
 * ChatML `<|im_start|>`/`<|im_end|>`, and `[INST]`/`[/INST]` ONLY when directly
 * paired with the LLaMA-style `<s>`/`</s>` sentinels (the `<<SYS>>` block is
 * already covered by the first pattern). These framings cannot appear in normal
 * CBSE prose or a CS example, so real prompt-injection chat templates are still
 * caught while `<system>`-as-XML / `[inst]`-as-text in a CS answer passes.
 *
 * `validateOutput` is still RE-USED here as a WARN-ONLY telemetry signal so its
 * logic continues to run on the live path (observability parity with the legacy
 * flow) — but it never makes the blocking decision.
 *
 * FAIL-SAFE: if screening itself throws, we return `safe:false` so the caller
 * falls back to the existing safe-abstain envelope rather than emitting
 * unscreened text. Callers log a CATEGORY-ONLY ops event (P13 — never the text).
 */

import { validateOutput } from './output-guard';

/**
 * High-precision hard-block patterns. Each is anchored on word boundaries (or
 * is an exact token sequence) so it cannot fire on a substring of a legitimate
 * curriculum word. Case-insensitive. NO global flag — `.test()` only, so there
 * is no `lastIndex` statefulness across calls.
 *
 * Deliberately NARROWER than output-guard's BLOCKLIST. See module header.
 */
const HARD_BLOCK_PATTERNS: ReadonlyArray<RegExp> = [
  // ── Unambiguous profanity (never CBSE vocabulary) ──
  /\bf+u+c+k+\w*/i,
  /\bs+h+i+t+\b/i,
  /\bbitch\w*/i,
  /\bbastard\w*/i,
  /\basshole\w*/i,
  /\bmother\s?fuck\w*/i,
  /\bcunt\w*/i,
  /\bslut\w*/i,
  /\bwhore\b/i,
  /\bdickhead\b/i,
  /\bpussy\b/i,
  /\bbollocks\b/i,
  // Hindi/Hinglish abuse (unambiguous student-facing insults; not curriculum)
  /\bch+u+t+i+y+\w*/i,
  /\bharami\w*/i,
  /(?:^|[^\u0900-\u097FA-Za-z0-9_])च+ू+त+ि?य+ा+(?:$|[^\u0900-\u097FA-Za-z0-9_])/u,
  /(?:^|[^\u0900-\u097FA-Za-z0-9_])ह+र+ा+म+ी+(?:$|[^\u0900-\u097FA-Za-z0-9_])/u,
  // ── Slurs ── (NOTE: 'retard' is deliberately EXCLUDED — it collides with
  // the physics term "retardation"/"retarded motion".)
  /\bn[i1]gger\w*/i,
  /\bfaggot\w*/i,
  // ── Directed self-harm incitement (NOT clinical mentions of suicide) ──
  /\bkill\s+yoursel(?:f|ves)\b/i,
  /\bkys\b/i,
  /\bgo\s+(?:and\s+)?die\b/i,
  /\bend\s+your\s+life\b/i,
  // ── Chat / template injection tokens that must never reach a student ──
  // FOX-1 CS-exempt (Cycle 4): a bare `<system>`/`</system>` XML tag and a bare
  // `[inst]` token are DELIBERATELY NOT blocked — a grade 11-12 Computer Science
  // answer can legitimately show such literal markup as an example. We block ONLY
  // the unambiguous chat-template framings that cannot occur in CBSE/CS prose:
  // `<<SYS>>`, ChatML `<|im_start|>`/`<|im_end|>`, and `[INST]`/`[/INST]` ONLY
  // when directly paired with the LLaMA-style `<s>`/`</s>` sentinels.
  /<<\s*sys\s*>>/i,
  /<\|im_(?:start|end)\|>/i,
  /<\/?s>\s*\[\/?\s*inst\s*\]/i,
  /\[\/?\s*inst\s*\]\s*<\/?s>/i,
];

export interface OutputScreenResult {
  /** True when the text is safe to surface to a student. */
  safe: boolean;
  /**
   * Stable category tags for telemetry. NEVER contains student/answer text.
   * Possible values: 'blocklist', 'legacy_validator_flag', 'screen_error'.
   */
  categories: string[];
}

/**
 * Deterministic content screen for any student-facing assistant text on the
 * live grounded path. Pure, synchronous, never throws.
 *
 * Blocking is decided ONLY by `HARD_BLOCK_PATTERNS`. `validateOutput` is run as
 * an advisory WARN-only signal (its substring BLOCKLIST is too aggressive to
 * block on — see module header).
 *
 * @param text    the denormalized, student-facing answer text
 * @param context optional grade/subject (advisory only; never used to block)
 */
export function screenStudentFacingText(
  text: string,
  context?: { grade?: string; subject?: string },
): OutputScreenResult {
  try {
    // Empty / blank text is NOT "unsafe" here — the hard-abstain path owns the
    // empty-answer case. Treat blank as safe so we don't double-handle it.
    if (typeof text !== 'string' || text.trim().length === 0) {
      return { safe: true, categories: [] };
    }

    const categories = new Set<string>();

    for (const pattern of HARD_BLOCK_PATTERNS) {
      if (pattern.test(text)) {
        categories.add('blocklist');
        break;
      }
    }

    // Reuse the existing validator as a WARN-only observability signal so its
    // logic still executes on the live path (telemetry parity with the legacy
    // flow). We DO NOT block on it — see the over-block rationale above.
    try {
      const legacy = validateOutput(text, context);
      if (!legacy.valid) categories.add('legacy_validator_flag');
    } catch {
      /* advisory only — never fail the turn because the legacy validator threw */
    }

    return { safe: !categories.has('blocklist'), categories: [...categories] };
  } catch {
    // FAIL-SAFE: a throw inside the screen means we cannot prove the text is
    // safe → treat as UNSAFE so the caller serves the safe-abstain envelope.
    // P13: no text is logged here; the caller emits a category-only event.
    return { safe: false, categories: ['screen_error'] };
  }
}
