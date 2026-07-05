'use client';

import { useRouter } from 'next/navigation';
import { Card, Button } from '@/components/ui/primitives';
import { TONE_VAR, type Tone } from '@/components/ui/primitives/tokens';

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
  /** Canonical semantic tone — the accent hue, never a raw hex (DD-16). */
  tone: Tone;
}> = {
  teach: {
    icon: '\u{1F4D6}',
    labelEn: 'Learn this concept',
    labelHi: 'यह concept सीखो',
    ctaEn: 'Learn with Foxy',
    ctaHi: 'Foxy से सीखो',
    tone: 'brand',
  },
  practice: {
    icon: '✏️',
    labelEn: 'Practice more',
    labelHi: 'और अभ्यास करो',
    ctaEn: 'Start Practice',
    ctaHi: 'अभ्यास शुरू करो',
    tone: 'info',
  },
  challenge: {
    icon: '⚡',
    labelEn: 'Ready for a challenge',
    labelHi: 'Challenge के लिए तैयार',
    ctaEn: 'Take Challenge',
    ctaHi: 'Challenge लो',
    tone: 'warning',
  },
  revise: {
    icon: '\u{1F504}',
    labelEn: 'Time to revise',
    labelHi: 'Revision का समय',
    ctaEn: 'Start Revision',
    ctaHi: 'Revision शुरू करो',
    tone: 'warning',
  },
  remediate: {
    icon: '\u{1FA7A}',
    labelEn: 'Needs focused review',
    labelHi: 'ध्यान से पढ़ो',
    ctaEn: 'Review with Foxy',
    ctaHi: 'Foxy से समझो',
    tone: 'danger',
  },
  exam_prep: {
    icon: '\u{1F3AF}',
    labelEn: 'Exam ready!',
    labelHi: 'Exam के लिए तैयार!',
    ctaEn: 'Take Exam Quiz',
    ctaHi: 'Exam Quiz लो',
    tone: 'success',
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
  const toneVar = TONE_VAR[config.tone];

  return (
    <div>
      <p className="text-fluid-sm font-semibold text-muted-foreground mb-3">
        {isHi ? '\u{1F9CA} Foxy का सुझाव' : '\u{1F9CA} Foxy recommends'}
      </p>
      <Card
        variant="flat"
        className="p-4"
        // Tone-accent left border keeps the recommendation legible without
        // painting body text in a low-contrast hue (design-system.md §2/§8).
        style={{ borderInlineStartWidth: 4, borderInlineStartColor: toneVar }}
      >
        <div className="flex items-start gap-3">
          {/* Icon chip — tone tint, decorative */}
          <div
            aria-hidden="true"
            className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl"
            style={{
              background: `color-mix(in srgb, ${toneVar} 12%, transparent)`,
              border: `1.5px solid color-mix(in srgb, ${toneVar} 30%, transparent)`,
            }}
          >
            {config.icon}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="text-fluid-sm font-bold text-foreground">
              {isHi ? config.labelHi : config.labelEn}
            </p>

            {/* Reason from CME — displayed as-is (assessment owns this text) */}
            {reason && (
              <p className="text-fluid-xs text-muted-foreground mt-1 leading-relaxed">
                {reason}
              </p>
            )}

            {/* CTA button — the primary next action */}
            <Button
              variant="primary"
              size="sm"
              className="mt-3"
              leadingIcon={<span>{config.icon}</span>}
              onClick={() => onAction(action, conceptId)}
            >
              {isHi ? config.ctaHi : config.ctaEn}
            </Button>
          </div>
        </div>

        {/* Secondary contextual actions */}
        {(wrongAnswerCount > 0 || onRetry) && (
          <div className="mt-3 pt-3 flex flex-wrap gap-2 border-t border-surface-3">
            {wrongAnswerCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/review?filter=quiz_wrong_answer')}
              >
                📝 {isHi ? 'गलतियाँ रिव्यू करो' : 'Review Mistakes'}
              </Button>
            )}
            {onRetry && (
              <Button variant="ghost" size="sm" onClick={onRetry}>
                🔄 {isHi ? 'फिर से खेलो' : 'Try Again'}
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
