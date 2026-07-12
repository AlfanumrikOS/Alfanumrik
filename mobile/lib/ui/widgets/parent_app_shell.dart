import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/experience_provider.dart';
import '../../providers/parent_provider.dart';

class ParentAppShell extends ConsumerWidget {
  const ParentAppShell({super.key, required this.child});

  final Widget child;

  static const _destinations = [
    _ParentDestination('/parent', 'Home', Icons.home_outlined, Icons.home),
    _ParentDestination(
      '/parent/progress',
      'Progress',
      Icons.insights_outlined,
      Icons.insights,
    ),
    _ParentDestination(
      '/parent/plan',
      'Plan',
      Icons.event_note_outlined,
      Icons.event_note,
    ),
    _ParentDestination(
      '/parent/messages',
      'Messages',
      Icons.chat_bubble_outline,
      Icons.chat_bubble,
    ),
    _ParentDestination(
      '/parent/more',
      'More',
      Icons.more_horiz,
      Icons.more_horiz,
    ),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final enabled = ref.watch(oneExperienceProvider).valueOrNull ?? false;
    if (!enabled) return child;

    final location = GoRouterState.of(context).matchedLocation;
    final selectedIndex = parentDestinationIndexForLocation(location);

    return LayoutBuilder(
      builder: (context, constraints) {
        final content = Scaffold(
          appBar: AppBar(
            automaticallyImplyLeading: false,
            titleSpacing: 16,
            title: const _ActiveChildSelector(),
          ),
          body: child,
          bottomNavigationBar: constraints.maxWidth < 768
              ? NavigationBar(
                  selectedIndex: selectedIndex,
                  onDestinationSelected: (index) {
                    if (index != selectedIndex) {
                      context.go(_destinations[index].path);
                    }
                  },
                  destinations: _destinations
                      .map(
                        (destination) => NavigationDestination(
                          icon: Icon(destination.icon),
                          selectedIcon: Icon(destination.selectedIcon),
                          label: destination.label,
                        ),
                      )
                      .toList(growable: false),
                )
              : null,
        );

        if (constraints.maxWidth < 768) return content;
        return Scaffold(
          body: SafeArea(
            child: Row(
              children: [
                NavigationRail(
                  selectedIndex: selectedIndex,
                  extended: constraints.maxWidth >= 1280,
                  minWidth: 76,
                  minExtendedWidth: 240,
                  labelType: constraints.maxWidth >= 1280
                      ? NavigationRailLabelType.none
                      : NavigationRailLabelType.selected,
                  onDestinationSelected: (index) {
                    if (index != selectedIndex) {
                      context.go(_destinations[index].path);
                    }
                  },
                  destinations: _destinations
                      .map(
                        (destination) => NavigationRailDestination(
                          icon: Icon(destination.icon),
                          selectedIcon: Icon(destination.selectedIcon),
                          label: Text(destination.label),
                        ),
                      )
                      .toList(growable: false),
                ),
                const VerticalDivider(width: 1),
                Expanded(child: content),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Keeps the Home prefix from swallowing every `/parent/*` destination and
/// preserves the Messages selection for a deep-linked conversation.
int parentDestinationIndexForLocation(String location) {
  if (location == '/parent') return 0;
  const paths = [
    '/parent',
    '/parent/progress',
    '/parent/plan',
    '/parent/messages',
    '/parent/more',
  ];
  final index = paths.indexWhere(
    (path) => path != '/parent' && location.startsWith(path),
  );
  return index < 0 ? 0 : index;
}

class _ActiveChildSelector extends ConsumerWidget {
  const _ActiveChildSelector();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final children = ref.watch(parentChildrenProvider).valueOrNull?.children;
    if (children == null || children.isEmpty) {
      return const Text('Parent');
    }

    final selected = resolveActiveParentChildId(
      children.map((child) => child.studentId),
      ref.watch(selectedParentChildProvider),
    )!;

    return DropdownButtonHideUnderline(
      child: DropdownButton<String>(
        value: selected,
        isExpanded: true,
        icon: const Icon(Icons.expand_more),
        onChanged: (value) {
          if (value != null) {
            ref.read(selectedParentChildProvider.notifier).state = value;
          }
        },
        items: children
            .map(
              (ParentChild child) => DropdownMenuItem<String>(
                value: child.studentId,
                child: Text(
                  (child.name ?? '').trim().isEmpty
                      ? 'Your child'
                      : child.name!.trim(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            )
            .toList(growable: false),
      ),
    );
  }
}

class _ParentDestination {
  const _ParentDestination(this.path, this.label, this.icon, this.selectedIcon);

  final String path;
  final String label;
  final IconData icon;
  final IconData selectedIcon;
}
