'use client';

/**
 * DraftWithAiSection — K5 "Draft with AI" surface for the teacher assignments
 * page. Generates a candidate list via `generate_draft_assignment`, lets the
 * teacher keep / regenerate / edit each row (DraftQuestionList), then publishes
 * via `publish_draft_assignment` or exports via `export_draft_assignment`.
 *
 * The EF is the authoritative validator on publish. Client-side validation is
 * only a UX hint (see draft-question-validator.ts).
 *
 * P7 bilingual. P13 no PII in logs.
 */

import { useCallback, useState } from 'react';
import { DraftQuestionList, type DraftQuestion } from './DraftQuestionList';
import { teacherDashboardFetch } from '@alfanumrik/lib/teacher/use-teacher-data';

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

export interface DraftWithAiSectionProps {
  isHi: boolean;
  teacherId: string;
  classId?: string;
  subject?: string;
  grade?: string;
  chapter?: string;
  onPublished?: (assignmentId: string) => void;
}

export function DraftWithAiSection(props: DraftWithAiSectionProps) {
  const { isHi, teacherId, classId, subject, grade, chapter, onPublished } = props;
  const [drafts, setDrafts] = useState<DraftQuestion[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [count, setCount] = useState(5);

  const flash = (msg: string, kind: 'ok' | 'err' = 'ok') => {
    if (kind === 'ok') {
      setOk(msg);
      setError(null);
    } else {
      setError(msg);
      setOk(null);
    }
    setTimeout(() => {
      setOk(null);
      setError(null);
    }, 3000);
  };

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await teacherDashboardFetch<{
        draft_id: string;
        questions: DraftQuestion[];
      }>('generate_draft_assignment', {
        teacher_id: teacherId,
        class_id: classId,
        subject,
        grade,
        chapter,
        count,
      });
      setDraftId(res.draft_id);
      setDrafts(res.questions ?? []);
    } catch {
      flash(t(isHi, "Couldn't generate — please retry", 'ड्राफ्ट नहीं बना — पुनः प्रयास करें'), 'err');
    } finally {
      setBusy(false);
    }
  }, [teacherId, classId, subject, grade, chapter, count, isHi]);

  const regenerateAt = useCallback(
    async (index: number) => {
      if (!draftId) return;
      setBusy(true);
      try {
        const res = await teacherDashboardFetch<{ question: DraftQuestion }>(
          'generate_draft_assignment',
          { teacher_id: teacherId, draft_id: draftId, regenerate_index: index },
        );
        if (res?.question) {
          setDrafts((prev) => prev.map((q, i) => (i === index ? res.question : q)));
        }
      } catch {
        flash(t(isHi, "Couldn't regenerate", 'फिर से नहीं बना'), 'err');
      } finally {
        setBusy(false);
      }
    },
    [draftId, teacherId, isHi],
  );

  const editAt = useCallback((index: number, next: DraftQuestion) => {
    setDrafts((prev) => prev.map((q, i) => (i === index ? next : q)));
  }, []);

  const publish = useCallback(async () => {
    if (!draftId) return;
    setBusy(true);
    try {
      const res = await teacherDashboardFetch<{ assignment_id: string }>(
        'publish_draft_assignment',
        { teacher_id: teacherId, draft_id: draftId, questions: drafts },
      );
      flash(t(isHi, 'Published', 'प्रकाशित हुआ'), 'ok');
      if (res?.assignment_id && onPublished) onPublished(res.assignment_id);
      setDrafts([]);
      setDraftId(null);
    } catch {
      flash(t(isHi, "Couldn't publish — please retry", 'प्रकाशित नहीं हुआ — पुनः प्रयास करें'), 'err');
    } finally {
      setBusy(false);
    }
  }, [draftId, teacherId, drafts, isHi, onPublished]);

  const exportDraft = useCallback(async () => {
    if (!draftId) return;
    setBusy(true);
    try {
      const res = await teacherDashboardFetch<{ filename?: string; csv_content?: string }>(
        'export_draft_assignment',
        { teacher_id: teacherId, draft_id: draftId },
      );
      const blob = new Blob([String(res?.csv_content ?? '')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = String(res?.filename ?? 'draft.csv');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      flash(t(isHi, "Couldn't export", 'निर्यात नहीं हुआ'), 'err');
    } finally {
      setBusy(false);
    }
  }, [draftId, teacherId, isHi]);

  return (
    <section
      data-testid="draft-with-ai-section"
      className="rounded-2xl p-4 mb-4"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div>
          <h2
            className="text-base font-bold m-0 font-heading"
            style={{ color: 'var(--text-1)' }}
          >
            {t(isHi, 'Draft with AI', 'AI के साथ ड्राफ्ट करें')}
          </h2>
          <p className="text-[12px] m-0 mt-0.5" style={{ color: 'var(--text-3)' }}>
            {t(
              isHi,
              'Generate questions, edit anything, then publish.',
              'प्रश्न बनाएं, कुछ भी बदलें, फिर प्रकाशित करें।',
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={3}
            max={20}
            value={count}
            onChange={(e) => setCount(Math.max(3, Math.min(20, Number(e.target.value) || 5)))}
            className="w-16 rounded-md text-[13px] py-1 px-2 outline-none"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
            aria-label={t(isHi, 'Question count', 'प्रश्नों की संख्या')}
          />
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            data-testid="draft-generate-btn"
            className="py-1.5 px-3 rounded-md text-[12px] font-semibold border-none cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--purple)', color: 'white' }}
          >
            {busy && drafts.length === 0
              ? t(isHi, 'Generating…', 'बनाया जा रहा है…')
              : t(isHi, 'Generate', 'बनाएं')}
          </button>
        </div>
      </div>
      {(ok || error) && (
        <p
          className="text-[12px] mt-2 m-0"
          style={{ color: error ? 'var(--danger, #DC2626)' : 'var(--success, #059669)' }}
          role="status"
        >
          {error || ok}
        </p>
      )}
      {drafts.length > 0 && (
        <>
          <div className="mt-3">
            <DraftQuestionList
              drafts={drafts}
              isHi={isHi}
              busy={busy}
              onEdit={editAt}
              onRegenerate={regenerateAt}
            />
          </div>
          <div className="mt-3 flex gap-2 justify-end">
            <button
              type="button"
              onClick={exportDraft}
              disabled={busy}
              data-testid="draft-export-btn"
              className="py-1.5 px-3 rounded-md text-[12px] font-semibold cursor-pointer disabled:opacity-50"
              style={{
                background: 'transparent',
                color: 'var(--text-2)',
                border: '1px solid var(--border)',
              }}
            >
              {t(isHi, 'Export CSV', 'CSV निर्यात')}
            </button>
            <button
              type="button"
              onClick={publish}
              disabled={busy}
              data-testid="draft-publish-btn"
              className="py-1.5 px-3 rounded-md text-[12px] font-semibold border-none cursor-pointer disabled:opacity-50"
              style={{ background: 'var(--success, #059669)', color: 'white' }}
            >
              {t(isHi, 'Publish', 'प्रकाशित करें')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export default DraftWithAiSection;
