"""App-import smoke test.

Guards against bad middleware/dependency imports silently breaking the
FastAPI service boot (Phase 0.5). This test exists because CI was green
while ``services.ai.api.main`` raised ``ImportError`` at module load — a
hallucinated ``RateLimitHeadersMiddleware`` symbol that slowapi 0.1.9 does
not export. The bug surfaced only when the integration suite tried to
import the app; the cheap fix is to import it here too, in the fast unit
tier.
"""

from __future__ import annotations


def test_fastapi_app_imports():
    """The Python AI service must be importable.

    A failure here means module-level code in ``main.py`` (imports,
    middleware registration, or the ``create_app()`` factory) raised at
    import time — the app would not boot under uvicorn/Cloud Run.
    """
    from services.ai.api.main import app, create_app

    assert app is not None
    assert create_app() is not None
