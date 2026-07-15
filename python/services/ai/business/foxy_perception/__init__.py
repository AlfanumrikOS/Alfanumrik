"""Foxy per-turn perception classifier (Phase 1C, 2026-07-15).

The LLM classification for Foxy's per-turn "sensor" runs HERE (the MOL-on-Python
mandate): a cheap ``task_type='evaluation'`` MOL call reads one tutoring turn and
emits a compact, PII-free classification (topic / Bloom / misconception /
struggle / intent). The Next.js Foxy route calls ``POST /v1/classify`` fire-and-
forget and publishes a ``learner.turn_classified`` observability event.

Modules:
    - :mod:`.models`      — ClassifyTurnRequest / TurnClassificationResponse
    - :mod:`.prompts`     — system + user prompt builders (CBSE grade/subject scope)
    - :mod:`.classifier`  — MOL call + JSON coercion (fail-safe)

OBSERVABILITY ONLY — this never writes a mastery surface.
"""

from __future__ import annotations

from .classifier import ClassificationError, classify_turn
from .models import ClassifyTurnRequest, TurnClassificationResponse

__all__ = [
    "ClassificationError",
    "ClassifyTurnRequest",
    "TurnClassificationResponse",
    "classify_turn",
]
