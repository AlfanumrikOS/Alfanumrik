"""v1 API surface.

Stable contract — breaking changes require a /v2 prefix, not a mutation.
"""

from . import generate

__all__ = ["generate"]
