/**
 * GetLearnerProfile use-case tests — driven entirely by a hand-rolled FAKE
 * repository implementing the `LearnerRepository` port.
 *
 * The point of this file is the ABSENCE of infrastructure: no `vi.mock`, no
 * Supabase stub, no chainable PostgREST builder, no env vars, no route. If this
 * file ever needs one of those, the Repository Pattern has been broken and the
 * application layer has re-acquired a dependency on the database.
 *
 * Pins:
 *  - the exact `authUserId` is passed through to the port (no substitution of
 *    `students.id` for `auth.users.id` — they are different uuids);
 *  - `null` from the port becomes `LearnerNotFoundError` (code
 *    `NO_STUDENT_PROFILE`), never a silent null;
 *  - a `RepositoryError` from the port PROPAGATES — it is not swallowed and,
 *    critically, is not downgraded into "not found" (that would turn a DB
 *    outage into a 404 and hide it from alerting);
 *  - P5: `grade` surfaces as a string, never a number.
 */
import { describe, it, expect } from 'vitest';

import type { Learner } from '@/modules/learners/domain/learner';
import type { LearnerRepository } from '@/modules/learners/domain/learner-repository';
import { GetLearnerProfile } from '@/modules/learners/application/get-learner-profile';
import { LearnerNotFoundError, RepositoryError, AppError } from '@/shared/errors';

const AUTH_USER_ID = 'auth-0000-0000-0000-000000000001';
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';

function makeLearner(overrides: Partial<Learner> = {}): Learner {
  return {
    id: STUDENT_ID,
    authUserId: AUTH_USER_ID,
    name: 'Asha',
    grade: '9',
    board: 'CBSE',
    stream: 'science',
    plan: 'pro',
    language: 'hi',
    schoolId: null,
    ...overrides,
  };
}

/**
 * Hand-rolled test double for the persistence port. A real class implementing
 * the real interface — so the compiler fails this file if the port's shape
 * changes, which a `vi.mock` factory would not.
 */
class FakeLearnerRepository implements LearnerRepository {
  /** Every argument the use case passed, in order. */
  readonly receivedAuthUserIds: string[] = [];

  private stored: Learner | null = null;
  private failure: unknown = null;

  withLearner(learner: Learner): this {
    this.stored = learner;
    this.failure = null;
    return this;
  }

  /** Port contract: "not visible" is `null`, not a throw. */
  empty(): this {
    this.stored = null;
    this.failure = null;
    return this;
  }

  failingWith(error: unknown): this {
    this.failure = error;
    return this;
  }

  async findByAuthUserId(authUserId: string): Promise<Learner | null> {
    this.receivedAuthUserIds.push(authUserId);
    if (this.failure !== null) throw this.failure;
    return this.stored;
  }
}

describe('GetLearnerProfile (fake repository, zero Supabase)', () => {
  it('returns the learner the repository holds', async () => {
    const learner = makeLearner();
    const repo = new FakeLearnerRepository().withLearner(learner);

    const result = await new GetLearnerProfile(repo).execute(AUTH_USER_ID);

    expect(result).toEqual(learner);
    expect(result.id).toBe(STUDENT_ID);
    expect(result.name).toBe('Asha');
  });

  it('passes the exact authUserId through to the repository', async () => {
    const repo = new FakeLearnerRepository().withLearner(makeLearner());

    await new GetLearnerProfile(repo).execute(AUTH_USER_ID);

    expect(repo.receivedAuthUserIds).toEqual([AUTH_USER_ID]);
    // Regression guard: the auth user id must NOT be swapped for students.id.
    expect(repo.receivedAuthUserIds[0]).not.toBe(STUDENT_ID);
  });

  it('queries the repository exactly once per execute() call', async () => {
    const repo = new FakeLearnerRepository().withLearner(makeLearner());

    await new GetLearnerProfile(repo).execute(AUTH_USER_ID);

    expect(repo.receivedAuthUserIds).toHaveLength(1);
  });

  it('throws LearnerNotFoundError with code NO_STUDENT_PROFILE when the repository returns null', async () => {
    const repo = new FakeLearnerRepository().empty();

    await expect(new GetLearnerProfile(repo).execute(AUTH_USER_ID)).rejects.toBeInstanceOf(
      LearnerNotFoundError,
    );

    // Re-run to inspect the thrown value's stable contract (`code`), which is
    // what the route maps to HTTP 404.
    const err = await new GetLearnerProfile(repo).execute(AUTH_USER_ID).catch((e) => e);
    expect(err).toBeInstanceOf(LearnerNotFoundError);
    expect(err).toBeInstanceOf(AppError);
    expect((err as LearnerNotFoundError).code).toBe('NO_STUDENT_PROFILE');
    // P13: no identifier interpolated into the user-facing message.
    expect((err as Error).message).not.toContain(AUTH_USER_ID);
  });

  it('propagates a RepositoryError instead of swallowing it or converting it to not-found', async () => {
    const cause = { code: '42501', message: 'permission denied for table students' };
    const repo = new FakeLearnerRepository().failingWith(
      new RepositoryError('Learner lookup failed', cause),
    );

    const err = await new GetLearnerProfile(repo).execute(AUTH_USER_ID).catch((e) => e);

    expect(err).toBeInstanceOf(RepositoryError);
    expect((err as RepositoryError).code).toBe('REPOSITORY_ERROR');
    // The critical assertion: an infrastructure failure must NOT be laundered
    // into "no profile", which would surface a DB outage as a benign 404.
    expect(err).not.toBeInstanceOf(LearnerNotFoundError);
    expect((err as RepositoryError).code).not.toBe('NO_STUDENT_PROFILE');
    expect((err as { cause?: unknown }).cause).toBe(cause);
  });

  it('propagates a non-AppError throw from the repository unchanged', async () => {
    const boom = new TypeError('fetch failed');
    const repo = new FakeLearnerRepository().failingWith(boom);

    await expect(new GetLearnerProfile(repo).execute(AUTH_USER_ID)).rejects.toBe(boom);
  });

  it('P5: surfaces grade as a string, never a number', async () => {
    const repo = new FakeLearnerRepository().withLearner(makeLearner({ grade: '12' }));

    const result = await new GetLearnerProfile(repo).execute(AUTH_USER_ID);

    expect(typeof result.grade).toBe('string');
    expect(result.grade).toBe('12');
    expect(result.grade).not.toBe(12);
  });

  it('P5: a null grade stays null rather than becoming 0 or ""', async () => {
    const repo = new FakeLearnerRepository().withLearner(makeLearner({ grade: null }));

    const result = await new GetLearnerProfile(repo).execute(AUTH_USER_ID);

    expect(result.grade).toBeNull();
  });
});
