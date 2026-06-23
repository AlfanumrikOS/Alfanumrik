# AEOS Roadmap

> Alfanumrik Engineering Operating System (AEOS) - release roadmap.
> Last reconciled: 2026-06-23 (point-in-time). Scope and criteria are updated per release.

This roadmap defines the three planned releases of AEOS, each with a theme, scope, measurable acceptance criteria, and status. AEOS is semantically versioned; see the Versioning Policy below.

---

## v1.0 - Engineering Foundation

**Theme:** Establish the platform-agnostic engineering constitution and product scaffolding so a Claude Code session can load AEOS and operate as a disciplined Principal Engineer.

**Scope:**

- 30 core engineering documents (`docs/00` through `docs/29`), platform-agnostic.
- Product scaffolding: `VERSION`, `README.md`, `CLAUDE.md` (authority entry-point), `ROADMAP.md`, `CHANGELOG.md`.
- `docs/` and `docs/extensions/` directory layout.
- Authority hierarchy defined and documented (6 levels, project invariants supreme).
- Document standard defined and applied uniformly across all core docs.

**Acceptance Criteria:**

- All 30 core docs (00-29) exist in `docs/` and conform to the AEOS document standard (metadata block, Purpose, Scope, body, verification checklist, References, Final Directive + `End of Document`).
- `VERSION` reads `1.0.0` and is the single source of truth, consistent with `README.md` and `CHANGELOG.md`.
- The authority hierarchy is stated identically in `README.md` and `CLAUDE.md`.
- All delivered files are ASCII-only with no placeholder content.
- `README.md` document index lists all 30 docs with accurate per-doc status.
- All 30 core docs plus the authority layer (`MASTER_SYSTEM_PROMPT.md`, `EXECUTION_ENGINE.md`) and the 8 `docs/extensions/` modules are authored, and all cross-references are validated.

**Status:** Complete (pending release commit)

---

## v1.1 - Operational Playbooks

**Theme:** Add the operational and AI-operations playbooks that turn the foundation into day-to-day running practice.

**Scope:**

- AI workflow playbooks.
- Operations guides for MCP, AWS, GitHub, and Supabase.
- Performance engineering playbook.
- SRE runbooks.
- Disaster recovery (DR) procedures.
- Prompt-engineering guidance.
- AI evaluation methodology.

**Acceptance Criteria:**

- Each playbook/guide above exists, conforms to the AEOS document standard, and is cross-referenced from the relevant core docs.
- Vendor-specific operations content (AWS, GitHub, Supabase, MCP) lives under `docs/extensions/`, keeping the core platform-agnostic.
- DR procedures include explicit, testable recovery steps with stated objectives.
- AI evaluation methodology defines measurable quality metrics and a repeatable harness.
- `VERSION`, `CHANGELOG.md`, and `ROADMAP.md` are updated for the 1.1 release, with migration notes where applicable.

**Status:** Planned

---

## v2.0 - Governed Autonomous Engineering

**Theme:** Enable governed, autonomous multi-agent engineering with memory, planning, verification, and enterprise oversight.

**Scope:**

- Multi-agent orchestration.
- Specialized agents and agent governance.
- Engineering memory.
- Knowledge graph.
- Autonomous planning, verification, and architecture review.
- Enterprise governance.
- Executive reporting.

**Acceptance Criteria:**

- Multi-agent orchestration is documented with clear agent roles, ownership boundaries, and handoff protocols.
- Agent governance defines guardrails, approval gates, and audit/traceability for autonomous actions.
- Engineering memory and knowledge graph have defined schemas and read/write/retention rules.
- Autonomous planning, verification, and architecture review have explicit acceptance gates that must pass before work is considered done.
- Enterprise governance and executive reporting expose measurable engineering and operational signals.
- `VERSION`, `CHANGELOG.md`, and `ROADMAP.md` are updated for the 2.0 release, with migration notes for any breaking changes.

**Status:** Planned

---

## Versioning Policy

AEOS follows Semantic Versioning (MAJOR.MINOR.PATCH). `VERSION` is the single source of truth. Every release updates `VERSION`, `CHANGELOG.md`, and this `ROADMAP.md` (plus migration notes when applicable). Releases are marked with git tags in the form `aeos-vMAJOR.MINOR.PATCH` (for example, `aeos-v1.0.0`). Backward compatibility is preserved whenever practical; breaking changes are reserved for MAJOR releases and documented with migration notes.

## Success Criteria

AEOS succeeds when a fresh Claude Code session can load this repository and, with minimal additional prompting, consistently behave as a disciplined Principal Engineer: reasoning before coding, verifying with evidence, respecting the architecture and the project's product invariants, and continuously improving the platform.

**End of Document**
