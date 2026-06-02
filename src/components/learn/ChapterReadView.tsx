'use client';

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Card, Button, LoadingFoxy } from '@/components/ui';
import type { ChapterContent } from '@/lib/learn/fetchChapterContent';

/**
 * Read-mode view of a chapter (Phase 2-B).
 *
 * Renders NCERT chapter prose pulled from `rag_content_chunks` as
 * markdown + KaTeX. Falls back to a friendly hand-off when the fetcher
 * returned no content (most chapters in `rag_content_chunks` are
 * complete; some haven't been ingested yet — those students are
 * encouraged to ask Foxy or switch back to practice mode).
 *
 * Lazy-loaded by the chapter page so the markdown + KaTeX bundle stays
 * out of first paint for students who never open Read mode.
 */

interface Props {
  subjectName: string;
  subjectColor?: string;
  subjectIcon?: string;
  chapterNumber: number;
  isHi: boolean;
  loading: boolean;
  content: ChapterContent | null;
  onBack: () => void;
  onSwitchToPractice: () => void;
}

function ChapterReadViewImpl({
  subjectName,
  subjectColor,
  subjectIcon,
  chapterNumber,
  isHi,
  loading,
  content,
  onBack,
  onSwitchToPractice,
}: Props) {
  return (
    <div className="mesh-bg min-h-dvh pb-nav flex flex-col">
      <header
        className="page-header"
        style={{ background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}
      >
        <div className="app-container py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={onBack} className="text-[var(--text-3)] mr-1" aria-label="Back">&larr;</button>
              {subjectIcon && <span className="text-lg">{subjectIcon}</span>}
              <span className="text-sm font-semibold truncate" style={{ color: subjectColor }}>
                {subjectName} · {isHi ? `अध्याय ${chapterNumber}` : `Chapter ${chapterNumber}`}
              </span>
            </div>
            <button
              type="button"
              onClick={onSwitchToPractice}
              className="text-[10px] font-bold px-2 py-1 rounded-full transition-all active:scale-95"
              style={{ background: 'rgba(124,58,237,0.10)', color: '#7C3AED', border: '1px solid rgba(124,58,237,0.2)' }}
              data-testid="learn-mode-practice-toggle"
            >
              {isHi ? '🧠 अभ्यास' : '🧠 Practice'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 app-container py-4 max-w-2xl mx-auto w-full flex flex-col gap-4">
        {loading && <LoadingFoxy />}

        {!loading && !content && (
          <Card>
            <div className="py-6 px-4 text-center space-y-3">
              <div className="text-4xl">📚</div>
              <h2 className="text-base font-bold">
                {isHi
                  ? 'यह अध्याय अभी पढ़ने के लिए तैयार नहीं है'
                  : "This chapter isn't ready to read yet"}
              </h2>
              <p className="text-sm text-[var(--text-3)]">
                {isHi
                  ? 'अभी अभ्यास मोड पर जाएँ या Foxy से इस अध्याय के बारे में पूछें।'
                  : 'Try practice mode for now, or ask Foxy about this chapter.'}
              </p>
              <Button fullWidth color={subjectColor} onClick={onSwitchToPractice}>
                {isHi ? '🧠 अभ्यास मोड पर जाएँ' : '🧠 Switch to practice mode'}
              </Button>
            </div>
          </Card>
        )}

        {!loading && content && (
          <>
            {content.fellBackFromHindi && isHi && (
              <div
                className="rounded-xl px-3 py-2 text-xs"
                style={{ background: 'rgba(245,158,11,0.10)', color: '#B45309', border: '1px solid rgba(245,158,11,0.25)' }}
                data-testid="learn-chapter-read-hindi-fallback"
              >
                इस अध्याय का हिंदी अनुवाद अभी तैयार हो रहा है — फिलहाल अंग्रेज़ी संस्करण पढ़ें।
              </div>
            )}
            <article
              className="prose prose-sm max-w-none px-1"
              data-testid="learn-chapter-read-body"
              lang={content.language}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
                rehypePlugins={[rehypeKatex]}
              >
                {content.markdown}
              </ReactMarkdown>
            </article>

            {content.truncated && (
              <p className="text-[11px] text-[var(--text-3)] italic px-1">
                {isHi
                  ? '… यह अध्याय यहाँ छोटा कर दिया गया है। पूरा पाठ जल्द आएगा।'
                  : '… This chapter is truncated here. The full text will be available soon.'}
              </p>
            )}

            <Card>
              <div className="py-3 px-2">
                <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-3)] mb-2">
                  {isHi ? 'अब अभ्यास करो' : 'Now practise'}
                </p>
                <Button fullWidth color={subjectColor} onClick={onSwitchToPractice}>
                  {isHi ? '🧠 इस अध्याय का अभ्यास करो' : '🧠 Practise this chapter'}
                </Button>
              </div>
            </Card>
          </>
        )}
      </main>

      
    </div>
  );
}

export default memo(ChapterReadViewImpl);
