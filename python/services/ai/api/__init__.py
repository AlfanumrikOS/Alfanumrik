"""FastAPI app package.

Only ``main:app`` is the public entry — sub-routers live in :mod:`.v1` and
should be mounted via :func:`create_app`.
"""

from .main import app, create_app

__all__ = ["app", "create_app"]
