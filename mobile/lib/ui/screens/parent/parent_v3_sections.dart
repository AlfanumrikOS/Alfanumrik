import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../providers/auth_provider.dart';
import '../../../providers/parent_provider.dart';
import '../../widgets/error_widget.dart';
import '../../widgets/loading_widget.dart';

enum ParentSection { progress, plan, messages, more }

class ParentV3SectionScreen extends ConsumerWidget {
  const ParentV3SectionScreen({super.key, required this.section});

  final ParentSection section;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SafeArea(
      top: false,
      child: switch (section) {
        ParentSection.progress => const _ProgressSection(),
        ParentSection.plan => const _PlanSection(),
        ParentSection.messages => const _MessagesSection(),
        ParentSection.more => const _MoreSection(),
      },
    );
  }
}

String? _activeChildId(WidgetRef ref, List<ParentChild> children) {
  return resolveActiveParentChildId(
    children.map((child) => child.studentId),
    ref.watch(selectedParentChildProvider),
  );
}

class _ProgressSection extends ConsumerWidget {
  const _ProgressSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final childrenAsync = ref.watch(parentChildrenProvider);
    return childrenAsync.when(
      loading: () => const _SectionLoading(),
      error: (_, __) =>
          _SectionError(onRetry: () => ref.invalidate(parentChildrenProvider)),
      data: (response) {
        final children = response.children.toList(growable: false);
        final childId = _activeChildId(ref, children);
        if (childId == null) return const _EmptySection('No linked child yet.');
        return ref.watch(parentGlanceProvider(childId)).when(
              loading: () => const _SectionLoading(),
              error: (_, __) => _SectionError(
                onRetry: () => ref.invalidate(parentGlanceProvider(childId)),
              ),
              data: (glance) => ListView(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
                children: [
                  const _Heading(
                    title: 'Progress',
                    subtitle: 'Mastery, effort and the next useful action.',
                  ),
                  _MetricCard(
                    label: 'Accuracy',
                    value: glance.snapshot.accuracy == null
                        ? '—'
                        : '${glance.snapshot.accuracy!.round()}%',
                  ),
                  _MetricCard(
                    label: 'Learning time this week',
                    value: glance.snapshot.timeMinutes == null
                        ? '—'
                        : '${glance.snapshot.timeMinutes!.round()} min',
                  ),
                  _MetricCard(
                    label: 'Sessions this week',
                    value: '${glance.snapshot.sessionsThisWeek}',
                  ),
                  const SizedBox(height: 20),
                  Text(
                    glance.moments.suggestion?.trim().isNotEmpty == true
                        ? glance.moments.suggestion!
                        : 'No next action is available yet.',
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      height: 1.45,
                    ),
                  ),
                ],
              ),
            );
      },
    );
  }
}

class _PlanSection extends ConsumerWidget {
  const _PlanSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ref.watch(parentChildrenProvider).when(
          loading: () => const _SectionLoading(),
          error: (_, __) => _SectionError(
            onRetry: () => ref.invalidate(parentChildrenProvider),
          ),
          data: (response) {
            final children = response.children.toList(growable: false);
            final childId = _activeChildId(ref, children);
            if (childId == null) {
              return const _EmptySection('No linked child yet.');
            }
            return ref.watch(parentPlanProvider(childId)).when(
                  loading: () => const _SectionLoading(),
                  error: (_, __) => _SectionError(
                    onRetry: () => ref.invalidate(parentPlanProvider(childId)),
                  ),
                  data: (body) {
                    final data = body['data'];
                    final events = data is Map
                        ? (data['events'] as List? ?? const [])
                        : const [];
                    if (events.isEmpty) {
                      return const _EmptySection(
                        'No upcoming assignments or school events.',
                      );
                    }
                    return ListView(
                      padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
                      children: [
                        const _Heading(
                          title: 'Plan',
                          subtitle: 'Upcoming work for the active child.',
                        ),
                        ...events.whereType<Map>().map((event) {
                          final title = event['title']?.toString().trim();
                          final date = event['date']?.toString() ?? '—';
                          final subtitle = event['subtitle']?.toString();
                          return Card(
                            margin: const EdgeInsets.only(bottom: 12),
                            child: ListTile(
                              leading: const Icon(Icons.event_outlined),
                              title: Text(
                                title == null || title.isEmpty ? '—' : title,
                              ),
                              subtitle: Text(
                                [
                                  if (subtitle != null) subtitle,
                                  date,
                                ].join(' · '),
                              ),
                            ),
                          );
                        }),
                      ],
                    );
                  },
                );
          },
        );
  }
}

class _MessagesSection extends ConsumerWidget {
  const _MessagesSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ref.watch(parentThreadsProvider).when(
          loading: () => const _SectionLoading(),
          error: (_, __) => _SectionError(
            onRetry: () {
              ref.invalidate(parentChildrenProvider);
              ref.invalidate(parentThreadsProvider);
            },
          ),
          data: (body) {
            final threads = body['threads'] as List? ?? const [];
            if (threads.isEmpty) {
              return const _EmptySection(
                'No conversations yet. Teacher conversations will appear here.',
              );
            }
            return ListView(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
              children: [
                const _Heading(
                  title: 'Messages',
                  subtitle: "Talk with your child's teachers.",
                ),
                ...threads.whereType<Map>().map((thread) {
                  final id = thread['id']?.toString();
                  final teacher = thread['teacher_name']?.toString().trim();
                  final preview = thread['last_message_preview']?.toString() ??
                      'Open conversation';
                  final unread = thread['unread_count'];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: ListTile(
                      minVerticalPadding: 14,
                      title: Text(
                        teacher == null || teacher.isEmpty ? '—' : teacher,
                      ),
                      subtitle: Text(preview, maxLines: 2),
                      trailing: unread is num && unread > 0
                          ? Badge(label: Text('${unread.toInt()}'))
                          : const Icon(Icons.chevron_right),
                      onTap: id == null
                          ? null
                          : () => context.push('/parent/messages/$id'),
                    ),
                  );
                }),
              ],
            );
          },
        );
  }
}

class ParentConversationScreen extends ConsumerStatefulWidget {
  const ParentConversationScreen({super.key, required this.threadId});

  final String threadId;

  @override
  ConsumerState<ParentConversationScreen> createState() =>
      _ParentConversationScreenState();
}

class _ParentConversationScreenState
    extends ConsumerState<ParentConversationScreen> {
  final _controller = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final body = _controller.text.trim();
    if (body.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await ref
          .read(parentMessageServiceProvider)
          .send(threadId: widget.threadId, body: body);
      _controller.clear();
      ref.invalidate(parentThreadMessagesProvider(widget.threadId));
      ref.invalidate(parentThreadsProvider);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Message could not be sent. Try again.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final messagesAsync = ref.watch(
      parentThreadMessagesProvider(widget.threadId),
    );
    return SafeArea(
      top: false,
      child: Column(
        children: [
          Expanded(
            child: messagesAsync.when(
              loading: () => const _SectionLoading(),
              error: (_, __) => _SectionError(
                onRetry: () => ref.invalidate(
                  parentThreadMessagesProvider(widget.threadId),
                ),
              ),
              data: (body) {
                final messages = body['messages'] as List? ?? const [];
                if (messages.isEmpty) {
                  return const _EmptySection('No messages yet.');
                }
                return ListView(
                  reverse: true,
                  padding: const EdgeInsets.all(16),
                  children: messages.reversed.whereType<Map>().map((message) {
                    final mine = message['sender_role'] == 'guardian';
                    return Align(
                      alignment:
                          mine ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 360),
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: mine
                              ? AppColors.primary
                              : AppColors.surfaceRaised,
                          borderRadius: BorderRadius.circular(16),
                          border:
                              mine ? null : Border.all(color: AppColors.border),
                        ),
                        child: Text(
                          message['body']?.toString() ?? '—',
                          style: TextStyle(
                            color: mine ? Colors.white : AppColors.textPrimary,
                          ),
                        ),
                      ),
                    );
                  }).toList(growable: false),
                );
              },
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      minLines: 1,
                      maxLines: 4,
                      decoration: const InputDecoration(labelText: 'Message'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    tooltip: 'Send message',
                    onPressed: _sending ? null : _send,
                    icon: _sending
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MoreSection extends ConsumerWidget {
  const _MoreSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
      children: [
        const _Heading(
          title: 'More',
          subtitle: 'Account, support and role actions.',
        ),
        Card(
          child: ListTile(
            minVerticalPadding: 14,
            leading: const Icon(Icons.help_outline),
            title: const Text('Help'),
            subtitle: const Text('Contact Alfanumrik support'),
            onTap: () => showDialog<void>(
              context: context,
              builder: (context) => AlertDialog(
                title: const Text('Help'),
                content: const Text('Email support@alfanumrik.com for help.'),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Close'),
                  ),
                ],
              ),
            ),
          ),
        ),
        Card(
          child: ListTile(
            minVerticalPadding: 14,
            leading: const Icon(Icons.logout, color: AppColors.error),
            title: const Text('Log out'),
            onTap: () async {
              await ref.read(studentProvider.notifier).signOut();
              if (context.mounted) context.go('/login');
            },
          ),
        ),
      ],
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: const TextStyle(color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Expanded(child: Text(label)),
            Text(value, style: Theme.of(context).textTheme.titleMedium),
          ],
        ),
      ),
    );
  }
}

class _SectionLoading extends StatelessWidget {
  const _SectionLoading();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: const [ShimmerList(count: 4, itemHeight: 72)],
    );
  }
}

class _SectionError extends StatelessWidget {
  const _SectionError({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: AppErrorWidget(
        message: 'This information is temporarily unavailable.',
        onRetry: onRetry,
      ),
    );
  }
}

class _EmptySection extends StatelessWidget {
  const _EmptySection(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(color: AppColors.textSecondary),
        ),
      ),
    );
  }
}
