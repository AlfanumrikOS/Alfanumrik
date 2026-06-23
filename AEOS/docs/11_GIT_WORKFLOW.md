# 11_GIT_WORKFLOW.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory Source Control & Git Governance
**Priority:** Critical
**Applies To:** Every Git operation, branch, commit, merge, pull request, release, hotfix, rollback, and repository managed under the Alfanumrik organization.

---

# Purpose

This document establishes the mandatory Git workflow, repository governance, branching strategy, commit standards, review process, merge policy, release workflow, and rollback procedures.

Git history is a permanent engineering record.

Every commit must improve the maintainability and traceability of the project.

---

# Core Philosophy

Git is not merely version control.

It is:

- Engineering history
- Audit trail
- Knowledge preservation
- Collaboration mechanism
- Release management system

Every Git operation must preserve repository integrity.

---

# Engineering Principles

Every Git action should be:

- Traceable
- Atomic
- Reproducible
- Reviewable
- Reversible
- Understandable

Never optimize Git history for convenience.

---

# Protected Branches

The following branches are protected.

```
main
production
release/*
```

Direct pushes are prohibited.

All changes require Pull Requests.

---

# Working Branches

Development shall occur only on dedicated branches.

Naming convention:

```
feature/<feature-name>

bugfix/<issue-name>

hotfix/<issue-name>

refactor/<module-name>

experiment/<topic>

release/<version>

docs/<topic>

infra/<topic>

security/<topic>

test/<topic>
```

Examples:

```
feature/adaptive-engine

feature/teacher-dashboard

bugfix/payment-timeout

hotfix/login-loop

refactor/api-auth

infra/aws-deployment
```

---

# Branch Lifetime

Branches should remain short-lived.

Avoid long-running branches that diverge significantly.

Merge frequently.

Rebase carefully.

---

# Commit Philosophy

Each commit should represent one logical engineering change.

Avoid combining unrelated work.

Small commits are preferred over massive commits.

---

# Commit Message Format

Use Conventional Commits.

Examples:

```
feat(auth): implement refresh token rotation

fix(api): prevent duplicate assessment creation

refactor(student): simplify mastery calculation

docs(readme): update installation guide

test(api): add regression tests for payments

perf(db): optimize assessment query

ci(actions): improve deployment pipeline

infra(aws): configure ECS autoscaling
```

---

# Bad Commit Messages

Avoid:

```
fix

update

changes

misc

working

temp

final-final

latest

done
```

These provide no engineering value.

---

# Commit Content

One commit should solve one problem.

Do not mix:

- infrastructure
- documentation
- unrelated bug fixes
- multiple features

inside one commit.

---

# Pull Requests

Every Pull Request must include:

- objective
- business justification
- implementation summary
- files changed
- testing performed
- screenshots (if UI)
- deployment considerations
- rollback considerations
- known limitations

---

# Pull Request Size

Preferred size:

Small to medium.

Large PRs should be divided into logical increments.

Avoid "mega PRs".

---

# Mandatory Review

Every Pull Request requires review.

Review must evaluate:

- architecture
- correctness
- readability
- testing
- security
- performance
- documentation
- backward compatibility

Approval is evidence-based.

---

# Merge Strategy

Preferred:

Squash Merge

or

Rebase Merge

Avoid unnecessary merge commits.

History should remain clean.

---

# Merge Conditions

A Pull Request may only merge when:

- Build passes

- Tests pass

- Lint passes

- Type check passes

- Security checks pass

- Documentation updated

- Review approved

---

# Conflict Resolution

Resolve conflicts by understanding intent.

Never blindly accept:

Incoming

or

Current

without investigation.

After conflict resolution:

- rebuild
- retest
- verify behavior

---

# Tagging

Production releases must use semantic versioning.

Examples:

```
v1.0.0

v1.1.0

v1.2.3
```

Tags should always reference reviewed commits.

---

# Release Branches

Release branches should contain only:

- release preparation
- bug fixes
- documentation
- version updates

No new features.

---

# Hotfix Workflow

Critical production fixes should follow:

```
production

v

hotfix branch

v

verification

v

review

v

merge

v

tag

v

deploy
```

Hotfixes must later merge back into development.

---

# Reverting Changes

Prefer Git revert over rewriting published history.

History should remain auditable.

Avoid force pushing shared branches.

---

# Force Push Policy

Force push is prohibited on:

- main
- production
- release branches

Only permitted on personal feature branches when absolutely necessary.

---

# Repository Hygiene

Regularly:

- delete merged branches
- remove obsolete tags
- archive unused repositories
- update documentation
- remove dead code

---

# Binary Files

Avoid committing:

- build artifacts
- generated files
- logs
- temporary files
- IDE configuration
- database dumps

Use Git LFS where appropriate.

---

# Secrets

Git must never contain:

- API Keys
- AWS Credentials
- Supabase Keys
- JWT Secrets
- Payment Keys
- Passwords

Use:

- AWS Secrets Manager
- GitHub Secrets
- Parameter Store

Enable secret scanning.

---

# Git Hooks

Repository should enforce:

- formatting
- linting
- type checking
- commit validation

before commits where practical.

---

# Continuous Integration

Every Pull Request should automatically execute:

- Build
- Type Check
- Lint
- Unit Tests
- Integration Tests
- Security Scan
- Dependency Scan

No manual bypasses.

---

# Rollback

Every deployment must identify:

- commit SHA
- release tag
- rollback commit
- deployment timestamp

Rollback must be documented.

---

# Auditability

Every production deployment must be traceable to:

- Pull Request
- Review
- Commit
- Release Tag
- CI Pipeline
- Deployment Logs

---

# Engineering Integrity

Never manipulate Git history to hide:

- bugs
- failed implementations
- security issues
- incomplete work

History is an engineering record.

---

# Definition of Git Excellence

A healthy repository demonstrates:

- clean history
- meaningful commits
- small pull requests
- successful CI
- documented releases
- reproducible builds
- protected branches
- traceable deployments

---

# Final Directive

Every Git commit should tell the story of how Alfanumrik evolved.

Future engineers should be able to understand the platform's history through its commit log alone.

Write history that is clear, auditable, and worthy of long-term maintenance.

**End of Document**
