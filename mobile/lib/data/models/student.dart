import 'package:equatable/equatable.dart';

class Student extends Equatable {
  final String id;
  final String authUserId;
  final String name;
  final String? email;
  final String grade;
  final String board;
  final String role;
  final String planCode;
  final int xpTotal;
  final int level;
  final int streakDays;
  final DateTime? lastActiveAt;

  const Student({
    required this.id,
    required this.authUserId,
    required this.name,
    this.email,
    required this.grade,
    this.board = 'CBSE',
    this.role = 'student',
    this.planCode = 'free',
    this.xpTotal = 0,
    this.level = 1,
    this.streakDays = 0,
    this.lastActiveAt,
  });

  factory Student.fromJson(Map<String, dynamic> json) {
    return Student(
      id: json['id'] as String,
      authUserId: json['auth_user_id'] as String,
      name: json['name'] as String? ?? 'Student',
      email: json['email'] as String?,
      grade: json['grade'] as String? ?? '10',
      board: json['board'] as String? ?? 'CBSE',
      role: json['role'] as String? ?? 'student',
      planCode: json['plan_code'] as String? ?? 'free',
      xpTotal: json['xp_total'] as int? ?? 0,
      level: json['level'] as int? ?? 1,
      streakDays: json['streak_days'] as int? ?? 0,
      lastActiveAt: json['last_active_at'] != null
          ? DateTime.tryParse(json['last_active_at'] as String)
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'auth_user_id': authUserId,
        'name': name,
        'email': email,
        'grade': grade,
        'board': board,
        'role': role,
        'plan_code': planCode,
        'xp_total': xpTotal,
        'level': level,
        'streak_days': streakDays,
      };

  String get gradeNumber => grade.replaceAll(RegExp(r'[^0-9]'), '');

  bool get isPremium => planCode != 'free';

  String get planDisplayName {
    switch (planCode) {
      case 'starter_monthly':
      case 'starter_yearly':
        return 'Starter';
      case 'pro_monthly':
      case 'pro_yearly':
        return 'Pro';
      case 'ultimate_monthly':
      case 'ultimate_yearly':
        return 'Ultimate';
      default:
        return 'Free';
    }
  }

  @override
  List<Object?> get props => [id, authUserId, name, grade, planCode, xpTotal, level];
}
