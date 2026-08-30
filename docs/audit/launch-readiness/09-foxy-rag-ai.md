# 09 — Foxy AI Tutor, RAG & AI Security

**Audit date:** 2026-08-29
**Evidence source:** Foxy agent (completed), RAG agent (completed)

---

## 1. Foxy AI Tutor

### Architecture
- **Primary model:** OpenAI gpt-4o-mini (cost-optimized for student interactions)
- **Fallback model:** OpenAI gpt-4o (complex queries), Claude (secondary fallback)
- **Safety layers (defense-in-depth):**
  1. **FOX-2 (input guard):** Pre-screens student input for prompt injection, off-topic queries, harmful content
  2. **FOX-1 (output screen):** Post-screens AI response for safety, accuracy, age-appropriateness
  3. **Safety rails:** System prompt enforces NCERT curriculum scope, grade-appropriate language, no personal advice
  4. **Safeguarding system:** Detects child welfare disclosures (abuse, self-harm) and routes to designated safeguarding lead
  5. **Grounding scope:** Responses grounded in NCERT curriculum via RAG — no unsourced claims

### Security Properties
- **No mastery/XP/grade writes:** Foxy cannot modify `concept_mastery`, `xp_transactions`, `students`, or any assessment table — it is read-only by design
- **No grade spoofing:** Student grade is resolved server-side from DB, not from student input
- **Session isolation:** Each Foxy session is bound to (student_id, session_id) — no cross-student leakage
- **Rate limiting:** Per-student, per-minute rate limits enforced at API layer
- **Token budget:** Per-session token cap prevents abuse

### Findings
| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| P2-12 | P2 | Message retrieval query in Foxy chat history does not include `.eq('student_id', studentId)` — defense-in-depth gap; RLS provides primary protection | OPEN |
| P2-13 | P2 | Foxy `error.tsx` error boundary leaks raw error messages to students — should show generic "Foxy is taking a break" | OPEN |
| P3-05 | P3 | FOX-2 prompt injection detection uses regex patterns — sophisticated attacks may bypass | Low risk given defense-in-depth |
| P3-06 | P3 | Foxy session timeout is fixed at 30 min — no adaptive timeout based on student activity | Minor UX |

### Verdict: **GO** — Defense-in-depth is validated; no P0/P1 findings

---

## 2. RAG Pipeline

### Architecture
- **Embeddings:** Voyage AI `voyage-3` model, 1024-dimensional vectors
- **Corpus:** 27,778 chunks in `rag_content_chunks` table (grown from ~16k)
- **Retrieval:** Hybrid vector similarity + full-text search (FTS), fused via Reciprocal Rank Fusion (RRF)
- **Serving:** `grounded-answer` Edge Function retrieves relevant chunks, constructs grounded prompt, calls LLM
- **NCERT alignment:** Chunks tagged with subject, grade, chapter, topic for curriculum-aligned retrieval

### Eval Harness
- **Last run:** 2026-08-23
- **Metrics computed:** recall@10, faithfulness
- **Metrics NOT computed:** recall@3, correctness, abstention
- **Results:**
  - recall@10: **66.1%** (bar: 95%) — **FAIL**
  - faithfulness: **~40-47%** (bar: 95%) — **FAIL**

### Findings
| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| P1-02 | P1 | RAG retrieval regression: recall@10 66.1% vs 95% bar; faithfulness ~40-47% vs 95% bar; 3/5 mandated metrics not computed | **BLOCKING** |
| P1-07 | P1 | `match_rag_chunks_ncert` RPC has EXECUTE grant to authenticated — exposes raw vector search to any logged-in user; all legitimate callers use service_role | OPEN |
| P2-21 | P2 | `quality_score` field in ingestion pipeline is always set to 1.0 — the filter `WHERE quality_score > threshold` is a no-op | OPEN |
| P2-22 | P2 | Embedding cache in `rag_embedding_cache` has no TTL or eviction — grows unbounded | OPEN |
| P2-23 | P2 | No chunk overlap in ingestion — boundary information is lost between adjacent chunks | OPEN |
| P2-24 | P2 | No deduplication in ingestion — re-ingesting the same content creates duplicate chunks | OPEN |
| P2-25 | P2 | RRF fusion weights are hardcoded (vector: 0.6, FTS: 0.4) — not tuned to curriculum domain | OPEN |
| P3-07 | P3 | No A/B testing framework for retrieval parameter tuning | Enhancement |
| P3-08 | P3 | Citation format in grounded answers is inconsistent (some cite chapter, some cite page, some cite nothing) | UX |

### Root-Cause Hypothesis
Corpus growth from ~16k to ~27k chunks without retuning retrieval parameters has diluted precision. The quality_score no-op (P2-21) means no quality filtering was applied to new chunks. Combined with no deduplication (P2-24), the retrieval set likely contains low-quality and duplicate chunks that push relevant results below the top-10 cutoff.

### Verdict: **NO-GO** — P1-02 is independently blocking

---

## 3. AI Security Summary

| Dimension | Status | Notes |
|-----------|--------|-------|
| Prompt injection defense | **PASS** | FOX-2 input guard + system prompt hardening |
| Output safety screening | **PASS** | FOX-1 post-screen + age-appropriate language enforcement |
| Data exfiltration prevention | **PASS** | Foxy has no write access to student data; responses grounded in NCERT only |
| Child safeguarding | **PASS** | Welfare disclosure detection with routing to safeguarding lead |
| Model fallback | **PASS** | gpt-4o-mini → gpt-4o → Claude chain; graceful degradation |
| Cost control | **PASS** | Per-session token caps and per-student rate limits |
| RAG corpus integrity | **CONDITIONAL** | verify-question-bank cron is broken (P0-01); quality_score is a no-op (P2-21) |

---

## 4. Gate Verdicts

| Gate | Verdict | Basis |
|------|---------|-------|
| 16 — Foxy AI safety | **GO** | Defense-in-depth validated |
| 17 — RAG retrieval quality | **NO-GO** | recall@10 66.1% vs 95% bar |
