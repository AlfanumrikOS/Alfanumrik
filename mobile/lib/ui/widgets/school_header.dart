import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/tenant_provider.dart';

/// Branded header widget for app bar.
/// Shows school logo + name for B2B students, "Alfanumrik" for B2C.
class SchoolHeader extends ConsumerWidget {
  const SchoolHeader({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tenant = ref.watch(tenantProvider);

    if (!tenant.isB2B) {
      return const Text(
        'Alfanumrik',
        style: TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
      );
    }

    return Flexible(
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (tenant.logoUrl != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: Image.network(
                tenant.logoUrl!,
                height: 28,
                width: 28,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => _schoolInitial(tenant),
              ),
            )
          else
            _schoolInitial(tenant),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              tenant.schoolName ?? 'School',
              style:
                  const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
              overflow: TextOverflow.ellipsis,
              maxLines: 1,
            ),
          ),
        ],
      ),
    );
  }

  Widget _schoolInitial(SchoolBranding tenant) {
    return Container(
      height: 28,
      width: 28,
      decoration: BoxDecoration(
        color: tenant.primaryColor,
        borderRadius: BorderRadius.circular(6),
      ),
      alignment: Alignment.center,
      child: Text(
        (tenant.schoolName ?? 'S')[0].toUpperCase(),
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w700,
          fontSize: 14,
        ),
      ),
    );
  }
}