/// Weekly Curiosity Dive — mobile parity for `apps/host/src/app/dive/page.tsx`
/// (Pedagogy v2 Wave 2; LIVE at 100% in production since 2026-06-24).
///
/// Flow: picker (phenomenon / weak topic / own topic) → Foxy explorer chat →
/// artifact composer. Native throughout (this is an interactive, write-heavy
/// surface — the WebView pattern used for HPC/Lab Notebook would be wrong
/// here).
///
/// The Foxy step launches mobile's EXISTING [ChatScreen] in `explorer` mode
/// via `/chat?mode=explorer&topic=…` — the same hand-off the web does with
/// `/foxy?mode=explorer&topic=…`, minus the new-tab semantics (mobile pushes
/// and the student pops back to the composer).
///
/// Every value shown here — the weekly streak, the ISO week, whether the dive
/// is already complete — comes verbatim from a server response. Nothing is
/// recomputed client-side.
///
/// Owner: mobile · Reviewers: quality (UX), assessment (dive pedagogy copy)
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../data/models/dive_models.dart';
import '../../../providers/dive_provider.dart';
import '../../widgets/error_widget.dart';
import '../../widgets/loading_widget.dart';

class DiveScreen extends ConsumerStatefulWidget {
  const DiveScreen({super.key});

  @override
  ConsumerState<DiveScreen> createState() => _DiveScreenState();
}

class _DiveScreenState extends ConsumerState<DiveScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(diveProvider.notifier).load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final dive = ref.watch(diveProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? '🤿 साप्ताहिक डाइव' : '🤿 Weekly Dive'),
        actions: [
          IconButton(
            icon: const Icon(Icons.history_rounded),
            tooltip: isHi ? 'डाइव डायरी' : 'Dive journal',
            onPressed: () => context.push('/dive/history'),
          ),
        ],
      ),
      body: SafeArea(child: _body(context, dive, isHi)),
    );
  }

  Widget _body(BuildContext context, DiveScreenState dive, bool isHi) {
    switch (dive.phase) {
      case DivePhase.loading:
        return LoadingScreen(message: isHi ? 'लोड हो रहा है...' : 'Loading...');

      case DivePhase.error:
        return AppErrorWidget(
          message: isHi ? 'लोड नहीं हो सका' : 'Failed to load',
          onRetry: () => ref.read(diveProvider.notifier).load(),
        );

      // 404 / flag off — soft fallback, identical in spirit to the web's
      // `dive-flag-off` branch. Never an error wall.
      case DivePhase.unavailable:
        return _SoftUnavailable(isHi: isHi);

      case DivePhase.completed:
      case DivePhase.justSaved:
        return _CompletedView(
          isHi: isHi,
          justSaved: dive.phase == DivePhase.justSaved,
          weeklyStreakCount: dive.weeklyStreakCount,
          isoWeek: dive.isoWeek,
        );

      case DivePhase.picker:
        return _PickerView(state: dive, isHi: isHi);

      case DivePhase.diveActive:
        return _ActiveView(state: dive, isHi: isHi);
    }
  }
}

// ─── Unavailable (flag off) ──────────────────────────────────────────────────

class _SoftUnavailable extends StatelessWidget {
  final bool isHi;
  const _SoftUnavailable({required this.isHi});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('🤿', style: TextStyle(fontSize: 40)),
            const SizedBox(height: 12),
            Text(
              isHi
                  ? 'यह सुविधा अभी आपके लिए उपलब्ध नहीं है।'
                  : 'This feature is not available for you yet.',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 14, color: AppColors.textSecondary),
            ),
            const SizedBox(height: 20),
            OutlinedButton(
              onPressed: () => context.pop(),
              child: Text(isHi ? '← वापस' : '← Back'),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Completed / just-saved ─────────────────────────────────────────────────

class _CompletedView extends StatelessWidget {
  final bool isHi;
  final bool justSaved;
  final int weeklyStreakCount;
  final String isoWeek;

  const _CompletedView({
    required this.isHi,
    required this.justSaved,
    required this.weeklyStreakCount,
    required this.isoWeek,
  });

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 32),
      children: [
        Text(
          justSaved
              ? (isHi ? 'इस सप्ताह की डाइव हो गई!' : "This week's dive: done!")
              : (isHi ? 'इस सप्ताह की डाइव पूरी' : "This week's dive is complete"),
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 4),
        Text(
          isHi
              ? 'सप्ताह $isoWeek · $weeklyStreakCount-सप्ताह की लय'
              : 'Week $isoWeek · $weeklyStreakCount-week rhythm',
          style: const TextStyle(fontSize: 13, color: AppColors.textTertiary),
        ),
        const SizedBox(height: 18),
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            gradient: LinearGradient(colors: [
              AppColors.accent.withValues(alpha: 0.08),
              AppColors.brand.withValues(alpha: 0.06),
            ]),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: AppColors.accent.withValues(alpha: 0.2)),
          ),
          child: Row(
            children: [
              const Text('🎉', style: TextStyle(fontSize: 26)),
              const SizedBox(width: 14),
              Expanded(
                child: Text(
                  isHi
                      ? 'अगले सोमवार को नई डाइव शुरू कर सकते हो।'
                      : 'A new dive opens next Monday.',
                  style: const TextStyle(fontSize: 13.5, height: 1.4),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton(
            onPressed: () => context.push('/dive/history'),
            child: Text(isHi ? '📔 मेरी डाइव डायरी' : '📔 My dive journal'),
          ),
        ),
      ],
    );
  }
}

// ─── Picker ─────────────────────────────────────────────────────────────────

class _PickerView extends ConsumerStatefulWidget {
  final DiveScreenState state;
  final bool isHi;

  const _PickerView({required this.state, required this.isHi});

  @override
  ConsumerState<_PickerView> createState() => _PickerViewState();
}

class _PickerViewState extends ConsumerState<_PickerView> {
  DivePickerOption? _selected;
  String? _phenomenonSlug;
  String? _weakTopicId;
  final _ownTopicController = TextEditingController();

  DiveState get _diveState => widget.state.state!;

  @override
  void initState() {
    super.initState();
    // Server-chosen persona-aware default. Never overridden client-side.
    _selected = _diveState.defaultPicker;
    _phenomenonSlug = _diveState.eligiblePhenomena.isNotEmpty
        ? _diveState.eligiblePhenomena.first.slug
        : null;
    _weakTopicId =
        _diveState.weakTopics.isNotEmpty ? _diveState.weakTopics.first.topicId : null;
  }

  @override
  void dispose() {
    _ownTopicController.dispose();
    super.dispose();
  }

  bool get _canSubmit {
    switch (_selected) {
      case DivePickerOption.phenomenon:
        return (_phenomenonSlug ?? '').isNotEmpty;
      case DivePickerOption.weakTopic:
        return (_weakTopicId ?? '').isNotEmpty;
      case DivePickerOption.ownTopic:
        return _ownTopicController.text.trim().isNotEmpty;
      case null:
        return false;
    }
  }

  void _submit() {
    final option = _selected;
    if (option == null || !_canSubmit) return;
    ref.read(diveProvider.notifier).commitPicker(
          option: option,
          phenomenonSlug: _phenomenonSlug,
          weakTopicId: _weakTopicId,
          ownTopic: _ownTopicController.text.trim(),
        );
  }

  @override
  Widget build(BuildContext context) {
    final isHi = widget.isHi;
    final s = _diveState;
    final err = widget.state.errorMessage;

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () => ref.read(diveProvider.notifier).load(),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          Text(
            isHi ? 'इस सप्ताह की 60-मिनट डाइव' : "This week's 60-minute dive",
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          Text(
            isHi
                ? 'एक विषय चुनो, फॉक्सी से बात करो, और एक छोटी कलाकृति सेव करो।'
                : 'Pick a topic, talk to Foxy, save a short artifact.',
            style: const TextStyle(fontSize: 13, color: AppColors.textTertiary),
          ),
          if (err != null) ...[
            const SizedBox(height: 12),
            ErrorBanner(
              message: err == 'dive_start_unavailable'
                  ? (isHi
                      ? 'यह विकल्प अभी उपलब्ध नहीं है — दूसरा चुनो।'
                      : "That option isn't available right now — pick another.")
                  : (isHi
                      ? 'कुछ गलत हो गया — फिर से कोशिश करो।'
                      : 'Something went wrong — please try again.'),
              onDismiss: () => ref.read(diveProvider.notifier).clearError(),
            ),
          ],
          const SizedBox(height: 18),

          if (s.showPhenomenonOption && s.eligiblePhenomena.isNotEmpty)
            _OptionCard(
              selected: _selected == DivePickerOption.phenomenon,
              onSelect: () =>
                  setState(() => _selected = DivePickerOption.phenomenon),
              title: isHi
                  ? 'सुझाव: एक रोज़मर्रा का सिलसिला'
                  : 'Suggested: a real-world phenomenon',
              icon: '🌍',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: s.eligiblePhenomena.map((p) {
                  return _ChoiceRow(
                    checked: _phenomenonSlug == p.slug,
                    title: p.title(isHi),
                    subtitle: p.summary(isHi),
                    onTap: () => setState(() {
                      _phenomenonSlug = p.slug;
                      _selected = DivePickerOption.phenomenon;
                    }),
                  );
                }).toList(growable: false),
              ),
            ),

          if (s.showWeakTopicOption && s.weakTopics.isNotEmpty)
            _OptionCard(
              selected: _selected == DivePickerOption.weakTopic,
              onSelect: () =>
                  setState(() => _selected = DivePickerOption.weakTopic),
              title: isHi ? 'जिस विषय में कमज़ोर हो' : 'A topic you find hard',
              icon: '🎯',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: s.weakTopics.map((t) {
                  return _ChoiceRow(
                    checked: _weakTopicId == t.topicId,
                    title: t.label(isHi),
                    // `masteryProbability` is a SERVER-computed value; it is
                    // only formatted for display here.
                    subtitle: isHi
                        ? '${(t.masteryProbability * 100).round()}% महारत'
                        : '${(t.masteryProbability * 100).round()}% mastery',
                    onTap: () => setState(() {
                      _weakTopicId = t.topicId;
                      _selected = DivePickerOption.weakTopic;
                    }),
                  );
                }).toList(growable: false),
              ),
            ),

          if (s.showOwnTopicOption)
            _OptionCard(
              selected: _selected == DivePickerOption.ownTopic,
              onSelect: () =>
                  setState(() => _selected = DivePickerOption.ownTopic),
              title: isHi ? 'अपना विषय चुनो' : 'Bring your own topic',
              icon: '✨',
              child: TextField(
                controller: _ownTopicController,
                maxLength: 200,
                onTap: () => setState(() => _selected = DivePickerOption.ownTopic),
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  hintText: isHi
                      ? 'जैसे: इंद्रधनुष कैसे बनता है?'
                      : 'e.g. How do rainbows form?',
                  border: const OutlineInputBorder(),
                  isDense: true,
                  counterText: '',
                ),
                style: const TextStyle(fontSize: 13.5),
              ),
            ),

          const SizedBox(height: 8),
          SizedBox(
            height: 48,
            child: ElevatedButton(
              onPressed:
                  (_canSubmit && !widget.state.isSubmitting) ? _submit : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.brand,
                foregroundColor: Colors.white,
              ),
              child: widget.state.isSubmitting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Text(isHi ? 'डाइव शुरू करो →' : 'Start the dive →'),
            ),
          ),
        ],
      ),
    );
  }
}

/// A single selectable row inside an [_OptionCard]. Hand-rolled instead of
/// `RadioListTile` because that widget's `groupValue`/`onChanged` API is
/// deprecated on Flutter 3.44 (superseded by `RadioGroup`), and a plain
/// tappable row keeps the analyzer clean without pinning to either API.
class _ChoiceRow extends StatelessWidget {
  final bool checked;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _ChoiceRow({
    required this.checked,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 1, right: 8),
              child: Icon(
                checked
                    ? Icons.check_circle_rounded
                    : Icons.circle_outlined,
                size: 17,
                color: checked ? AppColors.brand : AppColors.textTertiary,
              ),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (subtitle.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11.5,
                        color: AppColors.textTertiary,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OptionCard extends StatelessWidget {
  final bool selected;
  final VoidCallback onSelect;
  final String title;
  final String icon;
  final Widget child;

  const _OptionCard({
    required this.selected,
    required this.onSelect,
    required this.title,
    required this.icon,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onSelect,
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: selected
                  ? AppColors.brand.withValues(alpha: 0.05)
                  : AppColors.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: selected ? AppColors.brand : AppColors.border,
                width: selected ? 1.6 : 1,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(icon, style: const TextStyle(fontSize: 18)),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        title,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    Icon(
                      selected
                          ? Icons.radio_button_checked_rounded
                          : Icons.radio_button_unchecked_rounded,
                      size: 18,
                      color: selected ? AppColors.brand : AppColors.textTertiary,
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                child,
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Active dive (Foxy CTA + artifact composer) ─────────────────────────────

class _ActiveView extends ConsumerStatefulWidget {
  final DiveScreenState state;
  final bool isHi;

  const _ActiveView({required this.state, required this.isHi});

  @override
  ConsumerState<_ActiveView> createState() => _ActiveViewState();
}

class _ActiveViewState extends ConsumerState<_ActiveView> {
  late final TextEditingController _title;
  final _keyConcepts = TextEditingController();
  final _workedExample = TextEditingController();
  final _studentVoice = TextEditingController();

  ResolvedDive get _resolved => widget.state.resolved!;

  @override
  void initState() {
    super.initState();
    _title = TextEditingController(text: _resolved.diveTopic);
  }

  @override
  void dispose() {
    _title.dispose();
    _keyConcepts.dispose();
    _workedExample.dispose();
    _studentVoice.dispose();
    super.dispose();
  }

  List<String> get _conceptLines => _keyConcepts.text
      .split('\n')
      .map((s) => s.trim())
      .where((s) => s.isNotEmpty)
      .toList(growable: false);

  bool get _canSubmit {
    final concepts = _conceptLines.length;
    return !widget.state.isSubmitting &&
        _title.text.trim().isNotEmpty &&
        concepts >= kDiveKeyConceptsMin &&
        concepts <= kDiveKeyConceptsMax &&
        _studentVoice.text.trim().length >= kDiveStudentVoiceMinChars;
  }

  /// Maps the route's machine-readable 400 codes to localized copy. Keyed on
  /// the CODE (not on prose), so server copy changes can't break this.
  String _artifactErrorCopy(String code, bool isHi) {
    return switch (code) {
      'missing_title' =>
        isHi ? 'शीर्षक ज़रूरी है।' : 'A title is required.',
      'missing_student_voice' => isHi
          ? 'अपने शब्दों में कुछ लिखो।'
          : 'Write something in your own words.',
      'invalid_picker_option' || 'invalid_body' || 'invalid_json' => isHi
          ? 'कुछ गलत हो गया — डाइव फिर से शुरू करो।'
          : 'Something went wrong — please restart the dive.',
      _ => isHi ? 'सेव नहीं हो सका।' : "Couldn't save.",
    };
  }

  @override
  Widget build(BuildContext context) {
    final isHi = widget.isHi;
    final resolved = _resolved;
    final errCode = widget.state.artifactErrorCode;
    final errMsg = widget.state.errorMessage;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    resolved.diveTopic,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    resolved.diveSubjects.isNotEmpty
                        ? resolved.diveSubjects.join(' · ')
                        : (isHi ? 'खुली खोज' : 'Open exploration'),
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: AppColors.textTertiary,
                    ),
                  ),
                ],
              ),
            ),
            TextButton(
              onPressed: () => ref.read(diveProvider.notifier).backToPicker(),
              child: Text(isHi ? 'बदलो' : 'Change'),
            ),
          ],
        ),
        const SizedBox(height: 18),

        // ── Step 1: Foxy explorer chat ──
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.accent.withValues(alpha: 0.06),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.accent.withValues(alpha: 0.18)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                isHi ? '1. फॉक्सी के साथ बात करो' : '1. Talk to Foxy',
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 4),
              Text(
                isHi
                    ? 'फॉक्सी खोलो, इस विषय को समझो, फिर वापस आकर आर्टिफ़ैक्ट लिखो।'
                    : 'Open Foxy, explore this topic, then come back and write the artifact.',
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.textTertiary,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                height: 44,
                child: ElevatedButton(
                  // Launches the EXISTING chat screen in `explorer` mode with
                  // the dive topic seeded — mobile's equivalent of the web's
                  // `/foxy?mode=explorer&topic=…` link. Uses `push` (not `go`)
                  // so popping returns straight to this composer.
                  onPressed: () => context.push(
                    '/chat?mode=explorer'
                    '&topic=${Uri.encodeQueryComponent(resolved.diveTopic)}'
                    '${resolved.diveSubjects.isNotEmpty ? '&subject=${Uri.encodeQueryComponent(resolved.diveSubjects.first)}' : ''}',
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.accent,
                    foregroundColor: Colors.white,
                  ),
                  child: Text(isHi ? '🦊 फॉक्सी खोलो' : '🦊 Open Foxy'),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 22),

        // ── Step 2: artifact composer ──
        Text(
          isHi ? '2. आर्टिफ़ैक्ट लिखो' : '2. Write the artifact',
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 12),

        if (errCode != null) ...[
          ErrorBanner(
            message: _artifactErrorCopy(errCode, isHi),
            onDismiss: () => ref.read(diveProvider.notifier).clearError(),
          ),
          const SizedBox(height: 8),
        ] else if (errMsg != null) ...[
          ErrorBanner(
            message: isHi
                ? 'सेव नहीं हो सका — फिर से कोशिश करो।'
                : "Couldn't save — please try again.",
            onDismiss: () => ref.read(diveProvider.notifier).clearError(),
          ),
          const SizedBox(height: 8),
        ],

        _Field(
          label: isHi ? 'शीर्षक' : 'Title',
          child: TextField(
            controller: _title,
            maxLength: 200,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              isDense: true,
              counterText: '',
            ),
            style: const TextStyle(fontSize: 13.5),
          ),
        ),
        _Field(
          label: isHi
              ? 'मुख्य अवधारणाएँ (एक प्रति पंक्ति)'
              : 'Key concepts (one per line)',
          hint: '${_conceptLines.length}/$kDiveKeyConceptsMax',
          child: TextField(
            controller: _keyConcepts,
            maxLines: 4,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              isDense: true,
              hintText: isHi
                  ? 'पहली अवधारणा\nदूसरी अवधारणा'
                  : 'first concept\nsecond concept',
            ),
            style: const TextStyle(fontSize: 13.5),
          ),
        ),
        _Field(
          label: isHi
              ? 'हल किया गया उदाहरण (वैकल्पिक)'
              : 'Worked example (optional)',
          child: TextField(
            controller: _workedExample,
            maxLines: 4,
            maxLength: 4000,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              isDense: true,
              counterText: '',
            ),
            style: const TextStyle(fontSize: 13.5),
          ),
        ),
        _Field(
          label: isHi ? 'अपने शब्दों में' : 'In your own words',
          hint: '${_studentVoice.text.trim().length}/$kDiveStudentVoiceMinChars',
          child: TextField(
            controller: _studentVoice,
            maxLines: 5,
            maxLength: 4000,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              border: const OutlineInputBorder(),
              isDense: true,
              counterText: '',
              hintText: isHi
                  ? 'तुमने क्या समझा? कम से कम कुछ पंक्तियाँ लिखो।'
                  : 'What did you figure out? A few lines is enough.',
            ),
            style: const TextStyle(fontSize: 13.5),
          ),
        ),

        const SizedBox(height: 8),
        SizedBox(
          height: 48,
          child: ElevatedButton(
            onPressed: _canSubmit
                ? () => ref.read(diveProvider.notifier).saveArtifact(
                      title: _title.text,
                      keyConcepts: _conceptLines,
                      workedExample: _workedExample.text,
                      studentVoice: _studentVoice.text,
                    )
                : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.brand,
              foregroundColor: Colors.white,
            ),
            child: widget.state.isSubmitting
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : Text(isHi ? 'आर्टिफ़ैक्ट सेव करो' : 'Save artifact'),
          ),
        ),
      ],
    );
  }
}

class _Field extends StatelessWidget {
  final String label;
  final String? hint;
  final Widget child;

  const _Field({required this.label, this.hint, required this.child});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textSecondary,
                  ),
                ),
              ),
              if (hint != null)
                Text(
                  hint!,
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.textTertiary,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          child,
        ],
      ),
    );
  }
}
