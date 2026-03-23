/**
 * Alfanumrik Share Utilities
 *
 * In India, WhatsApp IS the internet for parents.
 * PhysicsWallah gets 70% of its new users from WhatsApp shares.
 * Every proud moment (quiz result, streak milestone, badge) should be
 * one tap away from a parent's WhatsApp group.
 */

export interface ShareData {
  title: string;
  text: string;
  url?: string;
}

/**
 * Share via Web Share API (native share sheet) or WhatsApp fallback.
 * On Android, this shows the native share sheet.
 * On iOS Safari, this shows the native share sheet.
 * Fallback: open WhatsApp directly.
 */
export async function shareResult(data: ShareData): Promise<boolean> {
  const url = data.url || 'https://alfanumrik.com';
  const fullText = `${data.text}\n\n${url}`;

  // Try native Web Share API first (works great on Indian Android phones)
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: data.title, text: data.text, url });
      return true;
    } catch {
      // User cancelled or API not available — fall through to WhatsApp
    }
  }

  // Fallback: WhatsApp deep link (most Indian parents use WhatsApp)
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(fullText)}`;
  window.open(whatsappUrl, '_blank');
  return true;
}

/**
 * Generate a quiz result share message.
 */
export function quizShareMessage(params: {
  studentName: string;
  subject: string;
  score: number;
  xpEarned: number;
  isHi: boolean;
}): ShareData {
  const { studentName, subject, score, xpEarned, isHi } = params;
  const emoji = score >= 80 ? '🏆' : score >= 60 ? '⭐' : '💪';

  if (isHi) {
    return {
      title: `${studentName} ने ${subject} में ${score}% स्कोर किया!`,
      text: `${emoji} ${studentName} ने Alfanumrik पर ${subject} क्विज़ में ${score}% स्कोर किया और +${xpEarned} XP कमाए!\n\nAlfanumrik — भारत का सबसे स्मार्ट AI ट्यूटर। मुफ़्त में शुरू करो!`,
    };
  }

  return {
    title: `${studentName} scored ${score}% in ${subject}!`,
    text: `${emoji} ${studentName} scored ${score}% on a ${subject} quiz on Alfanumrik and earned +${xpEarned} XP!\n\nAlfanumrik — India's smartest AI tutor. Free to start!`,
  };
}

/**
 * Generate a streak milestone share message.
 */
export function streakShareMessage(params: {
  studentName: string;
  days: number;
  isHi: boolean;
}): ShareData {
  const { studentName, days, isHi } = params;

  if (isHi) {
    return {
      title: `${studentName} की ${days} दिन की स्ट्रीक! 🔥`,
      text: `🔥 ${studentName} ने Alfanumrik पर लगातार ${days} दिन पढ़ाई की!\n\nAlfanumrik — AI-powered adaptive learning। मुफ़्त में शुरू करो!`,
    };
  }

  return {
    title: `${studentName}'s ${days}-day streak! 🔥`,
    text: `🔥 ${studentName} has been learning for ${days} days straight on Alfanumrik!\n\nAlfanumrik — AI-powered adaptive learning. Free to start!`,
  };
}
