'use client';

/**
 * Refresh page — Section D "Build Your Own Deck".
 *
 * A composer that lets the student create their own SM-2 flashcard.
 * Submits to POST /api/learner/cards/create. On success the card is
 * scheduled for tomorrow and shows up in Section A.
 *
 * Always rendered (unlike A/B/C which auto-hide). Default state shows
 * a small tip; expanding the composer reveals subject + front + back +
 * optional hint.
 *
 * Spec: docs/superpowers/specs/2026-05-20-study-section-consolidation-design.md §6 Section D
 */

import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import { toast } from '@/components/ui/toast';

export interface BuildYourOwnDeckSectionProps {
  onCardCreated?: () => void;
}

export default function BuildYourOwnDeckSection({ onCardCreated }: BuildYourOwnDeckSectionProps) {
  const { isHi } = useAuth();
  const { unlocked: allowedSubjects } = useAllowedSubjects();

  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState<string>('');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [hint, setHint] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    subject.length > 0 &&
    front.trim().length > 0 && front.length <= 200 &&
    back.trim().length > 0 && back.length <= 200 &&
    hint.length <= 100 &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/learner/cards/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          subjectCode: subject,
          frontText: front.trim(),
          backText: back.trim(),
          hint: hint.trim() || undefined,
        }),
      });
      if (res.ok) {
        toast.success(isHi ? 'जोड़ दिया — कल झटपट याद में दिखेगा' : "Added — you'll see it tomorrow in Quick Recall");
        setFront(''); setBack(''); setHint(''); setOpen(false);
        onCardCreated?.();
      } else {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'daily_cap_hit') {
          toast.error(isHi ? 'आज का limit पूरा — कल फिर जोड़ो' : "Today's limit reached — try again tomorrow");
        } else {
          toast.error(isHi ? 'कार्ड जोड़ने में त्रुटि' : 'Could not add card');
        }
      }
    } catch {
      toast.error(isHi ? 'कार्ड जोड़ने में त्रुटि' : 'Could not add card');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section data-testid="refresh-section-d" className="space-y-3">
      <header>
        <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          ⭐ {isHi ? 'अपना डेक बनाओ' : 'Build Your Own Deck'}
        </h2>
      </header>

      {!open && (
        <button
          onClick={() => setOpen(true)}
          data-testid="refresh-byod-open"
          className="w-full rounded-2xl p-4 text-left text-sm transition-all active:scale-[0.98]"
          style={{ background: 'rgba(232,88,28,0.05)', border: '1px dashed rgba(232,88,28,0.3)', color: 'var(--text-2)' }}
        >
          + {isHi ? 'टिप: जो याद रखना है उसे जोड़ो' : 'Tip: tap to add a concept you want to remember'}
        </button>
      )}

      {open && (
        <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            data-testid="refresh-byod-subject"
            className="w-full p-2.5 rounded-xl text-sm"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <option value="">{isHi ? 'विषय चुनो' : 'Choose subject'}</option>
            {allowedSubjects.map(s => (
              <option key={s.code} value={s.code}>{s.icon} {s.name}</option>
            ))}
          </select>

          <textarea
            value={front}
            onChange={(e) => setFront(e.target.value.slice(0, 200))}
            data-testid="refresh-byod-front"
            placeholder={isHi ? 'क्या याद रखना है?' : 'What do you want to remember?'}
            maxLength={200}
            rows={2}
            className="w-full p-2.5 rounded-xl text-sm"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          />
          <div className="text-[10px] text-[var(--text-3)] text-right">{front.length}/200</div>

          <textarea
            value={back}
            onChange={(e) => setBack(e.target.value.slice(0, 200))}
            data-testid="refresh-byod-back"
            placeholder={isHi ? 'संकेत या उत्तर' : 'Hint or answer'}
            maxLength={200}
            rows={2}
            className="w-full p-2.5 rounded-xl text-sm"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          />
          <div className="text-[10px] text-[var(--text-3)] text-right">{back.length}/200</div>

          <input
            value={hint}
            onChange={(e) => setHint(e.target.value.slice(0, 100))}
            data-testid="refresh-byod-hint"
            placeholder={isHi ? 'संकेत (optional)' : 'Hint (optional)'}
            maxLength={100}
            className="w-full p-2.5 rounded-xl text-sm"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          />

          <div className="flex gap-2">
            <button
              onClick={() => { setOpen(false); setFront(''); setBack(''); setHint(''); }}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
            >
              {isHi ? 'रद्द' : 'Cancel'}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              data-testid="refresh-byod-submit"
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40"
              style={{ background: 'var(--orange, #E8581C)' }}
            >
              {submitting ? (isHi ? 'जोड़ रहा है...' : 'Adding...') : (isHi ? 'मेरे डेक में जोड़ो' : 'Add to my deck')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
