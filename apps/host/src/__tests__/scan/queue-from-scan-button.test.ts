/**
 * Tests for QueueFromScanButton pure helpers — the label / disabled /
 * aria-busy mappings per state-machine state. The full component
 * involves SWR + fetch; the pure pieces are the load-bearing ones for
 * the UX contract (every state has a bilingual label + correct
 * accessibility semantics).
 */

import { describe, it, expect } from 'vitest';
import {
  queueButtonLabel,
  queueButtonAriaBusy,
  queueButtonDisabled,
} from '../../components/scan/QueueFromScanButton';

const ALL_STATES = ['idle', 'posting', 'added', 'exists', 'error'] as const;

describe('queueButtonLabel', () => {
  it('idle reads as the primary verb in both languages', () => {
    expect(queueButtonLabel('idle', false)).toBe('🔁 Add to my queue');
    expect(queueButtonLabel('idle', true)).toBe('🔁 मेरी कतार में जोड़ो');
  });

  it('posting reads as in-progress', () => {
    expect(queueButtonLabel('posting', false)).toBe('Adding…');
    expect(queueButtonLabel('posting', true)).toBe('जोड़ रहे हैं…');
  });

  it("added reads as confirmation; preserves the check glyph", () => {
    expect(queueButtonLabel('added', false)).toBe('✓ Added to your queue');
    expect(queueButtonLabel('added', true)).toBe('✓ कतार में जोड़ा गया');
  });

  it('exists reads as "already in queue" (idempotent server response)', () => {
    expect(queueButtonLabel('exists', false)).toBe('✓ Already in your queue');
    expect(queueButtonLabel('exists', true)).toBe('✓ पहले से कतार में है');
  });

  it('error reads as retry prompt', () => {
    expect(queueButtonLabel('error', false)).toBe('🔁 Try again');
    expect(queueButtonLabel('error', true)).toBe('🔁 दोबारा कोशिश करें');
  });

  it('every state has a non-empty bilingual label', () => {
    for (const state of ALL_STATES) {
      expect(queueButtonLabel(state, false).length).toBeGreaterThan(0);
      expect(queueButtonLabel(state, true).length).toBeGreaterThan(0);
    }
  });
});

describe('queueButtonAriaBusy', () => {
  it('reports busy only while POSTing', () => {
    expect(queueButtonAriaBusy('posting')).toBe(true);
    expect(queueButtonAriaBusy('idle')).toBe(false);
    expect(queueButtonAriaBusy('added')).toBe(false);
    expect(queueButtonAriaBusy('exists')).toBe(false);
    expect(queueButtonAriaBusy('error')).toBe(false);
  });
});

describe('queueButtonDisabled', () => {
  it('disabled while posting (prevent double-click)', () => {
    expect(queueButtonDisabled('posting')).toBe(true);
  });

  it('disabled after success — added or exists (no double-add)', () => {
    expect(queueButtonDisabled('added')).toBe(true);
    expect(queueButtonDisabled('exists')).toBe(true);
  });

  it('enabled on idle and error so the student can retry', () => {
    expect(queueButtonDisabled('idle')).toBe(false);
    expect(queueButtonDisabled('error')).toBe(false);
  });
});
