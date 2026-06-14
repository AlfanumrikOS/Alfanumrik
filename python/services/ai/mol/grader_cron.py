import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import structlog

from ..db.supabase import get_service_client
from .grader import (
    GRADER_DAILY_CAP_INR,
    GRADER_DAILY_COST_CAP_INR,
    GRADER_SAMPLING_RATES,
    GraderInput,
    GraderResult,
    grade_shadow_pair,
    grader_sample_bucket,
)

logger = structlog.get_logger(__name__)

BATCH_CONCURRENCY = 5
ESTIMATED_GRADER_INR_PER_CALL = 1.0


@dataclass
class ShadowPairRow:
    request_id: str
    task_type: str
    shadow_of_request_id: str | None
    grade: str | None


@dataclass
class GraderCronResult:
    graded: int = 0
    skipped_no_text: int = 0
    skipped_unsampled: int = 0
    cost_cap_triggered: bool = False
    killed: bool = False
    daily_shadow_cost_inr: float = 0.0
    grader_cap_triggered: bool = False
    estimated_grader_cost_inr: float = 0.0


async def grade_mol_shadow_pairs(
    now_fn=None,
    grader_fn=None,
    sampling_rates: dict[str, int] | None = None,
    cost_cap_inr: float | None = None,
    grader_cap_inr: float | None = None,
    batch_concurrency: int | None = None,
    estimated_grader_inr_per_call: float | None = None,
) -> GraderCronResult:
    if now_fn is None:

        def default_now():
            return datetime.now(UTC)

        now_fn = default_now

    grader = grader_fn if grader_fn is not None else grade_shadow_pair
    rates = sampling_rates if sampling_rates is not None else GRADER_SAMPLING_RATES
    cost_cap = cost_cap_inr if cost_cap_inr is not None else GRADER_DAILY_COST_CAP_INR
    grader_cap = grader_cap_inr if grader_cap_inr is not None else GRADER_DAILY_CAP_INR
    concurrency = batch_concurrency if batch_concurrency is not None else BATCH_CONCURRENCY
    est_inr = (
        estimated_grader_inr_per_call
        if estimated_grader_inr_per_call is not None
        else ESTIMATED_GRADER_INR_PER_CALL
    )

    result = GraderCronResult()
    client = get_service_client()
    if not client:
        logger.warning("grader_cron: no supabase client configured")
        return result

    today = now_fn()
    today_start_iso = today.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

    try:
        res = (
            await client.table("mol_request_logs")
            .select("inr_cost")
            .eq("shadow_role", "shadow")
            .gte("created_at", today_start_iso)
            .execute()
        )

        data = getattr(res, "data", None)
        if data is None and isinstance(res, dict):
            data = res.get("data")

        if isinstance(data, list):
            total_sum = sum(r.get("inr_cost") or 0.0 for r in data)
            result.daily_shadow_cost_inr = round(total_sum, 4)

            if total_sum > cost_cap:
                result.cost_cap_triggered = True
                result.killed = await _flip_kill_switch(client, today)
                if result.killed:
                    await _emit_kill_switch_audit(
                        client,
                        {
                            "daily_shadow_cost_inr": result.daily_shadow_cost_inr,
                            "cap_inr": cost_cap,
                            "run_at": today.isoformat(),
                        },
                    )
                return result
    except Exception as err:
        logger.warning(f"grader_cron: cost-cap check threw: {err}")

    cutoff_iso = datetime.fromtimestamp(now_fn().timestamp() - 48 * 3600, UTC).isoformat()
    candidates: list[ShadowPairRow] = []

    try:
        res = (
            await client.table("mol_request_logs")
            .select("request_id,task_type,shadow_of_request_id,grade")
            .eq("shadow_role", "shadow")
            .is_("shadow_grader_score", "null")
            .gte("created_at", cutoff_iso)
            .execute()
        )

        data = getattr(res, "data", None)
        if data is None and isinstance(res, dict):
            data = res.get("data")

        if isinstance(data, list):
            candidates = [
                ShadowPairRow(
                    request_id=r["request_id"],
                    task_type=r.get("task_type", ""),
                    shadow_of_request_id=r.get("shadow_of_request_id"),
                    grade=r.get("grade"),
                )
                for r in data
            ]
    except Exception as err:
        logger.warning(f"grader_cron: ungraded fetch threw: {err}")
        return result

    if not candidates:
        return result

    sampled: list[ShadowPairRow] = []
    for c in candidates:
        rate = rates.get(c.task_type, 0)
        if rate <= 0:
            result.skipped_unsampled += 1
            continue
        if grader_sample_bucket(c.request_id) < rate:
            sampled.append(c)
        else:
            result.skipped_unsampled += 1

    for i in range(0, len(sampled), concurrency):
        if result.estimated_grader_cost_inr >= grader_cap:
            result.grader_cap_triggered = True
            logger.warning(
                f"grader_cron: grader Sonnet cap reached: estimated={result.estimated_grader_cost_inr} cap={grader_cap} — aborting remaining batches"
            )
            result.skipped_no_text += len(sampled) - i
            break

        batch = sampled[i : i + concurrency]
        tasks = [_grade_one_pair(client, pair, grader, today) for pair in batch]

        settled = await asyncio.gather(*tasks, return_exceptions=True)

        for outcome in settled:
            if isinstance(outcome, Exception):
                result.skipped_no_text += 1
                logger.warning(f"grader_cron: unexpected worker rejection: {outcome}")
                result.estimated_grader_cost_inr = round(
                    result.estimated_grader_cost_inr + est_inr, 4
                )
                continue

            if outcome["kind"] == "graded":
                result.graded += 1
            elif outcome["kind"] == "skipped_no_text":
                result.skipped_no_text += 1

            if outcome["charged"]:
                result.estimated_grader_cost_inr = round(
                    result.estimated_grader_cost_inr + est_inr, 4
                )

    return result


async def _grade_one_pair(
    client: Any, pair: ShadowPairRow, grader: Any, now: datetime
) -> dict[str, Any]:
    texts = await _resolve_texts(client, pair)
    if not texts:
        return {"kind": "skipped_no_text", "charged": False}

    if not grader:
        return {"kind": "skipped_no_text", "charged": False}

    start_time = datetime.now(UTC)
    out: GraderResult | None = None

    try:
        out = await grader(
            GraderInput(
                question=texts["question"],
                baseline_text=texts["baseline_text"],
                shadow_text=texts["shadow_text"],
                grade=pair.grade or "",
                coach_mode=None,
            )
        )
    except Exception as err:
        logger.warning(f"grader_cron: grader threw for {pair.request_id}: {err}")
        return {"kind": "skipped_no_text", "charged": True}

    latency_ms = int((datetime.now(UTC) - start_time).total_seconds() * 1000)

    if not out:
        await _write_grader_telemetry(client, pair, None, latency_ms)
        return {"kind": "skipped_no_text", "charged": True}

    try:
        from dataclasses import asdict

        payload_dict = asdict(out)
        await (
            client.table("mol_request_logs")
            .update(
                {
                    "shadow_grader_score": out.shadow.overall,
                    "shadow_grader_payload": payload_dict,
                    "shadow_graded_at": datetime.now(UTC).isoformat(),
                }
            )
            .eq("request_id", pair.request_id)
            .eq("shadow_role", "shadow")
            .execute()
        )
    except Exception as err:
        logger.warning(f"grader_cron: update threw for {pair.request_id}: {err}")
        await _write_grader_telemetry(client, pair, out, latency_ms)
        return {"kind": "skipped_no_text", "charged": True}

    await _write_grader_telemetry(client, pair, out, latency_ms)
    await _cleanup_graded_text(client, pair.request_id)
    return {"kind": "graded", "charged": True}


async def _resolve_texts(client: Any, pair: ShadowPairRow) -> dict[str, str] | None:
    try:
        res = (
            await client.table("mol_shadow_text_buffer")
            .select(
                "question_text,baseline_system_prompt,baseline_response_text,shadow_response_text"
            )
            .eq("shadow_request_id", pair.request_id)
            .limit(1)
            .execute()
        )

        data = getattr(res, "data", None)
        if data is None and isinstance(res, dict):
            data = res.get("data")

        if data and isinstance(data, list) and len(data) > 0:
            row = data[0]
            return {
                "question": row.get("question_text", ""),
                "baseline_text": row.get("baseline_response_text", ""),
                "shadow_text": row.get("shadow_response_text", ""),
                "baseline_system_prompt": row.get("baseline_system_prompt", ""),
            }
        return None
    except Exception as err:
        logger.warning(f"grader_cron: resolveTexts threw for {pair.request_id}: {err}")
        return None


async def _cleanup_graded_text(client: Any, shadow_request_id: str) -> None:
    try:
        await (
            client.table("mol_shadow_text_buffer")
            .delete()
            .eq("shadow_request_id", shadow_request_id)
            .execute()
        )
    except Exception as err:
        logger.warning(f"grader_cron: cleanupGradedText threw for {shadow_request_id}: {err}")


async def _flip_kill_switch(client: Any, now: datetime) -> bool:
    try:
        res = (
            await client.table("feature_flags")
            .select("metadata")
            .eq("flag_name", "ff_grounded_answer_mol_shadow_v1")
            .execute()
        )
        data = getattr(res, "data", None)
        if data is None and isinstance(res, dict):
            data = res.get("data")

        existing = {}
        if data and isinstance(data, list) and len(data) > 0:
            existing = data[0].get("metadata") or {}

        next_meta = {**existing, "kill_switch": True}
        await (
            client.table("feature_flags")
            .update({"metadata": next_meta, "updated_at": now.isoformat()})
            .eq("flag_name", "ff_grounded_answer_mol_shadow_v1")
            .execute()
        )

        logger.warning("grader_cron: kill_switch FLIPPED — daily shadow cost exceeded cap")
        return True
    except Exception as err:
        logger.warning(f"grader_cron: kill-switch threw: {err}")
        return False


async def _emit_kill_switch_audit(client: Any, payload: dict[str, Any]) -> None:
    try:
        await (
            client.table("audit_logs")
            .insert(
                {
                    "auth_user_id": None,
                    "actor_type": "cron",
                    "action": "mol_shadow_kill_switch_flipped",
                    "resource_type": "mol_shadow_grader",
                    "resource_id": "ff_grounded_answer_mol_shadow_v1",
                    "details": {
                        "daily_shadow_cost_inr": payload["daily_shadow_cost_inr"],
                        "cap_inr": payload["cap_inr"],
                        "run_at": payload["run_at"],
                        "actor": "system:mol-grader-cron",
                    },
                    "status": "success",
                }
            )
            .execute()
        )
    except Exception as err:
        logger.warning(f"grader_cron: audit_logs threw: {err}")


async def _write_grader_telemetry(
    client: Any, pair: ShadowPairRow, result: GraderResult | None, latency_ms: int
) -> None:
    try:
        failed = result is None
        await (
            client.table("mol_request_logs")
            .insert(
                {
                    "request_id": f"grader-{pair.request_id}",
                    "task_type": "shadow_grader",
                    "surface": "cron",
                    "provider": "anthropic",
                    "model": result.model if result else "claude-sonnet-4-6-20251022",
                    "passes": 1,
                    "fallback_count": 0,
                    "failure_chain": "grader:no_result" if failed else None,
                    "latency_ms": max(0, int(latency_ms)),
                    "prompt_tokens": result.prompt_tokens if result else 0,
                    "completion_tokens": result.completion_tokens if result else 0,
                    "usd_cost": 0.0,
                    "inr_cost": ESTIMATED_GRADER_INR_PER_CALL,
                }
            )
            .execute()
        )
    except Exception as err:
        logger.warning(f"grader_cron: grader telemetry failed: {err}")
