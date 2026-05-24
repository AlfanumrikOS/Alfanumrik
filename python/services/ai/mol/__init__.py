"""Model Orchestration Layer (MoL) — Python port.

Mirrors :file:`supabase/functions/_shared/mol/` byte-for-byte at the API level:
- Same ``TaskType`` enum values
- Same ``BASE_MATRIX`` provider-chain shape
- Same ``mol_request_logs`` row contract (so existing dashboards keep working)
- Same per-1M-token PRICING table (kept in sync — change both or neither)

Entry point is :func:`generate_response`. Direct callers should pass a
:class:`GenerateRequest` and receive a :class:`MolResult`.
"""

from .errors import MolError, classify_error
from .orchestrator import generate_response
from .router import (
    BASE_MATRIX,
    PASS2_SIMPLIFY_MAX,
    get_max_tokens,
    get_simplify_max_tokens,
    select_provider_chain,
)
from .types import (
    ExamGoal,
    GenerateConfig,
    GenerateRequest,
    Language,
    MolResult,
    Pass,
    ProviderResponse,
    ProviderTarget,
    SelectedChain,
    StudentContext,
    TaskType,
    TokenUsage,
)

__all__ = [
    "BASE_MATRIX",
    "ExamGoal",
    "GenerateConfig",
    "GenerateRequest",
    "Language",
    "MolError",
    "MolResult",
    "PASS2_SIMPLIFY_MAX",
    "Pass",
    "ProviderResponse",
    "ProviderTarget",
    "SelectedChain",
    "StudentContext",
    "TaskType",
    "TokenUsage",
    "classify_error",
    "generate_response",
    "get_max_tokens",
    "get_simplify_max_tokens",
    "select_provider_chain",
]
