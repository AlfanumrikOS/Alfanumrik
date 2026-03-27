import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/network/api_client.dart';
import '../../core/network/api_result.dart';
import '../models/subscription.dart';

class SubscriptionRepository {
  final SupabaseClient _client;
  final ApiClient _api;

  SubscriptionRepository({
    SupabaseClient? client,
    ApiClient? api,
  })  : _client = client ?? Supabase.instance.client,
        _api = api ?? ApiClient();

  /// Get current subscription state
  Future<ApiResult<SubscriptionState>> getSubscription(String studentId) async {
    try {
      final res = await _client
          .from('student_subscriptions')
          .select()
          .eq('student_id', studentId)
          .eq('is_active', true)
          .order('created_at', ascending: false)
          .maybeSingle();

      if (res == null) {
        return const ApiSuccess(SubscriptionState(planCode: 'free'));
      }

      return ApiSuccess(SubscriptionState.fromJson(res));
    } catch (e) {
      return const ApiSuccess(SubscriptionState(planCode: 'free'));
    }
  }

  /// Create a Razorpay order via backend
  Future<ApiResult<Map<String, dynamic>>> createOrder({
    required String planCode,
    required String billingCycle,
  }) async {
    try {
      final response = await _api.post(
        '/payments/create-order',
        data: {
          'plan_code': planCode,
          'billing_cycle': billingCycle,
        },
      );

      final data = response.data as Map<String, dynamic>;
      return ApiSuccess(data);
    } catch (e) {
      return ApiFailure('Failed to create order: ${e.toString()}');
    }
  }

  /// Verify payment after Razorpay success
  Future<ApiResult<bool>> verifyPayment({
    required String orderId,
    required String paymentId,
    required String signature,
    required String planCode,
    required String billingCycle,
  }) async {
    try {
      final response = await _api.post(
        '/payments/verify',
        data: {
          'razorpay_order_id': orderId,
          'razorpay_payment_id': paymentId,
          'razorpay_signature': signature,
          'plan_code': planCode,
          'billing_cycle': billingCycle,
        },
      );

      final data = response.data as Map<String, dynamic>;
      final success = data['success'] as bool? ?? false;

      return ApiSuccess(success);
    } catch (e) {
      return ApiFailure('Payment verification failed: ${e.toString()}');
    }
  }
}
