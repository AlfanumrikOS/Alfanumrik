/// Lab Notebook screen — WebView wrap of `/lab-notebook/[studentId]`.
///
/// Web reference: `apps/host/src/app/lab-notebook/[studentId]/page.tsx` +
/// `GET /api/lab-notebook/list`. This mirrors [StemLabScreen]'s pattern
/// EXACTLY (same session-forwarding mechanism, same navigation-safety
/// allowlist, same loading/error chrome) rather than inventing a second
/// mechanism — see the security note below before reusing this pattern for a
/// third screen.
///
/// Session forwarding strategy (COPIED VERBATIM from [StemLabScreen])
/// ---------------------------------------------------------------------
/// On every page load we inject the current Supabase session (access token,
/// refresh token, expiry, user) into the WebView's `localStorage` under the
/// standard `sb-<project-ref>-auth-token` key so the embedded web app boots
/// authenticated, exactly like a normal web sign-in would leave it.
///
/// SECURITY NOTE (flagged, not silently copied) — this mechanism writes the
/// student's live access + refresh token into the WebView's origin-scoped
/// localStorage via `runJavaScript`. That is standard for this app's existing
/// STEM Lab screen and is same-origin (only reachable by scripts on the
/// configured app host), but it does mean:
///   1. A refresh token becomes readable by ANY script that runs in that
///      WebView origin (e.g. a compromised/malicious third-party script that
///      got past the same-origin navigation allowlist, or a XSS bug in the
///      web app itself) — worse than a normal web session because a stolen
///      refresh token here is long-lived.
///   2. Nothing here explicitly clears that localStorage entry when the
///      WebView is disposed, so the token can outlive this screen's lifetime
///      within the platform WebView's persistent storage.
/// Neither of these is introduced by this file — they are inherited AS-IS
/// from [StemLabScreen] per this task's instruction to reuse the proven
/// mechanism identically rather than invent a second one. If/when this is
/// revisited, a shorter-lived signed launch token (single-use, minutes-scale
/// TTL, verified server-side) passed via URL and exchanged for a session
/// server-side would be a materially safer alternative to injecting the full
/// refresh token. Flagging for architect/backend review rather than changing
/// silently, since that is a bigger contract change than this screen's scope.
///
/// Navigation safety
/// -----------------
/// Same allowlist as [StemLabScreen]: only same-host navigation stays in the
/// WebView; everything else opens in the system browser.
///
/// Owner: mobile
/// Reviewers: quality (UX), assessment (if lab XP/coins surface here),
/// architect (auth — see the security note above)
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

class LabNotebookScreen extends ConsumerStatefulWidget {
  const LabNotebookScreen({super.key});

  @override
  ConsumerState<LabNotebookScreen> createState() => _LabNotebookScreenState();
}

class _LabNotebookScreenState extends ConsumerState<LabNotebookScreen> {
  WebViewController? _controller;
  bool _isLoading = true;
  String? _errorMessage;
  String? _builtForStudentId;

  /// Web origin (no trailing slash, no `/api`) — same derivation as
  /// [StemLabScreen].
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

  static String _labNotebookUrl(String studentId) =>
      '$_webOrigin/lab-notebook/$studentId';

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

  WebViewController _buildController(String studentId) {
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

    controller.loadRequest(Uri.parse(_labNotebookUrl(studentId)));
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

  Future<void> _reload() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    await _controller?.reload();
  }

  @override
  Widget build(BuildContext context) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final title = isHi ? '📓 लैब नोटबुक' : '📓 Lab Notebook';
    final loadingText = isHi ? 'लैब नोटबुक लोड हो रही है…' : 'Loading Lab Notebook…';
    final errorTitle = isHi ? 'लोड नहीं हो सका' : "Couldn't load";
    final retryLabel = isHi ? 'पुनः प्रयास करें' : 'Retry';

    final student = ref.watch(studentProvider).valueOrNull;

    if (student == null) {
      // No student resolved yet (auth still loading, or signed out mid-nav).
      // Never construct the controller without a real studentId.
      return Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(title: Text(title)),
        body: const Center(child: CircularProgressIndicator(color: AppColors.primary)),
      );
    }

    if (_controller == null || _builtForStudentId != student.id) {
      _builtForStudentId = student.id;
      _controller = _buildController(student.id);
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
                        const CircularProgressIndicator(color: AppColors.primary),
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
                              padding: const EdgeInsets.symmetric(horizontal: 24),
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
