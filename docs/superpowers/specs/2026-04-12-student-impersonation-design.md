# Phase 2: Student Impersonation + Support Enrichment — Design Spec

**Date:** 2026-04-12
**Status:** Design complete, pending user approval
**Depends on:** Phase 1 (Observability Console) — deployed

---

## Context

When a school or parent calls with a complaint ("quizzes aren't working", "my child's score is wrong", "Foxy gave a wrong answer"), the admin currently has a basic support lookup that shows recent quiz and chat tables. They cannot see what the student actually sees (dashboard, mastery, knowledge gaps), cannot correlate system events with the student's experience, and cannot leave notes for future support interactions. This phase fixes all three gaps.

## Architecture

Two surfaces on a single new Student Detail page at `/super-admin/students/[id]`:

1. **Data Panel** (default tab) — aggregated read-only view of everything about a student: profile, subscription, XP/streak, per-subject mastery (BKT), Bloom's distribution, knowledge gaps, exam readiness, recent quizzes, recent Foxy chats, ops_events for this student, parent/teacher links, and an append-only support notes thread.

2. **Live View** tab — an iframe rendering the actual student pages (dashboard, progress, foxy chat history, quiz history) via a proxy API. A red "VIEWING AS [Name] — READ ONLY" banner. No write paths reachable.

### Key properties
- **No auth token manipulation.** Admin stays logged in as themselves. Proxy API uses service-role to fetch student data.
- **Audit-logged.** Live View sessions create rows in `admin_impersonation_sessions`. Data Panel access does not (it's equivalent to the existing support lookup).
- **Read-only by design.** Three layers: (1) no write routes under the proxy prefix, (2) no student auth token in the iframe, (3) `readOnly` prop on components.
- **30-minute session timeout** with auto-expiry and nightly cleanup.

### Entry points
- Support page: "View Full Profile" link after student lookup
- Users page: "View Full Profile" button in user detail drawer
- Observability Console: clickable `subject_id` link when `subject_type = 'student'`

## Data Model

### `admin_support_notes`

```sql
CREATE TABLE admin_support_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  admin_id        uuid NOT NULL REFERENCES admin_users(id),
  category        text NOT NULL CHECK (category IN (
    'support-call', 'bug-report', 'account-issue', 'observation', 'escalation'
  )),
  content         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_support_notes_student_idx
  ON admin_support_notes (student_id, created_at ASC);
```

Append-only. No UPDATE, no DELETE. RLS deny-all for client access.

### `admin_impersonation_sessions`

```sql
CREATE TABLE admin_impersonation_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        uuid NOT NULL REFERENCES admin_users(id),
  student_id      uuid NOT NULL REFERENCES students(id),
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  pages_viewed    text[] NOT NULL DEFAULT '{}',
  ip_address      text
);
CREATE INDEX admin_impersonation_sessions_student_idx
  ON admin_impersonation_sessions (student_id, started_at DESC);
CREATE INDEX admin_impersonation_sessions_active_idx
  ON admin_impersonation_sessions (admin_id, expires_at)
  WHERE ended_at IS NULL;
```

RLS deny-all for client access. Active session: `ended_at IS NULL AND expires_at > now()`.

## Proxy API Architecture

Dedicated admin routes that mirror student data APIs using service-role queries:

| Proxy route | Purpose | Source tables |
|---|---|---|
| `GET .../students/[id]/profile` | Full aggregated data for the Data Panel | students, concept_mastery, knowledge_gaps, student_daily_usage, quiz_sessions, chat_sessions, guardian_student_links, class_students, student_subscriptions, ops_events |
| `GET .../students/[id]/dashboard` | Student dashboard data for Live View iframe | students, concept_mastery, knowledge_gaps, student_daily_usage, quiz_sessions |
| `GET .../students/[id]/progress` | Per-subject mastery for Live View | concept_mastery, curriculum_topics, quiz_sessions |
| `GET .../students/[id]/foxy-history` | Chat sessions + messages for Live View | chat_sessions, chat_messages |
| `GET .../students/[id]/quiz-history` | Quiz attempts with scores/answers for Live View | quiz_sessions, quiz_responses |
| `POST .../students/[id]/impersonate` | Start Live View session | admin_impersonation_sessions (insert) |
| `PATCH .../students/[id]/impersonate` | End Live View session | admin_impersonation_sessions (update ended_at) |
| `GET .../students/[id]/notes` | List support notes | admin_support_notes |
| `POST .../students/[id]/notes` | Add a note | admin_support_notes (insert) |

All routes use `authorizeAdmin()` + `supabaseAdmin`. Live View proxy routes additionally validate an active impersonation session.

## Live View Iframe Pages

Four pages under `/super-admin/view-as/[studentId]/`:

```
/super-admin/view-as/[studentId]/dashboard
/super-admin/view-as/[studentId]/progress
/super-admin/view-as/[studentId]/foxy
/super-admin/view-as/[studentId]/quizzes
```

Each page:
1. Validates active impersonation session
2. Fetches from proxy API (not student-facing API)
3. Renders using actual student components (imported directly) with `readOnly={true}`
4. Wrapped in a read-only shell with red banner and tab bar
5. Records the page name in `pages_viewed` on the session

### Write protection (3 layers)
1. No POST/PATCH/DELETE routes exist under the proxy prefix
2. No student auth token — iframe uses admin session only
3. Components receive `readOnly={true}` to hide interactive elements

## Data Panel Layout

Single proxy API call (`GET .../students/[id]/profile`) returns all data. Rendered as cards:

- **Profile card:** name, email, grade, board, language, joined date, status, onboarding
- **Subscription card:** plan, expiry, payment history summary
- **Learning snapshot:** XP (level), streak, quiz count, avg score, chat count, last active
- **Subject mastery grid:** per-subject BKT scores with progress bars
- **Knowledge gaps:** top weak topics from `knowledge_gaps` table
- **Bloom's distribution:** bar chart of quiz responses by Bloom's level
- **Recent quizzes:** last 10 with subject, topic, score, XP
- **Recent Foxy chats:** last 10 with topic, message count, date
- **Ops events:** last 20 events where `subject_id = student.id` (links to Observability Console)
- **Relationships:** parent links, class/teacher assignments
- **Support notes:** timestamped thread with "Add Note" form (category dropdown + text input)

## Scope

### Ships in Phase 2
- Migration: 2 new tables
- Student Detail page (Data Panel + Live View tabs)
- 9 API routes (profile, dashboard, progress, foxy-history, quiz-history, impersonate, notes)
- 4 Live View iframe pages
- 3 entry point edits (support, users, observability drawer)
- Tests (Vitest + Playwright)

### Non-goals
- No write actions in Live View
- No teacher/parent impersonation
- No concurrent impersonation (one session per admin)
- No note editing/deletion (append-only)
- No note attachments
- No student notification of admin viewing
- No mobile admin impersonation
- No dashboard component modification for readOnly support

## Testing
- Vitest: profile proxy shape, notes CRUD, session lifecycle
- Playwright: navigate to student detail, verify data panel, open live view, add note
- Regression: R45 (session audit), R46 (notes append-only), R47 (live view read-only)

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Student components don't accept readOnly | Low | Writes fail — no student auth token in iframe |
| Proxy data shape drifts from student page expectations | Medium | Proxy tests assert shape parity |
| Orphaned impersonation sessions | Low | 30min auto-expiry + nightly cleanup |
| PII in proxy responses | Low | Same authorizeAdmin gate; no new PII beyond existing support page |