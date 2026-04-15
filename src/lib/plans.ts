/**
 * ALFANUMRIK — Plan Identity System
 *
 * Centralized plan configuration for consistent display across the app.
 * Maps DB plan codes to display names, icons, colors, and benefits.
 *
 * Source of truth for plan code: students.subscription_plan
 * Values: 'free' | 'starter' | 'pro' | 'unlimited' | null
 */

export interface PlanConfig {
  code: string;
  name: string;
  nameHi: string;
  icon: string;
  color: string;
  gradient: string;
  tagline: string;
  taglineHi: string;
  benefits: string[];
  benefitsHi: string[];
  tier: number; // 0=free, 1=starter, 2=pro, 3=unlimited
  nextPlan: string | null;
  nextPlanLabel: string | null;
}

export const PLANS: Record<string, PlanConfig> = {
  free: {
    code: 'free',
    name: 'Explorer',
    nameHi: 'एक्सप्लोरर',
    icon: '🧭',
    color: '#64748B',
    gradient: 'linear-gradient(135deg, #64748B, #94A3B8)',
    tagline: 'Start your learning journey',
    taglineHi: 'अपनी सीखने की यात्रा शुरू करें',
    benefits: ['5 Foxy chats/day', '5 quizzes/day', '2 subjects'],
    benefitsHi: ['5 फॉक्सी चैट/दिन', '5 क्विज़/दिन', '2 विषय'],
    tier: 0,
    nextPlan: 'starter',
    nextPlanLabel: 'Upgrade to Starter →',
  },
  starter: {
    code: 'starter',
    name: 'Starter',
    nameHi: 'स्टार्टर',
    icon: '🚀',
    color: '#E8581C',
    gradient: 'linear-gradient(135deg, #E8581C, #F59E0B)',
    tagline: 'More learning, more growth',
    taglineHi: 'और सीखो, और बढ़ो',
    benefits: ['30 Foxy chats/day', '20 quizzes/day', '4 subjects', 'STEM Lab'],
    benefitsHi: ['30 चैट/दिन', '20 क्विज़/दिन', '4 विषय', 'STEM लैब'],
    tier: 1,
    nextPlan: 'pro',
    nextPlanLabel: 'Upgrade to Pro →',
  },
  pro: {
    code: 'pro',
    name: 'Pro',
    nameHi: 'प्रो',
    icon: '⭐',
    color: '#7C3AED',
    gradient: 'linear-gradient(135deg, #7C3AED, #A855F7)',
    tagline: 'The complete learning experience',
    taglineHi: 'संपूर्ण सीखने का अनुभव',
    benefits: ['100 Foxy chats/day', 'Unlimited quizzes', 'All subjects', 'STEM Lab', 'Advanced analytics'],
    benefitsHi: ['100 चैट/दिन', 'असीमित क्विज़', 'सभी विषय', 'STEM लैब', 'उन्नत विश्लेषण'],
    tier: 2,
    nextPlan: 'unlimited',
    nextPlanLabel: 'Upgrade to Unlimited →',
  },
  unlimited: {
    code: 'unlimited',
    name: 'Unlimited',
    nameHi: 'अनलिमिटेड',
    icon: '💎',
    color: '#0891B2',
    gradient: 'linear-gradient(135deg, #0891B2, #06B6D4)',
    tagline: 'No limits. Maximum results.',
    taglineHi: 'कोई सीमा नहीं। अधिकतम परिणाम।',
    benefits: ['Unlimited Foxy chats', 'Unlimited quizzes', 'All subjects', 'STEM Lab', 'Priority support'],
    benefitsHi: ['असीमित चैट', 'असीमित क्विज़', 'सभी विषय', 'STEM लैब', 'प्राथमिकता सहायता'],
    tier: 3,
    nextPlan: null,
    nextPlanLabel: null,
  },
};

/**
 * Centralized pricing — single source of truth for all UI components.
 * Imported by PricingCards, UpgradeModal, and super-admin analytics.
 */
export const PRICING = {
  starter: { monthly: 299, yearly: 2399 },
  pro: { monthly: 699, yearly: 5599 },
  unlimited: { monthly: 1499, yearly: 11999 },
} as const;

/** Helper: format INR price with comma separator */
export function formatINR(amount: number): string {
  return `\u20B9${amount.toLocaleString('en-IN')}`;
}

/** Helper: monthly equivalent of yearly price (rounded) */
export function yearlyPerMonth(yearlyPrice: number): number {
  return Math.round(yearlyPrice / 12);
}

// Maps legacy codes and billing-cycle variants to canonical tier
const PLAN_ALIAS: Record<string, string> = {
  basic: 'starter', premium: 'pro', ultimate: 'unlimited',
};

/** Normalise any plan code variant to a canonical tier key recognised by PLANS. */
export function normalizePlanCode(planCode: string | null | undefined): string {
  const code = (planCode || 'free').replace(/_(monthly|yearly)$/, '');
  return PLAN_ALIAS[code] ?? code;
}

/** Get plan config from DB plan code. Falls back to free plan. */
export function getPlanConfig(planCode: string | null | undefined): PlanConfig {
  return PLANS[normalizePlanCode(planCode)] ?? PLANS.free;
}

/** Check if a plan is premium (paid) */
export function isPremium(planCode: string | null | undefined): boolean {
  const config = getPlanConfig(planCode);
  return config.tier > 0;
}
