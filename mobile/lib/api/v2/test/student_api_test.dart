import 'package:test/test.dart';
import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';


/// tests for StudentApi
void main() {
  final instance = AlfanumrikApiV2().getStudentApi();

  group(StudentApi, () {
    // XP leaderboard
    //
    // Returns ranked leaderboard entries via the get_leaderboard RPC the web /leaderboard page uses. No PII beyond what the existing leaderboard exposes (P13). Requires progress.view_own.
    //
    //Future<LeaderboardResponse> getStudentLeaderboard({ String period, String scope }) async
    test('test getStudentLeaderboard', () async {
      // TODO
    });

    // Authenticated student profile
    //
    // Returns the authenticated student's profile (name, grade(string,P5), board, stream, plan, language). Reuses the identity profile read. Requires profile.view_own.
    //
    //Future<StudentProfileResponse> getStudentProfile() async
    test('test getStudentProfile', () async {
      // TODO
    });

    // Authenticated student progress
    //
    // Returns the structured progress payload (performance_scores, topic_mastery, knowledge_gaps, learning_velocity, decay_topics) the web /progress page reads. RLS-safe. Requires progress.view_own.
    //
    //Future<StudentProgressResponse> getStudentProgress() async
    test('test getStudentProgress', () async {
      // TODO
    });

  });
}
