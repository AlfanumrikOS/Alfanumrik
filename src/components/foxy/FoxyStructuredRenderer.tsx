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

import React, { memo, useMemo, useState, useCallback, useEffect } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { FoxyBlock, FoxyResponse } from '@/lib/foxy/schema';
import { isFoxyMcqBlock } from '@/lib/foxy/schema';
import { useAuth } from '@/lib/AuthContext';
import { useSubjectLookup } from '@/lib/useSubjectLookup';
import { DiagramViewer } from '@/components/DiagramViewer';
import { supabase } from '@/lib/supabase-client';
// Re-exported below so existing imports of `isFoxyResponse` from this module
// keep working. The implementation lives in `@/lib/foxy/is-foxy-response` so
// callers can import the discriminator without pulling KaTeX into the
// synchronous bundle (P10).
import { isFoxyResponse as isFoxyResponseImpl } from '@/lib/foxy/is-foxy-response';

// ── Props ────────────────────────────────────────────────────────────────────

export interface FoxyStructuredRendererProps {
  /** Validated structured payload from FoxyResponseSchema. */
  response: FoxyResponse;
  /** Optional subject code override; defaults to `response.subject`. */
  subjectKey?: string;
  /** Invoked when a math block fails to render (renderer surfaces a button). */
  onReportIssue?: () => void;
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
  // MCQ self-check chrome (Phase 1 learning actions — formative, no submission)
  mcqCheck: string;
  mcqCorrect: string;
  mcqNotQuite: string;
  mcqWhy: string;
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
    mcqCheck: 'Check',
    mcqCorrect: 'Correct!',
    mcqNotQuite: 'Not quite',
    mcqWhy: 'Why',
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
    mcqCheck: 'जांचें',
    mcqCorrect: 'सही!',
    mcqNotQuite: 'लगभग',
    mcqWhy: 'कारण',
  },
};

// ── Default visual config (used while subject lookup is hydrating) ───────────

const DEFAULT_CFG = { icon: '⚛', color: '#10B981' }; // green atom

// ── Public type guard ────────────────────────────────────────────────────────

/**
 * Cheap shape check for `FoxyResponse`. Used by callers (e.g. ChatBubble) to
 * decide between this renderer and the legacy markdown renderer.
 *
 * The implementation lives in `@/lib/foxy/is-foxy-response` so the predicate
 * can be imported without dragging KaTeX into the synchronous bundle. This
 * file re-exports it under the same name for backward compatibility with
 * existing call sites and tests.
 */
export const isFoxyResponse = isFoxyResponseImpl;

// ── KaTeX rendering ──────────────────────────────────────────────────────────

interface KatexRender {
  ok: boolean;
  html: string;
}

/**
 * Sync KaTeX render. With `throwOnError: false`, KaTeX returns an error span
 * for malformed input rather than throwing — but defensively we wrap in
 * try/catch so any unexpected runtime error (e.g. KaTeX internal asserts)
 * still degrades to the fallback.
 *
 * `displayMode` selects block (centred, larger) vs inline rendering. The
 * dedicated `math` block uses display mode; inline LaTeX inside prose text
 * (`\( … \)`, `$ … $`) uses inline mode via `renderInline` below.
 */
function renderMath(latex: string, displayMode = true): KatexRender {
  try {
    const html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode,
      output: 'html',
      strict: 'ignore',
    });
    // KaTeX with throwOnError:false emits a span with class
    // "katex-error" for malformed input. Treat that as a soft failure so the
    // caller can surface the report-issue button.
    if (html.includes('katex-error')) {
      return { ok: false, html };
    }
    return { ok: true, html };
  } catch {
    return { ok: false, html: '' };
  }
}

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

type InlineSegment =
  | { kind: 'text'; value: string }
  | { kind: 'math'; latex: string; display: boolean };

/**
 * Split a prose string into ordered text / math segments.
 *
 * Recognised math delimiters (longest/most-specific matched first so `$$`
 * wins over `$` and `\[`/`\(` are not mistaken for stray backslashes):
 *   - `\[ … \]`  → display math
 *   - `$$ … $$`  → display math
 *   - `\( … \)`  → inline math
 *   - `$ … $`    → inline math (single, non-greedy; ignores escaped `\$`)
 *
 * Escaped `\$` is treated as a literal dollar and never opens/closes a `$`
 * math span. Only the INNER LaTeX (delimiters stripped) is handed to KaTeX.
 * Unterminated delimiters are left as literal text (no crash, no swallow).
 */
export function tokenizeInline(input: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let buf = '';
  let i = 0;
  const n = input.length;

  const flushText = () => {
    if (buf) {
      segments.push({ kind: 'text', value: buf });
      buf = '';
    }
  };

  while (i < n) {
    const ch = input[i];
    const next = input[i + 1];

    // Escaped dollar: literal `$`, consume both chars, never a delimiter.
    if (ch === '\\' && next === '$') {
      buf += '$';
      i += 2;
      continue;
    }

    // Display math: \[ … \]
    if (ch === '\\' && next === '[') {
      const close = input.indexOf('\\]', i + 2);
      if (close !== -1) {
        flushText();
        segments.push({
          kind: 'math',
          latex: input.slice(i + 2, close).trim(),
          display: true,
        });
        i = close + 2;
        continue;
      }
    }

    // Inline math: \( … \)
    if (ch === '\\' && next === '(') {
      const close = input.indexOf('\\)', i + 2);
      if (close !== -1) {
        flushText();
        segments.push({
          kind: 'math',
          latex: input.slice(i + 2, close).trim(),
          display: false,
        });
        i = close + 2;
        continue;
      }
    }

    // Display math: $$ … $$
    if (ch === '$' && next === '$') {
      const close = input.indexOf('$$', i + 2);
      if (close !== -1) {
        flushText();
        segments.push({
          kind: 'math',
          latex: input.slice(i + 2, close).trim(),
          display: true,
        });
        i = close + 2;
        continue;
      }
    }

    // Inline math: $ … $ (single). Scan for the next unescaped `$`.
    if (ch === '$') {
      let j = i + 1;
      let found = -1;
      while (j < n) {
        if (input[j] === '\\' && input[j + 1] === '$') {
          j += 2;
          continue;
        }
        if (input[j] === '$') {
          found = j;
          break;
        }
        j += 1;
      }
      if (found !== -1 && found > i + 1) {
        const inner = input.slice(i + 1, found).replace(/\\\$/g, '$').trim();
        flushText();
        segments.push({ kind: 'math', latex: inner, display: false });
        i = found + 1;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }

  flushText();
  return segments;
}

/**
 * Parse a plain-text (non-math) segment into React nodes, applying inline
 * markdown emphasis. Only `**bold**`/`__bold__` → <strong> and
 * `*italic*`/`_italic_` → <em> are recognised. No raw `**`/`__`/`*`/`_` may
 * leak through for well-formed markers. Output is a flat list of strings and
 * <strong>/<em> elements — never arbitrary HTML (XSS-safe).
 *
 * Bold is matched before italic so `**x**` is not mis-parsed as nested
 * italics. Markers must wrap non-empty, non-whitespace-only content.
 */
function renderMarkdownInline(text: string, keyPrefix: string): React.ReactNode[] {
  // Single pass over the four marker styles. `**`/`__` (bold) before `*`/`_`
  // (italic) so the greedier bold delimiter wins.
  //
  // A FRESH RegExp is instantiated per call (not a shared module-level
  // constant) because this function recurses into matched bodies. A shared
  // /g regex carries `lastIndex` across calls, so a recursive inner call would
  // corrupt the outer loop's cursor — an infinite-growth bug. Per-call
  // instances each own their `lastIndex`.
  const TOKEN = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1|(\*|_)(?=\S)(.+?)(?<=\S)\3/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;

  while ((m = TOKEN.exec(text)) !== null) {
    if (m.index > last) {
      out.push(text.slice(last, m.index));
    }
    if (m[1] !== undefined) {
      // Bold: recurse so `**a *b* c**` keeps inner italics.
      out.push(
        <strong key={`${keyPrefix}-b${k}`}>
          {renderMarkdownInline(m[2], `${keyPrefix}-b${k}`)}
        </strong>,
      );
    } else {
      out.push(
        <em key={`${keyPrefix}-i${k}`}>
          {renderMarkdownInline(m[4], `${keyPrefix}-i${k}`)}
        </em>,
      );
    }
    last = m.index + m[0].length;
    k += 1;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return out;
}

/**
 * `InlineContent` — render a prose string with inline math + markdown emphasis.
 *
 * Used by every text-bearing block (and block labels). Plain text passes
 * through React (escaped). Math segments render via KaTeX; a KaTeX failure
 * degrades to a `<code>` span so a malformed `\( \frac{1}{ \)` never crashes
 * the chat list (P12).
 */
function InlineContent({ text }: { text: string | undefined }) {
  const nodes = useMemo<React.ReactNode[]>(() => {
    if (!text) return [];
    const segments = tokenizeInline(text);
    return segments.map((seg, idx) => {
      if (seg.kind === 'math') {
        const rendered = renderMath(seg.latex, seg.display);
        if (!rendered.ok) {
          // Graceful degradation — show the raw inner expression as code.
          return (
            <code
              key={`m${idx}`}
              className="px-1 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[0.85em] text-slate-700"
            >
              {seg.latex}
            </code>
          );
        }
        return (
          <span
            key={`m${idx}`}
            // KaTeX output is a fixed, sanitised span/MathML tree — no script
            // or event handlers. Safe to inject.
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />
        );
      }
      return (
        <React.Fragment key={`t${idx}`}>
          {renderMarkdownInline(seg.value, `t${idx}`)}
        </React.Fragment>
      );
    });
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

/**
 * McqBlock — formative self-check MCQ (Phase 1 Foxy learning actions).
 *
 * P1/P2/P4 contract: this is SELF-CHECK ONLY. Selecting an option reveals
 * correctness locally — it does NOT submit to /api/tutor/answer or any mastery
 * route, awards no XP, and never touches the scoring pipeline. Only a real
 * "Quiz me" answer feeds mastery, and it does so through the existing
 * concept-check path, never here.
 *
 * A11y: each option is a real <button> with role="radio" + aria-checked so the
 * group is keyboard-operable and screen-reader-announced; the chosen + correct
 * options are flagged after a check so colour is not the only signal.
 */
function McqBlock({ block, chrome }: { block: FoxyBlock; chrome: Chrome }) {
  const [selected, setSelected] = useState<number | null>(null);

  // Defensive: only render if the block is a structurally valid MCQ. The
  // schema already guarantees this at the API boundary, but the renderer must
  // never throw on a malformed historical/legacy row.
  if (!isFoxyMcqBlock(block)) return null;

  const { stem, options, correct_answer_index, explanation } = block;
  const answered = selected !== null;
  const isRight = answered && selected === correct_answer_index;

  return (
    <div
      className="my-3 px-4 py-3 rounded-xl bg-purple-50 border border-purple-200 text-purple-900"
      data-testid="foxy-mcq-block"
    >
      <div className="font-bold text-sm mb-2">{chrome.practice}</div>
      <p className="text-sm leading-relaxed mb-3">
        <InlineContent text={stem} />
      </p>

      <div role="radiogroup" aria-label={stem} className="space-y-2">
        {options.map((opt, i) => {
          const isChosen = selected === i;
          const isCorrect = i === correct_answer_index;
          // Colour states only resolve AFTER a check.
          let cls =
            'w-full text-left px-3 py-2 rounded-lg border text-sm transition-all active:scale-[0.99] flex items-start gap-2 min-h-[44px]';
          if (!answered) {
            cls += ' bg-white border-purple-200 hover:bg-purple-100/50';
          } else if (isCorrect) {
            // Always highlight the correct option green once checked.
            cls += ' bg-emerald-50 border-emerald-300 text-emerald-900 font-semibold';
          } else if (isChosen) {
            // Chosen-but-wrong → red.
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
              disabled={answered}
              onClick={() => { if (!answered) setSelected(i); }}
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
        </div>
      )}
    </div>
  );
}

function BlockRouter({
  block,
  stepNumber,
  cfg,
  chrome,
  onReportIssue,
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
      return <McqBlock block={block} chrome={chrome} />;
    case 'diagram':
      return <DiagramBlock block={block} chrome={chrome} />;
    case 'code':
      return <CodeBlock block={block} />;
    default:
      // Defensive: should never hit due to schema enum, but if a future
      // block type is added without updating this switch, render the text
      // (or latex) as a plain paragraph so the user still sees something.
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
          />
        ))}
      </div>
    </div>
  );
}

export const FoxyStructuredRenderer = memo(FoxyStructuredRendererInner);
export default FoxyStructuredRenderer;
