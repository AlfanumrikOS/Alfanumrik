/**
 * GetLearnerProfile use case.
 *
 * LAYERING: application. Depends ONLY on the domain port + domain model +
 * shared errors — no Supabase, no Next, no logger, no HTTP. That is what makes
 * it testable with a fake repository and reusable from a route, a cron worker or
 * an Edge-adjacent caller without change.
 *
 * Its single responsibility here is turning the port's "absent" signal (`null`)
 * into an explicit domain error, so callers never have to branch on null.
 */

import type { Learner } from '../domain/learner';
import type { LearnerRepository } from '../domain/learner-repository';
import { LearnerNotFoundError } from '@/shared/errors';

export class GetLearnerProfile {
  constructor(private readonly learners: LearnerRepository) {}

  /**
   * @param authUserId The authenticated user's auth.users id (NOT students.id).
   * @throws LearnerNotFoundError when no learner is visible for that identity.
   * @throws RepositoryError on infrastructure failure (propagated from the port).
   */
  async execute(authUserId: string): Promise<Learner> {
    const learner = await this.learners.findByAuthUserId(authUserId);
    if (!learner) {
      throw new LearnerNotFoundError();
    }
    return learner;
  }
}
