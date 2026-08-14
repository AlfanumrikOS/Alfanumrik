"""Pytest bootstrap for the standalone PDF extractor.

Mirrors the ``pythonpath`` trick used by ``python/pyproject.toml``: put this
directory on ``sys.path`` so ``import extractor`` resolves regardless of whether
pytest's rootdir is the repo root (repo-root ``conftest.py``) or this directory.

Deliberately NOT registered in ``python/pyproject.toml``'s ``testpaths`` — this
tool is not part of the deployed service and must not be able to drag
``pdfplumber`` into the service's dependency graph or coverage gate.
"""

from __future__ import annotations

import os
import sys

_HERE = os.path.abspath(os.path.dirname(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
