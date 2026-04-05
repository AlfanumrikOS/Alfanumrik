'use client';

import { useRouter } from 'next/navigation';
import { Card, Button } from '@/components/ui';

type ActionType = 'teach' | 'practice' | 'challenge' | 'revise' | 'remediate' | 'exam_prep';

interface NextActionCardProps {
  action: ActionType;
  conceptId: string | null;
  reason: string;
  isHi: boolean;
  onAction: (action: ActionType, conceptId: string | null) => void;
  /** Number of wrong answers — controls "Review Mistakes" visibility */
  wrongAnswerCount?: number;
  /** Score percentage — controls contextual secondary actions */
  scorePercent?: number;
  /** Subject code — used for deep-linking */
  subject?: string | null;
  /** Retry callback — restarts quiz with same settings */
  onRetry?: () => void;
}

const ACTION_CONFIG: Record<ActionType, {
  icon: string;
  labelEn: string;
  labelHi: string;
  ctaEn: string;
  ctaHi: string;
  color: string;
}> = {
  teach: {
    icon: '\u{1F4D6}',
    labelEn: 'Learn this concept',
    labelHi: '\u092F\u0939 concept \u0938\u0940\u0916\u094B',
    ctaEn: 'Learn with Foxy',
    ctaHi: 'Foxy \u0938\u0947 \u0938\u0940\u0916\u094B',
    color: '#7C3AED',
  },
  practice: {
    icon: '\u270F\uFE0F',
    labelEn: 'Practice more',
    labelHi: '\u0914\u0930 \u0905\u092D\u094D\u092F\u093E\u0938 \u0915\u0930\u094B',
    ctaEn: 'Start Practice',
    ctaHi: '\u0905\u092D\u094D\u092F\u093E\u0938 \u0936\u0941\u0930\u0942 \u0915\u0930\u094B',
    color: '#2563EB',
  },
  challenge: {
    icon: '\u26A1',
    labelEn: 'Ready for a challenge',
    labelHi: 'Challenge \u0915\u0947 \u0932\u093F\u090F \u0924\u0948\u092F\u093E\u0930',
    ctaEn: 'Take Challenge',
    ctaHi: 'Challenge \u0932\u094B',
    color: '#E8581C',
  },
  revise: {
    icon: '\u{1F504}',
    labelEn: 'Time to revise',
    labelHi: 'Revision \u0915\u093E \u0938\u092E\u092F',
    ctaEn: 'Start Revision',
    ctaHi: 'Revision \u0936\u0941\u0930\u0942 \u0915\u0930\u094B',
    color: '#D97706',
  },
  remediate: {
    icon: '\u{1FA7A}',
    labelEn: 'Needs focused review',
    labelHi: '\u0927\u094D\u092F\u093E\u0928 \u0938\u0947 \u092A\u0922\u093C\u094B',
    ctaEn: 'Review with Foxy',
    ctaHi: 'Foxy \u0938\u0947 \u0938\u092E\u091D\u094B',
    color: '#DC2626',
  },
  exam_prep: {
    icon: '\u{1F3AF}',
    labelEn: 'Exam ready!',
    labelHi: 'Exam \u0915\u0947 \u0932\u093F\u090F \u0924\u0948\u092F\u093E\u0930!',
    ctaEn: 'Take Exam Quiz',
    ctaHi: 'Exam Quiz \u0932\u094B',
    color: '#16A34A',
  },
};

/**
 * Displays the CME (Cognitive Mastery Engine) recommendation after quiz completion.
 * Shows what the student should do next based on their mastery data.
 *
 * Assessment owns the action logic and reason text.
 * Frontend owns the card layout and navigation.
 */
export default function NextActionCard({
  action,
  conceptId,
  reason,
  isHi,
  onAction,
  wrongAnswerCount = 0,
  scorePercent,
  subject,
  onRetry,
}: NextActionCardProps) {
  const router = useRouter();
  const config = ACTION_CONFIG[action] || ACTION_CONFIG.practice;

  return (
    <div>
      <p className="text-sm font-semibold text-[var(--text-2)] mb-3">
        {isHi ? '\u{1F9CA} Foxy \u0915\u093E \u0938\u0941\u091D\u093E\u0935' : '\u{1F9CA} Foxy recommends'}
      </p>
      <Card
        accent={config.color}
        className="!p-4"
      >
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div
            className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl"
            style={{
              background: `${config.color}12`,
              border: `1.5px solid ${config.color}30`,
            }}
          >
            {config.icon}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p
              className="text-sm font-bold"
              style={{ color: config.color, fontFamily: 'var(--font-display)' }}
            >
              {isHi ? config.labelHi : config.labelEn}
            </p>

            {/* Reason from CME — displayed as-is (assessment owns this text) */}
            {reason && (
              <p className="text-xs text-[var(--text-3)] mt-1 leading-relaxed">
                {reason}
              </p>
            )}

            {/* CTA button */}
            <Button
              variant="soft"
              size="sm"
              color={config.color}
              className="mt-3"
              onClick={() => onAction(action, conceptId)}
            >
              {config.icon} {isHi ? config.ctaHi : config.ctaEn}
            </Button>
          </div>
        </div>

        {/* Secondary contextual actions */}
        {(wrongAnswerCount > 0 || onRetry) && (
          <div className="mt-3 pt-3 flex flex-wrap gap-2" style={{ borderTop: '1px solid var(--border)' }}>
            {wrongAnswerCount > 0 && (
              <button
                onClick={() => router.push('/review?filter=quiz_wrong_answer')}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all active:scale-95"
                style={{ background: 'rgba(124,58,237,0.08)', color: '#7C3AED' }}
              >
                📝 {isHi ? 'गलतियाँ रिव्यू करो' : 'Review Mistakes'}
              </button>
            )}
            {onRetry && (
              <button
                onClick={onRetry}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all active:scale-95"
                style={{ background: 'rgba(37,99,235,0.08)', color: '#2563EB' }}
              >
                🔄 {isHi ? 'फिर से खेलो' : 'Try Again'}
              </button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
