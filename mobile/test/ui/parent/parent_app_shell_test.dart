import 'package:alfanumrik/ui/widgets/parent_app_shell.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'guardian navigation selects each destination and message deep link',
    () {
      expect(parentDestinationIndexForLocation('/parent'), 0);
      expect(parentDestinationIndexForLocation('/parent/progress'), 1);
      expect(parentDestinationIndexForLocation('/parent/plan'), 2);
      expect(parentDestinationIndexForLocation('/parent/messages'), 3);
      expect(parentDestinationIndexForLocation('/parent/messages/thread-1'), 3);
      expect(parentDestinationIndexForLocation('/parent/more'), 4);
    },
  );
}
