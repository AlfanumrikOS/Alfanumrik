-- ============================================================
-- ALFANUMRIK — Complete Supabase Schema
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- ── 1. STUDENT PROFILES ────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_profiles (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  name        TEXT,
  grade       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  language    TEXT DEFAULT 'English',
  avatar      TEXT DEFAULT 'foxy',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. CHAT SESSIONS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_sessions (
  id         UUID PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. CHAT MESSAGES ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id  UUID REFERENCES chat_sessions(id) ON DELETE CASCADE NOT NULL,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role        TEXT CHECK (role IN ('user', 'assistant')) NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. QUIZ RESULTS ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quiz_results (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  topic       TEXT,
  subject     TEXT,
  grade       TEXT,
  score       INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  percentage  INTEGER NOT NULL,
  answers     JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. SUBSCRIPTIONS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  plan_id              TEXT NOT NULL DEFAULT 'free',
  status               TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','active','expired','cancelled')),
  razorpay_payment_id  TEXT,
  razorpay_order_id    TEXT,
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. PAYMENT ORDERS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_orders (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  razorpay_order_id   TEXT UNIQUE NOT NULL,
  razorpay_payment_id TEXT,
  plan_id             TEXT NOT NULL,
  amount              INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'INR',
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. PUSH TOKENS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_tokens (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  token      TEXT UNIQUE NOT NULL,
  platform   TEXT DEFAULT 'web',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 8. SYLLABUS TOPICS (for RAG) ───────────────────────────
CREATE TABLE IF NOT EXISTS syllabus_topics (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  grade       TEXT NOT NULL,
  subject     TEXT NOT NULL,
  chapter_id  TEXT,
  title       TEXT NOT NULL,
  description TEXT,
  content     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(grade, subject, title)
);

-- ── 9. NOTIFICATIONS LOG ───────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  data       JSONB,
  read       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE student_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_results        ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications       ENABLE ROW LEVEL SECURITY;
-- syllabus_topics is public read
ALTER TABLE syllabus_topics    ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "own profile"       ON student_profiles  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own sessions"      ON chat_sessions      FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own messages"      ON chat_messages      FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own quiz"          ON quiz_results        FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own subscription"  ON subscriptions       FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own orders"        ON payment_orders      FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own tokens"        ON push_tokens         FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own notifications" ON notifications       FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "syllabus public"   ON syllabus_topics     FOR SELECT USING (true);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user    ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_results_user     ON quiz_results(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user      ON push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user    ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_syllabus_grade_sub    ON syllabus_topics(grade, subject);

-- Full-text search on syllabus content (for RAG keyword fallback)
CREATE INDEX IF NOT EXISTS idx_syllabus_fts ON syllabus_topics USING gin(to_tsvector('english', coalesce(content,'') || ' ' || coalesce(title,'')));
