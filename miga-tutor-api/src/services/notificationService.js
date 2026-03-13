const supabase = require('../config/supabase');
const logger = require('../config/logger');

// Send push via FCM v1 HTTP API
async function sendPush(fcmToken, { title, body, data = {} }) {
  if (!process.env.FCM_SERVER_KEY) {
    logger.warn('FCM_SERVER_KEY not set, skipping push');
    return { skipped: true };
  }

  const res = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `key=${process.env.FCM_SERVER_KEY}` },
    body: JSON.stringify({
      to: fcmToken,
      notification: { title, body, icon: '/icon-192.png', click_action: 'FLUTTER_NOTIFICATION_CLICK' },
      data,
    }),
  });

  if (!res.ok) { const t = await res.text(); logger.error('FCM error:', t); }
  return res.json();
}

async function saveToken(userId, token, platform = 'web') {
  await supabase.from('push_tokens').upsert({ user_id: userId, token, platform, updated_at: new Date().toISOString() }, { onConflict: 'token' });
}

async function removeToken(userId, token) {
  await supabase.from('push_tokens').delete().eq('user_id', userId).eq('token', token);
}

async function sendToUser(userId, payload) {
  const { data: tokens } = await supabase.from('push_tokens').select('token').eq('user_id', userId);
  if (!tokens?.length) return { sent: 0 };
  await Promise.allSettled(tokens.map(t => sendPush(t.token, payload)));
  return { sent: tokens.length };
}

// Daily streak reminder — call from a cron job
async function sendStreakReminders() {
  const yesterday = new Date(Date.now() - 86400 * 1000).toISOString().split('T')[0];

  // Users who haven't done a quiz today
  const { data: tokens } = await supabase.from('push_tokens').select('user_id, token');
  if (!tokens?.length) return;

  for (const { user_id, token } of tokens) {
    const { count } = await supabase.from('quiz_results').select('*', { count: 'exact', head: true }).eq('user_id', user_id).gte('created_at', new Date().toISOString().split('T')[0]);
    if (count === 0) {
      await sendPush(token, { title: '🦊 Foxy misses you!', body: 'Keep your learning streak alive — do a quick quiz today!', data: { screen: 'quiz' } });
    }
  }
  logger.info('Streak reminders sent');
}

module.exports = { saveToken, removeToken, sendToUser, sendStreakReminders };
