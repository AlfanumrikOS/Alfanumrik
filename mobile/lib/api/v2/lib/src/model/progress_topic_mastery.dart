//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'progress_topic_mastery.g.dart';

/// ProgressTopicMastery
///
/// Properties:
/// * [consecutiveCorrect] 
/// * [masteryProbability] 
/// * [topicId] 
/// * [updatedAt] 
@BuiltValue()
abstract class ProgressTopicMastery implements Built<ProgressTopicMastery, ProgressTopicMasteryBuilder> {
  @BuiltValueField(wireName: r'consecutive_correct')
  int? get consecutiveCorrect;

  @BuiltValueField(wireName: r'mastery_probability')
  num get masteryProbability;

  @BuiltValueField(wireName: r'topic_id')
  String? get topicId;

  @BuiltValueField(wireName: r'updated_at')
  String? get updatedAt;

  ProgressTopicMastery._();

  factory ProgressTopicMastery([void updates(ProgressTopicMasteryBuilder b)]) = _$ProgressTopicMastery;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ProgressTopicMasteryBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ProgressTopicMastery> get serializer => _$ProgressTopicMasterySerializer();
}

class _$ProgressTopicMasterySerializer implements PrimitiveSerializer<ProgressTopicMastery> {
  @override
  final Iterable<Type> types = const [ProgressTopicMastery, _$ProgressTopicMastery];

  @override
  final String wireName = r'ProgressTopicMastery';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ProgressTopicMastery object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'consecutive_correct';
    yield object.consecutiveCorrect == null ? null : serializers.serialize(
      object.consecutiveCorrect,
      specifiedType: const FullType.nullable(int),
    );
    yield r'mastery_probability';
    yield serializers.serialize(
      object.masteryProbability,
      specifiedType: const FullType(num),
    );
    yield r'topic_id';
    yield object.topicId == null ? null : serializers.serialize(
      object.topicId,
      specifiedType: const FullType.nullable(String),
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
    ProgressTopicMastery object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ProgressTopicMasteryBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'consecutive_correct':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(int),
          ) as int?;
          if (valueDes == null) continue;
          result.consecutiveCorrect = valueDes;
          break;
        case r'mastery_probability':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(num),
          ) as num;
          result.masteryProbability = valueDes;
          break;
        case r'topic_id':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.topicId = valueDes;
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
  ProgressTopicMastery deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ProgressTopicMasteryBuilder();
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

