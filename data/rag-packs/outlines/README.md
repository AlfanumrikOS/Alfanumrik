# Goal-Adaptive Phase 4.7 — Content Generation Outlines

Curated outlines for `scripts/generate-rag-pack.ts` (Track A of Phase 4.6).
Each file targets a chapter where current Foxy retrieval coverage is
typically thin and where board / JEE / NEET relevance is high.

| Outline | Subject | Grade | Chapter | Items | Planned chunks |
|---|---|---|---|---|---|
| `class06-math-algebra-v0.json` | math | 6 | Algebra | 3 | 9 |
| `class08-math-mensuration-v0.json` | math | 8 | Mensuration | 3 | 9 |
| `class09-math-surface-volumes-v0.json` | math | 9 | Surface Areas and Volumes | 4 | 12 |
| `class09-science-sound-v0.json` | science | 9 | Sound | 3 | 9 |
| `class10-math-surface-volumes-v0.json` | math | 10 | Surface Areas and Volumes (combined solids) | 3 | 12 |
| `class10-science-electricity-v0.json` | science | 10 | Electricity | 3 | 12 |
| `class11-chemistry-bonding-v0.json` | chemistry | 11 | Chemical Bonding (VSEPR / hybridisation / MOT) | 3 | 12 |
| `class11-physics-rotation-v0.json` | physics | 11 | System of Particles and Rotational Motion | 4 | 12 |
| `class12-biology-inheritance-v0.json` | biology | 12 | Principles of Inheritance and Variation | 4 | 12 |
| `class12-physics-emi-v0.json` | physics | 12 | Electromagnetic Induction | 4 | 12 |
| **Totals** | — | — | — | **34** | **111** |

## How these were chosen

Selected from the high-leverage cross-section of:
1. **Board exam frequency** (chapters appearing on CBSE marking schemes
   in 4 of last 5 years).
2. **JEE/NEET relevance** (chapters in the standard PYQ pool for those
   exams).
3. **Common student difficulty** (chapters where Foxy support tickets
   and quiz failure analytics show repeat misconceptions).
4. **Existing NCERT thinness** (chapters whose NCERT text is shorter
   than the testable concept density warrants).

## How to use

```bash
# Generate one outline at a time (recommended for first runs)
npx tsx scripts/generate-rag-pack.ts \
  --outline data/rag-packs/outlines/class10-science-electricity-v0.json \
  --out data/rag-packs/generated-class10-science-electricity-v0.jsonl

# Or batch all 10 at once (after verifying the first run)
bash scripts/generate-all-outlines.sh

# Manual review pass (REQUIRED per P12), then ingest
npx tsx scripts/ingest-rag-pack.ts \
  --pack data/rag-packs/generated-class10-science-electricity-v0.jsonl
```

See `docs/runbooks/generate-rag-pack.md` for the full Track A workflow,
including the manual-review requirement and the cost guidance (~110
chunks across all 10 outlines = ~220 Claude calls = single-digit USD on
Haiku).

## Versioning

- Each outline is versioned (`v0`, `v1`, ...). Bump the suffix on any
  edit to the outline so the generated pack also carries the new
  version (the `pack_version` is copied from the outline header).
- Generated packs ship with `provenance: "generated"` and
  `source: "curated"` (per `scripts/generate-rag-pack.ts`).
- Selective retraction:
  ```sql
  DELETE FROM public.rag_content_chunks
   WHERE pack_id = 'generated-class10-science-electricity-v0';
  ```
