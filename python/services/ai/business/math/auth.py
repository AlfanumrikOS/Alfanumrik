"""Student JWT verification for ``POST /v1/math/verify``.

The math-verify endpoint is student-facing (it is called server-side by the
Next.js /api/foxy route on the student's behalf, but the bearer token is the
student's Supabase JWT). The auth posture is IDENTICAL to the voice endpoints:
verify the JWT against Supabase Auth, then look up an active ``students`` row.

Rather than duplicate the verification logic, we re-export the voice module's
:func:`verify_student` (and its :class:`AuthFailed` / :class:`StudentAuthResult`
companions). The contract is the same — an active student — so divergence here
would be a bug, not a feature. If the math path ever needs a different posture
(e.g. a different rate-limit or audit routing), copy the voice implementation
into this module the same way voice copied it from bulk_question_gen.

The route MUST call :func:`verify_student` BEFORE reading the request body so an
unauthenticated caller can't make us parse/SymPy-evaluate arbitrary payloads.
"""

from __future__ import annotations

from ..voice.auth import AuthFailed, StudentAuthResult, verify_student

__all__ = ["AuthFailed", "StudentAuthResult", "verify_student"]
