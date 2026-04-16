import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/tenant_provider.dart';

/// "Powered by Alfanumrik" footer for B2B white-label schools.
/// Hidden for B2C users (showPoweredBy = false).
class PoweredByFooter extends ConsumerWidget {
  const PoweredByFooter({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tenant = ref.watch(tenantProvider);
    if (!tenant.showPoweredBy) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.all(12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            'Powered by ',
            style: TextStyle(fontSize: 10, color: Colors.grey[500]),
          ),
          const Text(
            'Alfanumrik',
            style: TextStyle(
              fontSize: 10,
              color: Color(0xFF7C3AED),
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}