'use client';

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {
  Card,
  Button,
  IconButton,
  Alert,
  EmptyState,
  Skeleton,
  SkeletonText,
} from '@alfanumrik/ui/ui/primitives';
import type { ChapterContent } from '@alfanumrik/lib/learn/fetchChapterContent';

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
 *
 * Phase 5b re-skin: presentation-only migration onto the canonical
 * primitive layer (Card / Button / IconButton / Alert / EmptyState /
 * Skeleton). Zero raw hex / rgb() — every colour is a semantic token.
 * The reading surface stays low-distraction (assessment condition C3):
 * no readiness cards, XP chrome, or confetti in the reading flow. The
 * article is capped to a readable measure (~66ch) rather than max-w-none.
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
      <header className="page-header">
        <div className="app-container py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <IconButton
                variant="ghost"
                size="sm"
                label={isHi ? 'वापस' : 'Back'}
                icon={<span aria-hidden="true">&larr;</span>}
                onClick={onBack}
                className="-ms-2"
              />
              {subjectIcon && <span className="text-lg" aria-hidden="true">{subjectIcon}</span>}
              <span className="text-sm font-semibold truncate" style={{ color: subjectColor }}>
                {subjectName} · {isHi ? `अध्याय ${chapterNumber}` : `Chapter ${chapterNumber}`}
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={onSwitchToPractice}
              className="shrink-0"
              data-testid="learn-mode-practice-toggle"
            >
              {isHi ? '🧠 अभ्यास' : '🧠 Practice'}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 app-container py-4 max-w-2xl mx-auto w-full flex flex-col gap-4">
        {loading && (
          <div
            role="status"
            aria-busy="true"
            aria-label={isHi ? 'अध्याय लोड हो रहा है' : 'Loading chapter'}
            className="mx-auto w-full max-w-[66ch] flex flex-col gap-4 px-1"
          >
            <Skeleton radius="md" className="h-7 w-2/3" />
            <SkeletonText lines={6} />
            <SkeletonText lines={5} />
          </div>
        )}

        {!loading && !content && (
          <Card variant="flat">
            <EmptyState
              icon={<span aria-hidden="true">📚</span>}
              title={
                isHi
                  ? 'यह अध्याय अभी पढ़ने के लिए तैयार नहीं है'
                  : "This chapter isn't ready to read yet"
              }
              description={
                isHi
                  ? 'अभी अभ्यास मोड पर जाएँ या Foxy से इस अध्याय के बारे में पूछें।'
                  : 'Try practice mode for now, or ask Foxy about this chapter.'
              }
              action={
                <Button fullWidth onClick={onSwitchToPractice}>
                  {isHi ? '🧠 अभ्यास मोड पर जाएँ' : '🧠 Switch to practice mode'}
                </Button>
              }
            />
          </Card>
        )}

        {!loading && content && (
          <>
            {content.fellBackFromHindi && isHi && (
              <Alert tone="warning" data-testid="learn-chapter-read-hindi-fallback">
                <span lang="hi">
                  इस अध्याय का हिंदी अनुवाद अभी तैयार हो रहा है — फिलहाल अंग्रेज़ी संस्करण पढ़ें।
                </span>
              </Alert>
            )}
            <article
              className="prose prose-sm mx-auto w-full max-w-[66ch] px-1 prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-a:text-primary"
              data-testid="learn-chapter-read-body"
              lang={content.language}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  // Any diagram/image in the prose sits in a Card media slot
                  // (overflow-hidden by contract, DD-10) instead of bleeding
                  // to the article edge. `not-prose` drops the typography
                  // margins so the media fills the card cleanly.
                  img: ({ node, ...imgProps }) => {
                    void node;
                    return (
                      <Card variant="flat" className="not-prose my-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          {...imgProps}
                          alt={imgProps.alt ?? ''}
                          className="w-full h-auto"
                        />
                      </Card>
                    );
                  },
                }}
              >
                {content.markdown}
              </ReactMarkdown>
            </article>

            {content.truncated && (
              <p className="mx-auto w-full max-w-[66ch] text-xs text-muted-foreground italic px-1">
                {isHi
                  ? '… यह अध्याय यहाँ छोटा कर दिया गया है। पूरा पाठ जल्द आएगा।'
                  : '… This chapter is truncated here. The full text will be available soon.'}
              </p>
            )}

            {/* Read → practise bridge (assessment condition C3: the only CTA
                in the reading flow — no readiness/XP chrome). */}
            <Card variant="flat" className="mx-auto w-full max-w-[66ch] p-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {isHi ? 'अब अभ्यास करो' : 'Now practise'}
              </p>
              <Button fullWidth onClick={onSwitchToPractice}>
                {isHi ? '🧠 इस अध्याय का अभ्यास करो' : '🧠 Practise this chapter'}
              </Button>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}

export default memo(ChapterReadViewImpl);
