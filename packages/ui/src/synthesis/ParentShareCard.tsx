'use client';

/**
 * Pedagogy v2 — Wave 3 Task 5
 * <ParentShareCard/> — preview-only card for the bilingual parent-share text.
 *
 * Wave 3 Task 5 surfaces the preview + the parent_share_status. The actual
 * "Send via WhatsApp" CTA wiring lands in Task 6 (/api/synthesis/parent-share),
 * which also handles the guardians.monthly_synthesis_optin toggle.
 *
 * For v1 this card renders:
 *   - The Claude-generated parent-share preview (English + Hindi tabs)
 *   - The current parent_share_status as a chip (pending / sent / opted_out)
 *   - A muted "WhatsApp delivery coming soon" hint when Task 6 is not yet
 *     wired, OR the active CTA when ParentShareCard is mounted with the
 *     onSend prop wired by the page.
 */
import { useState } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';

export interface ParentShareCardProps {
  synthesisRunId: string;
  summaryTextEn: string;
  summaryTextHi: string;
  parentShareStatus: 'pending' | 'sent' | 'opted_out' | 'failed' | 'suppressed';
  parentShareSentAt: string | null;
  /** Wired by Task 6. When undefined, the CTA is shown disabled with a "coming soon" hint. */
  onSend?: () => Promise<void>;
}

export default function ParentShareCard(props: ParentShareCardProps) {
  const { isHi } = useAuth();
  const [tab, setTab] = useState<'en' | 'hi'>(isHi ? 'hi' : 'en');
  const [submitting, setSubmitting] = useState(false);
  const status = props.parentShareStatus;

  const previewText = tab === 'en' ? props.summaryTextEn : props.summaryTextHi;
  const previewEmpty = !previewText || previewText.trim().length === 0;

  async function handleSend() {
    if (!props.onSend || submitting) return;
    setSubmitting(true);
    try {
      await props.onSend();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      className="rounded-3xl border border-orange-200 bg-orange-50 p-5"
      data-testid="parent-share-card"
    >
      <header className="mb-3 flex items-baseline justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-orange-800">
          {isHi ? 'अभिभावक के साथ साझा करो' : 'Share with parent'}
        </p>
        <StatusChip status={status} sentAt={props.parentShareSentAt} isHi={isHi} />
      </header>

      {/* Language tabs */}
      <div className="inline-flex rounded-lg border border-orange-200 bg-white text-[10px] mb-3 overflow-hidden">
        <button
          type="button"
          onClick={() => setTab('en')}
          className="px-3 py-1 font-semibold transition-colors"
          style={{
            background: tab === 'en' ? '#E8581C' : '#fff',
            color: tab === 'en' ? '#fff' : '#9A3412',
          }}
          data-testid="parent-share-tab-en"
        >
          English
        </button>
        <button
          type="button"
          onClick={() => setTab('hi')}
          className="px-3 py-1 font-semibold transition-colors"
          style={{
            background: tab === 'hi' ? '#E8581C' : '#fff',
            color: tab === 'hi' ? '#fff' : '#9A3412',
          }}
          data-testid="parent-share-tab-hi"
        >
          हिंदी
        </button>
      </div>

      {/* Preview */}
      <div
        className="rounded-2xl bg-white p-3 text-sm leading-relaxed text-[var(--text-2)] whitespace-pre-wrap mb-3 min-h-[6rem]"
        data-testid="parent-share-preview"
      >
        {previewEmpty
          ? (isHi
              ? 'पूर्वावलोकन तैयार हो रहा है…'
              : 'Preview generating…')
          : previewText}
      </div>

      {/* Send CTA */}
      {props.onSend ? (
        <button
          type="button"
          onClick={handleSend}
          disabled={submitting || status === 'sent' || status === 'opted_out' || previewEmpty}
          className="w-full rounded-xl bg-orange-600 text-white py-2.5 text-sm font-semibold disabled:opacity-50"
          data-testid="parent-share-send"
        >
          {submitting
            ? (isHi ? 'भेज रहे हैं…' : 'Sending…')
            : status === 'sent'
              ? (isHi ? '✓ भेज दिया' : '✓ Sent')
              : (isHi ? 'WhatsApp पर भेजो' : 'Send via WhatsApp')}
        </button>
      ) : (
        <p className="text-[10px] text-orange-700 italic" data-testid="parent-share-coming-soon">
          {isHi
            ? 'WhatsApp डिलीवरी जल्द उपलब्ध होगी।'
            : 'WhatsApp delivery is coming soon.'}
        </p>
      )}
    </section>
  );
}

function StatusChip(props: {
  status: ParentShareCardProps['parentShareStatus'];
  sentAt: string | null;
  isHi: boolean;
}) {
  const { status, sentAt, isHi } = props;
  const cfg = (() => {
    switch (status) {
      case 'sent':
        return {
          label: isHi ? 'भेज दिया' : 'Sent',
          bg: 'rgba(22,163,74,0.1)',
          color: '#16A34A',
        };
      case 'opted_out':
        return {
          label: isHi ? 'अभिभावक ने मना किया' : 'Parent opted out',
          bg: 'rgba(100,100,100,0.1)',
          color: '#525252',
        };
      case 'failed':
        return {
          label: isHi ? 'विफल' : 'Failed',
          bg: 'rgba(220,38,38,0.1)',
          color: '#DC2626',
        };
      case 'suppressed':
        return {
          label: isHi ? 'रोका गया' : 'Suppressed',
          bg: 'rgba(100,100,100,0.1)',
          color: '#525252',
        };
      case 'pending':
      default:
        return {
          label: isHi ? 'लंबित' : 'Pending',
          bg: 'rgba(245,166,35,0.15)',
          color: '#B45309',
        };
    }
  })();

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
      {status === 'sent' && sentAt && (
        <span className="text-[9px] font-normal opacity-70">
          · {new Date(sentAt).toLocaleDateString()}
        </span>
      )}
    </span>
  );
}
