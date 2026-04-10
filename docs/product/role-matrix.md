# Role Matrix

Last verified: 2026-04-02
Source files: `src/lib/rbac.ts`, `src/lib/constants.ts`, `docs/RBAC_MATRIX.md`, `supabase/migrations/20260324070000_production_rbac_system.sql`

## Roles and Hierarchy

| Role | Display Name | Hierarchy Level | System Role | Notes |
|------|-------------|----------------|-------------|-------|
| `super_admin` | Super Admin | 100 | Yes | Bypasses all permission checks. Must exist in `admin_users` table. |
| `admin` | Admin | 90 | Yes | All permissions explicitly granted. |
| `institution_admin` | Institution Admin | 70 | No | School-level admin. Inherits all teacher permissions plus `institution.*`. |
| `finance` | Finance | 65 | No | Revenue dashboards, subscription management, refund processing. |
| `content_manager` | Content Manager | 60 | No | Content creation and media management. |
| `reviewer` | Reviewer | 58 | No | Content review and approval workflow. |
| `support` | Support | 55 | No | Ticket management, user activity lookup, relationship fixes. |
| `teacher` | Teacher | 50 | Yes | Class management, student feedback, worksheets, reports. |
| `tutor` | Tutor | 40 | No | No permissions seeded. Configured per-institution. |
| `parent` | Parent | 30 | Yes | View linked child performance, download reports. |
| `student` | Student | 10 | Yes | Core learning features: quiz, foxy, study plan, progress. |

Multi-role is supported. A user can hold `teacher` + `institution_admin` simultaneously. All permissions from active roles are merged.

Role assignment is automatic for `student`, `teacher`, `parent` via the `sync_user_roles()` database trigger. Operational roles (`institution_admin`, `content_manager`, `reviewer`, `support`, `finance`) require manual SQL insert into `user_roles`.

## Page Access by Role

### Student Pages
| Page | Path | Required Auth |
|------|------|---------------|
| Dashboard | `/dashboard` | Session cookie |
| Chapters | `/learn` | Session cookie |
| Foxy AI Tutor | `/foxy` | Session cookie + `foxy.chat` |
| STEM Centre | `/stem-centre` | Session cookie |
| Quiz | `/quiz` | Session cookie + `quiz.attempt` |
| Progress | `/progress` | Session cookie + `progress.view_own` |
| Leaderboard | `/leaderboard` | Session cookie + `leaderboard.view` |
| Review (Spaced Repetition) | `/review` | Session cookie + `review.view` |
| Exams | `/exams` | Session cookie + `exam.view` |
| Scan | `/scan` | Session cookie + `image.upload` |
| Reports | `/reports` | Session cookie + `report.view_own` |
| Study Plan | `/study-plan` | Session cookie + `study_plan.view` |
| Profile | `/profile` | Session cookie + `profile.view_own` |
| Notifications | `/notifications` | Session cookie + `notification.view` |
| Billing | `/billing` | Session cookie |

### Parent Pages
| Page | Path | Required Auth |
|------|------|---------------|
| Dashboard | `/parent` | Session cookie |
| Children | `/parent/children` | Session cookie + `child.view_performance` |
| Reports | `/parent/reports` | Session cookie + `child.download_report` |
| Support | `/parent/support` | Session cookie |
| Profile | `/parent/profile` | Session cookie + `profile.view_own` |

### Teacher Pages
| Page | Path | Required Auth |
|------|------|---------------|
| Dashboard | `/teacher` | Session cookie |
| Classes | `/teacher/classes` | Session cookie + `class.manage` |
| Students | `/teacher/students` | Session cookie + `student.view_uploads` |
| Worksheets | `/teacher/worksheets` | Session cookie + `worksheet.create` |
| Reports | `/teacher/reports` | Session cookie + `report.view_class` |
| Profile | `/teacher/profile` | Session cookie + `profile.view_own` |

### Super Admin Pages
| Page | Path | Required Auth |
|------|------|---------------|
| Login | `/super-admin/login` | None (login page) |
| Control Room | `/super-admin` | Session cookie + `admin_users` lookup |
| Users | `/super-admin/users` | Session cookie + `admin_users` lookup |
| CMS | `/super-admin/cms` | Session cookie + `admin_users` lookup |
| Logs | `/super-admin/logs` | Session cookie + `admin_users` lookup |
| Flags | `/super-admin/flags` | Session cookie + `admin_users` lookup |
| Institutions | `/super-admin/institutions` | Session cookie + `admin_users` lookup |
| Diagnostics | `/super-admin/diagnostics` | Session cookie + `admin_users` lookup |
| Learning | `/super-admin/learning` | Session cookie + `admin_users` lookup |
| Reports | `/super-admin/reports` | Session cookie + `admin_users` lookup |
| Subscriptions | `/super-admin/subscriptions` | Session cookie + `admin_users` lookup |
| Workbench | `/super-admin/workbench` | Session cookie + `admin_users` lookup |

### Public Pages (no auth required)
- `/welcome` -- Landing page
- `/login` -- Student/teacher login
- `/signup` -- Student registration
- `/demo` -- Demo request form (for schools)
- `/privacy`, `/terms`, `/contact` -- Legal/info pages
- `/api/v1/health` -- Health check endpoint

## API Route Access by Permission

### Student API Routes
| Route | Method | Permission | Description |
|-------|--------|------------|-------------|
| `/api/quiz/submit` | POST | `quiz.attempt` | Submit quiz results |
| `/api/study-plan` | GET/POST | `study_plan.view` / `study_plan.create` | View/create study plans |
| `/api/reports` | GET | `report.view_own` | View own reports |
| `/api/v1/health` | GET | None (public) | System health check |

### Super Admin API Routes
All super admin routes require `authorizeAdmin()` -- checks session token then looks up `admin_users` table for `is_active = true`.

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/super-admin/stats` | GET | Platform statistics |
| `/api/super-admin/users` | GET/PUT | User management |
| `/api/super-admin/roles` | GET/PUT | Role assignment |
| `/api/super-admin/cms` | GET/POST/PUT/DELETE | Content management |
| `/api/super-admin/content` | POST | Content seeding, bulk ops |
| `/api/super-admin/analytics` | GET | Engagement, revenue, retention |
| `/api/super-admin/feature-flags` | GET/POST/PUT/DELETE | Flag CRUD |
| `/api/super-admin/institutions` | GET | School directory |
| `/api/super-admin/logs` | GET | Audit log retrieval |
| `/api/super-admin/observability` | GET | System health |
| `/api/super-admin/deploy` | GET | Deployment info |
| `/api/super-admin/platform-ops` | POST | Backup/restore |
| `/api/super-admin/reports` | GET | CSV exports |
| `/api/super-admin/support` | GET/POST | Support tickets |
| `/api/super-admin/test-accounts` | POST | Test user creation |
| `/api/super-admin/demo-accounts` | GET/POST/PUT/DELETE | Demo account management |

### Internal Admin Routes (legacy)
Routes under `/internal/admin/*` and `/api/internal/admin/*` require the `SUPER_ADMIN_SECRET` environment variable, validated via timing-safe comparison in middleware.

## Data Visibility by Role

| Data | Student | Parent | Teacher | Admin/Super Admin |
|------|---------|--------|---------|-------------------|
| Own quiz results | Yes | -- | -- | Yes (any) |
| Own progress/mastery | Yes | -- | -- | Yes (any) |
| Own profile | Yes | Yes | Yes | Yes (any) |
| Child's performance | -- | Linked children only | -- | Yes (any) |
| Child's progress | -- | Linked children only | -- | Yes (any) |
| Child's reports | -- | Linked children only | -- | Yes (any) |
| Class analytics | -- | -- | Assigned classes | Yes (any) |
| Student uploads | -- | -- | Assigned students | Yes (any) |
| All user data | -- | -- | -- | Yes |
| Audit logs | -- | -- | -- | Yes |
| System metrics | -- | -- | -- | Yes |
| Revenue data | -- | -- | -- | Yes (finance role too) |

## Resource Ownership Rules

Enforced via `check_resource_access()` database function and `canAccessStudent()` in `src/lib/rbac.ts`.

| Role | Resource Types | Ownership Mode | Meaning |
|------|---------------|----------------|---------|
| student | student, quiz, study_plan, report, image | `own` | Must be the owner (matched via `auth_user_id`) |
| parent | student, report, image | `linked` | Must have an approved `guardian_student_links` record |
| teacher | student, class, report, image | `assigned` | Must be assigned to the class containing the student |
| admin | student, report, class | `any` | Unrestricted access to all resources |

## Permission Cache

- In-memory cache with 5-minute TTL (keyed by user ID)
- Cache eviction at 200 entries
- `invalidatePermissionCache(userId)` forces fresh load on next request
- Aspirational: Redis cache for multi-instance consistency (currently in-memory only)

## Authorization Flow

```
Request arrives
  |
  v
1. Extract auth token (Authorization header or Supabase session cookie)
2. Verify token with Supabase GoTrue --> get auth_user_id
3. Call get_user_permissions RPC --> get roles + permissions (cached 5 min)
4. If super_admin role present --> allow (bypass all checks)
5. Check required permission code --> 403 if missing
6. Optionally resolve student_id for the authenticated user
7. Optionally run resource ownership check (canAccessStudent)
8. Log denied access to audit_logs table
9. Return AuthorizationResult
```

## Role Expiration

The `user_roles.expires_at` column supports time-limited role assignments. Expired roles are automatically excluded from permission checks by the `get_user_permissions` RPC.
