/**
 * math-normalization — COMPATIBILITY SHIM.
 *
 * The implementation moved to `packages/ui/src/math/normalize.ts` (the ONE
 * canonical normalizer, 2026-07 math-pipeline consolidation). This file
 * re-exports it so existing import paths (FoxyStructuredRenderer re-exports,
 * regression suites undelimited-math-normalization.test.tsx and
 * math-canary-corpus.test.ts) keep resolving. Do not add logic here.
 */

export {
  MATH_COMMAND_ALLOWLIST,
  containsAllowlistedMathCommand,
  splitUndelimitedMath,
  normalizeMathSegments,
} from '../math/normalize';
export type { InlineSegment } from '../math/normalize';
