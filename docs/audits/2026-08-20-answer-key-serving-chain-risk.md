# Answer-key serving chain — are we preventing the regression, or living in it?

**Verdict: WE ARE ALREADY LIVING IN IT.** Four of the five question-serving RPC definitions deployed
to production `shktyoxqhundlvkiwguu` **right now** emit `correct_answer_index` in their outbound
payload, and **none** of the five applies a server-side P6 filter — `public.question_bank_p6_valid`
does not exist in the production database at all. `20260820120000` is not a regression we are about
to introduce; its `select_quiz_questions_rag` body is **byte-for-byte identical** to what is already
deployed. It is a re-assertion of the status quo. The only thing it would "regress" is
`20260814000023`, a fix that has never been applied.

**Date:** 2026-08-20
**Author:** investigation only — read-only SELECT against production. No migration, DDL, DML, or
grant was executed. No file other than this one was created or modified.
**Production project:** `shktyoxqhundlvkiwguu`
**Predecessor:** `docs/audits/pending-migration-order-risk.md`

---

## Per-RPC live state

All rows below come from `pg_get_functiondef(oid)` over `pg_proc` joined to `pg_namespace`, executed
read-only against production. Overloads were enumerated from `pg_proc`, not assumed —
`get_quiz_questions` has exactly **two**; the other three have exactly **one** each. Five definitions
total.

| RPC (live signature) | Answer key | P6 filter | `prosecdef` | `search_path` |
|---|---|---|---|---|
| `select_quiz_questions_rag(uuid,text,text,integer,integer,text,text[],vector)` | **EMITS-ANSWER-KEY** | **NO-P6-FILTER** | `true` | pinned `search_path=public` |
| `select_quiz_questions_v2(uuid,text,text,integer,integer,text,text[])` | **EMITS-ANSWER-KEY** | **NO-P6-FILTER** | `true` | pinned `search_path=public` |
| `get_quiz_questions(text,text,integer,integer)` — 4-arg | **EMITS-ANSWER-KEY** | **NO-P6-FILTER** | `true` | pinned `search_path=public` |
| `get_quiz_questions(text,text,integer,integer,integer)` — 5-arg | **EMITS-ANSWER-KEY** | **NO-P6-FILTER** | `true` | pinned `search_path=public` |
| `start_quiz_session(uuid,uuid[])` | **DOES-NOT-EMIT** | **NO-P6-FILTER** | `true` | pinned `search_path=public` |

Enumeration and screening query:

```sql
SELECT n.nspname, p.proname, p.oid::regprocedure::text AS signature,
       p.prosecdef, p.proconfig, md5(p.prosrc) AS src_md5,
       strpos(p.prosrc, '''correct_answer_index''') AS quoted_key_pos,
       (p.prosrc ILIKE '%question_bank_p6_valid%') AS calls_p6
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('select_quiz_questions_rag','select_quiz_questions_v2',
                    'get_quiz_questions','start_quiz_session',
                    'question_bank_p6_valid','check_formative_answer');
```

`calls_p6` is `false` on every row. `question_bank_p6_valid` and `check_formative_answer` returned
**zero rows** — neither function exists in production. That single fact settles item 2 for all five
RPCs without needing to read a body: there is nothing to call.

### 1. `select_quiz_questions_rag` — EMITS-ANSWER-KEY / NO-P6-FILTER

**Payload construction (a leak, not a predicate).** The final `jsonb_agg(jsonb_build_object(...))`
that populates the returned `v_result`:

```sql
  SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'question_text', question_text, 'question_hi', question_hi,
    'question_type', COALESCE(question_type,'mcq'), 'question_type_v2', COALESCE(question_type_v2,'mcq'),
    'options', options, 'correct_answer_index', correct_answer_index,
    'explanation', explanation, 'explanation_hi', explanation_hi, 'hint', hint,
```

`'correct_answer_index', correct_answer_index` is an explicit key/value member of the object that is
`RETURN`ed to the caller. **Category: outbound payload.**

Fed by the `candidate_pool` CTE select list, also outbound:

```sql
      qb.options, qb.correct_answer_index, qb.explanation, qb.explanation_hi, qb.hint,
```

**Category: outbound payload** (projected, carried through `numbered` → `selected` → the
`jsonb_build_object` above).

**No predicate use of the column exists in this body**, so there is no predicate/payload ambiguity to
resolve here — every occurrence is a projection.

**P6:** absent. Grep for `question_bank_p6_valid` over `prosrc` returns nothing. The four repeated
filter blocks (pool count, seen count, 80% reset `DELETE`, `candidate_pool`) gate only on
`is_active`, `deleted_at IS NULL`, `content_status = 'published'` and
`verification_state NOT IN ('failed','failed_fix_in_flight','failed_unfixable')`.

**`prosecdef` = true; `proconfig` = `{search_path=public}`** — SECURITY DEFINER with search_path
pinned.

### 2. `select_quiz_questions_v2` — EMITS-ANSWER-KEY / NO-P6-FILTER

```sql
    'options', sel.options, 'correct_answer_index', sel.correct_answer_index,
```

and in its `candidate_pool` CTE:

```sql
           qb.options, qb.correct_answer_index, qb.explanation, qb.explanation_hi, qb.hint,
```

**Category: outbound payload**, both. No predicate use. No `question_bank_p6_valid`.
`prosecdef` = true, `proconfig` = `{search_path=public}`.

Note: this RPC's ownership guard is **unconditional** —
`IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid())
THEN RAISE EXCEPTION 'Access denied'` — so an unauthenticated caller is rejected. That is *not* true
of the other three (see "Grant posture" below).

### 3–4. `get_quiz_questions` — both overloads EMIT-ANSWER-KEY / NO-P6-FILTER

Both build their result as `jsonb_agg(q)` over an inline subquery, so **every column named in the
subquery's SELECT list becomes a JSON key in the returned payload**.

4-arg (`text,text,integer,integer`):

```sql
      SELECT id, question_text, question_hi, options, correct_answer_index,
             explanation, explanation_hi, difficulty, bloom_level, topic_id
        FROM question_bank
```

5-arg (`text,text,integer,integer,integer`):

```sql
      SELECT id, question_text, question_hi, question_type, options, correct_answer_index,
             explanation, explanation_hi, hint, difficulty, bloom_level, chapter_number
        FROM question_bank
```

**Category: outbound payload (RETURNS-clause SELECT list)** in both. No predicate use of the column.
No `question_bank_p6_valid`. Both `prosecdef` = true, `proconfig` = `{search_path=public}`, both
declared `STABLE`.

> **Detection note that matters for Task 2.** For these two overloads the screening column
> `strpos(prosrc, '''correct_answer_index''')` returned **0** — the column appears as a bare
> identifier, never as a quoted string literal. `20260814000023`'s own section-7a self-check uses
> exactly that `strpos(prosrc, '''correct_answer_index''')` test. Applied as written, **7a would pass
> vacuously for both `get_quiz_questions` overloads even if they still leaked the key.** Any
> replacement check must not inherit this quoted-literal assumption.

### 5. `start_quiz_session` — DOES-NOT-EMIT / NO-P6-FILTER

The only reads of the column are **internal**, into a snapshot row:

```sql
    SELECT id, question_text, question_hi, options, correct_answer_index, ...
      INTO v_question_meta
```
```sql
    v_correct_idx := COALESCE(v_question_meta.correct_answer_index, 0);
```
```sql
      options_snapshot, correct_answer_index_snapshot, student_id,
```

The outbound object deliberately omits it, and says so in-body:

```sql
        'chapter_number', v_question_meta.chapter_number
        -- DO NOT include correct_answer_index here. That's the bug class
        -- this migration closes.
```

**Category: internal use / persisted snapshot — NOT a leak.** This is the one RPC already in the
intended posture, and it got there without `20260814000023`.

**P6:** absent. The row filter is only `WHERE id = v_qid AND is_active = true`; the sole skip is
`IF v_question_meta IS NULL THEN CONTINUE`. `COALESCE(v_question_meta.correct_answer_index, 0)`
means a row with a **NULL** answer key is silently snapshotted as "correct answer = option 0" rather
than skipped — the exact NULL-coalescing defect `20260814000023`'s test comments describe, live
today. `prosecdef` = true, `proconfig` = `{search_path=public}`.

---

## Ledger state — confirmed by query, not inherited

```sql
SELECT v.version AS looked_for,
       EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m
               WHERE m.version = v.version) AS in_ledger
FROM (VALUES ('20260814000014'),('20260814000023'),('20260814000024'),
             ('20260820120000'),('20260802100000'),
             ('20260820143726'),('20260820152908')) AS v(version);
```

| Version | In ledger |
|---|---|
| `20260802100000` | **true** |
| `20260814000014` | **true** |
| `20260814000023` | **false** — ABSENT, as expected |
| `20260814000024` | **false** — ABSENT, as expected |
| `20260820120000` | **false** — ABSENT, as expected |
| `20260820143726` | true (ledger head −1) |
| `20260820152908` | true (ledger head) |

The three migrations named in the task are genuinely absent. Ledger head is `20260820152908`.

### Which migration the live `select_quiz_questions_rag` body actually is

**It is `20260814000014_tiered_verification_serving_and_truthful_picker.sql`, byte-for-byte —
and therefore also `20260820120000`, byte-for-byte, because those two files carry identical
function bodies.**

Method: `md5(p.prosrc)` from `pg_proc` compared against the exact dollar-quoted body extracted from
each candidate file (`prosrc` is precisely the text between the `$function$` delimiters, so the
leading and trailing newlines are included; CRs stripped for the Windows checkout).

| Candidate | Body md5 | Matches live? |
|---|---|---|
| live `pg_proc.prosrc` | `8affe2e1854e01ef545ca5689af7e1a5` | — |
| `20260802100000_select_quiz_questions_rag_verification_gate.sql` (L177–423) | `6146ad3504ab0ee65666d98d4776c8eb` | no |
| `20260814000014_...truthful_picker.sql` (L426–672, from `origin/main`) | `8affe2e1854e01ef545ca5689af7e1a5` | **YES** |
| `20260814000023_keyless_question_serving_and_server_side_p6.sql` (L290–522) | `f8b0b64b6669858970e2f831c0b44fe7` | no |
| `20260820120000_reassert_...staging_drift.sql` (L107–353, from `origin/main`) | `8affe2e1854e01ef545ca5689af7e1a5` | **YES** |

`diff` of the two matching bodies: **identical, zero lines**. Corroborated independently by content —
the live body carries the three-state exclusion
`verification_state NOT IN ('failed','failed_fix_in_flight','failed_unfixable')`, the E0/E1
verification ladder, the `ff_grounded_ai_enforced_pairs` lookup, the `verified_rank` ranking column
and the `ops_events` `quiz_verification_gap` telemetry block — all introduced by `20260814000014` and
none present in `20260802100000`.

**Consequence:** applying `20260820120000` to production today is a **literal no-op on the function
body**. Its staging-drift hypothesis is *disproved for production*; it says nothing about staging,
which I have no credentials to query.

---

## The live posture is worse than the payload question alone

Two read-only findings that change how urgent this is. Both are catalog reads; **no anonymous or
authenticated request was sent to the API to demonstrate exploitability**, and that limit is stated
plainly in "What I do not know".

**1. `anon` holds EXECUTE on all five RPCs — via `PUBLIC`, which is why the existing REVOKE never
took effect.**

```sql
SELECT p.oid::regprocedure::text, p.proacl::text[] ... -- pg_proc
```

Every one of the five returns the same ACL shape:

```
=X/postgres | postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
```

The leading `=X/postgres` is a grant to **PUBLIC** (empty grantee). `has_function_privilege('anon', …,
'EXECUTE')` is `true` for all five. `anon` also holds `USAGE` on schema `public`.

`20260515000002` issued `REVOKE EXECUTE … FROM anon` for `select_quiz_questions_rag`, and
`20260820120000:370` re-issues that same statement verbatim. **Revoking from a role does not remove a
PUBLIC grant.** There is no `anon=X` entry to revoke, so both the original and the re-assertion are
no-ops. `20260820120000`'s header claim that it "covers the full grant posture, not just the function
body" is therefore **not true in effect** — the grant it re-asserts has never been in force.

Combined with the bodies: `get_quiz_questions` (both overloads) has **no ownership guard of any
kind**, and `select_quiz_questions_rag`'s guard is
`IF auth.uid() IS NOT NULL AND NOT EXISTS (…)` — it **short-circuits to "allowed" when
`auth.uid()` is NULL**, i.e. for an anonymous caller. All are SECURITY DEFINER, so they run as the
owner and bypass RLS. Only `select_quiz_questions_v2` guards unconditionally.

**2. `authenticated` can read the answer key directly off the table, no RPC involved.**

```sql
SELECT policyname, roles::text, cmd, qual FROM pg_policies
WHERE schemaname='public' AND tablename='question_bank';
```

| policyname | roles | cmd | qual |
|---|---|---|---|
| `question_bank_authenticated_read` | `{authenticated}` | SELECT | `true` |
| `question_bank_content_reporter_read` | `{content_reporter}` | SELECT | `true` |

RLS is enabled (`relrowsecurity = true`, not forced). There is **no `anon` policy** — so anon cannot
read the table directly; that path is closed. But any logged-in student holds an unqualified
`USING (true)` SELECT over every column of `question_bank`, `correct_answer_index` included.

This corrects a stale claim in the predecessor audit, which cited a
`questions_read_all … USING (true)` policy: that policy name no longer exists; the permissive read is
now scoped to `{authenticated}` and `{content_reporter}`.

**Why this matters for the decision:** making the RPCs keyless does not by itself make the answer key
unreachable by a logged-in student. `20260814000023`'s own test header acknowledges this — it refers
to a "drafted column ACL" as the complementary control. That column ACL is **not** in production.
Landing `0023` alone closes the RPC path and the anon path; it does **not** close the authenticated
direct-table path.

---

## Task 2 — the test gap

**File:** `apps/host/src/__tests__/security/keyless-question-serving.test.ts` (present in this
worktree, 344 lines).

**Line 35, with its immediate surroundings (33–35):**

```ts
const REPO_ROOT = resolve(__dirname, '../../../../..');
const MIGRATIONS = resolve(REPO_ROOT, 'supabase/migrations');
const MIGRATION = '20260814000023_keyless_question_serving_and_server_side_p6.sql';
```

`MIGRATION` is referenced exactly once, at **line 187**, inside the
`describe('step A — the P6 answer-key check moved server-side')` block:

```ts
    const sql = readFileSync(resolve(MIGRATIONS, MIGRATION), 'utf8');
```

Every SQL assertion in the file is a substring/regex match against that one `sql` string.

### Why it scans one filename — what the code and comments actually say

There **is** a stated rationale, at lines 28–31, and it explains the *static* choice, not the
*single-file* choice:

> `No SQL is executed here (no DB in CI) — the migration-chain assertions are a static scan. The
> TypeScript half IS executed against the real gate.`

So the author documented "no DB in CI, therefore scan source". The comment calls these "the
migration-chain assertions" while the code reads exactly one file and never enumerates the chain —
`readdirSync` is imported (line 2) but is used only by `walk()` (line 64) to traverse **TypeScript**
source roots, never `supabase/migrations`. Grep for `chain`, `latest`, `version order`, `sort(` finds
no chain-resolution logic anywhere in the file. **There is no comment anywhere acknowledging that a
later migration could redefine the same function.**

On "was it written before the chain contained a later redefinition": the evidence is consistent with
that but does not prove intent. `20260814000023` is dated 2026-08-14; `20260820120000` is dated
2026-08-20 and lives only on `origin/main` while the test and `0023` live only on this branch — the
two were authored on branches that never saw each other. The test's framing throughout is
"this migration does two things that only make sense together" (lines 11–26), i.e. it is a
**per-migration content review encoded as a test**, not a whole-chain invariant. That is what it
does correctly; the gap is that its *name* and its `describe` titles promise a property of the
deployed system.

### A second, larger gap the predecessor audit did not identify

The predecessor audit said the test "would stay green while the deployed function re-emits the answer
key" because it scans one file. **That is true, but understates it.** Enumerating every assertion in
the file:

- `describe('guard — no student-path .select() names correct_answer_index')` (L123) — scans
  **TypeScript** files under `packages/lib/src`, `packages/ui/src`, `apps/host/src/app` for
  `.from('question_bank').select(...)` projections. Nothing to do with SQL.
- `describe('step A — the P6 answer-key check moved server-side')` (L186) — six `it`s, all against
  the `0023` file text: the `question_bank_p6_valid` predicate body (NULL guard ordering, the P6
  rules, `IMMUTABLE`/not-SECURITY-DEFINER), `start_quiz_session`'s gate, a client-side check, and a
  "no scoring function is redefined" check.
- `describe('step A — the TS gate is not weakened by keylessServing')` (L268) — executes
  `validateQuestion` in TypeScript.
- `describe('the serving callers opt in explicitly …')` (L318) — TypeScript.

Every occurrence of `correct_answer_index` in the file is at lines 14, 18 (prose), 123–158 and
171–180 (TypeScript `.select()` / comparison guards), 199–204 (`p_correct_answer_index`, the
predicate's parameter), 239 (`correct_answer_index_snapshot`), and 277–287 (`validateQuestion`
inputs).

**There is no assertion anywhere in this file that `select_quiz_questions_rag`,
`select_quiz_questions_v2`, or either `get_quiz_questions` overload omits `correct_answer_index`
from its outbound payload — not even in the one file it does read.** Step B's SQL half is pinned
only inside `20260814000023`'s own `DO $$` section-7a block, which runs **at apply time and never
again** — and which, per the detection note above, would pass vacuously for both `get_quiz_questions`
overloads anyway because it searches for a **quoted** `'correct_answer_index'` literal that those two
bodies never contain.

So the test would stay green not merely against a later clobber, but against the situation that is
live in production today.

### Proposed replacement check (NOT written — description only)

A `describe` block that resolves the **last definition of each serving RPC across the whole
`supabase/migrations/**` chain in version order** and asserts on that resolved text.

**Enumerate and order.** `readdirSync('supabase/migrations')`, keep `*.sql`, skip `_legacy/` and any
`_archive/`, extract the leading `^(\d{14})` version, sort **numerically by that version** (not
lexicographically over the full filename — equal-length numeric prefixes make these agree today, but
the extracted-version sort is the one that is actually correct). Read each file with the file's own
existing `\r`-tolerant handling (the file already documents at lines 71–76 that CRLF checkouts broke
an earlier comment-stripping regex — the same hazard applies to any multi-line SQL regex here).

**Parse definition blocks.** Scan each file for
`/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+((?:"?public"?\s*\.\s*)?"?(\w+)"?)\s*\(/gi`, then from each
match consume the parameter list by **paren-depth counting** (not a lazy `\)` — default values like
`ARRAY['mcq'::text]` and `vector DEFAULT NULL::vector` contain no parens today, but `p_count * 3`
style defaults and `numeric(10,2)` types would break a naive match). Then locate the body by finding
the opening dollar-quote tag with `/AS\s+(\$[A-Za-z_]*\$)/` and reading to the **next occurrence of
that same captured tag** — `0023` uses `$function$` for most functions but `$$` for
`start_quiz_session` (file lines 868/1006), so the tag must be captured per-definition, never
hardcoded.

**Key by identity, reduce to last-wins.** Build the key from
`(schema ?? 'public', lowercased function name, normalized argument type list)`. Normalization must
strip parameter *names* and defaults down to the type list, and canonicalize the quoting styles that
genuinely coexist in this chain — `"public"."start_quiz_session"("p_student_id" "uuid",
"p_question_ids" "uuid"[])` in `0023` versus
`public.select_quiz_questions_rag(p_student_id uuid, …)` elsewhere — plus `int`/`integer` and
`varchar`/`character varying`. Fold the ordered list into a `Map`, overwriting on each hit, so the
map holds the **last** definition per signature. Assert against those map entries only.

**Distinguish payload from predicate.** This is the load-bearing part, and a bare
`body.includes('correct_answer_index')` would be wrong in both directions — it would flag
`start_quiz_session` (which is correct today) and would have to be suppressed, and the suppression
would then hide a real leak.

Classify each occurrence by its syntactic position:

- **Payload — a quoted JSON member.** `/'correct_answer_index'\s*,/` appearing inside a
  `jsonb_build_object(`/`json_build_object(` argument list. Locate the enclosing builder call by
  paren-depth from the nearest preceding `jsonb_build_object(`.
- **Payload — a bare column in a returned SELECT list.** The `get_quiz_questions` shape: the column
  named between `SELECT` and the matching `FROM` of a subquery whose result is `jsonb_agg`'d or
  which is the function's `RETURN QUERY` / `RETURNS TABLE` source. Detect by taking the text span
  from a `SELECT` keyword to its depth-matching `FROM` and testing whether `correct_answer_index`
  appears in that span as a whole-word identifier.
- **Predicate — NOT a leak.** The occurrence sits inside a `WHERE`/`AND`/`ON`/`HAVING` span, or is an
  argument to `question_bank_p6_valid(`, or matches `/correct_answer_index\s*(BETWEEN|IS|=|<|>|<=|>=|<>|!=)/`.
- **Internal — NOT a leak.** Assignment (`:=`), `INTO` target, `INSERT` column list, or a
  `_snapshot`-suffixed identifier. Require whole-word matching so
  `correct_answer_index_snapshot` never counts as `correct_answer_index`.

**Assertions.** For the resolved-last definition of `select_quiz_questions_rag`,
`select_quiz_questions_v2`, and **both** `get_quiz_questions` overloads: zero payload-category
occurrences, and at least one `question_bank_p6_valid(` call. For `start_quiz_session`: zero payload
occurrences, at least one `question_bank_p6_valid(` call, and `correct_answer_index_snapshot` still
present (P1 — the snapshot is what scoring grades against). Plus a **census assertion**: the set of
serving-RPC signatures the scan resolved must equal a hardcoded expected set, so that a rename, a new
overload, or a parse failure surfaces as a red test rather than as silently-zero coverage — the same
failure mode that makes a `strpos`-based check pass vacuously.

**Known false-positive / false-negative risks in this approach.**

- **`EXECUTE format(...)` / dynamic DDL.** A function created inside a `DO $$` block or via
  `EXECUTE format('CREATE OR REPLACE FUNCTION …')` is invisible to a static `CREATE OR REPLACE`
  scan — a false negative. Mitigation: additionally fail the test if any migration file contains
  `EXECUTE` immediately followed by a string containing `CREATE OR REPLACE FUNCTION`, so the blind
  spot is announced rather than silent. None exists in the chain today; this guards the future.
- **Nested dollar-quoting.** A function body containing an inner `$$`-quoted string inside an outer
  `$function$` body would terminate the body scan early. The per-definition captured-tag approach
  handles the tags actually present, but arbitrary nesting is not fully solvable by regex.
- **Bodies split across files, or `ALTER FUNCTION`.** The last-wins reduction assumes each definition
  is complete in one `CREATE OR REPLACE`. A migration that only `ALTER FUNCTION … SET search_path`
  or that drops-and-recreates via a different statement form would not register.
- **A `DROP FUNCTION` with no successor** would leave a stale last-definition in the map — the map
  should be cleared for a signature on a matching `DROP FUNCTION`, or the census assertion will
  mis-report.
- **Comment text.** SQL `--` comments quoting the removed line (`0023` has several, and
  `20260820120000` quotes source line ranges in prose) would produce false positives. Strip `--`
  line comments and `/* */` blocks before classifying — and strip them *after* locating dollar-quoted
  bodies, since `--` inside a string literal is not a comment.
- **The deepest limitation, which no static scan removes:** this asserts what the **chain** says, not
  what is **deployed**. That is precisely the gap this audit found — the chain and production
  disagree today (`0023` is on disk, unapplied). A static test would have gone green on `0023`'s
  content while production emitted the key. Closing that needs a live-DB assertion over
  `pg_get_functiondef` in the integration-tests job, not another source scan. The static version is
  worth having as a cheap guard, but it should be labelled as chain-conformance, not as a production
  guarantee.

---

## Task 3 — recommendation

### The tradeoff

`20260820120000` carries two things:

1. **A `select_quiz_questions_rag` re-assertion** whose hypothesis this audit **disproves for
   production**: the deployed body is byte-identical to `20260814000014`, so applying it changes
   nothing. The hypothesis was about **staging**, which I could not query — so it is disproved where
   I could look and untested where the migration actually aimed.
2. **A `REVOKE EXECUTE … FROM anon`** that is a **no-op against a PUBLIC grant** (see "Grant
   posture"). It does not fix the anon exposure it appears to address.

Against `20260814000023` it is a clobber — but `0023` is unapplied, so today that clobber is
hypothetical. Meanwhile the thing `0023` was written to fix **is live**.

### Recommendation: a third option — **neither amend nor revert `20260820120000`; separate the two concerns and re-time the fix above it**

Concretely:

**(a) Leave `20260820120000` in the chain, but strike its `REVOKE … FROM anon` line (370) and
correct its header.** That single line is the only part of the file that is *misleading* rather than
merely inert. It documents a grant posture that has never been in force and would lead the next
reader to believe anon is excluded. Replace it with either a correct
`REVOKE EXECUTE … FROM PUBLIC;` **plus** an explicit `GRANT EXECUTE … TO authenticated, service_role;`
(so the intended callers keep working) — or, if that grant change is out of scope for a
"defensive re-assertion" file, delete the line and record the PUBLIC-grant finding as its own
migration. **Do not silently keep it.** *What is lost:* nothing functional; the file becomes an
honest no-op body re-assertion. Its staging hypothesis remains untested, which is acceptable — its
own header already says a no-op is a valid outcome.

**(b) Re-issue `20260814000023`'s substance at a version number ABOVE `20260820120000`,** rebased so
it does not revert `20260814000014`. This is the predecessor audit's option (a), and the live
evidence now makes it the clear choice rather than one of three. The rebase is small and fully
specified by a diff of the live body against `0023`'s — the only differences that matter are:

- **Must keep (live, from `20260814000014`) —** `0023` currently reverts this in four places and it
  must not:
  ```
  LIVE : AND qb.verification_state NOT IN ('failed','failed_fix_in_flight','failed_unfixable')
  0023 : AND qb.verification_state != 'failed'
  ```
- **Must take (from `0023`) —** the P6 filter added to the same four predicate blocks plus the
  verified-pool count:
  ```
  AND public.question_bank_p6_valid(
        qb.question_text, qb.options, qb.correct_answer_index, …)
  ```
- **Must take (from `0023`) —** removal of `'correct_answer_index', correct_answer_index` from the
  `jsonb_build_object`, and of `qb.correct_answer_index` from the `candidate_pool` select list.

**(c) Fix the section-7a self-check before re-issuing.** As written it tests
`strpos(prosrc, '''correct_answer_index''')`, which is **0 for both `get_quiz_questions` overloads**
in production — it would pass vacuously on exactly the two functions with the weakest guards. It
needs a whole-word `prosrc ~ '\mcorrect_answer_index\M'` test with the snapshot identifier excluded,
or per-function expected values.

**(d) Treat the anon/PUBLIC EXECUTE finding as its own P0-shaped item, not a rider.** Two of the four
leaking RPCs are callable by `anon` with **no effective ownership guard**
(`get_quiz_questions` has none; `select_quiz_questions_rag`'s short-circuits on
`auth.uid() IS NULL`), while being SECURITY DEFINER and therefore RLS-exempt. This is independent of
the keyless work and should not wait on it.

**(e) Do not treat keyless RPCs as closing the answer-key exposure.** `question_bank_authenticated_read`
grants `authenticated` `USING (true)` SELECT over all columns. A logged-in student can read
`correct_answer_index` directly. The "drafted column ACL" the test header refers to is not in
production. Scope this explicitly so the next audit does not record "keyless — done".

### What is lost under the alternatives I am not recommending

- **Amending `20260820120000`'s body** (folding `0023`'s keyless payload + P6 into it): loses nothing
  technically and is a legitimate variant of (b). I prefer a separate later migration because
  `20260820120000` is on `origin/main` with a header that documents a *falsifiable no-op*; turning it
  into a behaviour change invalidates its own reasoning and its CI-interpretation caveat, and makes
  the git history claim it did something it did not.
- **Reverting `20260820120000` outright:** loses the staging-drift probe entirely. Since the
  production body already matches, the only remaining value of the file is the *staging* test — and
  the three failing assertions in
  `apps/host/src/__tests__/migrations/select-quiz-questions-rag-verification-gate.test.ts` are still
  unexplained. Reverting discards the one cheap experiment anyone has proposed for them without
  substituting another. It also loses the file's genuinely useful documented caveat about the
  `staging-db-push` concurrency group guaranteeing exclusion but not ordering.

### Ordering note

Whatever is chosen, the re-issued fix must sort **above `20260820152908`** (the current ledger head),
not merely above `20260820120000` — otherwise it inherits the same apply-after-lower-version problem
the predecessor audit documents for all five pending files.

---

## What I do NOT know

- **Staging.** I have no staging credentials. Every statement here is about production
  `shktyoxqhundlvkiwguu`. Whether staging's `select_quiz_questions_rag` matches its ledger — the
  actual hypothesis `20260820120000` was written to test — is **untested by this audit**.
- **Whether the anon path is reachable end-to-end over HTTPS.** I established from the catalog that
  `anon` holds `USAGE` on `public` and EXECUTE via PUBLIC on all five RPCs, and that two of them lack
  an effective guard. I did **not** send an anonymous request to `/rest/v1/rpc/...` to confirm —
  that would be exploiting production, outside a read-only investigation. Someone should confirm it
  in a controlled way before sizing the incident.
- **Why the three verification-gate assertions fail in CI.** Production is running exactly the
  definition those tests expect, which makes a production-side drift explanation unavailable. The
  cause is in staging, in the fixtures, or in job ordering — unresolved.
- **Whether the four leaking RPCs are actually called on live student paths, and at what volume.** I
  read definitions and grants, not call sites or logs. The severity of the payload leak depends on
  which of these the app actually invokes; `20260814000023`'s own header calls
  `select_quiz_questions_rag` the primary serving RPC, but I did not verify that against the
  application code or production traffic in this investigation.
- **Whether `20260814000024`'s absence matters here.** It was confirmed absent from the ledger as
  asked, but it touches `subscription_plans` only and is unrelated to the serving chain.

---

## Reproduction

```sql
-- 1. Enumerate overloads + screen (returns 5 rows; p6_valid/check_formative_answer return none)
SELECT n.nspname, p.proname, p.oid::regprocedure::text, p.prosecdef, p.proconfig,
       md5(p.prosrc), strpos(p.prosrc, '''correct_answer_index'''),
       (p.prosrc ILIKE '%question_bank_p6_valid%')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
  ('select_quiz_questions_rag','select_quiz_questions_v2','get_quiz_questions',
   'start_quiz_session','question_bank_p6_valid','check_formative_answer');

-- 2. Full bodies
SELECT pg_get_functiondef('public.select_quiz_questions_rag(uuid,text,text,integer,integer,text,text[],vector)'::regprocedure);
SELECT pg_get_functiondef('public.select_quiz_questions_v2(uuid,text,text,integer,integer,text,text[])'::regprocedure);
SELECT pg_get_functiondef('public.get_quiz_questions(text,text,integer,integer)'::regprocedure);
SELECT pg_get_functiondef('public.get_quiz_questions(text,text,integer,integer,integer)'::regprocedure);
SELECT pg_get_functiondef('public.start_quiz_session(uuid,uuid[])'::regprocedure);

-- 3. Grants + RLS
SELECT p.oid::regprocedure::text, p.proacl::text[] FROM pg_proc p JOIN pg_namespace n
  ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (...);
SELECT policyname, roles::text, cmd, qual FROM pg_policies
WHERE schemaname='public' AND tablename='question_bank';
```

Body-identity check (bash), against `md5(prosrc)` from query 1:

```bash
# prosrc == the text between the $function$ delimiters, leading/trailing newlines included
extract() { (printf '\n'; sed -n "$2,$3p" "$1") | tr -d '\r'; }
extract 20260814000014_....sql 426 672 | md5sum   # 8affe2e1854e01ef545ca5689af7e1a5  == LIVE
extract 20260820120000_....sql 107 353 | md5sum   # 8affe2e1854e01ef545ca5689af7e1a5  == LIVE
extract 20260802100000_....sql 177 423 | md5sum   # 6146ad3504ab0ee65666d98d4776c8eb
extract 20260814000023_....sql 290 522 | md5sum   # f8b0b64b6669858970e2f831c0b44fe7
```
