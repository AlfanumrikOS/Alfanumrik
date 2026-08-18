/**
 * Shared, framework-agnostic error hierarchy.
 *
 * LAYERING: this is the innermost shared kernel. It imports NOTHING — no Next,
 * no Supabase, no logger. Domain, application, infrastructure and presentation
 * layers may all depend on it; it depends on none of them.
 *
 * Each error carries a STABLE `code` string. Route handlers map that code to an
 * HTTP status + wire error code, so transport concerns never leak inward and
 * error codes never drift with a message rewrite.
 *
 * P13: messages are static and MUST NOT interpolate PII (no email, phone, name,
 * auth user id, raw DB rows). Anything with detail belongs in `cause`, which is
 * never serialised to a client response.
 */

/** Base class for every application-defined error. `code` is the stable contract. */
export class AppError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (options?.cause !== undefined) {
      // `cause` is ES2022; assign defensively so this compiles under ES2017 lib.
      (this as { cause?: unknown }).cause = options.cause;
    }
    // Restore the prototype chain (needed when targeting ES5/ES2017 output).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * No learner row is visible for the requested identity.
 *
 * Note this is indistinguishable from "row exists but RLS hides it" — by design.
 * Callers must not attempt to tell the two apart.
 */
export class LearnerNotFoundError extends AppError {
  constructor(message = 'No learner profile found for this account') {
    super('NO_STUDENT_PROFILE', message);
  }
}

/**
 * An infrastructure/persistence failure (DB error, transport failure).
 * The underlying driver error goes in `cause` — NEVER in `message`, which may be
 * surfaced to operators/logs.
 */
export class RepositoryError extends AppError {
  constructor(message = 'Repository operation failed', cause?: unknown) {
    super('REPOSITORY_ERROR', message, { cause });
  }
}
