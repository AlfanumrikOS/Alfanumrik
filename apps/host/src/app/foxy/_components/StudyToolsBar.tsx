'use client';

/**
 * StudyToolsBar — the two flag-gated GenAI affordances in the Foxy controls
 * toolbar, sitting alongside the existing subject pills / chapter dropdown /
 * mode pills:
 *
 *   🗺️  "Diagram" / "आरेख"       → ff_content_generation_v1
 *   📔  "Lesson notes" / "पाठ नोट्स" → ff_lesson_generation_v1
 *
 * Flag gating is the CALLER's job (page.tsx passes `showDiagram` / `showLesson`
 * straight from `useGenAiContentFlags`). When BOTH are false this component
 * renders `null` — no wrapper, no divider, no whitespace — so the toolbar is
 * byte-identical to today on the OFF path.
 *
 * The buttons reuse the exact `foxy-pill` visual language of the surrounding
 * toolbar controls (same radius, weight, sizing, subject-tinted active state)
 * so the surface reads as native rather than bolted on.
 *
 * No chapter selected → the button does not dead-end: it calls
 * `onNeedChapter()` so the page can open the chapter picker, and it renders in
 * a muted state with an explanatory bilingual title.
 */

export interface StudyToolsBarProps {
  isHi: boolean;
  /** ff_content_generation_v1 resolved ON. */
  showDiagram: boolean;
  /** ff_lesson_generation_v1 resolved ON. */
  showLesson: boolean;
  /** True when a chapter is selected — both affordances need one. */
  hasChapter: boolean;
  /** Active subject accent colour (same value the toolbar pills use). */
  accentColor: string;
  onDiagram: () => void;
  onLesson: () => void;
  /** Called instead of onDiagram/onLesson when no chapter is selected. */
  onNeedChapter: () => void;
}

export function StudyToolsBar({
  isHi,
  showDiagram,
  showLesson,
  hasChapter,
  accentColor,
  onDiagram,
  onLesson,
  onNeedChapter,
}: StudyToolsBarProps) {
  // OFF path: render literally nothing.
  if (!showDiagram && !showLesson) return null;

  const needChapterHint = isHi
    ? 'पहले एक अध्याय चुनो'
    : 'Pick a chapter first';

  const pill = (opts: {
    key: string;
    icon: string;
    label: string;
    title: string;
    testId: string;
    onClick: () => void;
  }) => (
    <button
      key={opts.key}
      type="button"
      data-testid={opts.testId}
      onClick={hasChapter ? opts.onClick : onNeedChapter}
      title={hasChapter ? opts.title : needChapterHint}
      aria-label={hasChapter ? opts.title : `${opts.title} — ${needChapterHint}`}
      className="foxy-pill shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-[0.97]"
      style={{
        background: 'var(--surface-2)',
        border: '1.5px solid var(--border)',
        color: hasChapter ? accentColor : 'var(--text-3)',
        opacity: hasChapter ? 1 : 0.6,
        minHeight: 36,
      }}
    >
      <span className="text-sm" aria-hidden="true">
        {opts.icon}
      </span>
      <span className="whitespace-nowrap">{opts.label}</span>
    </button>
  );

  return (
    <div
      className="flex items-center gap-1.5 shrink-0"
      role="group"
      aria-label={isHi ? 'अध्याय के लिए स्टडी टूल' : 'Study tools for this chapter'}
    >
      {showDiagram &&
        pill({
          key: 'diagram',
          icon: '🗺️',
          testId: 'foxy-tool-diagram',
          label: isHi ? 'आरेख' : 'Diagram',
          title: isHi
            ? 'इस अध्याय का NCERT आधारित आरेख बनाओ'
            : 'Draw an NCERT-grounded diagram for this chapter',
          onClick: onDiagram,
        })}
      {showLesson &&
        pill({
          key: 'lesson',
          icon: '📔',
          testId: 'foxy-tool-lesson',
          label: isHi ? 'पाठ नोट्स' : 'Lesson notes',
          title: isHi
            ? 'इस अध्याय के NCERT आधारित नोट्स बनाओ'
            : 'Write NCERT-grounded notes for this chapter',
          onClick: onLesson,
        })}
    </div>
  );
}

export default StudyToolsBar;
