/**
 * LearnerRepository — the persistence PORT for the `learners` module.
 *
 * LAYERING: domain layer. Deliberately free of any Supabase/Next/HTTP types so
 * the application layer can be exercised against any implementation (real
 * adapter, in-memory fake, test double) without a database.
 *
 * The Supabase implementation lives at
 * `@/modules/learners/infrastructure/supabase-learner-repository`.
 */

import type { Learner } from './learner';

export interface LearnerRepository {
  /**
   * Resolve the learner linked to the given auth user id.
   *
   * Implementation contract:
   *  - Returns `null` — NOT a throw — when no learner is visible to the caller.
   *    "Not visible" intentionally conflates "row does not exist" with "row
   *    exists but RLS hides it"; callers must not try to distinguish them.
   *  - Throws `RepositoryError` (from `@/shared/errors`) on any infrastructure
   *    failure (DB error, transport failure). The underlying driver error is
   *    attached as `cause` and must never reach a user-facing message (P13).
   */
  findByAuthUserId(authUserId: string): Promise<Learner | null>;
}
