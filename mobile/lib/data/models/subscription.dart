import 'package:equatable/equatable.dart';

class PlanInfo extends Equatable {
  final String code;
  final String name;
  final String icon;
  final int priceMonthly; // in rupees (INR)
  final int priceYearly; // in rupees (INR)
  final List<String> benefits;
  final bool isPopular;

  const PlanInfo({
    required this.code,
    required this.name,
    required this.icon,
    required this.priceMonthly,
    required this.priceYearly,
    required this.benefits,
    this.isPopular = false,
  });

  String get monthlyDisplay => '₹$priceMonthly/mo';
  String get yearlyDisplay => '₹$priceYearly/yr';
  String get yearlyMonthlyDisplay => '₹${priceYearly ~/ 12}/mo';

  @override
  List<Object?> get props => [code, name];
}

class SubscriptionState extends Equatable {
  final String planCode;
  final String? billingCycle;
  final DateTime? expiresAt;
  final bool isActive;

  const SubscriptionState({
    required this.planCode,
    this.billingCycle,
    this.expiresAt,
    this.isActive = true,
  });

  factory SubscriptionState.fromJson(Map<String, dynamic> json) {
    return SubscriptionState(
      planCode: json['plan_code'] as String? ?? 'free',
      billingCycle: json['billing_cycle'] as String?,
      expiresAt: json['expires_at'] != null
          ? DateTime.tryParse(json['expires_at'] as String)
          : null,
      isActive: json['is_active'] as bool? ?? true,
    );
  }

  bool get isFree => planCode == 'free';
  bool get isPremium => !isFree && isActive;

  @override
  List<Object?> get props => [planCode, billingCycle, expiresAt, isActive];
}

/// Available plans — mirrors web app's plans.ts
class Plans {
  Plans._();

  static const List<PlanInfo> all = [
    // Benefit strings below are kept byte-identical to the web source of
    // truth (`packages/lib/src/plans.ts` `benefits` arrays) — LOW
    // forensic-audit fix. UPDATE 2026-07-29: `starter`/`pro` copy corrected
    // from "30 Foxy chats/day" / "100 Foxy chats/day" to "Unlimited Foxy
    // chats" — Foxy chat usage has been unlimited for all paid plans since
    // migration `20260714120000_foxy_unlimited_for_paid_plans.sql`, and
    // mobile's own LIMIT LOGIC (dashboard_repository.dart, 999999 sentinel)
    // already reflects that. This brings paid-plan marketing copy in line
    // with actual enforcement; free tier keeps its real, still-enforced
    // 5/day limit (see Plans class docstring / dashboard_repository.dart).
    PlanInfo(
      code: 'starter',
      name: 'Starter',
      icon: '🌱',
      priceMonthly: 299,
      priceYearly: 2399,
      benefits: [
        'Unlimited Foxy chats',
        '20 quizzes/day',
        '4 subjects',
        'STEM Lab',
      ],
    ),
    PlanInfo(
      code: 'pro',
      name: 'Pro',
      icon: '⚡',
      priceMonthly: 699,
      priceYearly: 5599,
      isPopular: true,
      benefits: [
        'Unlimited Foxy chats',
        'Unlimited quizzes',
        'All subjects',
        'STEM Lab',
        'Advanced analytics',
      ],
    ),
    PlanInfo(
      code: 'unlimited',
      name: 'Unlimited',
      icon: '👑',
      priceMonthly: 1099,
      priceYearly: 8799,
      benefits: [
        'Unlimited Foxy chats',
        'Unlimited quizzes',
        'All subjects',
        'STEM Lab',
        'Priority support',
      ],
    ),
  ];
}
