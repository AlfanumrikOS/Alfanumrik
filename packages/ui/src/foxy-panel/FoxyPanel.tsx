'use client';

/** 
 * FoxyPanel — the slim, embeddable Foxy chat surface.
 * 
 * Renders a contextual chat column for embed contexts:
 *   - 'today'          → dashboard "Ask Foxy" tap-gated panel
 *   - 'learn'          → learn chapter page (pre-filled subject/chapter)
 *   - 'quiz-results'   → post-quiz-review "Ask Foxy about the missed Q"
 */

import { useEffect, useRef, useCallback } from 'react';
import { useFoxyChat, type FoxySendPayload } from './useFoxyChat';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { speak } from '@alfanumrik/lib/voice';
import { usePythonVoiceEnabled } from '@alfanumrik/lib/voice-feature-flag';
import type { LearningActionType } from '@alfanumrik/ui/foxy/ChatBubble';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';

export type FoxyPanelContext = 'today' | 'learn' | 'quiz-results' | 'full';
export type FoxyPanelMode = 'learn' | 'explain' | 'practice' | 'revise' | 'doubt' | 'homework' | 'explorer';

export interface FoxyPanelProps {
  subject: string;
  grade: string;
  chapter?: string | null;
  mode?: FoxyPanelMode;
  context: FoxyPanelContext;
  initialPrompt?: string;
  isHi: boolean;
  language: string;
  studentId?: string;
  studentName?: string;
  onClose?: () => void;
  subjectColor?: string;
  voiceMode?: boolean;
}

const STARTER_INTENTS = [
  { key: 'quiz', en: 'Quiz on this', hi: 'इस पर क्विज़', icon: '📝' },
  { key: 'formula', en: 'Formula sheet', hi: 'सूत्र पुस्तिका', icon: '📐' },
  { key: 'weak_areas', en: 'My weak areas', hi: 'मेरी कमज़ोर जगहें', icon: '🎯' },
  { key: 'experiment', en: 'Explain with experiment', hi: 'प्रयोग से समझाओ', icon: '🧪' },
  { key: 'real_world', en: 'Real world examples', hi: 'असल दुनिया के उदाहरण', icon: '🌍' },
  { key: 'diagram', en: 'Diagram explanation', hi: 'चित्र समझाओ', icon: '🖼️' },
] as const;

export default function FoxyPanel({
  subject,
  grade,
  chapter,
  mode = 'doubt',
  context,
  initialPrompt,
  isHi,
  language,
  studentId,
  studentName,
  onClose,
  subjectColor = '#F97316',
  voiceMode = false,
}: FoxyPanelProps) {
  const { isHi: authIsHi } = useAuth();
  const effectiveIsHi = isHi ?? authIsHi ?? false;
  const chat = useFoxyChat();
  const { subjects: allowedSubjects } = useAllowedSubjects();
  const speakCancelRef = useRef<{ cancel: () => void } | null>(null);
  const pythonVoiceEnabled = usePythonVoiceEnabled(studentId ?? null);
  const subjectCodeByName: Record<string, string> = {};
  for (const s of allowedSubjects) subjectCodeByName[s.name] = s.code;

  // Fire the initial prompt exactly once on mount when present.
  useEffect(() => {
    if (!initialPrompt || !initialPrompt.trim()) return;
    const payload: FoxySendPayload = {
      message: initialPrompt,
      studentId,
      studentName,
      grade,
      subject,
      language,
      mode,
      chapter: chapter ?? null,
    };
    void chat.sendMessage(payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = useCallback((text: string, image?: File | null) => {
    void chat.sendMessage({
      message: text,
      imageFile: image ?? null,
      studentId,
      studentName,
      grade,
      subject,
      language,
      mode,
      chapter: chapter ?? null,
    });
  }, [chat, studentId, studentName, grade, subject, language, mode, chapter]);

  const handleSpeak = useCallback((text: string) => {
    speakCancelRef.current?.cancel();
    speak(text, {
      language: language === 'hi' ? 'hi-IN' : 'en-IN',
      rate: 0.9,
      pythonEnabled: pythonVoiceEnabled,
    });
  }, [language, pythonVoiceEnabled]);

  const handleLearningAction = useCallback((msg: import('./foxy-types').ChatMessage, action: LearningActionType) => {
    chat.recordLearningAction?.({ messageId: msg.persistedMessageId ?? String(msg.id), actionType: action });
    // Re-send last tutor message with the matching coachDirective for re-teach/quiz
    if (action === 'quiz_me' || action === 'explain_simpler' || action === 'show_example') {
      const lastTutorMsg = [...chat.messages].reverse().find(m => m.role === 'tutor' && m.content && m.content !== 'Oops! Please try again.');
      if (lastTutorMsg) {
        const directiveMap: Record<LearningActionType, string | undefined> = {
          quiz_me: 'quiz_me',
          explain_simpler: 'simplify',
          show_example: 'example',
          got_it: undefined,
          give_hint: undefined,
          let_me_try: undefined,
          save: undefined,
        };
        const directive = directiveMap[action];
        if (directive) {
          void chat.sendMessage({
            message: lastTutorMsg.content,
            studentId,
            studentName,
            grade,
            subject,
            language,
            mode: 'practice',
            coachDirective: directive as import('./foxy-types').CoachDirective,
            chapter: chapter ?? null,
          });
        }
      }
    } else if (action === 'save') {
      // Save to notebook — record the action (backend handles bookmarking)
      chat.recordLearningAction?.({ messageId: msg.persistedMessageId ?? String(msg.id), actionType: action });
    }
  }, [chat, studentId, studentName, grade, subject, language, chapter]);

  const handleStarterIntent = useCallback((intent: string, topicText?: string) => {
    const promptMap: Record<string, { en: string; hi: string }> = {
      quiz: {
        en: 'Give me a quick quiz on this topic with 5 multiple choice questions.',
        hi: 'इस topic पर 5 बहु-विकल्प प्रश्नों का क्विज़ दो।',
      },
      formula: {
        en: 'Show me a formula sheet for this topic with all important formulas and when to use each one.',
        hi: 'इस topic की सूत्र पुस्तिका दिखाओ — सभी जरूरी सूत्र और हर एक का उपयोग कहाँ करना है।',
      },
      weak_areas: {
        en: 'What are my weak areas in this topic? Show me what I need to focus on.',
        hi: 'इस topic में मेरी कमज़ोर जगहें कौन सी हैं? दिखाओ कि मुझे किसको सुधारने की जरूरत है।',
      },
      experiment: {
        en: 'Explain this concept using a real experiment or demonstration that I can visualize.',
        hi: 'इस concept को एक असल प्रयोग या demonstration से समझाओ जिसे मैं visualize कर सकूँ।',
      },
      real_world: {
        en: 'Give me real-world examples of this concept that I can relate to in everyday life.',
        hi: 'इस concept के असल दुनिया के उदाहरण दो जो मैं रोज़मर्रा की ज़िंदगी से जोड़ सकूँ।',
      },
      diagram: {
        en: 'Explain this concept with a diagram — show me a labelled figure and walk me through it.',
        hi: 'इस concept को एक चित्र के साथ समझाओ — एक labelled figure दिखाओ और उसे step by step समझाओ।',
      },
    };
    const label = promptMap[intent];
    const prompt = label ? (effectiveIsHi ? label.hi : label.en) : intent;
    void chat.sendMessage({
      message: prompt,
      studentId,
      studentName,
      grade,
      subject,
      language,
      mode: 'learn',
      chapter: chapter ?? null,
      intent,
    });
  }, [chat, studentId, studentName, grade, subject, language, chapter, effectiveIsHi]);

  const handleSubmitQuizAnswer = chat.submitQuizAnswer.bind(chat);

  return (
    <div
      className="flex flex-col h-full min-h-0 rounded-2xl overflow-hidden"
      style={{ background: 'var(--surface-0)', border: '1px solid var(--border)' }}
      data-testid="foxy-panel"
      data-context={context}
    >
      {/* Header — subject chip + optional close + Stop button when loading */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
            style={{
              background: `${subjectColor}15`,
              color: subjectColor,
              border: `1px solid ${subjectColor}30`,
            }}
          >
            🦊 {subject}
            {chapter ? <span className="opacity-70"> · {chapter}</span> : null}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {chat.loading && (
            <button
              onClick={chat.stop}
              aria-label={effectiveIsHi ? 'ज़रूरी बात रुको' : 'Stop speaking'}
              data-testid="foxy-panel-stop"
              className="w-8 h-8 rounded-full flex items-center justify-center text-lg transition-all active:scale-95 disabled:opacity-40"
              style={{ background: 'var(--surface-1)', color: 'var(--text-2)' }}
              title={effectiveIsHi ? 'मदद रोकें' : 'Stop response'}
            >
              ⏹
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              aria-label={effectiveIsHi ? 'बंद करो' : 'Close'}
              data-testid="foxy-panel-close"
              className="w-8 h-8 rounded-full flex items-center justify-center text-lg transition-all active:scale-95"
              style={{ background: 'var(--surface-1)', color: 'var(--text-2)' }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Message stream */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        <MessageList
          messages={chat.messages}
          collapsedAbove={null}
          onSetCollapsedAbove={() => {}}
          activeSubject={subject}
          cfgColor={subjectColor}
          studentName={studentName}
          isHi={effectiveIsHi}
          ttsSupported={true}
          savedMessageIds={new Set()}
          onFeedback={(msgId, isUp) => {/* no-op: feedback saved on full /foxy page */}}
          onReport={(msgId) => {/* no-op: report handled on full /foxy page */}}
          onSaveFlashcard={(msgId, content) => {/* no-op: save handled on full /foxy page */}}
          onSpeak={handleSpeak}
          learningActionsEnabled={true}
          onLearningAction={handleLearningAction}
          onSubmitQuizAnswer={handleSubmitQuizAnswer}
        />
      </div>

      {/* Starter intent pills (for non-chat contexts) */}
      {context !== 'quiz-results' && (
        <div className="border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="flex gap-2 px-3 py-2 overflow-x-auto">
            {STARTER_INTENTS.map((intent) => (
              <button
                key={intent.key}
                onClick={() => handleStarterIntent(intent.key)}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all active:scale-95"
                style={{
                  background: 'var(--surface-1)',
                  color: 'var(--text-2)',
                  border: '1px solid var(--border)',
                }}
                title={effectiveIsHi ? intent.hi : intent.en}
              >
                {intent.icon}
                {effectiveIsHi ? intent.hi : intent.en}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="border-t" style={{ borderColor: 'var(--border)' }}>
        <MessageInput
          messages={chat.messages}
          language={language}
          isHi={effectiveIsHi}
          loading={chat.loading}
          voiceMode={voiceMode}
          activeSubject={subject}
          onSend={handleSend}
          onNewConversation={chat.startNewConversation}
        />
      </div>
    </div>
  );
}
