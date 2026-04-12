'use client';

import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';

/* ══════════════════════════════════════════════════════════════
   RICH TEXT RENDERER — Proper Markdown + LaTeX + Tables
   Replaces the old cleanMd() approach that destroyed markdown
   by converting backticks to [FORMULA:] markers.
   ══════════════════════════════════════════════════════════════ */

export interface RichContentProps {
  content: string;
  subjectKey: string;
  subjectConfig?: { color: string; icon: string };
}

const SUBJECTS: Record<string, { icon: string; color: string }> = {
  math: { icon: '∑', color: '#3B82F6' },
  science: { icon: '⚛', color: '#10B981' },
  english: { icon: 'Aa', color: '#8B5CF6' },
  hindi: { icon: 'अ', color: '#F59E0B' },
  physics: { icon: '⚡', color: '#EF4444' },
  chemistry: { icon: '⚗', color: '#06B6D4' },
  biology: { icon: '⚕', color: '#22C55E' },
  social_studies: { icon: '🌍', color: '#D97706' },
  coding: { icon: '💻', color: '#6366F1' },
};

const DEFAULT_CONFIG = SUBJECTS.science;

/**
 * Clean legacy markers from old stored messages.
 * Old RichContent converted markdown to [FORMULA:], [KEY:] etc.
 * Convert them back to standard markdown so ReactMarkdown renders them.
 */
function cleanLegacyMarkers(content: string): string {
  return content
    .replace(/\[FORMULA:\s*([^\]]+)\]/g, '`$1`')
    .replace(/\[KEY:\s*([^\]]+)\]/g, '**$1**')
    .replace(/\[DIAGRAM:\s*([^\]]+)\]/g, '*Diagram: $1*')
    .replace(/\[EXAMPLE:\s*([^\]]+)\]/g, '> $1')
    .replace(/\[ANS:\s*([^\]]+)\]/g, '**$1**')
    .replace(/\[TIP:\s*([^\]]+)\]/g, '> **Exam Tip:** $1')
    .replace(/\[MARKS:\s*([^\]]+)\]/g, ' *($1 marks)*');
}

export const RichContent = memo(function RichContent({ content, subjectKey, subjectConfig }: RichContentProps) {
  const cfg = subjectConfig || SUBJECTS[subjectKey] || DEFAULT_CONFIG;
  if (!content) return null;

  const cleaned = cleanLegacyMarkers(content);

  const rendered = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        h1: ({ children }) => (
          <h3 className="text-base font-bold mt-4 mb-2 pb-2" style={{ borderBottom: `2px solid ${cfg.color}30` }}>
            {children}
          </h3>
        ),
        h2: ({ children }) => (
          <h3 className="text-base font-bold mt-4 mb-2 pb-2" style={{ borderBottom: `2px solid ${cfg.color}30` }}>
            {children}
          </h3>
        ),
        h3: ({ children }) => (
          <h4 className="text-sm font-bold mt-4 mb-2 uppercase tracking-wide" style={{ color: cfg.color }}>
            {cfg.icon} {children}
          </h4>
        ),
        h4: ({ children }) => (
          <h5 className="text-sm font-semibold mt-3 mb-1" style={{ color: cfg.color }}>{children}</h5>
        ),
        p: ({ children }) => (
          <p className="my-1.5 leading-[1.75] text-[var(--text-2)]">{children}</p>
        ),
        strong: ({ children }) => (
          <span className="font-bold" style={{ color: cfg.color, borderBottom: `2px solid ${cfg.color}40`, paddingBottom: 1 }}>
            {children}
          </span>
        ),
        em: ({ children }) => (
          <em className="not-italic text-purple-700">{children}</em>
        ),
        code: ({ className, children, ...props }) => {
          const isBlock = className?.includes('language-');
          if (isBlock) {
            return (
              <pre className="my-2 rounded-xl overflow-x-auto" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <code className={`block px-4 py-3 text-xs font-mono ${className || ''}`} {...props}>
                  {children}
                </code>
              </pre>
            );
          }
          return (
            <code
              className="inline-block max-w-full px-2 py-0.5 rounded-lg font-semibold text-xs"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', fontFamily: 'monospace', overflowWrap: 'break-word' }}
              {...props}
            >
              {children}
            </code>
          );
        },
        blockquote: ({ children }) => (
          <div className="my-3 px-4 py-3 rounded-xl text-sm leading-relaxed"
            style={{ background: `${cfg.color}08`, border: `1px solid ${cfg.color}25` }}>
            {children}
          </div>
        ),
        ul: ({ children }) => (
          <div className="my-3 px-4 py-3 rounded-r-xl" style={{ background: `${cfg.color}08`, borderLeft: `3px solid ${cfg.color}` }}>
            {children}
          </div>
        ),
        ol: ({ children }) => (
          <div className="my-3 px-4 py-3 rounded-r-xl" style={{ background: `${cfg.color}08`, borderLeft: `3px solid ${cfg.color}` }}>
            {children}
          </div>
        ),
        li: ({ children }) => (
          <div className="flex gap-2.5 py-1.5 items-start" style={{ borderBottom: '1px solid #f0f0f0' }}>
            <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: `${cfg.color}20`, color: cfg.color }}>
              {'\u2022'}
            </span>
            <span className="leading-relaxed text-[var(--text-2)]">{children}</span>
          </div>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead style={{ background: `${cfg.color}10` }}>{children}</thead>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left text-xs font-bold" style={{ color: cfg.color, borderBottom: `2px solid ${cfg.color}30` }}>
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 text-sm border-b border-gray-100">{children}</td>
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-800">
            {children}
          </a>
        ),
        hr: () => <div className="h-2" />,
      }}
    >
      {cleaned}
    </ReactMarkdown>
  );

  // Wrap in collapsible container for long responses
  const COLLAPSE_THRESHOLD = 800; // characters, not elements
  if (cleaned.length > COLLAPSE_THRESHOLD) {
    return <CollapsibleContent content={rendered} fullLength={cleaned.length} threshold={COLLAPSE_THRESHOLD} color={cfg.color} />;
  }

  return <div className="overflow-hidden rich-content" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>{rendered}</div>;
});

function CollapsibleContent({ content, fullLength, threshold, color }: { content: ReactNode; fullLength: number; threshold: number; color: string }) {
  const [expanded, setExpanded] = useState(fullLength <= threshold);

  return (
    <div className="overflow-hidden rich-content" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>
      <div style={expanded ? {} : { maxHeight: '300px', overflow: 'hidden', maskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)' }}>
        {content}
      </div>
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-2 text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95"
          style={{ background: `${color}10`, color, border: `1px solid ${color}25` }}
        >
          Show full response
        </button>
      )}
      {expanded && fullLength > threshold && (
        <button
          onClick={() => setExpanded(false)}
          className="mt-2 text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95"
          style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
        >
          Show less
        </button>
      )}
    </div>
  );
}

export default RichContent;