# 03_REPOSITORY_RULES.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory Engineering Rules
**Priority:** Critical
**Applies To:** Every repository, branch, commit, pull request, and code change

---

# Purpose

This document defines the mandatory repository governance, project organization, file structure, development workflow, and source control rules for all Alfanumrik repositories.

These rules are non-negotiable and exist to preserve consistency, maintainability, and long-term scalability.

If a future instruction conflicts with this document, follow this document unless explicitly overridden by an Architecture Decision Record (ADR).

---

# Repository Philosophy

A repository is a production engineering asset, not a storage location for code.

Every repository must remain:

* Understandable
* Predictable
* Version-controlled
* Modular
* Testable
* Documented
* Secure
* Deployable

Every file should exist for a reason.

---

# Repository Goals

Every repository should enable engineers to:

* Understand the system quickly.
* Build successfully.
* Test consistently.
* Deploy reliably.
* Roll back safely.
* Onboard efficiently.
* Maintain long-term quality.

---

# Repository Ownership

Every repository must have:

* A clearly defined purpose.
* A documented owner or owning team.
* A maintained README.
* Architecture documentation.
* Contribution guidelines.
* Deployment documentation where applicable.

---

# Directory Organization

Top-level directories should be limited to well-defined concerns.

Example:

```text
apps/
packages/
services/
infra/
scripts/
docs/
knowledge/
tests/
configs/
.github/
.claude/
```

Avoid placing business code directly in the repository root.

---

# Repository Root Rules

The repository root should contain only files that are globally relevant.

Examples include:

* README
* LICENSE
* package.json
* workspace configuration
* Docker configuration
* CI/CD configuration
* root TypeScript configuration
* lint configuration
* formatting configuration

Do not store temporary files, generated artifacts, or experimental code in the repository root.

---

# Source Code Organization

Group source code by business capability rather than arbitrary technical categories whenever practical.

Avoid deeply nested directory structures that obscure ownership.

Favor cohesion over convenience.

---

# Separation of Concerns

Repository structure must clearly separate:

* frontend,
* backend,
* shared packages,
* infrastructure,
* documentation,
* tests,
* tooling,
* automation.

Avoid mixing unrelated responsibilities.

---

# Configuration Management

Configuration belongs in configuration files.

Do not hardcode:

* URLs,
* secrets,
* credentials,
* environment identifiers,
* API endpoints,
* feature flags.

Environment-specific behavior must be configurable.

---

# Environment Variables

Every environment variable must:

* have a documented purpose,
* use consistent naming,
* be validated during startup,
* fail fast if required values are missing.

Secrets must never be committed to source control.

---

# Dependency Management

Dependencies must satisfy at least one of the following:

* solve an existing engineering problem,
* reduce maintenance effort,
* improve security,
* improve reliability,
* improve developer productivity.

Avoid dependencies that duplicate existing functionality.

Unused dependencies must be removed.

---

# Generated Code

Generated code must:

* be identifiable,
* be reproducible,
* not be manually edited unless documented,
* include generation instructions where applicable.

---

# Third-Party Libraries

Before introducing a library:

Evaluate:

* maintenance status,
* community adoption,
* security history,
* licensing,
* bundle impact,
* performance,
* long-term viability.

Do not introduce libraries solely because they are popular.

---

# File Naming

File names should be:

* descriptive,
* predictable,
* consistent,
* lowercase where appropriate,
* free of unnecessary abbreviations.

Examples:

```
student.service.ts

adaptive-engine.ts

payment.controller.ts
```

Avoid names such as:

```
temp.ts

new.ts

helper2.ts

final-final.ts
```

---

# Folder Naming

Folder names should describe business domains or engineering responsibilities.

Examples:

```
student

teacher

assessment

analytics

subscription

auth

payments
```

Avoid ambiguous folders such as:

```
misc

other

utils2

random
```

---

# Utility Code

Utility functions must:

* be reusable,
* remain domain-independent,
* avoid business logic.

Business rules belong within domain services.

---

# Shared Code

Shared code must remain generic.

Do not place product-specific behavior inside shared libraries.

---

# Documentation

Every repository must include:

* README
* setup instructions
* architecture overview
* development workflow
* deployment notes
* troubleshooting guide

Documentation is considered part of the implementation.

---

# Example Data

Example data must never contain:

* production credentials,
* customer information,
* private student records,
* payment details.

Use synthetic data only.

---

# Logging

Logs should:

* assist debugging,
* avoid noise,
* never expose secrets,
* include meaningful context,
* use structured formats where possible.

---

# Error Handling

Errors must:

* be actionable,
* contain sufficient context,
* avoid exposing sensitive information,
* be consistently formatted.

---

# Branch Strategy

Protected branches:

* main
* production (if applicable)

Development branches:

```
feature/

bugfix/

hotfix/

release/

refactor/

experiment/
```

Examples:

```
feature/student-dashboard

bugfix/payment-timeout

hotfix/login-failure
```

Never commit directly to protected branches.

---

# Commit Standards

Each commit must represent one logical change.

Commit messages should explain intent rather than implementation.

Preferred style:

```
feat(auth): implement JWT refresh flow

fix(analytics): correct mastery calculation

refactor(api): simplify assessment validation

docs(architecture): update deployment workflow
```

Avoid commits such as:

```
update

changes

fix

misc

working

temp
```

---

# Pull Requests

Every Pull Request must include:

* purpose,
* implementation summary,
* testing performed,
* known limitations,
* deployment considerations,
* rollback considerations.

Large unrelated changes should be divided into smaller pull requests.

---

# Code Review Expectations

Code reviews must evaluate:

* correctness,
* architecture,
* maintainability,
* security,
* testing,
* documentation,
* performance,
* readability.

Approval is not based on successful compilation alone.

---

# Technical Debt

Technical debt must be:

* documented,
* intentional,
* prioritized,
* periodically reviewed.

Never hide technical debt.

---

# Feature Flags

Incomplete functionality should use feature flags where appropriate.

Avoid long-lived dormant code.

Remove obsolete flags after rollout.

---

# Dead Code

Dead code must not remain indefinitely.

If code is no longer used:

* remove it,
* verify no dependencies remain,
* update documentation.

---

# Experimental Work

Experiments should:

* be isolated,
* documented,
* removable,
* clearly labeled.

Do not merge incomplete experiments into production branches.

---

# Repository Health

Maintain repository health by regularly:

* updating dependencies,
* removing obsolete files,
* improving documentation,
* reviewing security,
* validating CI/CD,
* monitoring test health.

---

# Continuous Improvement

Whenever modifying a repository, identify opportunities to improve:

* readability,
* consistency,
* modularity,
* documentation,
* automation.

Implement improvements when risk is low or document recommendations when broader review is required.

---

# Definition of Repository Quality

A repository is considered healthy when:

* structure is consistent,
* documentation is current,
* tests are reliable,
* dependencies are maintained,
* builds are reproducible,
* deployments are automated,
* security practices are followed,
* onboarding is straightforward.

---

# Final Directive

Every repository should remain cleaner after your contribution than before it.

Do not introduce avoidable complexity.

Do not sacrifice long-term maintainability for short-term convenience.

Treat every repository as a strategic engineering asset that will evolve for years.

**End of Document**
