import math
from datetime import UTC, datetime
from typing import Any


def computeRetention(
    masteryMean: float, halfLifeHours: float, lastPracticedAt: str | None
) -> float:
    if not lastPracticedAt:
        return masteryMean * 0.5
    try:
        last_dt = datetime.fromisoformat(lastPracticedAt.replace("Z", "+00:00"))
    except ValueError:
        return masteryMean * 0.5

    hoursSince = (datetime.now(UTC) - last_dt).total_seconds() / 3600.0
    decayFactor = math.exp(-0.693 * hoursSince / max(halfLifeHours, 1))
    return masteryMean * decayFactor


def updateMastery(
    state: dict[str, Any],
    correct: bool,
    questionDifficulty: float,
    responseTimeMs: float,
    expectedTimeMs: float,
    telemetry: Any | None = None,
) -> dict[str, Any]:
    studentAbility = state.get("mastery_mean", 0.3) * 6 - 3
    qDiff = (questionDifficulty or 2) - 3
    pCorrect = 1 / (1 + math.exp(-1.7 * (studentAbility - qDiff)))
    surprise = abs((1 if correct else 0) - pCorrect)
    alpha = state.get("mastery_variance", 0.25) * 0.5 + 0.05

    # Telemetry penalties
    latency_penalty = 1.0
    if (
        correct
        and telemetry
        and getattr(telemetry, "latency_ms", 0)
        and getattr(telemetry, "latency_ms", 0) > 60000
    ):
        latency_penalty = 0.5  # Heavy hesitation penalty
    if correct and telemetry and getattr(telemetry, "changed_answers_count", 0) > 1:
        latency_penalty *= 0.7  # Guessing penalty

    newMastery = state.get("mastery_mean", 0.3)
    if correct:
        newMastery += alpha * (1 - newMastery) * (1 + surprise * 0.3) * latency_penalty
    else:
        newMastery -= alpha * newMastery * (0.5 + surprise * 0.3)
    newMastery = max(0.01, min(0.99, newMastery))

    newVariance = state.get("mastery_variance", 0.25) * (1 - 0.1 * (1 + surprise))
    newVariance = max(0.01, newVariance)

    newHalfLife = state.get("retention_half_life", 48)
    newHalfLife = min(newHalfLife * 1.5, 720) if correct else max(newHalfLife * 0.8, 4)

    errorType = None
    if not correct:
        if responseTimeMs < 5000 and questionDifficulty <= 2:
            errorType = "careless"
        elif state.get("mastery_mean", 0.3) < 0.4:
            errorType = "conceptual"
        else:
            errorType = "procedural"

    newStreak = state.get("streak_current", 0) + 1 if correct else 0

    return {
        "mastery_mean": newMastery,
        "mastery_variance": newVariance,
        "retention_half_life": newHalfLife,
        "current_retention": newMastery,
        "total_attempts": state.get("total_attempts", 0) + 1,
        "total_correct": state.get("total_correct", 0) + (1 if correct else 0),
        "streak_current": newStreak,
        "error_count_conceptual": state.get("error_count_conceptual", 0)
        + (1 if errorType == "conceptual" else 0),
        "error_count_procedural": state.get("error_count_procedural", 0)
        + (1 if errorType == "procedural" else 0),
        "error_count_careless": state.get("error_count_careless", 0)
        + (1 if errorType == "careless" else 0),
        "last_practiced_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
        "errorType": errorType,
    }


def selectNextAction(
    states: list[dict[str, Any]], topics: list[dict[str, Any]], subjectId: str, grade: str
) -> dict[str, Any]:
    stateMap = {s["concept_id"]: s for s in states}

    relevantTopics = [
        t for t in topics if t.get("subject_id") == subjectId and t.get("grade") == grade
    ]
    relevantTopics.sort(key=lambda x: (x.get("chapter_number") or 0, x.get("display_order") or 0))

    # Priority 1: Prerequisite gaps
    for topic in relevantTopics:
        prereqs = topic.get("prerequisite_topic_ids") or []
        for prereqId in prereqs:
            prereqState = stateMap.get(prereqId)
            if prereqState:
                retention = computeRetention(
                    prereqState["mastery_mean"],
                    prereqState["retention_half_life"],
                    prereqState.get("last_practiced_at"),
                )
                if retention < 0.4:
                    prereqTopic = next((t for t in topics if t["id"] == prereqId), None)
                    return {
                        "type": "remediate",
                        "concept_id": prereqId,
                        "title": prereqTopic["title"] if prereqTopic else "Prerequisite",
                        "reason": "Prerequisite gap needs remediation before advancing",
                        "difficulty": max(1, prereqState.get("max_difficulty_succeeded") or 1),
                    }

    # Priority 2: Concepts with high forgetting risk
    atRisk = []
    for s in states:
        retention = computeRetention(
            s["mastery_mean"], s["retention_half_life"], s.get("last_practiced_at")
        )
        if retention < 0.5 and s["mastery_mean"] > 0.4 and s.get("total_attempts", 0) > 0:
            atRisk.append((s, retention))

    if atRisk:
        atRisk.sort(key=lambda x: x[1])
        urgent = atRisk[0][0]
        urgent_topic = next((t for t in topics if t["id"] == urgent["concept_id"]), None)
        return {
            "type": "revise",
            "concept_id": urgent["concept_id"],
            "title": urgent_topic["title"] if urgent_topic else "Review concept",
            "reason": "Previously learned concept fading — revision needed",
            "difficulty": urgent.get("max_difficulty_succeeded") or 2,
        }

    # Priority 3: Concepts with repeated conceptual errors
    errorProne = [s for s in states if s.get("error_count_conceptual", 0) >= 3]
    if errorProne:
        errorProne.sort(key=lambda x: x.get("error_count_conceptual", 0), reverse=True)
        worst = errorProne[0]
        worst_topic = next((t for t in topics if t["id"] == worst["concept_id"]), None)
        return {
            "type": "re_teach",
            "concept_id": worst["concept_id"],
            "title": worst_topic["title"] if worst_topic else "Re-learn concept",
            "reason": "Repeated conceptual errors — needs different explanation approach",
            "difficulty": 1,
        }

    # Priority 4: Next unmastered concept in chapter order
    for topic in relevantTopics:
        state = stateMap.get(topic["id"])
        if not state or state.get("total_attempts", 0) == 0:
            return {
                "type": "teach",
                "concept_id": topic["id"],
                "title": topic["title"],
                "reason": "New concept — ready to learn",
                "difficulty": topic.get("difficulty_level") or 1,
            }

        if state["mastery_mean"] < 0.6:
            return {
                "type": "practice",
                "concept_id": topic["id"],
                "title": topic["title"],
                "reason": "Partially learned — needs more practice",
                "difficulty": state.get("max_difficulty_succeeded")
                or topic.get("difficulty_level")
                or 2,
            }

        if state["mastery_mean"] < 0.85:
            return {
                "type": "challenge",
                "concept_id": topic["id"],
                "title": topic["title"],
                "reason": "Approaching mastery — increasing difficulty",
                "difficulty": min((state.get("max_difficulty_succeeded") or 2) + 1, 5),
            }

    # Priority 5: All mastered
    return {
        "type": "exam_prep",
        "concept_id": None,
        "title": "Exam Preparation",
        "reason": "All concepts mastered — focus on exam-style practice",
        "difficulty": 3,
    }


def computeRevisionSchedule(states: list[dict[str, Any]]) -> list[dict[str, Any]]:
    now = datetime.now(UTC).timestamp()
    schedule = []

    for s in states:
        if s.get("total_attempts", 0) == 0:
            continue

        retention = computeRetention(
            s["mastery_mean"], s["retention_half_life"], s.get("last_practiced_at")
        )
        if retention < 0.7:
            hoursUntilHalf = s["retention_half_life"] * 0.7
            if s.get("last_practiced_at"):
                try:
                    last_dt = datetime.fromisoformat(s["last_practiced_at"].replace("Z", "+00:00"))
                    lastMs = last_dt.timestamp()
                except ValueError:
                    lastMs = now
            else:
                lastMs = now

            dueMs = lastMs + hoursUntilHalf * 3600.0
            due_ts = max(dueMs, now)
            due_dt = datetime.fromtimestamp(due_ts, UTC)

            schedule.append(
                {
                    "concept_id": s["concept_id"],
                    "due_at": due_dt.isoformat(),
                    "priority": (1 - retention) * (1.5 if s["mastery_mean"] > 0.6 else 1.0),
                    "revision_type": "remediation" if s["mastery_mean"] < 0.5 else "revision",
                }
            )

    schedule.sort(key=lambda x: x["priority"], reverse=True)
    return schedule[:10]


def computeExamReadiness(
    states: list[dict[str, Any]], topics: list[dict[str, Any]], subjectId: str, grade: str
) -> dict[str, Any]:
    relevant = [t for t in topics if t.get("subject_id") == subjectId and t.get("grade") == grade]
    stateMap = {s["concept_id"]: s for s in states}

    if not relevant:
        return {
            "overall": 0,
            "predicted_percentage": 0,
            "chapters": {},
            "weakest": [],
            "total_concepts": 0,
            "concepts_mastered": 0,
        }

    chapters: dict[Any, dict[str, float]] = {}
    for topic in relevant:
        ch = topic.get("chapter_number", 0)
        if ch not in chapters:
            chapters[ch] = {"total": 0, "mastered": 0, "retention_sum": 0}

        chapters[ch]["total"] += 1
        state = stateMap.get(topic["id"])
        if state:
            retention = computeRetention(
                state["mastery_mean"], state["retention_half_life"], state.get("last_practiced_at")
            )
            chapters[ch]["retention_sum"] += retention
            if retention >= 0.7:
                chapters[ch]["mastered"] += 1

    chapterScores: dict[str, float] = {}
    totalWeighted = 0.0
    totalTopics = 0.0

    for ch, data in chapters.items():
        score = data["retention_sum"] / data["total"] if data["total"] > 0 else 0
        chapterScores[f"Chapter {ch}"] = round(score * 100) / 100
        totalWeighted += data["retention_sum"]
        totalTopics += data["total"]

    overall = totalWeighted / totalTopics if totalTopics > 0 else 0

    weakest_list: list[dict[str, Any]] = [
        {"chapter": k, "score": v} for k, v in chapterScores.items()
    ]
    weakest_list.sort(key=lambda x: x["score"])

    concepts_mastered = 0
    for s in states:
        r = computeRetention(
            s["mastery_mean"], s["retention_half_life"], s.get("last_practiced_at")
        )
        if r >= 0.7:
            concepts_mastered += 1

    return {
        "overall": round(overall * 100) / 100,
        "predicted_percentage": round(overall * 100),
        "chapters": chapterScores,
        "weakest": weakest_list[:3],
        "total_concepts": len(relevant),
        "concepts_mastered": concepts_mastered,
    }
