'use client';

import { useState, useCallback } from 'react';
import { XP_REWARDS } from '@/lib/xp-rules';
import { Card, Button, Badge, SheetModal } from '@/components/ui';

/* ─── Types ──────────────────────────────────────────────── */

interface XPRewardShopProps {
  balance: number;
  isHi: boolean;
  onRedeem: (rewardId: string) => Promise<boolean>;
}

type RewardItem = typeof XP_REWARDS[number];

/* ─── Category Colors ────────────────────────────────────── */

const CATEGORY_COLORS: Record<string, string> = {
  protection: '#3B82F6',
  boost: '#F59E0B',
  premium: '#9333EA',
  reward: '#22C55E',
};

/* ─── Component ──────────────────────────────────────────── */

export default function XPRewardShop({ balance, isHi, onRedeem }: XPRewardShopProps) {
  const [selectedReward, setSelectedReward] = useState<RewardItem | null>(null);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [redeemResult, setRedeemResult] = useState<'success' | 'error' | null>(null);

  const handleRedeem = useCallback(async () => {
    if (!selectedReward) return;
    setIsRedeeming(true);
    setRedeemResult(null);
    try {
      const ok = await onRedeem(selectedReward.id);
      setRedeemResult(ok ? 'success' : 'error');
      if (ok) {
        // Auto-close after brief success display
        setTimeout(() => {
          setSelectedReward(null);
          setRedeemResult(null);
        }, 1500);
      }
    } catch {
      setRedeemResult('error');
    } finally {
      setIsRedeeming(false);
    }
  }, [selectedReward, onRedeem]);

  const closeModal = useCallback(() => {
    if (!isRedeeming) {
      setSelectedReward(null);
      setRedeemResult(null);
    }
  }, [isRedeeming]);

  return (
    <>
      <Card className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3
            className="text-sm font-bold uppercase tracking-wider"
            style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}
          >
            {isHi ? '\u092A\u0941\u0930\u0938\u094D\u0915\u093E\u0930' : 'Rewards'}
          </h3>
          <Badge color="var(--orange)" size="md">
            {balance.toLocaleString()} XP
          </Badge>
        </div>

        {/* Rewards grid */}
        <div className="grid grid-cols-2 gap-3">
          {XP_REWARDS.map((reward) => {
            const canAfford = balance >= reward.cost;
            const catColor = CATEGORY_COLORS[reward.category] ?? 'var(--text-3)';

            return (
              <button
                key={reward.id}
                onClick={() => setSelectedReward(reward)}
                className="rounded-xl p-3 text-left transition-all active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
                style={{
                  background: canAfford ? `${catColor}08` : 'var(--surface-2)',
                  border: `1.5px solid ${canAfford ? `${catColor}30` : 'var(--border)'}`,
                  opacity: canAfford ? 1 : 0.65,
                }}
              >
                {/* Icon */}
                <div className="text-2xl mb-2">{reward.icon}</div>

                {/* Name */}
                <p
                  className="text-sm font-bold leading-tight"
                  style={{ color: 'var(--text-1)' }}
                >
                  {isHi ? reward.nameHi : reward.name}
                </p>

                {/* Description */}
                <p className="text-xs text-[var(--text-3)] mt-0.5 line-clamp-2">
                  {isHi ? reward.descriptionHi : reward.description}
                </p>

                {/* Cost */}
                <div className="mt-2 flex items-center gap-1">
                  <span
                    className="text-xs font-bold"
                    style={{ color: canAfford ? catColor : 'var(--text-3)' }}
                  >
                    {reward.cost} XP
                  </span>
                  {!canAfford && (
                    <span className="text-xs text-[var(--text-3)]">
                      &middot; {isHi ? '\u0914\u0930 \u0915\u092E\u093E\u0913' : 'Save up'}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Confirmation Modal */}
      <SheetModal
        open={selectedReward !== null}
        onClose={closeModal}
        title={isHi ? '\u092A\u0941\u0930\u0938\u094D\u0915\u093E\u0930 \u092A\u094D\u0930\u093E\u092A\u094D\u0924 \u0915\u0930\u094B' : 'Redeem Reward'}
      >
        {selectedReward && (
          <div className="space-y-4 py-2">
            {/* Reward display */}
            <div className="text-center">
              <div className="text-5xl mb-2">{selectedReward.icon}</div>
              <h4 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                {isHi ? selectedReward.nameHi : selectedReward.name}
              </h4>
              <p className="text-sm text-[var(--text-3)] mt-1">
                {isHi ? selectedReward.descriptionHi : selectedReward.description}
              </p>
            </div>

            {/* Cost summary */}
            <div
              className="rounded-xl p-3 flex items-center justify-between"
              style={{ background: 'var(--surface-2)' }}
            >
              <span className="text-sm text-[var(--text-2)]">
                {isHi ? '\u0932\u093E\u0917\u0924' : 'Cost'}
              </span>
              <span className="text-sm font-bold" style={{ color: 'var(--orange)' }}>
                {selectedReward.cost} XP
              </span>
            </div>
            <div
              className="rounded-xl p-3 flex items-center justify-between"
              style={{ background: 'var(--surface-2)' }}
            >
              <span className="text-sm text-[var(--text-2)]">
                {isHi ? '\u0906\u092A\u0915\u093E \u092C\u0948\u0932\u0947\u0902\u0938' : 'Your balance'}
              </span>
              <span
                className={`text-sm font-bold ${balance >= selectedReward.cost ? '' : 'text-red-600'}`}
                style={balance >= selectedReward.cost ? { color: 'var(--green, #22C55E)' } : undefined}
              >
                {balance.toLocaleString()} XP
              </span>
            </div>

            {/* Success/Error state */}
            {redeemResult === 'success' && (
              <p className="text-center text-sm font-bold" style={{ color: 'var(--green, #22C55E)' }}>
                {isHi ? '\u0938\u092B\u0932! \u092A\u0941\u0930\u0938\u094D\u0915\u093E\u0930 \u092A\u094D\u0930\u093E\u092A\u094D\u0924 \u0939\u0941\u0906!' : 'Reward redeemed successfully!'}
              </p>
            )}
            {redeemResult === 'error' && (
              <p className="text-center text-sm font-bold text-red-600">
                {isHi ? '\u0915\u0941\u091B \u0917\u0932\u0924 \u0939\u0941\u0906\u0964 \u092A\u0941\u0928\u0903 \u092A\u094D\u0930\u092F\u093E\u0938 \u0915\u0930\u0947\u0902\u0964' : 'Something went wrong. Please try again.'}
              </p>
            )}

            {/* Action buttons */}
            {redeemResult !== 'success' && (
              <div className="space-y-2">
                {balance >= selectedReward.cost ? (
                  <Button
                    variant="primary"
                    fullWidth
                    onClick={handleRedeem}
                    disabled={isRedeeming}
                  >
                    {isRedeeming
                      ? (isHi ? '\u092A\u094D\u0930\u094B\u0938\u0947\u0938 \u0939\u094B \u0930\u0939\u093E...' : 'Processing...')
                      : (isHi ? `${selectedReward.cost} XP \u0938\u0947 \u092A\u094D\u0930\u093E\u092A\u094D\u0924 \u0915\u0930\u094B` : `Redeem for ${selectedReward.cost} XP`)}
                  </Button>
                ) : (
                  <div
                    className="rounded-xl p-3 text-center text-sm font-semibold"
                    style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
                  >
                    {isHi ? '\u092A\u0930\u094D\u092F\u093E\u092A\u094D\u0924 XP \u0928\u0939\u0940\u0902' : 'Not enough XP'}
                    <span className="block text-xs mt-0.5 font-normal">
                      {isHi
                        ? `\u0914\u0930 ${selectedReward.cost - balance} XP \u0915\u092E\u093E\u0913`
                        : `Need ${selectedReward.cost - balance} more XP`}
                    </span>
                  </div>
                )}
                <Button variant="ghost" fullWidth onClick={closeModal}>
                  {isHi ? '\u0935\u093E\u092A\u0938 \u091C\u093E\u0913' : 'Go back'}
                </Button>
              </div>
            )}
          </div>
        )}
      </SheetModal>
    </>
  );
}
