/**
 * Ambient `Deno` global for the `tsconfig.scripts.json` type-check gate.
 *
 * Why this exists
 * ---------------
 * `scripts/rag/replay-cosine-distribution.ts` replays the production RAG
 * pipeline by dynamically importing the *actual* Deno Edge Function sources
 * (`supabase/functions/grounded-answer/**`, `supabase/functions/_shared/**`)
 * from Node/tsx, so the harness measures the real code path rather than a
 * copy that can drift. Before it does, it calls `installDenoEnvShim()`
 * (replay-cosine-distribution.ts ~line 193), which assigns a minimal
 * read-only `Deno.env.get` onto `globalThis`.
 *
 * This declaration is the *type-level twin* of that runtime shim. It is not a
 * substitute for Deno's own types: it is scoped to exactly what the shim
 * actually provides, so the scripts gate type-checks the 14 Deno files in the
 * harness's import closure without pretending a full Deno runtime is present.
 *
 * Deliberately narrow
 * -------------------
 * Only `Deno.env.get` is declared. That is the whole surface the shim
 * installs, and the whole surface the imported closure currently uses
 * (`supabase/functions/_shared/reranking.ts:160`). If a future edit pulls a
 * Deno file that reaches for `Deno.serve`, `Deno.readFile`, `Deno.env.set`,
 * etc., this gate will FAIL rather than silently pass — which is the point.
 * Do not widen it to `any` or to a full Deno namespace; a failure here is a
 * real signal that the Node-side harness would crash at runtime, because the
 * shim would not provide that API either.
 *
 * Scope: this file is only in the `tsconfig.scripts.json` program. It does not
 * affect `apps/host`, `packages/*`, or the Deno runtime's own type-checking of
 * `supabase/functions/**` (which is still unchecked — see the Deno gate
 * recommendation in the PR description).
 */
declare const Deno: {
  readonly env: {
    get(key: string): string | undefined;
  };
};
