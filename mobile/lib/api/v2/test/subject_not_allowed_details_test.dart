import 'package:test/test.dart';
import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';

// tests for SubjectNotAllowedDetails
void main() {
  final instance = SubjectNotAllowedDetailsBuilder();
  // TODO add properties to the builder and call build()

  group(SubjectNotAllowedDetails, () {
    // The subject CODES valid for this student on the rejecting route. For the 403 governance rejection: unlocked codes only. For the learn routes: every subject in the student tree (locked included — locked subjects are still valid read params).
    // BuiltList<String> allowed
    test('to test the property `allowed`', () async {
      // TODO
    });

    // Cause discriminator. Governance rejections (403 subject_not_allowed) emit 'grade' (not in this student's grade subject list) or 'plan' (plan-locked); other SubjectWriteError reasons ('stream', 'inactive', 'unknown', 'max_subjects') are reserved. The learn routes' 400 UNKNOWN_SUBJECT emits 'unknown_subject'. Kept a string (not an enum) so adding a reason is non-breaking for generated clients.
    // String reason
    test('to test the property `reason`', () async {
      // TODO
    });

    // The rejected subject value, verbatim as the client sent it.
    // String subject
    test('to test the property `subject`', () async {
      // TODO
    });

  });
}
