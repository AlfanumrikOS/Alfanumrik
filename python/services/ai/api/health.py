"""Health + readiness endpoints.

- ``GET /live`` (liveness): static 200; never checks external deps. Used
  by Cloud Run / Kubernetes to decide whether to restart the container.
  Named ``/live`` (not ``/healthz``) because Cloud Run's frontend
  intercepts the path ``/healthz`` before it reaches the container and
  returns Google's own 404 HTML page (confirmed 2026-05-24).
- ``GET /readyz`` (readiness): checks Supabase + that at least one provider
  has an API key. 200 when ready; 503 when not. Used by load balancers to
  decide whether to send traffic.
"""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from ..config import get_settings
from ..db.supabase import ping_supabase

router = APIRouter(tags=["health"])


@router.get("/live", summary="Liveness probe")
async def live() -> dict:
    """Always-200 liveness probe.

    No external deps — if the process is up, it's live. Restart decisions
    are driven by this endpoint, so don't add I/O that could flap.

    Path is ``/live`` rather than ``/healthz`` because Cloud Run's
    frontend intercepts ``/healthz`` before it reaches the container
    (Google returns its own 404 HTML page for that path).
    """
    return {"status": "ok"}


@router.get("/readyz", summary="Readiness probe")
async def readyz(response: Response) -> dict:
    """Readiness probe: Supabase pingable + at least one provider keyed.

    Returns 200 + ``{"status":"ready", checks: {...}}`` when both checks
    pass; 503 + ``{"status":"degraded", ...}`` otherwise. The check map
    is intentionally human-readable so an operator can `curl /readyz` and
    see which dep is failing.
    """
    s = get_settings()
    supabase_ok = await ping_supabase()
    providers_ok = bool(s.anthropic_api_key) or bool(s.openai_api_key)
    # Voice 1b — Azure Speech is OPTIONAL capability. We surface it on
    # /readyz for operator visibility but do NOT include it in the
    # providers_ok gating: a service without Azure keys should still be
    # added to rotation; the TTS endpoint returns 503 per-request when
    # the key is missing. Same posture as Anthropic/OpenAI vs Whisper.
    azure_speech_ok = bool(s.azure_speech_key and s.azure_speech_region)

    checks = {
        "supabase": supabase_ok,
        "providers": providers_ok,
        "providers_detail": {
            "anthropic": bool(s.anthropic_api_key),
            "openai": bool(s.openai_api_key),
        },
        "azure_speech": azure_speech_ok,
    }

    if supabase_ok and providers_ok:
        return {"status": "ready", "checks": checks}

    response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "degraded", "checks": checks}
