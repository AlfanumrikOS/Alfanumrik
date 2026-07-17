/**
 * CURRICULUM-VERSION MONOTONICITY + DELETE-SAFETY — integration lane (LIVE DB).
 *
 * Pins migration `supabase/migrations/20260717120000_curriculum_version_source.sql`
 * and its read RPC:
 *
 *   get_curriculum_versions(p_grade text, p_subject_codes text[] DEFAULT NULL)
 *     RETURNS jsonb -> { as_of: <ISO8601 UTC>,
 *                        scopes: { "<subject_code>-<grade>": <unix_epoch_int> } }
 *
 * THE INVARIANT (architect-declared REQUIRED condition of approval)
 * ================================================================
 * A scope's version MUST be NON-DECREASING under EVERY content mutation:
 * insert, edit, SOFT delete (`is_active = false`), and HARD delete. The mobile
 * Learn cache treats `server == stored` as "my cache is current, serve it with
 * no network". So a version that ever moves BACKWARD is a silent-stale-serve
 * bug: the device would hold NEW content stamped with a HIGH version, see the
 * server report a LOWER one, and — because the equality check fails — either
 * thrash or (worse, if the stamps collide again later) serve retired syllabus
 * as if it were current. Monotonicity is what makes `==` a safe "serve cache"
 * decision. See the migration header for the full model.
 *
 * THE TWO HISTORICALLY-BROKEN PATHS THIS EXISTS TO CATCH
 * =====================================================
 *  1. SOFT DELETE — `UPDATE curriculum_topics SET is_active = false` (the
 *     internal-admin content route) did NOT set `updated_at`. Combined with an
 *     `is_active = true`-filtered aggregation, retiring the max-holder row made
 *     the scope's max(updated_at) move BACKWARD. The migration closes this with
 *     (a) a BEFORE UPDATE `updated_at` trigger on curriculum_topics and (b) an
 *     is_active-AGNOSTIC aggregation. Step 3 below is the regression pin.
 *  2. HARD DELETE — deleting the max-holder row genuinely lowers
 *     max(updated_at); no trigger on the surviving rows can prevent that. The
 *     migration closes this with a per-scope AFTER DELETE watermark table folded
 *     in via GREATEST(ct_max, rag_max, watermark). Step 4 below is the pin: WITHOUT
 *     the watermark the version would collapse to 0 and every device would treat
 *     its cache as newer-than-server forever.
 *
 * WHY A LIVE DB: the invariant is produced by real triggers, a real CHECK-guarded
 * schema, a real transition-table statement trigger and a real SECURITY DEFINER
 * aggregation. None of it exists in a mock. Runs ONLY in the CI `integration-tests`
 * job (`npm run test:integration`, RUN_INTEGRATION_TESTS=1, live STAGING Supabase);
 * self-skips without real creds like every sibling under __tests__/migrations/.
 *
 * FIXTURE ISOLATION (deliberate — do not "tidy" these away)
 * ========================================================
 *  * A dedicated synthetic subject (`cvz_version_test`, seeded `is_active=false`)
 *    and a scope-per-test grade keep every assertion independent of real content
 *    and of the sibling tests in this lane.
 *  * The curriculum_topics fixture leaves `chapter_number` NULL, so it is EXCLUDED
 *    from `curriculum-taxonomy-parity.test.ts` (which scans
 *    `chapter_number IS NOT NULL`) and cannot masquerade as an old-syllabus orphan.
 *    Same shape as the permanent anchor in `_helpers/reference-data.ts`.
 *  * The rag_content_chunks fixture is `is_active=false`, so it is EXCLUDED from
 *    `rag-chunk-syllabus-orphans.test.ts` (which scans `is_active <> false`) — and
 *    it doubles as proof that the RPC aggregation really is is_active-AGNOSTIC.
 *
 * Invariants: P5 (grade strings "6".."12"), P8 (the watermark table is
 * service_role-only; only the SECURITY DEFINER RPC reads it).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { hasSupabaseIntegrationEnv } from '../helpers/integration';

const describeIntegration = hasSupabaseIntegrationEnv() ? describe : describe.skip;

/** Synthetic, namespaced subject — never collides with real CBSE content. */
const SUBJECT_CODE = 'cvz_version_test';
/** Scope-per-test grades, so the three tests below share no mutable state. */
const GRADE_CT = '11'; // curriculum_topics lifecycle
const GRADE_RAG = '12'; // rag_content_chunks lifecycle

/** pgvector literal — rag_content_chunks.embedding is a 1024-dim vector. */
const EMBEDDING = `[${Array(1024).fill(0.1).join(',')}]`;

/** Verbatim shape of the get_curriculum_versions jsonb. */
interface CurriculumVersions {
  as_of: string;
  scopes: Record<string, number>;
}

/**
 * Call the RPC. `codes === null` omits p_subject_codes entirely so the SQL
 * DEFAULT (NULL -> "all subjects with content, empties omitted") is exercised.
 */
async function callVersions(
  grade: string,
  codes: string[] | null,
): Promise<CurriculumVersions> {
  const params: Record<string, unknown> = { p_grade: grade };
  if (codes !== null) params.p_subject_codes = codes;
  const { data, error } = await supabaseAdmin.rpc('get_curriculum_versions', params);
  expect(error, `get_curriculum_versions(${grade}) failed: ${error?.message}`).toBeNull();
  expect(data, 'get_curriculum_versions returned no jsonb').not.toBeNull();
  return data as CurriculumVersions;
}

/** The monotonic int for the fixture scope at `grade`. */
async function scopeVersion(grade: string): Promise<number> {
  const { scopes } = await callVersions(grade, [SUBJECT_CODE]);
  const v = scopes[`${SUBJECT_CODE}-${grade}`];
  // An explicit p_subject_codes request MUST echo every requested code (0 when
  // it has no content) — never omit it. Guard that here so a contract break
  // surfaces as "undefined" rather than a confusing NaN comparison later.
  expect(
    v,
    `explicit p_subject_codes request omitted the requested scope ` +
      `"${SUBJECT_CODE}-${grade}" — the contract says every requested code is echoed`,
  ).toBeTypeOf('number');
  return v;
}

/**
 * Sleep past the next whole epoch-second. The version is
 * `floor(extract(epoch FROM ...))`, i.e. SECOND-granular: two mutations inside
 * the same wall-clock second legitimately produce the SAME int. The
 * non-decrease assertions (`>=`) are true regardless and are the real contract;
 * this tick only makes the additional "moved FORWARD" (`>`) assertions
 * deterministic instead of racing the clock.
 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 1100));

/**
 * Remove every trace of the fixture. Order matters: content rows first (their
 * AFTER DELETE triggers WRITE the watermark), then the watermark rows they just
 * wrote, then the subject (FK parent of curriculum_topics).
 */
async function purgeFixture(): Promise<void> {
  await supabaseAdmin.from('rag_content_chunks').delete().eq('subject_code', SUBJECT_CODE);

  const { data: subj } = await supabaseAdmin
    .from('subjects')
    .select('id')
    .eq('code', SUBJECT_CODE)
    .maybeSingle();
  if (subj) {
    await supabaseAdmin
      .from('curriculum_topics')
      .delete()
      .eq('subject_id', (subj as { id: string }).id);
  }

  await supabaseAdmin
    .from('curriculum_version_watermark')
    .delete()
    .like('scope_key', `${SUBJECT_CODE}::%`);

  await supabaseAdmin.from('subjects').delete().eq('code', SUBJECT_CODE);
}

describeIntegration('get_curriculum_versions — monotonicity + delete-safety', () => {
  let subjectId: string;

  beforeAll(async () => {
    // Pollution guard: a previously-crashed run would otherwise trip the UNIQUE
    // subjects.code constraint and kill the whole suite.
    await purgeFixture();

    const { error: seedErr } = await supabaseAdmin.from('subjects').insert({
      code: SUBJECT_CODE,
      name: 'Curriculum Version Test',
      name_hi: 'पाठ्यक्रम संस्करण परीक्षण',
      subject_kind: 'platform_elective',
      // Seeded INACTIVE so the synthetic subject can never surface to a real
      // student via get_available_subjects. The version RPC does NOT filter on
      // subjects.is_active, so this does not affect anything asserted below.
      is_active: false,
      display_order: 9999,
    });
    if (seedErr) {
      throw new Error(
        `curriculum-version fixture: subjects seed INSERT failed: ${seedErr.message}. ` +
          `Check for schema drift in public.subjects (code/name/name_hi/subject_kind/` +
          `is_active/display_order) — see __tests__/migrations/_helpers/reference-data.ts.`,
      );
    }

    const { data, error } = await supabaseAdmin
      .from('subjects')
      .select('id')
      .eq('code', SUBJECT_CODE)
      .single();
    if (error || !data) {
      throw new Error(
        `curriculum-version fixture: could not resolve seeded subject id: ${error?.message}`,
      );
    }
    subjectId = (data as { id: string }).id;
  }, 30_000);

  afterAll(async () => {
    await purgeFixture();
  }, 30_000);

  it(
    'curriculum_topics: version never decreases across insert → edit → soft-delete → hard-delete',
    async () => {
      // ── 0. Baseline ──────────────────────────────────────────────────────
      // A scope that has never held content reads 0. This is the ONLY time a
      // scope may read 0: once content exists, deletes bump the watermark and it
      // stays > 0 forever (that is what step 4 proves).
      expect(
        await scopeVersion(GRADE_CT),
        'a scope that never had content must read 0',
      ).toBe(0);

      // ── 1. INSERT ────────────────────────────────────────────────────────
      const { data: topic, error: insErr } = await supabaseAdmin
        .from('curriculum_topics')
        .insert({
          subject_id: subjectId,
          title: 'curriculum-version monotonicity fixture',
          grade: GRADE_CT, // P5: grade is a STRING
          board: 'CBSE',
          is_active: true,
          // chapter_number intentionally omitted (NULL) — see the fixture-isolation
          // note in the file header.
        })
        .select('id')
        .single();
      expect(insErr, `curriculum_topics insert failed: ${insErr?.message}`).toBeNull();
      expect(topic, 'curriculum_topics insert returned no row').not.toBeNull();
      const topicId = (topic as { id: string }).id;

      const vInsert = await scopeVersion(GRADE_CT);
      expect(vInsert, 'inserting content must move the scope off 0').toBeGreaterThan(0);

      // ── 2. EDIT ──────────────────────────────────────────────────────────
      await tick();
      const { error: editErr } = await supabaseAdmin
        .from('curriculum_topics')
        .update({ title: 'curriculum-version monotonicity fixture (edited)' })
        .eq('id', topicId);
      expect(editErr, `curriculum_topics edit failed: ${editErr?.message}`).toBeNull();

      const vEdit = await scopeVersion(GRADE_CT);
      expect(vEdit, 'MONOTONICITY: an edit must never move the version backward')
        .toBeGreaterThanOrEqual(vInsert);
      expect(
        vEdit,
        'an edit must move the version FORWARD (the BEFORE UPDATE updated_at ' +
          'trigger on curriculum_topics is what guarantees this)',
      ).toBeGreaterThan(vInsert);

      // ── 3. SOFT DELETE — the historically-broken path ────────────────────
      // `UPDATE ... SET is_active = false` writes NO updated_at of its own. Only
      // the trigger bumps it. If the trigger is dropped AND the aggregation ever
      // regains a `WHERE is_active = true` filter, this row leaves the max() and
      // the version COLLAPSES — which the >= assertion catches.
      await tick();
      const { error: softErr } = await supabaseAdmin
        .from('curriculum_topics')
        .update({ is_active: false })
        .eq('id', topicId);
      expect(softErr, `curriculum_topics soft-delete failed: ${softErr?.message}`).toBeNull();

      const vSoft = await scopeVersion(GRADE_CT);
      expect(
        vSoft,
        'MONOTONICITY: a soft delete (is_active=false) must never move the version ' +
          'backward — this is the exact path that historically forgot to bump updated_at',
      ).toBeGreaterThanOrEqual(vEdit);
      expect(
        vSoft,
        'a soft delete must move the version FORWARD so devices purge the retired chapter',
      ).toBeGreaterThan(vEdit);

      // ── 4. HARD DELETE — the watermark path ──────────────────────────────
      // The max-holder row disappears. max(updated_at) over curriculum_topics for
      // this scope becomes NULL -> COALESCE 0. ONLY the AFTER DELETE watermark
      // keeps the version from collapsing to 0.
      await tick();
      const { error: hardErr } = await supabaseAdmin
        .from('curriculum_topics')
        .delete()
        .eq('id', topicId);
      expect(hardErr, `curriculum_topics hard-delete failed: ${hardErr?.message}`).toBeNull();

      const vHard = await scopeVersion(GRADE_CT);
      expect(
        vHard,
        'DELETE-SAFETY: a HARD delete must never move the version backward. ' +
          'Without the curriculum_version_watermark AFTER DELETE trigger this ' +
          'collapses to 0 and every device treats its cache as newer-than-server forever.',
      ).toBeGreaterThanOrEqual(vSoft);
      expect(
        vHard,
        'a scope that HAS held content must never read 0 again — the watermark floors it',
      ).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    'rag_content_chunks: version never decreases across insert → edit → hard-delete',
    async () => {
      // The second content source the mobile Learn cache reflects (NCERT concept
      // prose). Hard deletes genuinely happen here (re-ingest pipeline), which is
      // precisely why the watermark exists.
      expect(
        await scopeVersion(GRADE_RAG),
        'a scope that never had content must read 0',
      ).toBe(0);

      // ── 1. INSERT ────────────────────────────────────────────────────────
      const { data: chunk, error: insErr } = await supabaseAdmin
        .from('rag_content_chunks')
        .insert({
          chunk_text: 'curriculum-version monotonicity fixture chunk.',
          source: 'ncert_2025', // CHECK-constrained to this single value
          grade: GRADE_RAG, // legacy NOT NULL column
          subject: 'Curriculum Version Test', // legacy NOT NULL column
          grade_short: GRADE_RAG, // canonical scoping column (P5 string)
          subject_code: SUBJECT_CODE, // canonical scoping column
          chapter_number: 901,
          // is_active=false keeps this synthetic chunk out of the sibling
          // orphan-budget scan AND proves the RPC aggregation is is_active-AGNOSTIC:
          // an inactive chunk still counts toward the scope version below.
          is_active: false,
          embedding: EMBEDDING,
        })
        .select('id')
        .single();
      expect(insErr, `rag_content_chunks insert failed: ${insErr?.message}`).toBeNull();
      expect(chunk, 'rag_content_chunks insert returned no row').not.toBeNull();
      const chunkId = (chunk as { id: string }).id;

      const vInsert = await scopeVersion(GRADE_RAG);
      expect(
        vInsert,
        'an is_active=false chunk must STILL count — the aggregation is deliberately ' +
          'is_active-agnostic, because an is_active-filtered max() can move backward',
      ).toBeGreaterThan(0);

      // ── 2. EDIT ──────────────────────────────────────────────────────────
      await tick();
      const { error: editErr } = await supabaseAdmin
        .from('rag_content_chunks')
        .update({ chunk_text: 'curriculum-version monotonicity fixture chunk (edited).' })
        .eq('id', chunkId);
      expect(editErr, `rag_content_chunks edit failed: ${editErr?.message}`).toBeNull();

      const vEdit = await scopeVersion(GRADE_RAG);
      expect(vEdit, 'MONOTONICITY: an edit must never move the version backward')
        .toBeGreaterThanOrEqual(vInsert);
      expect(
        vEdit,
        'an edit must move the version FORWARD (rag_content_chunks set_updated_at trigger)',
      ).toBeGreaterThan(vInsert);

      // ── 3. HARD DELETE ───────────────────────────────────────────────────
      await tick();
      const { error: hardErr } = await supabaseAdmin
        .from('rag_content_chunks')
        .delete()
        .eq('id', chunkId);
      expect(hardErr, `rag_content_chunks hard-delete failed: ${hardErr?.message}`).toBeNull();

      const vHard = await scopeVersion(GRADE_RAG);
      expect(
        vHard,
        'DELETE-SAFETY: a HARD delete of the only chunk must never move the version ' +
          'backward — the AFTER DELETE watermark trigger floors it at now()',
      ).toBeGreaterThanOrEqual(vEdit);
      expect(
        vHard,
        'a scope that HAS held content must never read 0 again — the watermark floors it',
      ).toBeGreaterThan(0);

      // The watermark row is the mechanism; assert it materialised for THIS scope
      // so a silently-dropped trigger fails here with a precise cause rather than
      // only showing up as a mystery regression under concurrent writes.
      const { data: wm, error: wmErr } = await supabaseAdmin
        .from('curriculum_version_watermark')
        .select('scope_key, hw_epoch')
        .eq('scope_key', `${SUBJECT_CODE}::${GRADE_RAG}`)
        .maybeSingle();
      expect(wmErr, `watermark read failed: ${wmErr?.message}`).toBeNull();
      expect(
        wm,
        `no curriculum_version_watermark row for "${SUBJECT_CODE}::${GRADE_RAG}" after a hard ` +
          `delete — the AFTER DELETE trigger did not fire (delete-safety is GONE)`,
      ).not.toBeNull();
      expect((wm as { hw_epoch: number }).hw_epoch).toBeGreaterThan(0);
    },
    60_000,
  );

  it('never 500s and never leaks a scope for an out-of-range or absent grade (P5)', async () => {
    // A version poll must never break the client. The RPC answers an invalid
    // grade with an EMPTY scope map, not an error — the route depends on this.
    // '   ' is included deliberately: the RPC btrim()s p_grade before the P5
    // membership check, so whitespace must degrade to empty, not throw.
    for (const badGrade of ['13', '5', '0', '', '   ', 'ten', 'X']) {
      const res = await callVersions(badGrade, [SUBJECT_CODE]);
      expect(res.scopes, `grade "${badGrade}" must yield an empty scope map`).toEqual({});
      expect(res.as_of, `grade "${badGrade}" must still carry an as_of`).toBeTypeOf('string');
    }
  });

  it('echoes 0 for an explicitly-requested code that has no content, and omits empties when p_subject_codes is NULL', async () => {
    const NEVER = '__cvz_never_has_content__';

    // Explicit request -> definitive per-scope answer, including 0.
    const explicit = await callVersions('10', [NEVER]);
    expect(explicit.scopes[`${NEVER}-10`]).toBe(0);

    // p_subject_codes omitted (SQL DEFAULT NULL) -> empty scopes are omitted so
    // the app-start poll stays <1 KB.
    const all = await callVersions('10', null);
    expect(Object.keys(all.scopes)).not.toContain(`${NEVER}-10`);
    for (const v of Object.values(all.scopes)) {
      expect(v, 'the all-subjects poll must omit empty scopes, never emit 0').toBeGreaterThan(0);
    }
  });

  it('returns an ISO-8601 UTC as_of alongside the scope map', async () => {
    const res = await callVersions(GRADE_CT, [SUBJECT_CODE]);
    expect(res.as_of).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Number.isNaN(Date.parse(res.as_of))).toBe(false);
  });
});
