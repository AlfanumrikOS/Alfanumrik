'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { shareResult, challengeInviteMessage, challengeResultMessage } from '@/lib/share';
import { SUBJECT_META, GRADE_SUBJECTS } from '@/lib/constants';
import { Card, Button, Badge, Avatar, EmptyState, LoadingFoxy, SubjectChip } from '@/components/ui';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import type { QuizChallenge, ChallengeStatus } from '@/lib/types';

/* ═══════════════════════════════════════════════════════════════
   CHALLENGE MODE — Quiz Battles Between Students
   Viral growth feature: students challenge friends via WhatsApp.
   ═══════════════════════════════════════════════════════════════ */

interface ChallengeModeProps {
  studentId: string;
  studentName: string;
  grade: string;
  isHi: boolean;
}

type View = 'feed' | 'create' | 'waiting' | 'results';

const QUESTION_COUNTS = [5, 10, 15] as const;

const STATUS_CONFIG: Record<ChallengeStatus, { label: string; labelHi: string; color: string; icon: string }> = {
  pending:   { label: 'Waiting',   labelHi: 'प्रतीक्षा',  color: '#D97706', icon: '⏳' },
  active:    { label: 'In Progress', labelHi: 'चल रहा है', color: '#2563EB', icon: '⚔️' },
  completed: { label: 'Completed', labelHi: 'पूर्ण',      color: '#16A34A', icon: '✅' },
  expired:   { label: 'Expired',   labelHi: 'समाप्त',     color: '#9CA3AF', icon: '⌛' },
};

export default function ChallengeMode({ studentId, studentName, grade, isHi }: ChallengeModeProps) {
  const [view, setView] = useState<View>('feed');
  const [challenges, setChallenges] = useState<QuizChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [selectedChallenge, setSelectedChallenge] = useState<QuizChallenge | null>(null);

  // Create form state
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState<number>(10);

  const availableSubjects = (GRADE_SUBJECTS[grade] || GRADE_SUBJECTS['9'])
    .map(code => SUBJECT_META.find(s => s.code === code))
    .filter(Boolean) as typeof SUBJECT_META[number][];

  // ─── Load challenges ───
  const loadChallenges = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('quiz_challenges')
        .select('*')
        .or(`challenger_id.eq.${studentId},opponent_id.eq.${studentId},and(status.eq.pending,opponent_id.is.null)`)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setChallenges((data as QuizChallenge[]) ?? []);
    } catch (e) {
      console.error('Failed to load challenges:', e);
      setChallenges([]);
    }
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    loadChallenges();
  }, [loadChallenges]);

  // ─── Create challenge ───
  const handleCreateChallenge = async () => {
    if (!selectedSubject) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.rpc('create_challenge', {
        p_student_id: studentId,
        p_subject: selectedSubject,
        p_grade: grade,
        p_question_count: questionCount,
        p_opponent_id: null,
      });

      if (error) throw error;

      const challenge = data as QuizChallenge;

      // Share the challenge via WhatsApp
      if (challenge?.share_code) {
        const subjectName = SUBJECT_META.find(s => s.code === selectedSubject)?.name ?? selectedSubject;
        await shareResult(challengeInviteMessage({
          studentName,
          subject: subjectName,
          shareCode: challenge.share_code,
          isHi,
        }));
      }

      setView('feed');
      setSelectedSubject(null);
      setQuestionCount(10);
      await loadChallenges();
    } catch (e) {
      console.error('Failed to create challenge:', e);
    }
    setCreating(false);
  };

  // ─── Join challenge by code ───
  const handleJoinChallenge = async () => {
    if (!joinCode.trim()) return;
    setJoining(true);
    setJoinError('');
    try {
      const { data, error } = await supabase.rpc('join_challenge', {
        p_student_id: studentId,
        p_share_code: joinCode.trim().toLowerCase(),
      });

      if (error) throw error;

      if (!data) {
        setJoinError(isHi ? 'चैलेंज नहीं मिला या समाप्त हो गया' : 'Challenge not found or expired');
      } else {
        setJoinCode('');
        setJoinError('');
        await loadChallenges();
      }
    } catch {
      setJoinError(isHi ? 'चैलेंज जॉइन करने में समस्या' : 'Failed to join challenge');
    }
    setJoining(false);
  };

  // ─── View challenge results ───
  const handleViewResults = (challenge: QuizChallenge) => {
    setSelectedChallenge(challenge);
    setView('results');
  };

  // ─── Share result ───
  const handleShareResult = async (challenge: QuizChallenge) => {
    const iAmChallenger = challenge.challenger_id === studentId;
    const myScore = iAmChallenger ? challenge.challenger_score : challenge.opponent_score;
    const theirScore = iAmChallenger ? challenge.opponent_score : challenge.challenger_score;
    const won = challenge.winner_id === studentId;
    const opponentName = iAmChallenger
      ? (challenge.opponent_name ?? (isHi ? 'प्रतिद्वंदी' : 'Opponent'))
      : (challenge.challenger_name ?? (isHi ? 'चैलेंजर' : 'Challenger'));
    const subjectName = SUBJECT_META.find(s => s.code === challenge.subject)?.name ?? challenge.subject;

    await shareResult(challengeResultMessage({
      studentName,
      subject: subjectName,
      won,
      myScore: myScore ?? 0,
      opponentScore: theirScore ?? 0,
      opponentName,
      isHi,
    }));
  };

  // ─── Categorize challenges ───
  const myChallenges = challenges.filter(c =>
    c.challenger_id === studentId || c.opponent_id === studentId
  );
  const openChallenges = challenges.filter(c =>
    c.status === 'pending' && c.opponent_id === null && c.challenger_id !== studentId
  );

  // ─── FEED VIEW ───
  if (view === 'create') {
    return (
      <div className="space-y-5 animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView('feed')}
            className="rounded-xl p-2.5 transition-all"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            aria-label={isHi ? 'वापस जाएं' : 'Go back'}
          >
            <span className="text-lg">←</span>
          </button>
          <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'नया चैलेंज बनाओ' : 'Create Challenge'}
          </h2>
        </div>

        {/* Subject selection */}
        <Card>
          <p className="text-sm font-semibold text-[var(--text-2)] mb-3">
            {isHi ? 'विषय चुनो' : 'Pick a Subject'}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {availableSubjects.map(sub => (
              <SubjectChip
                key={sub.code}
                icon={sub.icon}
                name={isHi ? sub.name : sub.name}
                color={sub.color}
                active={selectedSubject === sub.code}
                onClick={() => setSelectedSubject(sub.code)}
                size="sm"
              />
            ))}
          </div>
        </Card>

        {/* Question count */}
        <Card>
          <p className="text-sm font-semibold text-[var(--text-2)] mb-3">
            {isHi ? 'सवालों की संख्या' : 'Number of Questions'}
          </p>
          <div className="flex gap-2">
            {QUESTION_COUNTS.map(count => (
              <button
                key={count}
                onClick={() => setQuestionCount(count)}
                className="flex-1 rounded-xl py-3 text-center font-bold text-sm transition-all"
                style={{
                  background: questionCount === count ? 'var(--orange)' : 'var(--surface-2)',
                  color: questionCount === count ? '#fff' : 'var(--text-2)',
                  border: `1.5px solid ${questionCount === count ? 'var(--orange)' : 'var(--border)'}`,
                }}
              >
                {count}
              </button>
            ))}
          </div>
        </Card>

        {/* Create button */}
        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={!selectedSubject || creating}
          onClick={handleCreateChallenge}
        >
          {creating
            ? (isHi ? 'बना रहे हैं...' : 'Creating...')
            : (isHi ? '⚔️ चैलेंज बनाओ और शेयर करो' : '⚔️ Create & Share Challenge')
          }
        </Button>

        <p className="text-xs text-center text-[var(--text-3)]">
          {isHi
            ? 'एक लिंक बनेगा जो आप WhatsApp पर शेयर कर सकते हैं'
            : 'A link will be created that you can share on WhatsApp'
          }
        </p>
      </div>
    );
  }

  // ─── RESULTS VIEW ───
  if (view === 'results' && selectedChallenge) {
    const c = selectedChallenge;
    const iAmChallenger = c.challenger_id === studentId;
    const myScore = iAmChallenger ? c.challenger_score : c.opponent_score;
    const myTime = iAmChallenger ? c.challenger_time : c.opponent_time;
    const theirScore = iAmChallenger ? c.opponent_score : c.challenger_score;
    const theirTime = iAmChallenger ? c.opponent_time : c.challenger_time;
    const won = c.winner_id === studentId;
    const isDraw = c.status === 'completed' && !c.winner_id;
    const myName = studentName;
    const theirName = iAmChallenger
      ? (c.opponent_name ?? (isHi ? 'प्रतिद्वंदी' : 'Opponent'))
      : (c.challenger_name ?? (isHi ? 'चैलेंजर' : 'Challenger'));
    const subjectMeta = SUBJECT_META.find(s => s.code === c.subject);

    return (
      <div className="space-y-5 animate-fade-in">
        {/* Back button */}
        <button
          onClick={() => { setView('feed'); setSelectedChallenge(null); }}
          className="rounded-xl p-2.5 transition-all"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          aria-label={isHi ? 'वापस जाएं' : 'Go back'}
        >
          <span className="text-lg">←</span>
        </button>

        {/* Winner announcement */}
        <div className="text-center py-4">
          <div className="text-5xl mb-3 animate-bounce-once">
            {won ? '🏆' : isDraw ? '🤝' : '💪'}
          </div>
          <h2 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {won
              ? (isHi ? 'तुम जीत गए!' : 'You Won!')
              : isDraw
                ? (isHi ? 'बराबरी!' : 'It\'s a Draw!')
                : (isHi ? 'अगली बार जीतोगे!' : 'Better Luck Next Time!')
            }
          </h2>
          {won && (
            <p className="text-sm font-bold mt-1" style={{ color: 'var(--orange)' }}>
              +25 XP {isHi ? 'चैलेंज जीत!' : 'Challenge Win!'}
            </p>
          )}
          {subjectMeta && (
            <Badge color={subjectMeta.color} size="sm">
              {subjectMeta.icon} {subjectMeta.name}
            </Badge>
          )}
        </div>

        {/* Side-by-side scores */}
        <Card className="!p-0 overflow-hidden">
          <div className="grid grid-cols-2 divide-x" style={{ borderColor: 'var(--border)' }}>
            {/* My side */}
            <div className={`p-4 text-center ${won ? 'bg-gradient-to-b from-orange-50 to-transparent' : ''}`}>
              <Avatar name={myName} size={44} />
              <p className="text-sm font-bold mt-2 truncate">{myName}</p>
              <p className="text-xs text-[var(--text-3)]">{isHi ? 'तुम' : 'You'}</p>
              <div className="text-3xl font-bold mt-3" style={{ color: 'var(--orange)', fontFamily: 'var(--font-display)' }}>
                {myScore ?? '—'}%
              </div>
              {myTime != null && (
                <p className="text-xs text-[var(--text-3)] mt-1">
                  {Math.floor(myTime / 60)}:{String(myTime % 60).padStart(2, '0')}
                </p>
              )}
            </div>

            {/* Their side */}
            <div className={`p-4 text-center ${!won && !isDraw ? 'bg-gradient-to-b from-purple-50 to-transparent' : ''}`}>
              <Avatar name={theirName} size={44} />
              <p className="text-sm font-bold mt-2 truncate">{theirName}</p>
              <p className="text-xs text-[var(--text-3)]">{isHi ? 'प्रतिद्वंदी' : 'Opponent'}</p>
              <div className="text-3xl font-bold mt-3" style={{ color: 'var(--purple, #7C3AED)', fontFamily: 'var(--font-display)' }}>
                {theirScore ?? '—'}%
              </div>
              {theirTime != null && (
                <p className="text-xs text-[var(--text-3)] mt-1">
                  {Math.floor(theirTime / 60)}:{String(theirTime % 60).padStart(2, '0')}
                </p>
              )}
            </div>
          </div>
        </Card>

        {/* Actions */}
        <div className="space-y-2">
          <Button
            variant="primary"
            fullWidth
            onClick={() => handleShareResult(c)}
          >
            {isHi ? '📤 WhatsApp पर शेयर करो' : '📤 Share on WhatsApp'}
          </Button>
          <Button
            variant="soft"
            fullWidth
            color="var(--purple, #7C3AED)"
            onClick={() => {
              setSelectedSubject(c.subject);
              setQuestionCount(c.question_count);
              setView('create');
            }}
          >
            {isHi ? '🔄 रीमैच' : '🔄 Rematch'}
          </Button>
        </div>
      </div>
    );
  }

  // ─── FEED VIEW (default) ───
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? '⚔️ चैलेंज मोड' : '⚔️ Challenge Mode'}
          </h1>
          <p className="text-sm text-[var(--text-3)]">
            {isHi ? 'दोस्तों को क्विज़ बैटल में चुनौती दो!' : 'Challenge friends to quiz battles!'}
          </p>
        </div>
      </div>

      {/* Create new challenge CTA */}
      <button
        onClick={() => setView('create')}
        className="w-full rounded-2xl p-5 text-left transition-all active:scale-[0.98]"
        style={{
          background: 'linear-gradient(135deg, #FFF7ED, #F5E6FF)',
          border: '1.5px solid rgba(232,88,28,0.2)',
        }}
      >
        <div className="flex items-center gap-3">
          <span className="text-3xl">⚔️</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-[var(--text-1)]">
              {isHi ? 'नया चैलेंज बनाओ' : 'Create New Challenge'}
            </p>
            <p className="text-xs text-[var(--text-3)] mt-0.5">
              {isHi ? 'WhatsApp पर शेयर करो और दोस्तों को हराओ' : 'Share on WhatsApp and beat your friends'}
            </p>
          </div>
          <span className="text-lg">→</span>
        </div>
      </button>

      {/* Join by code */}
      <SectionErrorBoundary section="Join Challenge">
        <Card>
          <p className="text-sm font-semibold text-[var(--text-2)] mb-2">
            {isHi ? 'कोड से जॉइन करो' : 'Join by Code'}
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => { setJoinCode(e.target.value); setJoinError(''); }}
              placeholder={isHi ? 'चैलेंज कोड डालो' : 'Enter challenge code'}
              className="input-base flex-1"
              maxLength={16}
            />
            <Button
              variant="primary"
              size="sm"
              disabled={!joinCode.trim() || joining}
              onClick={handleJoinChallenge}
            >
              {joining ? '...' : (isHi ? 'जॉइन' : 'Join')}
            </Button>
          </div>
          {joinError && (
            <p className="text-xs mt-1.5 font-medium" style={{ color: '#DC2626' }} role="alert">
              {joinError}
            </p>
          )}
        </Card>
      </SectionErrorBoundary>

      {/* Open challenges from others */}
      {openChallenges.length > 0 && (
        <SectionErrorBoundary section="Open Challenges">
          <div>
            <h2 className="text-sm font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">
              {isHi ? '🌐 ओपन चैलेंज' : '🌐 Open Challenges'}
            </h2>
            <div className="space-y-2">
              {openChallenges.map(c => (
                <ChallengeCard
                  key={c.id}
                  challenge={c}
                  studentId={studentId}
                  isHi={isHi}
                  onAccept={async () => {
                    try {
                      await supabase.rpc('join_challenge', {
                        p_student_id: studentId,
                        p_share_code: c.share_code,
                      });
                      await loadChallenges();
                    } catch (e) {
                      console.error('Failed to accept challenge:', e);
                    }
                  }}
                />
              ))}
            </div>
          </div>
        </SectionErrorBoundary>
      )}

      {/* My challenges */}
      <SectionErrorBoundary section="My Challenges">
        <div>
          <h2 className="text-sm font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">
            {isHi ? '📋 मेरे चैलेंज' : '📋 My Challenges'}
          </h2>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="skeleton skeleton-card" style={{ height: 80 }} />
              ))}
            </div>
          ) : myChallenges.length === 0 ? (
            <EmptyState
              icon="⚔️"
              title={isHi ? 'कोई चैलेंज नहीं' : 'No Challenges Yet'}
              description={isHi ? 'नया चैलेंज बनाओ और दोस्तों को बुलाओ!' : 'Create a challenge and invite your friends!'}
            />
          ) : (
            <div className="space-y-2">
              {myChallenges.map(c => (
                <ChallengeCard
                  key={c.id}
                  challenge={c}
                  studentId={studentId}
                  isHi={isHi}
                  onView={() => handleViewResults(c)}
                  onShare={c.status === 'pending' && c.challenger_id === studentId
                    ? async () => {
                        if (!c.share_code) return;
                        const subjectName = SUBJECT_META.find(s => s.code === c.subject)?.name ?? c.subject;
                        await shareResult(challengeInviteMessage({
                          studentName,
                          subject: subjectName,
                          shareCode: c.share_code,
                          isHi,
                        }));
                      }
                    : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      </SectionErrorBoundary>
    </div>
  );
}

/* ─── Challenge Card ─────────────────────────────────────────── */

interface ChallengeCardProps {
  challenge: QuizChallenge;
  studentId: string;
  isHi: boolean;
  onAccept?: () => void;
  onView?: () => void;
  onShare?: () => void;
}

function ChallengeCard({ challenge, studentId, isHi, onAccept, onView, onShare }: ChallengeCardProps) {
  const c = challenge;
  const status = STATUS_CONFIG[c.status];
  const subjectMeta = SUBJECT_META.find(s => s.code === c.subject);
  const iAmChallenger = c.challenger_id === studentId;
  const opponentLabel = iAmChallenger
    ? (c.opponent_name ?? (c.opponent_id ? (isHi ? 'प्रतिद्वंदी' : 'Opponent') : (isHi ? 'कोई भी' : 'Anyone')))
    : (c.challenger_name ?? (isHi ? 'चैलेंजर' : 'Challenger'));

  const timeAgo = c.created_at ? getTimeAgo(c.created_at, isHi) : '';

  return (
    <Card
      hoverable={c.status === 'completed'}
      onClick={c.status === 'completed' ? onView : undefined}
      className="!p-3.5"
    >
      <div className="flex items-center gap-3">
        {/* Subject icon */}
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
          style={{ background: subjectMeta ? `${subjectMeta.color}15` : 'var(--surface-2)' }}
        >
          {subjectMeta?.icon ?? '📝'}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold truncate">
              {subjectMeta?.name ?? c.subject}
            </p>
            <Badge color={status.color} size="sm">
              {status.icon} {isHi ? status.labelHi : status.label}
            </Badge>
          </div>
          <p className="text-xs text-[var(--text-3)] mt-0.5">
            {isHi ? 'बनाम' : 'vs'} {opponentLabel} · {c.question_count} {isHi ? 'सवाल' : 'Q'}
            {timeAgo && ` · ${timeAgo}`}
          </p>

          {/* Scores for completed */}
          {c.status === 'completed' && c.challenger_score != null && c.opponent_score != null && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs font-bold" style={{ color: iAmChallenger ? 'var(--orange)' : 'var(--text-2)' }}>
                {iAmChallenger ? c.challenger_score : c.opponent_score}%
              </span>
              <span className="text-xs text-[var(--text-3)]">vs</span>
              <span className="text-xs font-bold" style={{ color: !iAmChallenger ? 'var(--orange)' : 'var(--text-2)' }}>
                {iAmChallenger ? c.opponent_score : c.challenger_score}%
              </span>
              {c.winner_id === studentId && (
                <span className="text-xs">🏆</span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex-shrink-0">
          {c.status === 'pending' && !iAmChallenger && c.opponent_id === null && onAccept && (
            <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); onAccept(); }}>
              {isHi ? 'स्वीकार' : 'Accept'}
            </Button>
          )}
          {c.status === 'pending' && iAmChallenger && onShare && (
            <Button variant="soft" size="sm" color="var(--orange)" onClick={(e) => { e.stopPropagation(); onShare(); }}>
              {isHi ? 'शेयर' : 'Share'}
            </Button>
          )}
          {c.status === 'completed' && (
            <span className="text-lg">→</span>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ─── Time Ago Helper ──────────────────────────────────── */

function getTimeAgo(dateStr: string, isHi: boolean): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return isHi ? 'अभी' : 'now';
  if (mins < 60) return isHi ? `${mins} मिनट पहले` : `${mins}m ago`;
  if (hrs < 24) return isHi ? `${hrs} घंटे पहले` : `${hrs}h ago`;
  return isHi ? `${days} दिन पहले` : `${days}d ago`;
}
