import 'package:test/test.dart';
import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';


/// tests for LearnApi
void main() {
  final instance = AlfanumrikApiV2().getLearnApi();

  group(LearnApi, () {
    // Concept content for a subject + chapter
    //
    // Returns the ordered NCERT chapter prose (markdown + source attribution) for a subject + chapter. Reuses fetchChapterContent (rag_content_chunks read used by /learn). Requires study_plan.view.
    //
    //Future<ConceptResponse> getLearnConcept(String subject, String grade, int chapter) async
    test('test getLearnConcept', () async {
      // TODO
    });

    // Curriculum tree (subjects → chapters → topics)
    //
    // Returns the plan-gated curriculum tree the mobile Learn screen needs. Reuses get_available_subjects (plan/grade/stream gating) + curriculum_topics. Requires study_plan.view.
    //
    //Future<CurriculumResponse> getLearnCurriculum({ String subject }) async
    test('test getLearnCurriculum', () async {
      // TODO
    });

  });
}
