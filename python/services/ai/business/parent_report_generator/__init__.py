"""parent-report-generator - AI-powered weekly parent report (template-only path).

Pythonized port of supabase/functions/parent-report-generator/index.ts.
Phase 2 port covers the data-aggregation + template-based fallback path;
the Claude call (TS lines 250-310) is INTENTIONALLY deferred to Phase 2.5
since the TS already has buildFallbackReport as the failover when Claude
is unavailable. Our path always uses the template - which is identical to
what students see when Claude rate-limits or 5xx's. Phase 2.5 will wire
MoL for the LLM-shaped narrative variant.

Public entrypoint: build_parent_report
"""

from .handler import (
    GuardianNotLinkedError,
    HandlerError,
    UnauthorizedError,
    build_parent_report,
)
from .models import (
    ParentReportRequest,
    ParentReportResponse,
    WeeklyReport,
    WeeklyStats,
)

__all__ = [
    "GuardianNotLinkedError",
    "HandlerError",
    "ParentReportRequest",
    "ParentReportResponse",
    "UnauthorizedError",
    "WeeklyReport",
    "WeeklyStats",
    "build_parent_report",
]
