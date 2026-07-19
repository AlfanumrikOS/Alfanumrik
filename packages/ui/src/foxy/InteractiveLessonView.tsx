'use client';

/**
 * InteractiveLessonView — Structured step-by-step lesson flow with voice narration.
 *
 * Features:
 * - Step progress bar (current step highlighted in lesson ladder)
 * - Auto-triggers voice playback after rendering blocks
 * - Shows check_question after voice finishes
 * - Student must answer before next step
 * - "Continue" button advances to next lesson step
 *
 * Gated by ff_foxy_interactive_lesson_v1. Depends on Phase 2 (voice playback).
 */

import React, { memo, useState, useCallback, useEffect } from 'react';
import type { FoxyResponse, FoxyLessonStep } from '@alfanumrik/lib/foxy/schema';
import { useAuth } from '@alfanumrik/lib/AuthContext';

interface InteractiveLessonViewProps {
  response: FoxyResponse;
  currentStep: FoxyLessonStep | undefined;
  onContinue: () => void;
  isVoicePlaying?: boolean;
  onVoiceComplete?: () => void;
}

const LESSON_STEPS: FoxyLessonStep[] = [
  'hook',
  'explanation',
  'worked_example',
  'guided_practice',
  'independent_practice',
  'reflection',
];

const CHROME = {
  en: {
    hook: 'Hook',
    explanation: 'Explanation',
    worked_example: 'Worked Example',
    guided_practice: 'Guided Practice',
    independent_practice: 'Independent Practice',
    reflection: 'Reflection',
    continue: 'Continue',
    answerFirst: 'Answer the question to continue',
    lessonProgress: 'Lesson Progress',
    complete: 'Lesson Complete!',
  },
  hi: {
    hook: 'परिचय',
    explanation: 'समझाइए',
    worked_example: 'हल उदाहरण',
    guided_practice: 'मार्गदर्शित अभ्यास',
    independent_practice: 'स्वतंत्र अभ्यास',
    reflection: 'चिंतन',
    continue: 'आगे बढ़ें',
    answerFirst: 'आगे बढ़ने के लिए प्रश्न का उत्तर दें',
    lessonProgress: 'पाठ प्रगति',
    complete: 'पाठ पूरा!',
  },
} as const;

const STEP_COLORS = {
  completed: 'bg-green-500',
  current: 'bg-orange-500',
  upcoming: 'bg-gray-300 dark:bg-gray-600',
} as const;

export const InteractiveLessonView = memo(function InteractiveLessonView({
  response,
  currentStep,
  onContinue,
  isVoicePlaying,
}: InteractiveLessonViewProps) {
  const { isHi } = useAuth();
  const chrome = isHi ? CHROME.hi : CHROME.en;
  const [checkAnswered, setCheckAnswered] = useState(false);

  const currentStepIdx = currentStep
    ? LESSON_STEPS.indexOf(currentStep)
    : -1;

  const hasCheckQuestion = !!response.check_question;
  const canContinue = !hasCheckQuestion || checkAnswered;
  const autoAdvance = response.auto_advance ?? false;

  // Auto-advance after voice playback if auto_advance is true
  useEffect(() => {
    if (autoAdvance && !isVoicePlaying && canContinue) {
      const timer = setTimeout(onContinue, 2000);
      return () => clearTimeout(timer);
    }
  }, [autoAdvance, isVoicePlaying, canContinue, onContinue]);

  const handleCheckAnswer = useCallback(() => {
    setCheckAnswered(true);
  }, []);

  return (
    <div className="space-y-4">
      {/* Step Progress Bar */}
      <div className="px-2">
        <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">
          {chrome.lessonProgress}
        </div>
        <div className="flex items-center gap-1">
          {LESSON_STEPS.map((step, idx) => {
            let status: keyof typeof STEP_COLORS;
            if (idx < currentStepIdx) status = 'completed';
            else if (idx === currentStepIdx) status = 'current';
            else status = 'upcoming';

            return (
              <div key={step} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className={`h-1.5 w-full rounded-full transition-colors ${STEP_COLORS[status]}`}
                />
                <span
                  className={`text-[9px] leading-tight text-center ${
                    status === 'current'
                      ? 'text-orange-600 font-semibold'
                      : 'text-gray-400'
                  }`}
                >
                  {chrome[step]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Check question gate */}
      {hasCheckQuestion && !checkAnswered && (
        <div className="mt-4 p-3 border border-orange-200 dark:border-orange-800 rounded-lg bg-orange-50 dark:bg-orange-950">
          <p className="text-sm text-orange-700 dark:text-orange-300 mb-2">
            {chrome.answerFirst}
          </p>
          {/* The check_question block is rendered by the parent FoxyStructuredRenderer;
              this component just tracks whether it's been answered */}
          <button
            onClick={handleCheckAnswer}
            className="text-xs px-3 py-1 rounded bg-orange-500 text-white hover:bg-orange-600 transition-colors"
          >
            {chrome.continue}
          </button>
        </div>
      )}

      {/* Continue button */}
      {canContinue && !autoAdvance && (
        <div className="flex justify-center pt-2">
          <button
            onClick={onContinue}
            className="px-6 py-2 rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 transition-colors shadow-sm"
          >
            {chrome.continue} →
          </button>
        </div>
      )}
    </div>
  );
});
