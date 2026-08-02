import 'package:test/test.dart';
import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';


/// tests for PlacementApi
void main() {
  final instance = AlfanumrikApiV2().getPlacementApi();

  group(PlacementApi, () {
    // Six cold-start placement probes for a subject
    //
    // Returns up to 6 placement probes for the given subject at the student's own grade, via selectPlacementQuestions (the cold-start sibling of the live adaptive selector — same table, same P6 shape guard, no second question source). Read-only; no mastery write happens here. Requires study_plan.view. 404 when ff_placement_v1 is off.
    //
    //Future<PlacementResponse> getPlacement(String subject, { String lang }) async
    test('test getPlacement', () async {
      // TODO
    });

    // Record one placement-probe response
    //
    // Writes a single append-only learning_events row (event_type = placement_probe). Sets a BKT prior via the projector; never recorded as a graded quiz attempt, and an unseen-topic response never counts as a wrong answer. A duplicate idempotencyKey returns 200 with duplicate: true instead of a second row or an error (learning_events_placement_probe_idempotency_uniq). Requires study_plan.create (a write, unlike the sibling GET routes in this family). 404 when ff_placement_v1 is off.
    //
    //Future<PlacementAnswerResult> postPlacementAnswer({ PlacementAnswerRequest placementAnswerRequest }) async
    test('test postPlacementAnswer', () async {
      // TODO
    });

  });
}
