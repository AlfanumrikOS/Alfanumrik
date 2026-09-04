# Vendored copy

This is a vendored copy of the repo-root `cbse_parser/` package, kept
byte-identical to it. It exists solely so `python/Dockerfile`'s build
context (scoped to `python/` — see `.github/workflows/python-ai-deploy.yml`,
`context: python`) can `COPY` it into the AI Services container image;
Docker cannot reach a path outside its build context (`../cbse_parser`),
so putting the repo root on the image's `PYTHONPATH` instead was not an
option without changing the deploy pipeline's build context.

**Source of truth is the repo-root `cbse_parser/`.** It also backs
`cbse_cli.py` and `tests/test_parser.py` / `tests/test_generator.py` at the
repo root, which this vendored copy does not replace. If you change the
repo-root package, copy the same change here (`cp ../../cbse_parser/*.py
./`) — there is currently no automated sync check for this pair.

Added 2026-09-04 (P2-13, launch-audit follow-up) to fix
`services/ai/api/v1/foxy_tutor.py`'s `cbse_parser` import, which raised
`ModuleNotFoundError` inside the container (dormant today — gated behind
`ff_python_foxy_tutor_v1`, seeded OFF). See
`docs/runbooks/2026-06-13-mol-python-cutover.md`.
