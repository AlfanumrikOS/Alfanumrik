# NCERT Ingestion Pipeline

PDF → `pdf-parse` → chapter-split → ~400-token chunks → `rag_content_chunks` (`source='ncert_2025'`) → Voyage `voyage-3` embeddings (1024-d, `embed-chunks.ts`).

Entry points: `discover.ts`, `ingest-local.ts` (local folder), `storage-ingest.ts` (Supabase Storage bucket `ncert-books`), `validate.ts`, `rollback.ts`. See `README.md` in this directory for per-script usage.

**npm scripts are declared in `apps/host/package.json`, not the repo root:** `ncert:discover`, `ncert:ingest`, `ncert:embed`, `ncert:validate`, `ncert:pipeline` (= `ncert:ingest && ncert:validate` — note it does **not** run `ncert:embed`).

⚠️ **`ncert:embed` calls the paid Voyage API — never run it casually.**

⚠️ **Unresolved cwd mismatch:** the `ncert:*` script bodies reference `scripts/ncert-ingestion/…` and `./data/NCERT books`, which exist only at the **repo root**, while the scripts are declared in `apps/host/package.json` (whose cwd has no `scripts/ncert-ingestion/` or `data/`). The declarations and the file locations disagree — verify cwd before running.

Source PDFs are gitignored; they live in Supabase Storage bucket `ncert-books`.

⚠️ **Open question (do not assert either side):** this pipeline is present and live on disk, but `docs/runbooks/ingest-ncert-french-revolution.md:467` claims the existing ~16,006 chunks were produced by "a legacy tool no longer present in the codebase." Both can be true (a retired tool built the corpus; this pipeline is its successor). Provenance of the *existing* chunks is unconfirmed.

See also: the NCERT corpus note in the root `CLAUDE.md` Key File Map — the corpus already exists (~16,006 chunks, ~98.6% syllabus coverage). Don't re-ingest blind; check `/api/super-admin/grounding/coverage` and the `ingestion_gaps` view first.
