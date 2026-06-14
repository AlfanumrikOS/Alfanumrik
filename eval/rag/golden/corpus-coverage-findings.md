# NCERT corpus-coverage findings — B1 golden-set binding (Task 10 step B)

**Author:** assessment (academic-correctness / retrieval-quality owner, A3)
**Date:** 2026-06-14
**Corpus:** live `rag_content_chunks`, `source='ncert_2025'`, `is_active=true`,
`language='en'` (project `shktyoxqhundlvkiwguu`, 16,006 rows).
**Method:** read-only; the ONLY table queried is `public.rag_content_chunks`
(NCERT curriculum — no PII). Labels assigned A3-independently from `chunk_text`.

This is strategic IP. It tells us (a) the indexed corpus is a **different NCERT
edition** than our seed assumptions, (b) **which curriculum cells have real
content gaps**, and (c) the discipline sub-project D (curriculum auto-scale)
must follow when it widens the golden set.

---

## 1. Structural drift: old NCERT vs NCERT-2025

The indexed corpus is the **NCERT 2025 edition**, which is heavily renumbered and
retitled vs the older editions our seed queries assumed. `chunk_text` is
authoritative; `chapter_title`/`chapter_number` metadata is sometimes garbled
(e.g. a g10 social-studies chapter is stored as `"P O W E R - S H A R I N G"`,
and the g11 history chapters carry PDF-filename titles like `"Arts XI ·
kehs104.pdf"`). Concrete drift confirmed during binding:

| Cell | Seed assumed | NCERT-2025 reality (verified in corpus) |
|---|---|---|
| g7 science — photosynthesis | ch1 "Nutrition in Plants" | **ch10 "Life Processes in Plants"** |
| g7 science — respiration | ch10 "Respiration in Organisms" | **ch9 "Life Processes in Animals"** (respiration folded into a combined life-processes chapter; the standalone "Respiration in Organisms" chapter is gone) |
| g7 math — integers | ch1 "Integers" | **ch10 "Operations with Integers"** |
| g7 math — fractions | ch2 "Fractions and Decimals" | **ch8 "Working with Fractions"** |
| g7 math — mean/data | ch3 "Data Handling" | **ch13 "Connecting the Dots"** (data handling is renamed; the arithmetic-mean formula lives here) |
| g10 science — electricity | ch12 "Electricity" | **ch11 "Electricity"** |
| g10 science — life processes | ch6 "Life Processes" | **ch5 "Life Processes"** |
| g11 physics — laws of motion | ch5 "Laws of Motion" | **ch4 "Laws of Motion"** |
| g11 physics — gravitation | ch8 "Gravitation" | **ch7 "Gravitation"** |
| g11 history — (see §2) | "The French Revolution" | **Themes in World History Part 1** (medieval/early-modern only) |

**Implication for sub-project D:** never trust a static chapter-number map across
editions. Bind by `chunk_text` content match against a curriculum target, then
record the *observed* chapter number. The seed query + its `target` (what a
relevance=2 chunk must contain) is the durable asset; chapter numbers are not.

---

## 2. Confirmed content GAPS (curriculum cells the corpus cannot currently answer)

### 2a. g11 / history_sr — the French Revolution chapter is ABSENT (hard gap)

The indexed g11/history_sr corpus is **"Themes in World History Part 1"** —
212 chunks across these themes:

- ch103 "Changing Traditions" (section opener; contains the feudalism definition)
- ch104 "The Three Orders" (feudalism, vassalage, manorial estate, the clergy /
  nobility / peasants-and-serfs orders, knights, medieval towns & guilds)
- ch105 "Changing Cultural Traditions" (the Renaissance, humanism, Italian towns,
  printing, the new concept of the individual)
- ch106 "Towards Modernisation" (nationalism, popular sovereignty intro)
- ch107 "Paths to Modernisation" (Japan, modernisation)

The **French Revolution is not present at all.** "1789" surfaces only
incidentally inside the medieval Three Orders chapter ("the Estates-General was
not summoned again ... till 1789"), and "Rousseau" appears only in a "noble
savage" cultural-perception aside — neither is a faithful answer to a French
Revolution query. The provisional binding had labelled these medieval chunks
rel=1 against French-Revolution targets; **those labels were academically wrong
and were removed.**

**Resolution:** the entire g11/history_sr cell (items 026-030) was **re-targeted**
to in-corpus "Themes in World History Part 1" content (Three Orders / feudalism +
Renaissance / humanism), preserving the cell's query-type matrix (1 factual /
1 definition / 2 conceptual / 1 multi_hop with full rel=2 coverage). A query about
absent content can never be measured, so re-targeting — not fabrication — is the
only measurement-integrity-preserving fix.

**Action for the platform:** if French Revolution coverage at g11 is desired
(it is a standard CBSE Themes-in-World-History theme), the chapter must be
**ingested** before any French Revolution query can be evaluated.

### 2b. g7 / science — anaerobic respiration / lactic acid is OUT-OF-GRADE (soft gap)

NCERT-2025 g7 "Curiosity" teaches respiration as breathing + aerobic gas exchange
(O2 in / CO2 out, the glucose+O2 → CO2+water+energy word equation). It does **not**
cover **anaerobic respiration, lactic acid, or exercise-induced muscle cramps**
(zero `chunk_text` matches for "anaerobic" / "lactic" / "cramp" in the g7 cell).
That content is introduced later (g10 Life Processes). The seed item 004 ("muscle
cramps after vigorous exercise") therefore targeted out-of-grade content.

**Resolution:** item 004 was **re-targeted** to an in-grade, genuinely-taught
conceptual respiration concept — "How do we know that exhaled air contains more
CO2 than inhaled air?" — which is answered cleanly by the ch9 lime-water activity
chunk (rel=2). The cell's query-type matrix is unchanged.

### 2c. (resolved, NOT a gap) g7 / math — arithmetic mean

The provisional binding flagged the mean as "thin" (best chunk was a decimals
chapter). On deeper inspection the mean **is** taught — in **ch13 "Connecting the
Dots"** (the renamed Data Handling chapter), which states the formula verbatim:
*"The Average or Arithmetic Mean (A.M.) ... Mean = Sum of all the values in the
data / Number of values in the data."* No re-target of the query was needed —
only the chapter pointer (3 → 13) and the bound chunk were corrected to the real
rel=2 chunk. **This was a binding miss, not a corpus gap.**

### 2d. (resolved, NOT a gap) g11 / physics — SI unit of force

The provisional binding flagged the newton definition as "split across page
chunks". In fact the single ch4 "Laws of Motion" chunk
(`6b7c4ff5-...`) **does** state it cleanly: *"In SI unit force is one that causes
an acceleration of 1 m s-2 to a mass of 1 kg. This unit is known as newton :
1 N = 1 kg m s-2."* The sentence sat deep in the chunk, past the 300-char
provisional snippet, so it was under-rated rel=1. **Corrected to rel=2.** Same
chunk also faithfully states Newton's second law verbatim, so it is the rel=2 for
item 022 (definition) as well. Binding miss, not a corpus gap.

**Lesson:** snippet-truncation (300 chars) caused two false "thin" flags
(2c, 2d). Sub-project D should label from full `chunk_text`, not snippets, for
fact/definition items where the answer can be buried mid-chunk.

---

## 3. Headline for the CEO

- The **retrieval test set is now honest and fully measurable**: all 30 golden
  queries bind to content that genuinely exists in the live corpus; all 47
  chunk-ids resolve; every multi-hop has its complete primary-evidence set.
- **One real curriculum gap of strategic note:** the **g11 French Revolution
  chapter is not in the indexed corpus** — a visible hole if a senior-secondary
  humanities student asks Foxy about it. Worth a content-ingestion decision.
- **One out-of-grade authoring error caught:** anaerobic-respiration at grade 7
  (it's a grade-10 topic) — the kind of grade-scope error sub-project D's
  curriculum auto-scale must guard against programmatically.
- **Two binding misses (not gaps)** were corrected (mean formula, newton unit) —
  evidence that snippet-only labelling under-counts buried facts; the harness
  should label from full chunk text.
- **Process win:** the seed-query + curriculum-target asset survived a whole-
  edition corpus change (old NCERT → NCERT-2025) — we re-anchored to new chapters
  without throwing away the intellectual work. That is exactly the durability the
  query/target split was designed for.
