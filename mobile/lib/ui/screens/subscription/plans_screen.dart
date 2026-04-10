import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/api_constants.dart';
import '../../../data/models/subscription.dart';
import '../../../providers/subscription_provider.dart';
import '../../../providers/auth_provider.dart';

class PlansScreen extends ConsumerStatefulWidget {
  const PlansScreen({super.key});

  @override
  ConsumerState<PlansScreen> createState() => _PlansScreenState();
}

class _PlansScreenState extends ConsumerState<PlansScreen> {
  bool _isYearly = true;
  bool _isLoading = false;
  String? _error;
  late Razorpay _razorpay;

  @override
  void initState() {
    super.initState();
    _razorpay = Razorpay();
    _razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _onPaymentSuccess);
    _razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _onPaymentError);
    _razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, _onExternalWallet);
  }

  @override
  void dispose() {
    _razorpay.clear();
    super.dispose();
  }

  Future<void> _checkout(PlanInfo plan) async {
    final student = ref.read(studentProvider).valueOrNull;
    if (student == null) return;

    setState(() { _isLoading = true; _error = null; });

    final billingCycle = _isYearly ? 'yearly' : 'monthly';
    final repo = ref.read(subscriptionRepositoryProvider);

    final result = await repo.createOrder(
      planCode: plan.code,
      billingCycle: billingCycle,
    );

    result.when(
      success: (data) {
        final options = {
          'key': ApiConstants.razorpayKeyId,
          'order_id': data['order_id'],
          'amount': data['amount'],
          'name': 'Alfanumrik',
          'description': '${plan.name} Plan — $billingCycle',
          'prefill': {
            'email': student.email ?? '',
            'contact': '',
          },
          'theme': {'color': '#8B6F47'},
          'notes': {
            'plan_code': plan.code,
            'billing_cycle': billingCycle,
          },
        };
        _razorpay.open(options);
        setState(() => _isLoading = false);
      },
      failure: (msg) {
        setState(() { _isLoading = false; _error = msg; });
      },
    );
  }

  void _onPaymentSuccess(PaymentSuccessResponse response) async {
    setState(() => _isLoading = true);

    final repo = ref.read(subscriptionRepositoryProvider);
    final result = await repo.verifyPayment(
      orderId: response.orderId ?? '',
      paymentId: response.paymentId ?? '',
      signature: response.signature ?? '',
      planCode: '', // Extracted from order notes
      billingCycle: _isYearly ? 'yearly' : 'monthly',
    );

    result.when(
      success: (_) {
        ref.read(subscriptionProvider.notifier).refresh();
        ref.read(studentProvider.notifier).refresh();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Upgrade successful! 🎉'),
              backgroundColor: AppColors.success,
            ),
          );
          context.pop();
        }
      },
      failure: (msg) {
        setState(() { _isLoading = false; _error = msg; });
      },
    );
  }

  void _onPaymentError(PaymentFailureResponse response) {
    setState(() {
      _isLoading = false;
      _error = 'Payment failed. Please try again.';
    });
  }

  void _onExternalWallet(ExternalWalletResponse response) {}

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Choose Your Plan'),
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          onPressed: () => context.pop(),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            // Billing toggle
            Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: AppColors.surfaceAlt,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: GestureDetector(
                      onTap: () => setState(() => _isYearly = false),
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        decoration: BoxDecoration(
                          color: !_isYearly ? AppColors.surface : Colors.transparent,
                          borderRadius: BorderRadius.circular(10),
                          boxShadow: !_isYearly
                              ? [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 4)]
                              : null,
                        ),
                        alignment: Alignment.center,
                        child: Text(
                          'Monthly',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: !_isYearly ? AppColors.textPrimary : AppColors.textTertiary,
                          ),
                        ),
                      ),
                    ),
                  ),
                  Expanded(
                    child: GestureDetector(
                      onTap: () => setState(() => _isYearly = true),
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 10),
                        decoration: BoxDecoration(
                          color: _isYearly ? AppColors.surface : Colors.transparent,
                          borderRadius: BorderRadius.circular(10),
                          boxShadow: _isYearly
                              ? [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 4)]
                              : null,
                        ),
                        alignment: Alignment.center,
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              'Yearly',
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: _isYearly ? AppColors.textPrimary : AppColors.textTertiary,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: AppColors.success.withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: const Text(
                                'Save 33%',
                                style: TextStyle(
                                  fontSize: 9,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.success,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 20),

            if (_error != null)
              Container(
                padding: const EdgeInsets.all(12),
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: AppColors.error.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(_error!, style: const TextStyle(color: AppColors.error, fontSize: 13)),
              ),

            // Plan cards
            ...Plans.all.map((plan) => _PlanCard(
                  plan: plan,
                  isYearly: _isYearly,
                  isLoading: _isLoading,
                  onSelect: () => _checkout(plan),
                )),
          ],
        ),
      ),
    );
  }
}

class _PlanCard extends StatelessWidget {
  final PlanInfo plan;
  final bool isYearly;
  final bool isLoading;
  final VoidCallback onSelect;

  const _PlanCard({
    required this.plan,
    required this.isYearly,
    required this.isLoading,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final price = isYearly ? plan.priceYearly : plan.priceMonthly;
    final displayPrice = '₹$price';
    final period = isYearly ? '/year' : '/month';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: plan.isPopular ? AppColors.planPro : AppColors.borderLight,
          width: plan.isPopular ? 2 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(plan.icon, style: const TextStyle(fontSize: 22)),
              const SizedBox(width: 10),
              Text(
                plan.name,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              if (plan.isPopular) ...[
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: AppColors.planPro,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text(
                    'POPULAR',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 9,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                displayPrice,
                style: const TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(bottom: 4, left: 2),
                child: Text(
                  period,
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppColors.textTertiary,
                  ),
                ),
              ),
              if (isYearly) ...[
                const SizedBox(width: 8),
                Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Text(
                    '(${plan.yearlyMonthlyDisplay})',
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.success,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 12),
          ...plan.benefits.map((b) => Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: [
                    const Icon(Icons.check_circle_rounded,
                        size: 16, color: AppColors.success),
                    const SizedBox(width: 8),
                    Text(
                      b,
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              )),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: isLoading ? null : onSelect,
              style: ElevatedButton.styleFrom(
                backgroundColor:
                    plan.isPopular ? AppColors.planPro : AppColors.primary,
              ),
              child: isLoading
                  ? const SizedBox(
                      height: 18, width: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Choose Plan'),
            ),
          ),
        ],
      ),
    );
  }
}
