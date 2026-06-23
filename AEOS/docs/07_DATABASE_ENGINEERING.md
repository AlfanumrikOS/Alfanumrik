# 07_DATABASE_ENGINEERING.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory Database Engineering Standard
**Priority:** Critical
**Applies To:** Every database schema, migration, query, repository, stored procedure, view, trigger, index, policy, and data model across the Alfanumrik platform.

---

# Purpose

This document establishes the mandatory standards for designing, evolving, securing, and operating databases within the Alfanumrik platform.

The database is the platform's system of record. Every schema change has long-term consequences. Database engineering must therefore prioritize correctness, integrity, scalability, auditability, and maintainability.

---

# Database Philosophy

The database exists to:

* Persist business data
* Preserve integrity
* Support analytics
* Enable scalability
* Provide reliable recovery
* Maintain audit history

The database must **not** become the primary location for business logic.

---

# Guiding Principles

Every database decision shall prioritize:

1. Data Integrity
2. Correctness
3. Security
4. Scalability
5. Performance
6. Maintainability
7. Observability
8. Recoverability

---

# Single Source of Truth

Every business entity shall have one authoritative source of truth.

Avoid duplicated mutable data unless justified by:

* performance,
* reporting,
* caching,
* denormalization.

Duplicated data must have documented synchronization rules.

---

# Data Ownership

Each domain owns its schema and business entities.

Cross-domain access must occur through repositories or service interfaces rather than direct table manipulation whenever practical.

---

# Schema Design

Schemas should model business concepts rather than UI requirements.

Design for:

* clarity,
* extensibility,
* normalization where appropriate,
* future evolution.

Avoid designing tables around current screens alone.

---

# Naming Standards

Use descriptive, consistent names.

Examples:

```text
students
teachers
assessments
assessment_attempts
learning_paths
subscriptions
payment_transactions
```

Avoid abbreviations unless universally understood.

---

# Primary Keys

Every table shall have a primary key.

Preferred characteristics:

* immutable,
* unique,
* indexed.

Never expose implementation-specific IDs when public identifiers are required.

---

# Foreign Keys

Use foreign keys to preserve referential integrity wherever appropriate.

Avoid orphaned records.

Relationships should be explicit.

---

# Constraints

Use database constraints to enforce structural correctness.

Examples:

* NOT NULL
* UNIQUE
* CHECK
* FOREIGN KEY

Business workflows should remain in the application layer.

---

# Normalization

Normalize until further normalization creates measurable performance or operational problems.

Document intentional denormalization decisions.

---

# Indexing

Indexes must support:

* primary lookup paths,
* joins,
* filtering,
* sorting,
* frequently executed queries.

Avoid unnecessary indexes that increase write cost.

Every new index should have a measurable justification.

---

# Query Design

Queries must:

* retrieve only required columns,
* avoid unnecessary joins,
* avoid SELECT *,
* support pagination where applicable.

Optimize for predictable execution.

---

# N+1 Prevention

Repositories must avoid N+1 query patterns.

Use:

* joins,
* batching,
* eager loading,
* optimized query strategies.

Monitor query counts during testing.

---

# Transactions

Use transactions only when multiple operations must succeed or fail together.

Transactions should:

* remain short,
* avoid unnecessary locks,
* be deterministic.

Never leave transactions open longer than necessary.

---

# Migrations

Every schema change must use version-controlled migrations.

Migration files must be:

* deterministic,
* repeatable,
* reversible where practical,
* reviewed.

Never modify previously executed migrations in production.

---

# Rollback Strategy

Every production migration must include a rollback plan.

If rollback is impossible, document:

* risks,
* mitigation,
* recovery procedure.

---

# Soft Deletes

Use soft deletes only where business requirements demand recoverability or audit history.

Otherwise prefer hard deletes with appropriate archival strategies.

Document deletion behavior.

---

# Auditability

Critical business entities must support audit history.

Examples:

* users,
* subscriptions,
* payments,
* assessments,
* grades,
* AI-generated recommendations.

Audit records should include:

* actor,
* timestamp,
* action,
* previous values where appropriate.

---

# Timestamps

Important entities should include:

* created_at
* updated_at

Additional timestamps may include:

* deleted_at
* published_at
* processed_at
* completed_at

Store timestamps in UTC.

---

# Time Zones

Never store local time without context.

Convert for presentation only.

All persistence should use UTC.

---

# Row-Level Security (RLS)

Where supported (e.g., Supabase/PostgreSQL), implement Row-Level Security for user-facing data.

Policies must follow least-privilege principles.

Validate RLS behavior with automated tests.

---

# Secrets

Never store:

* API keys,
* passwords,
* tokens,
* secrets,

in plaintext.

Sensitive values must be encrypted or securely hashed where appropriate.

---

# Password Storage

Passwords shall:

* never be reversible,
* never be logged,
* never be transmitted in plaintext.

Use approved password hashing algorithms managed by the authentication provider.

---

# Personally Identifiable Information (PII)

Protect:

* names,
* email addresses,
* phone numbers,
* student information,
* parent information,
* payment references.

Access should be role-based and auditable.

---

# AI Data

Store AI-related information separately where practical.

Track:

* model version,
* prompt version,
* response metadata,
* execution timestamp.

AI outputs should be distinguishable from human-authored content.

---

# Repository Pattern

Application code must access data through repositories or equivalent abstractions.

Avoid embedding raw SQL throughout business services.

Repositories should encapsulate persistence concerns.

---

# Stored Procedures

Use stored procedures only when they provide clear benefits such as:

* complex transactional operations,
* performance,
* security.

Business rules should remain primarily in application services.

---

# Views

Use views for:

* reporting,
* simplified read models,
* analytics.

Avoid using views to hide poor schema design.

---

# Triggers

Triggers should be:

* minimal,
* deterministic,
* documented.

Avoid implementing complex business workflows with triggers.

---

# Performance Monitoring

Monitor:

* slow queries,
* lock contention,
* index usage,
* table growth,
* connection counts.

Performance improvements should be based on measured data.

---

# Backup Strategy

Production databases must support:

* automated backups,
* retention policies,
* recovery verification,
* disaster recovery procedures.

Backups are not considered valid until restoration has been successfully tested.

---

# Data Retention

Every data category should have a defined retention policy.

Avoid retaining unnecessary personal information indefinitely.

Support legal and regulatory requirements.

---

# Test Data

Use synthetic or anonymized data in non-production environments.

Production data must never be copied into development environments without approved anonymization.

---

# Schema Review Checklist

Before approving schema changes, verify:

* Are names consistent?
* Are constraints defined?
* Are indexes justified?
* Are relationships explicit?
* Is normalization appropriate?
* Are migrations reversible?
* Are RLS policies updated?
* Are repositories updated?
* Are tests added?

If any answer is "No," revise before approval.

---

# Definition of Database Quality

A database design is considered production-ready when it:

* preserves integrity,
* supports business requirements,
* scales predictably,
* is secure,
* is observable,
* is recoverable,
* is maintainable,
* is fully documented.

---

# Final Directive

The database is one of Alfanumrik's most valuable assets.

Every schema change should improve—not compromise—its integrity, scalability, and long-term maintainability.

Never optimize for short-term convenience at the expense of future operational excellence.

**End of Document**
