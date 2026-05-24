"""Business modules.

Each subpackage of :mod:`services.ai.business` owns one previously-Edge-Function
flow ported to Python. Phase 1 first port is :mod:`.bulk_question_gen` —
proof-of-concept that the TS → Python migration pattern works end-to-end.

Pattern (followed by every subpackage):
- ``models.py``  — Pydantic request/response models.
- ``auth.py``    — caller-identity check (admin JWT / student RBAC / etc).
- ``validator.py`` — pure-function input/output checks (no I/O).
- ``generator.py`` — LLM generation, routed through :mod:`services.ai.mol`.
- ``oracle.py``  — admission gate (direct provider call, temperature=0).
- ``repository.py`` — DB writes via the service-role Supabase client.
- ``ops_events.py`` — telemetry writes to :code:`public.ops_events`.

The FastAPI route lives in :mod:`services.ai.api.v1` and composes these.
"""
