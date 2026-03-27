# Super Admin Operations Guide

## Accessing the Admin Dashboard

```
https://alfanumrik.vercel.app/internal/admin?secret=YOUR_SUPER_ADMIN_SECRET
```

The secret is stored as `SUPER_ADMIN_SECRET` in Vercel environment variables.

## Admin Dashboard Tabs

### 1. Dashboard
- Platform totals: students, teachers, parents, quiz sessions, chat sessions
- Last 24 hours and 7 days activity
- Quick action buttons

### 2. Users
- Filter by role: Student, Teacher, Parent
- Search by name
- Ban/unban users
- View XP, grade, subscription plan, status
- Export CSV reports

### 3. Content
- Browse chapters, topics, quiz questions
- Add new content with inline forms
- Enable/disable content items
- Pagination and filtering

### 4. Analytics
- Content overview (chapters, topics, questions count)
- Student retention (active in 1d, 7d, 30d)
- Subscription plan breakdown
- Popular subjects bar chart
- Top 10 students leaderboard
- 30-day engagement histogram

### 5. Feature Flags
- Toggle features ON/OFF instantly
- Create new flags
- Delete unused flags
- Recommended flags list for quick setup
- Use as kill switches for emergency disable

### 6. Schools
- View onboarded institutions
- See student/teacher counts per school
- Check active/suspended status

### 7. Support
- User activity lookup (quiz + chat history)
- Password reset by email
- Resend invite emails
- View parent-student links
- View class enrollments
- Inspect failed background jobs

### 8. Reports
- Export data as CSV or JSON
- Available: Students, Teachers, Parents, Quizzes, Chats, Audit Logs
- Up to 5,000 rows per export

### 9. Audit Logs
- View all admin actions with timestamps
- See who did what, when, and on which resource
- Filter by action type
- Export to CSV

## Common Operations

### Suspending a User
1. Go to Users tab → find the user
2. Click "Ban" button → user is deactivated
3. Action is logged in audit trail

### Adding Quiz Questions
1. Go to Content tab → select "questions"
2. Click "+ Add New"
3. Fill in: subject, grade, question text, 4 options, correct answer, explanation
4. Click Save

### Emergency Feature Disable
1. Go to Flags tab
2. Find the flag (e.g., `foxy_ai_enabled`)
3. Click the toggle to OFF
4. Feature is disabled across all users immediately

### Checking Failed Background Jobs
1. Go to Support tab
2. Click "Load Failed Jobs"
3. Review error messages
4. Fix underlying issue
5. Jobs can be re-queued via database

### Exporting User Data
1. Go to Reports tab
2. Click CSV or JSON for the desired data type
3. File downloads automatically with timestamp

## Environment Variables Required

| Variable | Purpose | Where Set |
|----------|---------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Vercel |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public auth key | Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin DB access | Vercel (secret) |
| `SUPER_ADMIN_SECRET` | Admin panel access | Vercel (secret) |
| `RAZORPAY_KEY_ID` | Payment gateway | Vercel |
| `RAZORPAY_KEY_SECRET` | Payment signature | Vercel (secret) |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook validation | Vercel (secret) |
| `UPSTASH_REDIS_REST_URL` | Rate limiting | Vercel |
| `UPSTASH_REDIS_REST_TOKEN` | Rate limiting auth | Vercel (secret) |

## Release Process

1. Create feature branch from `main`
2. Develop and test locally
3. Push to branch → CI runs (lint, type-check, build)
4. Create PR to `main` → review changes
5. Merge PR → production deploy triggers automatically
6. Verify health check passes
7. Check admin dashboard for any anomalies

## Security Notes

- Admin panel is rate-limited to 10 requests/minute
- All admin actions are logged to audit_logs table
- Admin secret should be rotated every 90 days
- Never share the admin secret via unencrypted channels
- All API responses exclude sensitive fields (passwords, tokens)
