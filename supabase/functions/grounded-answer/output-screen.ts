// supabase/functions/grounded-answer/output-screen.ts
//
// RELOCATED (forensic audit HIGH-2, 2026-07-29): the canonical implementation
// now lives at supabase/functions/_shared/rag/output-screen.ts so ncert-solver
// (which had NO deterministic output screen at all — the audit finding) can
// share it instead of duplicating or going without. This file is kept as a
// thin re-export so existing imports (pipeline-stream.ts) and the existing
// test suite (__tests__/output-screen.test.ts) keep working unchanged.
//
// DENO TWIN of packages/lib/src/ai/validation/output-screen.ts (FOX-1, P12).
// See the canonical module for full documentation.

export { screenStudentFacingText, type OutputScreenResult } from '../_shared/rag/output-screen.ts';
