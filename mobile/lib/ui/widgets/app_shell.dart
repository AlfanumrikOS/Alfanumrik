import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/constants/api_constants.dart';
import '../../core/constants/app_colors.dart';

/// Bottom navigation shell — wraps all main screens.
/// Uses indexed stack pattern for fast tab switching (no rebuilds).
class AppShell extends StatelessWidget {
  final Widget child;

  const AppShell({super.key, required this.child});

  /// Legacy 5-tab nav (flag OFF). Byte-for-byte the navigation users have
  /// today — Home / Learn / Foxy / Quiz / Settings.
  static const _legacyTabs = [
    _Tab('/', 'Home', Icons.home_rounded, Icons.home_outlined),
    _Tab('/learn', 'Learn', Icons.menu_book_rounded, Icons.menu_book_outlined),
    _Tab('/chat', 'Foxy', Icons.chat_bubble_rounded, Icons.chat_bubble_outline_rounded),
    _Tab('/quiz', 'Quiz', Icons.quiz_rounded, Icons.quiz_outlined),
    _Tab('/settings', 'Settings', Icons.settings_rounded, Icons.settings_outlined),
  ];

  /// `/v2` 4-tab nav (flag ON) — Today / Learn / Foxy / Me. "Me" reuses the
  /// existing Settings/profile screen for now. The adaptive Today home replaces
  /// the legacy Dashboard as the default authed landing.
  static const _v2Tabs = [
    _Tab('/today', 'Today', Icons.wb_sunny_rounded, Icons.wb_sunny_outlined),
    _Tab('/learn', 'Learn', Icons.menu_book_rounded, Icons.menu_book_outlined),
    _Tab('/chat', 'Foxy', Icons.chat_bubble_rounded, Icons.chat_bubble_outline_rounded),
    _Tab('/settings', 'Me', Icons.person_rounded, Icons.person_outline_rounded),
  ];

  static List<_Tab> get _tabs =>
      ApiConstants.useV2 ? _v2Tabs : _legacyTabs;

  int _currentIndex(String location) {
    final tabs = _tabs;
    for (int i = tabs.length - 1; i >= 0; i--) {
      if (location.startsWith(tabs[i].path)) return i;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final tabs = _tabs;
    final location = GoRouterState.of(context).matchedLocation;
    final currentIndex = _currentIndex(location);

    return Scaffold(
      body: child,
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
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
              children: List.generate(tabs.length, (i) {
                final tab = tabs[i];
                final isActive = i == currentIndex;
                return Expanded(
                  child: GestureDetector(
                    onTap: () {
                      if (i != currentIndex) {
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

class _Tab {
  final String path;
  final String label;
  final IconData activeIcon;
  final IconData icon;

  const _Tab(this.path, this.label, this.activeIcon, this.icon);
}
