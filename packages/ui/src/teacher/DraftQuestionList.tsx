'use client';

/**
 * DraftQuestionList — K5 "Draft with AI" per-question edit surface for the
 * teacher assignments page. The teacher-dashboard `generate_draft_assignment`
 * action returns a list of candidate questions; per row the teacher can:
 *   - keep (no-op),
 *   - regenerate (asks the server for a replacement question at the same slot),
 *   - edit (opens an inline text/options editor; on save the deterministic
 *     validator runs client-side for UX. The EF is authoritative — it
 *     re-validates on publish, so client validation is a hint, never a gate.)
 *
 * P6 discipline: 4 distinct non-empty options + `correct_answer_index ∈ 0..3`.
 * P7 bilingual. P13 no PII.
 */

import { useState } from 'react';
import { validateDraftQuestion, type DraftQuestion } from '@alfanumrik/lib/teacher/draft-question-validator';

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

export type { DraftQuestion } from '@alfanumrik/lib/teacher/draft-question-validator';

export interface DraftQuestionListProps {
  drafts: DraftQuestion[];
  isHi: boolean;
  busy?: boolean;
  onEdit: (index: number, next: DraftQuestion) => void;
  onRegenerate: (index: number) => void;
}

function QuestionEditor({
  q,
  isHi,
  onSave,
  onCancel,
}: {
  q: DraftQuestion;
  isHi: boolean;
  onSave: (next: DraftQuestion) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(q.question_text);
  const [options, setOptions] = useState<string[]>([...q.options]);
  const [correctIdx, setCorrectIdx] = useState<number>(q.correct_answer_index);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const next: DraftQuestion = {
      ...q,
      question_text: text,
      options,
      correct_answer_index: correctIdx,
    };
    const problem = validateDraftQuestion(next);
    if (problem) {
      setError(problem);
      return;
    }
    onSave(next);
  };
  return (
    <div
      className="rounded-lg p-2.5 flex flex-col gap-2"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        className="w-full rounded-md text-[13px] py-1.5 px-2 outline-none"
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-1)',
        }}
      />
      {options.map((opt, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <input
            type="radio"
            name={`correct-${q.id}`}
            checked={correctIdx === i}
            onChange={() => setCorrectIdx(i)}
            aria-label={t(isHi, 'Correct answer', 'सही उत्तर')}
          />
          <input
            type="text"
            value={opt}
            onChange={(e) => {
              const next = [...options];
              next[i] = e.target.value;
              setOptions(next);
            }}
            className="flex-1 rounded-md text-[12px] py-1 px-2 outline-none"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
          />
        </div>
      ))}
      {error && (
        <p className="text-[11px] m-0" style={{ color: 'var(--danger, #DC2626)' }}>
          {error}
        </p>
      )}
      <div className="flex gap-1.5 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="py-1 px-2 rounded-md text-[11px] font-semibold cursor-pointer"
          style={{
            background: 'transparent',
            color: 'var(--text-3)',
            border: '1px solid var(--border)',
          }}
        >
          {t(isHi, 'Cancel', 'रद्द')}
        </button>
        <button
          type="button"
          onClick={save}
          data-testid="draft-save-btn"
          className="py-1 px-2.5 rounded-md text-[11px] font-semibold border-none cursor-pointer"
          style={{ background: 'var(--purple)', color: 'white' }}
        >
          {t(isHi, 'Save', 'सहेजें')}
        </button>
      </div>
    </div>
  );
}

export function DraftQuestionList({
  drafts,
  isHi,
  busy,
  onEdit,
  onRegenerate,
}: DraftQuestionListProps) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  return (
    <ul
      data-testid="draft-question-list"
      className="flex flex-col gap-2.5 list-none p-0 m-0"
    >
      {drafts.map((q, i) => (
        <li
          key={q.id}
          className="rounded-xl p-3"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
          }}
        >
          {editingIdx === i ? (
            <QuestionEditor
              q={q}
              isHi={isHi}
              onSave={(next) => {
                onEdit(i, next);
                setEditingIdx(null);
              }}
              onCancel={() => setEditingIdx(null)}
            />
          ) : (
            <>
              <p
                className="text-[13px] font-semibold m-0"
                style={{ color: 'var(--text-1)' }}
              >
                {i + 1}. {q.question_text}
              </p>
              <ul className="mt-1.5 flex flex-col gap-0.5 list-none p-0 text-[12px]">
                {q.options.map((o, oi) => (
                  <li
                    key={oi}
                    style={{
                      color:
                        oi === q.correct_answer_index
                          ? 'var(--success, #059669)'
                          : 'var(--text-2)',
                    }}
                  >
                    {String.fromCharCode(65 + oi)}. {o}
                    {oi === q.correct_answer_index && ' ✓'}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-1.5 justify-end">
                <button
                  type="button"
                  onClick={() => setEditingIdx(i)}
                  className="py-1 px-2 rounded-md text-[11px] font-semibold cursor-pointer"
                  style={{
                    background: 'transparent',
                    color: 'var(--purple)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {t(isHi, 'Edit', 'संपादित')}
                </button>
                <button
                  type="button"
                  onClick={() => onRegenerate(i)}
                  disabled={busy}
                  data-testid="draft-regenerate-btn"
                  className="py-1 px-2 rounded-md text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                  style={{
                    background: 'var(--surface-1)',
                    color: 'var(--text-2)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {t(isHi, 'Regenerate', 'फिर से बनाएं')}
                </button>
              </div>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export default DraftQuestionList;
