// eval/rag/harness/build-dossier.ts
//
// OFFLINE (no DB). Merges the PROVISIONAL labels in ncert-golden-v1.json with
// the chunk_text snippets in binding-candidates.raw.json + a hand-authored
// one-line rationale per labeled chunk + thin-item flags, into the reviewer
// dossier eval/rag/reports/binding-candidates.json. The assessment agent reads
// THIS to validate labels without re-querying the DB.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface RawCand { id: string; chapter_number: number | null; chapter_title: string | null; topic: string | null; content_layer: string | null; bloom_level: string | null; snippet: string }
interface RawItem { id: string; query: string; query_type: string; grade: string; subject: string; chapter_number: number | null; target: { chapter_name: string; concept: string; relevance_2_description: string; multi_hop_required_concepts?: string[] }; candidates: RawCand[] }

const harnessDir = __dirname;
const raw = JSON.parse(readFileSync(resolve(harnessDir, '..', 'reports', 'binding-candidates.raw.json'), 'utf-8')) as { host: string; corpus_total_rows: number; items: RawItem[] };
const golden = JSON.parse(readFileSync(resolve(harnessDir, '..', 'golden', 'ncert-golden-v1.json'), 'utf-8')) as { items: Array<{ id: string; query: string; grade: string; subject: string; chapter_number: number | null; relevant_chunks: Array<{ chunk_id: string; relevance: number; off_grade_scope?: boolean }> }> };

// Map golden item id -> seed item id (golden ids renamed g7-/g10- etc; align by ordinal suffix).
// We instead align by query text which is identical across both files.
const rawByQuery = new Map<string, RawItem>();
for (const r of raw.items) rawByQuery.set(r.query, r);
const candById = new Map<string, RawCand>();
for (const r of raw.items) for (const c of r.candidates) if (!candById.has(c.id)) candById.set(c.id, c);

// Per-chunk one-line rationale (operator). Keyed by chunk_id.
const RATIONALE: Record<string, string> = {
  // 001 / 002 / 005 photosynthesis
  'a0d9c7ab-2227-4bd2-b3b3-86a383eab541': 'Direct: "water, sunlight, carbon dioxide from the air, and chlorophyll are necessary to carry out photosynthesis" — names CO2 intake AND defines the process. Primary for 001/002/005.',
  'ee7c40ba-64c1-4916-bb97-06dde5d77a58': 'Direct "In a Nutshell": "Plants use carbon dioxide and water in the presence of sunlight and chlorophyll to produce glucose and oxygen ... known as photosynthesis." Primary for 001/002/005.',
  'fe51a392-8e3c-48cf-bb91-4f3ed6228aad': 'Supporting: lists CO2 among the requirements in an activity table; partial, not a clean statement.',
  // 003 / 004 respiration
  'c8d87dda-87e1-4e0b-ae8e-f6225ab7fae9': 'Direct for 003: "we breathe in (inhale) and breathe out (exhale) air continuously to obtain oxygen and release carbon dioxide" — basis for faster breathing during exertion. THIN for 004 (see flag).',
  '27e06107-f5ee-4fe0-9f17-b53ad778259d': 'Gas-exchange mechanism (alveoli, O2 in / CO2 out) — supports 003 and is the respiration half of multi-hop 005.',
  '81705754-0bea-4783-9192-b8722dd54331': 'Supporting nutshell on respiration/breathing as a life process.',
  // 006 / 010 integers
  'fa42df90-5741-497c-bd63-66ec7a81cb7d': 'Direct sign rule: "product is negative if one of them is positive and the other is negative" (and division quotient sign). Primary for 006/010.',
  '550d28aa-2415-451c-b385-19f6396e77b7': 'Supporting: product sign unchanged on swapping multiplier/multiplicand; reinforces the sign rule.',
  '7b975d2c-086d-4c0c-8535-9f6a8d12de09': 'Supporting: negative-multiplier patterns in integer multiplication.',
  '18740fbb-94b3-489f-920b-ece69e0b3ea8': 'Direct definition: "Additive inverse of an integer a is represented as – a ... additive inverse of 18 is – 18" — primary for 007.',
  'e42cd036-6253-4bb9-9a5b-4bd72a87e5b4': 'Direct: division-by-fraction = multiply by reciprocal (1 ÷ 2/3 = 3/2) — the "dividing by <1 increases magnitude" half of multi-hop 010.',
  'ba525851-f555-4935-bf61-40b394bee23c': 'Direct for 008: "the product is less than both the numbers" when multiplying proper fractions; primary.',
  '91df5094-be27-43d5-b163-30fd7f18f39a': 'Partial for 009: decimals/data-handling chapter context; NCERT 2025 g7 "Data Handling/mean" coverage is thin (see flag).',
  // 011 / 012 / 013 / 014 / 015 g10 science
  '1bec9b4f-c158-41a3-9505-f30e990d2423': 'Direct for 011: "electric current is expressed by a unit called ampere (A) ... One ampere is ... one coulomb of charge per second." Primary.',
  'd265d025-7693-4c22-bc39-0c1c05c23a5e': 'Direct for 012: V–I graph, "potential difference across the wire increases linearly – this is Ohm\'s law." Primary.',
  '6eec371c-af5d-4b12-b243-fc45c11acc00': 'Supporting for 012/015: applies Ohm\'s law V=IR to series components.',
  '2bb0179c-a49a-4f97-a96c-711349ea3289': 'Direct for 013: bulb glows for acids (current flows) but not glucose/alcohol → acids release ions in aqueous solution. Primary.',
  '360bf051-74fa-4c19-b745-5458bea0b984': 'Supporting for 013: distilled water has no ions so does not conduct; reinforces the ion-conduction concept.',
  'b8971ee8-ee2b-4aaa-b86e-3260aa27e9b6': 'Direct for 014: "heart has different chambers to prevent the oxygen-rich blood from mixing with the blood containing carbon dioxide." Primary; also the circulation half of 015.',
  'e2ee4187-0cbf-4335-9f6c-b54668400126': 'Direct for 015: "in a series combination of resistors the current is the same" — the series-circuit half of the comparison. Primary.',
  // 016-020 g10 social_studies (Nationalism in India)
  'f8bf88f4-d6b0-4ba7-aef5-4599847795b9': 'Direct for 016: "The Congress under the leadership of Mahatma Gandhi" channelled the freedom struggle. Primary.',
  '4f5c3586-7e2f-44a8-8506-13b5662b3e5c': 'Direct for 016: "Mahatma Gandhi decided to withdraw the Non-Cooperation Movement" — confirms Gandhi led the NCM. Primary.',
  'd51a178d-8e6b-4462-b270-03ff1e6ccc74': 'Supporting for 016/020: Non-Cooperation-Khilafat Movement began Jan 1921, social groups participating.',
  '81fc463c-6bc4-4e4d-b7e5-b8606e0f6e3c': 'Direct for 017: "Groundwater is an example of renewable resources. These resources are replenished by nature." Primary.',
  '39820f3f-8444-4cbe-84d1-42905be56eef': 'Direct for 018/020: "the war created a new economic and political situation ... huge increase in defence expenditure ... financed by war loans and increasing taxes." Primary.',
  'e2a1ddaf-e86c-44bd-943c-9eb74092d5d4': 'Direct for 019: "the idea of satyagraha emphasised the power of truth ... physical force was not necessary ... through non-violence." Primary.',
  'dfeb68cf-cbb9-480e-a0f9-eda4299552db': 'Direct for 020: peasants vs talukdars/landlords demanding exorbitant rents/begar — the land/resource-pressure half of the multi-hop. Primary.',
  '5d24bc66-bc71-437d-9830-bb9fb1e31a75': 'Supporting for 020: tribal peasants, forest-access grievances feeding into the movement.',
  // 021-025 g11 physics
  '6b7c4ff5-cb7f-4b8b-83a1-a914b7823b73': 'THIN for 021: page-54 force/momentum text near where the newton is introduced, but the explicit "1 N = 1 kg m s^-2" sentence is split across page chunks (see flag).',
  '8a986433-1750-4b1c-9df8-80d78f9315b1': 'Direct for 022/025: "force not only depends on the change in momentum, but also on how fast the change is brought about" — the rate-of-change-of-momentum (F=ma) statement. Primary.',
  'acfa1d36-e258-4961-868c-fd79e153c88e': 'Supporting for 022: "the second law of motion ... F ... net external force ... a ... acceleration"; reinforces F=ma applicability.',
  '791576c9-df73-475a-98f3-96d704261658': 'Direct for 023: "force due to earth\'s gravity decreases with distance ... inverse square of the distance from the centre" → g ∝ 1/r². Primary; supporting for 025.',
  '919aec41-af93-49f8-8262-b1f304ac938c': 'Supporting for 023: exercise statement "acceleration due to gravity ... with increasing altitude" — partial.',
  '0e3f70fa-d057-4682-9a4a-9eba607c291c': 'Direct for 024: Galileo/first-law — "the ball would continue to move with a constant velocity ... state of rest and uniform linear motion" = inertia of motion. Primary.',
  '8e6734e6-12e0-4a6e-b90e-a8f79c486a79': 'Supporting for 024: first-law inference that net force is zero for an unaccelerated body.',
  '606a26d4-0dd0-4768-aa17-5a45770a71f3': 'Direct for 025: derives g = GM_E/R_E^2 from F=mg and gravitation — shows mass cancels (mass-independent g). Primary.',
  // 026-030 g11 history_sr (French Revolution — NOT in corpus; medieval-Europe best-effort)
  'c02051c9-0743-409c-aad5-ed7232a2888d': 'BEST-EFFORT for 026/030: mentions "till 1789" but in the context of the medieval Three Orders / Estates-General, NOT the French Revolution. NOT a faithful relevance=2 (see flag).',
  '76717ed1-7ed4-4057-8a5b-b3b1e8485a7e': 'BEST-EFFORT for 027: "The New Monarchy" + taxation/aristocracy — adjacent to "Old Regime" themes but medieval/early-modern, not Ancien Régime France. NOT faithful (see flag).',
  'd9a08f61-dd0c-4b39-8834-8fd5d69fe018': 'BEST-EFFORT for 028: "The Third Order: Peasants, Free and Unfree" — medieval feudal third order, NOT the French Revolution\'s third estate. NOT faithful (see flag).',
  '346c0a37-4aed-45be-8a5e-fe03b9d23c8a': 'BEST-EFFORT for 029/030: names "French philosopher Jean-Jacques Rousseau" but in a "noble savage" context, not Revolution causation. NOT faithful (see flag).',
};

// Thin / unbindable flags for the assessment agent.
const THIN_FLAGS: Record<string, string> = {
  'g7-sci-respiration-conceptual-004': 'NCERT 2025 Grade 7 "Curiosity" does NOT cover anaerobic respiration / lactic acid / muscle cramps (zero chunk_text matches for "anaerobic"/"lactic"/"cramp"). No faithful relevance=2 exists. Provisionally labeled the closest respiration chunk at relevance=1 only. ASSESSMENT: consider replacing this query (it targets out-of-grade content) or moving it to a grade where anaerobic respiration is taught (g10 Life Processes).',
  'g7-math-data-factual-009': 'NCERT 2025 Grade 7 "Ganita Prakash" arithmetic-mean / Data Handling coverage is thin in the indexed corpus — no clean "mean = sum ÷ count" statement chunk surfaced; best available is a decimals/number chapter. Labeled relevance=1 only. ASSESSMENT: verify whether a mean-formula chunk exists under a different chapter, else down-weight or replace.',
  'g11-phy-motion-factual-021': 'The explicit "1 newton = 1 kg m s^-2" definition sentence is split across page chunks in ch4; no single chunk cleanly states the SI unit of force. Labeled the nearest force/momentum chunk relevance=1. ASSESSMENT: locate the exact newton-unit chunk (likely a sub-300-char fragment) and promote to relevance=2.',
  'g11-hist-revolution-factual-026': 'CORPUS GAP: the French Revolution chapter is NOT present in g11/history_sr (the indexed kehs10x chapters are NCERT "Themes in World History" Part 1 — medieval/early-modern: Three Orders=feudalism, Changing Traditions=Renaissance, Confrontation of Cultures, Towards/Paths to Modernisation). "1789" appears only incidentally (Estates-General not summoned till 1789, in the medieval Three Orders chapter). No faithful relevance=2 exists.',
  'g11-hist-revolution-definition-027': 'CORPUS GAP (French Revolution absent). "Old Regime/Ancien Régime France" not in corpus; best-effort medieval "New Monarchy" chunk is topically adjacent only. No faithful relevance=2.',
  'g11-hist-revolution-conceptual-028': 'CORPUS GAP (French Revolution absent). "The Third Order" in corpus = MEDIEVAL feudal peasants, NOT the French Revolution third estate. No faithful relevance=2.',
  'g11-hist-revolution-conceptual-029': 'CORPUS GAP (French Revolution absent). Rousseau appears only in a "noble savage" / cultural-perception context, not Revolution causation. No faithful relevance=2.',
  'g11-hist-revolution-multihop-030': 'CORPUS GAP (French Revolution absent). Neither required concept (economic crisis of 1789 / Enlightenment undermining absolute monarchy) has a faithful relevance=2 chunk. ASSESSMENT: the entire g11/history_sr cell may need re-targeting to a chapter that IS in the corpus (e.g. The Three Orders / Changing Cultural Traditions / Paths to Modernisation), or the French Revolution content must be ingested before this cell can be measured.',
};

const out = golden.items.map((g) => {
  const r = rawByQuery.get(g.query);
  const considered = g.relevant_chunks.map((rc) => {
    const cand = candById.get(rc.chunk_id);
    return {
      chunk_id: rc.chunk_id,
      provisional_relevance: rc.relevance,
      off_grade_scope: rc.off_grade_scope ?? false,
      chapter_number: cand?.chapter_number ?? null,
      chapter_title: cand?.chapter_title ?? null,
      content_layer: cand?.content_layer ?? null,
      bloom_level: cand?.bloom_level ?? null,
      snippet: cand?.snippet ?? '(snippet unavailable in raw pool — present in golden)',
      rationale: RATIONALE[rc.chunk_id] ?? '(no rationale recorded)',
    };
  });
  return {
    id: g.id,
    query: g.query,
    grade: g.grade,
    subject: g.subject,
    chapter_number: g.chapter_number,
    candidate_pool_size: r?.candidates.length ?? 0,
    target: r?.target ?? null,
    thin_flag: THIN_FLAGS[g.id] ?? null,
    considered,
  };
});

const dossier = {
  generated_at: new Date().toISOString(),
  stage: 'task-10-step-A-provisional',
  host: raw.host,
  corpus_source: 'ncert_2025',
  corpus_total_rows: raw.corpus_total_rows,
  label_source_used: 'assessment',
  label_status: 'PROVISIONAL — operator-curated, spot_checked=false on every chunk; awaiting assessment validation (Task 10 step B).',
  note: 'Labels assigned A3 candidate-pool-independently from chunk_text against each seed target.relevance_2_description, NOT from retrieve() output. Snippets are <=300 chars. The full candidate pool per item is in binding-candidates.raw.json.',
  thin_items: Object.keys(THIN_FLAGS),
  items: out,
};

const outPath = resolve(harnessDir, '..', 'reports', 'binding-candidates.json');
writeFileSync(outPath, `${JSON.stringify(dossier, null, 2)}\n`, 'utf-8');
console.log(`[dossier] wrote ${outPath}`);
console.log(`[dossier] items: ${out.length}, thin-flagged: ${dossier.thin_items.length}`);
