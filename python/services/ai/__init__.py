"""Alfanumrik AI services — Python port of the Model Orchestration Layer (MoL).

The TypeScript MoL framework at ``supabase/functions/_shared/mol/`` stays live
during the transition (Phase 1A, A-pragmatic decision). This package mirrors
those contracts byte-for-byte at the API level so the future cutover is a
swap, not a rewrite.

Top-level exports are kept intentionally narrow — call sites use the
sub-package APIs directly (``from services.ai.mol import generate_response``).
"""

__version__ = "0.1.0"
