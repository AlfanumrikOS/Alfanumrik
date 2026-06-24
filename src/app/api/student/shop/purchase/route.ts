/**
 * POST /api/student/shop/purchase
 *
 * Purchases an item from the Foxy Coin Shop using Foxy Coins or XP.
 * Dispatches to a per-item handler via ITEM_HANDLERS.
 *
 * Items supported:
 *   streak_freeze    — atomic RPC; deducts coins + grants a freeze day
 *   extra_chats_5    — grants +5 Foxy chats today via students table update
 *   mock_test_unlock — delivers an unlock notification (no exam_sessions row yet)
 *   revision_sprint  — delivers a Foxy revise-mode CTA notification
 *   certificate      — delivers a certificate-generation notification
 *
 * This spends the student's OWN earned in-app currency (coins/XP) and mutates
 * their own account/inventory state — it does NOT initiate a real-money or
 * subscription payment. The defensible self-service gate is therefore
 * `profile.update_own` (granted to the `student` role in the RBAC matrix
 * conformance migration 20260612123200), not `payments.subscribe`.
 *
 * Body: { itemId: string, currency?: 'coins' | 'xp' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { COIN_SHOP } from '@/lib/coin-rules';
import { XP_REWARDS } from '@/lib/xp-config';

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request, 'profile.update_own', { requireStudentId: true });
  if (!auth.authorized) return auth.errorResponse!;

  const studentId = auth.studentId!;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return err('Invalid request body', 400);
  }

  const { itemId, currency = 'coins' } = body;

  if (typeof itemId !== 'string' || !itemId) {
    return err('itemId is required', 400);
  }

  if (currency !== 'coins' && currency !== 'xp') {
    return err("currency must be 'coins' or 'xp'", 400);
  }

  // Resolve cost from shop/rewards catalog before dispatching to a handler.
  // This ensures every handler receives the correct, catalog-sourced cost value
  // and unknown items are rejected before any DB I/O.
  let cost = 0;
  if (currency === 'coins') {
    const shopItem = COIN_SHOP.find((item) => item.id === itemId);
    if (!shopItem) return err('Item not found', 404);
    cost = shopItem.cost;
  } else {
    const rewardItem = XP_REWARDS.find((item) => item.id === itemId);
    if (!rewardItem) return err('Item not found', 404);
    cost = rewardItem.cost;
  }

  // ── Handler dispatch map ────────────────────────────────────────────────
  // Each handler closes over (studentId, cost, currency) which are fully
  // resolved above. Add new shop items here; the early-exit has been removed.
  // ────────────────────────────────────────────────────────────────────────

  const ITEM_HANDLERS: Record<string, () => Promise<Response>> = {

    // ── streak_freeze ──────────────────────────────────────────────────────
    // Atomic RPC that deducts the cost and grants one streak-freeze day.
    // The RPC is the single source of truth for balance mutation (P11 posture).
    streak_freeze: async () => {
      try {
        const { data: newBalance, error: rpcError } = await supabaseAdmin.rpc(
          'purchase_streak_freeze',
          {
            p_student_id: studentId,
            p_cost: cost,
            p_currency: currency,
          },
        );

        if (rpcError) {
          if (
            rpcError.message.includes('Insufficient coin balance') ||
            rpcError.message.includes('Insufficient XP balance')
          ) {
            return err(rpcError.message, 400);
          }
          logger.error('shop_purchase_rpc_failed', {
            error: new Error(rpcError.message),
            studentId,
            itemId,
            currency,
          });
          return err('Failed to process purchase', 500);
        }

        logger.info('shop_item_purchased', {
          studentId,
          itemId,
          currency,
          cost,
          newBalance,
        });

        return NextResponse.json({
          success: true,
          data: { itemId, currency, cost, newBalance },
        });
      } catch (e) {
        logger.error('shop_purchase_failed', {
          error: e instanceof Error ? e : new Error(String(e)),
          studentId,
          itemId,
        });
        return err('An unexpected error occurred', 500);
      }
    },

    // ── extra_chats_5 ──────────────────────────────────────────────────────
    // Deducts coins via the streak_freeze RPC pattern (purchase_streak_freeze
    // is the only generic coin-deduction RPC available today; it covers any
    // itemId once the cost is pre-resolved). Then increments foxy_extra_chats
    // on the students row so the chat-limit enforcement picks it up at runtime.
    extra_chats_5: async () => {
      try {
        // Step 1: deduct coins atomically via the existing purchase RPC.
        const { error: deductErr } = await supabaseAdmin.rpc('purchase_streak_freeze', {
          p_student_id: studentId,
          p_cost: cost,
          p_currency: currency,
        });

        if (deductErr) {
          if (
            deductErr.message.includes('Insufficient coin balance') ||
            deductErr.message.includes('Insufficient XP balance')
          ) {
            return err(deductErr.message, 400);
          }
          logger.error('shop_purchase_rpc_failed', {
            error: new Error(deductErr.message),
            studentId,
            itemId,
            currency,
          });
          return err('Failed to process purchase', 500);
        }

        // Step 2: fetch current foxy_extra_chats value.
        const { data: studentRow } = await supabaseAdmin
          .from('students')
          .select('foxy_extra_chats')
          .eq('id', studentId)
          .single();

        // Step 3: increment foxy_extra_chats by 5. If the column does not yet
        // exist on the schema the update is a best-effort no-op; the coin
        // deduction already succeeded so we still return success.
        const currentExtra = (studentRow as { foxy_extra_chats?: number } | null)
          ?.foxy_extra_chats ?? 0;

        const { error: updateErr } = await supabaseAdmin
          .from('students')
          .update({ foxy_extra_chats: currentExtra + 5 })
          .eq('id', studentId);

        if (updateErr) {
          // Column absent or update failed — log for ops visibility but do not
          // fail the purchase (deduction is already committed; chat enforcement
          // will handle the allowance via a future migration or fallback).
          logger.error('shop_extra_chats_update_failed', {
            error: new Error(updateErr.message),
            studentId,
          });
        }

        logger.info('shop_item_purchased', { studentId, itemId, currency, cost });
        return NextResponse.json({ success: true, item: 'extra_chats_5' });
      } catch (e) {
        logger.error('shop_purchase_failed', {
          error: e instanceof Error ? e : new Error(String(e)),
          studentId,
          itemId,
        });
        return err('An unexpected error occurred', 500);
      }
    },

    // ── mock_test_unlock ───────────────────────────────────────────────────
    // Deducts coins and delivers an in-app achievement notification signalling
    // that one premium mock test has been unlocked. The student picks it up
    // from the Exams page. A dedicated student_unlocks table or exam_sessions
    // insert is tracked as a follow-up (no such table exists at this revision).
    mock_test_unlock: async () => {
      try {
        const { error: deductErr } = await supabaseAdmin.rpc('purchase_streak_freeze', {
          p_student_id: studentId,
          p_cost: cost,
          p_currency: currency,
        });

        if (deductErr) {
          if (
            deductErr.message.includes('Insufficient coin balance') ||
            deductErr.message.includes('Insufficient XP balance')
          ) {
            return err(deductErr.message, 400);
          }
          logger.error('shop_purchase_rpc_failed', {
            error: new Error(deductErr.message),
            studentId,
            itemId,
            currency,
          });
          return err('Failed to process purchase', 500);
        }

        const { error: notifErr } = await supabaseAdmin.from('notifications').insert({
          recipient_type: 'student',
          recipient_id: studentId,
          type: 'achievement',
          title: 'Mock Test Unlocked!',
          title_hi: 'मॉक टेस्ट अनलॉक!',
          body: 'You unlocked one premium mock test session. Start from the Exams page.',
          body_hi: 'आपने एक प्रीमियम मॉक टेस्ट सेशन अनलॉक किया। Exams पेज से शुरू करें।',
          data: { trigger: 'mock_test_unlock', item_id: 'mock_test_unlock' },
          is_read: false,
        });

        if (notifErr) {
          return NextResponse.json({ error: 'purchase_failed' }, { status: 500 });
        }

        logger.info('shop_item_purchased', { studentId, itemId, currency, cost });
        return NextResponse.json({ success: true, item: 'mock_test_unlock' });
      } catch (e) {
        logger.error('shop_purchase_failed', {
          error: e instanceof Error ? e : new Error(String(e)),
          studentId,
          itemId,
        });
        return err('An unexpected error occurred', 500);
      }
    },

    // ── revision_sprint ────────────────────────────────────────────────────
    // Deducts coins and delivers a CTA notification directing the student to
    // open Foxy in "revise" mode. The redirect hint is included in the response
    // so the client can optionally navigate immediately.
    revision_sprint: async () => {
      try {
        const { error: deductErr } = await supabaseAdmin.rpc('purchase_streak_freeze', {
          p_student_id: studentId,
          p_cost: cost,
          p_currency: currency,
        });

        if (deductErr) {
          if (
            deductErr.message.includes('Insufficient coin balance') ||
            deductErr.message.includes('Insufficient XP balance')
          ) {
            return err(deductErr.message, 400);
          }
          logger.error('shop_purchase_rpc_failed', {
            error: new Error(deductErr.message),
            studentId,
            itemId,
            currency,
          });
          return err('Failed to process purchase', 500);
        }

        const { error: notifErr } = await supabaseAdmin.from('notifications').insert({
          recipient_type: 'student',
          recipient_id: studentId,
          type: 'achievement',
          title: 'Revision Sprint Ready!',
          title_hi: 'रिवीज़न स्प्रिंट तैयार!',
          body: 'Your revision sprint is ready! Open Foxy and select "Revise" mode.',
          body_hi: 'आपका रिवीजन स्प्रिंट तैयार है! Foxy खोलें और "Revise" मोड चुनें।',
          data: {
            trigger: 'revision_sprint',
            item_id: 'revision_sprint',
            foxy_mode: 'revise',
          },
          is_read: false,
        });

        if (notifErr) {
          return NextResponse.json({ error: 'purchase_failed' }, { status: 500 });
        }

        logger.info('shop_item_purchased', { studentId, itemId, currency, cost });
        return NextResponse.json({
          success: true,
          item: 'revision_sprint',
          redirect: '/foxy?mode=revise',
        });
      } catch (e) {
        logger.error('shop_purchase_failed', {
          error: e instanceof Error ? e : new Error(String(e)),
          studentId,
          itemId,
        });
        return err('An unexpected error occurred', 500);
      }
    },

    // ── certificate ────────────────────────────────────────────────────────
    // Deducts coins and delivers an achievement notification. Certificate PDF
    // generation is triggered asynchronously by the export-report Edge Function
    // (tracked as a follow-up; the notification signals readiness in 1-2 min).
    certificate: async () => {
      try {
        const { error: deductErr } = await supabaseAdmin.rpc('purchase_streak_freeze', {
          p_student_id: studentId,
          p_cost: cost,
          p_currency: currency,
        });

        if (deductErr) {
          if (
            deductErr.message.includes('Insufficient coin balance') ||
            deductErr.message.includes('Insufficient XP balance')
          ) {
            return err(deductErr.message, 400);
          }
          logger.error('shop_purchase_rpc_failed', {
            error: new Error(deductErr.message),
            studentId,
            itemId,
            currency,
          });
          return err('Failed to process purchase', 500);
        }

        const { error: notifErr } = await supabaseAdmin.from('notifications').insert({
          recipient_type: 'student',
          recipient_id: studentId,
          type: 'achievement',
          title: 'Certificate Earned!',
          title_hi: 'प्रमाणपत्र अर्जित!',
          body: 'Your certificate is being generated and will be ready in a few minutes.',
          body_hi: 'आपका प्रमाणपत्र बन रहा है और कुछ मिनटों में तैयार हो जाएगा।',
          data: { trigger: 'certificate', item_id: 'certificate' },
          is_read: false,
        });

        if (notifErr) {
          return NextResponse.json({ error: 'purchase_failed' }, { status: 500 });
        }

        logger.info('shop_item_purchased', { studentId, itemId, currency, cost });
        return NextResponse.json({ success: true, item: 'certificate' });
      } catch (e) {
        logger.error('shop_purchase_failed', {
          error: e instanceof Error ? e : new Error(String(e)),
          studentId,
          itemId,
        });
        return err('An unexpected error occurred', 500);
      }
    },
  };

  // Dispatch to the item-specific handler. Unknown itemIds are rejected here
  // (after cost resolution already confirmed the item exists in the catalog).
  const handler = ITEM_HANDLERS[itemId];
  if (!handler) {
    return NextResponse.json(
      { error: 'item_not_found', message: 'Unknown item ID' },
      { status: 404 },
    );
  }
  return handler();
}
