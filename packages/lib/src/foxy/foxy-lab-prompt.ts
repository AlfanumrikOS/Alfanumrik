/**
 * Foxy Lab-Context Prompt Builder — Next.js (server-side) helper
 *
 * Previously mirrored at `supabase/functions/_shared/foxy-lab-prompt.ts` (a
 * Deno helper used by the legacy foxy-tutor Edge Function). That mirror was
 * removed 2026-07-23 after foxy-tutor itself was deleted from the repo
 * (retired 2026-07-01, replaced by apps/host/src/app/api/foxy/route.ts).
 * This file is now the sole source. The "NEVER invent" guardrail wording
 * below is the P12 safety contract for this feature and the regression test
 * (apps/host/src/__tests__/lib/foxy-lab-context.test.ts) pins it.
 *
 * Renders an array of `LabContextEntry` (from recent-lab-context.ts) into a
 * system-prompt section that Foxy can use to reference the student's recent
 * hands-on experiments.
 */

import type { LabContextEntry } from './recent-lab-context';

interface SectionStrings {
  heading: string;
  preamble: string;
  observedLabel: string;
  conclusionLabel: string;
  vivaLabel: string;
  guidedLabel: string;
  simpleLabel: string;
}

const EN: SectionStrings = {
  heading: "RECENT LAB ACTIVITY (the student's hands-on experiment history):",
  preamble:
    'You may reference these observations when relevant. NEVER invent or contradict the student\'s recorded data. NEVER reference labs not in this list.',
  observedLabel: 'They observed',
  conclusionLabel: 'Their conclusion',
  vivaLabel: 'Viva',
  guidedLabel: 'guided',
  simpleLabel: 'simple',
};

const HI: SectionStrings = {
  heading: 'हाल की लैब गतिविधि (विद्यार्थी का हाथों-हाथ प्रयोग इतिहास):',
  preamble:
    'आप इन अवलोकनों का संदर्भ ले सकते हैं। विद्यार्थी के दर्ज किए गए डेटा का कभी भी आविष्कार न करें या उसका खंडन न करें। इस सूची से बाहर के किसी भी लैब का संदर्भ न दें।',
  observedLabel: 'उनका अवलोकन',
  conclusionLabel: 'उनका निष्कर्ष',
  vivaLabel: 'वीवा',
  guidedLabel: 'guided',
  simpleLabel: 'simple',
};

function formatEntry(entry: LabContextEntry, index: number, s: SectionStrings): string {
  const typeLabel = entry.type === 'guided' ? s.guidedLabel : s.simpleLabel;
  const subject = entry.subject ?? '';
  let header = `${index + 1}. [${entry.date}] ${entry.simulationId} (${typeLabel}, ${subject})`;
  if (entry.vivaScore !== null && entry.vivaMax !== null) {
    header += ` — ${s.vivaLabel} ${entry.vivaScore}/${entry.vivaMax}`;
  }

  const lines: string[] = [header];
  if (entry.observationSummary) {
    lines.push(`   ${s.observedLabel}: "${entry.observationSummary}"`);
  }
  if (entry.conclusion) {
    lines.push(`   ${s.conclusionLabel}: "${entry.conclusion}"`);
  }
  return lines.join('\n');
}

/**
 * Build the "RECENT LAB ACTIVITY" section. Returns "" when entries is empty
 * so callers can safely concatenate without producing an orphan header.
 */
export function buildLabContextSection(entries: LabContextEntry[], isHi: boolean): string {
  if (!Array.isArray(entries) || entries.length === 0) return '';
  const s = isHi ? HI : EN;
  const blocks = entries.map((entry, idx) => formatEntry(entry, idx, s));
  return [s.heading, s.preamble, '', ...blocks].join('\n');
}
