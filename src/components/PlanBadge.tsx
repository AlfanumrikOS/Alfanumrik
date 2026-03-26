'use client';

import { getPlanConfig, isPremium } from '@/lib/plans';
import Link from 'next/link';

interface PlanBadgeProps {
  planCode: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  showUpgrade?: boolean;
  isHi?: boolean;
}

/**
 * PlanBadge — displays the student's active plan with icon and styling.
 * Reads from the real subscription_plan field.
 * Sizes: sm (inline pill), md (card chip), lg (full card).
 */
export function PlanBadge({ planCode, size = 'sm', showUpgrade = false, isHi = false }: PlanBadgeProps) {
  const plan = getPlanConfig(planCode);
  const premium = isPremium(planCode);

  if (size === 'sm') {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold"
        style={{ background: `${plan.color}15`, color: plan.color, border: `1px solid ${plan.color}25` }}
      >
        <span>{plan.icon}</span>
        <span>{plan.name}</span>
      </span>
    );
  }

  if (size === 'md') {
    return (
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold"
          style={{ background: plan.gradient, color: '#fff' }}
        >
          <span>{plan.icon}</span>
          <span>{plan.name}</span>
        </span>
        {showUpgrade && plan.nextPlanLabel && (
          <Link href="/pricing" className="text-[10px] font-semibold" style={{ color: plan.color }}>
            {plan.nextPlanLabel}
          </Link>
        )}
      </div>
    );
  }

  // size === 'lg' — full plan card
  return (
    <div
      className="rounded-2xl p-4 relative overflow-hidden"
      style={{ background: `${plan.color}08`, border: `1px solid ${plan.color}20` }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className="w-8 h-8 rounded-xl flex items-center justify-center text-lg"
            style={{ background: plan.gradient }}
          >
            {plan.icon}
          </span>
          <div>
            <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
              {plan.name} {isHi ? 'प्लान' : 'Plan'}
            </div>
            <div className="text-[10px] font-medium" style={{ color: plan.color }}>
              {premium ? (isHi ? '✓ सक्रिय' : '✓ Active') : (isHi ? plan.taglineHi : plan.tagline)}
            </div>
          </div>
        </div>
        {showUpgrade && plan.nextPlanLabel && (
          <Link
            href="/pricing"
            className="text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95"
            style={{ background: plan.gradient, color: '#fff' }}
          >
            {isHi ? 'अपग्रेड' : 'Upgrade'}
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(isHi ? plan.benefitsHi : plan.benefits).slice(0, 3).map((b, i) => (
          <span key={i} className="text-[9px] font-medium px-2 py-0.5 rounded-md" style={{ background: `${plan.color}10`, color: plan.color }}>
            {b}
          </span>
        ))}
      </div>
    </div>
  );
}
