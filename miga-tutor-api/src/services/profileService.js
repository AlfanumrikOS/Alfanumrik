const supabase = require('../config/supabase');

async function getProfile(userId) {
  const { data, error } = await supabase
    .from('student_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function upsertProfile(userId, profileData) {
  const { name, grade, subject, language, avatar } = profileData;

  const { data, error } = await supabase
    .from('student_profiles')
    .upsert({
      user_id: userId,
      name,
      grade,
      subject,
      language: language || 'English',
      avatar: avatar || 'foxy',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getProgress(userId) {
  // Get quiz stats
  const { data: quizData } = await supabase
    .from('quiz_results')
    .select('score, total, percentage, subject, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  // Get chat session count
  const { count: sessionCount } = await supabase
    .from('chat_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  // Calculate stats
  const totalQuizzes = quizData?.length || 0;
  const avgScore = totalQuizzes > 0
    ? Math.round(quizData.reduce((sum, q) => sum + q.percentage, 0) / totalQuizzes)
    : 0;

  const streakDays = await calculateStreak(userId);

  return {
    totalQuizzes,
    avgScore,
    sessionCount: sessionCount || 0,
    streakDays,
    recentQuizzes: quizData?.slice(0, 5) || [],
  };
}

async function calculateStreak(userId) {
  const { data } = await supabase
    .from('quiz_results')
    .select('created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (!data || data.length === 0) return 0;

  let streak = 0;
  let currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);

  const activityDays = new Set(
    data.map(r => new Date(r.created_at).toDateString())
  );

  for (let i = 0; i < 30; i++) {
    const dateStr = new Date(currentDate - i * 86400000).toDateString();
    if (activityDays.has(dateStr)) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }

  return streak;
}

module.exports = { getProfile, upsertProfile, getProgress };
