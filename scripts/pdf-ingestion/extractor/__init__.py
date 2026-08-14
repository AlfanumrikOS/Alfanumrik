"""Curated-PDF learning-corpus extractor (Phase 2).

Offline, local-only PDF -> typed-learning-unit extractor.

HARD CONSTRAINTS (enforced by ``tests/test_no_network_or_db.py``):
  * NO database writes, NO Supabase client, NO network calls.
  * NO LLM calls. Heuristics only. A classify-only fallback *seam* exists in
    ``units.classify_unit(fallback=...)`` but is never wired in this phase.
  * ``--dry-run`` is the CLI default; writing requires an explicit ``--write``.

This package is deliberately NOT part of ``python/`` (the deployed Cloud Run AI
service). It has its own ``requirements.txt`` one directory up so that
``pdfplumber`` never ships inside a distributed service image.
"""

from __future__ import annotations

EXTRACTION_VERSION = "pdf_ingest/1.0.0"

__all__ = ["EXTRACTION_VERSION"]
