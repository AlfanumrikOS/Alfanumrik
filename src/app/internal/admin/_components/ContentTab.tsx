'use client';

/**
 * ContentTab — internal-admin Content CMS tab.
 *
 * Extracted from src/app/internal/admin/page.tsx as part of Plan 5 Task 7.
 * Behaviour preserved verbatim:
 *   - GET /api/internal/admin/content?resource=&page=&limit=25 with optional
 *     subject / grade / search filters — { data, total }
 *   - View toggle: 'topics' | 'questions'
 *   - Subject + grade selects, search input
 *   - Two table renderings (topics / questions)
 *   - Pagination (Prev / Next, page#)
 *
 * Visual styling kept on the legacy `S.*` / `C.*` dark-theme tokens.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAdminFetch } from '../_hooks/useAdminFetch';
import type { Topic, Question } from '../_lib/internal-admin-types';

const C = {
  bg2: '#0d1117',
  border: '#21262d',
  text1: '#e6edf3',
  text2: '#8b949e',
  text3: '#484f58',
  orange: '#E8581C',
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#f59e0b',
  red: '#ef4444',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  badge: (color: string, bg?: string): React.CSSProperties => ({
    fontSize: 10, padding: '2px 8px', borderRadius: 10,
    background: bg || `${color}18`, color,
    fontWeight: 600, whiteSpace: 'nowrap' as const,
  }),
  btn: (color: string = C.orange): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    background: `${color}15`, color, border: `1px solid ${color}30`,
    transition: 'all 0.15s',
  }),
  input: { padding: '7px 12px', borderRadius: 7, border: `1px solid ${C.border}`, background: C.bg2, color: C.text1, fontSize: 12, outline: 'none', fontFamily: 'inherit' },
  select: { padding: '7px 12px', borderRadius: 7, border: `1px solid ${C.border}`, background: C.bg2, color: C.text1, fontSize: 12, outline: 'none', fontFamily: 'inherit', cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: { textAlign: 'left' as const, padding: '9px 12px', borderBottom: `1px solid ${C.border}`, color: C.text3, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 1.2, whiteSpace: 'nowrap' as const },
  td: { padding: '9px 12px', borderBottom: `1px solid ${C.bg2}`, color: C.text2, verticalAlign: 'middle' as const },
};

export interface ContentTabProps {
  secret: string;
}

export default function ContentTab({ secret }: ContentTabProps) {
  const apiFetch = useAdminFetch(secret);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicTotal, setTopicTotal] = useState(0);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionTotal, setQuestionTotal] = useState(0);
  const [contentView, setContentView] = useState<'topics' | 'questions'>('topics');
  const [contentSubject, setContentSubject] = useState('');
  const [contentGrade, setContentGrade] = useState('');
  const [contentSearch, setContentSearch] = useState('');
  const [contentPage, setContentPage] = useState(1);

  const fetchContent = useCallback(async () => {
    const p = new URLSearchParams({
      resource: contentView,
      page: String(contentPage),
      limit: '25',
    });
    if (contentSubject) p.set('subject', contentSubject);
    if (contentGrade) p.set('grade', contentGrade);
    if (contentSearch) p.set('search', contentSearch);
    try {
      const d = await apiFetch<{ data: Topic[] | Question[]; total: number }>(
        `/api/internal/admin/content?${p}`,
      );
      if (contentView === 'topics') {
        setTopics((d.data as Topic[]) || []);
        setTopicTotal(d.total || 0);
      } else {
        setQuestions((d.data as Question[]) || []);
        setQuestionTotal(d.total || 0);
      }
    } catch { /* preserve pre-refactor "if (res.ok)" silent failure */ }
  }, [apiFetch, contentView, contentPage, contentSubject, contentGrade, contentSearch]);

  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Content CMS</div>
        <button onClick={fetchContent} style={S.btn()}>↻ Refresh</button>
      </div>

      {/* View toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {(['topics', 'questions'] as const).map(v => (
          <button key={v} onClick={() => { setContentView(v); setContentPage(1); }}
            style={{ ...S.btn(), ...(contentView === v ? { background: `${C.orange}20`, borderColor: C.orange } : {}) }}>
            {v === 'topics' ? '📖 Topics' : '❓ Questions'}
          </button>
        ))}
        <select value={contentSubject} onChange={e => { setContentSubject(e.target.value); setContentPage(1); }} style={S.select}>
          <option value="">All Subjects</option>
          {['math', 'science', 'english', 'social_science', 'hindi'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={contentGrade} onChange={e => { setContentGrade(e.target.value); setContentPage(1); }} style={S.select}>
          <option value="">All Grades</option>
          {['6','7','8','9','10','11','12'].map(g => <option key={g} value={g}>Grade {g}</option>)}
        </select>
        <input value={contentSearch} onChange={e => { setContentSearch(e.target.value); setContentPage(1); }}
          placeholder="Search..." style={{ ...S.input, width: 180 }} />
      </div>

      {contentView === 'topics' && (
        <>
          <div style={{ fontSize: 11, color: C.text3, marginBottom: 8 }}>{topicTotal} topics</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Subject</th><th style={S.th}>Grade</th>
                  <th style={S.th}>Ch.</th><th style={S.th}>Title</th>
                  <th style={S.th}>Order</th><th style={S.th}>Difficulty</th>
                  <th style={S.th}>Est. Min</th><th style={S.th}>Active</th>
                </tr>
              </thead>
              <tbody>
                {topics.map(t => (
                  <tr key={t.id}>
                    <td style={S.td}>{t.subject?.code || '—'}</td>
                    <td style={S.td}>{t.grade}</td>
                    <td style={S.td}>{t.chapter_number}</td>
                    <td style={{ ...S.td, fontWeight: 600, color: C.text1, maxWidth: 260 }}>{t.title}</td>
                    <td style={S.td}>{t.display_order}</td>
                    <td style={S.td}><span style={S.badge(t.difficulty_level === 'hard' ? C.red : t.difficulty_level === 'medium' ? C.yellow : C.green)}>{t.difficulty_level || '—'}</span></td>
                    <td style={S.td}>{t.estimated_minutes || '—'}</td>
                    <td style={S.td}><span style={S.badge(t.is_active ? C.green : C.text3)}>{t.is_active ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {contentView === 'questions' && (
        <>
          <div style={{ fontSize: 11, color: C.text3, marginBottom: 8 }}>{questionTotal} questions</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Subject</th><th style={S.th}>Grade</th>
                  <th style={S.th}>Ch.</th><th style={S.th}>Question</th>
                  <th style={S.th}>Type</th><th style={S.th}>Difficulty</th>
                  <th style={S.th}>Bloom</th><th style={S.th}>Active</th><th style={S.th}>Verified</th>
                </tr>
              </thead>
              <tbody>
                {questions.map(q => (
                  <tr key={q.id}>
                    <td style={S.td}>{q.subject}</td>
                    <td style={S.td}>{q.grade}</td>
                    <td style={S.td}>{q.chapter_number}</td>
                    <td style={{ ...S.td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.question_text}</td>
                    <td style={S.td}><span style={S.badge(C.blue)}>{q.question_type}</span></td>
                    <td style={S.td}><span style={S.badge(q.difficulty === 'hard' ? C.red : q.difficulty === 'medium' ? C.yellow : C.green)}>{q.difficulty || '—'}</span></td>
                    <td style={S.td}>{q.bloom_level || '—'}</td>
                    <td style={S.td}><span style={S.badge(q.is_active ? C.green : C.red)}>{q.is_active ? 'Yes' : 'No'}</span></td>
                    <td style={S.td}><span style={S.badge(q.is_verified ? C.green : C.text3)}>{q.is_verified ? '✓' : '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center', alignItems: 'center' }}>
        <button disabled={contentPage <= 1} onClick={() => setContentPage(p => p - 1)} style={S.btn()}>← Prev</button>
        <span style={{ fontSize: 12, color: C.text3 }}>Page {contentPage}</span>
        <button disabled={(contentView === 'topics' ? topics : questions).length < 25} onClick={() => setContentPage(p => p + 1)} style={S.btn()}>Next →</button>
      </div>
    </div>
  );
}
