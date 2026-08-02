'use client';

/**
 * OfflineState — what the student sees with no connection (design screen 14).
 *
 * PURE PRESENTATION. The downloaded-chapter list, the queued-write count and
 * the saved-explanation count are passed in. The client store that produces
 * them is a PROPOSAL — see handoff/BLOCKED-SCREENS.md §3. `public/sw.js`
 * already exists; the inventory and the queue do not.
 *
 * Rules this encodes:
 *   - Never a blank screen and never a lie. Say exactly what works, what is
 *     queued, and what does not work — with the reason.
 *   - Queued work is reassuring, not alarming: "nothing is lost, your score
 *     won't change".
 *   - Foxy is shown disabled WITH its reason, not hidden. Hiding it reads as a
 *     bug; a stated reason reads as a system that is honest.
 */

export interface DownloadedChapter {
  /** curriculum_topics.id */
  id: string;
  title: string;
  /** Pre-formatted by the caller, e.g. "Full chapter + 40 questions". */
  summary: string;
  subjectCode: string;
}

export interface OfflineQueue {
  /** Answers written offline, waiting to replay with their idempotency keys. */
  answerCount: number;
  /** Completed sessions waiting to submit. */
  sessionCount: number;
}

export default function OfflineState({
  chapters,
  queue,
  savedExplanationCount,
  isHi,
  onOpenChapter,
  onOpenSavedExplanations,
}: {
  chapters: DownloadedChapter[];
  queue: OfflineQueue;
  savedExplanationCount: number;
  isHi: boolean;
  onOpenChapter: (chapter: DownloadedChapter) => void;
  onOpenSavedExplanations: () => void;
}) {
  const hasQueue = queue.answerCount > 0 || queue.sessionCount > 0;

  return (
    <div data-testid="offline-state">
      <div
        role="status"
        className="flex items-center gap-2.5 px-4 py-3 text-sm font-bold"
        style={{ background: 'var(--text-1)', color: 'var(--surface-1, #fff)' }}
        data-testid="offline-banner"
      >
        <span aria-hidden="true">◌</span>
        <span>{isHi ? 'इंटरनेट नहीं है — फिर भी काम चलेगा' : 'No internet — you can still work'}</span>
      </div>

      <div className="p-4 flex flex-col gap-3">
        <h1
          className="text-xl font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
        >
          {isHi ? 'डाउनलोड किया हुआ' : 'Downloaded and ready'}
        </h1>

        {chapters.length > 0 ? (
          chapters.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpenChapter(c)}
              className="w-full rounded-2xl p-4 flex items-center gap-3 text-left"
              style={{
                background: 'var(--surface-1, #fff)',
                border: '1px solid var(--border)',
                minHeight: 64,
              }}
              data-testid="offline-chapter"
            >
              <span
                className="rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  width: 38,
                  height: 38,
                  background: 'rgb(var(--green-rgb, 22 163 74) / 0.10)',
                  fontSize: 16,
                }}
                aria-hidden="true"
              >
                📘
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>
                  {c.title}
                </span>
                <span className="block text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                  {c.summary}
                </span>
              </span>
              <span aria-hidden="true" style={{ color: 'var(--text-3)' }}>
                ›
              </span>
            </button>
          ))
        ) : (
          <div
            className="rounded-2xl p-5 text-center"
            style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}
            data-testid="offline-no-downloads"
          >
            <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
              {isHi ? 'कुछ भी डाउनलोड नहीं है' : 'Nothing downloaded yet'}
            </p>
            <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--text-3)' }}>
              {isHi
                ? 'अगली बार इंटरनेट मिलने पर अध्याय के ऊपर ⤓ दबाकर सेव कर लें।'
                : 'Next time you are online, tap ⤓ on a chapter to keep it for moments like this.'}
            </p>
          </div>
        )}

        {hasQueue && (
          <div
            className="rounded-2xl p-4"
            style={{
              background: 'rgb(var(--orange-rgb) / 0.08)',
              border: '1px solid rgb(var(--orange-rgb) / 0.2)',
            }}
            data-testid="offline-queue"
          >
            <p className="text-sm font-bold" style={{ color: 'var(--orange)' }}>
              {isHi ? 'सिंक होना बाकी' : 'Waiting to sync'}
            </p>
            <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--orange)' }}>
              {isHi
                ? `${queue.answerCount} उत्तर और ${queue.sessionCount} पूरा सेशन। इंटरनेट आते ही चले जाएँगे — कुछ नहीं खोएगा और स्कोर नहीं बदलेगा।`
                : `${queue.answerCount} answers and ${queue.sessionCount} finished session${queue.sessionCount === 1 ? '' : 's'}. They go up the moment you are back — nothing is lost and your score will not change.`}
            </p>
          </div>
        )}

        {/* Disabled WITH a reason — never hidden. */}
        <div
          className="rounded-2xl p-4"
          style={{ background: 'var(--surface-1, #fff)', border: '1px solid var(--border)', opacity: 0.75 }}
          data-testid="offline-foxy"
        >
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" style={{ fontSize: 16 }}>
              🦊
            </span>
            <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
              {isHi ? 'फॉक्सी को इंटरनेट चाहिए' : 'Foxy needs internet'}
            </p>
          </div>
          <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--text-3)' }}>
            {isHi
              ? 'वह आपकी NCERT किताब ऑनलाइन पढ़कर जवाब देता है।'
              : 'He reads from your NCERT book online, so he cannot answer right now.'}
          </p>
          {savedExplanationCount > 0 && (
            <button
              type="button"
              onClick={onOpenSavedExplanations}
              className="w-full rounded-xl text-sm font-bold mt-3"
              style={{ border: '1px solid var(--border)', color: 'var(--text-1)', minHeight: 48 }}
              data-testid="offline-saved-explanations"
            >
              {isHi
                ? `${savedExplanationCount} सेव किए हुए जवाब खोलें`
                : `Open ${savedExplanationCount} saved explanation${savedExplanationCount === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
