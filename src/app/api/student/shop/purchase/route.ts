/**
 * POST /api/student/shop/purchase
 *
 * Atomically purchases an item from the shop (e.g., Streak Freeze) using Foxy Coins or XP.
 * Calls the secure purchase_streak_freeze DB RPC.
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
  const auth = await authorizeRequest(request, 'student.profile.write', { requireStudentId: true });
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

  // Currently, the only item supported with backend logic is 'streak_freeze'
  if (itemId !== 'streak_freeze') {
    return err(`Item '${itemId}' is not available for purchase or has no backend handler`, 400);
  }

  // Resolve cost
  let cost = 0;
  if (currency === 'coins') {
    const shopItem = COIN_SHOP.find((item) => item.id === itemId);
    if (!shopItem) return err('Item configuration not found in shop', 500);
    cost = shopItem.cost;
  } else {
    const rewardItem = XP_REWARDS.find((item) => item.id === itemId);
    if (!rewardItem) return err('Item configuration not found in rewards', 500);
    cost = rewardItem.cost;
  }

  try {
    // Call database RPC
    const { data: newBalance, error: rpcError } = await supabaseAdmin.rpc('purchase_streak_freeze', {
      p_student_id: studentId,
      p_cost: cost,
      p_currency: currency,
    });

    if (rpcError) {
      // Check for known Postgres error messages
      if (rpcError.message.includes('Insufficient coin balance') || rpcError.message.includes('Insufficient XP balance')) {
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
      data: {
        itemId,
        currency,
        cost,
        newBalance,
      },
    });
  } catch (e) {
    logger.error('shop_purchase_failed', {
      error: e instanceof Error ? e : new Error(String(e)),
      studentId,
      itemId,
    });
    return err('An unexpected error occurred', 500);
  }
}
