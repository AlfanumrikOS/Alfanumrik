import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app.dart';
import 'core/constants/api_constants.dart';

Future<void> main() async {
  // Catch sync + async errors that escape the framework's own zone. We pass
  // through everything Flutter normally hands to FlutterError.onError, then
  // forward to Sentry. SentryFlutter.init wires `runZonedGuarded` for us
  // when we use its `appRunner` parameter, so this is the canonical entry.
  await SentryFlutter.init(
    (options) {
      // Disable the SDK entirely when DSN is missing (local/dev/test builds).
      // sentry_flutter 8.x removed the explicit `options.enabled` setter, but
      // an EMPTY-string DSN now self-disables the SDK: Sentry's
      // `_setDefaultConfiguration` closes the hub when `dsn.isEmpty`, so no
      // envelopes are shipped and logcat stays clean. (A NULL dsn would throw
      // 'DSN is required.', so we keep the empty string from ApiConstants.)
      options.dsn = ApiConstants.sentryDsn;
      options.environment = ApiConstants.sentryEnvironment;
      options.tracesSampleRate = ApiConstants.sentryTracesSampleRate;
      options.attachScreenshot = false; // P13 — student PII may be on screen
      // `attachViewHierarchy` is marked experimental in sentry_flutter 8.x but
      // is the documented privacy control; we MUST keep it false (P13 — the
      // view hierarchy can leak on-screen student data). Suppress only the
      // stability lint, not the setting.
      // ignore: experimental_member_use
      options.attachViewHierarchy = false; // same reason as screenshots
      options.sendDefaultPii = false; // never auto-send IP / username

      // Only capture Flutter errors in release builds. Debug builds
      // already surface them in the IDE and cluttering Sentry with
      // dev-loop stack traces wastes the project quota.
      options.debug = false;
      options.diagnosticLevel = SentryLevel.warning;
    },
    appRunner: () async {
      WidgetsFlutterBinding.ensureInitialized();

      // Lock portrait orientation for consistent UX
      await SystemChrome.setPreferredOrientations([
        DeviceOrientation.portraitUp,
      ]);

      // Optimize status bar
      SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        systemNavigationBarColor: Colors.white,
      ));

      // Initialize Hive for local caching
      await Hive.initFlutter();

      // Initialize Supabase
      await Supabase.initialize(
        url: ApiConstants.supabaseUrl,
        anonKey: ApiConstants.supabaseAnonKey,
        authOptions: const FlutterAuthClientOptions(
          authFlowType: AuthFlowType.pkce,
        ),
      );

      // Forward platform errors (e.g. native channel exceptions). The
      // framework error handler is wired by SentryFlutter via the zone,
      // but PlatformDispatcher.onError is our last line of defence for
      // anything that escapes both.
      PlatformDispatcher.instance.onError = (error, stack) {
        Sentry.captureException(error, stackTrace: stack);
        return true;
      };

      // Suppress release-mode framework error red-screens — Sentry has
      // them. Debug-mode behaviour is unchanged.
      if (kReleaseMode) {
        FlutterError.onError = (FlutterErrorDetails details) {
          Sentry.captureException(details.exception, stackTrace: details.stack);
        };
      }

      runApp(
        const ProviderScope(
          child: AlfanumrikApp(),
        ),
      );
    },
  );
}
