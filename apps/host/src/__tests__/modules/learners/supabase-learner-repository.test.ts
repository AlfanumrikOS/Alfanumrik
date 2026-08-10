/**
 * SupabaseLearnerRepository adapter tests.
 *
 * Uses a hand-rolled chainable client object (`from().select().eq().maybeSingle()`)
 * rather than `vi.mock` — the adapter takes its client by INJECTION, so no module
 * mocking is needed to exercise it.
 *
 * Pins:
 *  - the read targets `students` and filters on `auth_user_id` (NEVER on
 *    `students.id`, a different uuid — filtering on the wrong column would
 *    return someone else's row the moment RLS were relaxed);
 *  - a PostgREST `error` becomes a `RepositoryError` (code `REPOSITORY_ERROR`)
 *    with the driver error in `cause`, not in the message (P13);
 *  - a missing row becomes `null`, not a throw (the port's contract);
 *  - P5: `grade` is coerced to a string even if the driver hands back a number.
 */
import { describe, it, expect } from 'vitest';

import type { TypedSupabaseClient } from '@/infrastructure/database';
import { SupabaseLearnerRepository } from '@/modules/learners/infrastructure/supabase-learner-repository';
import { RepositoryError } from '@/shared/errors';

const AUTH_USER_ID = 'auth-0000-0000-0000-000000000001';
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';

const ROW = {
  id: STUDENT_ID,
  auth_user_id: AUTH_USER_ID,
  name: 'Asha',
  grade: '9',
  board: 'CBSE',
  stream: 'science',
  subscription_plan: 'pro',
  preferred_language: 'hi',
  school_id: null,
};

interface Recorded {
  tables: string[];
  selects: string[];
  filters: Array<[string, unknown]>;
  maybeSingleCalls: number;
}

function fakeClient(result: { data: unknown; error: unknown }) {
  const recorded: Recorded = { tables: [], selects: [], filters: [], maybeSingleCalls: 0 };

  const builder = {
    select(columns: string) {
      recorded.selects.push(columns);
      return builder;
    },
    eq(column: string, value: unknown) {
      recorded.filters.push([column, value]);
      return builder;
    },
    async maybeSingle() {
      recorded.maybeSingleCalls += 1;
      return result;
    },
  };

  const client = {
    from(table: string) {
      recorded.tables.push(table);
      return builder;
    },
  };

  return { client: client as unknown as TypedSupabaseClient, recorded };
}

describe('SupabaseLearnerRepository', () => {
  it('reads the students table filtered on auth_user_id', async () => {
    const { client, recorded } = fakeClient({ data: ROW, error: null });

    await new SupabaseLearnerRepository(client).findByAuthUserId(AUTH_USER_ID);

    expect(recorded.tables).toEqual(['students']);
    expect(recorded.filters).toEqual([['auth_user_id', AUTH_USER_ID]]);
    expect(recorded.maybeSingleCalls).toBe(1);
  });

  it('never filters on students.id (a different uuid from the auth user id)', async () => {
    const { client, recorded } = fakeClient({ data: ROW, error: null });

    await new SupabaseLearnerRepository(client).findByAuthUserId(AUTH_USER_ID);

    expect(recorded.filters.map(([column]) => column)).not.toContain('id');
  });

  it('selects an explicit column list rather than *', async () => {
    const { client, recorded } = fakeClient({ data: ROW, error: null });

    await new SupabaseLearnerRepository(client).findByAuthUserId(AUTH_USER_ID);

    expect(recorded.selects).toHaveLength(1);
    expect(recorded.selects[0]).not.toBe('*');
    expect(recorded.selects[0]).toContain('auth_user_id');
  });

  it('maps the snake_case row onto the camelCase domain model', async () => {
    const { client } = fakeClient({ data: ROW, error: null });

    const learner = await new SupabaseLearnerRepository(client).findByAuthUserId(AUTH_USER_ID);

    expect(learner).toEqual({
      id: STUDENT_ID,
      authUserId: AUTH_USER_ID,
      name: 'Asha',
      grade: '9',
      board: 'CBSE',
      stream: 'science',
      plan: 'pro',
      language: 'hi',
      schoolId: null,
    });
  });

  it('returns null when no row is visible (missing row or hidden by RLS)', async () => {
    const { client } = fakeClient({ data: null, error: null });

    const learner = await new SupabaseLearnerRepository(client).findByAuthUserId(AUTH_USER_ID);

    expect(learner).toBeNull();
  });

  it('converts a PostgREST error into a RepositoryError with the driver error as cause', async () => {
    const pgError = { code: '42501', message: 'permission denied for table students' };
    const { client } = fakeClient({ data: null, error: pgError });

    const err = await new SupabaseLearnerRepository(client)
      .findByAuthUserId(AUTH_USER_ID)
      .catch((e) => e);

    expect(err).toBeInstanceOf(RepositoryError);
    expect((err as RepositoryError).code).toBe('REPOSITORY_ERROR');
    expect((err as { cause?: unknown }).cause).toBe(pgError);
    // P13: the driver message must not be interpolated into the error message.
    expect((err as Error).message).toBe('Learner lookup failed');
    expect((err as Error).message).not.toContain('permission denied');
  });

  it('P5: coerces a numeric grade from the driver into a string', async () => {
    const { client } = fakeClient({ data: { ...ROW, grade: 9 }, error: null });

    const learner = await new SupabaseLearnerRepository(client).findByAuthUserId(AUTH_USER_ID);

    expect(typeof learner?.grade).toBe('string');
    expect(learner?.grade).toBe('9');
  });

  it('P5: leaves a null grade as null rather than coercing it to "null"', async () => {
    const { client } = fakeClient({ data: { ...ROW, grade: null }, error: null });

    const learner = await new SupabaseLearnerRepository(client).findByAuthUserId(AUTH_USER_ID);

    expect(learner?.grade).toBeNull();
  });
});
