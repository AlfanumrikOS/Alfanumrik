/// STEM Lab screen — Tier 3 R12 Phase 1 mobile parity.
///
/// Wraps the web `/stem-centre` route in an authenticated WebView so the
/// 119 built-in simulations, lab streak, and coin rewards are reachable
/// from the Flutter app without porting each simulation natively.
///
/// Session forwarding strategy
/// ---------------------------
/// On every page load (NavigationDelegate.onPageStarted) we inject the
/// current Supabase session into `localStorage` under the standard
/// `sb-<project-ref>-auth-token` key. The web Supabase client picks it
/// up on hydration and the page renders as if the user signed in via
/// the web. We re-inject on every page load so a token refresh on the
/// Flutter side propagates without a manual reload.
///
/// Navigation safety
/// -----------------
/// `NavigationDelegate.onNavigationRequest` only allows URLs whose host
/// matches the configured app host (e.g. alfanumrik.com / staging /
/// localhost). Anything else (privacy policy on a third-party domain,
/// payment gateway redirects, etc.) is opened in the system browser via
/// `url_launcher` and the WebView stays put. This prevents the
/// authenticated WebView from drifting off-app.
///
/// Phase 2 (planned, NOT this PR)
/// ------------------------------
/// 1. Native Flutter ports of the top-10 most-used simulations
///    (Ohm's Law, Photosynthesis, Acid-Base titration, etc.) so they
///    work offline and render at native frame-rate.
/// 2. Native lab streak / badges card on the dashboard, reading
///    `student_lab_streaks` and `student_lab_badges` directly via the
///    Supabase Dart SDK (no WebView round-trip).
/// 3. Trigger Phase 2 once WebView usage data justifies the porting
///    cost — Phase 1 ships parity FAST so the Starter+ plan value is
///    consistent across web and mobile from day one.
///
/// Owner: mobile
/// Reviewers: quality (UX), assessment (XP/coin sync), architect (auth)

library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../core/constants/api_constants.dart';
import '../../../core/constants/app_colors.dart';

class StemLabScreen extends ConsumerStatefulWidget {
  const StemLabScreen({super.key});

  @override
  ConsumerState<StemLabScreen> createState() => _StemLabScreenState();
}

class _StemLabScreenState extends ConsumerState<StemLabScreen> {
  late final WebViewController _controller;
  bool _isLoading = true;
  String? _errorMessage;

  /// Web origin (no trailing slash, no `/api`). Derived from
  /// `ApiConstants.apiBase` so prod / staging / localhost all flow
  /// through the same env switch the rest of the app already uses.
  static String get _webOrigin {
    const base = ApiConstants.apiBase;
    // apiBase is `https://alfanumrik.com/api` — strip the `/api` suffix
    // to get the page origin.
    if (base.endsWith('/api')) {
      return base.substring(0, base.length - 4);
    }
    if (base.endsWith('/api/')) {
      return base.substring(0, base.length - 5);
    }
    return base;
  }

  static String get _stemUrl => '$_webOrigin/stem-centre';

  /// Supabase localStorage key. Project ref is the first segment of the
  /// Supabase URL host (e.g. `abcd1234.supabase.co` → `abcd1234`).
  static String get _supabaseStorageKey {
    const url = ApiConstants.supabaseUrl;
    try {
      final host = Uri.parse(url).host;
      final ref = host.split('.').first;
      return 'sb-$ref-auth-token';
    } catch (_) {
      return 'sb-auth-token';
    }
  }

  @override
  void initState() {
    super.initState();
    _controller = _buildController();
  }

  WebViewController _buildController() {
    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(AppColors.background)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (_) async {
            if (mounted) {
              setState(() {
                _isLoading = true;
                _errorMessage = null;
              });
            }
            await _injectSession();
          },
          onPageFinished: (_) {
            if (mounted) setState(() => _isLoading = false);
          },
          onWebResourceError: (err) {
            // Only surface main-frame errors; subresource failures are
            // common (analytics blockers etc.) and should not break UX.
            if (err.isForMainFrame == true && mounted) {
              setState(() {
                _isLoading = false;
                _errorMessage = err.description;
              });
            }
          },
          onNavigationRequest: (req) async {
            final allowed = _isAllowedHost(req.url);
            if (allowed) return NavigationDecision.navigate;
            // External link → open in system browser, keep WebView put.
            final uri = Uri.tryParse(req.url);
            if (uri != null && await canLaunchUrl(uri)) {
              await launchUrl(uri, mode: LaunchMode.externalApplication);
            }
            return NavigationDecision.prevent;
          },
        ),
      );

    controller.loadRequest(Uri.parse(_stemUrl));
    return controller;
  }

  /// Allow same-origin navigation only. Everything else opens externally.
  bool _isAllowedHost(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null) return false;
    final origin = Uri.tryParse(_webOrigin);
    if (origin == null) return false;
    return uri.host == origin.host;
  }

  /// Inject the current Supabase session into the WebView's localStorage
  /// so the embedded web app boots authenticated. Safe to call multiple
  /// times — the same key is overwritten with a fresh access token.
  Future<void> _injectSession() async {
    final session = Supabase.instance.client.auth.currentSession;
    if (session == null) return;

    // Shape mirrors the supabase-js storage payload. Extra fields the
    // web client may add are tolerated; missing-but-not-required fields
    // are not set here (provider_token, provider_refresh_token).
    final payload = <String, dynamic>{
      'access_token': session.accessToken,
      'refresh_token': session.refreshToken ?? '',
      'expires_at': session.expiresAt,
      'expires_in':
          (session.expiresAt ?? 0) - (DateTime.now().millisecondsSinceEpoch ~/ 1000),
      'token_type': session.tokenType,
      'user': session.user.toJson(),
    };

    final key = _supabaseStorageKey;
    final value = jsonEncode(payload);
    // jsonEncode on a string handles all escaping for safe JS embedding.
    final keyLiteral = jsonEncode(key);
    final valueLiteral = jsonEncode(value);
    final js = 'try { window.localStorage.setItem($keyLiteral, $valueLiteral); } catch (e) {}';

    try {
      await _controller.runJavaScript(js);
    } catch (_) {
      // Non-fatal — the page may still load anonymously and prompt
      // login on the web side. A retry triggers on next page load.
    }
  }

  Future<void> _reload() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    await _controller.reload();
  }

  @override
  Widget build(BuildContext context) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final title = isHi ? '🔬 STEM लैब' : '🔬 STEM Lab';
    final loadingText = isHi
        ? 'STEM लैब लोड हो रही है…'
        : 'Loading STEM Lab…';
    final errorTitle = isHi ? 'लोड नहीं हो सका' : "Couldn't load";
    final retryLabel = isHi ? 'पुनः प्रयास करें' : 'Retry';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(title),
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        actions: [
          // Touch target ≥48px (IconButton default).
          // Pull-to-refresh is intentionally NOT used — it competes
          // with the WebView's own vertical scroll gesture and
          // confuses users mid-simulation.
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: isHi ? 'पुनः लोड करें' : 'Reload',
            onPressed: _reload,
          ),
        ],
      ),
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: WebViewWidget(controller: _controller),
            ),
            if (_isLoading && _errorMessage == null)
              Positioned.fill(
                child: Container(
                  color: AppColors.background,
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const CircularProgressIndicator(
                          color: AppColors.primary,
                        ),
                        const SizedBox(height: 16),
                        Text(
                          loadingText,
                          style: const TextStyle(
                            fontSize: 14,
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            if (_errorMessage != null)
              Positioned.fill(
                child: Container(
                  color: AppColors.background,
                  padding: const EdgeInsets.all(24),
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.wifi_off_rounded,
                          size: 48,
                          color: AppColors.textTertiary,
                        ),
                        const SizedBox(height: 12),
                        Text(
                          errorTitle,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          _errorMessage ?? '',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.textTertiary,
                          ),
                        ),
                        const SizedBox(height: 16),
                        // Touch target ≥44px (height: 44, horiz pad: 24).
                        SizedBox(
                          height: 44,
                          child: ElevatedButton(
                            onPressed: _reload,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.primary,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 24,
                              ),
                            ),
                            child: Text(retryLabel),
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
    );
  }
}
