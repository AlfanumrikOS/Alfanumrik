//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'today_item_type.g.dart';

class TodayItemType extends EnumClass {

  @BuiltValueEnumConst(wireName: r'resume_in_progress')
  static const TodayItemType resumeInProgress = _$resumeInProgress;
  @BuiltValueEnumConst(wireName: r'cold_start_diagnostic')
  static const TodayItemType coldStartDiagnostic = _$coldStartDiagnostic;
  @BuiltValueEnumConst(wireName: r'srs_due')
  static const TodayItemType srsDue = _$srsDue;
  @BuiltValueEnumConst(wireName: r'revise_decayed_topic')
  static const TodayItemType reviseDecayedTopic = _$reviseDecayedTopic;
  @BuiltValueEnumConst(wireName: r'weak_topic_zpd')
  static const TodayItemType weakTopicZpd = _$weakTopicZpd;
  @BuiltValueEnumConst(wireName: r'continue_lesson')
  static const TodayItemType continueLesson = _$continueLesson;
  @BuiltValueEnumConst(wireName: r'weekly_dive_due')
  static const TodayItemType weeklyDiveDue = _$weeklyDiveDue;
  @BuiltValueEnumConst(wireName: r'monthly_synthesis_due')
  static const TodayItemType monthlySynthesisDue = _$monthlySynthesisDue;
  @BuiltValueEnumConst(wireName: r'practice_weakest')
  static const TodayItemType practiceWeakest = _$practiceWeakest;

  static Serializer<TodayItemType> get serializer => _$todayItemTypeSerializer;

  const TodayItemType._(String name): super(name);

  static BuiltSet<TodayItemType> get values => _$values;
  static TodayItemType valueOf(String name) => _$valueOf(name);
}

/// Optionally, enum_class can generate a mixin to go with your enum for use
/// with Angular. It exposes your enum constants as getters. So, if you mix it
/// in to your Dart component class, the values become available to the
/// corresponding Angular template.
///
/// Trigger mixin generation by writing a line like this one next to your enum.
abstract class TodayItemTypeMixin = Object with _$TodayItemTypeMixin;

