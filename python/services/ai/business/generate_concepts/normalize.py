"""Grade / subject normalization helpers — Python twin of the TS module.

Sources:
- ``normalizeGrade``    ← supabase/functions/generate-concepts/index.ts:100-103
- ``SUBJECT_MAP``       ← supabase/functions/generate-concepts/index.ts:105-123
- ``normalizeSubject``  ← supabase/functions/generate-concepts/index.ts:125-128
- ``slugify``           ← supabase/functions/generate-concepts/index.ts:87-92

The functions are wire-stable: ``rag_content_chunks`` stores "Grade 10" /
"Mathematics", while ``chapter_concepts`` + ``question_bank`` store "10" /
"math". Drift here would break the chapter-deduplication logic in
:mod:`.repository`.

P5 enforcement: ``normalize_grade`` always returns a string; the upstream
TS contract assumes grades are strings (``"6"`` through ``"12"``). Integer
grades would be rejected by Pydantic validators in
:mod:`.models.GenerateConceptsRequest`.
"""

from __future__ import annotations

import re

# Strip "Grade " prefix, case-insensitive. Mirrors TS regex /^Grade\s+/i.
_GRADE_PREFIX_RE = re.compile(r"^Grade\s+", re.IGNORECASE)

# Strip non-alphanumeric runs for slugify. Mirrors TS regex /[^a-z0-9]+/g.
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")

# Strip leading/trailing hyphens after non-alnum collapse. Mirrors /^-+|-+$/g.
_TRIM_HYPHEN_RE = re.compile(r"^-+|-+$")

# Subject canonicalization map. Hand-mirrored from
# supabase/functions/generate-concepts/index.ts lines 105-123. Any addition on
# the TS side MUST land here in the same PR. The dict is keyed by the
# lowercased raw form ("Mathematics" → key "mathematics") and maps to the
# canonical short form stored in chapter_concepts.subject and
# question_bank.subject.
SUBJECT_MAP: dict[str, str] = {
    "mathematics": "math",
    "science": "science",
    "physics": "physics",
    "chemistry": "chemistry",
    "biology": "biology",
    "english": "english",
    "hindi": "hindi",
    "sanskrit": "sanskrit",
    "social studies": "social_studies",
    "computer science": "computer_science",
    "informatics practices": "informatics_practices",
    "history": "history",
    "geography": "geography",
    "economics": "economics",
    "political science": "political_science",
    "accountancy": "accountancy",
    "business studies": "business_studies",
}


def normalize_grade(raw: str) -> str:
    """Strip the optional "Grade " prefix and trim whitespace.

    Examples:
        >>> normalize_grade("Grade 10")
        '10'
        >>> normalize_grade("10")
        '10'
        >>> normalize_grade("  Grade  8  ")
        '8'

    Mirrors TS ``normalizeGrade`` (index.ts:100-103). Always returns a
    string — never coerces to int. P5: grades stay strings everywhere.
    """
    if not isinstance(raw, str):
        raise TypeError("normalize_grade requires a string (P5: grades are strings)")
    return _GRADE_PREFIX_RE.sub("", raw).strip()


def normalize_subject(raw: str) -> str:
    """Map raw subject to canonical short form, falling back to snake_case.

    Examples:
        >>> normalize_subject("Mathematics")
        'math'
        >>> normalize_subject("social studies")
        'social_studies'
        >>> normalize_subject("Politics 101")  # not in SUBJECT_MAP
        'politics_101'

    Mirrors TS ``normalizeSubject`` (index.ts:125-128). The fallback path
    lower-cases then collapses any whitespace runs to a single underscore.
    Multi-word unknown subjects (e.g. "Foreign Languages") become
    ``foreign_languages``.
    """
    if not isinstance(raw, str):
        raise TypeError("normalize_subject requires a string")
    key = raw.lower().strip()
    if key in SUBJECT_MAP:
        return SUBJECT_MAP[key]
    # Fallback: collapse internal whitespace runs to "_" so multi-word
    # subjects are still serializable. Matches TS .replace(/\s+/g, '_').
    return re.sub(r"\s+", "_", key)


def slugify(text: str) -> str:
    """Lowercase + collapse non-alnum runs to "-" + trim leading/trailing "-".

    Examples:
        >>> slugify("Newton's First Law")
        'newton-s-first-law'
        >>> slugify("---test---")
        'test'
        >>> slugify("")
        ''

    Mirrors TS ``slugify`` (index.ts:87-92). Used to derive the
    ``chapter_concepts.slug`` column from the concept title.
    """
    if not isinstance(text, str):
        return ""
    lowered = text.lower()
    collapsed = _NON_ALNUM_RE.sub("-", lowered)
    return _TRIM_HYPHEN_RE.sub("", collapsed)


def raw_subject_for(normalized: str) -> str:
    """Look up the raw (titled) subject string for a normalised key.

    Mirrors the TS logic at index.ts:197-198 that inverts ``SUBJECT_MAP`` to
    build an "or" filter against the raw subject column. Returns a
    title-cased version of the original key (e.g. ``"Mathematics"``); falls
    back to the normalized form if no match (consistent with TS).
    """
    for raw_key, norm_value in SUBJECT_MAP.items():
        if norm_value == normalized:
            return raw_key[:1].upper() + raw_key[1:]
    return normalized[:1].upper() + normalized[1:] if normalized else normalized
