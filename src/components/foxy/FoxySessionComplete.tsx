'use client';

import { SessionComplete } from '@/components/ui';

/**
 * FoxySessionComplete — Shown after a Foxy learning session ends.
 * Celebrates progress, shows XP, suggests next action.
 */

interface FoxySessionCompleteProps {
  isHi: boolean;
  xpEarned: number;
  messagesCount: number;
  topicTitle?: string;
  onContinue: () => void;
  onGoHome: () => void;
}

export default function FoxySessionComplete({
  isHi,
  xpEarned,
  messagesCount,
  topicTitle,
  onContinue,
  onGoHome,
}: FoxySessionCompleteProps) {
  const foxyMessage = topicTitle
    ? (isHi ? `"${topicTitle}" पर बढ़िया काम!` : `Great work on "${topicTitle}"!`)
    : (isHi ? 'बढ़िया सत्र! तुम सीख रहे हो।' : 'Great session! You\'re learning.');

  return (
    <div className="min-h-dvh flex items-center justify-center px-5">
      <SessionComplete
        title={isHi ? 'सत्र पूरा!' : 'Session Complete!'}
        xpEarned={xpEarned}
        foxyMessage={foxyMessage}
        stats={[
          { label: isHi ? 'संवाद' : 'Exchanges', value: messagesCount },
        ]}
        primaryAction={{
          label: isHi ? 'और सीखो' : 'Continue Learning',
          onClick: onContinue,
        }}
        secondaryAction={{
          label: isHi ? 'होम जाओ' : 'Go Home',
          onClick: onGoHome,
        }}
      />
    </div>
  );
}
