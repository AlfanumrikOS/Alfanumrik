/**
 * Support-ticket intake categories — single source of truth.
 *
 * The `support_tickets.category` column is free TEXT at the DB layer (only
 * `priority` carries a CHECK constraint), so category validity is enforced in
 * the application layer. The authenticated intake route
 * (apps/host/src/app/api/support/tickets/route.ts) validates the incoming
 * category against SUPPORT_TICKET_CATEGORIES below.
 *
 * Two categories feed the Loops-B/C automated-escalation dispute fork
 * (docs/runbooks/adaptive-loops-oncall.md):
 *   - automated_escalation_dispute — a parent/teacher disputes an automated
 *     at-risk / inactivity / concentration flag.
 *   - synthesis_content_concern — a parent flags Monthly Synthesis content as
 *     wrong/inappropriate.
 *
 * Both REQUIRE a structured reference to the exact trigger record so support
 * can pull it: the adaptive_interventions.id or monthly_synthesis_runs.id.
 *
 * P13: the reference is an ID ONLY. Student PII is never denormalised onto the
 * ticket — support resolves the record from the id through the RLS-scoped
 * admin tooling.
 */

/** Every category the authenticated intake route accepts. */
export const SUPPORT_TICKET_CATEGORIES = [
  'bug',
  'billing',
  'content',
  'account',
  'automated_escalation_dispute',
  'synthesis_content_concern',
  'other',
] as const;

export type SupportTicketCategory = (typeof SUPPORT_TICKET_CATEGORIES)[number];

/**
 * Structured related-record types a ticket can point at. Mirrors the
 * `support_tickets.related_entity_type` CHECK constraint in migration
 * 20260722103000_support_tickets_related_entity.sql.
 */
export const SUPPORT_TICKET_RELATED_ENTITY_TYPES = [
  'adaptive_intervention', // -> adaptive_interventions.id  (Loops B/C escalations)
  'monthly_synthesis_run', // -> monthly_synthesis_runs.id  (Monthly Synthesis)
] as const;

export type SupportTicketRelatedEntityType =
  (typeof SUPPORT_TICKET_RELATED_ENTITY_TYPES)[number];

/**
 * Categories that MUST carry a related_entity_id, mapped to the entity type the
 * server stamps for them. A support agent uses this reference to pull the exact
 * trigger record the dispute is about.
 */
export const CATEGORY_REQUIRED_REFERENCE: Partial<
  Record<SupportTicketCategory, SupportTicketRelatedEntityType>
> = {
  automated_escalation_dispute: 'adaptive_intervention',
  synthesis_content_concern: 'monthly_synthesis_run',
};

/** The source table an entity type resolves to (documentation + error copy). */
export const RELATED_ENTITY_SOURCE_TABLE: Record<
  SupportTicketRelatedEntityType,
  string
> = {
  adaptive_intervention: 'adaptive_interventions.id',
  monthly_synthesis_run: 'monthly_synthesis_runs.id',
};

/** True when the category requires a structured trigger-record reference. */
export function categoryRequiresReference(category: string): boolean {
  return category in CATEGORY_REQUIRED_REFERENCE;
}

/**
 * Server-side entity type for a category, or null when the category needs no
 * structured reference.
 */
export function referenceEntityTypeForCategory(
  category: string,
): SupportTicketRelatedEntityType | null {
  return CATEGORY_REQUIRED_REFERENCE[category as SupportTicketCategory] ?? null;
}

/** Bilingual labels (P7). Technical terms are not translated. */
export const SUPPORT_TICKET_CATEGORY_LABELS: Record<
  SupportTicketCategory,
  { en: string; hi: string }
> = {
  account: { en: 'Account / Login issue', hi: 'खाता / लॉगिन समस्या' },
  bug: { en: 'App bug or crash', hi: 'ऐप में गड़बड़ी / क्रैश' },
  content: { en: 'Wrong content', hi: 'गलत सामग्री' },
  billing: { en: 'Billing / Payment', hi: 'बिलिंग / भुगतान' },
  automated_escalation_dispute: {
    en: 'Dispute an automated flag (at-risk / inactivity)',
    hi: 'स्वचालित चेतावनी पर आपत्ति (जोखिम / निष्क्रियता)',
  },
  synthesis_content_concern: {
    en: 'Monthly Synthesis content concern',
    hi: 'मासिक सारांश सामग्री पर चिंता',
  },
  other: { en: 'Feature request / Other', hi: 'फीचर अनुरोध / अन्य' },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TicketReferenceValidation =
  | {
      ok: true;
      relatedEntityType: SupportTicketRelatedEntityType | null;
      relatedEntityId: string | null;
    }
  | { ok: false; error: string };

/**
 * Validate + normalise the trigger-record reference for a category.
 *
 * - For a reference-requiring category (automated_escalation_dispute,
 *   synthesis_content_concern): `relatedEntityId` is REQUIRED and must be a
 *   UUID; the entity type is derived server-side (never trusted from the
 *   client) so the two can't be mismatched.
 * - For any other category: any supplied id is ignored and both fields resolve
 *   to null.
 *
 * Returns UUID-shaped ids only — never any PII (P13).
 */
export function validateTicketReference(
  category: string,
  relatedEntityId: string | null | undefined,
): TicketReferenceValidation {
  const requiredType = referenceEntityTypeForCategory(category);

  if (requiredType) {
    if (!relatedEntityId) {
      return {
        ok: false,
        error: `Category "${category}" requires "related_entity_id" (the ${RELATED_ENTITY_SOURCE_TABLE[requiredType]} of the disputed record).`,
      };
    }
    if (!UUID_RE.test(relatedEntityId)) {
      return { ok: false, error: '"related_entity_id" must be a valid UUID.' };
    }
    return {
      ok: true,
      relatedEntityType: requiredType,
      relatedEntityId,
    };
  }

  // Category does not use a structured reference; ignore any supplied id.
  return { ok: true, relatedEntityType: null, relatedEntityId: null };
}
