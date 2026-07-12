import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/constants/api_constants.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'providers/offline_quiz_provider.dart';

class AlfanumrikApp extends ConsumerStatefulWidget {
  const AlfanumrikApp({super.key});

  @override
  ConsumerState<AlfanumrikApp> createState() => _AlfanumrikAppState();
}

class _AlfanumrikAppState extends ConsumerState<AlfanumrikApp>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    if (ApiConstants.useV2) {
      WidgetsBinding.instance.addObserver(this);
      // Instantiate the coordinator once at startup so its connectivity
      // listener (drain-on-reconnect) is installed. Deferred to the first
      // frame so the Hive store provider has resolved. No-op when useV2 is OFF.
      WidgetsBinding.instance.addPostFrameCallback((_) => _kickOffline());
    }
  }

  @override
  void dispose() {
    if (ApiConstants.useV2) {
      WidgetsBinding.instance.removeObserver(this);
    }
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // On app FOREGROUND, drain any queued offline attempts. The drain
    // serializes internally, so this never races the connectivity listener.
    if (state == AppLifecycleState.resumed && ApiConstants.useV2) {
      _kickOffline();
    }
  }

  void _kickOffline() {
    final coordinator = ref.read(offlineQuizCoordinatorProvider);
    if (coordinator != null) {
      unawaited(coordinator.drain());
    }
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);

    return MaterialApp.router(
      title: 'Alfanumrik',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: ThemeMode.light,
      routerConfig: router,
    );
  }
}
