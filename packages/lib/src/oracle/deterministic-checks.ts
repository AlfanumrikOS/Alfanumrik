// src/lib/oracle/deterministic-checks.ts
//
// Phase 6.17 — single-source-of-truth re-export of the deterministic oracle
// checks (REG-54). Created so the Phase 6.17 retroactive scan script
// (`scripts/retroactive-oracle-scan.ts`) and any future Node-side caller can
// import the deterministic checks WITHOUT pulling in the LLM-grader plumbing
// from `src/lib/ai/validation/quiz-oracle.ts`.
//
// Single source of truth:
//   - Canonical TS implementation:    src/lib/ai/validation/quiz-oracle.ts
//   - Deno mirror (Edge Functions):   supabase/functions/_shared/quiz-oracle.ts
//   - This module:                    re-exports from the canonical TS file
//
// The Deno mirror exists because Edge Functions cannot resolve TS path
// aliases / npm imports. It must be kept byte-equivalent on the pure-logic
// regions (see the comment block at the top of `_shared/quiz-oracle.ts`).
//
// Why a separate path under `src/lib/oracle/` rather than the existing
// `src/lib/ai/validation/`? The Phase 6.17 script + tests live outside the
// AI generator path; they audit pre-existing rows. Keeping the import path
// stable (`@alfanumrik/lib/oracle/deterministic-checks`) means the script keeps
// working even if the AI-validation module gets re-organised later.

export {
  runDeterministicChecks,
  checkNumericConsistency,
} from '@alfanumrik/lib/ai/validation/quiz-oracle';

export type {
  CandidateQuestion,
  OracleVerdict,
  OracleRejectionCategory,
  OracleAcceptResult,
  OracleRejectResult,
  OracleResult,
  LlmGradeResult,
  LlmGrader,
} from '@alfanumrik/lib/ai/validation/quiz-oracle';
