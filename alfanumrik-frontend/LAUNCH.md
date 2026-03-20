# 🚀 Alfanumrik Launch Guide

Complete step-by-step guide to deploy Alfanumrik from zero to production.

---

## Prerequisites

- Node.js 18+ installed
- [Vercel account](https://vercel.com) (free)
- [Supabase account](https://supabase.com) (free)
- [Anthropic API key](https://console.anthropic.com)
- [Razorpay account](https://razorpay.com) (for payments — optional for testing)
- [Firebase project](https://console.firebase.google.com) (for push notifications — optional)

---

## Step 1 — Set Up Supabase

1. Create a new Supabase project at https://supabase.com
2. Go to **SQL Editor** → **New Query**
3. Paste the entire contents of `miga-tutor-api/supabase-schema.sql` and run it
4. Go to **Project Settings → API** and copy:
   - `Project URL` → `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret — backend only)

---

## Step 2 — Deploy the Backend API

```bash
cd miga-tutor-api
npm install
npm install -g vercel
vercel --prod
```

In the Vercel dashboard for this project, add these **Environment Variables**:

| Variable | Value |
|----------|-------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `NODE_ENV` | `production` |
| `ALLOWED_ORIGINS` | `https://your-frontend.vercel.app` (update after step 3) |
| `RAZORPAY_KEY_ID` | Razorpay key ID (optional) |
| `RAZORPAY_KEY_SECRET` | Razorpay key secret (optional) |
| `FCM_SERVER_KEY` | Firebase server key (optional) |
| `ADMIN_EMAILS` | Comma-separated admin email addresses |

After adding env vars, click **Redeploy**.

Note your backend URL: `https://your-api-name.vercel.app`

---

## Step 3 — Deploy the Frontend

```bash
cd alfanumrik-frontend
npm install
vercel --prod
```

In the Vercel dashboard for this project, add these **Environment Variables**:

| Variable | Value |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `NEXT_PUBLIC_API_URL` | Your backend URL from Step 2 |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Razorpay key ID (optional) |

After adding env vars, click **Redeploy**.

Note your frontend URL: `https://your-app.vercel.app`

---

## Step 4 — Connect Frontend ↔ Backend

1. Go to your **backend** project in Vercel
2. Update `ALLOWED_ORIGINS` to your frontend URL: `https://your-app.vercel.app`
3. Click **Redeploy** on the backend

---

## Step 5 — Set Up GitHub CI/CD (optional but recommended)

Push both repos to GitHub and add these **Secrets** in each repo's Settings → Secrets:

**Both repos:**
```
VERCEL_TOKEN          # From vercel.com/account/tokens
VERCEL_ORG_ID         # From .vercel/project.json after first deploy
```

**Frontend repo:**
```
VERCEL_FRONTEND_PROJECT_ID
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_API_URL
NEXT_PUBLIC_RAZORPAY_KEY_ID
```

**Backend repo:**
```
VERCEL_API_PROJECT_ID
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
```

After this, every push to `main` auto-deploys to production. Every PR gets a preview URL.

---

## Step 6 — Test Everything

Open your frontend URL and verify:

- [ ] Splash screen loads
- [ ] Sign up with email works (check Supabase Auth → Users)
- [ ] Onboarding saves profile (check Supabase Table Editor → student_profiles)
- [ ] Home screen shows with correct name/grade
- [ ] Ask Foxy a question — get a response
- [ ] Generate a quiz — answer all questions
- [ ] Progress screen shows stats
- [ ] Badges unlock correctly
- [ ] Settings screen saves changes
- [ ] Leaderboard loads

---

## Post-Launch

### Populate Syllabus for RAG
For the RAG (curriculum-aware answers) feature to work, populate `syllabus_topics` with content:

```sql
INSERT INTO syllabus_topics (grade, subject, chapter_id, title, description, content)
VALUES
  ('Grade 9', 'Science', 'bio-01', 'Photosynthesis',
   'How plants make food using sunlight',
   'Photosynthesis is the process by which plants convert light energy into chemical energy...');
```

### Add Yourself as Admin
Add your email to the `ADMIN_EMAILS` backend env var to access `/api/admin/stats`, `/api/admin/users`, and `/api/admin/revenue`.

### Enable Push Notifications
1. Create a Firebase project → Cloud Messaging
2. Get the Server Key → add as `FCM_SERVER_KEY` in backend env
3. The frontend will prompt users for notification permission

---

## Architecture

```
Student (Browser/Mobile)
        ↓
Alfanumrik Frontend (Next.js → Vercel)
        ↓ REST + SSE
MIGA Backend API (Express → Vercel)
     ↓              ↓
Anthropic Claude  Supabase (PostgreSQL + Auth)
```

## Support

File issues on GitHub or email your admin address.


<!-- v2.0 deployed with Supabase + Foxy AI integration -->
