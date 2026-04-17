import 'package:equatable/equatable.dart';

/// Represents a subject available to a student.
///
/// Mirrors the response shape of `GET /api/student/subjects` (web backend
/// Phase B). The backend derives allowed subjects from the student's grade,
/// stream, and plan via the `get_available_subjects` RPC — mobile no longer
/// maintains a hardcoded grade→subject mapping.
class Subject extends Equatable {
  final String code;
  final String name;
  final String nameHi;
  final String icon;
  final String color;

  /// One of: `cbse_core`, `cbse_elective`, `platform_elective`.
  final String subjectKind;

  /// True if this subject is part of the CBSE core curriculum for the
  /// student's grade.
  final bool isCore;

  /// True if the student's current plan does not unlock this subject.
  /// UI should still display it (so the user can upgrade) but gate entry.
  final bool isLocked;

  const Subject({
    required this.code,
    required this.name,
    required this.nameHi,
    required this.icon,
    required this.color,
    required this.subjectKind,
    required this.isCore,
    required this.isLocked,
  });

  factory Subject.fromJson(Map<String, dynamic> json) {
    return Subject(
      code: json['code'] as String,
      name: json['name'] as String,
      nameHi: (json['nameHi'] as String?) ?? (json['name'] as String),
      icon: (json['icon'] as String?) ?? '📘',
      color: (json['color'] as String?) ?? '#7C3AED',
      subjectKind: (json['subjectKind'] as String?) ?? 'cbse_core',
      isCore: json['isCore'] as bool? ?? true,
      isLocked: json['isLocked'] as bool? ?? false,
    );
  }

  @override
  List<Object?> get props =>
      [code, name, nameHi, icon, color, subjectKind, isCore, isLocked];
}
