"""Supabase IO - chapter discovery + extraction coverage stats.

Reuses the same grade/subject normalization helpers from generate_concepts
since both functions operate on the same rag_content_chunks +
chapter_concepts schema.
"""

from __future__ import annotations

from typing import Any

import structlog

from ...db.supabase import get_service_client
from ..generate_concepts.normalize import (
    SUBJECT_MAP,
    normalize_grade,
    normalize_subject,
)

logger = structlog.get_logger(__name__)


class RepositoryError(Exception):
    pass


def _rows(result: Any) -> list[Any]:
    data = getattr(result, "data", None)
    if data is None and isinstance(result, dict):
        data = result.get("data")
    if data is None:
        return []
    return data if isinstance(data, list) else []


async def fetch_chapters_without_extractions(
    grade: str | None,
    subject: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    """Find chapters in rag_content_chunks that have no question_bank rows yet."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("supabase_unconfigured")
    chunk_query = (
        client.table("rag_content_chunks")
        .select("grade, subject, chapter_number, chapter_title")
        .order("grade", desc=False)
        .order("subject", desc=False)
        .order("chapter_number", desc=False)
        .limit(20000)
    )
    if grade:
        ng = normalize_grade(grade)
        chunk_query = chunk_query.or_(f"grade.eq.Grade {ng},grade.eq.{ng}")
    if subject:
        ns = normalize_subject(subject)
        raw_key = next((k for k, v in SUBJECT_MAP.items() if v == ns), ns)
        raw_subject = raw_key[:1].upper() + raw_key[1:]
        chunk_query = chunk_query.or_(f"subject.eq.{raw_subject},subject.eq.{ns}")
    try:
        chunks_result = await chunk_query.execute()
    except Exception:  # noqa: BLE001
        return []
    all_chunks = _rows(chunks_result)

    chapter_map: dict[str, dict[str, Any]] = {}
    for row in all_chunks:
        if not isinstance(row, dict):
            continue
        raw_grade = str(row.get("grade") or "")
        raw_subject = str(row.get("subject") or "")
        ng = normalize_grade(raw_grade)
        ns = normalize_subject(raw_subject)
        cn = row.get("chapter_number")
        if not isinstance(cn, int):
            continue
        key = f"{ng}|{ns}|{cn}"
        if key not in chapter_map:
            chapter_map[key] = {
                "rag_grade": raw_grade,
                "rag_subject": raw_subject,
                "grade": ng,
                "subject": ns,
                "chapter_number": cn,
                "chapter_title": str(row.get("chapter_title") or f"Chapter {cn}"),
            }

    # Find chapters that already have question_bank rows.
    try:
        existing_result = (
            await client.table("question_bank")
            .select("grade, subject, chapter_number")
            .limit(20000)
            .execute()
        )
    except Exception:  # noqa: BLE001
        existing_result = None
    existing_set: set[str] = set()
    for r in _rows(existing_result):
        if isinstance(r, dict):
            g = str(r.get("grade") or "")
            s = str(r.get("subject") or "")
            cn = r.get("chapter_number")
            if isinstance(cn, int):
                existing_set.add(f"{g}|{s}|{cn}")

    missing = [
        chapter
        for key, chapter in chapter_map.items()
        if key not in existing_set
    ]
    return missing[:limit]


async def get_extraction_overview() -> dict[str, Any]:
    """Compute coverage stats over rag_content_chunks vs question_bank."""
    client = get_service_client()
    if client is None:
        raise RepositoryError("supabase_unconfigured")
    try:
        chunks_result = (
            await client.table("rag_content_chunks")
            .select("grade, subject, chapter_number")
            .limit(20000)
            .execute()
        )
    except Exception:  # noqa: BLE001
        return {
            "total_chapters": 0, "with_extractions": 0, "without_extractions": 0,
            "coverage_percent": 0, "breakdown": {},
        }
    chunks = _rows(chunks_result)
    total: set[str] = set()
    for r in chunks:
        if isinstance(r, dict):
            ng = normalize_grade(str(r.get("grade") or ""))
            ns = normalize_subject(str(r.get("subject") or ""))
            cn = r.get("chapter_number")
            if isinstance(cn, int):
                total.add(f"{ng}|{ns}|{cn}")

    try:
        qb_result = (
            await client.table("question_bank")
            .select("grade, subject, chapter_number")
            .limit(20000)
            .execute()
        )
    except Exception:  # noqa: BLE001
        qb_result = None
    with_extractions: set[str] = set()
    for r in _rows(qb_result):
        if isinstance(r, dict):
            g = str(r.get("grade") or "")
            s = str(r.get("subject") or "")
            cn = r.get("chapter_number")
            if isinstance(cn, int):
                with_extractions.add(f"{g}|{s}|{cn}")

    breakdown: dict[str, dict[str, int]] = {}
    for key in total:
        grade, subject, _ = key.split("|", 2)
        b_key = f"Grade {grade} - {subject}"
        if b_key not in breakdown:
            breakdown[b_key] = {"total": 0, "with_extractions": 0, "without_extractions": 0}
        breakdown[b_key]["total"] += 1
        if key in with_extractions:
            breakdown[b_key]["with_extractions"] += 1
        else:
            breakdown[b_key]["without_extractions"] += 1

    coverage = (
        round(len(with_extractions) / len(total) * 100) if total else 0
    )
    return {
        "total_chapters": len(total),
        "with_extractions": len(with_extractions),
        "without_extractions": len(total) - len(with_extractions),
        "coverage_percent": max(0, min(100, coverage)),
        "breakdown": breakdown,
    }
