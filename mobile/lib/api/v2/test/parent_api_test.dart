import 'package:test/test.dart';
import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';


/// tests for ParentApi
void main() {
  final instance = AlfanumrikApiV2().getParentApi();

  group(ParentApi, () {
    // Send a preset cheer to a linked child
    //
    // Parent sends a curated, preset-keyed encouragement to a linked child. Requires child.encourage and an approved guardian↔student link. Rate-limited to one cheer per (guardian, student) per 6 hours.
    //
    //Future<SuccessAck> postParentEncourage({ EncourageRequest encourageRequest }) async
    test('test postParentEncourage', () async {
      // TODO
    });

  });
}
