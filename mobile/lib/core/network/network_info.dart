import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Reactive connectivity state — drives offline UI.
final connectivityProvider = StreamProvider<bool>((ref) {
  return Connectivity().onConnectivityChanged.map((results) {
    return results.any((r) => r != ConnectivityResult.none);
  });
});

/// Synchronous check for current connectivity.
Future<bool> hasConnection() async {
  final result = await Connectivity().checkConnectivity();
  return result.any((r) => r != ConnectivityResult.none);
}
