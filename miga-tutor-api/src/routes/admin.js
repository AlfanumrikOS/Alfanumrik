const express = require('express');
const router = express.Router();
const adminMiddleware = require('../middleware/admin');
const supabase = require('../config/supabase');

// ── PUBLIC — no admin required ─────────────────────────────────────────────
// GET /api/admin/leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const period = req.query.period === 'alltime' ? null : 7;
    let query = supabase.from('quiz_results').select('user_id, score, total, created_at');
    if (period) {
      query = query.gte('created_at', new Date(Date.now() - period * 86400 * 1000).toISOString());
    }
    const { data: results } = await query;
    if (!results || results.length === 0) return res.json({ leaderboard: [], myRank: null });

    const byUser = {};
    for (const r of results) {
      if (!byUser[r.user_id]) byUser[r.user_id] = { userId: r.user_id, score: 0, quizzes: 0 };
      byUser[r.user_id].score += r.score;
      byUser[r.user_id].quizzes += 1;
    }

    const userIds = Object.keys(byUser);
    const { data: profiles } = await supabase
      .from('student_profiles').select('user_id, name, grade').in('user_id', userIds);
    for (const p of (profiles || [])) {
      if (byUser[p.user_id]) {
        byUser[p.user_id].name = p.name || 'Anonymous';
        byUser[p.user_id].grade = p.grade;
      }
    }

    const sorted = Object.values(byUser)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    const myIdx = sorted.findIndex(u => u.userId === req.user.id);
    const myRank = myIdx >= 0 ? { ...sorted[myIdx], rank: myIdx + 1 } : null;

    res.json({ leaderboard: sorted, myRank });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// ── ADMIN ONLY ─────────────────────────────────────────────────────────────
router.use(adminMiddleware);

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  try {
    const [users, quizzes, sessions, subs] = await Promise.all([
      supabase.from('student_profiles').select('*', { count: 'exact', head: true }),
      supabase.from('quiz_results').select('*', { count: 'exact', head: true }),
      supabase.from('chat_sessions').select('*', { count: 'exact', head: true }),
      supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    ]);
    res.json({
      stats: {
        totalUsers: users.count || 0,
        totalQuizzes: quizzes.count || 0,
        totalSessions: sessions.count || 0,
        activeSubscriptions: subs.count || 0,
      }
    });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch stats' }); }
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const from = (page - 1) * limit;
    const { data, count, error } = await supabase
      .from('student_profiles')
      .select('user_id, name, grade, subject, language, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1);
    if (error) throw error;
    res.json({ users: data, total: count, page, limit });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch users' }); }
});

// GET /api/admin/users/:userId
router.get('/users/:userId', async (req, res) => {
  try {
    const uid = req.params.userId;
    const [profile, quizzes, sessions] = await Promise.all([
      supabase.from('student_profiles').select('*').eq('user_id', uid).single(),
      supabase.from('quiz_results')
        .select('topic, score, total, percentage, created_at')
        .eq('user_id', uid).order('created_at', { ascending: false }).limit(10),
      supabase.from('chat_sessions')
        .select('id, created_at')
        .eq('user_id', uid).order('created_at', { ascending: false }).limit(10),
    ]);
    res.json({
      profile: profile.data,
      recentQuizzes: quizzes.data,
      recentSessions: sessions.data,
    });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch user detail' }); }
});

// GET /api/admin/revenue
router.get('/revenue', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('payment_orders')
      .select('amount, plan_id, status, created_at')
      .eq('status', 'paid')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const total = data.reduce((sum, o) => sum + o.amount, 0);
    const byPlan = data.reduce((acc, o) => {
      acc[o.plan_id] = (acc[o.plan_id] || 0) + o.amount;
      return acc;
    }, {});
    res.json({ total: total / 100, currency: 'INR', byPlan, orders: data.slice(0, 50) });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch revenue' }); }
});

module.exports = router;
