# Alfanumrik Routing Inventory

**Last verified**: 2026-04-02
**Source**: `npm run build` output + middleware analysis

## Route Protection Model

```
                    ┌──────────────────────────┐
                    │    Next.js Middleware      │
                    │  (src/middleware.ts)       │
                    │                            │
                    │  - Session refresh         │
                    │  - Protected route check   │
                    │  - Rate limiting           │
                    │  - Security headers        │
                    │  - Bot blocking            │
                    └──────────┬───────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
        ┌─────────┐    ┌─────────────┐   ┌──────────┐
        │ Public  │    │ Protected   │   │  Admin   │
        │ Routes  │    │ Routes      │   │  Routes  │
        │ (no auth)│   │ (session)   │   │ (session │
        └─────────┘   └─────────────┘   │  + admin │
                                        │  table)  │
                                        └──────────┘
```

## Public Routes (No Authentication Required)

| Path | Type | Rendering | Purpose |
|------|------|-----------|---------|
| `/welcome` | Page | Static (○) | Landing page |
| `/about` | Page | Static (○) | About Alfanumrik |
| `/contact` | Page | Static (○) | Contact form |
| `/pricing` | Page | Static (○) | Subscription plans |
| `/product` | Page | Static (○) | Product overview |
| `/for-schools` | Page | Static (○) | School marketing |
| `/for-parents` | Page | Static (○) | Parent marketing |
| `/for-teachers` | Page | Static (○) | Teacher marketing |
| `/demo` | Page | Static (○) | Product demo |
| `/research` | Page | Static (○) | Research methodology |
| `/privacy` | Page | Static (○) | Privacy policy |
| `/terms` | Page | Static (○) | Terms of service |
| `/security` | Page | Static (○) | Security settings |
| `/help` | Page | Static (○) | Help center / FAQ |
| `/login` | Page | Static (○) | Student/teacher login |
| `/auth/reset` | Page | Static (○) | Password reset |
| `/parent` | Page | Static (○) | Parent login/dashboard |
| `/sitemap.xml` | API | Static (○) | SEO sitemap |

## Protected Student Routes (Session Cookie Required)

Middleware redirects to `/login` if no `sb-*-auth-token` cookie present.

| Path | Type | Rendering | Purpose |
|------|------|-----------|---------|
| `/` | Page | Static (○) | Root — redirects to `/welcome` if no session, `/dashboard` if session |
| `/dashboard` | Page | Static (○) | Student home dashboard |
| `/quiz` | Page | Static (○) | Quiz orchestrator |
| `/learn` | Page | Static (○) | Learning content browser |
| `/foxy` | Page | Static (○) | AI tutor chat |
| `/progress` | Page | Static (○) | Progress tracking |
| `/review` | Page | Static (○) | Spaced repetition review |
| `/study-plan` | Page | Static (○) | Personalized study plan |
| `/leaderboard` | Page | Static (○) | Gamification leaderboard |
| `/exams` | Page | Static (○) | Exam prep mode |
| `/simulations` | Page | Static (○) | Interactive STEM simulations |
| `/scan` | Page | Static (○) | OCR assignment scanner |
| `/reports` | Page | Static (○) | Student reports |
| `/notifications` | Page | Static (○) | Notification center |
| `/profile` | Page | Static (○) | Student profile |
| `/billing` | Page | Static (○) | Subscription management |
| `/hpc` | Page | Static (○) | High-performance computing |
| `/stem-centre` | Page | Static (○) | STEM exploration center |

## Protected Parent Routes

Middleware redirects to `/parent` (parent login) if no session.

| Path | Type | Rendering | Purpose |
|------|------|-----------|---------|
| `/parent/children` | Page | Static (○) | Linked children view |
| `/parent/reports` | Page | Static (○) | Child progress reports |
| `/parent/profile` | Page | Static (○) | Parent profile |
| `/parent/support` | Page | Static (○) | Support tickets |

## Protected Teacher Routes

Middleware redirects to `/login?role=teacher` if no session.

| Path | Type | Rendering | Purpose |
|------|------|-----------|---------|
| `/teacher` | Page | Static (○) | Teacher dashboard |
| `/teacher/classes` | Page | Static (○) | Class management |
| `/teacher/students` | Page | Static (○) | Student roster |
| `/teacher/reports` | Page | Static (○) | Class analytics |
| `/teacher/profile` | Page | Static (○) | Teacher profile |
| `/teacher/worksheets` | Page | Static (○) | Worksheet generation |

## Super Admin Routes (Session + admin_users Table Check)

Middleware redirects to `/super-admin/login` if no session. Page-level `authorizeAdmin()` verifies admin_users table.

| Path | Type | Rendering | Purpose |
|------|------|-----------|---------|
| `/super-admin` | Page | Dynamic (ƒ) | Control room dashboard |
| `/super-admin/login` | Page | Dynamic (ƒ) | Admin login |
| `/super-admin/users` | Page | Dynamic (ƒ) | User management |
| `/super-admin/cms` | Page | Dynamic (ƒ) | Content management |
| `/super-admin/content` | Page | Dynamic (ƒ) | Content seeding |
| `/super-admin/logs` | Page | Dynamic (ƒ) | Audit trail |
| `/super-admin/flags` | Page | Dynamic (ƒ) | Feature flags |
| `/super-admin/institutions` | Page | Dynamic (ƒ) | School directory |
| `/super-admin/diagnostics` | Page | Dynamic (ƒ) | System diagnostics |
| `/super-admin/learning` | Page | Dynamic (ƒ) | Learning analytics |
| `/super-admin/reports` | Page | Dynamic (ƒ) | Business reports |
| `/super-admin/subscriptions` | Page | Dynamic (ƒ) | Subscription analytics |
| `/super-admin/support` | Page | Dynamic (ƒ) | Support tickets |
| `/super-admin/workbench` | Page | Dynamic (ƒ) | Admin workbench |
| `/super-admin/demo` | Page | Dynamic (ƒ) | Demo account management |

## API Routes

### Public API
| Route | Methods | Auth | Purpose |
|-------|---------|------|---------|
| `/api/v1/health` | GET | None | Health check |

### Error Reporting
| Route | Methods | Auth | Purpose |
|-------|---------|------|---------|
| `/api/error-report` | POST | None (client errors) | Client error reporting |

### Payment APIs
| Route | Methods | Auth | Purpose |
|-------|---------|------|---------|
| `/api/payments/subscribe` | POST | Session | Initiate subscription |
| `/api/payments/verify` | POST | Session | Verify payment |
| `/api/payments/webhook` | POST | Razorpay signature | Webhook handler |
| `/api/payments/status` | GET | Session | Subscription status |
| `/api/payments/cancel` | POST | Session | Cancel subscription |
| `/api/payments/setup-plans` | POST | Admin | Initialize plans |

### V1 API (Protected — Session or Bearer Token)
| Route | Methods | Auth | Purpose |
|-------|---------|------|---------|
| `/api/v1/admin/audit-logs` | GET | Admin | Audit logs |
| `/api/v1/admin/roles` | GET/POST | Admin | Role management |
| `/api/v1/child/[id]/progress` | GET | Parent (ownership check) | Child progress |
| `/api/v1/child/[id]/report` | GET | Parent (ownership check) | Child report |
| `/api/v1/class/[id]/analytics` | GET | Teacher (assignment check) | Class analytics |
| `/api/v1/exam/create` | POST | Student | Create exam session |
| `/api/v1/leaderboard` | GET | Session | Leaderboard data |
| `/api/v1/performance` | GET | Session | Performance metrics |
| `/api/v1/study-plan` | GET/POST | Student | Study plan CRUD |
| `/api/v1/upload-assignment` | POST | Student | OCR upload |

### Super Admin API (Protected — Admin Auth)
| Route | Methods | Auth | Purpose |
|-------|---------|------|---------|
| `/api/super-admin/analytics` | GET | Admin | Engagement metrics |
| `/api/super-admin/cms` | GET/POST/PUT/DELETE | Admin | Content CRUD |
| `/api/super-admin/content` | POST | Admin | Content seeding |
| `/api/super-admin/content-coverage` | GET | Admin | Gap analysis |
| `/api/super-admin/demo-accounts` | GET/POST | Admin | Demo accounts |
| `/api/super-admin/deploy` | GET | Admin | Deploy info |
| `/api/super-admin/feature-flags` | GET/POST/PUT/DELETE | Admin | Feature flags |
| `/api/super-admin/institutions` | GET/POST/PUT | Admin | Schools |
| `/api/super-admin/logs` | GET | Admin | Audit logs |
| `/api/super-admin/observability` | GET | Admin | System health |
| `/api/super-admin/platform-ops` | POST | Admin | Backup/restore |
| `/api/super-admin/reports` | GET | Admin | CSV exports |
| `/api/super-admin/roles` | GET/POST | Admin | Roles |
| `/api/super-admin/stats` | GET | Admin | Statistics |
| `/api/super-admin/support` | GET/POST | Admin | Support tickets |
| `/api/super-admin/test-accounts` | POST | Admin | Test users |
| `/api/super-admin/users` | GET/POST/PUT | Admin | User management |

## Middleware Route Matching

The middleware matcher excludes static assets:
```
/((?!_next/static|_next/image|favicon\.ico|favicon\.svg|apple-touch-icon\.svg|icon-.*\.svg|manifest\.json|sw\.js|icons/|robots\.txt).*)
```

## Route Issues Found

None critical. All routes render meaningful content per build verification.

## Legend

- ○ Static: Prerendered as static content (HTML generated at build time)
- ƒ Dynamic: Server-rendered on demand (requires runtime data)
