"""Database client layer.

Only the async Supabase service-role client lives here. Phase 1 may add
read-side helpers (concept graph reads, learner-state reads), but Phase 0
keeps the surface minimal — telemetry writes are the only DB I/O.
"""

from .supabase import get_service_client, reset_service_client

__all__ = ["get_service_client", "reset_service_client"]
