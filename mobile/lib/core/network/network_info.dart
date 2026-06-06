import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Reactive connectivity state — drives offline UI.
final connectivityProvider = StreamProvider<bool>((ref) {
  // connectivity_plus 5.x emits a single ConnectivityResult per change (the
  // List API arrived in 6.x). Online == any result other than `none`.
  return Connectivity().onConnectivityChanged.map((result) {
    return result != ConnectivityResult.none;
  });
});

/// Synchronous check for current connectivity.
Future<bool> hasConnection() async {
  final result = await Connectivity().checkConnectivity();
  return result != ConnectivityResult.none;
}
