// supabase/functions/grounded-answer/output-screen.ts
//
// DENO TWIN of src/lib/ai/validation/output-screen.ts (FOX-1, P12).
//
// Deterministic, fail-safe content backstop for student-facing AI text on the
// STREAMING grounded path. The Next-TS and Deno-TS module graphs can't share a
// file, so this mirrors the TS `screenStudentFacingText` blocking set verbatim.
// Keep the HARD_BLOCK_PATTERNS list BYTE-FOR-BYTE in sync with the TS twin.
//
// WHY BLOCK ONLY A NARROW WORD-BOUNDARY SET (not a broad substring blocklist):
//   On a CBSE grade 6-12 tutor, bare substrings like 'ass'/'hell'/'sex'/
//   'alcohol' collide with cl[ass], s[hell] (electron shell), [sex]ual
//   reproduction, alcohol/weapons in chemistry/history — blocking those would
//   over-block real curriculum. We therefore block ONLY unambiguous profanity /
//   slurs / directed self-harm / injection tokens, matched on word boundaries.
//   The prompt-level FOXY_SAFETY_RAILS + grade/subject scope + grounding cover
//   the borderline-curriculum terms.
//
// CYCLE 4 REFINEMENT (FOX-1, CS curriculum exemption — keep in sync with the TS
// twin): the over-broad `<system>`/`</system>` and bare `[inst]`/`[/inst]`
// patterns are removed (a grade 11-12 Computer Science answer can legitimately
// display such literal markup), replaced by the unambiguous chat-template
// framings only — `<<SYS>>`, ChatML `<|im_start|>`/`<|im_end|>`, and `[INST]`
// ONLY when paired with the LLaMA-style `<s>`/`</s>` sentinels.
//
// On the streaming path this lets us yield an `abstain` event INSTEAD of `done`
// when the completed (buffered) answer is unsafe, so the unsafe structured/done
// frame never reaches the client. The text deltas already streamed are the
// documented residual (see 05-implementation.md).

const HARD_BLOCK_PATTERNS: ReadonlyArray<RegExp> = [
  // Unambiguous profanity (never CBSE vocabulary)
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
  // Slurs ('retard' deliberately EXCLUDED — collides with physics "retardation")
  /\bn[i1]gger\w*/i,
  /\bfaggot\w*/i,
  // Directed self-harm incitement (NOT clinical mentions of suicide)
  /\bkill\s+yoursel(?:f|ves)\b/i,
  /\bkys\b/i,
  /\bgo\s+(?:and\s+)?die\b/i,
  /\bend\s+your\s+life\b/i,
  // Chat / template injection tokens that must never reach a student
  // FOX-1 CS-exempt (Cycle 4): bare `<system>`/`[inst]` deliberately NOT blocked
  // (legitimate in a CS answer); block ONLY unambiguous chat-template framings —
  // `<<SYS>>`, ChatML `<|im_start|>`/`<|im_end|>`, and `[INST]`/`[/INST]` ONLY
  // when paired with the LLaMA-style `<s>`/`</s>` sentinels.
  /<<\s*sys\s*>>/i,
  /<\|im_(?:start|end)\|>/i,
  /<\/?s>\s*\[\/?\s*inst\s*\]/i,
  /\[\/?\s*inst\s*\]\s*<\/?s>/i,
];

export interface OutputScreenResult {
  safe: boolean;
  /** Stable category tags for telemetry. NEVER contains answer text. */
  categories: string[];
}

/**
 * Deterministic content screen. Pure, synchronous, never throws.
 * Blank/empty text is treated as safe (the abstain path owns the empty case).
 * On any thrown error, returns `safe:false` (fail-safe → caller abstains).
 */
export function screenStudentFacingText(text: string): OutputScreenResult {
  try {
    if (typeof text !== "string" || text.trim().length === 0) {
      return { safe: true, categories: [] };
    }
    for (const pattern of HARD_BLOCK_PATTERNS) {
      if (pattern.test(text)) {
        return { safe: false, categories: ["blocklist"] };
      }
    }
    return { safe: true, categories: [] };
  } catch {
    return { safe: false, categories: ["screen_error"] };
  }
}
