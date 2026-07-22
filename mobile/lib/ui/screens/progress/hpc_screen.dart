/// Holistic Progress Card (NEP 2020) — WebView wrap of `/hpc`.
///
/// Web reference: `apps/host/src/app/hpc/page.tsx` — a printable,
/// document-style report (Bloom's distribution bar, per-subject competency
/// badges, CBSE board-exam readiness bars, NCF-2023 learning-behaviour
/// ratings, holistic indicators, portfolio highlights) that calls the
/// `nep-compliance` Supabase Edge Function (`generate_hpc` then `get_hpc`).
///
/// WHY WEBVIEW AND NOT NATIVE: this is exactly the read-heavy document surface
/// the WebView pattern exists for (same call as Lab Notebook in sub-phase 1).
/// The page renders ~7 distinct chart/table sections off a deeply nested,
/// loosely-typed `get_hpc` payload (`Record<string, unknown>` all the way
/// down) with no versioned contract; porting it natively would mean pinning a
/// second, silently-drifting copy of that shape. Rendering the real page keeps
/// mobile in lockstep with whatever NEP/CBSE structure the Edge Function
/// returns.
///
/// This mirrors [LabNotebookScreen] (which itself copied [StemLabScreen])
/// EXACTLY: same session-forwarding mechanism, same same-host navigation
/// allowlist, same loading/error chrome. One ADDITIVE difference is described
/// under "Dispose-time cleanup" below.
///
/// Session forwarding strategy (COPIED VERBATIM from [LabNotebookScreen])
/// ---------------------------------------------------------------------
/// On every page load we inject the current Supabase session (access token,
/// refresh token, expiry, user) into the WebView's `localStorage` under the
/// standard `sb-<project-ref>-auth-token` key so the embedded web app boots
/// authenticated.
///
/// SECURITY NOTE (inherited, re-flagged — see [LabNotebookScreen] for the full
/// version): this writes the student's live access + refresh token into
/// origin-scoped WebView localStorage. Any script running in that WebView
/// origin can read a long-lived refresh token. Not introduced here; inherited
/// as-is per the instruction to reuse the proven mechanism rather than invent
/// a divergent one. The durable fix remains a short-lived, single-use signed
/// launch token exchanged server-side — an architect/backend contract change,
/// out of scope for this screen.
///
/// Dispose-time cleanup (NEW here, additive, non-breaking)
/// ------------------------------------------------------
/// [LabNotebookScreen]/[StemLabScreen] never clear the injected token when the
/// screen is torn down, so it can outlive the screen inside the platform
/// WebView's persistent storage. This screen adds a best-effort
/// `localStorage.removeItem(<key>)` in [dispose]. It is safe to add HERE
/// without touching the shared pattern because:
///   * it only runs against THIS screen's own controller;
///   * it is fire-and-forget and fully guarded — if the platform WebView is
///     already detached the `runJavaScript` call throws and is swallowed, and
///     the screen is being destroyed anyway, so nothing user-visible can
///     break;
///   * it cannot affect [StemLabScreen]/[LabNotebookScreen], which keep their
///     current behaviour byte-for-byte.
/// It is a PARTIAL mitigation, not a fix: on Android the WebView storage is
/// shared across all three screens and this only fires on a clean dispose (not
/// on a process kill), so a token can still survive. Flagged for architect —
/// the honest fix is the launch-token exchange, plus applying the same
/// cleanup to the two older screens as a follow-up.
///
/// Owner: mobile
/// Reviewers: quality (UX), architect (auth — see the security notes above),
/// assessment (NEP/CBSE report correctness lives in the web page, not here)
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../core/constants/api_constants.dart';
import '../../../core/constants/app_colors.dart';
import '../../../providers/auth_provider.dart';

class HpcScreen extends ConsumerStatefulWidget {
  const HpcScreen({super.key});

  @override
  ConsumerState<HpcScreen> createState() => _HpcScreenState();
}

class _HpcScreenState extends ConsumerState<HpcScreen> {
  WebViewController? _controller;
  bool _isLoading = true;
  String? _errorMessage;
  String? _builtForStudentId;

  /// Web origin (no trailing slash, no `/api`) — same derivation as
  /// [LabNotebookScreen] / [StemLabScreen].
  static String get _webOrigin {
    const base = ApiConstants.apiBase;
    if (base.endsWith('/api')) {
      return base.substring(0, base.length - 4);
    }
    if (base.endsWith('/api/')) {
      return base.substring(0, base.length - 5);
    }
    return base;
  }

  /// Unlike `/lab-notebook/[studentId]`, the web HPC route takes NO path
  /// parameter — `apps/host/src/app/hpc/page.tsx` reads the student id from
  /// the auth session (`useAuth().student.id`) and passes it to the
  /// `nep-compliance` Edge Function itself. The injected session is therefore
  /// what scopes the report; we must still wait for a resolved student before
  /// loading (see [build]) so the page never boots anonymous and bounces to
  /// `/login`.
  static String get _hpcUrl => '$_webOrigin/hpc';

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
            final uri = Uri.tryParse(req.url);
            if (uri != null && await canLaunchUrl(uri)) {
              await launchUrl(uri, mode: LaunchMode.externalApplication);
            }
            return NavigationDecision.prevent;
          },
        ),
      );

    controller.loadRequest(Uri.parse(_hpcUrl));
    return controller;
  }

  bool _isAllowedHost(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null) return false;
    final origin = Uri.tryParse(_webOrigin);
    if (origin == null) return false;
    return uri.host == origin.host;
  }

  Future<void> _injectSession() async {
    final controller = _controller;
    if (controller == null) return;
    final session = Supabase.instance.client.auth.currentSession;
    if (session == null) return;

    final payload = <String, dynamic>{
      'access_token': session.accessToken,
      'refresh_token': session.refreshToken ?? '',
      'expires_at': session.expiresAt,
      'expires_in': (session.expiresAt ?? 0) -
          (DateTime.now().millisecondsSinceEpoch ~/ 1000),
      'token_type': session.tokenType,
      'user': session.user.toJson(),
    };

    final key = _supabaseStorageKey;
    final value = jsonEncode(payload);
    final keyLiteral = jsonEncode(key);
    final valueLiteral = jsonEncode(value);
    final js =
        'try { window.localStorage.setItem($keyLiteral, $valueLiteral); } catch (e) {}';

    try {
      await controller.runJavaScript(js);
    } catch (_) {
      // Non-fatal — the page may still load anonymously and prompt login on
      // the web side. A retry triggers on next page load.
    }
  }

  /// Best-effort removal of the injected session on teardown. See the
  /// "Dispose-time cleanup" note in this file's header for why this is safe
  /// to add here and why it is only a partial mitigation.
  void _clearInjectedSession() {
    final controller = _controller;
    if (controller == null) return;
    final keyLiteral = jsonEncode(_supabaseStorageKey);
    final js =
        'try { window.localStorage.removeItem($keyLiteral); } catch (e) {}';
    // Deliberately not awaited: dispose() is synchronous, and the platform
    // WebView may already be detaching. Any failure is swallowed.
    controller.runJavaScript(js).catchError((_) {});
  }

  Future<void> _reload() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    await _controller?.reload();
  }

  @override
  void dispose() {
    _clearInjectedSession();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final title = isHi ? '📊 समग्र प्रगति कार्ड' : '📊 Progress Card';
    final loadingText = isHi
        ? 'समग्र प्रगति कार्ड तैयार हो रहा है…'
        : 'Generating Holistic Progress Card…';
    final errorTitle = isHi ? 'लोड नहीं हो सका' : "Couldn't load";
    final retryLabel = isHi ? 'पुनः प्रयास करें' : 'Retry';

    final student = ref.watch(studentProvider).valueOrNull;

    if (student == null) {
      // No student resolved yet (auth still loading, or signed out mid-nav).
      // The web page redirects to /login when it has no session, so never
      // build the controller before a real student exists.
      return Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(title: Text(title)),
        body: const Center(
          child: CircularProgressIndicator(color: AppColors.primary),
        ),
      );
    }

    if (_controller == null || _builtForStudentId != student.id) {
      // Rebuild on a student switch so a cached page from a previous account
      // can never be shown (the URL is identical for every student — the
      // session is what scopes it).
      _builtForStudentId = student.id;
      _controller = _buildController();
    }

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(title),
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        actions: [
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
            Positioned.fill(child: WebViewWidget(controller: _controller!)),
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
                          textAlign: TextAlign.center,
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
                        const Icon(Icons.wifi_off_rounded,
                            size: 48, color: AppColors.textTertiary),
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
                        SizedBox(
                          height: 44,
                          child: ElevatedButton(
                            onPressed: _reload,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.primary,
                              foregroundColor: Colors.white,
                              padding:
                                  const EdgeInsets.symmetric(horizontal: 24),
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
