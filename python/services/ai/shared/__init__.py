"""Shared robustness primitives for the AI service.

These are framework-level utilities — retry, idempotency, budget guarding —
that any business module can adopt. They are deliberately small and
narrowly scoped so they can be replaced with distributed equivalents
(Redis, etc.) in later phases without touching call sites.

See docs/PYTHON_AI_LONG_TERM_VISION.md sections 3 and 6 for the
roadmap that placed these primitives in Phase 2.
"""
