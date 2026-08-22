'use client';

/**
 * FoxyStructuredRenderer — renders a validated `FoxyResponse` payload.
 *
 * This component is the new structured-block renderer for Foxy AI tutor
 * responses. It replaces the markdown pipeline (RichContent.tsx) for any
 * message that already validated against `FoxyResponseSchema`. Legacy
 * markdown messages still flow through RichContent — see `isFoxyResponse`
 * for the cheap discriminator callers use to pick the right renderer.
 *
 * Product invariants honored:
 *   - P7 Bilingual UI: chrome strings (Answer, Exam Tip, Definition, etc.)
 *     resolve through `useAuth().isHi`. Block text/latex content is rendered
 *     verbatim — the model emits it in the user's language.
 *   - P12 AI Safety: KaTeX is invoked with `throwOnError: false`. A render
 *     error degrades to a `<code>` fallback plus an optional reporter, never
 *     a thrown exception that could crash the chat list.
 *   - P10 Bundle Budget: KaTeX is statically imported (already a transitive
 *     dep via rehype-katex; no new bytes). No ReactMarkdown for math —
 *     `katex.renderToString` is sync and small.
 *
 * NOTE: This component is presentational only. It does NOT validate the
 * response — that is the caller's responsibility (use `FoxyResponseSchema`
 * at the API boundary).
 */

import React, { memo, useMemo, useState, useCallback, useEffect, useRef } from 'react';
// NOTE: no direct `katex` import here — all KaTeX/normalizer/markdown logic
// is delegated to the canonical math module (../math/, see imports below).
// `katex/dist/katex.min.css` is imported by math/katex-segments, so the
// stylesheet still ships with this component (P10: no new bytes).
import dynamic from 'next/dynamic';
import type {
  FoxyBlock,
  FoxyResponse,
  FoxyMermaidBlock,
  FoxyVerticalMathBlock,
  FoxyMapBlock,
} from '@alfanumrik/lib/foxy/schema';
import {
  isFoxyMcqBlock,
  isFoxyMermaidBlock,
  isFoxyVerticalMathBlock,
  isFoxyMapBlock,
} from '@alfanumrik/lib/foxy/schema';

// Lazy-loaded block renderers (P10 bundle budget)
const VerticalMathBlock = dynamic(
  () => import('./VerticalMathBlock').then((m) => m.VerticalMathBlock),
  { ssr: false }
);
const MapBlock = dynamic(
  () => import('./MapBlock').then((m) => m.MapBlock),
  { ssr: false }
);
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useSubjectLookup } from '@alfanumrik/lib/useSubjectLookup';
import { DiagramViewer } from '@alfanumrik/ui/DiagramViewer';
import { supabase } from '@alfanumrik/lib/supabase-client';
// Re-exported below so existing imports of `isFoxyResponse` from this module
// keep working. The implementation lives in `@alfanumrik/lib/foxy/is-foxy-response` so
// callers can import the discriminator without pulling KaTeX into the
// synchronous bundle (P10).
import { isFoxyResponse as isFoxyResponseImpl } from '@alfanumrik/lib/foxy/is-foxy-response';
// Canonical math pipeline (packages/ui/src/math/ — 2026-07 consolidation):
// tokenizer + undelimited-LaTeX rescue live in math/normalize; the KaTeX
// segment renderer (fail-safe `<code>` fallback, P12) lives in
// math/katex-segments. This module imports them statically — /foxy already
// ships KaTeX, so no new bytes (P10).
import {
  normalizeMathSegments,
  tokenizeInline,
} from '../math/normalize';
import {
  renderKatex,
  renderInlineSegments,
} from '../math/katex-segments';

// Re-export the normalization primitives (incl. the trigger predicate and the
// tokenizer) so tests and the production canary corpus can pin them directly.
export {
  containsAllowlistedMathCommand,
  splitUndelimitedMath,
  normalizeMathSegments,
  tokenizeInline,
  MATH_COMMAND_ALLOWLIST,
} from '../math/normalize';
export type { InlineSegment } from '../math/normalize';

// ── Props ────────────────────────────────────────────────────────────────────

/**
 * Part B1 — the evidential "Quiz me" contract for the MCQ block in this
 * response, plus the grade callback the block uses when the item is evidential.
 * Both are optional: when absent (every non-quiz turn, history, legacy rows) the
 * MCQ block renders as before (local self-check, no grade call, no mastery claim).
 */
export interface QuizMeBinding {
  evidential: boolean;
  servedItemId?: string;
  /** Grade an evidential answer; returns the normalized result (never throws). */
  onGrade: (input: {
    servedItemId: string;
    chosenIndex: number;
    attemptId: string;
    responseTimeMs: number;
  }) => Promise<EvidentialGradeResult>;
}

/** Normalized grade result the block maps to a bilingual UI state. */
export type EvidentialGradeResult =
  | {
      ok: true;
      correct: boolean;
      correctIndex: number;
      mastery: { conceptId: string; masteryMean: number; attempts: number; mastered: boolean };
    }
  | {
      ok: false;
      error:
        | 'already_answered'
        | 'too_fast'
        | 'not_evidential'
        | 'unauthenticated'
        | 'bad_request'
        | 'network';
    };

export interface FoxyStructuredRendererProps {
  /** Validated structured payload from FoxyResponseSchema. */
  response: FoxyResponse;
  /** Optional subject code override; defaults to `response.subject`. */
  subjectKey?: string;
  /** Invoked when a math block fails to render (renderer surfaces a button). */
  onReportIssue?: () => void;
  /**
   * Part B1: when present on a "Quiz me" turn, the MCQ block grades through the
   * sanctioned mastery pipeline (evidential) or renders practice-only
   * (non-evidential). Absent → self-check only (unchanged behaviour).
   */
  quizMe?: QuizMeBinding;
}

// ── Bilingual chrome strings ─────────────────────────────────────────────────
//
// Centralised here so the bilingual contract is auditable in one spot.
// Per P7, technical terms (CBSE, XP, Bloom's, NCERT) are NOT translated, but
// the labels below are pure UI chrome and must localise.

interface Chrome {
  answer: string;
  examTip: string;
  definition: string;
  example: string;
  practice: string;
  formulaError: string;
  reportIssue: string;
  diagram: string;
  // Mermaid diagram chrome (Wave 2 — drawable diagrams). `diagramLoading` shows
  // while the (lazy-loaded) mermaid runtime renders; `diagramFailed` is the
  // quiet, non-crashing fallback when a diagram cannot be parsed/drawn.
  diagramLoading: string;
  diagramFailed: string;
  // MCQ self-check chrome (Phase 1 learning actions — formative, no submission)
  mcqCheck: string;
  mcqCorrect: string;
  mcqNotQuite: string;
  mcqWhy: string;
  // Part B1 — evidential "Quiz me" chrome
  mcqSubmit: string;        // submit button
  mcqGrading: string;       // in-flight
  mcqMasteryUpdated: string; // subtle "Foxy strengthened your weak area" affirmation
  mcqTooFast: string;       // 422 too_fast — gentle, non-punitive
  mcqAlready: string;       // 409 already_answered
  mcqRetry: string;         // network/500 retry CTA
  mcqRetryHint: string;     // non-blocking retry hint line
}

const CHROME: { en: Chrome; hi: Chrome } = {
  en: {
    answer: 'Answer',
    examTip: 'Exam Tip',
    definition: 'Definition',
    example: 'Example',
    practice: 'Practice',
    formulaError: 'Issue with formula',
    reportIssue: 'Report issue',
    diagram: 'Diagram',
    diagramLoading: 'Drawing diagram…',
    diagramFailed: "Diagram couldn't be drawn",
    mcqCheck: 'Check',
    mcqCorrect: 'Correct!',
    mcqNotQuite: 'Not quite',
    mcqWhy: 'Why',
    mcqSubmit: 'Submit answer',
    mcqGrading: 'Checking…',
    mcqMasteryUpdated: 'Foxy strengthened this weak area ✨',
    mcqTooFast: 'Take a moment to read the question, then answer.',
    mcqAlready: 'You already answered this one.',
    mcqRetry: 'Try again',
    mcqRetryHint: "Couldn't submit just now.",
  },
  hi: {
    answer: 'उत्तर',
    // "परीक्षा सुझाव" is the standard NCERT Hindi-medium term for "exam tip".
    // The earlier "परीक्षा टिप" was Hinglish (English loan "टिप") and not
    // consistent with the rest of the chrome map (उत्तर / परिभाषा / उदाहरण /
    // अभ्यास / सूत्र में समस्या) which all use standard NCERT terminology.
    examTip: 'परीक्षा सुझाव',
    definition: 'परिभाषा',
    example: 'उदाहरण',
    practice: 'अभ्यास',
    formulaError: 'सूत्र में समस्या',
    reportIssue: 'समस्या रिपोर्ट करें',
    diagram: 'चित्र',
    diagramLoading: 'डायग्राम बन रहा है…',
    diagramFailed: 'डायग्राम नहीं बन पाया',
    mcqCheck: 'जांचें',
    mcqCorrect: 'सही!',
    mcqNotQuite: 'लगभग',
    mcqWhy: 'कारण',
    mcqSubmit: 'उत्तर जमा करें',
    mcqGrading: 'जांच रहे हैं…',
    mcqMasteryUpdated: 'फॉक्सी ने इस कमज़ोर हिस्से को मज़बूत किया ✨',
    mcqTooFast: 'प्रश्न को पढ़ने के लिए थोड़ा समय लें, फिर उत्तर दें।',
    mcqAlready: 'आप इसका उत्तर पहले ही दे चुके हैं।',
    mcqRetry: 'फिर कोशिश करें',
    mcqRetryHint: 'अभी उत्तर जमा नहीं हो पाया।',
  },
};

// ── Default visual config (used while subject lookup is hydrating) ───────────

const DEFAULT_CFG = { icon: '⚛', color: '#10B981' }; // green atom

// ── Public type guard ────────────────────────────────────────────────────────

/**
 * Cheap shape check for `FoxyResponse`. Used by callers (e.g. ChatBubble) to
 * decide between this renderer and the legacy markdown renderer.
 *
 * The implementation lives in `@alfanumrik/lib/foxy/is-foxy-response` so the predicate
 * can be imported without dragging KaTeX into the synchronous bundle. This
 * file re-exports it under the same name for backward compatibility with
 * existing call sites and tests.
 */
export const isFoxyResponse = isFoxyResponseImpl;

// ── KaTeX rendering ──────────────────────────────────────────────────────────
//
// `renderMath` is now the canonical `renderKatex` from math/katex-segments
// (same signature, same katex-error soft-failure contract). Kept as a local
// alias so the block renderers below read unchanged.
const renderMath = renderKatex;

// ── Inline content rendering (math + markdown emphasis inside prose) ──────────
//
// The model frequently emits inline LaTeX (`\( … \)`, `$ … $`) and markdown
// emphasis (`**bold**`, `*italic*`) INSIDE the prose `text`/`label` fields of
// non-math blocks, despite the structured-output prompt forbidding it. Rather
// than show those delimiters/asterisks literally to students, every
// text-bearing block routes its strings through the `InlineContent` component
// below (backed by `tokenizeInline` + `renderMarkdownInline`), which:
//
//   1. Tokenises the string into math vs non-math segments using the four
//      LaTeX delimiter pairs (display: `\[…\]`, `$$…$$`; inline: `\(…\)`,
//      `$…$`), honouring escaped `\$` as a literal dollar.
//   2. Renders math segments with KaTeX (display vs inline as appropriate).
//      A KaTeX failure degrades to a `<code>` span — never throws (P12).
//   3. Renders non-math segments with a small, safe inline-markdown parser
//      that emits only <strong>/<em> — no arbitrary HTML, XSS-safe (React
//      escapes the plain-text leaves).
//
// P10: no new dependency — KaTeX is already imported above. The markdown
// parser is a few regexes, zero bytes of new deps.

/**
 * `InlineContent` — render a prose string with inline math + markdown emphasis.
 *
 * Used by every text-bearing block (and block labels). Delegates to the
 * canonical pipeline: `tokenizeInline` (math/normalize) ->
 * `normalizeMathSegments` (undelimited-LaTeX rescue) ->
 * `renderInlineSegments` (math/katex-segments) whose DEFAULTS reproduce this
 * component's historical DOM exactly: plain text passes through React
 * (escaped) with bold/italic emphasis; math renders via KaTeX; a KaTeX
 * failure degrades to a `<code>` span so a malformed `\( \frac{1}{ \)`
 * never crashes the chat list (P12).
 */
function InlineContent({ text }: { text: string | undefined }) {
  const nodes = useMemo<React.ReactNode[]>(() => {
    if (!text) return [];
    return renderInlineSegments(normalizeMathSegments(tokenizeInline(text)));
  }, [text]);

  return <>{nodes}</>;
}

// ── Block renderers ──────────────────────────────────────────────────────────

interface BlockProps {
  block: FoxyBlock;
  /** 1-indexed step number; only meaningful for `type === 'step'`. */
  stepNumber: number | null;
  cfg: { icon: string; color: string };
  chrome: Chrome;
  onReportIssue?: () => void;
  /** Part B1: evidential binding for the MCQ block (undefined → self-check). */
  quizMe?: QuizMeBinding;
}

function ParagraphBlock({ block }: { block: FoxyBlock }) {
  return (
    <p className="my-2 leading-relaxed text-sm text-slate-800">
      <InlineContent text={block.text} />
    </p>
  );
}

function StepBlock({
  block,
  stepNumber,
  cfg,
}: {
  block: FoxyBlock;
  stepNumber: number;
  cfg: { color: string };
}) {
  return (
    <div className="my-3 flex gap-3 items-start rounded-xl border border-slate-200 bg-white p-3">
      <span
        className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
        style={{ background: `${cfg.color}20`, color: cfg.color }}
        aria-label={`Step ${stepNumber}`}
      >
        {stepNumber}
      </span>
      <div className="min-w-0 flex-1">
        {block.label && (
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
            <InlineContent text={block.label} />
          </div>
        )}
        <p className="text-sm leading-relaxed text-slate-800">
          <InlineContent text={block.text} />
        </p>
      </div>
    </div>
  );
}

function MathBlock({
  block,
  chrome,
  onReportIssue,
}: {
  block: FoxyBlock;
  chrome: Chrome;
  onReportIssue?: () => void;
}) {
  // `block.latex` is required for math blocks per FoxyResponseSchema.
  const latex = block.latex ?? '';
  const rendered = useMemo(() => renderMath(latex), [latex]);

  if (!rendered.ok) {
    return (
      <div
        className="my-3 px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-sm"
        role="alert"
      >
        <div className="font-semibold mb-1">{chrome.formulaError}</div>
        <code className="block bg-white border border-rose-200 rounded px-2 py-1 font-mono text-xs text-rose-800 overflow-x-auto">
          {latex}
        </code>
        {onReportIssue && (
          <button
            type="button"
            onClick={onReportIssue}
            className="mt-2 text-xs font-semibold underline hover:opacity-80 active:opacity-60"
          >
            {chrome.reportIssue}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="my-3 flex justify-center overflow-x-auto">
      {/* KaTeX HTML output is safe — KaTeX sanitizes its input and emits a
          fixed set of span/mathml elements with no script/event handlers. */}
      <div
        className="katex-render"
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    </div>
  );
}

function AnswerBlock({ block, chrome }: { block: FoxyBlock; chrome: Chrome }) {
  return (
    <div className="my-3 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900">
      <div className="font-bold text-sm mb-1">{chrome.answer}</div>
      <p className="text-sm leading-relaxed">
        <InlineContent text={block.text} />
      </p>
    </div>
  );
}

function ExamTipBlock({ block, chrome }: { block: FoxyBlock; chrome: Chrome }) {
  return (
    <div className="my-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
      <div className="font-bold text-sm mb-1">{chrome.examTip}</div>
      <p className="text-sm leading-relaxed">
        <InlineContent text={block.text} />
      </p>
    </div>
  );
}

function DefinitionBlock({
  block,
  chrome,
}: {
  block: FoxyBlock;
  chrome: Chrome;
}) {
  return (
    <div className="my-3 px-4 py-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-900">
      <div className="font-bold text-sm mb-1">
        {block.label ? <InlineContent text={block.label} /> : chrome.definition}
      </div>
      <p className="text-sm leading-relaxed">
        <InlineContent text={block.text} />
      </p>
    </div>
  );
}

function ExampleBlock({ block, chrome }: { block: FoxyBlock; chrome: Chrome }) {
  return (
    <div className="my-3 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800">
      <div className="italic font-semibold text-sm mb-1">{chrome.example}</div>
      <p className="text-sm leading-relaxed">
        <InlineContent text={block.text} />
      </p>
    </div>
  );
}

function QuestionBlock({ block, chrome }: { block: FoxyBlock; chrome: Chrome }) {
  return (
    <div className="my-3 px-4 py-3 rounded-xl bg-purple-50 border border-purple-200 text-purple-900">
      <div className="font-bold text-sm mb-1">{chrome.practice}</div>
      <p className="text-sm leading-relaxed">
        <InlineContent text={block.text} />
      </p>
    </div>
  );
}

function CodeBlock({ block }: { block: FoxyBlock }) {
  if (!block.text) return null;
  return (
    <div className="my-3 rounded-xl overflow-hidden bg-slate-900 border border-slate-700">
      {block.language && (
        <div className="px-3 py-1.5 bg-slate-800 text-slate-400 text-[10px] font-mono border-b border-slate-700 uppercase tracking-wider">
          {block.language}
        </div>
      )}
      <pre className="p-3 overflow-x-auto text-xs text-slate-50 font-mono leading-relaxed">
        {block.text}
      </pre>
    </div>
  );
}

function DiagramBlock({ block, chrome }: { block: FoxyBlock; chrome: Chrome }) {
  const [diagrams, setDiagrams] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!block.search_query) {
      setLoading(false);
      return;
    }

    let mounted = true;
    async function search() {
      const rawQuery = block.search_query || '';
      
      // Create a websearch query as first attempt
      const queryStr = rawQuery.split(' ').slice(0, 5).join(' ');

      const { data, error } = await supabase
        .from('topic_diagrams')
        .select('*')
        .textSearch('caption', queryStr, { type: 'websearch' })
        .limit(2);

      if (mounted) {
        if (data && data.length > 0) {
          setDiagrams(data);
          setLoading(false);
          return;
        }

        // Fallback: robust keyword matching across topic, caption, and alt_text
        const ignored = ['diagram', 'ncert', 'class', 'explain', 'show', 'the', 'and', 'with', 'for'];
        // Split by spaces and hyphens to get base words (e.g. d-block -> 'd', 'block')
        const words = rawQuery
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, ' ') 
          .split(/[\s-]+/)
          .filter(w => w.length > 3 && !ignored.includes(w));
          
        if (words.length > 0) {
          // Take the top 3 most significant words to form the OR condition
          const searchWords = words.slice(0, 3);
          const orConditions = searchWords.map(w => `topic.ilike.%${w}%,caption.ilike.%${w}%,alt_text.ilike.%${w}%`).join(',');
          
          const { data: fallbackData } = await supabase
            .from('topic_diagrams')
            .select('*')
            .or(orConditions)
            .limit(2);
            
          if (fallbackData && fallbackData.length > 0) {
             setDiagrams(fallbackData);
             setLoading(false);
             return;
          }
        }
        
        // Final fallback: no diagrams found
        setDiagrams([]);
        setLoading(false);
      }
    }
    search();

    return () => { mounted = false; };
  }, [block.search_query]);
  
  if (!block.search_query) return null;
  
  if (loading) {
    return (
      <div className="my-3 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-3 animate-pulse">
        <div className="text-xl" aria-hidden="true">🖼️</div>
        <div>
          <div className="h-2.5 bg-slate-200 rounded-full w-24 mb-2"></div>
          <div className="h-2 bg-slate-200 rounded-full w-48"></div>
        </div>
      </div>
    );
  }

  if (diagrams && diagrams.length > 0) {
    // Pass to DiagramViewer, which accepts TopicDiagram array
    return <DiagramViewer diagrams={diagrams} isHi={chrome.diagram === 'चित्र'} />;
  }

  // Fallback if no diagrams found in the RAG DB
  return (
    <div className="my-3 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 flex items-center gap-3">
      <div className="text-xl" aria-hidden="true">🖼️</div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">
          {chrome.diagram}
        </div>
        <p className="text-sm italic text-slate-700 truncate">{block.search_query}</p>
      </div>
    </div>
  );
}

/** Crypto-quality uuid for the attempt idempotency key, with a safe fallback. */
function makeAttemptId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  // RFC4122-shaped fallback (sufficient as an idempotency key; the server is
  // the authority and dedupes on it).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * McqBlock — Foxy "Quiz me" MCQ with two distinct modes:
 *
 *  1. PRACTICE / SELF-CHECK (default — no `quizMe`, OR quizMe.evidential===false):
 *     SELECT reveals correctness LOCALLY. No grade call, no XP, NO mastery
 *     claim. Identical to the pre-existing self-check behaviour. This is what
 *     renders on every non-quiz turn, on history, and on a non-evidential
 *     "Quiz me" item (P1/P2/P4 honoured — nothing touches the scoring pipeline).
 *
 *  2. EVIDENTIAL (quizMe.evidential===true with a servedItemId):
 *     The student picks an option then SUBMITS. The chosen index is POSTed to
 *     /api/foxy/quiz-answer, which grades against the SERVER-HELD key and moves
 *     mastery through the sanctioned tutor_commit_attempt pipeline. The server
 *     is authoritative for correctness, the 3s floor, idempotency, and mastery.
 *     On success the block reveals the SERVER's correct_index + explanation and
 *     a subtle "mastery updated" affirmation — the visible proof Foxy
 *     strengthened the weak area. Errors degrade gracefully + bilingually and
 *     never block the chat.
 *
 * A11y: each option is a real <button> with role="radio" + aria-checked so the
 * group is keyboard-operable and screen-reader-announced; correctness uses
 * an icon as well as colour so colour is not the only signal. Touch targets ≥44px.
 */
function McqBlock({
  block,
  chrome,
  quizMe,
}: {
  block: FoxyBlock;
  chrome: Chrome;
  quizMe?: QuizMeBinding;
}) {
  // Defensive: only render if the block is a structurally valid MCQ. The
  // schema already guarantees this at the API boundary, but the renderer must
  // never throw on a malformed historical/legacy row.
  const validMcq = isFoxyMcqBlock(block);

  const evidential = !!(quizMe?.evidential && quizMe.servedItemId);

  const [selected, setSelected] = useState<number | null>(null);
  // Wall-clock anchor for response_time_ms — set when the item first renders.
  const shownAtRef = useRef<number>(Date.now());
  // Stable attempt id per mounted item (idempotency key reused across retries
  // of the SAME submission so a retry after a transient 500 stays idempotent).
  const attemptIdRef = useRef<string>(makeAttemptId());

  // Evidential grading state machine.
  const [grading, setGrading] = useState(false);
  type GradedOk = Extract<EvidentialGradeResult, { ok: true }>;
  const [graded, setGraded] = useState<GradedOk | null>(null);
  const [softError, setSoftError] = useState<
    null | 'too_fast' | 'already_answered' | 'not_evidential' | 'network'
  >(null);

  const submit = useCallback(async () => {
    if (selected === null || !quizMe?.servedItemId || grading) return;
    setGrading(true);
    setSoftError(null);
    const result = await quizMe.onGrade({
      servedItemId: quizMe.servedItemId,
      chosenIndex: selected,
      attemptId: attemptIdRef.current,
      responseTimeMs: Date.now() - shownAtRef.current,
    });
    setGrading(false);
    if (result.ok) {
      setGraded(result);
      return;
    }
    if (result.error === 'too_fast') { setSoftError('too_fast'); return; }
    if (result.error === 'already_answered') { setSoftError('already_answered'); return; }
    if (result.error === 'not_evidential' || result.error === 'bad_request' || result.error === 'unauthenticated') {
      // Cannot move mastery this turn — fall back to local self-check reveal
      // (practice). No mastery claim is made.
      setSoftError('not_evidential');
      return;
    }
    // network / 500 → non-blocking retry (the selection is kept).
    setSoftError('network');
  }, [selected, quizMe, grading]);

  if (!validMcq) return null;
  const { stem, options, correct_answer_index, explanation } = block;

  // ── Resolve which option is "the answer" for the reveal ──
  // Evidential graded: trust the SERVER's correct_index.
  // Self-check / non-evidential reveal: use the block's correct_answer_index.
  const revealedCorrectIndex = graded ? graded.correctIndex : correct_answer_index;

  // "answered" = the reveal is showing. Two ways to reach it:
  //   - evidential: a successful grade (graded != null)
  //   - self-check / non-evidential fallback: a local selection in non-evidential
  //     mode, OR an evidential item that fell back to practice (not_evidential).
  const selfCheckMode = !evidential || softError === 'not_evidential';
  const answered = graded != null || (selfCheckMode && selected !== null);
  const isRight = answered && selected === revealedCorrectIndex;

  // Lock option editing once: grading in-flight, graded, or self-check answered.
  const locked = grading || graded != null || (selfCheckMode && selected !== null);

  return (
    <div
      className="my-3 px-4 py-3 rounded-xl bg-purple-50 border border-purple-200 text-purple-900"
      data-testid="foxy-mcq-block"
      data-evidential={evidential ? 'true' : 'false'}
    >
      <div className="font-bold text-sm mb-2">{chrome.practice}</div>
      <p className="text-sm leading-relaxed mb-3">
        <InlineContent text={stem} />
      </p>

      <div role="radiogroup" aria-label={stem} className="space-y-2">
        {options.map((opt, i) => {
          const isChosen = selected === i;
          const isCorrect = i === revealedCorrectIndex;
          // Colour states only resolve AFTER the reveal.
          let cls =
            'w-full text-left px-3 py-2 rounded-lg border text-sm transition-all active:scale-[0.99] flex items-start gap-2 min-h-[44px]';
          if (!answered) {
            cls += isChosen
              ? ' bg-purple-100 border-purple-400 font-semibold'
              : ' bg-white border-purple-200 hover:bg-purple-100/50';
          } else if (isCorrect) {
            cls += ' bg-emerald-50 border-emerald-300 text-emerald-900 font-semibold';
          } else if (isChosen) {
            cls += ' bg-rose-50 border-rose-300 text-rose-900';
          } else {
            cls += ' bg-white border-purple-200 opacity-70';
          }

          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={isChosen}
              disabled={locked}
              onClick={() => { if (!locked) { setSelected(i); setSoftError(null); } }}
              className={cls}
            >
              <span aria-hidden="true" className="shrink-0 font-bold opacity-70">
                {String.fromCharCode(65 + i)}.
              </span>
              <span className="min-w-0 flex-1">
                <InlineContent text={opt} />
              </span>
              {answered && isCorrect && (
                <span aria-hidden="true" className="shrink-0">✓</span>
              )}
              {answered && isChosen && !isCorrect && (
                <span aria-hidden="true" className="shrink-0">✗</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Evidential: explicit Submit (the grade call moves mastery). Hidden in
          self-check mode (selecting an option reveals immediately) and after a
          successful grade. */}
      {evidential && !graded && softError !== 'not_evidential' && (
        <button
          type="button"
          disabled={selected === null || grading}
          onClick={submit}
          data-testid="foxy-mcq-submit"
          className="mt-3 w-full px-4 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-[0.99] min-h-[44px] disabled:opacity-50 disabled:cursor-default bg-purple-600 text-white hover:bg-purple-700"
        >
          {grading ? chrome.mcqGrading : chrome.mcqSubmit}
        </button>
      )}

      {/* Gentle / non-blocking error states (P7). Never raw error text. */}
      {softError === 'too_fast' && (
        <div
          className="mt-3 px-3 py-2 rounded-lg text-sm bg-amber-50 border border-amber-200 text-amber-900"
          role="status"
          aria-live="polite"
        >
          {chrome.mcqTooFast}
        </div>
      )}
      {softError === 'already_answered' && (
        <div
          className="mt-3 px-3 py-2 rounded-lg text-sm bg-slate-50 border border-slate-200 text-slate-700"
          role="status"
          aria-live="polite"
        >
          {chrome.mcqAlready}
        </div>
      )}
      {softError === 'network' && (
        <div
          className="mt-3 px-3 py-2 rounded-lg text-sm bg-slate-50 border border-slate-200 text-slate-700 flex items-center justify-between gap-3"
          role="status"
          aria-live="polite"
        >
          <span>{chrome.mcqRetryHint}</span>
          <button
            type="button"
            onClick={submit}
            disabled={grading}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 text-white hover:bg-purple-700 active:scale-95 disabled:opacity-50 min-h-[36px]"
          >
            {grading ? chrome.mcqGrading : chrome.mcqRetry}
          </button>
        </div>
      )}

      {/* Reveal: correct/incorrect + explanation. Shown after a successful
          evidential grade OR a self-check selection (incl. non-evidential
          fallback). */}
      {answered && (
        <div
          className="mt-3 px-3 py-2 rounded-lg text-sm"
          style={{
            background: isRight ? 'rgba(16,163,74,0.08)' : 'rgba(244,63,94,0.06)',
            border: `1px solid ${isRight ? 'rgba(16,163,74,0.25)' : 'rgba(244,63,94,0.2)'}`,
          }}
          role="status"
          aria-live="polite"
        >
          <div className={`font-bold mb-1 ${isRight ? 'text-emerald-700' : 'text-rose-700'}`}>
            {isRight ? `✓ ${chrome.mcqCorrect}` : `✗ ${chrome.mcqNotQuite}`}
          </div>
          <div className="text-slate-800">
            <span className="font-semibold">{chrome.mcqWhy}: </span>
            <InlineContent text={explanation} />
          </div>

          {/* Subtle "mastery updated" affirmation — ONLY when mastery actually
              moved (a successful evidential grade). Never shown in self-check /
              non-evidential mode, so we never claim mastery moved when it did not. */}
          {graded && (
            <div
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-100 text-purple-700 border border-purple-200"
              data-testid="foxy-mcq-mastery"
            >
              {chrome.mcqMasteryUpdated}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Mermaid diagram block (Wave 2 — drawable, colorful diagrams) ─────────────
//
// Renders a validated `mermaid` block as a real SVG diagram (replacing Foxy's
// ASCII art). The mermaid runtime (~500 kB+) is a HARD bundle-budget concern
// (P10): it must NEVER enter the shared bundle or the /foxy first-load. So it
// is pulled in via a dynamic `import('mermaid')` INSIDE the render effect
// (client-only) — webpack code-splits it into its own async chunk that is
// fetched only when a mermaid block actually mounts. There is deliberately NO
// static top-level `import 'mermaid'` in this file.
//
// Safety (P12): mermaid runs with `securityLevel: 'strict'` (its SVG output is
// DOMPurify-sanitised before it reaches us) and the block's `code` was already
// grammar-gated + sanitised by `validateMermaidCode` in the schema layer.
// `parse`/`render` are wrapped in try/catch and pre-validated with
// `mermaid.parse(code, { suppressErrors: true })`; any failure degrades to a
// quiet bilingual note (P7), never a thrown exception in the message list.

/** Type of the mermaid default export — type-only (erased, no bundle cost). */
type MermaidApi = typeof import('mermaid')['default'];

/**
 * One-time lazy loader + initializer for the mermaid runtime. The dynamic
 * import and `initialize()` run at most once per session; every MermaidBlock
 * awaits the same cached promise. `initialize` is synchronous and idempotent.
 */
let mermaidModulePromise: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily:
          '"Plus Jakarta Sans", "Sora", ui-sans-serif, system-ui, sans-serif',
        // Force SVG text labels (no foreignObject HTML) — safer under strict
        // and avoids clipped HTML labels on narrow 4G phones.
        htmlLabels: false,
        // Foxy brand palette. Light fills + dark text = high contrast on cheap
        // phones; brand-orange/purple borders + lines keep it colorful.
        // `themeVariables` is typed `any` upstream.
        themeVariables: {
          fontFamily:
            '"Plus Jakarta Sans", "Sora", ui-sans-serif, system-ui, sans-serif',
          fontSize: '16px',
          primaryColor: '#FFEDD5', // orange-100 node fill
          primaryTextColor: '#7C2D12', // orange-900 text (readable)
          primaryBorderColor: '#F97316', // orange-500 border (brand)
          secondaryColor: '#EDE9FE', // purple-100 fill
          secondaryTextColor: '#4C1D95', // purple-900 text
          secondaryBorderColor: '#7C3AED', // purple-600 border (brand)
          tertiaryColor: '#FFF7ED', // orange-50 fill
          tertiaryTextColor: '#7C2D12', // orange-900 text
          tertiaryBorderColor: '#FDBA74', // orange-300 border
          lineColor: '#7C3AED', // purple-600 edges (readable on white)
          textColor: '#1E293B', // slate-800 general text
          titleColor: '#1E293B', // slate-800 titles
          noteBkgColor: '#FEF3C7', // amber-100 note background
          noteTextColor: '#78350F', // amber-900 note text
          background: 'transparent',
        },
      });
      return mermaid;
    });
  }
  return mermaidModulePromise;
}

/** Monotonic id source for mermaid's temporary render element (valid DOM id). */
let mermaidRenderSeq = 0;

type MermaidRenderState =
  | { status: 'loading' }
  | { status: 'ready'; svg: string }
  | { status: 'error' };

function MermaidBlock({ block, chrome }: { block: FoxyBlock; chrome: Chrome }) {
  // Narrow via the schema guard; `title` may exist even on a malformed block.
  const mermaidBlock: FoxyMermaidBlock | null = isFoxyMermaidBlock(block)
    ? block
    : null;
  const code = mermaidBlock?.code ?? '';
  const title = mermaidBlock?.title ?? block.title;

  const [state, setState] = useState<MermaidRenderState>({ status: 'loading' });

  useEffect(() => {
    let mounted = true;

    if (!code.trim()) {
      setState({ status: 'error' });
      return;
    }

    setState({ status: 'loading' });
    const renderId = `foxy-mmd-${(mermaidRenderSeq += 1)}`;

    (async () => {
      try {
        const mermaid = await loadMermaid();
        // Validate first: `suppressErrors` returns `false` on an invalid
        // diagram instead of throwing, so a bad spec degrades quietly.
        const valid = await mermaid.parse(code, { suppressErrors: true });
        if (!valid) {
          if (mounted) setState({ status: 'error' });
          return;
        }
        const { svg } = await mermaid.render(renderId, code);
        if (mounted) setState({ status: 'ready', svg });
      } catch {
        // Any runtime failure (render throw, flaky-4G chunk-load failure, an
        // edge case parse missed) degrades to the quiet fallback below.
        if (mounted) setState({ status: 'error' });
      }
    })();

    return () => {
      mounted = false;
    };
  }, [code]);

  const hasTitle = typeof title === 'string' && title.trim().length > 0;
  const ariaLabel = hasTitle ? (title as string) : chrome.diagram;

  if (state.status === 'error') {
    // Quiet, friendly, bilingual. Falls back to the optional `title` so the
    // student still sees the caption even when the drawing failed.
    return (
      <div
        className="my-3 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-sm"
        role="note"
      >
        <span className="mr-1.5" aria-hidden="true">
          🖼️
        </span>
        {chrome.diagramFailed}
        {hasTitle && (
          <span className="mt-1 block text-xs italic text-slate-500">
            {title}
          </span>
        )}
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div
        className="my-3 flex items-center justify-center rounded-xl bg-slate-50 border border-slate-200 px-4 py-6 text-sm text-slate-400"
        role="status"
        aria-live="polite"
      >
        {chrome.diagramLoading}
      </div>
    );
  }

  // Ready. mermaid rendered with securityLevel:'strict' → the SVG string is
  // DOMPurify-sanitised by mermaid before it reaches us, so injecting it via
  // dangerouslySetInnerHTML is safe (defense-in-depth with the schema gate).
  // Responsive: SVG scales to container width; scrolls under a capped height on
  // small screens. role="img" + aria-label from the title for a11y.
  return (
    <figure className="my-3">
      <div
        role="img"
        aria-label={ariaLabel}
        className="flex justify-center overflow-auto rounded-xl border border-orange-100 bg-white p-3 max-h-[70vh] [&_svg]:h-auto [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
      {hasTitle && (
        <figcaption className="mt-1.5 text-center text-xs italic text-slate-500">
          {title}
        </figcaption>
      )}
    </figure>
  );
}

function BlockRouter({
  block,
  stepNumber,
  cfg,
  chrome,
  onReportIssue,
  quizMe,
}: BlockProps) {
  switch (block.type) {
    case 'paragraph':
      return <ParagraphBlock block={block} />;
    case 'step':
      // stepNumber is non-null for step blocks (computed in the parent loop).
      return (
        <StepBlock block={block} stepNumber={stepNumber ?? 1} cfg={cfg} />
      );
    case 'math':
      return (
        <MathBlock
          block={block}
          chrome={chrome}
          onReportIssue={onReportIssue}
        />
      );
    case 'answer':
      return <AnswerBlock block={block} chrome={chrome} />;
    case 'exam_tip':
      return <ExamTipBlock block={block} chrome={chrome} />;
    case 'definition':
      return <DefinitionBlock block={block} chrome={chrome} />;
    case 'example':
      return <ExampleBlock block={block} chrome={chrome} />;
    case 'question':
      return <QuestionBlock block={block} chrome={chrome} />;
    case 'mcq':
      return <McqBlock block={block} chrome={chrome} quizMe={quizMe} />;
    case 'diagram':
      return <DiagramBlock block={block} chrome={chrome} />;
    case 'mermaid':
      return <MermaidBlock block={block} chrome={chrome} />;
    case 'code':
      return <CodeBlock block={block} />;
    case 'vertical_math':
      // One-math-pipeline rule (docs/math-rendering-spec.md): VerticalMathBlock
      // is a sanctioned SIBLING structured-block renderer (like mermaid) for
      // columnar arithmetic layout only. Audited 2026-07-20: it carries NO
      // KaTeX/markdown/normalizer logic of its own. Any LaTeX rendering must
      // stay in the canonical packages/ui/src/math/ module — do not add math
      // string-processing to VerticalMathBlock.
      if (isFoxyVerticalMathBlock(block)) {
        return <VerticalMathBlock block={block} />;
      }
      return null;
    case 'map':
      if (isFoxyMapBlock(block)) {
        return <MapBlock block={block} />;
      }
      return null;
    default:
      // Defensive (P12 fail-safe): render text/latex as plain paragraph
      // so the user still sees something for unknown block types.
      return (
        <p className="my-2 leading-relaxed text-sm text-slate-700">
          {(block as FoxyBlock).text || (block as FoxyBlock).latex || ''}
        </p>
      );
  }
}

// ── Main component ──────────────────────────────────────────────────────────

function FoxyStructuredRendererInner({
  response,
  subjectKey,
  onReportIssue,
  quizMe,
}: FoxyStructuredRendererProps) {
  const { isHi } = useAuth();
  const chrome: Chrome = isHi ? CHROME.hi : CHROME.en;

  const lookup = useSubjectLookup();
  const resolved = lookup(subjectKey ?? response.subject);
  const cfg = resolved
    ? { icon: resolved.icon, color: resolved.color }
    : DEFAULT_CFG;

  // Step numbering: auto-number consecutive `step` blocks starting at 1; reset
  // on any non-step block. Computed once per `response` to avoid re-walking
  // the array on each child render.
  const stepNumbers = useMemo(() => {
    const out: Array<number | null> = [];
    let counter = 0;
    for (const b of response.blocks) {
      if (b.type === 'step') {
        counter += 1;
        out.push(counter);
      } else {
        counter = 0;
        out.push(null);
      }
    }
    return out;
  }, [response.blocks]);

  // Stabilise the report-issue callback so memoised child blocks don't
  // re-render purely because the parent re-rendered.
  const handleReportIssue = useCallback(() => {
    onReportIssue?.();
  }, [onReportIssue]);

  // Part B1: the evidential binding applies to ONE served item per turn, so it
  // is wired to the FIRST mcq block only. Any further mcq blocks (rare) render
  // as self-check practice.
  const firstMcqIndex = useMemo(
    () => response.blocks.findIndex((b) => b.type === 'mcq'),
    [response.blocks],
  );

  return (
    <div className="foxy-structured" data-testid="foxy-structured-renderer">
      <h3
        className="flex items-center gap-2 text-base font-bold mb-2 pb-2 border-b"
        style={{ borderColor: `${cfg.color}30` }}
      >
        <span aria-hidden="true">{cfg.icon}</span>
        <span style={{ color: cfg.color }}>{response.title}</span>
      </h3>
      <div className="space-y-1">
        {response.blocks.map((block, i) => (
          <BlockRouter
            key={i}
            block={block}
            stepNumber={stepNumbers[i]}
            cfg={cfg}
            chrome={chrome}
            onReportIssue={onReportIssue ? handleReportIssue : undefined}
            quizMe={i === firstMcqIndex ? quizMe : undefined}
          />
        ))}
      </div>
    </div>
  );
}

export const FoxyStructuredRenderer = memo(FoxyStructuredRendererInner);
export default FoxyStructuredRenderer;
