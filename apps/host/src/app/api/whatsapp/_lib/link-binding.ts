/**
 * link-binding.ts — shared LINK-<otp> binding core (WhatsApp bot Phase 2).
 *
 * ONE implementation shared by the two callers:
 *   - apps/host/src/app/api/whatsapp/webhook/route.ts  (inline, TwiML reply)
 *   - apps/host/src/app/api/cron/whatsapp-drain/route.ts (retry path, NO reply
 *     — the cron cannot TwiML-reply; Phase 3 sends confirmations via the
 *     whatsapp-send path)
 *
 * Flow (plan-alfanumrik-whatsapp-bot-mighty-frost.md, "Identity binding"):
 *   1. Scan unexpired, unlocked `whatsapp_link_challenges` (newest first,
 *      LIMIT 20) and verify the presented code against each row's otp_hash
 *      (hashOtp salts with the row id, so verification is per-row).
 *   2. Exactly ONE match required. Zero → 'invalid'. Two+ → 'ambiguous'
 *      (fail closed — plan rule: "try again from the app").
 *   3. Matched challenge with attempt_count >= OTP_MAX_ATTEMPTS → lock the
 *      row (computeLockoutUntil) and return 'locked'.
 *   4. Determine fresh-bind vs RE-VERIFY: an existing live phone+subject
 *      binding is a re-verify (the partial-unique live-binding indexes make a
 *      duplicate insert impossible).
 *   5. For a FRESH student bind, enforce ≤ MAX_LIVE_STUDENT_BINDINGS_PER_PHONE
 *      live student bindings per phone (shared-family-phone rule). This COUNT
 *      is a read and runs BEFORE the challenge is consumed, so a 'limit'
 *      outcome leaves the challenge intact — the OTP is not burned on a
 *      capped phone.
 *   6. Consume the challenge (DELETE — single use, strictly BEFORE the
 *      identity write), then upsert the `whatsapp_identities` binding
 *      (a 23505 race on insert is treated as a re-verify).
 *   7. Append the DPDP consent event, upsert the `whatsapp_sessions` row
 *      (state 'idle', active_student_id for students), and log an ops event
 *      ('identity_bound') — all best-effort once the binding row is durable.
 *
 * ── P13 ─────────────────────────────────────────────────────────────────────
 * `whatsapp_identities.phone_e164` is the ONE legitimate write site of the raw
 * phone, and the webhook (which has the live inbound `From`) is the only
 * caller that can supply it. The cron path passes phoneE164 = null and this
 * module recovers the raw number from an existing LIVE identity row with the
 * same phone_hash (e.g. a sibling/guardian already bound on the handset). If
 * no such row exists the cron path CANNOT complete a first-ever bind —
 * outcome 'phone_unavailable' (the raw phone is deliberately never persisted
 * in whatsapp_inbound_events). Logs carry redactPhone() output only; the OTP
 * code is never logged.
 *
 * Never throws — every failure path returns { outcome: 'error' }.
 */

import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { redactPhone } from '@alfanumrik/lib/whatsapp/phone';
import {
  verifyOtp,
  OTP_MAX_ATTEMPTS,
  computeLockoutUntil,
} from '@alfanumrik/lib/link-code-otp';

/** Plan rule: a shared family phone carries at most 4 live student bindings. */
export const MAX_LIVE_STUDENT_BINDINGS_PER_PHONE = 4;

/** Candidate-scan bound (plan rule: newest 20 unexpired, unlocked challenges). */
const CANDIDATE_SCAN_LIMIT = 20;

export type LinkBindingOutcome =
  | 'bound' // success — new binding created OR existing live binding re-verified
  | 'invalid' // zero matching challenges (wrong/expired code)
  | 'ambiguous' // 2+ live matches — fail closed, retry from the app
  | 'locked' // matched challenge exhausted OTP_MAX_ATTEMPTS
  | 'limit' // phone already carries MAX_LIVE_STUDENT_BINDINGS_PER_PHONE students
  | 'phone_unavailable' // cron path only: raw phone not recoverable (P13)
  | 'rate_limited' // sender phone exceeded whatsapp_check_link_attempt's cap
  | 'error'; // transient/unexpected DB failure

export interface LinkBindingInput {
  /** The digit code from the inbound `LINK <code>` message. */
  code: string;
  /** hashPhone(phoneE164, WHATSAPP_PHONE_PEPPER) of the sender. */
  phoneHash: string;
  /**
   * Raw sender phone. The WEBHOOK passes the live inbound value (the one
   * legitimate raw-phone write site). The CRON passes null and this module
   * attempts recovery from an existing live identity on the same phone_hash.
   */
  phoneE164: string | null;
  /** Caller tag for ops-event/log attribution (e.g. 'whatsapp/webhook'). */
  source: string;
}

export interface LinkBindingResult {
  outcome: LinkBindingOutcome;
}

interface ChallengeRow {
  id: string;
  auth_user_id: string;
  student_id: string | null;
  guardian_id: string | null;
  role: 'student' | 'guardian';
  otp_hash: string;
  attempt_count: number;
}

export async function processLinkBinding(
  input: LinkBindingInput,
): Promise<LinkBindingResult> {
  const admin = supabaseAdmin;
  try {
    const code = (input.code ?? '').trim();
    // Intent-classifier contract: LINK codes are 4-8 digits (intent.ts). A
    // non-conforming code can never match a 6-digit OTP; short-circuit.
    if (!/^\d{4,8}$/.test(code)) {
      return { outcome: 'invalid' };
    }

    const nowIso = new Date().toISOString();

    // 0. Per-sender-phone attempt throttle (whatsapp_check_link_attempt RPC,
    //    migration 20260815000006) — a defense-in-depth backstop the
    //    per-CHALLENGE attempt_count column cannot provide, since a
    //    non-matching guess against the system-wide candidate scan below
    //    cannot be attributed to any specific challenge row. This IS
    //    scoped to the guesser's own phone_hash, so it closes that gap.
    //    Runs BEFORE the scan so a throttled sender never even reaches it.
    const { data: throttleRows, error: throttleErr } = await admin.rpc(
      'whatsapp_check_link_attempt',
      { p_phone_hash: input.phoneHash },
    );
    if (throttleErr) {
      logger.error('whatsapp link-binding: attempt-throttle RPC failed', {
        source: input.source,
        error: throttleErr.message,
      });
      return { outcome: 'error' };
    }
    const throttle = (
      Array.isArray(throttleRows) ? throttleRows[0] : throttleRows
    ) as { allowed?: boolean } | undefined;
    if (!throttle?.allowed) {
      return { outcome: 'rate_limited' };
    }

    // 1. Candidate scan: unexpired AND (never locked OR lock elapsed).
    const { data: candidateRows, error: scanErr } = await admin
      .from('whatsapp_link_challenges')
      .select('id, auth_user_id, student_id, guardian_id, role, otp_hash, attempt_count')
      .gt('expires_at', nowIso)
      .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
      .order('created_at', { ascending: false })
      .limit(CANDIDATE_SCAN_LIMIT);
    if (scanErr) {
      logger.error('whatsapp link-binding: challenge scan failed', {
        source: input.source,
        error: scanErr.message,
      });
      return { outcome: 'error' };
    }

    // verifyOtp(otp, expectedHash, salt) — salt is the challenge row id.
    const matches = ((candidateRows ?? []) as ChallengeRow[]).filter((c) =>
      verifyOtp(code, c.otp_hash, c.id),
    );

    if (matches.length === 0) {
      // Nothing to attribute the failure to (the intended challenge is
      // unknowable), so no attempt_count is incremented — the 10-minute TTL
      // and the candidate-scan bound are the brute-force backstop.
      return { outcome: 'invalid' };
    }
    if (matches.length > 1) {
      // Two live challenges verifying the same code: fail closed (plan rule).
      logger.warn('whatsapp link-binding: ambiguous OTP match — failing closed', {
        source: input.source,
        matchCount: matches.length,
      });
      return { outcome: 'ambiguous' };
    }

    const challenge = matches[0];

    // 2. Attempt-exhaustion lockout.
    if (challenge.attempt_count >= OTP_MAX_ATTEMPTS) {
      const { error: lockErr } = await admin
        .from('whatsapp_link_challenges')
        .update({ locked_until: computeLockoutUntil().toISOString() })
        .eq('id', challenge.id);
      if (lockErr) {
        logger.error('whatsapp link-binding: lockout update failed', {
          source: input.source,
          error: lockErr.message,
        });
      }
      return { outcome: 'locked' };
    }

    // 3. Resolve the raw phone (P13 — see module header).
    let phoneE164 = input.phoneE164;
    if (!phoneE164) {
      const { data: knownIdentity, error: knownErr } = await admin
        .from('whatsapp_identities')
        .select('phone_e164')
        .eq('phone_hash', input.phoneHash)
        .is('revoked_at', null)
        .limit(1)
        .maybeSingle();
      if (knownErr) {
        logger.error('whatsapp link-binding: phone recovery lookup failed', {
          source: input.source,
          error: knownErr.message,
        });
        return { outcome: 'error' };
      }
      phoneE164 = (knownIdentity?.phone_e164 as string | undefined) ?? null;
      if (!phoneE164) {
        return { outcome: 'phone_unavailable' };
      }
    }

    // 4. Existing LIVE binding for this phone+subject → re-verify (the
    //    partial-unique live-binding indexes make a second insert impossible).
    let existingQuery = admin
      .from('whatsapp_identities')
      .select('id')
      .eq('phone_e164', phoneE164)
      .is('revoked_at', null);
    existingQuery =
      challenge.role === 'student'
        ? existingQuery.eq('student_id', challenge.student_id)
        : existingQuery.eq('guardian_id', challenge.guardian_id);
    const { data: existing, error: existErr } = await existingQuery
      .limit(1)
      .maybeSingle();
    if (existErr) {
      logger.error('whatsapp link-binding: existing-binding lookup failed', {
        source: input.source,
        error: existErr.message,
      });
      return { outcome: 'error' };
    }

    // 5. Shared-phone cap: for a FRESH student bind, count live student
    //    bindings BEFORE the challenge is consumed. This is a read, so a
    //    'limit' outcome leaves the challenge intact — the OTP is not burned
    //    on a capped phone. Guardian bindings are not capped, and a re-verify
    //    already holds one of the counted slots.
    if (!existing && challenge.role === 'student') {
      const { count, error: cntErr } = await admin
        .from('whatsapp_identities')
        .select('id', { count: 'exact', head: true })
        .eq('phone_e164', phoneE164)
        .is('revoked_at', null)
        .not('student_id', 'is', null);
      if (cntErr) {
        logger.error('whatsapp link-binding: binding-count query failed', {
          source: input.source,
          error: cntErr.message,
        });
        return { outcome: 'error' };
      }
      if ((count ?? 0) >= MAX_LIVE_STUDENT_BINDINGS_PER_PHONE) {
        return { outcome: 'limit' };
      }
    }

    // 6. Consume the challenge — single use. Delete strictly BEFORE the
    //    identity write so a crash between the two steps costs the user a
    //    re-request, never a replayable OTP.
    const { error: delErr } = await admin
      .from('whatsapp_link_challenges')
      .delete()
      .eq('id', challenge.id);
    if (delErr) {
      logger.error('whatsapp link-binding: challenge delete failed', {
        source: input.source,
        error: delErr.message,
      });
      return { outcome: 'error' };
    }

    const verifiedFields = {
      auth_user_id: challenge.auth_user_id,
      verified_at: nowIso,
      verified_via: 'web_deeplink_otp',
      opt_in_status: 'opted_in',
      opted_in_at: nowIso,
    };

    let identityId: string | null = null;
    let reverified = false;

    if (existing) {
      const { error: updErr } = await admin
        .from('whatsapp_identities')
        .update(verifiedFields)
        .eq('id', existing.id);
      if (updErr) {
        logger.error('whatsapp link-binding: re-verify update failed', {
          source: input.source,
          error: updErr.message,
        });
        return { outcome: 'error' };
      }
      identityId = existing.id as string;
      reverified = true;
    } else {
      // Fresh bind — the sibling cap was already enforced (step 5) before the
      // challenge was consumed.
      const { data: insertedRow, error: insErr } = await admin
        .from('whatsapp_identities')
        .insert({
          phone_e164: phoneE164,
          phone_hash: input.phoneHash,
          student_id: challenge.role === 'student' ? challenge.student_id : null,
          guardian_id: challenge.role === 'guardian' ? challenge.guardian_id : null,
          role: challenge.role,
          ...verifiedFields,
        })
        .select('id')
        .single();
      if (insErr) {
        if ((insErr as { code?: string }).code === '23505') {
          // Race: a concurrent bind won on the partial-unique live index.
          // Treat as re-verify — fetch the live row and stamp verified_at.
          let raceQuery = admin
            .from('whatsapp_identities')
            .select('id')
            .eq('phone_e164', phoneE164)
            .is('revoked_at', null);
          raceQuery =
            challenge.role === 'student'
              ? raceQuery.eq('student_id', challenge.student_id)
              : raceQuery.eq('guardian_id', challenge.guardian_id);
          const { data: raced } = await raceQuery.limit(1).maybeSingle();
          if (!raced) {
            logger.error('whatsapp link-binding: 23505 but no live row found', {
              source: input.source,
            });
            return { outcome: 'error' };
          }
          await admin
            .from('whatsapp_identities')
            .update(verifiedFields)
            .eq('id', raced.id);
          identityId = raced.id as string;
          reverified = true;
        } else {
          logger.error('whatsapp link-binding: identity insert failed', {
            source: input.source,
            error: insErr.message,
          });
          return { outcome: 'error' };
        }
      } else {
        identityId = insertedRow.id as string;
      }
    }

    // ── Binding is durable. Everything below is best-effort (never converts a
    //    successful bind into a user-visible failure). ──────────────────────

    // 7. DPDP consent trail.
    try {
      const { error: consentErr } = await admin
        .from('whatsapp_consent_events')
        .insert({
          identity_id: identityId,
          event: 'opt_in',
          source: 'whatsapp_link',
        });
      if (consentErr) {
        logger.error('whatsapp link-binding: consent event insert failed', {
          source: input.source,
          error: consentErr.message,
        });
      }
    } catch (err) {
      logger.error('whatsapp link-binding: consent event threw', {
        source: input.source,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 8. Session row (one per identity, UNIQUE(identity_id) — upsert).
    try {
      const { error: sessErr } = await admin.from('whatsapp_sessions').upsert(
        {
          identity_id: identityId,
          state: 'idle',
          active_student_id:
            challenge.role === 'student' ? challenge.student_id : null,
        },
        { onConflict: 'identity_id' },
      );
      if (sessErr) {
        logger.error('whatsapp link-binding: session upsert failed', {
          source: input.source,
          error: sessErr.message,
        });
      }
    } catch (err) {
      logger.error('whatsapp link-binding: session upsert threw', {
        source: input.source,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 9. Ops event — P13: redacted phone only ('phone_redacted' key so the
    //    ops-events PII redactor does not blank the already-safe value).
    await logOpsEvent({
      category: 'whatsapp',
      source: input.source,
      severity: 'info',
      message: 'identity_bound',
      subjectType: challenge.role,
      subjectId:
        (challenge.role === 'student'
          ? challenge.student_id
          : challenge.guardian_id) ?? undefined,
      context: {
        phone_redacted: redactPhone(phoneE164),
        role: challenge.role,
        reverified,
        verified_via: 'web_deeplink_otp',
      },
    });

    return { outcome: 'bound' };
  } catch (err) {
    logger.error('whatsapp link-binding: unhandled failure', {
      source: input.source,
      error: err instanceof Error ? err.message : String(err),
    });
    return { outcome: 'error' };
  }
}
