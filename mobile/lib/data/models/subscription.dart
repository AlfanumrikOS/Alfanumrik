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
    PlanInfo(
      code: 'starter',
      name: 'Starter',
      icon: '🌱',
      priceMonthly: 299,
      priceYearly: 2399,
      benefits: [
        '30 Foxy chats/day',
        '20 quizzes/day',
        '4 subjects',
        'Interactive labs',
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
        '100 Foxy chats/day',
        'Unlimited quizzes',
        'All subjects',
        'Detailed analytics',
        'Parent reports',
      ],
    ),
    PlanInfo(
      code: 'unlimited',
      name: 'Unlimited',
      icon: '👑',
      priceMonthly: 1499,
      priceYearly: 11999,
      benefits: [
        'Unlimited Foxy chats',
        'Unlimited quizzes',
        'All subjects',
        'Priority support',
        'Full analytics',
        'Study planner',
      ],
    ),
  ];
}
