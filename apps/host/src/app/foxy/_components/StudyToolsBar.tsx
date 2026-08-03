'use client';

/**
 * StudyToolsBar — the flag-gated GenAI + Wave-B affordances in the Foxy
 * controls toolbar, sitting alongside the existing subject pills / chapter
 * dropdown / mode pills:
 *
 *   🗺️  "Diagram" / "आरेख"       → ff_content_generation_v1
 *   📔  "Lesson notes" / "पाठ नोट्स" → ff_lesson_generation_v1
 *   📸  "Snap a doubt" / "फोटो से पूछो" → ff_foxy_snap_v1 (navigation-only link
 *       to /foxy/snap — screen 10; this pill does NOT touch camera/OCR logic,
 *       it is only the discoverable entry point into that route)
 *
 * Flag gating is the CALLER's job (page.tsx passes `showDiagram` / `showLesson`
 * / `showSnap` straight from their respective flag reads). When ALL THREE are
 * false this component renders `null` — no wrapper, no divider, no whitespace
 * — so the toolbar is byte-identical to today on the OFF path.
 *
 * The buttons reuse the exact `foxy-pill` visual language of the surrounding
 * toolbar controls (same radius, weight, sizing, subject-tinted active state)
 * so the surface reads as native rather than bolted on.
 *
 * No chapter selected → the diagram/lesson buttons do not dead-end: they call
 * `onNeedChapter()` so the page can open the chapter picker, and render in a
 * muted state with an explanatory bilingual title. "Snap a doubt" needs no
 * chapter (it does its own topic matching), so it is never muted by
 * `hasChapter`.
 */

export interface StudyToolsBarProps {
  isHi: boolean;
  /** ff_content_generation_v1 resolved ON. */
  showDiagram: boolean;
  /** ff_lesson_generation_v1 resolved ON. */
  showLesson: boolean;
  /** ff_foxy_snap_v1 resolved ON — shows the "Snap a doubt" navigation pill. */
  showSnap?: boolean;
  /** True when a chapter is selected — the diagram/lesson affordances need one. */
  hasChapter: boolean;
  /** Active subject accent colour (same value the toolbar pills use). */
  accentColor: string;
  onDiagram: () => void;
  onLesson: () => void;
  /** Navigates to /foxy/snap. Does not require a chapter. */
  onSnap?: () => void;
  /** Called instead of onDiagram/onLesson when no chapter is selected. */
  onNeedChapter: () => void;
}

export function StudyToolsBar({
  isHi,
  showDiagram,
  showLesson,
  showSnap,
  hasChapter,
  accentColor,
  onDiagram,
  onLesson,
  onSnap,
  onNeedChapter,
}: StudyToolsBarProps) {
  // OFF path: render literally nothing.
  if (!showDiagram && !showLesson && !showSnap) return null;

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
      {/* Navigation-only entry point into /foxy/snap (ff_foxy_snap_v1). Never
          muted by `hasChapter` — the snap screen does its own topic matching
          and needs no chapter pre-selected. */}
      {showSnap && onSnap && (
        <button
          key="snap"
          type="button"
          data-testid="foxy-tool-snap"
          onClick={onSnap}
          title={isHi ? 'फोटो खींचकर सवाल पूछो' : 'Snap a photo to ask a doubt'}
          aria-label={isHi ? 'फोटो खींचकर सवाल पूछो' : 'Snap a photo to ask a doubt'}
          className="foxy-pill shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-[0.97]"
          style={{
            background: 'var(--surface-2)',
            border: '1.5px solid var(--border)',
            color: accentColor,
            minHeight: 36,
          }}
        >
          <span className="text-sm" aria-hidden="true">
            📸
          </span>
          <span className="whitespace-nowrap">{isHi ? 'फोटो से पूछो' : 'Snap a doubt'}</span>
        </button>
      )}
    </div>
  );
}

export default StudyToolsBar;
