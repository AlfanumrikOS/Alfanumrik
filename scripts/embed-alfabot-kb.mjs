#!/usr/bin/env node
/**
 * scripts/embed-alfabot-kb.mjs
 *
 * Seeds the alfabot_kb_chunks table from docs/alfabot/knowledge-base.md.
 *
 * Walks the markdown file's `## section_id` + `### EN/HI` structure, parses
 * the per-section `<!-- meta: ... -->` block for audience + canonical flags,
 * embeds each (section, lang) body with Voyage voyage-3 (1024d), then
 * UPSERTs into alfabot_kb_chunks keyed by (section_id, lang).
 *
 * Idempotent: each section body is hashed (SHA-256). Rows with a matching
 * existing source_hash are skipped — re-runs are no-ops unless the KB
 * markdown was edited.
 *
 * Required env (read from .env.local via dotenv, or process.env):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   VOYAGE_API_KEY
 *
 * Usage:
 *   node scripts/embed-alfabot-kb.mjs
 *
 * Exit codes:
 *   0 — all sections processed (some may have been skipped as unchanged)
 *   1 — at least one section failed
 *   2 — configuration error (missing env, unreadable KB file)
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  await import('dotenv/config');
} catch {
  // dotenv not installed; rely on process.env.
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const KB_PATH = join(REPO_ROOT, 'docs', 'alfabot', 'knowledge-base.md');

const VOYAGE_MODEL = 'voyage-3';
const EMBEDDING_DIMENSIONS = 1024;
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const MAX_TEXT_CHARS = 8_000;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY ?? '';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
  process.exit(2);
}
if (!VOYAGE_API_KEY) {
  console.error('Missing VOYAGE_API_KEY in env.');
  process.exit(2);
}

// ─── Markdown parser ────────────────────────────────────────────────────────

/**
 * Parse the KB markdown into an array of section descriptors:
 *   { section_id, audience: string[], canonical: boolean, en: string, hi: string }
 *
 * Structure expected:
 *   ## section_id
 *   <!-- meta:
 *   audience: parent, school
 *   canonical: true
 *   last_reviewed: 2026-05-19
 *   -->
 *   ### EN
 *   ...
 *   ### HI
 *   ...
 *   ---
 *   ## next-section
 *   ...
 */
function parseKnowledgeBase(markdown) {
  const sections = [];
  // Split on `## ` at the start of a line (the KB uses `## ` for section ids;
  // the very first one comes after the front-matter intro paragraph).
  const parts = markdown.split(/^## /m).slice(1); // skip preface

  for (const part of parts) {
    const lines = part.split('\n');
    const sectionId = lines[0].trim();
    if (!sectionId) continue;

    const body = lines.slice(1).join('\n');

    // Extract meta block.
    const metaMatch = body.match(/<!--\s*meta:\s*([\s\S]*?)-->/);
    const meta = { audience: ['all'], canonical: false };
    if (metaMatch) {
      const metaText = metaMatch[1];
      const audMatch = metaText.match(/audience:\s*([^\n]+)/);
      if (audMatch) {
        meta.audience = audMatch[1]
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length > 0);
      }
      const canMatch = metaText.match(/canonical:\s*(true|false)/i);
      if (canMatch) meta.canonical = canMatch[1].toLowerCase() === 'true';
    }

    // Extract EN body — between `### EN` and `### HI` (or `---`).
    const enMatch = body.match(/^###\s+EN\s*\n([\s\S]*?)(?=^###\s+HI|^---|\Z)/m);
    const hiMatch = body.match(/^###\s+HI\s*\n([\s\S]*?)(?=^---|\Z)/m);

    if (!enMatch || !hiMatch) {
      console.warn(`[embed-alfabot-kb] section "${sectionId}" missing EN or HI body; skipping`);
      continue;
    }

    const en = enMatch[1].trim();
    const hi = hiMatch[1].trim();
    if (en.length === 0 || hi.length === 0) {
      console.warn(`[embed-alfabot-kb] section "${sectionId}" has empty EN or HI body; skipping`);
      continue;
    }

    sections.push({
      section_id: sectionId,
      title: humaniseTitle(sectionId),
      audience: meta.audience,
      canonical: meta.canonical,
      en,
      hi,
    });
  }

  return sections;
}

function humaniseTitle(sectionId) {
  return sectionId
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// ─── Voyage embedding ──────────────────────────────────────────────────────

async function embedText(text) {
  const truncated = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: [truncated],
      output_dimension: EMBEDDING_DIMENSIONS,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Voyage ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Voyage returned bad embedding shape (length ${embedding?.length ?? 'n/a'})`);
  }
  return embedding;
}

// ─── Supabase REST helpers ──────────────────────────────────────────────────
// We avoid the @supabase/supabase-js dependency in this CLI script — a couple
// of REST calls are easier to maintain than a full client bring-up.

async function existingHashByKey() {
  // GET /rest/v1/alfabot_kb_chunks?select=section_id,lang,source_hash
  const url = `${SUPABASE_URL}/rest/v1/alfabot_kb_chunks?select=section_id,lang,source_hash`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase select ${res.status}: ${body.slice(0, 300)}`);
  }
  const rows = await res.json();
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.section_id}|${row.lang}`, row.source_hash);
  }
  return map;
}

async function upsertChunk(row) {
  // POST /rest/v1/alfabot_kb_chunks?on_conflict=section_id,lang
  // Prefer: resolution=merge-duplicates  → UPSERT semantics.
  const url = `${SUPABASE_URL}/rest/v1/alfabot_kb_chunks?on_conflict=section_id,lang`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase upsert ${res.status}: ${body.slice(0, 300)}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  let markdown;
  try {
    markdown = await readFile(KB_PATH, 'utf8');
  } catch (err) {
    console.error(`Cannot read KB at ${KB_PATH}: ${err.message}`);
    process.exit(2);
  }

  const sections = parseKnowledgeBase(markdown);
  console.log(`[embed-alfabot-kb] parsed ${sections.length} sections from ${KB_PATH}`);

  const existing = await existingHashByKey();

  let embedded = 0;
  let skipped = 0;
  let failed = 0;

  for (const section of sections) {
    for (const lang of /** @type {const} */ (['en', 'hi'])) {
      const body = lang === 'en' ? section.en : section.hi;
      const hash = sha256(body);
      const key = `${section.section_id}|${lang}`;

      if (existing.get(key) === hash) {
        skipped++;
        console.log(`[skip] ${key} (hash unchanged)`);
        continue;
      }

      try {
        const embedding = await embedText(body);
        await upsertChunk({
          section_id: section.section_id,
          title: section.title,
          audience: section.audience,
          lang,
          content: body,
          canonical: section.canonical,
          embedding,
          source_hash: hash,
          updated_at: new Date().toISOString(),
        });
        embedded++;
        console.log(`[ok]   ${key}`);
      } catch (err) {
        failed++;
        console.error(`[err]  ${key}: ${err.message}`);
      }
    }
  }

  console.log(
    `\n[embed-alfabot-kb] summary — embedded=${embedded}, skipped=${skipped}, failed=${failed}`,
  );

  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[embed-alfabot-kb] fatal: ${err.stack ?? err.message ?? err}`);
  process.exit(1);
});
