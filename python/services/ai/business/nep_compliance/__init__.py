"""nep-compliance - NEP 2020 Holistic Progress Card generator/reader.

Pythonized port of supabase/functions/nep-compliance/index.ts. Generates and
retrieves NEP 2020 HPC for students; maps mastery to competency frameworks.
No LLM call; pure data aggregation across 5 Supabase tables.

Public entrypoint: handle_nep_compliance
"""

from .handler import (
    HandlerError,
    StudentNotFoundError,
    UnauthorizedError,
    handle_nep_compliance,
)
from .models import (
    HPCReport,
    NepComplianceRequest,
    NepComplianceResponse,
)

__all__ = [
    "HPCReport",
    "HandlerError",
    "NepComplianceRequest",
    "NepComplianceResponse",
    "StudentNotFoundError",
    "UnauthorizedError",
    "handle_nep_compliance",
]
