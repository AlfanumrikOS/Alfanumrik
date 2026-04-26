'use client';

// src/app/super-admin/misconceptions/page.tsx
// Phase 3 of Foxy moat plan — editorial curator surface for misconception
// annotations. Sits on top of the misconception_candidates view + the
// /api/super-admin/misconceptions endpoint.
//
// UX pattern:
//   1. Backlog tab (default): pending candidates sorted by wrong_rate desc.
//   2. Done tab: already-curated entries (audit / edit).
//   3. Inline form per row: enter misconception_code (slug) + label + Hindi.
//   4. Submit -> POST -> row drops out of backlog, count updates.
//
// Editors should aim for ~1-2 minute per annotation; the highest-impact
// rows (90%+ wrong-rate distractors on high-volume questions) yield
// disproportionate Foxy-quality wins.

import { useEffect, useState, useCallback } from 'react';

interface Candidate {
  question_id: string;
  distractor_index: number;
  times_picked: number;
  times_wrong: number;
  total_responses: number;
  wrong_rate: number;
  question_text: string;
  options: string[];
  correct_answer_index: number;
  subject: string;
  grade: string;
  chapter_number: number | null;
  has_curated_misconception: boolean;
}

type StatusFilter = 'pending' | 'curated' | 'all';

interface ListResponse {
  items: Candidate[];
  next_cursor: string | null;
  total: number;
}

function Row({ c, onCurated }: { c: Candidate; onCurated: () => void }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [labelHi, setLabelHi] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(c.has_curated_misconception);

  const distractor = c.options?.[c.distractor_index] ?? '(missing)';
  const correct = c.options?.[c.correct_answer_index] ?? '(missing)';

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/super-admin/misconceptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: c.question_id,
          distractor_index: c.distractor_index,
          misconception_code: code.trim().toLowerCase(),
          misconception_label: label.trim(),
          misconception_label_hi: labelHi.trim() || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? 'submit_failed');
      } else {
        setDone(true);
        onCurated();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
    } finally {
      setSubmitting(false);
    }
  }, [c.question_id, c.distractor_index, code, label, labelHi, onCurated]);

  return (
    <div className="rounded-lg border border-purple-200 bg-white p-4 mb-3">
      <div className="text-xs text-gray-500 mb-2">
        Class {c.grade} {c.subject}
        {c.chapter_number != null ? ` · Ch. ${c.chapter_number}` : ''}
        {' · '}
        {c.times_wrong}/{c.total_responses} wrong ({(c.wrong_rate * 100).toFixed(1)}%)
      </div>
      <div className="font-medium text-gray-900 mb-2 whitespace-pre-wrap">
        {c.question_text}
      </div>
      <div className="text-sm mb-3 space-y-0.5">
        <div className="text-red-700">
          <span className="font-mono mr-2">[{c.distractor_index}]</span>
          <span className="line-through">{distractor}</span>
          <span className="ml-2 text-xs">← students pick this</span>
        </div>
        <div className="text-green-700">
          <span className="font-mono mr-2">[{c.correct_answer_index}]</span>
          {correct}
          <span className="ml-2 text-xs">← correct</span>
        </div>
      </div>

      {done ? (
        <div className="text-sm text-green-700 font-medium">✓ Curated</div>
      ) : (
        <div className="space-y-2">
          <input
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm font-mono"
            placeholder="misconception_code (e.g. confuses_mass_with_weight)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={submitting}
          />
          <input
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            placeholder="Misconception label (English, ≥5 chars)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={submitting}
          />
          <input
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
            placeholder="Hindi label (optional)"
            value={labelHi}
            onChange={(e) => setLabelHi(e.target.value)}
            disabled={submitting}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !code || !label}
              className="rounded bg-purple-600 text-white text-sm px-3 py-1 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MisconceptionsPage() {
  const [items, setItems] = useState<Candidate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [grade, setGrade] = useState<string>('');
  const [subject, setSubject] = useState<string>('');

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status, limit: '50' });
      if (grade) params.set('grade', grade);
      if (subject) params.set('subject', subject);
      const res = await fetch(`/api/super-admin/misconceptions?${params}`);
      const j: ListResponse = await res.json();
      if (!res.ok) {
        setError((j as unknown as { error?: string }).error ?? 'list_failed');
        setItems([]);
      } else {
        setItems(j.items);
        setTotal(j.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [status, grade, subject]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  return (
    <main className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-1">Misconception Curator</h1>
      <p className="text-sm text-gray-600 mb-6">
        Phase 3 of the Foxy moat plan. Each row is a wrong-answer pattern
        students fall into; tag the misconception so Foxy can name it and
        remediate next time.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex rounded border border-gray-300 overflow-hidden">
          {(['pending', 'curated', 'all'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              className={`px-3 py-1 text-sm ${
                status === s ? 'bg-purple-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
              onClick={() => setStatus(s)}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <select
          className="rounded border border-gray-300 px-2 py-1 text-sm"
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
        >
          <option value="">All grades</option>
          {['6', '7', '8', '9', '10', '11', '12'].map((g) => (
            <option key={g} value={g}>Class {g}</option>
          ))}
        </select>
        <select
          className="rounded border border-gray-300 px-2 py-1 text-sm"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        >
          <option value="">All subjects</option>
          {[
            'math', 'science', 'social_studies', 'english', 'hindi', 'sanskrit',
            'physics', 'chemistry', 'biology', 'history', 'geography',
            'political_science', 'economics', 'accountancy', 'business_studies',
            'computer_science',
          ].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="text-sm text-gray-600 ml-auto">
          {loading ? 'Loading…' : `${items.length} of ${total} shown`}
        </span>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          Error: {error}
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="rounded border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-600">
          No candidates match the current filters.
          {status === 'pending' && ' (Either everything is curated, or no questions have ≥10 responses with ≥3 wrong picks at the 10% threshold yet.)'}
        </div>
      )}

      {items.map((c) => (
        <Row
          key={`${c.question_id}:${c.distractor_index}`}
          c={c}
          onCurated={fetchList}
        />
      ))}
    </main>
  );
}
