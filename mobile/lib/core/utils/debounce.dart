import 'dart:async';
import 'dart:ui';

/// Prevents rapid-fire taps on buttons and actions.
class Debounce {
  static Timer? _timer;
  static final _locks = <String, DateTime>{};

  /// Debounce by delay — cancels previous if called again within window.
  static void run(VoidCallback action, {Duration delay = const Duration(milliseconds: 300)}) {
    _timer?.cancel();
    _timer = Timer(delay, action);
  }

  /// Guard — prevents action from firing more than once per cooldown.
  /// Use for button presses (login, signup, submit, checkout).
  static void guard(String key, VoidCallback action, {Duration cooldown = const Duration(seconds: 1)}) {
    final now = DateTime.now();
    final last = _locks[key];
    if (last != null && now.difference(last) < cooldown) return;
    _locks[key] = now;
    action();
  }
}
