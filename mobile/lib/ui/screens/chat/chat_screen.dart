import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_colors.dart';
import '../../../providers/chat_provider.dart';
import '../../../providers/auth_provider.dart';
import '../../../data/models/chat_message.dart';
import '../../widgets/error_widget.dart';

/// Foxy chat.
///
/// LAUNCH HANDLING (Phase 6 sub-phase 7 — minimal, additive): the screen can
/// now be launched in a specific Foxy [initialMode] with a seeded
/// [initialTopic]. This exists so the Weekly Curiosity Dive can open Foxy in
/// `explorer` mode on the dive's topic — mobile parity for the web dive's
/// `/foxy?mode=explorer&topic=…` hand-off (`apps/host/src/app/dive/page.tsx`).
///
/// A bare `const ChatScreen()` / bare `/chat` push behaves EXACTLY as before:
/// [initialMode] is null, so the original "start a session only if none
/// exists, in the default `learn` mode" branch runs unchanged. Nothing about
/// message sending, the safety/abstain handling, or quota mapping is touched
/// here — the mode is threaded through [ChatNotifier] → [ChatRepository]
/// verbatim.
class ChatScreen extends ConsumerStatefulWidget {
  /// Foxy session mode (`learn` | `explorer` | …). When non-null a FRESH
  /// session is always started, because a mode change is a new session (the
  /// server ties mode to the session turn, and the web achieves the same by
  /// loading a new `/foxy?mode=` page).
  final String? initialMode;

  /// Seeds `chat_sessions.topic` and the `chapter` field of the Foxy request.
  final String? initialTopic;

  final String? initialSubject;

  const ChatScreen({
    super.key,
    this.initialMode,
    this.initialTopic,
    this.initialSubject,
  });

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  final _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final notifier = ref.read(chatProvider.notifier);
      final mode = widget.initialMode;
      if (mode != null && mode.isNotEmpty) {
        // Explicit-mode launch: always a fresh session so a leftover `learn`
        // session can never silently swallow an `explorer` launch.
        notifier.startSession(
          subject: widget.initialSubject,
          topic: widget.initialTopic,
          mode: mode,
        );
        return;
      }
      // Unchanged legacy path: auto-start a session only if none exists.
      final chat = ref.read(chatProvider);
      if (chat.session == null) {
        notifier.startSession();
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  /// Opening prompts for an `explorer`-mode (Weekly Dive) launch. These are
  /// plain seeded user turns — they carry no pedagogy of their own; the
  /// Socratic behaviour comes entirely from the server-side explorer persona
  /// directive in the Foxy route.
  List<Widget> _explorerPrompts(String? topic, bool isHi) {
    final t = (topic ?? '').trim();
    final subject = t.isEmpty ? (isHi ? 'इस विषय' : 'this topic') : t;
    final prompts = isHi
        ? <(String, String)>[
            ('$subject क्यों होता है?', '$subject क्यों होता है? आसान भाषा में बताओ।'),
            ('असल ज़िंदगी में कहाँ?', '$subject असल ज़िंदगी में कहाँ दिखता है?'),
            ('मुझसे सवाल पूछो', 'मुझसे $subject पर सवाल पूछो ताकि मैं खुद सोच सकूँ।'),
          ]
        : <(String, String)>[
            ('Why does this happen?', 'Why does $subject happen? Explain simply.'),
            ('Where do I see it?', 'Where do I see $subject in real life?'),
            ('Quiz my thinking', 'Ask me questions about $subject so I figure it out myself.'),
          ];
    return prompts
        .map((p) => _QuickPrompt(p.$1, onTap: () {
              _controller.text = p.$2;
              _send();
            }))
        .toList(growable: false);
  }

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    _controller.clear();
    ref.read(chatProvider.notifier).sendMessage(text);

    // Scroll to bottom after send
    Future.delayed(const Duration(milliseconds: 100), () {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent + 100,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final chat = ref.watch(chatProvider);
    final student = ref.watch(studentProvider).valueOrNull;
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final isExplorer = chat.mode == 'explorer';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('🦊 ', style: TextStyle(fontSize: 20)),
            Text(isExplorer
                ? (isHi ? 'फॉक्सी · खोज' : 'Foxy · Explore')
                : 'Foxy'),
          ],
        ),
        actions: [
          // New chat. In an explorer launch this restarts the SAME mode/topic
          // so the student doesn't silently drop out of their dive. In every
          // other case it is the ORIGINAL bare `startSession()` call —
          // behaviour unchanged.
          IconButton(
            icon: const Icon(Icons.add_comment_outlined, size: 20),
            tooltip: isHi ? 'नई चैट' : 'New Chat',
            onPressed: () {
              if (isExplorer) {
                ref.read(chatProvider.notifier).startSession(
                      subject: chat.subject,
                      topic: chat.topic,
                      mode: chat.mode,
                    );
                return;
              }
              ref.read(chatProvider.notifier).startSession();
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Error banner
          if (chat.error != null)
            ErrorBanner(
              message: chat.error!,
              onDismiss: () => ref.read(chatProvider.notifier).clearError(),
            ),

          // Welcome state (no messages yet)
          if (chat.messages.isEmpty)
            Expanded(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('🦊', style: TextStyle(fontSize: 48)),
                      const SizedBox(height: 12),
                      Text(
                        isExplorer && (chat.topic?.isNotEmpty ?? false)
                            ? chat.topic!
                            : 'Hi${student != null ? ", ${student.name.split(' ').first}" : ''}!',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        isExplorer
                            ? (isHi
                                ? 'चलो इस विषय को खोजते हैं। जो भी सवाल मन में हो, पूछो।'
                                : "Let's explore this topic together.\nAsk whatever you're curious about.")
                            : (isHi
                                ? 'मैं फॉक्सी हूँ, तुम्हारा पढ़ाई का साथी।\nअपने विषयों के बारे में कुछ भी पूछो!'
                                : 'I\'m Foxy, your study buddy.\nAsk me anything about your subjects!'),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 14,
                          color: AppColors.textTertiary,
                          height: 1.5,
                        ),
                      ),
                      const SizedBox(height: 24),
                      // Quick prompts
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        alignment: WrapAlignment.center,
                        children: isExplorer
                            ? _explorerPrompts(chat.topic, isHi)
                            : [
                                _QuickPrompt('Explain photosynthesis', onTap: () {
                                  _controller.text = 'Explain photosynthesis simply';
                                  _send();
                                }),
                                _QuickPrompt('What is Ohm\'s law?', onTap: () {
                                  _controller.text = 'What is Ohm\'s law?';
                                  _send();
                                }),
                                _QuickPrompt('Solve x² - 5x + 6 = 0', onTap: () {
                                  _controller.text = 'Solve x² - 5x + 6 = 0';
                                  _send();
                                }),
                              ],
                      ),
                    ],
                  ),
                ),
              ),
            )
          else
            // Messages list
            Expanded(
              child: ListView.builder(
                controller: _scrollController,
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                itemCount: chat.messages.length,
                itemBuilder: (context, index) {
                  return _MessageBubble(message: chat.messages[index]);
                },
              ),
            ),

          // Input bar
          _ChatInputBar(
            controller: _controller,
            focusNode: _focusNode,
            isSending: chat.isSending,
            onSend: _send,
          ),
        ],
      ),
    );
  }
}

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
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
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
          color: isUser
              ? AppColors.primary
              : AppColors.surface,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isUser ? 16 : 4),
            bottomRight: Radius.circular(isUser ? 4 : 16),
          ),
          border: isUser
              ? null
              : Border.all(color: AppColors.borderLight),
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

class _QuickPrompt extends StatelessWidget {
  final String text;
  final VoidCallback onTap;

  const _QuickPrompt(this.text, {required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.accent.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: AppColors.accent.withValues(alpha: 0.2)),
        ),
        child: Text(
          text,
          style: const TextStyle(
            fontSize: 12,
            color: AppColors.accent,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

class _ChatInputBar extends StatelessWidget {
  final TextEditingController controller;
  final FocusNode focusNode;
  final bool isSending;
  final VoidCallback onSend;

  const _ChatInputBar({
    required this.controller,
    required this.focusNode,
    required this.isSending,
    required this.onSend,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(
        12, 8, 12,
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
                controller: controller,
                focusNode: focusNode,
                maxLines: 3,
                minLines: 1,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => onSend(),
                style: const TextStyle(fontSize: 14),
                decoration: const InputDecoration(
                  hintText: 'Ask Foxy anything...',
                  border: InputBorder.none,
                  contentPadding:
                      EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            onTap: isSending ? null : onSend,
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: isSending
                    ? AppColors.textTertiary
                    : AppColors.primary,
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
}
