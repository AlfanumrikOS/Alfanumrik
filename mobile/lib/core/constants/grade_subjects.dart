/// CBSE grade-to-subject mapping — mirrors web app's constants.ts
class GradeSubjects {
  GradeSubjects._();

  static const Map<String, List<SubjectInfo>> mapping = {
    '6': [
      SubjectInfo('math', 'Mathematics', '📐'),
      SubjectInfo('science', 'Science', '🔬'),
      SubjectInfo('english', 'English', '📖'),
      SubjectInfo('hindi', 'Hindi', '🕉️'),
      SubjectInfo('social_studies', 'Social Studies', '🌍'),
      SubjectInfo('coding', 'Coding', '💻'),
    ],
    '7': [
      SubjectInfo('math', 'Mathematics', '📐'),
      SubjectInfo('science', 'Science', '🔬'),
      SubjectInfo('english', 'English', '📖'),
      SubjectInfo('hindi', 'Hindi', '🕉️'),
      SubjectInfo('social_studies', 'Social Studies', '🌍'),
      SubjectInfo('coding', 'Coding', '💻'),
    ],
    '8': [
      SubjectInfo('math', 'Mathematics', '📐'),
      SubjectInfo('science', 'Science', '🔬'),
      SubjectInfo('english', 'English', '📖'),
      SubjectInfo('hindi', 'Hindi', '🕉️'),
      SubjectInfo('social_studies', 'Social Studies', '🌍'),
      SubjectInfo('coding', 'Coding', '💻'),
    ],
    '9': [
      SubjectInfo('math', 'Mathematics', '📐'),
      SubjectInfo('science', 'Science', '🔬'),
      SubjectInfo('english', 'English', '📖'),
      SubjectInfo('hindi', 'Hindi', '🕉️'),
      SubjectInfo('social_studies', 'Social Studies', '🌍'),
    ],
    '10': [
      SubjectInfo('math', 'Mathematics', '📐'),
      SubjectInfo('science', 'Science', '🔬'),
      SubjectInfo('english', 'English', '📖'),
      SubjectInfo('hindi', 'Hindi', '🕉️'),
      SubjectInfo('social_studies', 'Social Studies', '🌍'),
    ],
    '11': [
      SubjectInfo('math', 'Mathematics', '📐'),
      SubjectInfo('physics', 'Physics', '⚡'),
      SubjectInfo('chemistry', 'Chemistry', '🧪'),
      SubjectInfo('biology', 'Biology', '🧬'),
      SubjectInfo('english', 'English', '📖'),
      SubjectInfo('computer_science', 'Computer Science', '💻'),
    ],
    '12': [
      SubjectInfo('math', 'Mathematics', '📐'),
      SubjectInfo('physics', 'Physics', '⚡'),
      SubjectInfo('chemistry', 'Chemistry', '🧪'),
      SubjectInfo('biology', 'Biology', '🧬'),
      SubjectInfo('english', 'English', '📖'),
      SubjectInfo('computer_science', 'Computer Science', '💻'),
    ],
  };

  static List<SubjectInfo> forGrade(String grade) {
    return mapping[grade] ?? mapping['10']!;
  }
}

class SubjectInfo {
  final String code;
  final String name;
  final String emoji;

  const SubjectInfo(this.code, this.name, this.emoji);
}
