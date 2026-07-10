'use client';

/**
 * FoxyStudySheet — Foxy OS (ff_foxy_os_v1) mobile Study bottom sheet (<lg only).
 *
 * Consolidates the legacy Foxy header rows (subject tabs · chapter dropdown ·
 * mode bar · lesson stepper) into a single bottom sheet built on the shared
 * `SheetModal` primitive (the same one ContextPanel uses).
 *
 * PRESENTATION ONLY. Every action calls an existing handler passed as a prop
 * from /foxy/page.tsx — switchSubject / selectTopic / switchMode / onStartQuiz
 * (preserves P4 quiz routing through /quiz) / advanceLessonStep. No chat /
 * scoring / AI logic lives here. Cosmic light tokens only (no dark mode),
 * CSS-only motion (no framer-motion). Bilingual via `isHi`.
 *
 * Accessibility: SheetModal already provides role="dialog" aria-modal and
 * Escape-to-close. This component fills the remaining gaps — it traps focus
 * within the sheet and returns focus to the element that opened it on close.
 *
 * Lazy-loaded via dynamic() at the call site so the OFF path fetches zero new
 * chunks (P10).
 */

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { SheetModal } from '@alfanumrik/ui/ui';

export interface StudySheetSubject {
  code: string;
  name: string;
  icon: string;
  color: string;
  isLocked?: boolean;
}

export interface StudySheetTopic {
  id: string;
  title: string;
  chapter_number: number | string;
  /** 0–100 mastery, when available. */
  masteryPercent?: number;
  /** Mastery band color, when available. */
  masteryColor?: string;
}

export interface StudySheetMode {
  /** Simplified mode id passed straight back to switchMode. */
  id: string;
  label: string;
  labelHi: string;
  icon: string;
}

export interface StudySheetLesson {
  /** Already-localized step labels, in order. */
  stepLabels: string[];
  /** Index of the current step. */
  currentIndex: number;
  /** Whether the lesson Next button should be enabled. */
  canAdvance: boolean;
  /** Whether the current step is the final one (changes the button copy). */
  isFinalStep: boolean;
  onNext: () => void;
}

interface FoxyStudySheetProps {
  open: boolean;
  onClose: () => void;
  isHi: boolean;

  subjects: StudySheetSubject[];
  activeSubjectCode: string;
  /** Switch subject (page handler). Locked subjects route to onLockedSubject. */
  onSelectSubject: (code: string) => void;
  onLockedSubject: (code: string) => void;

  topics: StudySheetTopic[];
  activeTopicId: string | null;
  onSelectTopic: (topicId: string) => void;

  modes: StudySheetMode[];
  /** Backend session mode (used to highlight the active mode chip). */
  sessionMode: string;
  /** Resolves a simplified mode id to its backend mode for active matching. */
  resolveBackendMode: (id: string) => string;
  subjectColor: string;
  onSelectMode: (id: string) => void;

  /** Dedicated Quiz chip — routes to /quiz via the page handler (preserves P4). */
  onStartQuiz: () => void;

  /** Lesson stepper — present only when the session is in lesson mode. */
  lesson?: StudySheetLesson | null;
}

export function FoxyStudySheet({
  open,
  onClose,
  isHi,
  subjects,
  activeSubjectCode,
  onSelectSubject,
  onLockedSubject,
  topics,
  activeTopicId,
  onSelectTopic,
  modes,
  sessionMode,
  resolveBackendMode,
  subjectColor,
  onSelectMode,
  onStartQuiz,
  lesson,
}: FoxyStudySheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  // Remember the element that had focus when the sheet opened so we can
  // return focus to it on close (SheetModal does not do this for us).
  const triggerRef = useRef<HTMLElement | null>(null);
  // Cached focusable list, computed once per open (Phase 4 optimization — the
  // Tab handler no longer re-queries the DOM on every keydown).
  const focusablesRef = useRef<HTMLElement[]>([]);
  // Subject tablist — drives roving-tabindex arrow-key navigation (Phase 3 a11y).
  const subjectTablistRef = useRef<HTMLDivElement>(null);

  // Left/Right arrow navigation across the subject tabs. Moves DOM focus to the
  // adjacent tab (wrapping at the ends) without activating it — selection still
  // happens on click/Enter/Space via the button's native activation, which calls
  // onSelectSubject. Home/End jump to the first/last tab.
  const onSubjectTabKeyDown = (
    e: ReactKeyboardEvent<HTMLButtonElement>,
    idx: number,
  ) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const tabs = subjectTablistRef.current?.querySelectorAll<HTMLElement>(
      '[data-foxy-os-subject-tab="true"]',
    );
    if (!tabs || tabs.length === 0) return;
    e.preventDefault();
    let next = idx;
    if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    tabs[next]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    const FOCUSABLE_SELECTOR =
      'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])';
    // Compute the focusable list once per open and cache it. The roving-tabindex
    // tablist means tabindex="-1" tabs are correctly excluded at query time.
    const refreshFocusables = () => {
      focusablesRef.current = sheetRef.current
        ? Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        : [];
    };
    // Move focus into the sheet on open, then snapshot the focusable list.
    const id = window.requestAnimationFrame(() => {
      refreshFocusables();
      focusablesRef.current[0]?.focus();
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables = focusablesRef.current;
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      window.cancelAnimationFrame(id);
      document.removeEventListener('keydown', onKeyDown);
      focusablesRef.current = [];
      // Return focus to the trigger.
      triggerRef.current?.focus?.();
    };
  }, [open]);

  return (
    <SheetModal
      open={open}
      onClose={onClose}
      title={isHi ? 'अध्ययन' : 'Study'}
    >
      <div ref={sheetRef} className="foxy-os-study space-y-5">
        {/* ── Subject tabs ───────────────────────────────────── */}
        {/* Phase 3 a11y: a true ARIA tablist. Each subject is role="tab" with
            aria-selected + a roving tabindex (only the active tab is in the Tab
            order); Left/Right arrows move selection between tabs. */}
        <section aria-label={isHi ? 'विषय' : 'Subjects'}>
          <h4 className="foxy-os-study-label" id="foxy-os-subjects-label">
            {isHi ? 'विषय' : 'Subjects'}
          </h4>
          <div
            role="tablist"
            aria-labelledby="foxy-os-subjects-label"
            aria-orientation="horizontal"
            className="flex flex-wrap gap-2"
            ref={subjectTablistRef}
          >
            {subjects.map((sub, idx) => {
              const isActive = sub.code === activeSubjectCode;
              return (
                <button
                  key={sub.code}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  // Roving tabindex: only the selected tab (or the first, when
                  // none match) participates in the page Tab sequence.
                  tabIndex={
                    isActive || (activeSubjectCode == null && idx === 0) ? 0 : -1
                  }
                  data-foxy-os-subject-tab="true"
                  onKeyDown={(e) => onSubjectTabKeyDown(e, idx)}
                  onClick={() => {
                    if (sub.isLocked) onLockedSubject(sub.code);
                    else onSelectSubject(sub.code);
                  }}
                  className="foxy-os-tap-chip flex items-center gap-1.5 rounded-xl text-xs font-bold transition-all active:scale-[0.97]"
                  style={{
                    background: isActive ? `${sub.color}15` : 'var(--surface-2)',
                    border: isActive ? `1.5px solid ${sub.color}40` : '1.5px solid var(--border)',
                    color: isActive ? sub.color : 'var(--text-2)',
                    opacity: sub.isLocked ? 0.55 : 1,
                  }}
                  aria-label={
                    sub.isLocked
                      ? isHi
                        ? `${sub.name} (लॉक — अपग्रेड करें)`
                        : `${sub.name} (locked — tap to upgrade)`
                      : sub.name
                  }
                >
                  <span aria-hidden="true">{sub.icon}</span>
                  <span className="whitespace-nowrap">{sub.name}</span>
                  {sub.isLocked && <span aria-hidden="true" className="text-[10px] leading-none">🔒</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Chapter list ───────────────────────────────────── */}
        <section aria-label={isHi ? 'अध्याय' : 'Chapters'}>
          <h4 className="foxy-os-study-label">{isHi ? 'अध्याय' : 'Chapters'}</h4>
          {topics.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              {isHi ? 'कोई अध्याय उपलब्ध नहीं' : 'No chapters available'}
            </p>
          ) : (
            <div className="space-y-1.5">
              {topics.map((topic) => {
                const isActive = activeTopicId === topic.id;
                const pct = topic.masteryPercent ?? 0;
                const ring = topic.masteryColor ?? 'var(--border)';
                return (
                  <button
                    key={topic.id}
                    type="button"
                    onClick={() => onSelectTopic(topic.id)}
                    className="foxy-os-chapter w-full flex items-center gap-3 rounded-xl text-left transition-all active:scale-[0.99]"
                    style={{
                      background: isActive ? `${ring}10` : 'var(--surface-2)',
                      border: `1px solid ${isActive ? `${ring}40` : 'var(--border)'}`,
                    }}
                    aria-pressed={isActive}
                  >
                    {/* Mastery ring */}
                    <span
                      className="foxy-os-ring shrink-0"
                      style={{
                        background: `conic-gradient(${ring} ${pct * 3.6}deg, var(--surface-1) 0deg)`,
                      }}
                      aria-hidden="true"
                    >
                      <span className="foxy-os-ring-inner" style={{ color: ring }}>{pct}</span>
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                        {isHi ? 'अध्याय' : 'Ch'} {topic.chapter_number}: {topic.title}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Mode picker ────────────────────────────────────── */}
        <section aria-label={isHi ? 'मोड' : 'Modes'}>
          <h4 className="foxy-os-study-label" id="foxy-os-modes-label">{isHi ? 'मोड चुनो' : 'Choose a mode'}</h4>
          {/* Phase 3 a11y: explicit group so SR announces these toggle chips as
              a labelled set. Each chip carries aria-pressed below. */}
          <div
            role="group"
            aria-labelledby="foxy-os-modes-label"
            className="grid grid-cols-3 gap-2"
          >
            {modes.map((m) => {
              const backend = resolveBackendMode(m.id);
              const isActive =
                sessionMode === backend ||
                (m.id === 'ask' && (sessionMode === 'learn' || sessionMode === 'doubt'));
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onSelectMode(m.id)}
                  className="foxy-os-mode flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-bold transition-all active:scale-95"
                  style={{
                    background: isActive ? `${subjectColor}15` : 'var(--surface-2)',
                    border: isActive ? `1.5px solid ${subjectColor}40` : '1.5px solid var(--border)',
                    color: isActive ? subjectColor : 'var(--text-2)',
                  }}
                  aria-pressed={isActive}
                >
                  <span className="text-base" aria-hidden="true">{m.icon}</span>
                  <span>{isHi ? m.labelHi : m.label}</span>
                </button>
              );
            })}
            {/* Quiz — dedicated chip, routes to /quiz (P4 preserved). */}
            <button
              type="button"
              onClick={onStartQuiz}
              className="foxy-os-mode flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-bold transition-all active:scale-95"
              style={{
                background: 'var(--surface-2)',
                border: '1.5px solid var(--border)',
                color: 'var(--text-2)',
              }}
              aria-label={isHi ? 'क्विज़ शुरू करें' : 'Start quiz'}
            >
              <span className="text-base" aria-hidden="true">📝</span>
              <span>{isHi ? 'क्विज़' : 'Quiz'}</span>
            </button>
            {/* Lesson — explicit chip (maps to switchMode('lesson')). */}
            <button
              type="button"
              onClick={() => onSelectMode('lesson')}
              className="foxy-os-mode flex flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-bold transition-all active:scale-95"
              style={{
                background: sessionMode === 'lesson' ? `${subjectColor}15` : 'var(--surface-2)',
                border: sessionMode === 'lesson' ? `1.5px solid ${subjectColor}40` : '1.5px solid var(--border)',
                color: sessionMode === 'lesson' ? subjectColor : 'var(--text-2)',
              }}
              aria-pressed={sessionMode === 'lesson'}
              aria-label={isHi ? 'पाठ मोड' : 'Lesson mode'}
            >
              <span className="text-base" aria-hidden="true">🎓</span>
              <span>{isHi ? 'पाठ' : 'Lesson'}</span>
            </button>
          </div>
        </section>

        {/* ── Lesson stepper (lesson mode only) ──────────────── */}
        {lesson && (
          <section aria-label={isHi ? 'पाठ प्रगति' : 'Lesson progress'}>
            <h4 className="foxy-os-study-label">{isHi ? 'पाठ प्रगति' : 'Lesson progress'}</h4>
            {/* Phase 3 a11y: announce the current step to SRs. The tiny visual
                step labels below are decorative (aria-hidden) — six labels in a
                360px row cannot legibly hit 12px, so the readable status lives
                here in a single non-truncated line that meets the contrast/size
                floor. */}
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>
              {isHi ? 'चरण' : 'Step'} {Math.min(lesson.currentIndex + 1, lesson.stepLabels.length)}/{lesson.stepLabels.length}
              {lesson.stepLabels[lesson.currentIndex]
                ? ` · ${lesson.stepLabels[lesson.currentIndex]}`
                : ''}
            </p>
            <div className="flex items-center gap-1 mb-2" aria-hidden="true">
              {lesson.stepLabels.map((label, idx) => {
                const isCompleted = idx < lesson.currentIndex;
                const isCurrent = idx === lesson.currentIndex;
                return (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
                    <div
                      className="w-full h-1.5 rounded-full"
                      style={{
                        background: isCompleted
                          ? subjectColor
                          : isCurrent
                            ? `${subjectColor}60`
                            : 'var(--surface-2)',
                      }}
                    />
                    <span
                      className="text-[10px] font-bold truncate w-full text-center"
                      style={{ color: isCompleted || isCurrent ? subjectColor : 'var(--text-3)' }}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={lesson.onNext}
              disabled={!lesson.canAdvance}
              className="foxy-os-tap w-full rounded-xl text-xs font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
              style={{ background: subjectColor }}
            >
              {lesson.isFinalStep
                ? isHi ? '✓ पूरा हुआ' : '✓ Complete'
                : isHi ? 'अगला चरण →' : 'Next step →'}
            </button>
          </section>
        )}
      </div>
    </SheetModal>
  );
}

export default FoxyStudySheet;
