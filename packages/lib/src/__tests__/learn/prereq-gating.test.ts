/**
 * Prereq-gating pins (Foxy North-Star Phase 3, E5/D12).
 *
 * Two things are load-bearing:
 *   1. FAIL-OPEN MATRIX — every error/miss path returns { suggestion: null }.
 *      Prereq gating is a suggestion, never a block; a data problem must
 *      never stop a student from starting the quiz they chose.
 *   2. MASTERY_FLOOR_DEFAULT = 0.6 — must match get_adaptive_questions'
 *      weak-concept threshold so selection and suggestions agree.
 */

import { describe, it, expect } from 'vitest';
import {
  checkPrereqs,
  MASTERY_FLOOR_DEFAULT,
  type PrereqCheckInput,
} from '../../learn/prereq-gating';

type Resp = { data: unknown; error: unknown };

function makeClient(opts: {
  responses?: Record<string, Resp[]>;
  rpc?: (name: string, args: Record<string, unknown>) => Resp;
  throwOnFrom?: boolean;
}) {
  const ltCalls: Array<[string, number]> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      if (opts.throwOnFrom) throw new Error('boom');
      const queue = opts.responses?.[table] ?? [];
      const next = (): Resp =>
        queue.length > 0 ? queue.shift()! : { data: null, error: { message: `no mock for ${table}` } };
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.in = chain;
      builder.order = chain;
      builder.limit = chain;
      builder.lt = (col: string, v: number) => {
        ltCalls.push([col, v]);
        return builder;
      };
      builder.maybeSingle = () => Promise.resolve(next());
      builder.then = (onF: (r: Resp) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(next()).then(onF, onR);
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return Promise.resolve(
        opts.rpc ? opts.rpc(name, args) : { data: null, error: { message: 'no rpc mock' } },
      );
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, ltCalls, rpcCalls };
}

const INPUT: PrereqCheckInput = {
  studentId: 'stu-1',
  subject: 'math',
  grade: '8', // grade is a STRING (P5)
  chapterNumber: 5,
};

const HAPPY: Record<string, Resp[]> = {
  subjects: [{ data: { id: 'sub-1' }, error: null }],
  curriculum_chapters_v: [
    { data: [{ id: 't1' }], error: null }, // chapter topics
    {
      data: { id: 'p1', title: 'Fractions', title_hi: 'भिन्न', chapter_number: 3 },
      error: null,
    }, // prereq title lookup
  ],
  concept_mastery: [
    { data: [{ topic_id: 'p1', mastery_probability: 0.35 }], error: null },
  ],
};
const HAPPY_RPC = () => ({ data: [{ prerequisite_topic_id: 'p1' }], error: null });

describe('checkPrereqs — happy path', () => {
  it('returns the weakest below-floor prerequisite with bilingual reason', async () => {
    const { client, ltCalls, rpcCalls } = makeClient({
      responses: structuredClone(HAPPY),
      rpc: HAPPY_RPC,
    });
    const res = await checkPrereqs(client, INPUT);
    expect(res.suggestion).not.toBeNull();
    expect(res.suggestion).toMatchObject({
      prereqTopicId: 'p1',
      prereqTitle: 'Fractions',
      prereqTitleHi: 'भिन्न',
      chapterNumber: 3,
      masteryProbability: 0.35,
    });
    expect(res.suggestion!.reason).toContain('Fractions');
    expect(res.suggestion!.reason).toContain('35%');
    expect(res.suggestion!.reasonHi).toContain('भिन्न');
    expect(res.suggestion!.reasonHi).toContain('35%');
    // Floor default flows into the mastery query and matches get_adaptive_questions.
    expect(MASTERY_FLOOR_DEFAULT).toBe(0.6);
    expect(ltCalls).toEqual([['mastery_probability', 0.6]]);
    // Depth-2 traversal of the chapter topic.
    expect(rpcCalls).toEqual([
      { name: 'traverse_prerequisites', args: { p_topic_id: 't1', p_max_depth: 2 } },
    ]);
  });

  it('masteryFloor override is passed through', async () => {
    const { client, ltCalls } = makeClient({
      responses: structuredClone(HAPPY),
      rpc: HAPPY_RPC,
    });
    await checkPrereqs(client, { ...INPUT, masteryFloor: 0.5 });
    expect(ltCalls).toEqual([['mastery_probability', 0.5]]);
  });
});

describe('checkPrereqs — FAIL-OPEN matrix (every error path → { suggestion: null })', () => {
  const cases: Array<{
    name: string;
    responses: Record<string, Resp[]>;
    rpc?: (name: string, args: Record<string, unknown>) => Resp;
    throwOnFrom?: boolean;
  }> = [
    {
      name: 'subjects query errors',
      responses: { subjects: [{ data: null, error: { message: 'db down' } }] },
    },
    {
      name: 'subject code does not resolve',
      responses: { subjects: [{ data: null, error: null }] },
    },
    {
      name: 'curriculum_chapters_v query errors',
      responses: {
        subjects: [{ data: { id: 'sub-1' }, error: null }],
        curriculum_chapters_v: [{ data: null, error: { message: 'nope' } }],
      },
    },
    {
      name: 'chapter has no topics',
      responses: {
        subjects: [{ data: { id: 'sub-1' }, error: null }],
        curriculum_chapters_v: [{ data: [], error: null }],
      },
    },
    {
      name: 'traverse_prerequisites RPC errors',
      responses: {
        subjects: [{ data: { id: 'sub-1' }, error: null }],
        curriculum_chapters_v: [{ data: [{ id: 't1' }], error: null }],
      },
      rpc: () => ({ data: null, error: { message: 'rpc broke' } }),
    },
    {
      name: 'topic has no prerequisites',
      responses: {
        subjects: [{ data: { id: 'sub-1' }, error: null }],
        curriculum_chapters_v: [{ data: [{ id: 't1' }], error: null }],
      },
      rpc: () => ({ data: [], error: null }),
    },
    {
      name: 'prereq chain only points back into the chapter itself',
      responses: {
        subjects: [{ data: { id: 'sub-1' }, error: null }],
        curriculum_chapters_v: [{ data: [{ id: 't1' }], error: null }],
      },
      rpc: () => ({ data: [{ prerequisite_topic_id: 't1' }], error: null }),
    },
    {
      name: 'concept_mastery query errors',
      responses: {
        subjects: [{ data: { id: 'sub-1' }, error: null }],
        curriculum_chapters_v: [{ data: [{ id: 't1' }], error: null }],
        concept_mastery: [{ data: null, error: { message: 'nope' } }],
      },
      rpc: HAPPY_RPC,
    },
    {
      name: 'no mastery row below the floor (unknown or strong prereqs → stay quiet)',
      responses: {
        subjects: [{ data: { id: 'sub-1' }, error: null }],
        curriculum_chapters_v: [{ data: [{ id: 't1' }], error: null }],
        concept_mastery: [{ data: [], error: null }],
      },
      rpc: HAPPY_RPC,
    },
    {
      name: 'prereq title lookup errors',
      responses: {
        subjects: [{ data: { id: 'sub-1' }, error: null }],
        curriculum_chapters_v: [
          { data: [{ id: 't1' }], error: null },
          { data: null, error: { message: 'nope' } },
        ],
        concept_mastery: [
          { data: [{ topic_id: 'p1', mastery_probability: 0.2 }], error: null },
        ],
      },
      rpc: HAPPY_RPC,
    },
    {
      name: 'prereq id is not a curriculum_chapters_v row (foreign id namespace)',
      responses: {
        subjects: [{ data: { id: 'sub-1' }, error: null }],
        curriculum_chapters_v: [
          { data: [{ id: 't1' }], error: null },
          { data: null, error: null },
        ],
        concept_mastery: [
          { data: [{ topic_id: 'p1', mastery_probability: 0.2 }], error: null },
        ],
      },
      rpc: HAPPY_RPC,
    },
    {
      name: 'client.from throws synchronously',
      responses: {},
      throwOnFrom: true,
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const { client } = makeClient({
        responses: c.responses,
        rpc: c.rpc,
        throwOnFrom: c.throwOnFrom,
      });
      const res = await checkPrereqs(client, INPUT);
      expect(res).toEqual({ suggestion: null });
    });
  }

  it('one failing traversal among several does not sink the check (partial evidence still used)', async () => {
    let call = 0;
    const { client } = makeClient({
      responses: {
        subjects: [{ data: { id: 'sub-1' }, error: null }],
        curriculum_chapters_v: [
          { data: [{ id: 't1' }, { id: 't2' }], error: null },
          {
            data: { id: 'p1', title: 'Fractions', title_hi: null, chapter_number: 3 },
            error: null,
          },
        ],
        concept_mastery: [
          { data: [{ topic_id: 'p1', mastery_probability: 0.1 }], error: null },
        ],
      },
      rpc: () => {
        call += 1;
        return call === 1
          ? { data: null, error: { message: 'one chain broke' } }
          : { data: [{ prerequisite_topic_id: 'p1' }], error: null };
      },
    });
    const res = await checkPrereqs(client, INPUT);
    expect(res.suggestion?.prereqTopicId).toBe('p1');
    // Hindi title missing → reasonHi falls back to the EN title.
    expect(res.suggestion?.reasonHi).toContain('Fractions');
  });
});
