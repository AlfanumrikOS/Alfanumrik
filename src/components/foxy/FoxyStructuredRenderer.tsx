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

import React, { memo, useMemo, useState, useCallback } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { FoxyBlock, FoxyResponse } from '@/lib/foxy/schema';
import { useAuth } from '@/lib/AuthContext';
import { useSubjectLookup } from '@/lib/useSubjectLookup';
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
 */
function renderMath(latex: string): KatexRender {
  try {
    const html = katex.renderToString(latex, {
      throwOnError: false,
      displayMode: true,
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
      {block.text}
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
            {block.label}
          </div>
        )}
        <p className="text-sm leading-relaxed text-slate-800">{block.text}</p>
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
      <p className="text-sm leading-relaxed">{block.text}</p>
    </div>
  );
}

function ExamTipBlock({ block, chrome }: { block: FoxyBlock; chrome: Chrome }) {
  return (
    <div className="my-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
      <div className="font-bold text-sm mb-1">{chrome.examTip}</div>
      <p className="text-sm leading-relaxed">{block.text}</p>
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
      <div className="font-bold text-sm mb-1">{block.label || chrome.definition}</div>
      <p className="text-sm leading-relaxed">{block.text}</p>
    </div>
  );
}

function ExampleBlock({ block, chrome }: { block: FoxyBlock; chrome: Chrome }) {
  return (
    <div className="my-3 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800">
      <div className="italic font-semibold text-sm mb-1">{chrome.example}</div>
      <p className="text-sm leading-relaxed">{block.text}</p>
    </div>
  );
}

function QuestionBlock({ block, chrome }: { block: FoxyBlock; chrome: Chrome }) {
  return (
    <div className="my-3 px-4 py-3 rounded-xl bg-purple-50 border border-purple-200 text-purple-900">
      <div className="font-bold text-sm mb-1">{chrome.practice}</div>
      <p className="text-sm leading-relaxed">{block.text}</p>
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
