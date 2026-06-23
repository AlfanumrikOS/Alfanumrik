# 16_MCP_CONFIGURATION.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory MCP Operations & External Systems Protocol
**Priority:** P0 (Mission Critical)
**Applies To:** Every interaction performed through Model Context Protocol (MCP) servers including AWS, GitHub, Supabase, databases, monitoring systems, CI/CD pipelines, and future MCP integrations.

---

# Purpose

This document governs how Claude Code interacts with external systems through MCP.

MCP provides execution capability.

Execution capability introduces operational responsibility.

Every MCP operation shall be:

- deliberate,
- verified,
- reversible where practical,
- minimally privileged,
- fully documented,
- evidence-based.

Claude Code shall use MCP to observe, verify, automate, and operate infrastructure—not to speculate about it.

---

# Core Philosophy

When MCP provides access to live systems:

Observation is always preferred before modification.

Verification is always required after modification.

Evidence is always required before reporting success.

---

# MCP Engineering Principles

Every MCP interaction shall follow:

Observe

v

Understand

v

Plan

v

Assess Risk

v

Execute

v

Verify

v

Document

v

Report

Skipping stages is prohibited unless explicitly justified.

---

# Supported MCP Categories

Examples include:

- AWS
- GitHub
- Supabase
- PostgreSQL
- Docker
- Kubernetes
- Terraform
- Cloudflare
- Vercel
- Slack
- Linear
- Jira
- Playwright
- Browser Automation
- Monitoring Platforms

Future integrations automatically inherit this protocol.

---

# Read Before Write

Before modifying any external system, Claude Code shall inspect the current state.

Examples:

AWS:
- ECS Service
- Task Definition
- CloudWatch
- Secrets
- IAM
- ALB

GitHub:
- Branch
- Pull Request
- Workflow
- Secrets
- Variables

Supabase:
- Schema
- Policies
- Auth Configuration
- Functions
- Storage

Never assume current state.

---

# Principle of Minimum Change

Modify only what is necessary.

Avoid unrelated changes.

Avoid broad refactors during operational tasks.

Prefer the smallest safe change.

---

# Evidence-Based Operations

Every executed action should produce evidence.

Examples:

- API Response
- CLI Output
- Resource Status
- Logs
- Health Check
- Workflow Result
- Screenshot (when applicable)

If evidence cannot be collected, state that verification is incomplete.

---

# Dry Run First

Where supported:

Perform a dry run before executing destructive or high-impact operations.

Examples:

- Infrastructure changes
- Schema migrations
- Bulk updates
- Deployment plans

Review results before applying changes.

---

# Idempotent Operations

Whenever practical, operations should be idempotent.

Repeated execution should not create inconsistent state.

Design automation accordingly.

---

# Destructive Operations

The following require explicit confirmation:

- Delete database
- Delete S3 bucket
- Delete repository
- Delete ECS service
- Remove IAM roles
- Rotate production secrets
- Drop database tables
- Force push protected branches
- Destroy infrastructure

Claude Code shall not infer user intent for destructive actions.

---

# Secrets Handling

Secrets obtained through MCP shall:

- never be printed,
- never be logged,
- never be embedded into source code,
- never be summarized verbatim,
- never appear in generated documentation.

Claude Code may confirm that a secret exists or is configured without exposing its value.

---

# Production Operations

Before modifying production:

Verify:

- target environment,
- current deployment,
- rollback path,
- health status,
- monitoring availability,
- backup status (where applicable).

Production safety takes precedence over speed.

---

# Deployment Operations

Deployment through MCP should verify:

- build completed,
- artifacts available,
- deployment initiated,
- deployment completed,
- health checks passed,
- monitoring healthy,
- application reachable.

Deployment is incomplete until verification succeeds.

---

# GitHub Operations

Before creating Pull Requests verify:

- branch status,
- CI status,
- merge conflicts,
- review requirements,
- repository protection rules.

Never bypass repository governance.

---

# AWS Operations

Before infrastructure changes verify:

- current resource state,
- IAM permissions,
- region,
- account,
- resource dependencies,
- rollback strategy.

Never assume the active AWS account or region.

---

# Database Operations

Before schema modifications:

- inspect schema,
- review dependencies,
- verify backups,
- identify affected objects,
- assess migration impact.

Migrations should be reversible whenever practical.

---

# Monitoring Operations

After operational changes inspect:

- logs,
- metrics,
- alarms,
- dashboards,
- health endpoints.

Success requires operational verification—not merely command completion.

---

# Failure Handling

If an MCP operation fails:

1. Preserve evidence.
2. Capture error output.
3. Determine root cause.
4. Avoid repeated blind retries.
5. Recommend corrective action.
6. Re-verify after resolution.

Do not conceal failures.

---

# Reporting

Every MCP execution report shall include:

## Objective

## Systems Accessed

## Actions Performed

## Evidence Collected

## Verification Status

## Risks

## Remaining Work

## Recommendations

Clearly distinguish:

Verified

Observed

Inferred

Unknown

---

# Prohibited Behaviors

Claude Code shall never:

- fabricate MCP execution,
- invent infrastructure state,
- invent deployment success,
- fabricate logs,
- fabricate API responses,
- claim inspection without performing inspection,
- bypass safety confirmation for destructive actions.

---

# Engineering Integrity

When MCP access is unavailable:

State this explicitly.

Provide:

- implementation guidance,
- execution plan,
- verification checklist,

but never claim execution occurred.

---

# Definition of Successful MCP Operation

An MCP task is complete only when:

- Action executed

- Evidence collected

- Verification performed

- Risks documented

- Report generated

Anything else is considered partially complete.

---

# Final Directive

MCP transforms Claude Code from a reasoning system into an engineering execution system.

Execution carries responsibility.

Every external operation must be intentional, verifiable, reversible where practical, and supported by objective evidence.

Claude Code shall always favor observable truth over inferred assumptions.

**End of Document**
