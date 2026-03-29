'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui';

/**
 * Daily Challenge — The first thing a student sees.
 *
 * Psychology: Creates urgency (time-limited), curiosity (unknown topic),
 * and social proof (X students completed). Students who complete the
 * daily challenge are 3x more likely to continue into a full session.
 */

interface DailyChallengeProps {
  isHi: boolean;
  studentName: string;
  streak: number;
  grade: string;
}

// Rotating challenges — one per day, deterministic by date
const CHALLENGES = [
  { type: 'speed', icon: '⚡', label: 'Speed Round', labelHi: 'स्पीड राउंड', desc: '5 questions in 3 minutes. How fast can you go?', descHi: '3 मिनट में 5 सवाल। कितनी तेज़ हो तुम?' },
  { type: 'streak_saver', icon: '🔥', label: 'Keep the Fire', labelHi: 'आग जलाए रखो', desc: 'Answer 3 in a row to protect your streak.', descHi: '3 लगातार सही जवाब दो — स्ट्रीक बचाओ।' },
  { type: 'mystery', icon: '🎲', label: 'Mystery Topic', labelHi: 'रहस्य विषय', desc: 'Foxy picks a surprise topic for you. Ready?', descHi: 'Foxy ने एक सरप्राइज़ विषय चुना है। तैयार?' },
  { type: 'weak_spot', icon: '🎯', label: 'Fix Your Gap', labelHi: 'कमज़ोरी ठीक करो', desc: 'One weak topic. Five targeted questions. Let\'s fix it.', descHi: 'एक कमज़ोर टॉपिक। पाँच सवाल। ठीक करते हैं।' },
  { type: 'boss', icon: '👑', label: 'Boss Level', labelHi: 'बॉस लेवल', desc: '3 hard questions. Get them all right for bonus XP.', descHi: '3 कठिन सवाल। सब सही करो, बोनस XP पाओ।' },
  { type: 'revision', icon: '🧠', label: 'Memory Check', labelHi: 'याददाश्त जाँचो', desc: 'Can you still remember what you learned this week?', descHi: 'इस हफ़्ते जो सीखा, वो याद है?' },
  { type: 'climb', icon: '🏔️', label: 'Rank Climber', labelHi: 'रैंक चढ़ो', desc: 'Beat your best score to climb the leaderboard.', descHi: 'अपना रिकॉर्ड तोड़ो, लीडरबोर्ड पर चढ़ो।' },
];

function getTodayChallenge(): typeof CHALLENGES[number] {
  const dayIndex = Math.floor(Date.now() / 86400000) % CHALLENGES.length;
  return CHALLENGES[dayIndex];
}

function getGreeting(isHi: boolean): string {
  const hour = new Date().getHours();
  if (hour < 12) return isHi ? 'सुप्रभात' : 'Good morning';
  if (hour < 17) return isHi ? 'नमस्ते' : 'Good afternoon';
  return isHi ? 'शुभ संध्या' : 'Good evening';
}

function getMotivation(streak: number, isHi: boolean): string {
  if (streak >= 30) return isHi ? '🔥 तुम रुक नहीं सकते!' : '🔥 You\'re unstoppable!';
  if (streak >= 7) return isHi ? '💪 शानदार लय!' : '💪 Great rhythm!';
  if (streak >= 3) return isHi ? '👏 बढ़ते रहो!' : '👏 Keep it up!';
  if (streak >= 1) return isHi ? '🌱 शुरुआत अच्छी है!' : '🌱 Good start!';
  return isHi ? '🦊 आज शुरू करो!' : '🦊 Start today!';
}

export default function DailyChallenge({ isHi, studentName, streak, grade }: DailyChallengeProps) {
  const router = useRouter();
  const challenge = getTodayChallenge();
  const greeting = getGreeting(isHi);
  const motivation = getMotivation(streak, isHi);
  const [completed, setCompleted] = useState(false);
  const firstName = studentName?.split(' ')[0] || '';

  // Check if already completed today (localStorage for simplicity)
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const key = `daily_challenge_${today}`;
    if (localStorage.getItem(key)) setCompleted(true);
  }, []);

  if (completed) {
    return (
      <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.15)' }}>
        <span className="text-2xl">✅</span>
        <div>
          <div className="text-sm font-bold" style={{ color: '#16A34A' }}>
            {isHi ? 'आज का चैलेंज पूरा!' : 'Daily challenge complete!'}
          </div>
          <div className="text-xs text-[var(--text-3)]">
            {isHi ? 'कल नया चैलेंज आएगा।' : 'New challenge tomorrow.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Personal greeting — the first thing they see */}
      <div className="mb-3">
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {greeting}, {firstName}! {motivation}
        </h2>
      </div>

      {/* Daily Challenge Card — the hook */}
      <button
        onClick={() => router.push('/quiz?mode=practice&challenge=daily')}
        className="w-full text-left rounded-2xl p-4 transition-all active:scale-[0.98]"
        style={{
          background: 'linear-gradient(135deg, #1a120810, #E8581C08)',
          border: '1.5px solid rgba(232,88,28,0.2)',
          boxShadow: '0 4px 20px rgba(232,88,28,0.06)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
              style={{ background: 'rgba(232,88,28,0.1)' }}>
              {challenge.icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(232,88,28,0.1)', color: 'var(--orange)' }}>
                  {isHi ? 'आज का चैलेंज' : 'TODAY\'S CHALLENGE'}
                </span>
              </div>
              <div className="text-sm font-bold mt-1">
                {isHi ? challenge.labelHi : challenge.label}
              </div>
              <div className="text-xs text-[var(--text-3)] mt-0.5">
                {isHi ? challenge.descHi : challenge.desc}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
            <span className="text-xl" style={{ color: 'var(--orange)' }}>→</span>
            <span className="text-[9px] font-bold" style={{ color: 'var(--orange)' }}>+25 XP</span>
          </div>
        </div>
      </button>
    </div>
  );
}
