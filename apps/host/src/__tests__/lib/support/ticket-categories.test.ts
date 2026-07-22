/**
 * Unit coverage for the support-ticket category source of truth
 * (packages/lib/src/support/ticket-categories.ts).
 *
 * Phase 8 item 8.10 — the two Loops-B/C dispute categories
 * (automated_escalation_dispute, synthesis_content_concern) must:
 *   - be valid categories,
 *   - REQUIRE a related_entity_id (the trigger-record reference),
 *   - resolve their entity type server-side (never trusted from the client),
 *   - carry an ID only — never PII (P13).
 */

import { describe, it, expect } from 'vitest';
import {
  SUPPORT_TICKET_CATEGORIES,
  categoryRequiresReference,
  referenceEntityTypeForCategory,
  validateTicketReference,
} from '@alfanumrik/lib/support/ticket-categories';

const VALID_UUID = '11111111-2222-4333-a444-555555555555';

describe('support ticket categories — source of truth', () => {
  it('includes the two new automated-escalation dispute categories', () => {
    expect(SUPPORT_TICKET_CATEGORIES).toContain('automated_escalation_dispute');
    expect(SUPPORT_TICKET_CATEGORIES).toContain('synthesis_content_concern');
  });

  it('retains the pre-existing categories (additive, no removals)', () => {
    for (const c of ['bug', 'billing', 'content', 'account', 'other']) {
      expect(SUPPORT_TICKET_CATEGORIES).toContain(c);
    }
  });
});

describe('categoryRequiresReference', () => {
  it('is true only for the two dispute categories', () => {
    expect(categoryRequiresReference('automated_escalation_dispute')).toBe(true);
    expect(categoryRequiresReference('synthesis_content_concern')).toBe(true);
  });

  it('is false for ordinary categories', () => {
    for (const c of ['bug', 'billing', 'content', 'account', 'other']) {
      expect(categoryRequiresReference(c)).toBe(false);
    }
  });
});

describe('referenceEntityTypeForCategory', () => {
  it('maps escalation disputes to adaptive_intervention', () => {
    expect(referenceEntityTypeForCategory('automated_escalation_dispute')).toBe(
      'adaptive_intervention',
    );
  });

  it('maps synthesis concerns to monthly_synthesis_run', () => {
    expect(referenceEntityTypeForCategory('synthesis_content_concern')).toBe(
      'monthly_synthesis_run',
    );
  });

  it('returns null for categories with no structured reference', () => {
    expect(referenceEntityTypeForCategory('bug')).toBeNull();
  });
});

describe('validateTicketReference', () => {
  it('requires related_entity_id for escalation disputes', () => {
    const res = validateTicketReference('automated_escalation_dispute', null);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/adaptive_interventions\.id/);
  });

  it('requires related_entity_id for synthesis concerns', () => {
    const res = validateTicketReference('synthesis_content_concern', undefined);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/monthly_synthesis_runs\.id/);
  });

  it('rejects a non-UUID reference', () => {
    const res = validateTicketReference('automated_escalation_dispute', 'not-a-uuid');
    expect(res.ok).toBe(false);
  });

  it('derives the entity type server-side for a valid escalation dispute', () => {
    const res = validateTicketReference('automated_escalation_dispute', VALID_UUID);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.relatedEntityType).toBe('adaptive_intervention');
      expect(res.relatedEntityId).toBe(VALID_UUID);
    }
  });

  it('derives the entity type server-side for a valid synthesis concern', () => {
    const res = validateTicketReference('synthesis_content_concern', VALID_UUID);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.relatedEntityType).toBe('monthly_synthesis_run');
  });

  it('ignores a supplied id for a non-reference category (both fields null)', () => {
    const res = validateTicketReference('bug', VALID_UUID);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.relatedEntityType).toBeNull();
      expect(res.relatedEntityId).toBeNull();
    }
  });
});
