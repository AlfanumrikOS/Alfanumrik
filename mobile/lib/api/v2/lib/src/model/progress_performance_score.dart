//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'progress_performance_score.g.dart';

/// ProgressPerformanceScore
///
/// Properties:
/// * [levelName] 
/// * [overallScore] 
/// * [subject] 
/// * [updatedAt] 
@BuiltValue()
abstract class ProgressPerformanceScore implements Built<ProgressPerformanceScore, ProgressPerformanceScoreBuilder> {
  @BuiltValueField(wireName: r'level_name')
  String? get levelName;

  @BuiltValueField(wireName: r'overall_score')
  num get overallScore;

  @BuiltValueField(wireName: r'subject')
  String get subject;

  @BuiltValueField(wireName: r'updated_at')
  String? get updatedAt;

  ProgressPerformanceScore._();

  factory ProgressPerformanceScore([void updates(ProgressPerformanceScoreBuilder b)]) = _$ProgressPerformanceScore;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ProgressPerformanceScoreBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ProgressPerformanceScore> get serializer => _$ProgressPerformanceScoreSerializer();
}

class _$ProgressPerformanceScoreSerializer implements PrimitiveSerializer<ProgressPerformanceScore> {
  @override
  final Iterable<Type> types = const [ProgressPerformanceScore, _$ProgressPerformanceScore];

  @override
  final String wireName = r'ProgressPerformanceScore';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ProgressPerformanceScore object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'level_name';
    yield object.levelName == null ? null : serializers.serialize(
      object.levelName,
      specifiedType: const FullType.nullable(String),
    );
    yield r'overall_score';
    yield serializers.serialize(
      object.overallScore,
      specifiedType: const FullType(num),
    );
    yield r'subject';
    yield serializers.serialize(
      object.subject,
      specifiedType: const FullType(String),
    );
    yield r'updated_at';
    yield object.updatedAt == null ? null : serializers.serialize(
      object.updatedAt,
      specifiedType: const FullType.nullable(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    ProgressPerformanceScore object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ProgressPerformanceScoreBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'level_name':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.levelName = valueDes;
          break;
        case r'overall_score':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(num),
          ) as num;
          result.overallScore = valueDes;
          break;
        case r'subject':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.subject = valueDes;
          break;
        case r'updated_at':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.updatedAt = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ProgressPerformanceScore deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ProgressPerformanceScoreBuilder();
    final serializedList = (serialized as Iterable<Object?>).toList();
    final unhandled = <Object?>[];
    _deserializeProperties(
      serializers,
      serialized,
      specifiedType: specifiedType,
      serializedList: serializedList,
      unhandled: unhandled,
      result: result,
    );
    return result.build();
  }
}

