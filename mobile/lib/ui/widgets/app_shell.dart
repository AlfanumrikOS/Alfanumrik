import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/constants/app_colors.dart';
import '../../core/network/network_info.dart';

/// Bottom navigation shell — wraps all main screens.
class AppShell extends ConsumerWidget {
  final Widget child;

  const AppShell({super.key, required this.child});

  static const _tabs = [
    _Tab('/home', 'Home', Icons.home_rounded, Icons.home_outlined),
    _Tab('/learn', 'Learn', Icons.menu_book_rounded, Icons.menu_book_outlined),
    _Tab('/chat', 'Foxy', Icons.chat_bubble_rounded, Icons.chat_bubble_outline_rounded),
    _Tab('/quiz', 'Quiz', Icons.quiz_rounded, Icons.quiz_outlined),
    _Tab('/settings', 'Settings', Icons.settings_rounded, Icons.settings_outlined),
  ];

  int _currentIndex(String location) {
    for (int i = _tabs.length - 1; i >= 0; i--) {
      if (location.startsWith(_tabs[i].path)) return i;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final location = GoRouterState.of(context).matchedLocation;
    final currentIndex = _currentIndex(location);
    final connectivity = ref.watch(connectivityProvider);

    return Scaffold(
      body: Column(
        children: [
          // Offline banner
          connectivity.when(
            data: (isOnline) => isOnline
                ? const SizedBox.shrink()
                : const _OfflineBanner(),
            loading: () => const SizedBox.shrink(),
            error: (_, __) => const SizedBox.shrink(),
          ),
          // Main content
          Expanded(child: child),
        ],
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: AppColors.surface,
          border: Border(
            top: BorderSide(color: AppColors.borderLight, width: 0.5),
          ),
        ),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 56,
            child: Row(
              children: List.generate(_tabs.length, (i) {
                final tab = _tabs[i];
                final isActive = i == currentIndex;
                return Expanded(
                  child: GestureDetector(
                    onTap: () {
                      if (i != currentIndex) {
                        HapticFeedback.lightImpact();
                        context.go(tab.path);
                      }
                    },
                    behavior: HitTestBehavior.opaque,
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          isActive ? tab.activeIcon : tab.icon,
                          size: 22,
                          color: isActive
                              ? AppColors.primary
                              : AppColors.textTertiary,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          tab.label,
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight:
                                isActive ? FontWeight.w600 : FontWeight.w400,
                            color: isActive
                                ? AppColors.primary
                                : AppColors.textTertiary,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              }),
            ),
          ),
        ),
      ),
    );
  }
}

class _OfflineBanner extends StatelessWidget {
  const _OfflineBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.only(
        top: MediaQuery.of(context).padding.top + 4,
        bottom: 6,
        left: 16,
        right: 16,
      ),
      color: AppColors.warning,
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.wifi_off_rounded, size: 14, color: Colors.white),
          SizedBox(width: 6),
          Text(
            'No internet connection',
            style: TextStyle(
              color: Colors.white,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _Tab {
  final String path;
  final String label;
  final IconData activeIcon;
  final IconData icon;

  const _Tab(this.path, this.label, this.activeIcon, this.icon);
}
