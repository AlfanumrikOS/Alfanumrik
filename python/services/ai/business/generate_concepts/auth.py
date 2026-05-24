"""Admin-key authentication for generate-concepts.

The TS Edge Function uses the SAME shared-secret posture as
``generate-answers`` (and ``bulk-question-gen``): constant-time compare of
the ``x-admin-key`` request header against the ``ADMIN_API_KEY`` environment
variable. Forking the implementation would invite drift; this module re-
exports the canonical helper from
:mod:`services.ai.business.generate_answers.auth` instead.

PII safety: never log the provided key, never log the expected key. The
upstream helper already enforces this.
"""

from __future__ import annotations

from ..generate_answers.auth import AuthFailed, _constant_time_equal, verify_admin_key

__all__ = ["AuthFailed", "_constant_time_equal", "verify_admin_key"]
