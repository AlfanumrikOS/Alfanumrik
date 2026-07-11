import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/constants/api_constants.dart';
import '../../core/constants/app_colors.dart';
import '../../providers/experience_provider.dart';

/// Bottom navigation shell — wraps all main screens.
/// Uses indexed stack pattern for fast tab switching (no rebuilds).
class AppShell extends ConsumerWidget {
  final Widget child;

  const AppShell({super.key, required this.child});

  /// Legacy 5-tab nav (flag OFF). Byte-for-byte the navigation users have
  /// today — Home / Learn / Foxy / Quiz / Settings.
  static const _legacyTabs = [
    _Tab('/', 'Home', Icons.home_rounded, Icons.home_outlined),
    _Tab('/learn', 'Learn', Icons.menu_book_rounded, Icons.menu_book_outlined),
    _Tab(
      '/chat',
      'Foxy',
      Icons.chat_bubble_rounded,
      Icons.chat_bubble_outline_rounded,
    ),
    _Tab('/quiz', 'Quiz', Icons.quiz_rounded, Icons.quiz_outlined),
    _Tab(
      '/settings',
      'Settings',
      Icons.settings_rounded,
      Icons.settings_outlined,
    ),
  ];

  /// One Experience student nav (flag ON). This mirrors the governed web V3
  /// manifest and keeps Foxy contextual through its direct route and the More
  /// surface instead of consuming a permanent primary-navigation slot.
  static const _v2Tabs = [
    _Tab('/today', 'Today', Icons.wb_sunny_rounded, Icons.wb_sunny_outlined),
    _Tab('/learn', 'Learn', Icons.menu_book_rounded, Icons.menu_book_outlined),
    _Tab('/quiz', 'Practice', Icons.quiz_rounded, Icons.quiz_outlined),
    _Tab(
      '/progress',
      'Progress',
      Icons.insights_rounded,
      Icons.insights_outlined,
    ),
    _Tab('/settings', 'More', Icons.more_horiz_rounded, Icons.more_horiz),
  ];

  static List<_Tab> _tabs(bool oneExperience) =>
      oneExperience ? _v2Tabs : _legacyTabs;

  int _currentIndex(String location, List<_Tab> tabs) {
    for (int i = tabs.length - 1; i >= 0; i--) {
      if (location.startsWith(tabs[i].path)) return i;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final oneExperience =
        ApiConstants.useV2 &&
        (ref.watch(oneExperienceProvider).valueOrNull ?? false);
    final tabs = _tabs(oneExperience);
    final location = GoRouterState.of(context).matchedLocation;
    final currentIndex = _currentIndex(location, tabs);

    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= 768) {
          return Scaffold(
            body: SafeArea(
              child: Row(
                children: [
                  NavigationRail(
                    selectedIndex: currentIndex,
                    extended: constraints.maxWidth >= 1280,
                    minWidth: 76,
                    minExtendedWidth: 240,
                    groupAlignment: -0.75,
                    labelType: constraints.maxWidth >= 1280
                        ? NavigationRailLabelType.none
                        : NavigationRailLabelType.selected,
                    onDestinationSelected: (index) {
                      if (index != currentIndex) context.go(tabs[index].path);
                    },
                    destinations: tabs
                        .map(
                          (tab) => NavigationRailDestination(
                            icon: Icon(tab.icon),
                            selectedIcon: Icon(tab.activeIcon),
                            label: Text(tab.label),
                          ),
                        )
                        .toList(growable: false),
                  ),
                  const VerticalDivider(width: 1),
                  Expanded(child: child),
                ],
              ),
            ),
          );
        }

        return Scaffold(
          body: child,
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
                  children: List.generate(tabs.length, (i) {
                    final tab = tabs[i];
                    final isActive = i == currentIndex;
                    return Expanded(
                      child: Semantics(
                        button: true,
                        selected: isActive,
                        label: tab.label,
                        child: InkWell(
                          onTap: i == currentIndex
                              ? null
                              : () => context.go(tab.path),
                          child: SizedBox(
                            height: 56,
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
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: isActive
                                        ? FontWeight.w600
                                        : FontWeight.w400,
                                    color: isActive
                                        ? AppColors.primary
                                        : AppColors.textTertiary,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  }),
                ),
              ),
            ),
          ),
        );
      },
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
