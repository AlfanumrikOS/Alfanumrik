'use client';

import { memo, type ReactNode } from 'react';

/* ══════════════════════════════════════════════════════════════
   RICH TEXT RENDERER
   Shared component used by both /page.tsx and /foxy/page.tsx
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

function cleanMd(t: string): string {
  return t.replace(/\*\*([^*]+)\*\*/g, '[KEY: $1]').replace(/__([^_]+)__/g, '[KEY: $1]').replace(/\*([^*]+)\*/g, '$1').replace(/_([^_]+)_/g, '$1').replace(/`([^`]+)`/g, '[FORMULA: $1]').replace(/^#{1,4}\s+/gm, '');
}

function renderInline(text: string, color: string): ReactNode {
  const clean = cleanMd(text);
  const parts: ReactNode[] = [];
  const re = /\[(KEY|ANS|FORMULA|TIP|MARKS):\s*([^\]]+)\]/g;
  let m: RegExpExecArray | null, last = 0, k = 0;

  while ((m = re.exec(clean)) !== null) {
    if (m.index > last) parts.push(<span key={k++}>{clean.substring(last, m.index)}</span>);
    const [, tag, val] = m;
    if (tag === 'KEY') parts.push(<span key={k++} className="font-bold" style={{ color, borderBottom: `2px solid ${color}40`, paddingBottom: 1 }}>{val}</span>);
    else if (tag === 'ANS') parts.push(<span key={k++} className="inline-block px-3 py-1 my-1 rounded-lg font-extrabold text-sm" style={{ border: `2px solid ${color}`, color, background: `${color}08` }}>{val}</span>);
    else if (tag === 'FORMULA') parts.push(<code key={k++} className="inline-block px-3 py-1.5 my-1 rounded-lg font-semibold text-xs" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', fontFamily: 'monospace' }}>{val}</code>);
    else if (tag === 'TIP') parts.push(<div key={k++} className="my-2 px-3 py-2.5 rounded-xl text-xs" style={{ background: '#fffbeb', border: '1px solid #f59e0b30', color: '#92400e' }}><span className="font-extrabold">Exam Tip: </span>{val}</div>);
    else if (tag === 'MARKS') parts.push(<span key={k++} className="inline-block px-2 py-0.5 rounded-lg text-[11px] font-bold ml-1" style={{ background: '#7c3aed15', color: '#7c3aed' }}>({val} marks)</span>);
    last = m.index + m[0].length;
  }
  if (last < clean.length) parts.push(<span key={k++}>{clean.substring(last)}</span>);
  return parts.length > 0 ? <>{parts}</> : <span>{clean}</span>;
}

export const RichContent = memo(function RichContent({ content, subjectKey, subjectConfig }: RichContentProps) {
  const cfg = subjectConfig || SUBJECTS[subjectKey] || DEFAULT_CONFIG;
  if (!content) return null;
  const text = cleanMd(content);
  const lines = text.split('\n');
  const els: ReactNode[] = [];
  let li: string[] = [], lk: 'num' | 'bul' | null = null;

  function flush() {
    if (li.length === 0) return;
    els.push(
      <div key={`l${els.length}`} className="my-3 px-4 py-3 rounded-r-xl" style={{ background: `${cfg.color}08`, borderLeft: `3px solid ${cfg.color}` }}>
        {li.map((item, i) => (
          <div key={i} className="flex gap-2.5 py-1.5 items-start" style={{ borderBottom: i < li.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
            <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: `${cfg.color}20`, color: cfg.color }}>{lk === 'num' ? i + 1 : '•'}</span>
            <span className="leading-relaxed">{renderInline(item, cfg.color)}</span>
          </div>
        ))}
      </div>
    );
    li = []; lk = null;
  }

  lines.forEach((line, idx) => {
    const t = line.trim();
    if (t.startsWith('###')) { flush(); els.push(<h4 key={idx} className="text-sm font-bold mt-4 mb-2 uppercase tracking-wide" style={{ color: cfg.color }}>{cfg.icon} {t.replace(/^###\s*/, '')}</h4>); }
    else if (t.startsWith('##')) { flush(); els.push(<h3 key={idx} className="text-base font-bold mt-4 mb-2 pb-2" style={{ borderBottom: `2px solid ${cfg.color}30` }}>{t.replace(/^##\s*/, '')}</h3>); }
    else if (t.startsWith('>')) { flush(); els.push(<div key={idx} className="my-3 px-4 py-3 rounded-xl text-sm leading-relaxed" style={{ background: `${cfg.color}08`, border: `1px solid ${cfg.color}25` }}>{renderInline(t.replace(/^>\s*/, ''), cfg.color)}</div>); }
    else if (/^\d+[.)]\s/.test(t)) { if (lk !== 'num') { flush(); lk = 'num'; } li.push(t.replace(/^\d+[.)]\s*/, '')); }
    else if (/^[-•*]\s/.test(t)) { if (lk !== 'bul') { flush(); lk = 'bul'; } li.push(t.replace(/^[-•*]\s*/, '')); }
    else if (!t) { flush(); els.push(<div key={idx} className="h-2" />); }
    else { flush(); els.push(<p key={idx} className="my-1.5 leading-[1.75] text-[var(--text-2)]">{renderInline(t, cfg.color)}</p>); }
  });
  flush();
  return <div>{els}</div>;
});

export default RichContent;
