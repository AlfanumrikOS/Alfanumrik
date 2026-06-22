#!/usr/bin/env tsx
/* eslint-disable no-console */
/**
 * scripts/generate-chapter-concepts.ts
 *
 * REAL, resumable offline generation pipeline that synthesizes curated
 * `chapter_concepts` lesson cards from the ingested NCERT corpus
 * (`rag_content_chunks`) using ACTUAL OpenAI API calls.
 *
 * This is NOT a simulation. Every card is produced by a real OpenAI call,
 * grounded in real NCERT chunks retrieved via the `get_chapter_rag_content`
 * RPC, validated against the assessment-owned rubric
 * (docs/superpowers/specs/2026-06-21-chapter-concepts-derivation-rubric.md),
 * inserted into the live DB via PostgREST upsert, and verifiable by querying
 * the rows back (scripts/sql/validate-chapter-concepts.sql).
 *
 * MODEL / PROVIDER: this OFFLINE content-generation script runs on OpenAI
 * (gpt-4o-mini primary, gpt-4o batch fallback) — the platform's established
 * OpenAI config (src/lib/ai/clients/openai.ts: OPENAI_MINI_MODEL / OPENAI_FULL_MODEL).
 * This provider switch is USER-APPROVED and scoped EXCLUSIVELY to this offline
 * script (the Anthropic key is out of credits). It does NOT touch any
 * student-facing AI — foxy-tutor, ncert-solver, reasoning-cascade, AlfaBot all
 * stay on their current providers. The script calls the OpenAI Chat Completions
 * API directly rather than importing callOpenAI(), because that client is wired
 * to the Next.js runtime (logger) which is inappropriate for a long batch job.
 * The request shape mirrors src/lib/ai/clients/openai.ts; retry/backoff,
 * temperature posture (0.3 factual), and all safety rails are preserved. JSON
 * mode (response_format: json_object) guarantees parseable output.
 *
 * USAGE:
 *   npx tsx scripts/generate-chapter-concepts.ts --grade 7 --subjects science,math,english,hindi,social_studies
 *   npx tsx scripts/generate-chapter-concepts.ts --grade 7 --subjects science --chapter 1   (single chapter)
 *   npx tsx scripts/generate-chapter-concepts.ts --grade 7 --subjects math --dry-run         (no inserts, prints cards)
 *   npx tsx scripts/generate-chapter-concepts.ts --grade 7 --subjects science --force        (regenerate even if rubric-passing rows exist)
 *
 * ENV (loaded from .env.local via dotenv):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (required)
 *   OPENAI_API_KEY                                       (required)
 *
 * RESUMABLE + IDEMPOTENT:
 *   - Chapters that already have a rubric-PASSING deck for source='ncert_2025_llm'
 *     are SKIPPED (unless --force). Progress is checkpointed to
 *     scripts/.checkpoints/chapter-concepts-<grade>.log (JSONL).
 *   - Inserts use upsert on the unique key (grade,subject,chapter_number,concept_number)
 *     with on_conflict DO UPDATE. Real LLM rows (ncert_2025_llm) SUPERSEDE the
 *     hand-curated pilot rows (ncert_2025_pilot_llm) for overlapping chapters —
 *     the pilot rows are deleted for any chapter we successfully (re)generate so
 *     the deck is single-source and the unique key never collides across sources.
 *
 * PROVENANCE: the `chapter_concepts` table has no model/provider column (only
 * `source='ncert_2025_llm'`, which is unchanged). The originating OpenAI model id
 * (gpt-4o-mini / gpt-4o) is recorded per-chapter in the checkpoint JSONL
 * (`ChapterResult.model`), so every generated deck's origin is auditable from
 * scripts/.checkpoints/chapter-concepts-<grade>.log. No schema change is made
 * here (a model column would be an architect-owned migration).
 *
 * Owner: ai-engineer. Reviewers: assessment (P12 / curriculum correctness),
 *        architect (DB safety). Do NOT enable ff_chapter_reader_v2 from here.
 */

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

// ─── Platform config reuse (model names, base URL) ───────────────────────────
// Mirror src/lib/ai/clients/openai.ts — OPENAI_MINI_MODEL primary, OPENAI_FULL_MODEL
// batch fallback. Provider switch is USER-APPROVED and scoped to this offline
// script ONLY (see header). gpt-4o-mini is the platform's established low-cost
// model; gpt-4o is the escalation tier used here only as the batch fallback when
// mini fails generation/validation twice.
const PRIMARY_MODEL = 'gpt-4o-mini';
const FALLBACK_MODEL = 'gpt-4o';
const API_BASE_URL = 'https://api.openai.com/v1';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? '';

const PG_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: 'Bearer ' + SERVICE_KEY,
  'Content-Type': 'application/json',
};

const NEW_SOURCE = 'ncert_2025_llm';
const PILOT_SOURCE = 'ncert_2025_pilot_llm';

const VALID_BLOOM = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

// OpenAI $ per million tokens (approx, for cost reporting only).
// gpt-4o-mini: $0.15 in / $0.60 out. gpt-4o: $2.50 in / $10.00 out.
const COST_PER_MTOK: Record<string, { in: number; out: number }> = {
  [PRIMARY_MODEL]: { in: 0.15, out: 0.6 },
  [FALLBACK_MODEL]: { in: 2.5, out: 10.0 },
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface RagChunk {
  chunk_id: string;
  chunk_text: string;
  topic: string | null;
  concept: string | null;
  chapter_title: string | null;
  content_type: string | null;
}

interface GeneratedCard {
  title: string;
  title_hi: string;
  learning_objective: string;
  learning_objective_hi: string;
  explanation: string;
  explanation_hi: string;
  key_formula: string | null;
  example_title: string | null;
  example_content: string | null;
  example_content_hi: string | null;
  practice_question: string;
  practice_options: string[];
  practice_correct_index: number;
  practice_explanation: string;
  difficulty: number;
  bloom_level: string;
  estimated_minutes: number;
}

interface ChapterResult {
  subject: string;
  chapter_number: number;
  status: 'inserted' | 'skipped_existing' | 'skipped_no_chunks' | 'failed_validation' | 'failed_generation' | 'failed_db';
  cards_inserted: number;
  reasons: string[];
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// ─── CLI args ─────────────────────────────────────────────────────────────────

interface Args {
  grade: string;
  subjects: string[];
  chapter: number | null;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  let grade = '';
  let subjects: string[] = [];
  let chapter: number | null = null;
  let dryRun = false;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--grade') grade = argv[++i];
    else if (a === '--subjects') subjects = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--chapter') chapter = parseInt(argv[++i], 10);
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--force') force = true;
  }
  if (!grade || subjects.length === 0) {
    console.error('Usage: npx tsx scripts/generate-chapter-concepts.ts --grade 7 --subjects science,math,english,hindi,social_studies [--chapter N] [--dry-run] [--force]');
    process.exit(2);
  }
  return { grade, subjects, chapter, dryRun, force };
}

// ─── DB helpers (PostgREST, service role) ────────────────────────────────────

async function rest(path: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...PG_HEADERS, ...(init?.headers ?? {}) },
  });
  return { status: r.status, body: await r.text() };
}

async function rpc(name: string, args: Record<string, unknown>): Promise<{ status: number; body: string }> {
  return rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
}

/** Enumerate in-scope chapters for grade+subject that HAVE rag chunks. */
async function getInScopeChapters(grade: string, subject: string): Promise<Array<{ chapter_number: number; chapter_title: string }>> {
  const r = await rest(
    `cbse_syllabus?grade=eq.${grade}&subject_code=eq.${subject}&is_in_scope=is.true&select=chapter_number,chapter_title,chunk_count&order=chapter_number`,
  );
  if (r.status !== 200) throw new Error(`cbse_syllabus query failed ${r.status}: ${r.body.slice(0, 200)}`);
  const rows = JSON.parse(r.body) as Array<{ chapter_number: number; chapter_title: string; chunk_count: number }>;
  return rows.filter((x) => x.chunk_count > 0).map((x) => ({ chapter_number: x.chapter_number, chapter_title: x.chapter_title }));
}

/** Resolve the chapters.id FK for grade+subject+chapter. */
async function getChapterId(grade: string, subject: string, chapterNumber: number): Promise<{ id: string; title: string | null; title_hi: string | null } | null> {
  const r = await rest(
    `chapters?grade=eq.${grade}&subject_code=eq.${subject}&chapter_number=eq.${chapterNumber}&select=id,title,title_hi&limit=1`,
  );
  if (r.status !== 200) return null;
  const rows = JSON.parse(r.body) as Array<{ id: string; title: string | null; title_hi: string | null }>;
  return rows[0] ?? null;
}

/** Retrieve the chapter's NCERT chunks via the established RPC. */
async function getChapterChunks(grade: string, subject: string, chapterNumber: number): Promise<RagChunk[]> {
  const r = await rpc('get_chapter_rag_content', { p_grade: grade, p_subject: subject, p_chapter_number: chapterNumber });
  if (r.status !== 200) throw new Error(`get_chapter_rag_content failed ${r.status}: ${r.body.slice(0, 200)}`);
  return JSON.parse(r.body) as RagChunk[];
}

/** Does this chapter already have a rubric-passing ncert_2025_llm deck? (resume) */
async function existingDeckPasses(grade: string, subject: string, chapterNumber: number): Promise<boolean> {
  const r = await rest(
    `chapter_concepts?grade=eq.${grade}&subject=eq.${subject}&chapter_number=eq.${chapterNumber}&source=eq.${NEW_SOURCE}&is_active=is.true` +
      `&select=concept_number,title,explanation,explanation_hi,title_hi,difficulty,bloom_level,practice_question,practice_options,learning_objective,learning_objective_hi,practice_correct_index,practice_explanation`,
  );
  if (r.status !== 200) return false;
  const rows = JSON.parse(r.body) as Array<{
    title: string; explanation: string; explanation_hi: string | null; title_hi: string | null;
    difficulty: number | null; bloom_level: string | null; practice_question: string | null; practice_options: unknown;
    learning_objective: string | null; learning_objective_hi: string | null;
    practice_correct_index: number | null; practice_explanation: string | null;
  }>;
  if (rows.length < 3) return false;
  // Re-run the rubric (chapter-level) against the live rows. Reconstruct EVERY
  // field the rubric inspects from the DB — in particular learning_objective /
  // learning_objective_hi / practice_correct_index / practice_explanation, which
  // were previously hardcoded (''/0/'x') and made validateCard report them as
  // missing for EVERY card, so this check could never pass and resume never
  // skipped (a latent bug independent of the OpenAI switch).
  const cards: GeneratedCard[] = rows.map((x) => ({
    title: x.title ?? '', title_hi: x.title_hi ?? '',
    learning_objective: x.learning_objective ?? '', learning_objective_hi: x.learning_objective_hi ?? '',
    explanation: x.explanation ?? '', explanation_hi: x.explanation_hi ?? '', key_formula: null,
    example_title: null, example_content: null, example_content_hi: null,
    practice_question: x.practice_question ?? '', practice_options: Array.isArray(x.practice_options) ? (x.practice_options as string[]) : [],
    practice_correct_index: typeof x.practice_correct_index === 'number' ? x.practice_correct_index : 0,
    practice_explanation: x.practice_explanation ?? '', difficulty: x.difficulty ?? 2, bloom_level: x.bloom_level ?? 'understand',
    estimated_minutes: 5,
  }));
  return validateChapter(cards).pass;
}

// ─── Source-text cleanup (OCR artifacts) ─────────────────────────────────────

function cleanSourceText(s: string): string {
  return s
    .replace(/\t+/g, ' ')          // OCR tab runs
    .replace(/ /g, ' ')       // nbsp
    .replace(/[ ]{2,}/g, ' ')      // collapse spaces
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Prompt construction (grounded, safety-railed) ───────────────────────────

function buildSystemPrompt(grade: string, subject: string, chapterTitle: string): string {
  return [
    `You are an expert CBSE (NCERT) curriculum author creating lesson "concept cards" for Class ${grade} ${subject}.`,
    `Chapter: "${chapterTitle}".`,
    '',
    'STRICT GROUNDING RULE: Use ONLY the NCERT reference material provided by the user message. Do NOT add facts, examples, numbers, dates, or definitions that are not present in or directly derivable from that material. If the material does not support a concept, do not invent one. You are summarizing and explaining the provided NCERT content for a student — not writing from outside knowledge.',
    '',
    'AUDIENCE & SAFETY RAILS:',
    `- Write for a Class ${grade} student (ages 11-17). Age-appropriate vocabulary and depth.`,
    '- Stay strictly within the CBSE curriculum scope for this chapter. No out-of-syllabus tangents, no content above/below the grade band.',
    '- No personal, sensitive, political, or non-academic content.',
    '',
    'WHAT TO PRODUCE: 4 to 6 concept cards, each covering ONE distinct concept actually present in the reference material. Each card must have:',
    '- title (English) and title_hi (Hindi, Devanagari). Keep technical terms / proper nouns / English coinages in Latin script; translate the rest naturally into Hindi.',
    '- learning_objective + learning_objective_hi: ONE outcome sentence each ("Understand how...", "Identify and...").',
    '- explanation + explanation_hi: genuine PROSE in full sentences, ideally 150-400 characters (keep it tight and student-friendly; never exceed ~600). Explain the concept so a student understands it. NOT a list of terms, NOT a "Key approach:" one-liner, NOT a verbatim copy of the reference text. Hindi must be natural Hindi prose (not English copied into the Hindi field, not machine-garbled).',
    '- key_formula: only if the concept has a real formula (STEM). Use null for language/humanities or when none applies.',
    '- example_title + example_content + example_content_hi: a short worked example grounded in the material, or null if not applicable.',
    '- ONE practice MCQ SPECIFIC to THIS concept (never reuse the same question across cards): practice_question, practice_options (EXACTLY 4 distinct non-empty options, NO "A)"/"B)" prefixes — just the option text), practice_correct_index (0-3), practice_explanation (why the answer is correct).',
    '- difficulty: integer 1 (easy), 2 (medium), or 3 (hard).',
    `- bloom_level: one of ${VALID_BLOOM.join(', ')}.`,
    '- estimated_minutes: integer reading time (3-10).',
    '',
    'DECK-LEVEL REQUIREMENTS:',
    '- Across the cards use AT LEAST 2 different bloom_level values and AT LEAST 2 different difficulty values. Do not make every card "understand"/difficulty 2.',
    '- No two cards may share the same title, the same explanation, or the same practice_question.',
    '',
    'OUTPUT FORMAT: Return ONLY a single JSON object, no markdown fences, no commentary:',
    '{"cards":[{"title":"...","title_hi":"...","learning_objective":"...","learning_objective_hi":"...","explanation":"...","explanation_hi":"...","key_formula":null,"example_title":"...","example_content":"...","example_content_hi":"...","practice_question":"...","practice_options":["...","...","...","..."],"practice_correct_index":0,"practice_explanation":"...","difficulty":2,"bloom_level":"understand","estimated_minutes":5}]}',
  ].join('\n');
}

function buildUserMessage(chunks: RagChunk[]): string {
  const ctx = chunks
    .map((c, i) => {
      const meta = [c.topic, c.concept].filter(Boolean).join(' / ');
      return `[Chunk ${i + 1}${meta ? ` — ${meta}` : ''}]\n${cleanSourceText(c.chunk_text)}`;
    })
    .join('\n\n');
  return `NCERT reference material for this chapter:\n---\n${ctx}\n---\nGenerate the concept cards now, grounded strictly in the material above. Return only the JSON object.`;
}

// ─── OpenAI call (direct Chat Completions API, retry/backoff, model fallback) ─

async function callOpenAIDirect(
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
): Promise<{ ok: true; text: string; inputTokens: number; outputTokens: number; stopReason: string | null } | { ok: false; status: number; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(`${API_BASE_URL}/chat/completions`, {
      signal: controller.signal,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        // OpenAI's equivalent of Anthropic's `max_tokens` is also `max_tokens`
        // for the Chat Completions API (it caps COMPLETION tokens). gpt-4o /
        // gpt-4o-mini support up to 16,384 completion tokens.
        max_tokens: maxTokens,
        temperature: 0.3, // factual grounding — never above 0.7 (P12 hallucination guard)
        // JSON mode: guarantees the completion is a single parseable JSON object,
        // eliminating the markdown-fence / trailing-prose / mid-JSON-truncation
        // parse-failure class that plagued the dense-subject decks.
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const b = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: b.slice(0, 300) };
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null }; finish_reason?: string | null }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    // OpenAI signals truncation with finish_reason === 'length' (Anthropic used
    // stop_reason === 'max_tokens'). Map it to the same sentinel the generation
    // loop already guards on so the truncation path is unchanged.
    const finishReason = data.choices?.[0]?.finish_reason ?? null;
    const stopReason = finishReason === 'length' ? 'max_tokens' : finishReason;
    return {
      ok: true,
      text,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      stopReason,
    };
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: msg };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Call OpenAI with retry/backoff on 429/5xx and mini→full fallback. */
async function generateCards(
  systemPrompt: string,
  userMessage: string,
): Promise<{ ok: true; cards: GeneratedCard[]; inputTokens: number; outputTokens: number; model: string } | { ok: false; error: string }> {
  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  let lastError = 'unknown';
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      // OUTPUT BUDGET — root cause of the historical dense-subject failure.
      // A 6-card BILINGUAL deck is dominated by Devanagari output, which is far
      // more token-dense than Latin text (often ~1 token/char). Dense prose
      // subjects (social_studies, and grade 11/12) previously overflowed an
      // 8000-token ceiling mid-JSON.
      //
      // gpt-4o and gpt-4o-mini cap COMPLETION tokens at 16,384. We request
      // 16,000 — the practical ceiling — which empirically fits a full 6-card
      // bilingual deck with headroom. JSON mode additionally guarantees a
      // single parseable object, so the failure mode is now only a true
      // length-truncation (finish_reason='length'), still caught below.
      const MAX_OUTPUT_TOKENS = 16_000; // OpenAI gpt-4o* completion cap is 16,384
      const r = await callOpenAIDirect(model, systemPrompt, userMessage, MAX_OUTPUT_TOKENS);
      if (!r.ok) {
        lastError = `HTTP ${r.status}: ${r.error}`;
        // auth errors won't be fixed by retry or fallback
        if (r.status === 401 || r.status === 403) return { ok: false, error: lastError };
        // 429 / 5xx / network: backoff then retry
        const backoff = 2000 * Math.pow(2, attempt);
        console.error(`    retry in ${backoff}ms (${model}, attempt ${attempt + 1}): ${lastError}`);
        await sleep(backoff);
        continue;
      }
      // Truncation guard: if the model still hit the output ceiling the JSON is
      // truncated by definition — surface it distinctly (not a generic parse
      // failure) so dense grade 11/12 chapters are diagnosable, and retry.
      if (r.stopReason === 'max_tokens') {
        lastError = `output truncated at max_tokens (out=${r.outputTokens}/${MAX_OUTPUT_TOKENS}, len=${r.text.length}) — deck too large for budget`;
        console.error(`    truncated (${model}, attempt ${attempt + 1}): ${lastError}`);
        if (attempt < 2) { await sleep(1500); continue; }
        break;
      }
      const parsed = parseCards(r.text);
      if (parsed.length === 0) {
        lastError = `unparseable_or_empty_json (stop=${r.stopReason}, len=${r.text.length})`;
        console.error(`    parse failed (${model}, attempt ${attempt + 1}): ${lastError}`);
        // a parse failure is worth one retry on the same model
        if (attempt < 2) { await sleep(1500); continue; }
        break;
      }
      return { ok: true, cards: parsed, inputTokens: r.inputTokens, outputTokens: r.outputTokens, model };
    }
    console.error(`    falling back from ${model}`);
  }
  return { ok: false, error: lastError };
}

// ─── Parse + post-process ────────────────────────────────────────────────────

function stripOptionPrefix(opt: string): string {
  // strip leading "A) ", "A. ", "(A) ", "1) " etc — the renderer adds labels
  return opt.replace(/^\s*[(\[]?[A-Da-d1-4][)\].:]\s+/, '').trim();
}

function parseCards(raw: string): GeneratedCard[] {
  let txt = raw.trim();
  // strip markdown fences if present
  txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // extract the outermost JSON object
  const start = txt.indexOf('{');
  const end = txt.lastIndexOf('}');
  if (start === -1 || end === -1) return [];
  let obj: { cards?: unknown };
  try {
    obj = JSON.parse(txt.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!obj.cards || !Array.isArray(obj.cards)) return [];
  const out: GeneratedCard[] = [];
  for (const c of obj.cards as Array<Record<string, unknown>>) {
    const opts = Array.isArray(c.practice_options) ? (c.practice_options as unknown[]).map((o) => stripOptionPrefix(String(o ?? ''))) : [];
    out.push({
      title: String(c.title ?? '').trim(),
      title_hi: String(c.title_hi ?? '').trim(),
      learning_objective: String(c.learning_objective ?? '').trim(),
      learning_objective_hi: String(c.learning_objective_hi ?? '').trim(),
      explanation: cleanSourceText(String(c.explanation ?? '')),
      explanation_hi: cleanSourceText(String(c.explanation_hi ?? '')),
      key_formula: c.key_formula == null || String(c.key_formula).trim() === '' ? null : String(c.key_formula).trim(),
      example_title: c.example_title == null || String(c.example_title).trim() === '' ? null : String(c.example_title).trim(),
      example_content: c.example_content == null || String(c.example_content).trim() === '' ? null : cleanSourceText(String(c.example_content)),
      example_content_hi: c.example_content_hi == null || String(c.example_content_hi).trim() === '' ? null : cleanSourceText(String(c.example_content_hi)),
      practice_question: String(c.practice_question ?? '').trim(),
      practice_options: opts,
      practice_correct_index: Number.isInteger(c.practice_correct_index) ? (c.practice_correct_index as number) : -1,
      practice_explanation: String(c.practice_explanation ?? '').trim(),
      difficulty: Number.isInteger(c.difficulty) ? (c.difficulty as number) : 2,
      bloom_level: String(c.bloom_level ?? '').trim().toLowerCase(),
      estimated_minutes: Number.isInteger(c.estimated_minutes) ? (c.estimated_minutes as number) : 5,
    });
  }
  return out;
}

// ─── Validation (mirrors scripts/sql/validate-chapter-concepts.sql rubric) ───

const BAD_MARKERS = ['{{', '[BLANK]', 'TODO', 'FIXME'];

function validateCard(c: GeneratedCard): string[] {
  const errs: string[] = [];
  if (c.title.length < 3) errs.push('title<3');
  if (c.title_hi.length < 2) errs.push('title_hi missing (P7)');
  if (!c.learning_objective) errs.push('learning_objective missing');
  if (!c.learning_objective_hi) errs.push('learning_objective_hi missing (P7)');
  if (c.explanation.length < 120) errs.push(`explanation too short (${c.explanation.length}, need >=120)`);
  // Upper bound guards against raw page-dumps. The gating SQL rubric has no
  // upper bound (only floor 80 + avg >=150); 1200 catches dumps without
  // fighting genuinely rich prose (saves retry cost on the bulk run).
  if (c.explanation.length > 1200) errs.push(`explanation too long (${c.explanation.length})`);
  if (c.explanation_hi.length < 80) errs.push(`explanation_hi too short (${c.explanation_hi.length}, P7)`);
  for (const m of BAD_MARKERS) {
    if (c.explanation.includes(m) || c.explanation_hi.includes(m)) errs.push(`bad marker "${m}"`);
  }
  // term-list / stub detection: a "Key approach:" stub or comma-list with no sentence
  if (/key approach:/i.test(c.explanation)) errs.push('term-list/Key-approach stub');
  if (!/[.!?।]/.test(c.explanation)) errs.push('explanation has no sentence terminator');
  // explanation_hi must not be just the English copied in
  if (c.explanation_hi === c.explanation) errs.push('explanation_hi == explanation (P7)');
  if (!/[ऀ-ॿ]/.test(c.explanation_hi)) errs.push('explanation_hi has no Devanagari (P7)');
  if (!/[ऀ-ॿ]/.test(c.title_hi)) {
    // allow technical-term titles that are legitimately Latin (rare) — but warn-as-error for the pilot to be safe
    errs.push('title_hi has no Devanagari (P7)');
  }
  // MCQ (P6)
  const opts = c.practice_options;
  if (opts.length !== 4) errs.push(`practice_options != 4 (${opts.length})`);
  if (opts.some((o) => !o || o.trim().length === 0)) errs.push('empty practice option');
  if (new Set(opts.map((o) => o.trim().toLowerCase())).size !== opts.length) errs.push('non-distinct practice options');
  if (opts.some((o) => /^\s*[(\[]?[A-Da-d][)\].]\s/.test(o))) errs.push('option carries A)/B) prefix');
  if (c.practice_correct_index < 0 || c.practice_correct_index > 3) errs.push('practice_correct_index out of 0..3');
  if (!c.practice_question) errs.push('practice_question missing');
  if (!c.practice_explanation) errs.push('practice_explanation missing');
  // bloom / difficulty
  if (!VALID_BLOOM.includes(c.bloom_level)) errs.push(`invalid bloom_level "${c.bloom_level}"`);
  if (![1, 2, 3].includes(c.difficulty)) errs.push(`invalid difficulty ${c.difficulty}`);
  return errs;
}

function validateChapter(cards: GeneratedCard[]): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (cards.length < 3) reasons.push(`only ${cards.length} cards (<3)`);
  // per-card
  cards.forEach((c, i) => {
    const e = validateCard(c);
    if (e.length) reasons.push(`card ${i + 1}: ${e.join('; ')}`);
  });
  // duplicates
  const titles = cards.map((c) => c.title.trim().toLowerCase());
  if (new Set(titles).size !== titles.length) reasons.push('duplicate titles');
  const expls = cards.map((c) => c.explanation.trim().toLowerCase());
  if (new Set(expls).size !== expls.length) reasons.push('duplicate explanations');
  const pqs = cards.map((c) => c.practice_question.trim().toLowerCase()).filter(Boolean);
  if (new Set(pqs).size !== pqs.length) reasons.push('recycled practice MCQ');
  // spreads
  if (new Set(cards.map((c) => c.bloom_level)).size < 2) reasons.push('bloom_spread < 2');
  if (new Set(cards.map((c) => c.difficulty)).size < 2) reasons.push('difficulty_spread < 2');
  // avg explanation length
  const avg = cards.reduce((a, c) => a + c.explanation.length, 0) / Math.max(cards.length, 1);
  if (avg < 150) reasons.push(`avg explanation length ${Math.round(avg)} < 150`);
  return { pass: reasons.length === 0, reasons };
}

// ─── DB write (upsert + supersede pilot) ─────────────────────────────────────

async function deletePilotRows(grade: string, subject: string, chapterNumber: number): Promise<void> {
  // Remove hand-curated pilot rows so the LLM deck is the single source and the
  // unique key (grade,subject,chapter_number,concept_number) doesn't collide
  // across sources for the same chapter.
  await rest(
    `chapter_concepts?grade=eq.${grade}&subject=eq.${subject}&chapter_number=eq.${chapterNumber}&source=eq.${PILOT_SOURCE}`,
    { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
  );
}

async function upsertCards(
  grade: string,
  subject: string,
  chapterNumber: number,
  chapterId: string,
  chapterTitle: string | null,
  cards: GeneratedCard[],
  ragChunkIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const now = new Date().toISOString();
  const rows = cards.map((c, idx) => ({
    grade,
    subject,
    chapter_number: chapterNumber,
    chapter_id: chapterId,
    chapter_title: chapterTitle,
    concept_number: idx + 1,
    title: c.title,
    title_hi: c.title_hi,
    learning_objective: c.learning_objective,
    learning_objective_hi: c.learning_objective_hi,
    explanation: c.explanation,
    explanation_hi: c.explanation_hi,
    key_formula: c.key_formula,
    example_title: c.example_title,
    example_content: c.example_content,
    example_content_hi: c.example_content_hi,
    practice_question: c.practice_question,
    practice_options: c.practice_options,
    practice_correct_index: c.practice_correct_index,
    practice_explanation: c.practice_explanation,
    difficulty: c.difficulty,
    bloom_level: c.bloom_level,
    estimated_minutes: c.estimated_minutes,
    rag_chunk_ids: ragChunkIds,
    is_active: true,
    source: NEW_SOURCE,
    updated_at: now,
  }));
  const r = await rest(
    `chapter_concepts?on_conflict=grade,subject,chapter_number,concept_number`,
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    },
  );
  if (r.status >= 200 && r.status < 300) return { ok: true };
  return { ok: false, error: `HTTP ${r.status}: ${r.body.slice(0, 300)}` };
}

// ─── Checkpoint log ──────────────────────────────────────────────────────────

function checkpointPath(grade: string): string {
  return `scripts/.checkpoints/chapter-concepts-${grade}.log`;
}

function logCheckpoint(grade: string, entry: Record<string, unknown> | ChapterResult): void {
  const p = checkpointPath(grade);
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

// ─── Main per-chapter pipeline ───────────────────────────────────────────────

async function processChapter(args: Args, subject: string, chapterNumber: number, chapterTitle: string): Promise<ChapterResult> {
  const base: ChapterResult = {
    subject, chapter_number: chapterNumber, status: 'failed_generation',
    cards_inserted: 0, reasons: [], inputTokens: 0, outputTokens: 0, model: '',
  };

  // Resume: skip if a rubric-passing deck already exists
  if (!args.force && (await existingDeckPasses(args.grade, subject, chapterNumber))) {
    base.status = 'skipped_existing';
    base.reasons.push('rubric-passing ncert_2025_llm deck already present');
    return base;
  }

  // Resolve FK + retrieve chunks
  const chapterRow = await getChapterId(args.grade, subject, chapterNumber);
  if (!chapterRow) {
    base.status = 'failed_db';
    base.reasons.push('no chapters row (FK unresolvable)');
    return base;
  }
  const chunks = await getChapterChunks(args.grade, subject, chapterNumber);
  if (chunks.length === 0) {
    base.status = 'skipped_no_chunks';
    base.reasons.push('no rag chunks');
    return base;
  }

  const systemPrompt = buildSystemPrompt(args.grade, subject, chapterTitle || chapterRow.title || `Chapter ${chapterNumber}`);
  const userMessage = buildUserMessage(chunks);

  // Generate (with one full retry on validation failure)
  let lastReasons: string[] = [];
  for (let genAttempt = 0; genAttempt < 2; genAttempt++) {
    const gen = await generateCards(systemPrompt, userMessage);
    if (!gen.ok) {
      base.status = 'failed_generation';
      base.reasons.push(`generation failed: ${gen.error}`);
      return base;
    }
    base.inputTokens += gen.inputTokens;
    base.outputTokens += gen.outputTokens;
    base.model = gen.model;

    const v = validateChapter(gen.cards);
    if (!v.pass) {
      lastReasons = v.reasons;
      console.error(`    validation failed (attempt ${genAttempt + 1}): ${v.reasons.slice(0, 4).join(' | ')}${v.reasons.length > 4 ? ' …' : ''}`);
      if (genAttempt === 0) { await sleep(1000); continue; }
      base.status = 'failed_validation';
      base.reasons = lastReasons;
      return base;
    }

    // PASS — write
    if (args.dryRun) {
      base.status = 'inserted';
      base.cards_inserted = gen.cards.length;
      base.reasons.push('DRY RUN — not written');
      console.error(`    DRY RUN: ${gen.cards.length} valid cards (would insert)`);
      console.error(JSON.stringify(gen.cards.map((c) => ({ title: c.title, title_hi: c.title_hi, bloom: c.bloom_level, diff: c.difficulty, expl_len: c.explanation.length })), null, 2));
      return base;
    }

    await deletePilotRows(args.grade, subject, chapterNumber);
    const ins = await upsertCards(
      args.grade, subject, chapterNumber, chapterRow.id, chapterTitle || chapterRow.title,
      gen.cards, chunks.map((c) => c.chunk_id),
    );
    if (!ins.ok) {
      base.status = 'failed_db';
      base.reasons.push(`upsert failed: ${ins.error}`);
      return base;
    }
    base.status = 'inserted';
    base.cards_inserted = gen.cards.length;
    return base;
  }
  base.status = 'failed_validation';
  base.reasons = lastReasons;
  return base;
}

// ─── Orchestration ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
  if (!OPENAI_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(2); }

  console.error(`\n=== Chapter-concepts generation — grade ${args.grade} — model ${PRIMARY_MODEL} (fallback ${FALLBACK_MODEL}) ===`);
  console.error(`Subjects: ${args.subjects.join(', ')}${args.chapter ? ` | chapter ${args.chapter}` : ''}${args.dryRun ? ' | DRY RUN' : ''}${args.force ? ' | FORCE' : ''}\n`);

  const results: ChapterResult[] = [];
  let totalIn = 0;
  let totalOut = 0;

  for (const subject of args.subjects) {
    let chapters: Array<{ chapter_number: number; chapter_title: string }>;
    try {
      chapters = await getInScopeChapters(args.grade, subject);
    } catch (e) {
      console.error(`  ${subject}: enumeration failed — ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (args.chapter) chapters = chapters.filter((c) => c.chapter_number === args.chapter);
    console.error(`\n--- ${subject}: ${chapters.length} in-scope chapter(s) with chunks ---`);

    for (const ch of chapters) {
      process.stderr.write(`  ${subject} ch${ch.chapter_number} "${ch.chapter_title}" ... `);
      let res: ChapterResult;
      try {
        res = await processChapter(args, subject, ch.chapter_number, ch.chapter_title);
      } catch (e) {
        res = { subject, chapter_number: ch.chapter_number, status: 'failed_generation', cards_inserted: 0, reasons: [`exception: ${e instanceof Error ? e.message : String(e)}`], inputTokens: 0, outputTokens: 0, model: '' };
      }
      results.push(res);
      totalIn += res.inputTokens;
      totalOut += res.outputTokens;
      console.error(`${res.status}${res.cards_inserted ? ` (${res.cards_inserted} cards)` : ''}${res.reasons.length && res.status !== 'inserted' ? ` — ${res.reasons[0]}` : ''}`);
      logCheckpoint(args.grade, res);
      // gentle pacing between chapters (rate-limit friendliness)
      await sleep(800);
    }
  }

  // ─── Summary ───
  const inserted = results.filter((r) => r.status === 'inserted');
  const skippedExisting = results.filter((r) => r.status === 'skipped_existing');
  const skippedNoChunks = results.filter((r) => r.status === 'skipped_no_chunks');
  const failedVal = results.filter((r) => r.status === 'failed_validation');
  const failedGen = results.filter((r) => r.status === 'failed_generation');
  const failedDb = results.filter((r) => r.status === 'failed_db');
  const cards = inserted.reduce((a, r) => a + r.cards_inserted, 0);

  const costMini = (totalIn / 1e6) * COST_PER_MTOK[PRIMARY_MODEL].in + (totalOut / 1e6) * COST_PER_MTOK[PRIMARY_MODEL].out;

  console.error('\n========================= SUMMARY =========================');
  console.error(`Chapters processed:        ${results.length}`);
  console.error(`  inserted (generated):    ${inserted.length}  (${cards} cards)`);
  console.error(`  skipped (already passed): ${skippedExisting.length}`);
  console.error(`  skipped (no chunks):     ${skippedNoChunks.length}`);
  console.error(`  failed validation:       ${failedVal.length}`);
  console.error(`  failed generation:       ${failedGen.length}`);
  console.error(`  failed db:               ${failedDb.length}`);
  console.error(`Tokens:  input=${totalIn}  output=${totalOut}  (~$${costMini.toFixed(3)} at gpt-4o-mini rates)`);
  if (failedVal.length) {
    console.error('\nValidation failures (chapter — first reasons):');
    for (const f of failedVal) console.error(`  ${f.subject} ch${f.chapter_number}: ${f.reasons.slice(0, 3).join(' | ')}`);
  }
  if (failedGen.length || failedDb.length) {
    console.error('\nOther failures:');
    for (const f of [...failedGen, ...failedDb]) console.error(`  ${f.subject} ch${f.chapter_number} (${f.status}): ${f.reasons[0]}`);
  }
  console.error(`\nCheckpoint log: ${checkpointPath(args.grade)}`);
  console.error('===========================================================\n');
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.stack : String(e));
  process.exit(1);
});
