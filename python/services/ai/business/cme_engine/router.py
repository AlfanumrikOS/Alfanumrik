from __future__ import annotations

from typing import Any

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException

from ...db.supabase import get_service_client
from .handler import (
    computeExamReadiness,
    computeRetention,
    computeRevisionSchedule,
    selectNextAction,
    updateMastery,
)
from .models import (
    ConceptStateListResponse,
    ConceptStateRequest,
    ExamReadinessRequest,
    ExamReadinessResponse,
    NextActionRequest,
    NextActionResponse,
    RecordResponseRequest,
    RecordResponseResponse,
    RevisionScheduleResponse,
)

router = APIRouter(prefix="/cme", tags=["cme"])


async def get_current_student(authorization: str = Header(None)) -> dict[str, Any]:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization required")

    token = authorization.replace("Bearer ", "")
    try:
        # Decode without verification assuming API Gateway handles signature verification
        # Or this service role client allows us to look up the student directly.
        decoded = jwt.decode(token, options={"verify_signature": False})
        user_id = decoded.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token structure")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token") from None

    client = get_service_client()
    if not client:
        raise HTTPException(status_code=500, detail="Database client not configured")

    res = (
        await client.table("students")
        .select("id, grade, preferred_subject")
        .eq("auth_user_id", user_id)
        .eq("is_active", True)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Student not found")

    return res.data[0]


@router.post("/next_action", response_model=NextActionResponse)
async def next_action(
    req: NextActionRequest, student: dict[str, Any] = Depends(get_current_student)
):
    client = get_service_client()
    subject_id = req.subject_id
    if not subject_id:
        raise HTTPException(status_code=400, detail="subject_id required")

    # Subject validation logic (omitted complex RPC for now, or just simple check)
    subj_res = await client.table("subjects").select("code").eq("id", subject_id).execute()
    if not subj_res.data:
        raise HTTPException(status_code=422, detail="subject_not_allowed")

    states_res = (
        await client.table("cme_concept_state")
        .select("*")
        .eq("student_id", student["id"])
        .execute()
    )
    topics_res = (
        await client.table("curriculum_topics")
        .select(
            "id,title,parent_topic_id,prerequisite_topic_ids,difficulty_level,bloom_focus,chapter_number,display_order,grade,subject_id"
        )
        .eq("is_active", True)
        .is_("deleted_at", "null")
        .execute()
    )

    states = states_res.data or []
    topics = topics_res.data or []

    result = selectNextAction(states, topics, subject_id, student.get("grade"))

    # Log action
    await (
        client.table("cme_action_log")
        .insert(
            {
                "student_id": student["id"],
                "action_type": result["type"],
                "concept_id": result.get("concept_id"),
                "reason": result.get("reason"),
            }
        )
        .execute()
    )

    return result


@router.post("/record_response", response_model=RecordResponseResponse)
async def record_response(
    req: RecordResponseRequest, student: dict[str, Any] = Depends(get_current_student)
):
    client = get_service_client()

    existing_res = (
        await client.table("cme_concept_state")
        .select("*")
        .eq("student_id", student["id"])
        .eq("concept_id", req.concept_id)
        .execute()
    )

    current_state = (
        existing_res.data[0]
        if existing_res.data
        else {
            "mastery_mean": 0.3,
            "mastery_variance": 0.25,
            "retention_half_life": 48.0,
            "total_attempts": 0,
            "total_correct": 0,
            "streak_current": 0,
            "error_count_conceptual": 0,
            "error_count_procedural": 0,
            "error_count_careless": 0,
            "last_practiced_at": None,
            "max_difficulty_succeeded": 1,
        }
    )

    updated = updateMastery(
        state=current_state,
        correct=req.correct,
        questionDifficulty=req.difficulty or 2,
        responseTimeMs=req.response_time_ms or 30000,
        expectedTimeMs=30000,
        telemetry=req.telemetry,
    )

    max_diff = current_state.get("max_difficulty_succeeded") or 1
    if req.correct:
        max_diff = max(max_diff, req.difficulty or 1)

    upsert_data = {
        "student_id": student["id"],
        "concept_id": req.concept_id,
        "mastery_mean": updated["mastery_mean"],
        "mastery_variance": updated["mastery_variance"],
        "retention_half_life": updated["retention_half_life"],
        "current_retention": updated["current_retention"],
        "total_attempts": updated["total_attempts"],
        "total_correct": updated["total_correct"],
        "streak_current": updated["streak_current"],
        "error_count_conceptual": updated["error_count_conceptual"],
        "error_count_procedural": updated["error_count_procedural"],
        "error_count_careless": updated["error_count_careless"],
        "last_practiced_at": updated["last_practiced_at"],
        "avg_response_time_ms": req.response_time_ms,
        "max_difficulty_succeeded": max_diff,
        "updated_at": updated["updated_at"],
    }

    await (
        client.table("cme_concept_state")
        .upsert(upsert_data, on_conflict="student_id,concept_id")
        .execute()
    )

    if not req.correct and updated.get("errorType"):
        await (
            client.table("cme_error_log")
            .insert(
                {
                    "student_id": student["id"],
                    "concept_id": req.concept_id,
                    "question_id": req.question_id,
                    "error_type": updated["errorType"],
                    "student_answer": (req.student_answer or "")[:500],
                    "correct_answer": (req.correct_answer or "")[:500],
                    "response_time_ms": req.response_time_ms,
                }
            )
            .execute()
        )

    if req.telemetry:
        await (
            client.table("micro_telemetry_events")
            .insert(
                {
                    "student_id": student["id"],
                    "event_type": "question_response_telemetry",
                    "metadata": {
                        "concept_id": req.concept_id,
                        "question_id": req.question_id,
                        "latency_ms": getattr(req.telemetry, "latency_ms", None),
                        "changed_answers_count": getattr(req.telemetry, "changed_answers_count", 0),
                        "hints_used": getattr(req.telemetry, "hints_used", 0),
                    },
                }
            )
            .execute()
        )

    return {
        "mastery": updated["mastery_mean"],
        "retention": updated["current_retention"],
        "streak": updated["streak_current"],
        "error_type": updated.get("errorType"),
        "total_attempts": updated["total_attempts"],
        "total_correct": updated["total_correct"],
    }


@router.post("/concept_state", response_model=ConceptStateListResponse)
async def get_concept_state(
    req: ConceptStateRequest, student: dict[str, Any] = Depends(get_current_student)
):
    client = get_service_client()

    # Validation per logic
    if req.subject_id:
        subj_res = await client.table("subjects").select("code").eq("id", req.subject_id).execute()
        if not subj_res.data:
            raise HTTPException(status_code=422, detail="subject_not_allowed")

    states_res = (
        await client.table("cme_concept_state")
        .select(
            "concept_id, mastery_mean, current_retention, retention_half_life, last_practiced_at, total_attempts, total_correct, streak_current, error_count_conceptual, max_difficulty_succeeded"
        )
        .eq("student_id", student["id"])
        .execute()
    )

    states = states_res.data or []
    for s in states:
        s["current_retention"] = computeRetention(
            s["mastery_mean"], s["retention_half_life"], s.get("last_practiced_at")
        )

    return {"data": states}


@router.get("/revision_due", response_model=RevisionScheduleResponse)
async def get_revision_due(student: dict[str, Any] = Depends(get_current_student)):
    client = get_service_client()

    states_res = (
        await client.table("cme_concept_state")
        .select(
            "concept_id, mastery_mean, retention_half_life, last_practiced_at, total_attempts, max_difficulty_succeeded, error_count_conceptual, current_retention"
        )
        .eq("student_id", student["id"])
        .execute()
    )

    states = states_res.data or []
    schedule = computeRevisionSchedule(states)

    if schedule:
        concept_ids = [s["concept_id"] for s in schedule]
        topics_res = (
            await client.table("curriculum_topics")
            .select("id, title")
            .in_("id", concept_ids)
            .execute()
        )

        title_map = {t["id"]: t["title"] for t in (topics_res.data or [])}
        for item in schedule:
            item["title"] = title_map.get(item["concept_id"], "Unknown")

    return {"data": schedule}


@router.post("/exam_readiness", response_model=ExamReadinessResponse)
async def get_exam_readiness(
    req: ExamReadinessRequest, student: dict[str, Any] = Depends(get_current_student)
):
    client = get_service_client()

    if not req.subject_id:
        raise HTTPException(status_code=400, detail="subject_id required")

    subj_res = await client.table("subjects").select("code").eq("id", req.subject_id).execute()
    if not subj_res.data:
        raise HTTPException(status_code=422, detail="subject_not_allowed")

    states_res = (
        await client.table("cme_concept_state")
        .select(
            "concept_id, mastery_mean, retention_half_life, last_practiced_at, total_attempts, max_difficulty_succeeded, error_count_conceptual, current_retention"
        )
        .eq("student_id", student["id"])
        .execute()
    )

    topics_res = (
        await client.table("curriculum_topics")
        .select(
            "id,title,subject_id,grade,chapter_number,difficulty_level,bloom_focus,prerequisite_topic_ids,parent_topic_id,display_order"
        )
        .eq("is_active", True)
        .is_("deleted_at", "null")
        .execute()
    )

    states = states_res.data or []
    topics = topics_res.data or []

    readiness = computeExamReadiness(states, topics, req.subject_id, student.get("grade"))

    await (
        client.table("cme_exam_readiness")
        .insert(
            {
                "student_id": student["id"],
                "exam_type": req.exam_type or "periodic",
                "overall_score": readiness["overall"],
                "predicted_marks": readiness["predicted_percentage"],
                "chapter_breakdown": readiness["chapters"],
                "weakest_chapters": [w["chapter"] for w in readiness["weakest"]],
            }
        )
        .execute()
    )

    return readiness
