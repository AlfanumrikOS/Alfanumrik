// eval/rag/harness/verify-golden.ts
//
// B1 RAG eval-harness — Task 10 (step A) VERIFY. Two gates:
//   1) SCHEMA: ncert-golden-v1.json passes validateGoldenSet() (Task 1).
//   2) CORPUS-PARITY (Task 5 resolve): every relevant_chunks[].chunk_id resolves
//      to a LIVE row in rag_content_chunks with source='ncert_2025',
//      is_active=true, language='en' — i.e. a chunk the live system could serve.
//
// READ-ONLY. ONLY queries rag_content_chunks. Prints host + counts only.

import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateGoldenSet } from './golden-schema';

loadEnv({ path: resolve(__dirname, '..', '..', '..', '.env.local') });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const HOST = (() => { try { return new URL(url).host; } catch { return '<bad-url>'; } })();
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function main(): Promise<void> {
  const goldenPath = resolve(__dirname, '..', 'golden', 'ncert-golden-v1.json');
  const doc = JSON.parse(readFileSync(goldenPath, 'utf-8')) as unknown;

  // ── Gate 1: schema ────────────────────────────────────────────────────────
  const res = validateGoldenSet(doc);
  console.log(`[verify] host: ${HOST}`);
  console.log(`[verify] schema validateGoldenSet(): ${res.ok ? 'PASS' : 'FAIL'}`);
  if (!res.ok) {
    console.error('[verify] schema errors:\n  ' + res.errors.join('\n  '));
    process.exit(1);
  }
  const golden = res.value;
  console.log(`[verify] items: ${golden.items.length}`);

  // ── Gate 2: corpus-parity resolve (batched) ───────────────────────────────
  const allIds = new Set<string>();
  for (const it of golden.items) for (const c of it.relevant_chunks) allIds.add(c.chunk_id);
  const ids = [...allIds];
  console.log(`[verify] distinct chunk_ids to resolve: ${ids.length}`);

  const live = new Set<string>();
  const BATCH = 100;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('rag_content_chunks')
      .select('id')
      .eq('source', 'ncert_2025')
      .eq('is_active', true)
      .eq('language', 'en')
      .in('id', batch);
    if (error) throw new Error(`resolve batch failed: ${error.message}`);
    for (const r of data ?? []) live.add(String(r.id));
  }

  const missing = ids.filter((id) => !live.has(id));
  console.log(`[verify] resolved live (source=ncert_2025, active, en): ${live.size}/${ids.length}`);
  if (missing.length > 0) {
    console.error(`[verify] CORPUS-PARITY FAIL — ${missing.length} chunk_id(s) do NOT resolve:`);
    for (const m of missing) console.error(`   ${m}`);
    process.exit(1);
  }
  console.log('[verify] CORPUS-PARITY PASS — every chunk_id resolves to a live servable row.');
  console.log('[verify] OK');
}

main().catch((e) => { console.error(`[verify] FATAL: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); });
