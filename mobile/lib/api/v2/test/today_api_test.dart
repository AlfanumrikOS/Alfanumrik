import 'package:test/test.dart';
import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';


/// tests for TodayApi
void main() {
  final instance = AlfanumrikApiV2().getTodayApi();

  group(TodayApi, () {
    // Today home queue
    //
    // Returns the ordered \"what could I do today?\" queue for the authenticated student as render-ready DTOs. Requires study_plan.view. 404 when ff_today_home_v1 is off.
    //
    //Future<TodayResponse> getToday() async
    test('test getToday', () async {
      // TODO
    });

  });
}
