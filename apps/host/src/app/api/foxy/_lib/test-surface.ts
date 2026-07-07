/**
 * Foxy route — public test/helper surface (non-route barrel).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Next.js 16's App Router route-type generator
 * (`.next/dev/types/app/api/foxy/route.ts`) only permits HTTP handler exports
 * (GET/POST/…) plus a small config allowlist from a `route.ts` file. ANY other
 * `export` from `route.ts` — even a pure helper re-export — breaks type
 * generation and fails `npm run build` / `npm run type-check`.
 *
 * Historically `route.ts` re-exported a handful of pure helpers so that test
 * modules (and a couple of external callers) could import them from the route's
 * "public surface". Those re-exports are now illegal on a route file. This
 * sibling `_lib/` module is the new home for that public surface. The `_`
 * prefix keeps it OUT of the Next.js route tree, so these exports are
 * unrestricted.
 *
 * SINGLE SOURCE OF TRUTH
 * ----------------------
 * This module owns NO logic. It is plumbing only: every symbol below is
 * re-exported from the module that actually defines it. `route.ts` continues to
 * import these symbols from their real homes for its own internal use — it does
 * NOT import from here. Behavior is byte-identical to before the refactor.
 */

// chapter-parser helper (was re-exported from route.ts at the import site).
export { parseFoxyChapterNumber } from '@alfanumrik/lib/foxy/chapter-parser';

// Pure prompt-builder sections + coach-directive constants/types
// (src/lib/foxy/prompt-sections.ts is the single source of truth).
export {
  buildColdStartPromptSection,
  buildCognitivePromptSection,
  selectLeadConcept,
  buildLeadConceptDirective,
  isBareOpen,
  VALID_COACH_DIRECTIVES,
  COACH_DIRECTIVE_SECTIONS,
  SINGLE_MCQ_DIRECTIVE,
} from '@alfanumrik/lib/foxy/prompt-sections';
export type { LeadConcept, CoachDirective } from '@alfanumrik/lib/foxy/prompt-sections';

// Route-local constants/types/helpers (./constants is the single source of
// truth — extracted in H1 REFACTOR M1).
export {
  EMPTY_COGNITIVE_CONTEXT,
  mapFoxyModeToEventMode,
} from './constants';
export type { CognitiveContext } from './constants';

// Session helper (./session is the single source of truth — extracted in H1
// REFACTOR M4).
export { resolveSession } from './session';
