"""Abstract base for MoL providers.

Mirrors :file:`supabase/functions/_shared/mol/providers/base.ts` shape:
- ``id`` discriminator
- ``default_model`` for fallback paths
- ``is_configured()`` so the orchestrator can skip un-keyed providers
- ``call(...)`` async I/O returning a ProviderResponse

The Python ``call`` signature elevates ``temperature`` to a first-class
parameter so callers can pass ``0`` for deterministic verdicts. The TS
surface accepts an optional ``temperature`` but no caller currently sets
it — this is the gap we're closing on the Python side from day one.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Literal

from ..types import ChatTurn, ProviderResponse

ProviderId = Literal["openai", "anthropic"]


@dataclass
class ProviderConfig:
    """Knobs for a single provider.call() invocation."""

    system_prompt: str
    user_messages: list[ChatTurn]
    max_tokens: int
    temperature: float = 0.7
    timeout_seconds: int = 20
    image_url: str | None = None  # vision-capable providers only


@dataclass
class ProviderCallResult:
    """OK/error envelope for retry helpers (mirrors TS ProviderCallResult)."""

    ok: bool
    response: ProviderResponse | None = None
    error: str = ""
    status: int | None = None
    retryable: bool = False
    extras: dict = field(default_factory=dict)


class ModelProvider(ABC):
    """Common surface for OpenAI + Anthropic providers."""

    id: ProviderId
    default_model: str

    @abstractmethod
    def is_configured(self) -> bool:
        """True iff the API key is available. Orchestrator skips when False."""

    @abstractmethod
    async def call(
        self,
        *,
        model: str,
        system_prompt: str,
        user_messages: list[ChatTurn],
        max_tokens: int,
        temperature: float = 0.7,
        timeout_seconds: int = 20,
        image_url: str | None = None,
    ) -> ProviderResponse:
        """Issue one chat-completion call and return a normalized response.

        ``temperature`` is a first-class parameter (default 0.7). Callers
        running deterministic verdicts (graders, evaluators) MUST pass 0.
        """


# ── Status classification ────────────────────────────────────────────────────


def is_retryable_status(status: int) -> bool:
    """Mirror TS ``isRetryable`` — 429 / 500 / 502 / 503 / 529 are retryable."""
    return status in {429, 500, 502, 503, 529}
