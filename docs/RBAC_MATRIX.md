# Alfanumrik RBAC Matrix

Complete role-based access control reference for the Alfanumrik EdTech platform.

---

## Roles and Hierarchy

| Role | Display Name | Hierarchy Level | System Role | Description |
|------|-------------|----------------|-------------|-------------|
| `super_admin` | Super Admin | 100 | Yes | Full platform control, bypasses all permission checks |
| `admin` | Admin | 90 | Yes | Platform administrator with all permissions granted explicitly |
| `institution_admin` | Institution Admin | 70 | No | School/institution administrator |
| `finance` | Finance | 65 | No | Finance and accounts team |
| `content_manager` | Content Manager | 60 | No | Content creation and moderation |
| `reviewer` | Reviewer | 58 | No | Content reviewer |
| `support` | Support | 55 | No | Support/operations staff |
| `teacher` | Teacher | 50 | Yes | Classroom teacher |
| `tutor` | Tutor | 40 | No | Private/online tutor |
| `parent` | Parent | 30 | Yes | Parent/guardian of student(s) |
| `student` | Student | 10 | Yes | Learner on the platform |

Higher hierarchy levels indicate more authority. Hierarchy level is informational and does not automatically grant permissions -- all grants are explicit via `role_permissions`.

---

## Permissions by Resource

### Student Permissions (study_plan, quiz, exam, image, report, review, foxy, simulation, leaderboard, profile, notification, progress)

| Permission Code | Description |
|----------------|-------------|
| `study_plan.view` | View assigned study plans |
| `study_plan.create` | Generate new study plans |
| `quiz.attempt` | Attempt quizzes and tests |
| `quiz.view_results` | View own quiz results |
| `exam.view` | View own exam configurations |
| `exam.create` | Create exam configurations |
| `image.upload` | Upload assignment/question images |
| `image.view_own` | View own uploaded images |
| `report.view_own` | View own performance reports |
| `report.download_own` | Download own monthly reports |
| `review.view` | View spaced repetition cards |
| `review.practice` | Practice flashcards |
| `foxy.chat` | Chat with Foxy AI tutor |
| `simulation.view` | View interactive simulations |
| `simulation.interact` | Use interactive simulations |
| `leaderboard.view` | View leaderboard |
| `profile.view_own` | View own profile |
| `profile.update_own` | Update own profile |
| `notification.view` | View notifications |
| `notification.dismiss` | Dismiss notifications |
| `progress.view_own` | View own learning progress |

### Parent Permissions (child)

| Permission Code | Description |
|----------------|-------------|
| `child.view_performance` | View linked child performance |
| `child.view_progress` | View linked child progress |
| `child.download_report` | Download child monthly report |
| `child.view_exams` | View child exam schedule |
| `child.receive_alerts` | Receive alerts about child |

### Teacher Permissions (class, exam, test, student, worksheet, report)

| Permission Code | Description |
|----------------|-------------|
| `class.manage` | Manage classes and enrollments |
| `class.view_analytics` | View class analytics |
| `exam.assign` | Assign exams to classes |
| `exam.create_for_class` | Create exams for class |
| `test.create` | Create tests and quizzes |
| `test.edit` | Edit tests and quizzes |
| `student.view_uploads` | Review student uploaded images |
| `student.provide_feedback` | Provide feedback to students |
| `worksheet.create` | Create worksheets |
| `worksheet.assign` | Assign worksheets |
| `report.view_class` | View class performance reports |

### Institution Permissions (institution)

| Permission Code | Description |
|----------------|-------------|
| `institution.manage` | Manage institution settings and configuration |
| `institution.view_analytics` | View institution-level analytics and dashboards |
| `institution.manage_teachers` | Add, remove, and manage teachers within the institution |
| `institution.manage_students` | Add, remove, and manage students within the institution |
| `institution.view_reports` | View institution-wide performance reports |

### Content Permissions (content)

| Permission Code | Description |
|----------------|-------------|
| `content.create` | Create new curriculum content items |
| `content.edit` | Edit existing curriculum content |
| `content.submit_review` | Submit content for review/approval |
| `content.view_all` | View all content including unpublished drafts |
| `content.manage_questions` | Create, edit, and organize question banks |
| `content.manage_media` | Upload and manage media assets |
| `content.review` | Review content submitted for approval |
| `content.approve` | Approve content for publication |
| `content.reject` | Reject content and send back for revision |
| `content.view_drafts` | View draft content pending review |
| `content.manage` | Manage curriculum content (admin-level) |

### Support Permissions (support)

| Permission Code | Description |
|----------------|-------------|
| `support.view_tickets` | View support tickets and requests |
| `support.manage_tickets` | Respond to, assign, and close support tickets |
| `support.view_user_activity` | View user activity logs for troubleshooting |
| `support.fix_relationships` | Fix guardian-student and teacher-class relationships |
| `support.resend_invites` | Resend invitation emails and onboarding links |
| `support.reset_passwords` | Trigger password reset flows for users |

### Finance Permissions (finance)

| Permission Code | Description |
|----------------|-------------|
| `finance.view_revenue` | View revenue dashboards and reports |
| `finance.view_subscriptions` | View subscription plans and user subscriptions |
| `finance.manage_refunds` | Process and manage refund requests |
| `finance.export_reports` | Export financial reports as CSV/PDF |

### Admin Permissions (user, role, permission, system, analytics)

| Permission Code | Description |
|----------------|-------------|
| `user.manage` | Manage all users |
| `role.manage` | Manage roles and permissions |
| `permission.manage` | Manage permission definitions |
| `system.audit` | View audit logs |
| `system.config` | Manage system configuration |
| `analytics.global` | View global platform analytics |

---

## Role-Permission Matrix

Legend: **X** = explicitly granted

| Permission | student | parent | teacher | tutor | institution_admin | content_manager | reviewer | support | finance | admin | super_admin |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Study Plan** | | | | | | | | | | | |
| `study_plan.view` | X | | | | | | | | | X | X |
| `study_plan.create` | X | | | | | | | | | X | X |
| **Quiz** | | | | | | | | | | | |
| `quiz.attempt` | X | | | | | | | | | X | X |
| `quiz.view_results` | X | | | | | | | | | X | X |
| **Exam** | | | | | | | | | | | |
| `exam.view` | X | | | | | | | | | X | X |
| `exam.create` | X | | | | | | | | | X | X |
| `exam.assign` | | | X | | X | | | | | X | X |
| `exam.create_for_class` | | | X | | X | | | | | X | X |
| **Image** | | | | | | | | | | | |
| `image.upload` | X | | | | | | | | | X | X |
| `image.view_own` | X | | | | | | | | | X | X |
| **Report** | | | | | | | | | | | |
| `report.view_own` | X | | | | | | | | | X | X |
| `report.download_own` | X | | | | | | | | | X | X |
| `report.view_class` | | | X | | X | | | | | X | X |
| **Review (Spaced Repetition)** | | | | | | | | | | | |
| `review.view` | X | | | | | | | | | X | X |
| `review.practice` | X | | | | | | | | | X | X |
| **Foxy AI** | | | | | | | | | | | |
| `foxy.chat` | X | | | | | | | | | X | X |
| **Simulation** | | | | | | | | | | | |
| `simulation.view` | X | | | | | | | | | X | X |
| `simulation.interact` | X | | | | | | | | | X | X |
| **Leaderboard** | | | | | | | | | | | |
| `leaderboard.view` | X | | X | | X | | | | | X | X |
| **Profile** | | | | | | | | | | | |
| `profile.view_own` | X | X | X | | X | X | X | X | X | X | X |
| `profile.update_own` | X | X | X | | X | X | X | X | X | X | X |
| **Notification** | | | | | | | | | | | |
| `notification.view` | X | X | X | | X | X | X | X | X | X | X |
| `notification.dismiss` | X | X | X | | X | X | X | X | X | X | X |
| **Progress** | | | | | | | | | | | |
| `progress.view_own` | X | | | | | | | | | X | X |
| **Child** | | | | | | | | | | | |
| `child.view_performance` | | X | | | | | | | | X | X |
| `child.view_progress` | | X | | | | | | | | X | X |
| `child.download_report` | | X | | | | | | | | X | X |
| `child.view_exams` | | X | | | | | | | | X | X |
| `child.receive_alerts` | | X | | | | | | | | X | X |
| **Class** | | | | | | | | | | | |
| `class.manage` | | | X | | X | | | | | X | X |
| `class.view_analytics` | | | X | | X | | | | | X | X |
| **Test** | | | | | | | | | | | |
| `test.create` | | | X | | X | | | | | X | X |
| `test.edit` | | | X | | X | | | | | X | X |
| **Student Management** | | | | | | | | | | | |
| `student.view_uploads` | | | X | | X | | | | | X | X |
| `student.provide_feedback` | | | X | | X | | | | | X | X |
| **Worksheet** | | | | | | | | | | | |
| `worksheet.create` | | | X | | X | | | | | X | X |
| `worksheet.assign` | | | X | | X | | | | | X | X |
| **Institution** | | | | | | | | | | | |
| `institution.manage` | | | | | X | | | | | X | X |
| `institution.view_analytics` | | | | | X | | | | | X | X |
| `institution.manage_teachers` | | | | | X | | | | | X | X |
| `institution.manage_students` | | | | | X | | | | | X | X |
| `institution.view_reports` | | | | | X | | | | | X | X |
| **Content** | | | | | | | | | | | |
| `content.create` | | | | | | X | | | | X | X |
| `content.edit` | | | | | | X | | | | X | X |
| `content.submit_review` | | | | | | X | | | | X | X |
| `content.view_all` | | | | | | X | X | | | X | X |
| `content.manage_questions` | | | | | | X | | | | X | X |
| `content.manage_media` | | | | | | X | | | | X | X |
| `content.review` | | | | | | | X | | | X | X |
| `content.approve` | | | | | | | X | | | X | X |
| `content.reject` | | | | | | | X | | | X | X |
| `content.view_drafts` | | | | | | | X | | | X | X |
| `content.manage` | | | | | | | | | | X | X |
| **Support** | | | | | | | | | | | |
| `support.view_tickets` | | | | | | | | X | | X | X |
| `support.manage_tickets` | | | | | | | | X | | X | X |
| `support.view_user_activity` | | | | | | | | X | | X | X |
| `support.fix_relationships` | | | | | | | | X | | X | X |
| `support.resend_invites` | | | | | | | | X | | X | X |
| `support.reset_passwords` | | | | | | | | X | | X | X |
| **Finance** | | | | | | | | | | | |
| `finance.view_revenue` | | | | | | | | | X | X | X |
| `finance.view_subscriptions` | | | | | | | | | X | X | X |
| `finance.manage_refunds` | | | | | | | | | X | X | X |
| `finance.export_reports` | | | | | | | | | X | X | X |
| **Admin** | | | | | | | | | | | |
| `user.manage` | | | | | | | | | | X | X |
| `role.manage` | | | | | | | | | | X | X |
| `permission.manage` | | | | | | | | | | X | X |
| `system.audit` | | | | | | | | | | X | X |
| `system.config` | | | | | | | | | | X | X |
| `analytics.global` | | | | | | | | | | X | X |

**Note:** The `tutor` role currently has no permissions seeded in the database. Tutor permissions should be configured per-institution as needed.

**Note:** The `institution_admin` role inherits all `teacher` permissions in addition to its own `institution.*` permissions.

---

## Resource Ownership Rules

Resource access is enforced via the `resource_access_rules` table and the `check_resource_access()` database function. Each rule maps a role to a resource type with an ownership check mode:

| Ownership Mode | Meaning | Example |
|---------------|---------|---------|
| `own` | User must be the owner of the resource (matched via `auth_user_id`) | A student can only see their own quiz results |
| `linked` | User must have an approved guardian-student link | A parent can view their linked child's reports |
| `assigned` | User must be assigned to the class containing the student | A teacher can view uploads from students in their classes |
| `any` | Unrestricted access to all resources of this type | An admin can access any student record |

### Current resource access rules

| Role | Resource Type | Ownership Check |
|------|--------------|----------------|
| student | student, quiz, study_plan, report, image | `own` |
| parent | student, report, image | `linked` |
| teacher | student, class, report, image | `assigned` |
| admin | student, report, class | `any` |

---

## How to Assign Roles

Roles are assigned through the `user_roles` table. Each row links an `auth_user_id` to a `role_id`.

### Automatic assignment

When a row is inserted into `students`, `teachers`, or `guardians`, the `sync_user_roles()` trigger automatically creates the corresponding `user_roles` entry:

- `students` insert --> `student` role
- `teachers` insert --> `teacher` role
- `guardians` insert --> `parent` role

### Manual assignment

For operational roles (`institution_admin`, `content_manager`, `reviewer`, `support`, `finance`), an admin must insert into `user_roles` directly:

```sql
INSERT INTO user_roles (auth_user_id, role_id, is_active)
VALUES (
  '<user-auth-uuid>',
  (SELECT id FROM roles WHERE name = 'content_manager'),
  true
);
```

### Multi-role support

A user can hold multiple roles simultaneously. For example, a teacher could also be an `institution_admin`. All permissions from all active roles are merged when checking access.

### Role expiration

The `user_roles.expires_at` column supports time-limited role assignments. Expired roles are excluded from permission checks automatically.

---

## How Permissions Are Checked

Permission enforcement is implemented in `src/lib/rbac.ts` with three layers:

### Layer 1: Permission check

The `hasPermission(authUserId, permissionCode)` function:

1. Calls `getUserPermissions()` which invokes the `get_user_permissions` Supabase RPC
2. Results are cached in-memory for 5 minutes (keyed by user ID)
3. If the user holds the `super_admin` role, all permission checks return `true` immediately
4. Otherwise, checks if `permissionCode` exists in the user's merged permission list

### Layer 2: Resource ownership

The `canAccessStudent(authUserId, studentId)` function (and related `canAccessImage`, `canAccessReport`) checks:

1. Is the user an admin or super_admin? --> allow
2. Is the user the student themselves? --> allow (own)
3. Is the user a guardian linked to the student? --> allow (linked)
4. Is the user a teacher assigned to the student's class? --> allow (assigned)
5. Otherwise --> deny

### Layer 3: API route authorization

The `authorizeRequest(request, permission, options)` function orchestrates the full check:

1. Extracts the auth token from the `Authorization` header or Supabase session cookie
2. Loads and caches the user's roles and permissions via `getUserPermissions()`
3. Checks the required permission (if specified)
4. Optionally resolves the student ID for the authenticated user
5. Optionally runs a resource ownership check
6. Logs denied access attempts to the `audit_logs` table
7. Returns an `AuthorizationResult` with the user's identity, roles, and permissions

### Client-side usage

For UI rendering decisions (show/hide buttons, menu items), use the `usePermissions()` hook from `src/lib/usePermissions.ts`:

```typescript
const { hasPermission, hasRole, can, isAdmin } = usePermissions();

if (can('content.create')) {
  // show "New Content" button
}
```

Client-side checks are for UX only. The real enforcement always happens server-side via `authorizeRequest()`.

### Cache invalidation

Call `invalidatePermissionCache(userId)` after changing a user's roles or permissions to force a fresh load on their next request.
