// "Recently explored" strip for the Library screen — device-local only (no
// server sync), mirroring the web Library page's localStorage-backed
// `recently_viewed_chapters` (`apps/host/src/app/(student)/library/page.tsx`).
//
// NEW DEPENDENCY NOTE: this file uses `shared_preferences`, which is ALREADY
// a `mobile/pubspec.yaml` dependency (added earlier for another feature) —
// no new package was added for this screen.

import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _kRecentChaptersKey = 'library_recently_explored_chapters_v1';
const _kMaxStored = 10;
const _kMaxShown = 5;
const _kMaxAge = Duration(days: 14);

/// One "recently explored" chapter entry.
class RecentLibraryChapter {
  final String subjectCode;
  final String subjectName;
  final String chapterId;
  final int chapterNumber;
  final String chapterTitle;
  final int viewedAtMillis;

  const RecentLibraryChapter({
    required this.subjectCode,
    required this.subjectName,
    required this.chapterId,
    required this.chapterNumber,
    required this.chapterTitle,
    required this.viewedAtMillis,
  });

  Map<String, dynamic> toJson() => {
        'subjectCode': subjectCode,
        'subjectName': subjectName,
        'chapterId': chapterId,
        'chapterNumber': chapterNumber,
        'chapterTitle': chapterTitle,
        'viewedAtMillis': viewedAtMillis,
      };

  factory RecentLibraryChapter.fromJson(Map<String, dynamic> json) {
    return RecentLibraryChapter(
      subjectCode: json['subjectCode'] as String? ?? '',
      subjectName: json['subjectName'] as String? ?? '',
      chapterId: json['chapterId'] as String? ?? '',
      chapterNumber: (json['chapterNumber'] as num?)?.toInt() ?? 0,
      chapterTitle: json['chapterTitle'] as String? ?? '',
      viewedAtMillis: (json['viewedAtMillis'] as num?)?.toInt() ?? 0,
    );
  }
}

// ── Pure helpers (testable without a real SharedPreferences instance) ──────

/// Decode the stored JSON array. Never throws — malformed/legacy data
/// degrades to an empty list.
List<RecentLibraryChapter> decodeRecentChapters(String? raw) {
  if (raw == null || raw.isEmpty) return const <RecentLibraryChapter>[];
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! List) return const <RecentLibraryChapter>[];
    return decoded
        .whereType<Map>()
        .map((e) => RecentLibraryChapter.fromJson(Map<String, dynamic>.from(e)))
        .toList(growable: false);
  } catch (_) {
    return const <RecentLibraryChapter>[];
  }
}

String encodeRecentChapters(List<RecentLibraryChapter> items) =>
    jsonEncode(items.map((e) => e.toJson()).toList());

/// Insert-or-move-to-front [entry], deduped by (subjectCode, chapterId), then
/// capped at [_kMaxStored]. Pure.
List<RecentLibraryChapter> upsertRecentChapter(
  List<RecentLibraryChapter> existing,
  RecentLibraryChapter entry,
) {
  final filtered = existing
      .where((r) =>
          !(r.subjectCode == entry.subjectCode && r.chapterId == entry.chapterId))
      .toList();
  return <RecentLibraryChapter>[entry, ...filtered]
      .take(_kMaxStored)
      .toList(growable: false);
}

/// Filters [stored] to the [_kMaxAge] window, sorts newest-first, caps at
/// [_kMaxShown]. Pure; [now] is injectable for tests.
List<RecentLibraryChapter> visibleRecentChapters(
  List<RecentLibraryChapter> stored, {
  DateTime? now,
}) {
  final reference = now ?? DateTime.now();
  final cutoffMillis = reference.subtract(_kMaxAge).millisecondsSinceEpoch;
  final fresh = stored.where((r) => r.viewedAtMillis >= cutoffMillis).toList()
    ..sort((a, b) => b.viewedAtMillis.compareTo(a.viewedAtMillis));
  return fresh.take(_kMaxShown).toList(growable: false);
}

// ── Provider ─────────────────────────────────────────────────────────────

/// Recently-explored chapters — device-local, capped + aged list. Exposes the
/// VISIBLE (filtered/capped/sorted) list; [recordChapterViewed] persists a
/// new entry and refreshes the exposed state.
final libraryRecentProvider =
    AsyncNotifierProvider<LibraryRecentNotifier, List<RecentLibraryChapter>>(
        LibraryRecentNotifier.new);

class LibraryRecentNotifier extends AsyncNotifier<List<RecentLibraryChapter>> {
  @override
  Future<List<RecentLibraryChapter>> build() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = decodeRecentChapters(prefs.getString(_kRecentChaptersKey));
    return visibleRecentChapters(stored);
  }

  Future<void> recordChapterViewed({
    required String subjectCode,
    required String subjectName,
    required String chapterId,
    required int chapterNumber,
    required String chapterTitle,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final stored = decodeRecentChapters(prefs.getString(_kRecentChaptersKey));
    final updated = upsertRecentChapter(
      stored,
      RecentLibraryChapter(
        subjectCode: subjectCode,
        subjectName: subjectName,
        chapterId: chapterId,
        chapterNumber: chapterNumber,
        chapterTitle: chapterTitle,
        viewedAtMillis: DateTime.now().millisecondsSinceEpoch,
      ),
    );
    await prefs.setString(_kRecentChaptersKey, encodeRecentChapters(updated));
    state = AsyncData(visibleRecentChapters(updated));
  }
}
