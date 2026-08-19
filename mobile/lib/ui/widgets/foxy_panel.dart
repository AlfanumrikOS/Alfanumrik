import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_colors.dart';
import '../../../providers/chat_provider.dart';
import '../../../providers/auth_provider.dart';
import '../../../data/models/chat_message.dart';
import '../../../core/services/subjects_provider.dart';
import '../../widgets/error_widget.dart';

/// Embedded Foxy panel for the student dashboard.
///
/// Mobile-first: Foxy is the main action on the dashboard.
///
/// Two states:
/// - **Collapsed**: A prominent CTA card (min ~120px) with a large fox icon,
///   the Foxy name in primary-brand color, an active-subject badge, quick-prompt
///   chips (tappable — they send a pre-filled message AND auto-expand so the user
///   immediately sees the reply), and a clear expand affordance. The ENTIRE card
///   background is tappable to expand/collapse. Subject-picker chips are shown
///   inline when no session exists yet.
/// - **Expanded**: Full chat messenger shared with `/chat` via [chatProvider].
///
/// Bilingual via device locale (hi/en).
class FoxyPanel extends ConsumerStatefulWidget {
  const FoxyPanel({super.key});

  @override
  ConsumerState<FoxyPanel> createState() => _FoxyPanelState();
}

class _FoxyPanelState extends ConsumerState<FoxyPanel> {
  bool get expanded => _expandedV;
  bool _expandedV = false;
  final _scrollController = ScrollController();
  final _focusNode = FocusNode();
  final _controller = TextEditingController();

  @override
  void dispose() {
    _scrollController.dispose();
    _focusNode.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _toggle() {
    setState(() => _expandedV = !_expandedV);
    if (_expandedV && mounted) {
      Future.delayed(const Duration(milliseconds: 90), () {
        if (mounted) _focusNode.requestFocus();
      });
    }
  }

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    _controller.clear();
    ref.read(chatProvider.notifier).sendMessage(text);
    Future.delayed(const Duration(milliseconds: 120), () {
      if (_scrollController.hasClients && mounted) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 280),
          curve: Curves.easeOut,
        );
      }
    });
  }

  /// Set a pre-filled prompt, send it, and expand if currently collapsed.
  void _sendPrompt(String text) {
    _controller.text = text;
    _send();
    if (!_expandedV) _toggle();
  }

  /// Launch the subject picker bottom sheet when no session/subject is active.
  Future<void> _pickSubject() async {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';

    final selected = await showModalBottomSheet<String>(
      context: context,
      isDismissible: false,
      enableDrag: false,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                isHi ? 'पहले एक विषय चुनें' : 'Pick a subject to start',
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                isHi
                    ? 'फॉक्सी को यह जानना ज़रूरी है कि आप किस विषय पर बात करना चाहते हैं।'
                    : 'Foxy needs to know which subject you want to talk about.',
                style: const TextStyle(
                    fontSize: 13, color: AppColors.textTertiary),
              ),
              const SizedBox(height: 16),
              Consumer(builder: (context, ref, _) {
                final subjectsAsync = ref.watch(subjectsProvider);
                return subjectsAsync.when(
                  loading: () => const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                  error: (e, _) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      isHi ? 'विषय लोड नहीं हो सके।' : 'Could not load subjects.',
                      style: const TextStyle(
                          color: AppColors.error, fontSize: 13),
                    ),
                  ),
                  data: (subjects) {
                    final available = subjects.where((s) => !s.isLocked).toList();
                    if (available.isEmpty) {
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        child: Text(
                          isHi ? 'कोई विषय उपलब्ध नहीं है।' : 'No subjects available.',
                          style: const TextStyle(
                            color: AppColors.textTertiary, fontSize: 13),
                        ),
                      );
                    }
                    return Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: available
                          .map((s) => GestureDetector(
                                onTap: () => Navigator.of(ctx).pop(s.code),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 14, vertical: 10),
                                  decoration: BoxDecoration(
                                    color: AppColors.subjectColor(s.code)
                                        .withValues(alpha: 0.08),
                                    borderRadius:
                                        BorderRadius.circular(20),
                                    border: Border.all(
                                      color: AppColors.subjectColor(s.code)
                                          .withValues(alpha: 0.25),
                                    ),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Text(s.icon, style: const TextStyle(fontSize: 16)),
                                      const SizedBox(width: 6),
                                      Text(
                                        isHi ? s.nameHi : s.name,
                                        style: TextStyle(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w600,
                                          color: AppColors.subjectColor(s.code),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ))
                          .toList(growable: false),
                    );
                  },
                );
              }),
            ],
          ),
        ),
      ),
    );

    if (!mounted) return;
    if (selected == null || selected.isEmpty) {
      Navigator.of(context).pop();
      return;
    }
    ref.read(chatProvider.notifier).startSession(subject: selected);
  }

  /// Quick-prompt chip data for the collapsed state.
  /// Tapping sends a pre-filled message AND auto-expands the panel.
  List<_PromptChipData> _promptChipData(bool isHi, String? subject) {
    final label = (subject ?? '').trim();
    final topic = label.isEmpty
        ? (isHi ? 'इस विषय' : 'this topic')
        : label;
    return [
      _PromptChipData(
        icon: '📖',
        label: isHi ? 'अवधारणा समझाओ' : 'Explain a concept',
        action: isHi ? '$topic को सरल भाषा में समझाओ' : 'Explain $topic simply',
      ),
      _PromptChipData(
        icon: '🧮',
        label: isHi ? 'समस्या हल करो' : 'Solve a problem',
        action: isHi ? '$topic की एक समस्या हल करो' : 'Solve a problem on $topic',
      ),
      _PromptChipData(
        icon: '📝',
        label: isHi ? 'मुझे क्विज़ दो' : 'Quiz me',
        action: isHi ? '$topic पर मुझे क्विज़ दो' : 'Quiz me on $topic',
      ),
      _PromptChipData(
        icon: '🌍',
        label: isHi ? 'असल ज़िंदगी उदाहरण' : 'Real-world examples',
        action: isHi ? '$topic के असल ज़िंदगी उदाहरण दो' : 'Give real-world examples of $topic',
      ),
    ];
  }

  /// Input bar shown in expanded state.
  Widget _inputBar(bool isHi, bool isSending) {
    return Container(
      padding: EdgeInsets.fromLTRB(
        12,
        8,
        12,
        MediaQuery.of(context).padding.bottom + 8,
      ),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.borderLight)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: AppColors.background,
                borderRadius: BorderRadius.circular(24),
                border: Border.all(color: AppColors.border),
              ),
              child: TextField(
                controller: _controller,
                focusNode: _focusNode,
                maxLines: 3,
                minLines: 1,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _send(),
                style: const TextStyle(fontSize: 14),
                decoration: InputDecoration(
                  hintText: isHi ? 'फॉक्सी को कुछ पूछो...' : 'Ask Foxy anything...',
                  border: InputBorder.none,
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            onTap: isSending ? null : _send,
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: isSending ? AppColors.textTertiary : AppColors.primary,
                shape: BoxShape.circle,
              ),
              child: Icon(
                isSending ? Icons.hourglass_top_rounded : Icons.send_rounded,
                color: Colors.white,
                size: 18,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Welcome state shown when there are no messages yet (expanded panel).
  Widget _welcomeState(ChatState chat, Student? student, bool isHi) {
    final topic = chat.topic?.isNotEmpty == true ? chat.topic : null;
    return Expanded(
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('🦊', style: const TextStyle(fontSize: 40)),
              const SizedBox(height: 12),
              Text(
                topic ?? (isHi ? 'नमस्ते!' : 'Hi there!'),
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                student != null
                    ? (isHi
                        ? 'मैं फॉक्सी, ${student.name.split(' ').first} का पढ़ाई का साथी।'
                        : "I'm Foxy, ${student.name.split(' ').first}'s study buddy.")
                    : (isHi
                        ? 'मैं फॉक्सी, तुम्हारा पढ़ाई का साथी।'
                        : "I'm Foxy, your study buddy."),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 14,
                  color: AppColors.textSecondary,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                isHi ? 'विषय चुनो और कुछ भी पूछो!' : 'Pick a subject and ask me anything!',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 13,
                  color: AppColors.textTertiary,
                ),
              ),
              const SizedBox(height: 20),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                alignment: WrapAlignment.center,
                children: _promptChipData(isHi, chat.subject)
                    .map((p) => _PromptChip(
                          icon: p.icon,
                          label: p.label,
                          onTap: () => _sendPrompt(p.action),
                        ))
                    .toList(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Message list for expanded state.
  Widget _messageArea(ChatState chat, bool isHi) {
    if (chat.messages.isEmpty) return _welcomeState(chat, null, isHi);
    return Expanded(
      child: ListView.builder(
        controller: _scrollController,
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
        itemCount: chat.messages.length,
        itemBuilder: (context, index) {
          return _MessageBubble(message: chat.messages[index]);
        },
      ),
    );
  }

  /// Build the expanded body.
  Widget _expandedBody(ChatState chat, bool isHi) {
    return Column(
      children: [
        if (chat.error != null)
          AppErrorWidget(
            message: chat.error!,
            onRetry: () => ref.read(chatProvider.notifier).clearError(),
          ),
        if (chat.messages.isEmpty)
          _welcomeState(chat, null, isHi)
        else
          _messageArea(chat, isHi),
        _inputBar(isHi, chat.isSending),
      ],
    );
  }

  /// Subject badge shown in the header when a subject is active.
  Widget _subjectBadge(String subject, bool isHi) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.subjectColor(subject).withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
            color: AppColors.subjectColor(subject).withValues(alpha: 0.3)),
      ),
      child: Text(
        isHi ? _subjectNameHi(subject) : subject,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: AppColors.subjectColor(subject),
        ),
      ),
    );
  }

  String _subjectNameHi(String code) {
    const map = {
      'math': 'गणित',
      'science': 'विज्ञान',
      'physics': 'भौतिकी',
      'chemistry': 'रसायन',
      'biology': 'जीवविज्ञान',
      'english': 'अंग्रेज़ी',
      'hindi': 'हिंदी',
    };
    return map[code] ?? code;
  }

  /// Collapsed body: a prominent CTA card.
  ///
  /// The card background is tappable (InkWell) to expand/collapse. Quick-prompt
  /// chips sit on top of the background so tapping a chip sends the prompt AND
  /// auto-expands — the card's InkWell does NOT fire for chip taps because the
  /// chips render above the background in the Stack.
  Widget _collapsedBody(ChatState chat, bool isHi, String? subject) {
    final needsSubject = subject == null || subject.isEmpty;

    return Stack(
      children: [
        // Card background — tappable to toggle expand/collapse.
        Positioned.fill(
          child: InkWell(
            onTap: _toggle,
            borderRadius:
                const BorderRadius.all(Radius.circular(16)),
            child: Container(
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius:
                    const BorderRadius.all(Radius.circular(16)),
                border: Border.all(
                  color: AppColors.primary.withValues(alpha: 0.25),
                  width: 1.5,
                ),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primary.withValues(alpha: 0.08),
                    blurRadius: 10,
                    offset: const Offset(0, 3),
                  ),
                ],
              ),
            ),
          ),
        ),
        // Card content rendered above the background.
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
          child: Column(
            children: [
              // Header row: fox icon + name + subject badge + expand arrow.
              Row(
                children: [
                  const Text('🦊', style: TextStyle(fontSize: 28)),
                  const SizedBox(width: 8),
                  Text(
                    isHi ? 'फॉक्सी' : 'Foxy',
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w700,
                      color: AppColors.primary,
                    ),
                  ),
                  if (subject != null && subject.isNotEmpty) ...[
                    const SizedBox(width: 8),
                    _subjectBadge(subject, isHi),
                  ],
                  const Spacer(),
                  Icon(
                    _expanded
                        ? Icons.keyboard_arrow_down_rounded
                        : Icons.keyboard_arrow_up_rounded,
                    size: 26,
                    color: AppColors.primary,
                  ),
                ],
              ),
              const SizedBox(height: 12),
              // Subject picker (no session) OR quick prompts (session active).
              if (needsSubject)
                _subjectPickerStrip(isHi)
              else
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  alignment: WrapAlignment.center,
                  children: _promptChipData(isHi, subject)
                      .map((p) => _PromptChip(
                            icon: p.icon,
                            label: p.label,
                            onTap: () => _sendPrompt(p.action),
                          ))
                      .toList(),
                ),
              const SizedBox(height: 10),
              // Affordance text.
              Text(
                needsSubject
                    ? (isHi ? 'कोई विषय चुनो' : 'Pick a subject')
                    : (isHi ? 'टैप करो और बात करो' : 'Tap to chat'),
                style: TextStyle(
                  fontSize: 12,
                  color: AppColors.primary,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  /// Compact subject-picker strip shown when no subject is active.
  Widget _subjectPickerStrip(bool isHi) {
    return Consumer(builder: (context, ref, _) {
      final subjectsAsync = ref.watch(subjectsProvider);
      return subjectsAsync.when(
        loading: () => const Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Center(child: CircularProgressIndicator()),
        ),
        error: (_, __) => const SizedBox.shrink(),
        data: (subjects) {
          final available = subjects.where((s) => !s.isLocked).toList();
          if (available.isEmpty) {
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                isHi ? 'कोई विषय उपलब्ध नहीं' : 'No subjects available',
                style: const TextStyle(
                    fontSize: 11, color: AppColors.textTertiary),
              ),
            );
          }
          return SizedBox(
            height: 40,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: available.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final s = available[index];
                return GestureDetector(
                  onTap: () {
                    ref
                        .read(chatProvider.notifier)
                        .startSession(subject: s.code);
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 14, vertical: 8),
                    decoration: BoxDecoration(
                      color: AppColors.subjectColor(s.code)
                          .withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(
                        color: AppColors.subjectColor(s.code)
                            .withValues(alpha: 0.3),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(s.icon, style: const TextStyle(fontSize: 15)),
                        const SizedBox(width: 4),
                        Text(
                          isHi ? s.nameHi : s.name,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: AppColors.subjectColor(s.code),
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          );
        },
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final chat = ref.watch(chatProvider);
    final student = ref.watch(studentProvider).valueOrNull;
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final subject = chat.subject;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeInOut,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: const BorderRadius.all(Radius.circular(16)),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Column(
        children: [
          // Header bar.
          Container(
            padding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: const BoxDecoration(
              border: Border(
                  bottom: BorderSide(
                      color: AppColors.borderLight, width: 0.5)),
            ),
            child: Row(
              children: [
                const Text('🦊', style: TextStyle(fontSize: 18)),
                const SizedBox(width: 8),
                Text(
                  isHi ? 'फॉक्सी' : 'Foxy',
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
                if (subject != null && subject.isNotEmpty) ...[
                  const SizedBox(width: 8),
                  _subjectBadge(subject, isHi),
                ],
                const Spacer(),
                IconButton(
                  icon: Icon(
                    _expanded
                        ? Icons.keyboard_arrow_down_rounded
                        : Icons.keyboard_arrow_up_rounded,
                    size: 20,
                    color: AppColors.textSecondary,
                  ),
                  onPressed: _toggle,
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(
                      minWidth: 32, minHeight: 32),
                ),
              ],
            ),
          ),
          // Expanded or collapsed body.
          if (_expanded)
            _expandedBody(chat, isHi)
          else
            _collapsedBody(chat, isHi, subject),
        ],
      ),
    );
  }
}

/// Data for a quick-prompt chip.
class _PromptChipData {
  final String icon;
  final String label;
  final String action;
  const _PromptChipData({
    required this.icon,
    required this.label,
    required this.action,
  });
}

/// A quick-prompt chip (used in both collapsed and welcome states).
class _PromptChip extends StatelessWidget {
  final String icon;
  final String label;
  final VoidCallback onTap;

  const _PromptChip({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: AppColors.accent.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.accent.withValues(alpha: 0.2)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(icon, style: const TextStyle(fontSize: 15)),
            const SizedBox(width: 4),
            Text(
              label,
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.accent,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A single message bubble rendered inside the expanded panel.
class _MessageBubble extends StatelessWidget {
  final ChatMessage message;

  const _MessageBubble({required this.message});

  @override
  Widget build(BuildContext context) {
    if (message.isLoading) {
      return Align(
        alignment: Alignment.centerLeft,
        child: Container(
          margin: const EdgeInsets.only(bottom: 8, right: 60),
          padding: const EdgeInsets.symmetric(
              horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.borderLight),
          ),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppColors.accent,
                ),
              ),
              SizedBox(width: 10),
              Text(
                'Foxy is thinking...',
                style: TextStyle(
                  fontSize: 13,
                  color: AppColors.textTertiary,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ],
          ),
        ),
      );
    }

    final isUser = message.isUser;

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: EdgeInsets.only(
          bottom: 8,
          left: isUser ? 60 : 0,
          right: isUser ? 0 : 60,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: isUser ? AppColors.primary : AppColors.surface,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isUser ? 16 : 4),
            bottomRight: Radius.circular(isUser ? 4 : 16),
          ),
          border: isUser ? null : Border.all(color: AppColors.borderLight),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!isUser)
              const Padding(
                padding: EdgeInsets.only(bottom: 4),
                child: Text(
                  '🦊 Foxy',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    color: AppColors.accent,
                  ),
                ),
              ),
            SelectableText(
              message.content,
              style: TextStyle(
                fontSize: 14,
                height: 1.5,
                color: isUser ? Colors.white : AppColors.textPrimary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
