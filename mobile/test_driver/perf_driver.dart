// flutter_driver entrypoint for the jank benchmark.
//
// `flutter drive --driver=test_driver/perf_driver.dart --target=<integration
// test>` runs the integration_test on the device; when it finishes, the
// integration_test binding hands the captured timeline(s) back here via
// `responseDataCallback`. For every reported timeline this driver:
//   1. writes the standard Flutter artifacts
//      (build/benchmark/<key>.timeline.json + <key>.timeline_summary.json), and
//   2. writes an augmented jank report (build/benchmark/<key>_jank.json)
//      with P95 frame times and the % of frames over the 16.67 ms budget —
//      the headline metric the runbook gates on (<1% frames > 16.67 ms).
//
// NOT run here: no device/toolchain in this authoring environment. Validate in
// CI / on-device.

import 'dart:convert';
import 'dart:io';

import 'package:flutter_driver/flutter_driver.dart' as driver;
import 'package:integration_test/integration_test_driver.dart';

/// 60 fps frame budget in milliseconds. Frame arrays in the TimelineSummary are
/// in MICROSECONDS; we convert to ms and compare against this.
const double _budgetMillis = 1000 / 60; // 16.666…

Future<void> main() {
  return integrationDriver(
    responseDataCallback: (data) async {
      if (data == null) {
        stderr.writeln('[perf_driver] no reportData returned — nothing to '
            'summarize (did the target call binding.traceAction?)');
        return;
      }

      final outDir = Directory('build/benchmark');
      if (!outDir.existsSync()) {
        outDir.createSync(recursive: true);
      }

      var wrote = 0;
      for (final entry in data.entries) {
        final key = entry.key;
        // Only keys produced by traceAction's reportKey (…_timeline).
        if (!key.endsWith('_timeline')) continue;
        final value = entry.value;
        if (value is! Map) continue;

        final timeline =
            driver.Timeline.fromJson(Map<String, dynamic>.from(value));
        final summary = driver.TimelineSummary.summarize(timeline);

        // (1) Standard artifacts: raw trace + Flutter's own summary.
        await summary.writeTimelineToFile(
          key,
          destinationDirectory: outDir.path,
          pretty: true,
          includeSummary: true,
        );

        // (2) Augmented jank report.
        final report = _jankReport(key, summary.summaryJson);
        final jankFile = File('${outDir.path}/${key}_jank.json');
        await jankFile
            .writeAsString(const JsonEncoder.withIndent('  ').convert(report));

        stdout.writeln(
          '[perf_driver] $key  '
          'frames=${report['frame_count']}  '
          'build_p95=${report['build_p95_millis']}ms  '
          'raster_p95=${report['raster_p95_millis']}ms  '
          'jank(build)=${report['build_pct_over_budget']}%  '
          'jank(raster)=${report['raster_pct_over_budget']}%  '
          '=> ${report['verdict']}',
        );
        wrote++;
      }

      if (wrote == 0) {
        stderr.writeln('[perf_driver] reportData had no *_timeline keys — '
            'check the reportKey passed to traceAction');
      }
    },
  );
}

/// Build the jank report for one timeline from its TimelineSummary JSON.
///
/// `frame_build_times` / `frame_rasterizer_times` are lists of per-frame
/// durations in microseconds. We convert to ms, then compute P95 and the
/// fraction over the 16.67 ms budget for both the UI (build) and GPU (raster)
/// threads. The runbook gate is <1% of frames over budget on BOTH threads.
Map<String, dynamic> _jankReport(String key, Map<String, dynamic> summary) {
  final build = _framesMillis(summary['frame_build_times']);
  final raster = _framesMillis(summary['frame_rasterizer_times']);

  final buildPct = _pctOverBudget(build);
  final rasterPct = _pctOverBudget(raster);

  return <String, dynamic>{
    'timeline': key,
    'budget_millis': double.parse(_budgetMillis.toStringAsFixed(4)),
    'frame_count': build.length,
    'raster_frame_count': raster.length,
    'build_p95_millis': _percentileMillis(build, 95),
    'raster_p95_millis': _percentileMillis(raster, 95),
    'build_worst_millis': _maxMillis(build),
    'raster_worst_millis': _maxMillis(raster),
    'build_pct_over_budget': buildPct,
    'raster_pct_over_budget': rasterPct,
    // Flutter's own missed-budget counters, echoed for cross-checking our math.
    'missed_frame_build_budget_count':
        summary['missed_frame_build_budget_count'],
    'missed_frame_rasterizer_budget_count':
        summary['missed_frame_rasterizer_budget_count'],
    // Runbook budget: <1% of frames over 16.67 ms on both threads.
    'verdict': (buildPct < 1.0 && rasterPct < 1.0) ? 'PASS' : 'FAIL',
  };
}

List<double> _framesMillis(dynamic microsArray) {
  if (microsArray is! List) return const <double>[];
  return microsArray
      .whereType<num>()
      .map<double>((micros) => micros / 1000.0)
      .toList(growable: false);
}

double _percentileMillis(List<double> framesMillis, int percentile) {
  if (framesMillis.isEmpty) return 0;
  final sorted = [...framesMillis]..sort();
  final rank = ((percentile / 100.0) * (sorted.length - 1)).round();
  return double.parse(sorted[rank].toStringAsFixed(3));
}

double _pctOverBudget(List<double> framesMillis) {
  if (framesMillis.isEmpty) return 0;
  final over = framesMillis.where((t) => t > _budgetMillis).length;
  return double.parse((100.0 * over / framesMillis.length).toStringAsFixed(3));
}

double _maxMillis(List<double> framesMillis) {
  if (framesMillis.isEmpty) return 0;
  return double.parse(
    framesMillis.reduce((a, b) => a > b ? a : b).toStringAsFixed(3),
  );
}
