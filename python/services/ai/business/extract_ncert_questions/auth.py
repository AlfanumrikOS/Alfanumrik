"""Re-export the shared admin x-admin-key verifier from generate_answers."""

from ..generate_answers.auth import AuthFailed, verify_admin_key

__all__ = ["AuthFailed", "verify_admin_key"]
