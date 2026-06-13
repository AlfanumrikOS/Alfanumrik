# MOL Python Unification & Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Python (Cloud Run / FastAPI) Model Orchestration Layer the single, hardened, OpenAI-priority orchestration brain — deterministic routing, a cross-instance circuit breaker, enforced cost caps, a semantic cache, SSE streaming, and a quality-eval cutover gate — then finish the strangler-fig flag cutover and delete the Deno MOL.

**Architecture:** Python Cloud Run becomes the one orchestration brain; Deno Edge Functions + Next.js routes become thin clients that do auth + RAG retrieval, call the Python MOL endpoint via `python-ai-proxy.ts`, and stream the response back. Reliability/cost/quality/latency gaps are closed in Python (`python/services/ai/mol/`), each behind a feature flag, so every phase leaves the system green and is independently shippable. Cutover is per-function (`ff_python_*_v1`) with a `PYTHON_AI_BASE_URL` kill-switch and a parity dashboard gate.

**Tech Stack:** Python 3.x, FastAPI, pytest, httpx, Upstash Redis, Supabase; Deno/TS thin clients; feature-flag-gated strangler-fig cutover.

---

## File Structure

| File | Create / Modify | Single responsibility |
|---|---|---|
| `python/services/ai/mol/router.py` | Modify (lines ~137-237) | Deterministic OpenAI-priority selection; probabilistic `weights`/`random` path gated behind a shadow flag toggle (`shadow_priority` on `RouterOptions`). |
| `python/services/ai/mol/orchestrator.py` | Modify (lines ~135-204, ~210-262) | Wire the shadow-priority flag into `RouterOptions`; wire the breaker + cost-cap + semantic-cache short-circuit into the generate flow and `_execute_pass`. |
| `python/services/ai/mol/breaker.py` | Create | Cross-instance circuit breaker (Upstash Redis) — `can_request` / `record_failure` / `record_success`, keyed `(provider, task_type)`, fail-open. |
| `python/services/ai/mol/cost_cap.py` | Create | Per-task ₹/token ceiling table + `enforce_cost_cap()` that raises `COST_CAP_EXCEEDED` before any provider call. |
| `python/services/ai/mol/cache.py` | Create | Semantic (exact-match, Upstash Redis) cache keyed `(task_type, grade, subject, normalized_query)`; skip-rules for low-confidence / personalized output. |
| `python/services/ai/mol/redis_client.py` | Create | Lazy, cached Upstash Redis REST client shared by `breaker.py` + `cache.py`; returns `None` when unconfigured (fail-open). |
| `python/services/ai/mol/eval/__init__.py` | Create | Package marker for the eval harness. |
| `python/services/ai/mol/eval/harness.py` | Create | Golden-set quality harness; runs the existing grader over a fixture set, compares to a baseline tolerance, returns a pass/fail gate verdict. |
| `python/services/ai/mol/eval/golden_set.py` | Create | Tiny in-repo golden-set fixture (question + grade + baseline answer + expected-overall floor per task type). |
| `python/services/ai/api/v1/generate.py` | Modify (add route after line 87) | Add `POST /v1/generate/stream` SSE endpoint that streams MOL output and handles client cancellation. |
| `python/services/ai/config.py` | Modify (add fields after line 49) | Add `upstash_redis_rest_url` / `upstash_redis_rest_token` settings. |
| `python/requirements.txt` | Modify (append) | Add `upstash-redis` dependency. |
| `python/pyproject.toml` | Modify (line ~34 area) | Add `upstash-redis` to `dependencies`. |
| `python/tests/unit/test_router.py` | Modify | Add deterministic-priority tests (OpenAI always primary unless OPEN / override). |
| `python/tests/unit/test_breaker.py` | Create | CLOSED→OPEN→HALF-OPEN→CLOSE transitions + fail-open. |
| `python/tests/unit/test_cost_cap.py` | Create | Over-ceiling raises `COST_CAP_EXCEEDED` before HTTP. |
| `python/tests/unit/test_cache.py` | Create | hit / miss / skip-rules. |
| `python/tests/unit/test_eval_harness.py` | Create | Golden-set pass/fail vs tolerance. |
| `python/tests/integration/test_generate_stream_endpoint.py` | Create | SSE chunking + client cancellation. |
| `python/tests/integration/test_routing_parity.py` | Create | TS↔Python identical routing decision + `mol_request_logs` telemetry shape (golden cassettes). |
| `docs/runbooks/2026-06-13-mol-python-cutover.md` | Create | Strangler-fig cutover runbook (flag order, 5%→48h→100%→delete gate, kill-switch). |
| `.claude/regression-catalog.md` | Modify (append) | REG-120..REG-124 entries. |

> **Flags introduced:** `ff_mol_deterministic_priority` (Task 1), `ff_mol_circuit_breaker_v1` (Task 2), `ff_mol_cost_cap_v1` (Task 3), `ff_mol_semantic_cache` (Task 4), `ff_mol_stream_v1` (Task 5), plus the per-function `ff_python_*_v1` flags consumed in Task 8. All default OFF; the existing `feature_flag.is_flag_enabled` reader (DJB-2 rollout bucket) gates them.

---

## Phase 1 — Deterministic OpenAI-priority routing (spec A2)

Replace the `random.random()` primary selection in `router.py` with a deterministic OpenAI-first reorder. Retain the probabilistic `weights`/`random` mechanism ONLY behind a new `shadow_priority` flag on `RouterOptions`, wired to `ff_mol_deterministic_priority` in the orchestrator. Guarantee: OpenAI is always primary unless the chain has no OpenAI rung, or a per-task `preferred_provider` override (applied later in the orchestrator) reorders it, or the OpenAI circuit is OPEN (Phase 2).

### Task 1.1 — Add `shadow_priority` to `RouterOptions` and make selection deterministic

**Files:**
- Modify: `python/services/ai/mol/router.py` (`RouterOptions` ~lines 137-144; `select_provider_chain` Step 4 ~lines 199-219)
- Test: `python/tests/unit/test_router.py`

**Steps:**

- [ ] **Step 1 — Write the failing test.** Append to `python/tests/unit/test_router.py`:
```python
# ─── Deterministic OpenAI-priority (spec A2) ────────────────────────────────


def test_deterministic_priority_makes_openai_primary_without_random():
    """With shadow_priority OFF (default), the openai rung is always primary —
    no dependence on random.random()."""
    for task in ("explanation", "concept_explanation", "step_by_step",
                 "quiz_generation", "evaluation", "grounding_check"):
        selected = select_provider_chain(task, _opts())
        first = selected.passes[0].chain[0]
        assert first.provider == "openai", f"{task} should be openai-primary"


def test_deterministic_priority_reasoning_promotes_openai_first():
    """reasoning has a gpt-4o rung; deterministic priority pulls it to the head."""
    selected = select_provider_chain("reasoning", _opts())
    first = selected.passes[0].chain[0]
    assert first.provider == "openai"
    assert first.model == GPT_FULL


def test_deterministic_priority_is_stable_across_calls():
    """Two identical calls must yield byte-identical chains (no randomness)."""
    a = select_provider_chain("explanation", _opts())
    b = select_provider_chain("explanation", _opts())
    assert [(t.provider, t.model) for t in a.passes[0].chain] == \
           [(t.provider, t.model) for t in b.passes[0].chain]


def test_shadow_priority_on_uses_weights_and_random():
    """shadow_priority=True restores the probabilistic path: w=0.8 < random(0.9)
    leaves anthropic primary for reasoning."""
    from unittest.mock import patch

    with patch("services.ai.mol.router.random.random", return_value=0.9):
        selected = select_provider_chain(
            "reasoning",
            _opts(shadow_priority=True, weights={"reasoning": 0.8}),
        )
    assert selected.passes[0].chain[0].provider == "anthropic"


def test_deterministic_priority_noop_when_chain_has_no_openai():
    """A chain with only anthropic rungs stays anthropic-first (nothing to promote)."""
    from services.ai.mol import router as router_mod

    original = router_mod.BASE_MATRIX["evaluation"]
    try:
        router_mod.BASE_MATRIX["evaluation"] = [
            {"role": "single", "chain": [{"provider": "anthropic", "model": HAIKU}]}
        ]
        selected = select_provider_chain("evaluation", _opts())
        assert all(t.provider == "anthropic" for t in selected.passes[0].chain)
    finally:
        router_mod.BASE_MATRIX["evaluation"] = original
```

- [ ] **Step 2 — Run it, expect FAIL.** `RouterOptions` has no `shadow_priority` field, so `_opts(shadow_priority=True)` raises `TypeError`, and the default path is still random-dependent.
```
cd python && pytest tests/unit/test_router.py::test_deterministic_priority_makes_openai_primary_without_random tests/unit/test_router.py::test_shadow_priority_on_uses_weights_and_random -v
```
Expected: `TypeError: __init__() got an unexpected keyword argument 'shadow_priority'` and FAILED on the deterministic assertions.

- [ ] **Step 3 — Write the minimal implementation.** In `python/services/ai/mol/router.py`, add the field to `RouterOptions` (after line 144):
```python
@dataclass
class RouterOptions:
    """Per-call routing knobs. Mirrors TS ``RouterOptions``."""

    hybrid_enabled: bool = False
    openai_default: bool = False
    # Per-task weight in [0,1]. weights[task] > 0.5 ⇒ openai becomes primary.
    weights: dict[str, float] = field(default_factory=dict)
    # A2: when False (default, live path), priority is DETERMINISTIC — OpenAI
    # is always the primary rung. When True (gated by ff_mol_deterministic_priority
    # being OFF → shadow/experiment), restore the legacy probabilistic
    # weights/random reorder. The flag name is inverted on purpose: the flag
    # turns the *deterministic* path ON; shadow_priority is the negation.
    shadow_priority: bool = False
```
Then replace Step 4 of `select_provider_chain` (the `w = opts.weights.get(task)` block through the `else:` reorder, ~lines 199-219) with:
```python
    # Step 4: priority selection.
    if opts.shadow_priority:
        # Shadow/experiment ONLY: legacy probabilistic 80%-to-OpenAI path.
        w = opts.weights.get(task)
        if not isinstance(w, (int, float)):
            w = 0.8
        head_provider = "openai" if random.random() < w else "anthropic"
    else:
        # A2 live path: OpenAI is ALWAYS primary. Deterministic, no randomness.
        head_provider = "openai"

    for p in passes_raw:
        target = next((t for t in p["chain"] if t["provider"] == head_provider), None)
        if target is None:
            continue
        rest = [t for t in p["chain"] if t is not target]
        p["chain"] = [target, *rest]
```

- [ ] **Step 4 — Run the test, expect PASS.**
```
cd python && pytest tests/unit/test_router.py -v
```
Expected: all router tests pass, including the existing `test_weight_above_random_promotes_openai_primary` / `test_weight_below_random_promotes_anthropic_primary` (those tests must be updated in Step 4b below to pass `shadow_priority=True`, since they assert the probabilistic behavior).

- [ ] **Step 4b — Repair the two legacy probabilistic tests.** In `python/tests/unit/test_router.py`, update the two weight tests to opt into the shadow path:
```python
@patch("services.ai.mol.router.random.random", return_value=0.1)
def test_weight_above_random_promotes_openai_primary(mock_rand):
    """w=0.8 > random(0.1) ensures the openai rung is primary."""
    selected = select_provider_chain(
        "reasoning", _opts(shadow_priority=True, weights={"reasoning": 0.8})
    )
    first = selected.passes[0].chain[0]
    assert first.provider == "openai"


@patch("services.ai.mol.router.random.random", return_value=0.9)
def test_weight_below_random_promotes_anthropic_primary(mock_rand):
    """w=0.8 < random(0.9) leaves anthropic as primary."""
    selected = select_provider_chain(
        "reasoning", _opts(shadow_priority=True, weights={"reasoning": 0.8})
    )
    first = selected.passes[0].chain[0]
    assert first.provider == "anthropic"
```
Re-run `cd python && pytest tests/unit/test_router.py -v`; expected: all pass.

- [ ] **Step 5 — Commit.**
```
git add python/services/ai/mol/router.py python/tests/unit/test_router.py && git commit -m "feat(mol): deterministic OpenAI-priority routing; gate probabilistic path behind shadow flag (A2)"
```

### Task 1.2 — Wire `ff_mol_deterministic_priority` into the orchestrator

**Files:**
- Modify: `python/services/ai/mol/orchestrator.py` (flags gather ~lines 242-262)
- Test: `python/tests/integration/test_generate_endpoint.py`

**Steps:**

- [ ] **Step 1 — Write the failing test.** Append to `python/tests/integration/test_generate_endpoint.py`:
```python
def test_generate_uses_openai_primary_when_deterministic_flag_on(
    client: TestClient, openai_default_route, mock_supabase_client, monkeypatch
):
    """When ff_mol_deterministic_priority is ON, OpenAI is the primary provider
    and the call resolves on the first (OpenAI) rung."""

    async def _flag(name, **kwargs):
        return name == "ff_mol_deterministic_priority"

    monkeypatch.setattr("services.ai.mol.orchestrator.is_flag_enabled", _flag)
    payload = {
        "task_type": "reasoning",
        "input": {"question": "Prove the Pythagoras theorem."},
        "student_context": {"student_id": "33333333-3333-3333-3333-333333333333", "grade": "9"},
    }
    res = client.post("/v1/generate", json=payload)
    assert res.status_code == 200, res.text
    assert res.json()["provider"] == "openai"
```

- [ ] **Step 2 — Run it, expect FAIL.** The orchestrator never reads `ff_mol_deterministic_priority`, so `shadow_priority` is hard-wired False already (default) — but `reasoning` is anthropic-first in BASE_MATRIX and the orchestrator does not yet pass `shadow_priority`. Without the flag wiring the deterministic path is the implicit default; this test specifically pins that the flag is *read* so a future "default OFF → shadow" flip is testable. Run:
```
cd python && pytest tests/integration/test_generate_endpoint.py::test_generate_uses_openai_primary_when_deterministic_flag_on -v
```
Expected: FAIL — `assert "anthropic" == "openai"` (the orchestrator currently constructs `RouterOptions` without `shadow_priority`, and because `_disable_flag_network` forces all flags False, the legacy probabilistic path is still active inside `select_provider_chain`'s default branch only after Task 1.1; before wiring, `shadow_priority` defaults False so this actually passes — to force a real RED, first assert the flag read).

- [ ] **Step 2b — Make the RED real.** Add an assertion that the orchestrator read the flag by spying. Replace the test body's call with a spy that records flag names:
```python
def test_generate_reads_deterministic_priority_flag(
    client: TestClient, openai_default_route, mock_supabase_client, monkeypatch
):
    seen: list[str] = []

    async def _flag(name, **kwargs):
        seen.append(name)
        return False

    monkeypatch.setattr("services.ai.mol.orchestrator.is_flag_enabled", _flag)
    payload = {
        "task_type": "explanation",
        "input": {"question": "?"},
        "student_context": {"student_id": "x", "grade": "8"},
    }
    client.post("/v1/generate", json=payload)
    assert "ff_mol_deterministic_priority" in seen
```
```
cd python && pytest tests/integration/test_generate_endpoint.py::test_generate_reads_deterministic_priority_flag -v
```
Expected: FAILED — `assert 'ff_mol_deterministic_priority' in []` (orchestrator never reads it).

- [ ] **Step 3 — Write the minimal implementation.** In `python/services/ai/mol/orchestrator.py`, extend the parallel flag gather (Step 3, ~lines 242-252) to read the new flag and pass `shadow_priority` (negation) into `RouterOptions`:
```python
    # Step 3 — flags + weights in parallel
    hybrid_on, openai_default, deterministic_on, weights = await asyncio.gather(
        is_flag_enabled(
            "ff_mol_hybrid_mode_v1",
            student_id=req.student_context.student_id,
        ),
        is_flag_enabled(
            "ff_mol_openai_default",
            student_id=req.student_context.student_id,
        ),
        is_flag_enabled(
            "ff_mol_deterministic_priority",
            student_id=req.student_context.student_id,
        ),
        get_routing_weights(),
    )

    # Step 4 — router
    selected = select_provider_chain(
        task_type,
        RouterOptions(
            hybrid_enabled=hybrid_on,
            openai_default=openai_default,
            weights=weights,
            # deterministic ON ⇒ shadow_priority OFF (OpenAI always primary).
            # deterministic OFF ⇒ legacy probabilistic path (shadow/experiment).
            shadow_priority=not deterministic_on,
        ),
    )
```

- [ ] **Step 4 — Run the test, expect PASS.** Run both the spy test and the openai-primary test:
```
cd python && pytest tests/integration/test_generate_endpoint.py -v
```
Expected: all pass.

- [ ] **Step 5 — Commit.**
```
git add python/services/ai/mol/orchestrator.py python/tests/integration/test_generate_endpoint.py && git commit -m "feat(mol): wire ff_mol_deterministic_priority into orchestrator routing (A2)"
```

---

## Phase 2 — Cross-instance circuit breaker (spec A3)

Add a Redis client wrapper, the breaker state machine, and wire `can_request` / `record_failure` / `record_success` into `_execute_pass`. State machine: CLOSED → (3 failures in 10s) → OPEN → (30s) → HALF-OPEN → (2 consecutive successes) → CLOSE. Key: `(provider, task_type)`. Fail-open when Redis is unreachable (treat as CLOSED, log).

### Task 2.1 — Add the Upstash Redis dependency + settings + lazy client

**Files:**
- Modify: `python/requirements.txt` (append), `python/pyproject.toml` (dependencies ~line 34), `python/services/ai/config.py` (after line 49)
- Create: `python/services/ai/mol/redis_client.py`
- Test: `python/tests/unit/test_breaker.py` (client section)

**Steps:**

- [ ] **Step 1 — Write the failing test.** Create `python/tests/unit/test_breaker.py`:
```python
"""Cross-instance circuit-breaker tests — Redis-backed state machine."""

from __future__ import annotations

from services.ai.mol.redis_client import get_redis_client


def test_redis_client_is_none_when_unconfigured():
    """No UPSTASH_REDIS_REST_URL → get_redis_client() returns None (fail-open)."""
    assert get_redis_client() is None
```

- [ ] **Step 2 — Run it, expect FAIL.**
```
cd python && pytest tests/unit/test_breaker.py::test_redis_client_is_none_when_unconfigured -v
```
Expected: `ModuleNotFoundError: No module named 'services.ai.mol.redis_client'`.

- [ ] **Step 3 — Write the minimal implementation.** Add to `python/requirements.txt`:
```
# upstash-redis: serverless Redis REST client. Backs the cross-instance MOL
# circuit breaker (mol/breaker.py) and semantic cache (mol/cache.py). Cloud Run
# is multi-instance so in-process state cannot be shared; Upstash REST is the
# shared store. Fail-open: when unconfigured the client is None and callers
# behave as if the breaker is CLOSED / the cache is empty.
upstash-redis>=1.2,<2.0
```
Add the same line to `python/pyproject.toml` `dependencies` (after `"pybreaker>=1.3.0,<2.0",`):
```toml
  "upstash-redis>=1.2,<2.0",
```
Add to `python/services/ai/config.py` `Settings` (after line 49, the provider keys block):
```python
    # ── Upstash Redis (cross-instance breaker + semantic cache) ──
    # Empty defaults so the service still BOOTS in CI/test. When empty the
    # breaker fails OPEN→CLOSED (never blocks) and the cache is a no-op.
    upstash_redis_rest_url: str = Field(
        default="", description="Upstash Redis REST endpoint. Empty disables breaker store."
    )
    upstash_redis_rest_token: str = Field(
        default="", description="Upstash Redis REST token."
    )
```
Create `python/services/ai/mol/redis_client.py`:
```python
"""Lazy Upstash Redis REST client shared by the breaker + semantic cache.

Cloud Run is multi-instance, so per-process state (the TS in-worker breaker
map) cannot be shared. This module hands out one cached Upstash REST client
per process. When Upstash is not configured it returns ``None`` and every
caller is contractually required to FAIL-OPEN (breaker CLOSED, cache empty).
"""

from __future__ import annotations

from typing import Any

import structlog

from ..config import get_settings

logger = structlog.get_logger(__name__)

_client: Any | None = None
_init_attempted = False


def get_redis_client() -> Any | None:
    """Return a cached Upstash Redis client, or ``None`` if unconfigured."""
    global _client, _init_attempted
    if _client is not None:
        return _client
    if _init_attempted:
        return None

    _init_attempted = True
    s = get_settings()
    if not s.upstash_redis_rest_url or not s.upstash_redis_rest_token:
        logger.debug("mol.redis.skipped", reason="no_credentials")
        return None

    try:
        from upstash_redis.asyncio import Redis

        _client = Redis(
            url=s.upstash_redis_rest_url,
            token=s.upstash_redis_rest_token,
        )
        logger.info("mol.redis.initialized")
        return _client
    except Exception as err:  # noqa: BLE001 — breaker must never break startup
        logger.warning("mol.redis.init_failed", error=str(err))
        return None


def reset_redis_client() -> None:
    """Test-only: clear the cached client + re-arm the init attempt."""
    global _client, _init_attempted
    _client = None
    _init_attempted = False
```
Also extend the autouse `_env_isolation` fixture in `python/tests/conftest.py` to wipe + reset the Redis vars/client. In the env-prefix tuple add `"UPSTASH_"`, and after `reset_service_client()` add:
```python
    from services.ai.mol.redis_client import reset_redis_client
    reset_redis_client()
```

- [ ] **Step 4 — Run the test, expect PASS.**
```
cd python && pytest tests/unit/test_breaker.py::test_redis_client_is_none_when_unconfigured -v
```
Expected: PASS (no UPSTASH vars set in `_env_isolation`).

- [ ] **Step 5 — Commit.**
```
git add python/requirements.txt python/pyproject.toml python/services/ai/config.py python/services/ai/mol/redis_client.py python/tests/conftest.py python/tests/unit/test_breaker.py && git commit -m "feat(mol): add Upstash Redis client + settings for cross-instance breaker (A3)"
```

### Task 2.2 — Breaker state machine (CLOSED→OPEN→HALF-OPEN→CLOSE) + fail-open

**Files:**
- Create: `python/services/ai/mol/breaker.py`
- Test: `python/tests/unit/test_breaker.py`

**Steps:**

- [ ] **Step 1 — Write the failing test.** Append to `python/tests/unit/test_breaker.py`:
```python
import pytest

from services.ai.mol import breaker as breaker_mod
from services.ai.mol.breaker import (
    FAILURE_THRESHOLD,
    OPEN_TTL_SECONDS,
    SUCCESS_THRESHOLD,
    can_request,
    record_failure,
    record_success,
)


class _FakeRedis:
    """In-memory stand-in for the Upstash async client used by the breaker."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def set(self, key: str, value, ex: int | None = None):  # noqa: A003
        self.store[key] = str(value)

    async def incr(self, key: str) -> int:
        n = int(self.store.get(key, "0")) + 1
        self.store[key] = str(n)
        return n

    async def expire(self, key: str, seconds: int):
        return True

    async def delete(self, *keys: str):
        for k in keys:
            self.store.pop(k, None)


@pytest.fixture()
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    fake = _FakeRedis()
    monkeypatch.setattr(breaker_mod, "get_redis_client", lambda: fake)
    return fake


async def test_closed_breaker_allows_requests(fake_redis):
    assert await can_request("openai", "explanation") is True


async def test_three_failures_open_the_circuit(fake_redis):
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    assert await can_request("openai", "explanation") is False


async def test_open_circuit_keyed_by_provider_and_task(fake_redis):
    """OPEN on (openai, explanation) does NOT open (openai, reasoning)."""
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    assert await can_request("openai", "explanation") is False
    assert await can_request("openai", "reasoning") is True


async def test_open_transitions_to_half_open_after_ttl(fake_redis):
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    # Simulate OPEN-window expiry by deleting the OPEN marker (Upstash TTL).
    await fake_redis.delete("mol:cb:openai:explanation:state")
    # First probe after expiry is allowed (HALF-OPEN).
    assert await can_request("openai", "explanation") is True


async def test_two_successes_in_half_open_close_the_circuit(fake_redis):
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    await fake_redis.delete("mol:cb:openai:explanation:state")
    await can_request("openai", "explanation")  # enter HALF-OPEN
    for _ in range(SUCCESS_THRESHOLD):
        await record_success("openai", "explanation")
    assert await can_request("openai", "explanation") is True
    # Failure counter reset after CLOSE.
    assert fake_redis.store.get("mol:cb:openai:explanation:failures") in (None, "0")


async def test_failure_in_half_open_reopens_circuit(fake_redis):
    for _ in range(FAILURE_THRESHOLD):
        await record_failure("openai", "explanation")
    await fake_redis.delete("mol:cb:openai:explanation:state")
    await can_request("openai", "explanation")  # HALF-OPEN probe
    await record_failure("openai", "explanation")
    assert await can_request("openai", "explanation") is False


async def test_fail_open_when_redis_unreachable(monkeypatch):
    """No Redis client → can_request returns True (CLOSED), never blocks."""
    monkeypatch.setattr(breaker_mod, "get_redis_client", lambda: None)
    assert await can_request("openai", "explanation") is True
    # record_* are no-ops when fail-open — must not raise.
    await record_failure("openai", "explanation")
    await record_success("openai", "explanation")
```

- [ ] **Step 2 — Run it, expect FAIL.**
```
cd python && pytest tests/unit/test_breaker.py -v
```
Expected: `ModuleNotFoundError: No module named 'services.ai.mol.breaker'` (and `ImportError` on the breaker symbols).

- [ ] **Step 3 — Write the minimal implementation.** Create `python/services/ai/mol/breaker.py`:
```python
"""Cross-instance circuit breaker (Upstash Redis) — A3.

State machine, keyed by ``(provider, task_type)``:

    CLOSED --(FAILURE_THRESHOLD fails within FAILURE_WINDOW_SECONDS)--> OPEN
    OPEN   --(OPEN_TTL_SECONDS elapsed; OPEN marker expires)--------->  HALF-OPEN
    HALF-OPEN --(SUCCESS_THRESHOLD consecutive successes)----------->   CLOSED
    HALF-OPEN --(any failure)-------------------------------------->    OPEN

FAIL-OPEN contract: when the Redis client is None (unconfigured / unreachable)
``can_request`` returns True and the recorders are no-ops, so the breaker
never blocks a live request on store failure (spec A3 risk mitigation).

Redis keys (string values, all TTL-bounded):
    mol:cb:{provider}:{task}:failures  → INCR counter, TTL=FAILURE_WINDOW
    mol:cb:{provider}:{task}:state     → "open", TTL=OPEN_TTL (absence ⇒ not open)
    mol:cb:{provider}:{task}:halfopen  → "1" while probing
    mol:cb:{provider}:{task}:successes → INCR counter during HALF-OPEN
"""

from __future__ import annotations

import structlog

from .redis_client import get_redis_client

logger = structlog.get_logger(__name__)

FAILURE_THRESHOLD = 3
FAILURE_WINDOW_SECONDS = 10
OPEN_TTL_SECONDS = 30
SUCCESS_THRESHOLD = 2


def _k(provider: str, task: str, suffix: str) -> str:
    return f"mol:cb:{provider}:{task}:{suffix}"


async def can_request(provider: str, task: str) -> bool:
    """Return True iff a request to ``provider`` for ``task`` is permitted."""
    redis = get_redis_client()
    if redis is None:
        return True  # FAIL-OPEN
    try:
        state = await redis.get(_k(provider, task, "state"))
        if state != "open":
            # CLOSED, or OPEN marker already expired ⇒ allow.
            return True
        # OPEN marker present: only the first probe (HALF-OPEN) gets through.
        half = await redis.get(_k(provider, task, "halfopen"))
        if half == "1":
            return False  # a probe is already in flight
        # Promote to HALF-OPEN: mark probe in-flight, clear OPEN marker.
        await redis.set(_k(provider, task, "halfopen"), "1", ex=OPEN_TTL_SECONDS)
        await redis.delete(_k(provider, task, "state"))
        await redis.set(_k(provider, task, "successes"), "0", ex=OPEN_TTL_SECONDS)
        return True
    except Exception as err:  # noqa: BLE001 — never block on store failure
        logger.warning("mol.breaker.can_request_failed", provider=provider, task=task, error=str(err))
        return True  # FAIL-OPEN


async def record_failure(provider: str, task: str) -> None:
    """Record a provider failure; trip OPEN at FAILURE_THRESHOLD."""
    redis = get_redis_client()
    if redis is None:
        return
    try:
        half = await redis.get(_k(provider, task, "halfopen"))
        if half == "1":
            # Failure during a probe ⇒ straight back to OPEN.
            await redis.set(_k(provider, task, "state"), "open", ex=OPEN_TTL_SECONDS)
            await redis.delete(_k(provider, task, "halfopen"))
            await redis.delete(_k(provider, task, "successes"))
            return
        count = await redis.incr(_k(provider, task, "failures"))
        await redis.expire(_k(provider, task, "failures"), FAILURE_WINDOW_SECONDS)
        if count >= FAILURE_THRESHOLD:
            await redis.set(_k(provider, task, "state"), "open", ex=OPEN_TTL_SECONDS)
    except Exception as err:  # noqa: BLE001
        logger.warning("mol.breaker.record_failure_failed", provider=provider, task=task, error=str(err))


async def record_success(provider: str, task: str) -> None:
    """Record a provider success; CLOSE after SUCCESS_THRESHOLD in HALF-OPEN."""
    redis = get_redis_client()
    if redis is None:
        return
    try:
        half = await redis.get(_k(provider, task, "halfopen"))
        if half == "1":
            n = await redis.incr(_k(provider, task, "successes"))
            if n >= SUCCESS_THRESHOLD:
                # CLOSE: clear all breaker keys for this (provider, task).
                await redis.delete(
                    _k(provider, task, "failures"),
                    _k(provider, task, "state"),
                    _k(provider, task, "halfopen"),
                    _k(provider, task, "successes"),
                )
            return
        # Normal CLOSED success: reset the failure counter.
        await redis.set(_k(provider, task, "failures"), "0", ex=FAILURE_WINDOW_SECONDS)
    except Exception as err:  # noqa: BLE001
        logger.warning("mol.breaker.record_success_failed", provider=provider, task=task, error=str(err))
```

- [ ] **Step 4 — Run the test, expect PASS.**
```
cd python && pytest tests/unit/test_breaker.py -v
```
Expected: all breaker tests pass.

- [ ] **Step 5 — Commit.**
```
git add python/services/ai/mol/breaker.py python/tests/unit/test_breaker.py && git commit -m "feat(mol): cross-instance circuit breaker state machine + fail-open (A3)"
```

### Task 2.3 — Wire the breaker into `_execute_pass` (gated by `ff_mol_circuit_breaker_v1`)

**Files:**
- Modify: `python/services/ai/mol/orchestrator.py` (`_execute_pass` ~lines 135-204; pass a `task_type` + `breaker_on` through; generate flow reads the flag)
- Test: `python/tests/integration/test_generate_endpoint.py`

**Steps:**

- [ ] **Step 1 — Write the failing test.** Append to `python/tests/integration/test_generate_endpoint.py`:
```python
def test_generate_skips_open_breaker_provider(
    client: TestClient, respx_mock, mock_supabase_client, monkeypatch
):
    """When the OpenAI breaker is OPEN for the task, the orchestrator skips
    OpenAI and resolves on the Anthropic fallback rung."""
    from services.ai.mol import breaker as breaker_mod

    async def _flag(name, **kwargs):
        return name in ("ff_mol_circuit_breaker_v1", "ff_mol_deterministic_priority")

    monkeypatch.setattr("services.ai.mol.orchestrator.is_flag_enabled", _flag)

    async def _can_request(provider, task):
        return provider != "openai"  # OpenAI breaker OPEN

    monkeypatch.setattr(breaker_mod, "can_request", _can_request)
    monkeypatch.setattr(breaker_mod, "record_failure", lambda *a, **k: _noop())
    monkeypatch.setattr(breaker_mod, "record_success", lambda *a, **k: _noop())

    respx_mock.post("https://api.anthropic.com/v1/messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "Anthropic fallback."}],
                "usage": {"input_tokens": 5, "output_tokens": 3},
                "stop_reason": "end_turn",
            },
        )
    )
    payload = {
        "task_type": "explanation",
        "input": {"question": "?"},
        "student_context": {"student_id": "x", "grade": "8"},
    }
    res = client.post("/v1/generate", json=payload)
    assert res.status_code == 200, res.text
    assert res.json()["provider"] == "anthropic"


async def _noop():
    return None
```

- [ ] **Step 2 — Run it, expect FAIL.**
```
cd python && pytest tests/integration/test_generate_endpoint.py::test_generate_skips_open_breaker_provider -v
```
Expected: FAILED — `_execute_pass` calls OpenAI regardless of breaker state, so OpenAI's (un-mocked) endpoint errors and the chain falls through differently than asserted, or the provider label is wrong.

- [ ] **Step 3 — Write the minimal implementation.** In `python/services/ai/mol/orchestrator.py`, import the breaker (top of file with the other `.` imports):
```python
from . import breaker as cb
```
Change `_execute_pass`'s signature to accept the task type + breaker toggle, and consult/record the breaker around each target (replace lines ~135-204):
```python
async def _execute_pass(
    chain: Iterable[ProviderTarget],
    *,
    task_type: TaskType,
    breaker_on: bool,
    system_prompt: str,
    user_messages: list[ChatTurn],
    max_tokens: int,
    temperature: float,
    timeout_seconds: int,
    image_url: str | None = None,
) -> tuple[ProviderResponse, int, list[str]]:
    """Try each target in ``chain``; return on first success.

    Returns ``(response, fallback_count, failure_chain)``. A3: when
    ``breaker_on`` and the cross-instance breaker reports the
    ``(provider, task_type)`` circuit OPEN, the target is skipped without an
    HTTP call; provider outcomes feed ``record_failure`` / ``record_success``.
    """
    failures: list[str] = []
    fallback = 0

    targets = list(chain)
    for target in targets:
        provider = _providers[target.provider]
        if not provider.is_configured():
            failures.append(f"{target.provider}:not_configured")
            fallback += 1
            continue

        if breaker_on and not await cb.can_request(target.provider, task_type):
            failures.append(f"{target.provider}:circuit_open")
            fallback += 1
            continue

        last_error: str | None = None
        for attempt in range(2):
            try:
                response = await provider.call(
                    model=target.model,
                    system_prompt=system_prompt,
                    user_messages=user_messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    timeout_seconds=timeout_seconds,
                    image_url=image_url,
                )
                if breaker_on:
                    await cb.record_success(target.provider, task_type)
                return response, fallback, failures
            except Exception as err:  # noqa: BLE001 — boundary, classified below
                msg = str(err) or type(err).__name__
                status = _status_from_message(msg)
                failures.append(f"{target.provider}:{status if status else 'err'}")
                last_error = msg
                if breaker_on:
                    await cb.record_failure(target.provider, task_type)
                if status is None or not is_retryable_status(status):
                    break
                if attempt == 0:
                    await asyncio.sleep(0.5)
                    continue

        fallback += 1
        del last_error

    raise MolError(
        "NO_PROVIDER_AVAILABLE",
        "All providers in chain failed",
        details={"failures": failures},
    )
```
In `generate_response`, read the breaker flag in the parallel gather (add to the `asyncio.gather` and unpack), then pass `task_type=task_type, breaker_on=breaker_on` into both `_execute_pass` calls (the pass-1 call ~lines 291-299 and the hybrid pass-2 call ~lines 307-314):
```python
    hybrid_on, openai_default, deterministic_on, breaker_on, weights = await asyncio.gather(
        is_flag_enabled("ff_mol_hybrid_mode_v1", student_id=req.student_context.student_id),
        is_flag_enabled("ff_mol_openai_default", student_id=req.student_context.student_id),
        is_flag_enabled("ff_mol_deterministic_priority", student_id=req.student_context.student_id),
        is_flag_enabled("ff_mol_circuit_breaker_v1", student_id=req.student_context.student_id),
        get_routing_weights(),
    )
```
and (full pass-1 call, replacing lines ~291-299):
```python
        first_pass = selected.passes[0]
        response_1, fb_1, fail_1 = await _execute_pass(
            first_pass.chain,
            task_type=task_type,
            breaker_on=breaker_on,
            system_prompt=system_prompt,
            user_messages=user_messages,
            max_tokens=max_tokens,
            temperature=temperature,
            timeout_seconds=20,
            image_url=inp.image_url,
        )
```
and (full hybrid pass-2 call, replacing lines ~307-314):
```python
            response_2, fb_2, fail_2 = await _execute_pass(
                selected.passes[1].chain,
                task_type=task_type,
                breaker_on=breaker_on,
                system_prompt=simplify_prompt,
                user_messages=[ChatTurn(role="user", content="Rewrite the answer above.")],
                max_tokens=get_simplify_max_tokens(),
                temperature=temperature,
                timeout_seconds=15,
            )
```

- [ ] **Step 4 — Run the test, expect PASS.** Run the breaker integration test plus the existing generate suite (no regressions — `breaker_on` is False under `_disable_flag_network`):
```
cd python && pytest tests/integration/test_generate_endpoint.py -v
```
Expected: all pass.

- [ ] **Step 5 — Commit.**
```
git add python/services/ai/mol/orchestrator.py python/tests/integration/test_generate_endpoint.py && git commit -m "feat(mol): wire cross-instance breaker into _execute_pass behind ff_mol_circuit_breaker_v1 (A3)"
```

---

## Phase 3 — Cost-cap enforcement (spec A4)

Enforce the already-defined `COST_CAP_EXCEEDED` error with a real per-task token/₹ ceiling, checked BEFORE the provider call. Estimate cost from `max_tokens` × the chain's primary model price (`cost.compute_cost`), compare against the per-task ceiling, and raise before any HTTP.

### Task 3.1 — Per-task ceiling table + `enforce_cost_cap`

**Files:**
- Create: `python/services/ai/mol/cost_cap.py`
- Test: `python/tests/unit/test_cost_cap.py`

**Steps:**

- [ ] **Step 1 — Write the failing test.** Create `python/tests/unit/test_cost_cap.py`:
```python
"""Cost-cap enforcement tests — A4."""

from __future__ import annotations

import pytest

from services.ai.mol.cost_cap import (
    PER_TASK_INR_CEILING,
    estimate_inr,
    enforce_cost_cap,
)
from services.ai.mol.errors import MolError


def test_every_task_type_has_a_ceiling():
    from typing import get_args

    from services.ai.mol.types import TaskType

    for t in get_args(TaskType):
        assert t in PER_TASK_INR_CEILING, f"missing ceiling for {t!r}"


def test_estimate_inr_uses_primary_model_price():
    """Estimate = compute_cost(provider, model, prompt_estimate, max_tokens) → INR."""
    inr = estimate_inr("openai", "gpt-4o-mini", prompt_tokens=500, max_tokens=1024)
    assert inr > 0.0


def test_under_ceiling_does_not_raise():
    # explanation ceiling is generous; a 1024-token gpt-4o-mini call is well under.
    enforce_cost_cap(
        task_type="explanation",
        provider="openai",
        model="gpt-4o-mini",
        prompt_tokens=500,
        max_tokens=1024,
    )  # must not raise


def test_over_ceiling_raises_cost_cap_exceeded():
    with pytest.raises(MolError) as exc:
        enforce_cost_cap(
            task_type="evaluation",  # tightest ceiling
            provider="anthropic",
            model="claude-sonnet-4-6-20251022",  # most expensive
            prompt_tokens=2_000_000,
            max_tokens=2_000_000,
        )
    assert exc.value.code == "COST_CAP_EXCEEDED"
    assert "estimated_inr" in exc.value.details
    assert "ceiling_inr" in exc.value.details


def test_unknown_model_estimate_is_zero_and_passes():
    """compute_cost returns 0 for unknown models; cap must not false-positive."""
    enforce_cost_cap(
        task_type="explanation",
        provider="openai",
        model="some-unpriced-model",
        prompt_tokens=10_000_000,
        max_tokens=10_000_000,
    )  # 0 INR estimate ⇒ never over ceiling
```

- [ ] **Step 2 — Run it, expect FAIL.**
```
cd python && pytest tests/unit/test_cost_cap.py -v
```
Expected: `ModuleNotFoundError: No module named 'services.ai.mol.cost_cap'`.

- [ ] **Step 3 — Write the minimal implementation.** Create `python/services/ai/mol/cost_cap.py`:
```python
"""Per-request cost-cap enforcement — A4.

Enforces the ``COST_CAP_EXCEEDED`` MolError BEFORE any provider HTTP call.
The estimate is intentionally conservative: prompt_tokens (already known
from the composed system prompt + messages) + the worst-case completion
(``max_tokens``) priced at the chain's PRIMARY model. The ceiling is per
task type, denominated in ₹, sourced from the current ``mol_request_logs``
spend distribution (assessment + ops own the exact numbers — see the design
spec open question #1). The values below are the launch defaults; tuning them
is a flag-free config change reviewed by ops.

Estimate of 0.0 ₹ (unknown/unpriced model) NEVER trips the cap — the missing
PRICING entry is a separate data-integrity warning surfaced by cost.py.
"""

from __future__ import annotations

import structlog

from .cost import compute_cost
from .errors import MolError
from .types import TaskType

logger = structlog.get_logger(__name__)

# ₹ ceiling per single MOL call, by task type. Launch defaults; tune from
# mol_request_logs.inr_cost p99 once Python carries production traffic.
PER_TASK_INR_CEILING: dict[TaskType, float] = {
    "explanation": 5.0,
    "concept_explanation": 5.0,
    "step_by_step": 7.0,
    "reasoning": 25.0,
    "quiz_generation": 12.0,
    "evaluation": 2.0,
    "doubt_solving": 30.0,
    "ocr_extraction": 15.0,
    "grounding_check": 2.0,
}


def estimate_inr(provider: str, model: str, *, prompt_tokens: int, max_tokens: int) -> float:
    """Worst-case ₹ estimate: known prompt tokens + max_tokens completion."""
    _usd, inr = compute_cost(provider, model, prompt_tokens, max_tokens)
    return inr


def enforce_cost_cap(
    *,
    task_type: TaskType,
    provider: str,
    model: str,
    prompt_tokens: int,
    max_tokens: int,
) -> None:
    """Raise ``MolError('COST_CAP_EXCEEDED')`` when the estimate exceeds the
    per-task ₹ ceiling. No-op when the estimate is at/under the ceiling."""
    ceiling = PER_TASK_INR_CEILING.get(task_type)
    if ceiling is None:
        return  # unknown task ⇒ no cap (defensive; router would have rejected)
    estimated = estimate_inr(provider, model, prompt_tokens=prompt_tokens, max_tokens=max_tokens)
    if estimated > ceiling:
        logger.warning(
            "mol.cost_cap.exceeded",
            task_type=task_type,
            provider=provider,
            model=model,
            estimated_inr=estimated,
            ceiling_inr=ceiling,
        )
        raise MolError(
            "COST_CAP_EXCEEDED",
            f"estimated ₹{estimated:.4f} exceeds {task_type} ceiling ₹{ceiling:.2f}",
            details={"estimated_inr": estimated, "ceiling_inr": ceiling, "task_type": task_type},
        )
```

- [ ] **Step 4 — Run the test, expect PASS.**
```
cd python && pytest tests/unit/test_cost_cap.py -v
```
Expected: all pass.

- [ ] **Step 5 — Commit.**
```
git add python/services/ai/mol/cost_cap.py python/tests/unit/test_cost_cap.py && git commit -m "feat(mol): per-task ₹ cost-cap enforcement (A4)"
```

### Task 3.2 — Wire `enforce_cost_cap` into the orchestrator before the provider call

**Files:**
- Modify: `python/services/ai/mol/orchestrator.py` (before the pass-1 `_execute_pass`, ~line 289; gated by `ff_mol_cost_cap_v1`)
- Test: `python/tests/integration/test_generate_endpoint.py`

**Steps:**

- [ ] **Step 1 — Write the failing test.** Append to `python/tests/integration/test_generate_endpoint.py`:
```python
def test_generate_429_when_cost_cap_exceeded(
    client: TestClient, respx_mock, mock_supabase_client, monkeypatch
):
    """A request whose estimate exceeds the per-task ceiling returns 429
    COST_CAP_EXCEEDED and never calls a provider."""
    openai_route = respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": [], "usage": {}})
    )

    async def _flag(name, **kwargs):
        return name == "ff_mol_cost_cap_v1"

    monkeypatch.setattr("services.ai.mol.orchestrator.is_flag_enabled", _flag)
    payload = {
        "task_type": "evaluation",
        "input": {"question": "x" * 50},
        # Force a huge max_tokens override so the estimate blows the ₹2 evaluation ceiling.
        "student_context": {"student_id": "x", "grade": "8"},
        "config": {"max_tokens_override": 5_000_000, "preferred_provider": "anthropic"},
    }
    res = client.post("/v1/generate", json=payload)
    assert res.status_code == 429
    assert res.json()["detail"]["code"] == "COST_CAP_EXCEEDED"
    assert openai_route.call_count == 0  # no provider call fired
```

- [ ] **Step 2 — Run it, expect FAIL.**
```
cd python && pytest tests/integration/test_generate_endpoint.py::test_generate_429_when_cost_cap_exceeded -v
```
Expected: FAILED — orchestrator never enforces the cap, so the request proceeds (likely 502 from the empty-choices stub) instead of 429.

- [ ] **Step 3 — Write the minimal implementation.** In `python/services/ai/mol/orchestrator.py`, import the cap and read its flag in the gather:
```python
from .cost_cap import enforce_cost_cap
```
Add `ff_mol_cost_cap_v1` to the parallel gather and unpack `cost_cap_on`. Then, after computing `max_tokens` + `temperature` (~line 282) and before the `try:` block that runs pass 1 (~line 289), enforce the cap on the primary rung of the first pass:
```python
    if cost_cap_on:
        primary = selected.passes[0].chain[0]
        # Conservative prompt-token estimate: ~1 token / 4 chars of system prompt
        # + user text. This is pre-call, so we approximate from string length.
        prompt_estimate = (len(system_prompt) + len(user_text)) // 4
        enforce_cost_cap(
            task_type=task_type,
            provider=primary.provider,
            model=primary.model,
            prompt_tokens=prompt_estimate,
            max_tokens=max_tokens,
        )
```

- [ ] **Step 4 — Run the test, expect PASS.** Run the cost-cap integration test plus the full generate suite (cap is OFF under `_disable_flag_network`, so happy paths are unaffected):
```
cd python && pytest tests/integration/test_generate_endpoint.py -v
```
Expected: all pass.

- [ ] **Step 5 — Commit.**
```
git add python/services/ai/mol/orchestrator.py python/tests/integration/test_generate_endpoint.py && git commit -m "feat(mol): enforce cost cap before provider call behind ff_mol_cost_cap_v1 (A4)"
```

---

## Phase 4 — Semantic cache (spec A4)

Add an exact-match Upstash Redis cache keyed on `(task_type, grade, subject, normalized_query)` with a TTL. It short-circuits BEFORE any provider call (consistent with REG-50). Never cache low-confidence (fallback occurred) or personalized output (chat_history present). Gated by `ff_mol_semantic_cache`.

### Task 4.1 — Cache key, get/set, and skip-rules

**Files:**
- Create: `python/services/ai/mol/cache.py`
- Test: `python/tests/unit/test_cache.py`

**Steps:**

- [ ] **Step 1 — Write the failing test.** Create `python/tests/unit/test_cache.py`:
```python
"""Semantic cache tests — A4."""

from __future__ import annotations

import pytest

from services.ai.mol import cache as cache_mod
from services.ai.mol.cache import cache_key, get_cached, set_cached, should_cache


class _FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def set(self, key: str, value, ex: int | None = None):  # noqa: A003
        self.store[key] = str(value)


@pytest.fixture()
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    fake = _FakeRedis()
    monkeypatch.setattr(cache_mod, "get_redis_client", lambda: fake)
    return fake


def test_cache_key_normalizes_query_and_includes_context():
    a = cache_key("explanation", grade="8", subject="science", query="  What is FORCE? ")
    b = cache_key("explanation", grade="8", subject="science", query="what is force?")
    assert a == b  # case + whitespace normalized
    c = cache_key("explanation", grade="9", subject="science", query="what is force?")
    assert a != c  # grade is part of the key


async def test_cache_miss_then_hit(fake_redis):
    key = cache_key("explanation", grade="8", subject="science", query="what is force")
    assert await get_cached(key) is None
    await set_cached(key, "Force is a push or pull.", ttl_seconds=3600)
    assert await get_cached(key) == "Force is a push or pull."


async def test_get_cached_returns_none_when_redis_unconfigured(monkeypatch):
    monkeypatch.setattr(cache_mod, "get_redis_client", lambda: None)
    key = cache_key("explanation", grade="8", subject="x", query="q")
    assert await get_cached(key) is None  # no Redis ⇒ always miss


def test_should_cache_skips_when_fallback_occurred():
    # fallback_count > 0 ⇒ low-confidence answer; never cache.
    assert should_cache(fallback_count=1, has_chat_history=False) is False


def test_should_cache_skips_personalized_chat_history():
    assert should_cache(fallback_count=0, has_chat_history=True) is False


def test_should_cache_allows_clean_stateless_answer():
    assert should_cache(fallback_count=0, has_chat_history=False) is True
```

- [ ] **Step 2 — Run it, expect FAIL.**
```
cd python && pytest tests/unit/test_cache.py -v
```
Expected: `ModuleNotFoundError: No module named 'services.ai.mol.cache'`.

- [ ] **Step 3 — Write the minimal implementation.** Create `python/services/ai/mol/cache.py`:
```python
"""Semantic (exact-match) cache for MOL answers — A4.

Keyed on ``(task_type, grade, subject, normalized_query)`` with a TTL. The
cache short-circuits BEFORE any provider call (consistent with the Foxy
single-retrieval contract, REG-50). Backed by Upstash Redis; fails open
(every lookup is a miss) when Redis is unconfigured.

Conservative by design (design-spec risk row):
- exact-match key, not embedding similarity (pgvector match is a follow-up);
- short default TTL;
- ``should_cache`` REFUSES to store low-confidence (a fallback occurred) or
  personalized (chat_history present) outputs.
"""

from __future__ import annotations

import hashlib
import re

import structlog

from .redis_client import get_redis_client

logger = structlog.get_logger(__name__)

DEFAULT_TTL_SECONDS = 6 * 60 * 60  # 6h
_WS_RE = re.compile(r"\s+")


def _normalize(query: str) -> str:
    return _WS_RE.sub(" ", query.strip().lower())


def cache_key(task_type: str, *, grade: str, subject: str | None, query: str) -> str:
    """Stable Redis key for an answer. PII-free: the raw query is hashed."""
    canonical = f"{task_type}|{grade}|{subject or '_'}|{_normalize(query)}"
    digest = hashlib.sha256(canonical.encode()).hexdigest()
    return f"mol:cache:{digest}"


async def get_cached(key: str) -> str | None:
    """Return the cached answer text, or None (miss / Redis down)."""
    redis = get_redis_client()
    if redis is None:
        return None
    try:
        return await redis.get(key)
    except Exception as err:  # noqa: BLE001 — cache miss on any store failure
        logger.warning("mol.cache.get_failed", error=str(err))
        return None


async def set_cached(key: str, text: str, *, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> None:
    """Store an answer with a TTL. No-op when Redis is unconfigured."""
    redis = get_redis_client()
    if redis is None:
        return
    try:
        await redis.set(key, text, ex=ttl_seconds)
    except Exception as err:  # noqa: BLE001
        logger.warning("mol.cache.set_failed", error=str(err))


def should_cache(*, fallback_count: int, has_chat_history: bool) -> bool:
    """Only cache clean, stateless, high-confidence answers."""
    if fallback_count > 0:
        return False
    if has_chat_history:
        return False
    return True
```

- [ ] **Step 4 — Run the test, expect PASS.**
```
cd python && pytest tests/unit/test_cache.py -v
```
Expected: all pass.

- [ ] **Step 5 — Commit.**
```
git add python/services/ai/mol/cache.py python/tests/unit/test_cache.py && git commit -m "feat(mol): exact-match semantic cache with skip-rules (A4)"
```

### Task 4.2 — Wire the cache short-circuit + store into `generate_response`

**Files:**
- Modify: `python/services/ai/mol/orchestrator.py` (after `user_text` is known ~line 278, before pass-1; and after `final_text` ~line 361; gated by `ff_mol_semantic_cache`)
- Test: `python/tests/integration/test_generate_endpoint.py`

**Steps:**

- [ ] **Step 1 — Write the failing test.** Append to `python/tests/integration/test_generate_endpoint.py`:
```python
def test_generate_serves_from_cache_without_provider_call(
    client: TestClient, respx_mock, mock_supabase_client, monkeypatch
):
    """A cache hit short-circuits before any provider HTTP call."""
    from services.ai.mol import cache as cache_mod

    async def _flag(name, **kwargs):
        return name == "ff_mol_semantic_cache"

    monkeypatch.setattr("services.ai.mol.orchestrator.is_flag_enabled", _flag)

    async def _get_cached(key):
        return "Cached answer."

    monkeypatch.setattr("services.ai.mol.orchestrator.get_cached", _get_cached)
    openai_route = respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": [], "usage": {}})
    )
    payload = {
        "task_type": "explanation",
        "input": {"question": "What is force?"},
        "student_context": {"student_id": "x", "grade": "8", "subject": "science"},
    }
    res = client.post("/v1/generate", json=payload)
    assert res.status_code == 200, res.text
    assert res.json()["text"] == "Cached answer."
    assert openai_route.call_count == 0
```

- [ ] **Step 2 — Run it, expect FAIL.**
```
cd python && pytest tests/integration/test_generate_endpoint.py::test_generate_serves_from_cache_without_provider_call -v
```
Expected: FAILED — orchestrator has no `get_cached` symbol / no short-circuit, so the provider stub is called (`call_count == 1`) and the text is not "Cached answer.".

- [ ] **Step 3 — Write the minimal implementation.** In `python/services/ai/mol/orchestrator.py`, import the cache:
```python
from .cache import cache_key, get_cached, set_cached, should_cache
```
Add `ff_mol_semantic_cache` to the parallel gather and unpack `cache_on`. After `user_text` is composed (~line 278) and BEFORE the cost-cap / pass-1 execution, add a hit short-circuit that returns a cached `MolResult`:
```python
    cache_k = None
    if cache_on and not (inp.chat_history):
        cache_k = cache_key(
            task_type,
            grade=req.student_context.grade,
            subject=req.student_context.subject,
            query=user_text,
        )
        hit = await get_cached(cache_k)
        if hit is not None:
            latency_ms = int((time.monotonic() - start) * 1000)
            await record_mol_request(
                LogPayload(
                    request_id=request_id,
                    student_id=req.student_context.student_id,
                    task_type=task_type,
                    surface=cfg.surface,
                    provider="cache",
                    model="cache",
                    passes=0,
                    fallback_count=0,
                    failure_chain=None,
                    latency_ms=latency_ms,
                    tokens=TokenUsage(),
                    usd_cost=0.0,
                    inr_cost=0.0,
                    grade=req.student_context.grade,
                    language=req.student_context.language,
                    exam_goal=req.student_context.exam_goal,
                    shadow_role=cfg.shadow_role,
                    shadow_of_request_id=cfg.shadow_of_request_id,
                    trace_id=cfg.trace_id,
                )
            )
            return MolResult(
                text=hit,
                provider="cache",
                model="cache",
                task_type=task_type,
                latency_ms=latency_ms,
                tokens=TokenUsage(),
                usd_cost=0.0,
                inr_cost=0.0,
                fallback_count=0,
                passes=0,
                request_id=request_id,
                failure_chain=[],
            )
```
After `final_text = post_process(...)` (~line 361), store on a clean answer:
```python
    if cache_on and cache_k is not None and should_cache(
        fallback_count=total_fallback, has_chat_history=bool(inp.chat_history)
    ):
        await set_cached(cache_k, final_text)
```
Note: `MolResult.provider` is `ResultProvider = Literal["openai","anthropic","hybrid"]`. Extend that literal in `python/services/ai/mol/types.py` to include `"cache"` (and update the `provider` field), since a cache hit is a new provider label:
```python
ResultProvider = Literal["openai", "anthropic", "hybrid", "cache"]
```

- [ ] **Step 4 — Run the test, expect PASS.** Run the cache integration test plus the full generate suite (cache OFF under `_disable_flag_network`):
```
cd python && pytest tests/integration/test_generate_endpoint.py -v
```
Expected: all pass.

- [ ] **Step 5 — Commit.**
```
git add python/services/ai/mol/orchestrator.py python/services/ai/mol/types.py python/tests/integration/test_generate_endpoint.py && git commit -m "feat(mol): semantic-cache short-circuit + store in generate_response behind ff_mol_semantic_cache (A4)"
```

---

## Phase 5 — Streaming endpoint (spec A6)

Add `POST /v1/generate/stream` returning Server-Sent Events. Stream the MOL answer in chunks; handle client disconnect (cancellation) cleanly. Gated by `ff_mol_stream_v1` only at the caller layer — the endpoint itself is always mounted. Phase A scope streams the final text in chunks (token-level provider streaming is a follow-up); the contract (`StreamingResponse`, `text/event-stream`, `event: token` / `event: done`) is the deliverable.

### Task 5.1 — SSE endpoint with chunking + cancellation

**Files:**
- Modify: `python/services/ai/api/v1/generate.py` (add route after line 87)
- Test: `python/tests/integration/test_generate_stream_endpoint.py`

**Steps:**

- [ ] **Step 1 — Write the failing test.** Create `python/tests/integration/test_generate_stream_endpoint.py`:
```python
"""SSE streaming endpoint tests — A6."""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from services.ai.api.main import create_app


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture()
def openai_stream_route(respx_mock):
    return respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "chatcmpl-stream",
                "model": "gpt-4o-mini",
                "choices": [
                    {"message": {"role": "assistant", "content": "Force is a push or pull."},
                     "finish_reason": "stop"}
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 6},
            },
        )
    )


def test_stream_returns_sse_content_type(client, openai_stream_route, mock_supabase_client):
    payload = {
        "task_type": "explanation",
        "input": {"question": "What is force?"},
        "student_context": {"student_id": "x", "grade": "8"},
    }
    with client.stream("POST", "/v1/generate/stream", json=payload) as res:
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/event-stream")
        body = "".join(res.iter_text())
    assert "event: token" in body
    assert "event: done" in body
    assert "Force is a push or pull." in body


def test_stream_done_event_carries_request_id(client, openai_stream_route, mock_supabase_client):
    payload = {
        "task_type": "explanation",
        "input": {"question": "?"},
        "student_context": {"student_id": "x", "grade": "8"},
    }
    with client.stream("POST", "/v1/generate/stream", json=payload) as res:
        body = "".join(res.iter_text())
    assert "request_id" in body


def test_stream_invalid_input_emits_error_event(client, mock_supabase_client):
    """Empty input block streams an error event, not a 500."""
    payload = {
        "task_type": "explanation",
        "input": {},
        "student_context": {"student_id": "x", "grade": "8"},
    }
    with client.stream("POST", "/v1/generate/stream", json=payload) as res:
        body = "".join(res.iter_text())
    assert "event: error" in body
    assert "INVALID_INPUT" in body
```

- [ ] **Step 2 — Run it, expect FAIL.**
```
cd python && pytest tests/integration/test_generate_stream_endpoint.py -v
```
Expected: 404 / route-not-found assertions FAIL (`/v1/generate/stream` does not exist).

- [ ] **Step 3 — Write the minimal implementation.** In `python/services/ai/api/v1/generate.py`, add the imports and the route. At the top extend imports:
```python
import json

from starlette.responses import StreamingResponse
```
Add after `post_generate` (after line 87):
```python
def _sse(event: str, data: dict) -> str:
    """Format one Server-Sent Event frame."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post(
    "/generate/stream",
    summary="Run a MOL call and stream the answer as Server-Sent Events",
)
async def post_generate_stream(req: GenerateRequest, request: Request) -> StreamingResponse:
    """Stream a MOL answer. Emits ``event: token`` frames followed by a final
    ``event: done`` frame; ``event: error`` on a MolError (never a 5xx into
    the stream, so the student surface degrades gracefully — P12)."""
    request_id = (
        (req.config and req.config.request_id)
        or request.headers.get("x-request-id")
        or str(uuid.uuid4())
    )
    if req.config is None:
        from ...mol.types import GenerateConfig

        req.config = GenerateConfig(request_id=request_id)
    else:
        req.config.request_id = request_id

    async def _gen():
        try:
            result = await generate_response(req)
        except MolError as err:
            logger.warning("mol.stream.error", code=err.code, message=err.message)
            yield _sse("error", {"code": err.code, "message": err.message, "request_id": request_id})
            return
        # Chunk the final text into ~120-char SSE token frames. Phase A streams
        # the post-processed answer; token-level provider streaming is a follow-up.
        text = result.text
        size = 120
        for i in range(0, len(text), size):
            # Cooperative cancellation: stop emitting if the client disconnected.
            if await request.is_disconnected():
                logger.info("mol.stream.client_disconnected", request_id=request_id)
                return
            yield _sse("token", {"text": text[i : i + size]})
        yield _sse(
            "done",
            {
                "request_id": result.request_id,
                "provider": result.provider,
                "model": result.model,
                "task_type": result.task_type,
                "latency_ms": result.latency_ms,
            },
        )

    return StreamingResponse(_gen(), media_type="text/event-stream")
```

- [ ] **Step 4 — Run the test, expect PASS.**
```
cd python && pytest tests/integration/test_generate_stream_endpoint.py -v
```
Expected: all pass.

- [ ] **Step 5 — Commit.**
```
git add python/services/ai/api/v1/generate.py python/tests/integration/test_generate_stream_endpoint.py && git commit -m "feat(mol): POST /v1/generate/stream SSE endpoint with cancellation (A6)"
```

---

## Phase 6 — Quality eval harness (spec A5)

Wire the existing grader (`mol/grader.py`) into a golden-set harness that grades Python answers against a baseline floor per task type. A `False` verdict BLOCKS a cutover flag flip. assessment owns the golden set + tolerance; ai-engineer ships the wiring.

### Task 6.1 — Golden set fixture + harness gate

**Files:**
- Create: `python/services/ai/mol/eval/__init__.py`, `python/services/ai/mol/eval/golden_set.py`, `python/services/ai/mol/eval/harness.py`
- Test: `python/tests/unit/test_eval_harness.py`

**Steps:**

- [ ] **Step 1 — Write the failing test.** Create `python/tests/unit/test_eval_harness.py`:
```python
"""Quality eval-harness gate tests — A5."""

from __future__ import annotations

import pytest

from services.ai.mol.eval import harness as harness_mod
from services.ai.mol.eval.golden_set import GOLDEN_SET, GoldenItem
from services.ai.mol.eval.harness import GateVerdict, run_quality_gate


def test_golden_set_is_nonempty_and_typed():
    assert len(GOLDEN_SET) >= 1
    for item in GOLDEN_SET:
        assert isinstance(item, GoldenItem)
        assert item.question and item.grade and item.baseline_answer
        assert 0.0 <= item.min_overall <= 1.0


async def test_gate_passes_when_all_items_meet_floor(monkeypatch):
    """Every graded shadow answer at/above its min_overall ⇒ gate PASS."""
    from services.ai.mol.grader import CandidateScores, GraderResult

    async def _fake_grade(args):
        good = CandidateScores(1.0, 1.0, 1.0, 1.0, 1.0, 1.0, overall=0.95)
        return GraderResult(
            baseline=good, shadow=good, agreement=1.0, winner="tie", notes="",
            rubric_version="mol-grader-v2", model="m", prompt_tokens=0, completion_tokens=0,
        )

    async def _fake_answer(item):
        return "A correct, on-syllabus answer."

    monkeypatch.setattr(harness_mod, "grade_shadow_pair", _fake_grade)
    verdict = await run_quality_gate(produce_answer=_fake_answer)
    assert isinstance(verdict, GateVerdict)
    assert verdict.passed is True
    assert verdict.failures == []


async def test_gate_fails_when_any_item_below_floor(monkeypatch):
    from services.ai.mol.grader import CandidateScores, GraderResult

    async def _fake_grade(args):
        weak = CandidateScores(0.2, 0.2, 0.2, 0.2, 0.2, 0.2, overall=0.20)
        good = CandidateScores(1.0, 1.0, 1.0, 1.0, 1.0, 1.0, overall=0.95)
        return GraderResult(
            baseline=good, shadow=weak, agreement=0.3, winner="baseline", notes="",
            rubric_version="mol-grader-v2", model="m", prompt_tokens=0, completion_tokens=0,
        )

    async def _fake_answer(item):
        return "A weak, off-syllabus answer."

    monkeypatch.setattr(harness_mod, "grade_shadow_pair", _fake_grade)
    verdict = await run_quality_gate(produce_answer=_fake_answer)
    assert verdict.passed is False
    assert len(verdict.failures) >= 1
```

- [ ] **Step 2 — Run it, expect FAIL.**
```
cd python && pytest tests/unit/test_eval_harness.py -v
```
Expected: `ModuleNotFoundError: No module named 'services.ai.mol.eval'`.

- [ ] **Step 3 — Write the minimal implementation.** Create `python/services/ai/mol/eval/__init__.py`:
```python
"""MOL quality eval harness (A5) — golden-set grading gate for cutovers."""
```
Create `python/services/ai/mol/eval/golden_set.py`:
```python
"""Tiny in-repo golden set for the MOL quality gate (A5).

assessment owns the canonical content + per-item ``min_overall`` floors; this
fixture is the launch seed (one item per high-volume task type). The harness
grades Python's answer against the baseline answer here and requires the graded
``shadow.overall`` to clear ``min_overall`` for the gate to pass.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..types import TaskType


@dataclass(frozen=True)
class GoldenItem:
    task_type: TaskType
    question: str
    grade: str
    subject: str
    baseline_answer: str
    min_overall: float


GOLDEN_SET: list[GoldenItem] = [
    GoldenItem(
        task_type="explanation",
        question="What is force?",
        grade="8",
        subject="science",
        baseline_answer=(
            "A force is a push or a pull on an object. It can change an object's "
            "speed, direction, or shape. Force is measured in newtons (N)."
        ),
        min_overall=0.70,
    ),
    GoldenItem(
        task_type="step_by_step",
        question="Solve 2x + 3 = 11.",
        grade="7",
        subject="mathematics",
        baseline_answer=(
            "Step 1: subtract 3 from both sides → 2x = 8. "
            "Step 2: divide both sides by 2 → x = 4."
        ),
        min_overall=0.70,
    ),
]
```
Create `python/services/ai/mol/eval/harness.py`:
```python
"""Golden-set quality gate — A5.

Runs a candidate Python answer for each golden item through the existing
LLM grader and asserts the graded ``shadow.overall`` clears the item's
``min_overall`` floor. A failing verdict BLOCKS a cutover flag flip (the
runbook checks ``GateVerdict.passed`` before bumping ``ff_python_*_v1``).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

import structlog

from ..grader import GraderInput, grade_shadow_pair
from .golden_set import GOLDEN_SET, GoldenItem

logger = structlog.get_logger(__name__)

# Type of the callback that produces the candidate (Python) answer for an item.
ProduceAnswer = Callable[[GoldenItem], Awaitable[str]]


@dataclass
class GateVerdict:
    passed: bool
    graded: int = 0
    failures: list[str] = field(default_factory=list)


async def run_quality_gate(*, produce_answer: ProduceAnswer) -> GateVerdict:
    """Grade each golden item's candidate answer; gate passes iff every graded
    item clears its ``min_overall`` floor. Ungradeable items (grader returns
    None) are treated as failures so the gate never silently passes."""
    failures: list[str] = []
    graded = 0
    for item in GOLDEN_SET:
        candidate = await produce_answer(item)
        result = await grade_shadow_pair(
            GraderInput(
                question=item.question,
                baseline_text=item.baseline_answer,
                shadow_text=candidate,
                grade=item.grade,
            )
        )
        if result is None:
            failures.append(f"{item.task_type}:ungradeable")
            continue
        graded += 1
        if result.shadow.overall < item.min_overall:
            failures.append(
                f"{item.task_type}:overall={result.shadow.overall:.2f}<{item.min_overall:.2f}"
            )
    verdict = GateVerdict(passed=len(failures) == 0, graded=graded, failures=failures)
    logger.info("mol.eval.gate", passed=verdict.passed, graded=graded, failures=failures)
    return verdict
```

- [ ] **Step 4 — Run the test, expect PASS.**
```
cd python && pytest tests/unit/test_eval_harness.py -v
```
Expected: all pass.

- [ ] **Step 5 — Commit.**
```
git add python/services/ai/mol/eval/__init__.py python/services/ai/mol/eval/golden_set.py python/services/ai/mol/eval/harness.py python/tests/unit/test_eval_harness.py && git commit -m "feat(mol): golden-set quality eval harness gate (A5)"
```

---

## Phase 7 — Contract-parity tests (spec A9)

Prove identical input → identical routing decision + identical `mol_request_logs` telemetry-row shape across TS and Python via golden cassettes (the cassette is the TS-derived expectation captured in the test; the Python side runs live). Because the TS and Python BASE_MATRIX intentionally differ in two chain orderings (`reasoning`, `doubt_solving` reason pass), the parity assertions pin the DETERMINISTIC post-A2 decision (OpenAI-primary) which both runtimes must converge to under `ff_mol_deterministic_priority`, plus the exact telemetry column set.

### Task 7.1 — Routing-decision + telemetry-shape parity cassettes

**Files:**
- Create: `python/tests/integration/test_routing_parity.py`
- Test: (the file itself)

**Steps:**

- [ ] **Step 1 — Write the failing test.** Create `python/tests/integration/test_routing_parity.py`:
```python
"""Contract-parity tests (A9) — TS↔Python identical routing + telemetry shape.

The TS expectations are captured as golden cassettes (hand-derived from
supabase/functions/_shared/mol/router.ts + telemetry.ts and pinned here).
The Python side runs live; the assertions pin convergence under the
deterministic-priority flag plus the exact mol_request_logs column set.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from services.ai.api.main import create_app
from services.ai.mol.router import RouterOptions, select_provider_chain

# Golden cassette: under deterministic priority (ff_mol_deterministic_priority ON
# ⇒ shadow_priority False), BOTH runtimes must put OpenAI primary for these tasks.
ROUTING_CASSETTE = {
    "explanation": ("openai", "gpt-4o-mini"),
    "step_by_step": ("openai", "gpt-4o-mini"),
    "quiz_generation": ("openai", "gpt-4o-mini"),
    "reasoning": ("openai", "gpt-4o"),
}

# Golden cassette: exact mol_request_logs insert column set (telemetry.py
# _row_from_payload keys == TS recordMolRequest columns).
TELEMETRY_COLUMNS = {
    "request_id", "student_id", "task_type", "surface", "provider", "model",
    "passes", "fallback_count", "failure_chain", "latency_ms",
    "prompt_tokens", "completion_tokens", "usd_cost", "inr_cost",
    "grade", "language", "exam_goal",
    "shadow_of_request_id", "shadow_role", "trace_id",
}


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app())


@pytest.mark.parametrize("task,expected", list(ROUTING_CASSETTE.items()))
def test_routing_decision_matches_ts_cassette(task, expected):
    opts = RouterOptions(shadow_priority=False)  # deterministic = TS-converged decision
    selected = select_provider_chain(task, opts)
    head = selected.passes[0].chain[0]
    assert (head.provider, head.model) == expected


def test_telemetry_row_shape_matches_ts_cassette(client, mock_supabase_client, respx_mock):
    respx_mock.post("https://api.openai.com/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "c", "model": "gpt-4o-mini",
                "choices": [{"message": {"role": "assistant", "content": "ok"},
                             "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 2},
            },
        )
    )
    payload = {
        "task_type": "explanation",
        "input": {"question": "?"},
        "student_context": {"student_id": "44444444-4444-4444-4444-444444444444", "grade": "8"},
    }
    client.post("/v1/generate", json=payload)
    assert len(mock_supabase_client.inserts) == 1
    assert set(mock_supabase_client.inserts[0].keys()) == TELEMETRY_COLUMNS
```

- [ ] **Step 2 — Run it, expect FAIL.** The deterministic routing decision is already correct (Phase 1 shipped), so the routing parametrize passes; the telemetry-shape test is the gate. If `_row_from_payload` ever drifts from `TELEMETRY_COLUMNS` it FAILS. Run to confirm RED only if a column is missing; otherwise this task pins the contract green:
```
cd python && pytest tests/integration/test_routing_parity.py -v
```
Expected on a correct tree: PASS (this task is a CONTRACT PIN — its value is failing loudly if either runtime drifts; document that in the commit). If routing parity is RED, the deterministic flip in Phase 1 was not applied — re-run Phase 1.

- [ ] **Step 3 — Write the minimal implementation.** No production code change — the parity cassettes assert against existing behavior. If RED on telemetry columns, reconcile `telemetry.py:_row_from_payload` (and the TS `recordMolRequest`) so both emit exactly `TELEMETRY_COLUMNS`. (No edit expected on a correct tree.)

- [ ] **Step 4 — Run the test, expect PASS.**
```
cd python && pytest tests/integration/test_routing_parity.py -v
```
Expected: all pass.

- [ ] **Step 5 — Commit.**
```
git add python/tests/integration/test_routing_parity.py && git commit -m "test(mol): TS↔Python routing-decision + telemetry-shape parity cassettes (A9)"
```

---

## Phase 8 — Strangler-fig cutover execution (spec A8)

This task is a checklist/runbook task (ops + flag changes), not new code. Author the runbook and execute the cutover in the locked order with the per-function gate sequence and kill-switch.

### Task 8.1 — Author the cutover runbook

**Files:**
- Create: `docs/runbooks/2026-06-13-mol-python-cutover.md`

**Steps:**

- [ ] **Step 1 — Write the runbook.** Create `docs/runbooks/2026-06-13-mol-python-cutover.md` containing the sections below verbatim (no test for a doc; commit directly):

  **Cutover order (locked, spec A8):**
  - [ ] Batch / non-student-facing first: `generate-answers` (`ff_python_generate_answers_v1`), `bulk-question-gen` (`ff_python_bulk_question_gen_v1` — already started), `generate-concepts` (`ff_python_generate_concepts_v1`), `extract-ncert-questions` (`ff_python_extract_ncert_questions_v1`), `bulk-non-mcq-gen` (`ff_python_bulk_non_mcq_gen_v1`), `parent-report-generator` (`ff_python_parent_report_generator_v1`), `monthly-synthesis-builder` (`ff_python_monthly_synthesis_builder_v1`).
  - [ ] Semi-interactive: `quiz-generator` (`ff_python_quiz_generator_v1`), `ncert-solver` (`ff_python_ncert_solver_v1`), `verify-question-bank` (`ff_python_verify_question_bank_v1`), `grade-experiment-conclusion` (`ff_python_grade_experiment_conclusion_v1`).
  - [ ] Student-facing last: `foxy` / `grounded-answer` (`ff_python_foxy_tutor_v1`), `scan-solve` (`ff_python_scan_solve_v1`).

  **Per-function gate sequence (repeat for each flag, top of order down):**
  - [ ] Pre-gate: `run_quality_gate` (Phase 6) returns `passed=True` for the function's task types. A `False` verdict BLOCKS the flip.
  - [ ] Confirm `PYTHON_AI_BASE_URL` is set to the Cloud Run service URL (architect-controlled). Empty ⇒ `shouldProxyToPython` returns `should_proxy=false` and the bump is a no-op (safe).
  - [ ] Set the flag envelope `metadata`: `{ "enabled": true, "kill_switch": false, "rollout_pct": 5 }`.
  - [ ] Watch the parity dashboard (ops) for 48h. Green criteria (all must hold): answer-grade delta ≥ -0.02 (Python not worse than TS baseline beyond tolerance), cost delta ≤ +5%, p95 latency delta ≤ +500ms (student-facing) / ≤ +3s (batch), fallback-rate delta ≤ +2pp, zero `event: error` rate increase on student surfaces.
  - [ ] If green for 48h: bump `rollout_pct` → `100`.
  - [ ] After 100% green for a further 48h: delete the corresponding Deno code path under `supabase/functions/_shared/mol/` for that function (freeze first, delete last function-by-function).

  **Kill-switch (any step):**
  - [ ] Instant revert option A: set `metadata.kill_switch = true` (proxy short-circuits to TS).
  - [ ] Instant revert option B (global): set `PYTHON_AI_BASE_URL` empty (all functions fall back to Deno).

  **Definition of done (sub-project A):**
  - [ ] All 13 flags at `rollout_pct=100` with 48h green parity.
  - [ ] Deno `_shared/mol/` brain deleted.
  - [ ] REG-120..REG-124 catalogued and passing in CI.

- [ ] **Step 2 — (No automated test for a runbook.)** Verify the doc renders and the flag names match `python-ai-proxy.ts` conventions (`ff_python_<function>_v1`). Manual review only.

- [ ] **Step 3 — (No implementation code.)** The runbook IS the deliverable; execution is ops driving the flags via the super-admin feature-flag panel.

- [ ] **Step 4 — (No test run.)** N/A.

- [ ] **Step 5 — Commit.**
```
git add docs/runbooks/2026-06-13-mol-python-cutover.md && git commit -m "docs(mol): strangler-fig cutover runbook — flag order, 5%→48h→100%→delete gate, kill-switch (A8)"
```

---

## Phase 9 — Regression catalog additions + review chain

### Task 9.1 — Add REG-120..REG-124 to the regression catalog

**Files:**
- Modify: `.claude/regression-catalog.md` (append)

**Steps:**

- [ ] **Step 1 — Append the entries.** Add to `.claude/regression-catalog.md`:
  - **REG-120 — Deterministic OpenAI-priority.** Invariant guarded: P12 (predictable, provider-priority routing; OpenAI always primary unless circuit OPEN / per-task override / shadow flag). Enforced by `python/tests/unit/test_router.py` (`test_deterministic_priority_*`) + `python/tests/integration/test_generate_endpoint.py::test_generate_reads_deterministic_priority_flag`.
  - **REG-121 — Cross-instance circuit breaker.** Invariant guarded: P12 (graceful degradation; a tripped provider is skipped, fail-open never blocks a live request). Enforced by `python/tests/unit/test_breaker.py` (all state-transition + `test_fail_open_when_redis_unreachable`) + `python/tests/integration/test_generate_endpoint.py::test_generate_skips_open_breaker_provider`.
  - **REG-122 — Cost-cap enforcement.** Invariant guarded: P12 / cost-control (over-ceiling request raises `COST_CAP_EXCEEDED` BEFORE any provider HTTP call). Enforced by `python/tests/unit/test_cost_cap.py::test_over_ceiling_raises_cost_cap_exceeded` + `python/tests/integration/test_generate_endpoint.py::test_generate_429_when_cost_cap_exceeded` (asserts `call_count == 0`).
  - **REG-123 — Cutover parity gate.** Invariant guarded: P14 / contract parity (identical routing decision + identical `mol_request_logs` column set across TS and Python; quality gate blocks a regressing cutover). Enforced by `python/tests/integration/test_routing_parity.py` + `python/tests/unit/test_eval_harness.py`.
  - **REG-124 — Streaming-path safety.** Invariant guarded: P12 (student never sees a raw 5xx/stack on a stream; a MolError becomes an `event: error` frame; client disconnect cancels cleanly). Enforced by `python/tests/integration/test_generate_stream_endpoint.py` (`test_stream_invalid_input_emits_error_event` + SSE content-type/done assertions).

- [ ] **Step 2 — (No code test.)** Confirm each named test exists and passes from the prior phases:
```
cd python && pytest tests/unit/test_router.py tests/unit/test_breaker.py tests/unit/test_cost_cap.py tests/unit/test_cache.py tests/unit/test_eval_harness.py tests/integration/test_generate_endpoint.py tests/integration/test_generate_stream_endpoint.py tests/integration/test_routing_parity.py -v
```
Expected: all referenced tests pass.

- [ ] **Step 3 — (No implementation code.)** The catalog entry IS the deliverable.

- [ ] **Step 4 — Run the full Python suite to confirm green + coverage gate (≥70%).**
```
cd python && pytest -q
```
Expected: all pass; `--cov-fail-under=70` satisfied.

- [ ] **Step 5 — Commit.**
```
git add .claude/regression-catalog.md && git commit -m "docs(catalog): REG-120..REG-124 — deterministic priority, breaker, cost-cap, parity gate, streaming safety"
```

### Review chain (P14)

This is an AI-orchestration change. Required reviewers before the work can be marked complete:
- **ai-engineer** — implements (owner of all `python/services/ai/mol/` + `api/v1/generate.py` changes).
- **assessment** — reviews routing correctness (deterministic OpenAI-priority preserves the CBSE task matrix) + the quality gate (golden-set content + `min_overall` floors + tolerance).
- **architect** — reviews Cloud Run config, the new Upstash Redis dependency on the hot path (fail-open posture), security of the Redis credentials in `config.py`, and deploy/`PYTHON_AI_BASE_URL` wiring.
- **ops** — owns the parity dashboard (TS-baseline vs Python-shadow) and the ₹/student rollup; drives the flag flips in the cutover runbook.
- **testing** — runs after every task (every phase ends green) and confirms REG-120..REG-124 are catalogued and CI-enforced.

User-approval gate already cleared: model-provider + architecture approval granted by CEO 2026-06-13 (per the design spec header).
