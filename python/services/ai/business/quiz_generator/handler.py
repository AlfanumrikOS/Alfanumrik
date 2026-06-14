import datetime
import json
import math
import random
from typing import Any

from fastapi import HTTPException
from python.services.ai.shared.quiz_oracle import CandidateQuestion, run_deterministic_checks

from .models import (
    QuizGeneratorMeta,
    QuizGeneratorRequest,
    QuizGeneratorResponse,
    ResponseSoFar,
)

BLOOM_LEVELS_ORDERED = ["remember", "understand", "apply", "analyze", "evaluate", "create"]


def shuffle_list(arr: list[Any]) -> list[Any]:
    res = arr.copy()
    random.shuffle(res)
    return res


def mastery_to_difficulty(mastery: float) -> int:
    if mastery < 0.3:
        return 1
    if mastery < 0.65:
        return 2
    return 3


def mastery_to_min_bloom_level(mastery: float) -> str:
    if mastery < 0.3:
        return "remember"
    if mastery < 0.5:
        return "understand"
    if mastery < 0.7:
        return "apply"
    if mastery < 0.85:
        return "analyze"
    return "evaluate"


def get_bloom_levels_at_or_above(min_level: str) -> list[str]:
    try:
        idx = BLOOM_LEVELS_ORDERED.index(min_level)
        return BLOOM_LEVELS_ORDERED[idx:]
    except ValueError:
        return BLOOM_LEVELS_ORDERED.copy()


def mastery_to_max_bloom_level(mastery: float) -> str:
    if mastery < 0.3:
        return "understand"
    if mastery < 0.5:
        return "apply"
    if mastery < 0.7:
        return "analyze"
    if mastery < 0.85:
        return "evaluate"
    return "create"


def get_bloom_levels_up_to(max_level: str) -> list[str]:
    try:
        idx = BLOOM_LEVELS_ORDERED.index(max_level)
        return BLOOM_LEVELS_ORDERED[: idx + 1]
    except ValueError:
        return BLOOM_LEVELS_ORDERED.copy()


def deduplicate_adjacent_topics(questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = questions.copy()
    for i in range(1, len(result)):
        if result[i].get("topic") and result[i].get("topic") == result[i - 1].get("topic"):
            for j in range(i + 1, len(result)):
                if result[j].get("topic") != result[i - 1].get("topic"):
                    result[i], result[j] = result[j], result[i]
                    break
    return result


async def resolve_subject_id(supabase, subject_code: str) -> str | None:
    res = (
        supabase.table("subjects")
        .select("id")
        .eq("code", subject_code)
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    if res.data:
        return res.data.get("id")
    return None


async def check_rate_limit_db(student_id: str, supabase) -> bool:
    window_start = (datetime.datetime.utcnow() - datetime.timedelta(minutes=1)).isoformat()
    res = (
        supabase.table("quiz_sessions")
        .select("*", count="exact", head=True)
        .eq("student_id", student_id)
        .gte("created_at", window_start)
        .execute()
    )
    count = res.count if res.count is not None else 0
    return count < 20


async def fetch_due_review_questions(
    supabase,
    student_id: str,
    subject_id: str,
    subject_code: str,
    grade: str,
    max_count: int,
    exclude_ids: set[str],
) -> tuple[list[dict[str, Any]], int]:
    if max_count <= 0:
        return [], 0
    today_str = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    due_res = (
        supabase.table("spaced_repetition_cards")
        .select("source_id, topic, ease_factor, next_review_date")
        .eq("student_id", student_id)
        .eq("subject", subject_code)
        .eq("is_active", True)
        .lte("next_review_date", today_str)
        .order("next_review_date", desc=False)
        .order("ease_factor", desc=False)
        .execute()
    )

    due_cards = due_res.data or []
    if not due_cards:
        return [], 0

    candidate_ids = [
        c["source_id"]
        for c in due_cards
        if c.get("source_id") and c["source_id"] not in exclude_ids
    ]
    if not candidate_ids:
        return [], 0

    qs_res = (
        supabase.table("question_bank")
        .select("*")
        .in_("id", candidate_ids)
        .eq("is_active", True)
        .execute()
    )
    questions = qs_res.data or []

    for q in questions:
        q["_source"] = "review"

    unique_topics = set(c.get("topic") for c in due_cards if c.get("topic"))
    return questions[:max_count], len(unique_topics)


async def is_irt_selection_enabled(supabase) -> bool:
    res = (
        supabase.table("feature_flags")
        .select("is_enabled, rollout_percentage")
        .eq("flag_name", "ff_irt_question_selection")
        .maybe_single()
        .execute()
    )
    if res.data and res.data.get("is_enabled") and res.data.get("rollout_percentage", 0) >= 100:
        return True
    return False


async def select_questions_by_irt(
    supabase,
    student_id: str,
    subject: str,
    grade: str,
    chapter_number: int | None,
    count: int,
    exclude_ids: set[str],
) -> list[dict[str, Any]]:
    exclude = list(exclude_ids)
    res = supabase.rpc(
        "select_questions_by_irt_info",
        {
            "p_student_id": student_id,
            "p_subject": subject,
            "p_grade": grade,
            "p_chapter_number": chapter_number,
            "p_match_count": count,
            "p_exclude_ids": exclude if exclude else [],
        },
    ).execute()
    return res.data or []


async def select_adaptive_questions(
    supabase,
    student_id: str,
    subject_id: str,
    subject_code: str,
    grade: str,
    count: int,
    exclude_ids: set[str],
) -> tuple[list[dict[str, Any]], int]:
    now = datetime.datetime.utcnow().isoformat()
    mastery_res = (
        supabase.table("concept_mastery")
        .select(
            "topic_id, mastery_level, next_review_at, curriculum_topics!inner(subject_id, chapter_number, concept_tag)"
        )
        .eq("student_id", student_id)
        .eq("curriculum_topics.subject_id", subject_id)
        .lt("mastery_level", 0.95)
        .order("mastery_level", desc=False)
        .limit(20)
        .execute()
    )

    weak_topics = mastery_res.data or []

    def sort_key(t):
        is_due = 1 if t.get("next_review_at") and t["next_review_at"] <= now else 0
        return (-is_due, t.get("mastery_level", 0))

    prioritised = sorted(weak_topics, key=sort_key)

    questions = []
    used_ids = set(exclude_ids)
    slots_per_topic = max(1, count // max(len(prioritised), 1))

    target_topics_count = math.ceil(count / slots_per_topic) if slots_per_topic > 0 else 0
    target_topics = prioritised[:target_topics_count]

    for topic in target_topics:
        if len(questions) >= count:
            break

        ct = topic.get("curriculum_topics", {})
        chapter_num = ct.get("chapter_number")
        concept_tag = ct.get("concept_tag")
        target_diff = mastery_to_difficulty(topic.get("mastery_level", 0))
        max_bloom = mastery_to_max_bloom_level(topic.get("mastery_level", 0))
        allowed_blooms = get_bloom_levels_up_to(max_bloom)
        need = min(slots_per_topic, count - len(questions))

        exclusion_list = list(used_ids) if used_ids else ["00000000-0000-0000-0000-000000000000"]

        query = (
            supabase.table("question_bank")
            .select("*")
            .eq("subject", subject_code)
            .eq("grade", grade)
            .eq("is_active", True)
        )
        if exclusion_list:
            query = query.not_.in_("id", exclusion_list)

        if chapter_num is not None:
            query = query.eq("chapter_number", chapter_num)

        q1 = query.eq("difficulty", target_diff).in_("bloom_level", allowed_blooms)
        if concept_tag:
            q1 = q1.eq("concept_tag", concept_tag)

        res1 = q1.limit(need * 2).execute()
        qs = res1.data or []

        if len(qs) < need and concept_tag:
            q2 = (
                supabase.table("question_bank")
                .select("*")
                .eq("subject", subject_code)
                .eq("grade", grade)
                .eq("is_active", True)
            )
            if exclusion_list:
                q2 = q2.not_.in_("id", exclusion_list)
            if chapter_num is not None:
                q2 = q2.eq("chapter_number", chapter_num)
            q2 = q2.eq("difficulty", target_diff).in_("bloom_level", allowed_blooms)
            res2 = q2.limit(need * 2).execute()
            qs = res2.data or qs

        if len(qs) < need:
            q3 = (
                supabase.table("question_bank")
                .select("*")
                .eq("subject", subject_code)
                .eq("grade", grade)
                .eq("is_active", True)
            )
            if exclusion_list:
                q3 = q3.not_.in_("id", exclusion_list)
            if chapter_num is not None:
                q3 = q3.eq("chapter_number", chapter_num)
            q3 = q3.eq("difficulty", target_diff)
            res3 = q3.limit(need * 2).execute()
            qs = res3.data or qs

        shuffled = shuffle_list(qs)
        for q in shuffled:
            if len(questions) >= count:
                break
            if q["id"] not in used_ids:
                questions.append(q)
                used_ids.add(q["id"])
                need -= 1
                if need <= 0:
                    break

    return questions, len(target_topics)


async def select_random_questions(
    supabase,
    subject_code: str,
    grade: str,
    count: int,
    difficulty: int | None,
    exclude_ids: set[str],
    chapter_number: int | None = None,
) -> list[dict[str, Any]]:
    query = (
        supabase.table("question_bank")
        .select("*")
        .eq("subject", subject_code)
        .eq("is_active", True)
        .eq("grade", grade)
    )
    if difficulty is not None:
        query = query.eq("difficulty", difficulty)
    if chapter_number is not None:
        query = query.eq("chapter_number", chapter_number)

    res = query.limit(count * 3).execute()
    qs = res.data or []
    pool = [q for q in qs if q["id"] not in exclude_ids]
    return shuffle_list(pool)[:count]


async def fetch_seen_question_ids(
    supabase, student_id: str, subject: str, grade: str, chapter_number: int | None
) -> set[str]:
    query = (
        supabase.table("user_question_history")
        .select("question_id")
        .eq("student_id", student_id)
        .eq("subject", subject)
        .eq("grade", grade)
    )
    if chapter_number is not None:
        query = query.eq("chapter_number", chapter_number)
    res = query.limit(500).execute()
    return set(r["question_id"] for r in (res.data or []))


async def check_and_reset_history(
    supabase, student_id: str, subject: str, grade: str, chapter_number: int | None, total_pool: int
):
    query = (
        supabase.table("user_question_history")
        .select("*", count="exact", head=True)
        .eq("student_id", student_id)
        .eq("subject", subject)
        .eq("grade", grade)
    )
    if chapter_number is not None:
        query = query.eq("chapter_number", chapter_number)
    res = query.execute()
    seen_count = res.count if res.count is not None else 0
    if total_pool > 0 and (seen_count / total_pool) >= 0.8:
        del_query = (
            supabase.table("user_question_history")
            .delete()
            .eq("student_id", student_id)
            .eq("subject", subject)
            .eq("grade", grade)
        )
        if chapter_number is not None:
            del_query = del_query.eq("chapter_number", chapter_number)
        del_query.execute()


async def record_shown_questions(
    supabase, student_id: str, subject: str, grade: str, questions: list[dict[str, Any]]
):
    if not questions:
        return
    now = datetime.datetime.utcnow().isoformat()
    rows = []
    for q in questions:
        rows.append(
            {
                "student_id": student_id,
                "question_id": q["id"],
                "subject": subject,
                "grade": grade,
                "chapter_number": q.get("chapter_number"),
                "first_shown_at": now,
                "last_shown_at": now,
                "times_shown": 1,
            }
        )
    supabase.table("user_question_history").upsert(
        rows, on_conflict="student_id,question_id"
    ).execute()


def compute_adaptive_difficulty(responses: list[ResponseSoFar]) -> dict[str, Any]:
    if not responses:
        return {
            "adjustedDifficulty": 1,
            "reason": "no responses yet",
            "bloomCeiling": "understand",
            "runningScore": "0/0 (0%)",
        }

    correct_count = sum(1 for r in responses if r.is_correct)
    total_count = len(responses)
    score_percent = round((correct_count / total_count) * 100)
    running_score = f"{correct_count}/{total_count} ({score_percent}%)"

    current_difficulty = 2
    consecutive_correct = 0
    consecutive_wrong = 0

    for r in reversed(responses):
        if r.is_correct:
            if consecutive_wrong > 0:
                break
            consecutive_correct += 1
        else:
            if consecutive_correct > 0:
                break
            consecutive_wrong += 1

    reason = "maintaining current difficulty"
    recent_correct = [r for r in responses if r.is_correct][-5:]
    avg_correct_time = (
        sum(r.time_spent for r in recent_correct) / len(recent_correct) if recent_correct else 15
    )
    avg_overall_time = sum(r.time_spent for r in responses) / total_count if total_count > 0 else 15

    if consecutive_correct >= 3:
        current_difficulty = min(3, current_difficulty + 1)
        reason = f"{consecutive_correct} consecutive correct answers"
    elif consecutive_wrong >= 2:
        current_difficulty = max(1, current_difficulty - 1)
        reason = f"{consecutive_wrong} consecutive wrong answers"
    elif avg_correct_time < 5 and len(recent_correct) >= 2:
        current_difficulty = min(3, current_difficulty + 1)
        reason = f"fast correct answers (avg {avg_correct_time:.1f}s)"
    elif avg_overall_time > 45:
        current_difficulty = max(1, current_difficulty - 1)
        reason = f"slow average response time ({avg_overall_time:.1f}s)"

    mastery_estimate = score_percent / 100.0
    bloom_ceiling = mastery_to_max_bloom_level(mastery_estimate)

    return {
        "adjustedDifficulty": current_difficulty,
        "reason": reason,
        "bloomCeiling": bloom_ceiling,
        "runningScore": running_score,
    }


async def handle_next_question(supabase, body: QuizGeneratorRequest) -> QuizGeneratorResponse:
    student_id = body.student_id
    subject = body.subject
    grade = body.grade
    responses_so_far = body.responses_so_far or []
    exclude_ids = set(body.exclude_ids or [])
    chapter_number = body.chapter_number

    adapt = compute_adaptive_difficulty(responses_so_far)
    adjusted_difficulty = adapt["adjustedDifficulty"]
    reason = adapt["reason"]
    bloom_ceiling = adapt["bloomCeiling"]
    running_score = adapt["runningScore"]

    allowed_blooms = get_bloom_levels_up_to(bloom_ceiling)
    exclusion_list = list(exclude_ids) if exclude_ids else ["00000000-0000-0000-0000-000000000000"]

    query = (
        supabase.table("question_bank")
        .select("*")
        .eq("subject", subject)
        .eq("grade", grade)
        .eq("is_active", True)
    )
    if exclusion_list:
        query = query.not_.in_("id", exclusion_list)
    if chapter_number is not None:
        query = query.eq("chapter_number", chapter_number)

    q1 = query.eq("difficulty", adjusted_difficulty).in_("bloom_level", allowed_blooms)
    res1 = q1.limit(10).execute()
    candidates = res1.data or []

    if not candidates:
        q2 = (
            supabase.table("question_bank")
            .select("*")
            .eq("subject", subject)
            .eq("grade", grade)
            .eq("is_active", True)
        )
        if exclusion_list:
            q2 = q2.not_.in_("id", exclusion_list)
        if chapter_number is not None:
            q2 = q2.eq("chapter_number", chapter_number)
        q2 = q2.eq("difficulty", adjusted_difficulty)
        res2 = q2.limit(10).execute()
        candidates = res2.data or []

    if not candidates:
        adj_diffs = [d for d in [adjusted_difficulty - 1, adjusted_difficulty + 1] if 1 <= d <= 3]
        q3 = (
            supabase.table("question_bank")
            .select("*")
            .eq("subject", subject)
            .eq("grade", grade)
            .eq("is_active", True)
        )
        if exclusion_list:
            q3 = q3.not_.in_("id", exclusion_list)
        if chapter_number is not None:
            q3 = q3.eq("chapter_number", chapter_number)
        q3 = q3.in_("difficulty", adj_diffs)
        res3 = q3.limit(10).execute()
        candidates = res3.data or []

    if not candidates:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "No questions available at the adjusted difficulty",
                "meta": {
                    "adjustedDifficulty": adjusted_difficulty,
                    "reason": reason,
                    "runningScore": running_score,
                    "bloomCeiling": bloom_ceiling,
                },
            },
        )

    selected = random.choice(candidates)
    await record_shown_questions(supabase, student_id, subject, grade, [selected])

    return QuizGeneratorResponse(
        question=selected,
        meta=QuizGeneratorMeta(
            adjusted_difficulty=adjusted_difficulty,
            reason=reason,
            running_score=running_score,
            bloom_ceiling=bloom_ceiling,
        ),
    )


async def generate_quiz(supabase, body: QuizGeneratorRequest) -> QuizGeneratorResponse:
    student_id = body.student_id
    subject = body.subject
    grade = body.grade
    chapter_number = body.chapter_number
    count = min(max(body.count or 10, 1), 30)

    difficulty = body.difficulty
    ability_estimate = body.ability_estimate

    if difficulty is None and ability_estimate is not None:
        if ability_estimate < -1.0:
            difficulty = 1
        elif ability_estimate < 0.5:
            difficulty = 2
        else:
            difficulty = 3

    db_rate_ok = await check_rate_limit_db(student_id, supabase)
    if not db_rate_ok:
        raise HTTPException(
            status_code=429, detail="Too many requests. Please wait before generating another quiz."
        )

    subject_id = await resolve_subject_id(supabase, subject)
    if not subject_id:
        raise HTTPException(status_code=404, detail=f"Subject '{subject}' not found or inactive")

    pool_query = (
        supabase.table("question_bank")
        .select("*", count="exact", head=True)
        .eq("subject", subject)
        .eq("grade", grade)
        .eq("is_active", True)
    )
    if chapter_number is not None:
        pool_query = pool_query.eq("chapter_number", chapter_number)
    pool_res = pool_query.execute()
    total_pool = pool_res.count if pool_res.count is not None else 0

    await check_and_reset_history(supabase, student_id, subject, grade, chapter_number, total_pool)
    seen_ids = await fetch_seen_question_ids(supabase, student_id, subject, grade, chapter_number)

    review_questions = []
    review_topic_count = 0
    if body.difficulty is None:
        review_slots = count // 2
        review_questions, review_topic_count = await fetch_due_review_questions(
            supabase, student_id, subject_id, subject, grade, review_slots, seen_ids
        )

    review_ids = set(q["id"] for q in review_questions)
    used_after_review = seen_ids.union(review_ids)

    adaptive_questions = []
    weak_topics_targeted = 0
    strategy = "adaptive"

    adaptive_slots = count - len(review_questions)

    if body.difficulty is None and adaptive_slots > 0:
        use_irt = await is_irt_selection_enabled(supabase)
        if use_irt:
            irt_qs = await select_questions_by_irt(
                supabase,
                student_id,
                subject,
                grade,
                chapter_number,
                adaptive_slots,
                used_after_review,
            )
            if len(irt_qs) >= adaptive_slots:
                adaptive_questions = irt_qs
                weak_topics_targeted = 0

        if not adaptive_questions:
            ad_qs, wt_count = await select_adaptive_questions(
                supabase, student_id, subject_id, subject, grade, adaptive_slots, used_after_review
            )
            adaptive_questions = ad_qs
            weak_topics_targeted = wt_count

    questions = review_questions + adaptive_questions

    if len(questions) < count:
        used_ids = used_after_review.union(set(q["id"] for q in adaptive_questions))
        if not questions:
            strategy = "random"
        remaining = count - len(questions)
        random_qs = await select_random_questions(
            supabase, subject, grade, remaining, difficulty, used_ids, chapter_number
        )
        questions += random_qs

    await record_shown_questions(supabase, student_id, subject, grade, questions)

    questions = shuffle_list(questions)
    interleaved = deduplicate_adjacent_topics(questions)

    bloom_distribution = {}
    for q in interleaved:
        level = q.get("bloom_level", "unknown")
        bloom_distribution[level] = bloom_distribution.get(level, 0) + 1

    review_count = len(review_questions)
    adaptive_count = len(adaptive_questions)
    random_count = len(interleaved) - review_count - adaptive_count
    review_question_ids = list(review_ids)

    dropped_reasons = []
    validated = []
    for q in interleaved:
        opts = q.get("options")
        if isinstance(opts, str):
            try:
                opts = json.loads(opts)
            except:
                opts = []

        candidate = CandidateQuestion(
            question_text=q.get("question_text", ""),
            options=opts if isinstance(opts, list) else [],
            correct_answer_index=q.get("correct_answer_index", -1),
            explanation=q.get("explanation", ""),
        )
        fail = run_deterministic_checks(candidate)
        if fail is not None:
            dropped_reasons.append(fail.category)
        else:
            validated.append(q)

    dropped_by_validator = len(interleaved) - len(validated)
    min_count = max(1, (count + 1) // 2)

    if len(validated) < min_count:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "insufficient_validated_questions",
                "dropped": dropped_by_validator,
                "served": len(validated),
                "requested": count,
                "dropped_reasons": dropped_reasons,
            },
        )

    return QuizGeneratorResponse(
        questions=validated,
        meta=QuizGeneratorMeta(
            strategy=strategy,
            weak_topics_targeted=weak_topics_targeted,
            total_returned=len(validated),
            bloom_distribution=bloom_distribution,
            review_count=review_count,
            adaptive_count=adaptive_count,
            random_count=random_count,
            review_topic_count=review_topic_count,
            review_question_ids=review_question_ids,
            dropped_by_p6_validator=dropped_by_validator,
            dropped_reasons=dropped_reasons,
        ),
    )
