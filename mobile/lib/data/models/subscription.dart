import 'package:equatable/equatable.dart';

class PlanInfo extends Equatable {
  final String code;
  final String name;
  final String icon;
  final int priceMonthly; // in paise
  final int priceYearly; // in paise
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

  String get monthlyDisplay => '₹${priceMonthly ~/ 100}/mo';
  String get yearlyDisplay => '₹${priceYearly ~/ 100}/yr';
  String get yearlyMonthlyDisplay =>
      '₹${(priceYearly ~/ 12) ~/ 100}/mo';

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
      priceMonthly: 9900, // ₹99
      priceYearly: 79900, // ₹799
      benefits: [
        '25 Foxy chats/day',
        '20 quizzes/day',
        'All subjects',
        'Basic progress tracking',
      ],
    ),
    PlanInfo(
      code: 'pro',
      name: 'Pro',
      icon: '⚡',
      priceMonthly: 19900, // ₹199
      priceYearly: 159900, // ₹1,599
      isPopular: true,
      benefits: [
        '100 Foxy chats/day',
        'Unlimited quizzes',
        'All simulations',
        'Detailed analytics',
        'Parent reports',
      ],
    ),
    PlanInfo(
      code: 'ultimate',
      name: 'Ultimate',
      icon: '👑',
      priceMonthly: 29900, // ₹299
      priceYearly: 239900, // ₹2,399
      benefits: [
        'Unlimited Foxy chats',
        'Unlimited quizzes',
        'All simulations',
        'Priority support',
        'Full analytics',
        'Study planner',
      ],
    ),
  ];
}
