import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// School branding loaded from the user's school_id after login.
/// B2C users (no school_id) get default Alfanumrik branding.
class SchoolBranding {
  final String? schoolId;
  final String? schoolName;
  final String? logoUrl;
  final Color primaryColor;
  final Color secondaryColor;
  final String? tagline;
  final bool showPoweredBy;

  const SchoolBranding({
    this.schoolId,
    this.schoolName,
    this.logoUrl,
    this.primaryColor = const Color(0xFF7C3AED),
    this.secondaryColor = const Color(0xFFF97316),
    this.tagline,
    this.showPoweredBy = false,
  });

  bool get isB2B => schoolId != null;
}

final tenantProvider =
    StateNotifierProvider<TenantNotifier, SchoolBranding>((ref) {
  return TenantNotifier();
});

class TenantNotifier extends StateNotifier<SchoolBranding> {
  TenantNotifier() : super(const SchoolBranding());

  /// Called after login — fetches school branding if student has school_id
  Future<void> loadTenant() async {
    try {
      final supabase = Supabase.instance.client;
      final user = supabase.auth.currentUser;
      if (user == null) return;

      final studentRes = await supabase
          .from('students')
          .select('school_id')
          .eq('auth_user_id', user.id)
          .maybeSingle();

      final schoolId = studentRes?['school_id'] as String?;
      if (schoolId == null) {
        state = const SchoolBranding();
        return;
      }

      final schoolRes = await supabase
          .from('schools')
          .select('name, logo_url, primary_color, secondary_color, tagline')
          .eq('id', schoolId)
          .maybeSingle();

      if (schoolRes == null) {
        state = const SchoolBranding();
        return;
      }

      state = SchoolBranding(
        schoolId: schoolId,
        schoolName: schoolRes['name'] as String?,
        logoUrl: schoolRes['logo_url'] as String?,
        primaryColor: _parseColor(schoolRes['primary_color'] as String?) ??
            const Color(0xFF7C3AED),
        secondaryColor:
            _parseColor(schoolRes['secondary_color'] as String?) ??
                const Color(0xFFF97316),
        tagline: schoolRes['tagline'] as String?,
        showPoweredBy: true,
      );
    } catch (_) {
      // Branding fetch failure should never block app startup
      state = const SchoolBranding();
    }
  }

  void clearTenant() {
    state = const SchoolBranding();
  }

  static Color? _parseColor(String? hex) {
    if (hex == null || !hex.startsWith('#')) return null;
    final code = hex.replaceFirst('#', '');
    if (code.length == 6) {
      final val = int.tryParse('FF$code', radix: 16);
      return val != null ? Color(val) : null;
    }
    return null;
  }
}