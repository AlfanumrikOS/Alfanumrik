"""Daily INR budget guard.

Queries ``public.mol_request_logs`` for today's ``sum(inr_cost)`` and
blocks new requests when the running total exceeds a configured cap.
Defense against runaway loops, compromised credentials, or pathologically
large prompts that would burn budget unnoticed until the monthly review.

Scope (Phase 2): single org-level cap (no per-tenant breakdown). The
``scope`` parameter is plumbed through so a Phase 3 per-tenant extension
is a small change rather than a rewrite (see
``docs/PYTHON_AI_LONG_TERM_VISION.md`` section 6).

Adoption pattern at the start of a handler:

    from services.ai.shared.budget_guard import check_daily_budget, BudgetExceeded

    @router.post("/v1/foxy-tutor")
    async def foxy(req: FoxyRequest):
        if not await check_daily_budget(scope="org"):
            raise BudgetExceeded("daily AI budget exceeded — try again tomorrow")
        ...

Failure mode: ``check_daily_budget`` is **fail-OPEN** on Supabase
errors (returns True with a logged warning). The user-facing contract
is "if the cap is reached, block"; if we can't read the cap, blocking
every request would amplify a Supabase outage into a total AI outage.
The trade-off is that a Supabase outage during a budget-exceeded
window briefly lets some calls through; budget review the next morning
catches it.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from typing import Final, Literal

import httpx
import structlog
from postgrest.exceptions import APIError as PostgrestAPIError

from ..db.supabase import get_service_client

logger = structlog.get_logger(__name__)

BudgetScope = Literal["org", "tenant"]

# Default daily cap in INR. Phase 2 floor is 5000 — chosen as ~10x current
# admin daily spend so we never accidentally block legitimate traffic at
# the cap. Production override via env: DAILY_AI_BUDGET_INR_CAP.
DEFAULT_DAILY_CAP_INR: Final[float] = 5000.0


class BudgetExceeded(Exception):
    """Raised by callers when ``check_daily_budget`` returns False.

    Routes should catch and map to HTTP 429 (Too Many Requests) with a
    Retry-After header pointing at the next UTC midnight.
    """


def _default_cap_from_env() -> float:
    """Read the cap from env or fall back to ``DEFAULT_DAILY_CAP_INR``."""
    raw = os.environ.get("DAILY_AI_BUDGET_INR_CAP")
    if not raw:
        return DEFAULT_DAILY_CAP_INR
    try:
        return float(raw)
    except ValueError:
        logger.warning(
            "budget_guard.invalid_env",
            DAILY_AI_BUDGET_INR_CAP=raw,
            using_default=DEFAULT_DAILY_CAP_INR,
        )
        return DEFAULT_DAILY_CAP_INR


def _today_utc_iso() -> str:
    """Return today's date in UTC as ISO-8601 (YYYY-MM-DD).

    All ``mol_request_logs`` timestamps are UTC (Postgres TIMESTAMPTZ
    default); using UTC for the window boundary keeps the cap math
    consistent regardless of which timezone the request originated in.
    """
    return datetime.now(UTC).date().isoformat()


def _utc_day_window() -> tuple[str, str]:
    """Return ``(today_start, tomorrow_start)`` as ISO-8601 UTC midnight markers.

    Used as a HALF-OPEN interval ``[today_start, tomorrow_start)`` to avoid the
    1-microsecond gap that a ``<= 23:59:59.999999Z`` upper bound leaves open
    (Postgres TIMESTAMPTZ has sub-microsecond resolution; any row recorded
    between :59.999999000 and the next :00.000000000 would slip through).
    """
    today = datetime.now(UTC).date()
    tomorrow = today + timedelta(days=1)
    return (f"{today.isoformat()}T00:00:00Z", f"{tomorrow.isoformat()}T00:00:00Z")


async def check_daily_budget(
    *,
    scope: BudgetScope = "org",
    cap_inr: float | None = None,
    tenant_id: str | None = None,
) -> bool:
    """Return True iff today's spend is under the cap.

    Args:
        scope: ``'org'`` queries ALL rows for today (org-level cap).
            ``'tenant'`` requires ``tenant_id`` and filters by it (Phase 3
            future use — Phase 2 returns True with a logged warning if
            scope='tenant' is passed without tenant-cap infrastructure).
        cap_inr: override the cap for this check. Defaults to env
            ``DAILY_AI_BUDGET_INR_CAP`` or
            :data:`DEFAULT_DAILY_CAP_INR`.
        tenant_id: required when ``scope='tenant'``; ignored otherwise.

    Returns:
        True if today's running ``sum(inr_cost)`` is strictly less than
        the cap; False if at or above the cap.

    Failure mode (fail-OPEN):
        Returns True with a logged warning if Supabase is unreachable or
        the query errors. The trade-off rationale is documented in the
        module docstring.
    """
    effective_cap = cap_inr if cap_inr is not None else _default_cap_from_env()
    if effective_cap <= 0:
        logger.warning(
            "budget_guard.invalid_cap",
            cap_inr=effective_cap,
            action="failing_open",
        )
        return True

    if scope == "tenant" and not tenant_id:
        logger.warning(
            "budget_guard.tenant_scope_without_id",
            action="failing_open",
        )
        return True

    client = get_service_client()
    if client is None:
        # No Supabase configured — local dev / pytest. Fail open.
        logger.debug("budget_guard.no_supabase_client", action="failing_open")
        return True

    today_start, tomorrow_start = _utc_day_window()
    try:
        # We pull today's rows and sum INR-cost client-side. PostgREST does
        # not support server-side aggregations in a single .select() call
        # without an explicit RPC, so for the Phase 2 floor we accept the
        # row read. At the current ~50k rows/day floor the payload is
        # bounded (~6 MB worst case for inr_cost-only); Phase 4 swaps for
        # a SECURITY DEFINER RPC `sum_inr_cost_today()` that returns a
        # single number.
        query = client.table("mol_request_logs").select("inr_cost")
        # Day window: HALF-OPEN [today_start, tomorrow_start). Closing the
        # window at the next UTC midnight (strict less-than) avoids the
        # 1-microsecond hole that a ``<= 23:59:59.999999Z`` upper bound
        # leaves open at sub-microsecond Postgres TIMESTAMPTZ resolution.
        # PostgREST filter syntax — gte/lt on ISO timestamps is OK because
        # TIMESTAMPTZ compares correctly against ISO-date prefixes.
        query = query.gte("created_at", today_start)
        query = query.lt("created_at", tomorrow_start)
        if scope == "tenant":
            # When the schema gains tenant_id, this filter becomes
            # .eq('tenant_id', tenant_id). Until then, the query returns
            # all rows and we fail-open below.
            logger.debug("budget_guard.tenant_scope_phase2_floor")

        result = await query.execute()
        rows = getattr(result, "data", None)
        if rows is None and isinstance(result, dict):
            rows = result.get("data") or []
        rows = rows or []

        total = sum(float(r.get("inr_cost") or 0.0) for r in rows)
        under = total < effective_cap
        logger.info(
            "budget_guard.checked",
            scope=scope,
            tenant_id=tenant_id,
            today_total_inr=round(total, 4),
            cap_inr=effective_cap,
            under_cap=under,
        )
        return under
    except TypeError as err:
        # ``await`` on a non-awaitable raises TypeError. This would happen if
        # ``get_service_client`` ever returns a SYNC postgrest client (it
        # currently returns AsyncPostgrestClient). Catching it here so the
        # bug surfaces in logs as an explicit signal rather than silently
        # masquerading as a "Supabase down" fail-open. We still fail-open
        # to preserve the user-facing contract (budget cap should not break
        # AI traffic), but the log line is distinct and loud.
        logger.error(
            "budget_guard.await_on_non_awaitable",
            error=str(err),
            action="failing_open_BUG_FIX_REQUIRED",
            hint="get_service_client() may have returned a sync client; check db/supabase.py",
        )
        return True
    except (PostgrestAPIError, httpx.RequestError) as err:
        # Specific Supabase / network failures — fail-open by contract
        # (documented trade-off in the module docstring).
        logger.warning(
            "budget_guard.query_failed",
            error=str(err),
            error_type=type(err).__name__,
            action="failing_open",
        )
        return True
