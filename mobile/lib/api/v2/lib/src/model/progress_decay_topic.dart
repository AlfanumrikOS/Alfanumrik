//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'progress_decay_topic.g.dart';

/// ProgressDecayTopic
///
/// Properties:
/// * [masteryProbability] 
/// * [nextReviewAt] 
/// * [subject] 
/// * [topicId] 
@BuiltValue()
abstract class ProgressDecayTopic implements Built<ProgressDecayTopic, ProgressDecayTopicBuilder> {
  @BuiltValueField(wireName: r'mastery_probability')
  num? get masteryProbability;

  @BuiltValueField(wireName: r'next_review_at')
  String? get nextReviewAt;

  @BuiltValueField(wireName: r'subject')
  String? get subject;

  @BuiltValueField(wireName: r'topic_id')
  String? get topicId;

  ProgressDecayTopic._();

  factory ProgressDecayTopic([void updates(ProgressDecayTopicBuilder b)]) = _$ProgressDecayTopic;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ProgressDecayTopicBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ProgressDecayTopic> get serializer => _$ProgressDecayTopicSerializer();
}

class _$ProgressDecayTopicSerializer implements PrimitiveSerializer<ProgressDecayTopic> {
  @override
  final Iterable<Type> types = const [ProgressDecayTopic, _$ProgressDecayTopic];

  @override
  final String wireName = r'ProgressDecayTopic';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ProgressDecayTopic object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'mastery_probability';
    yield object.masteryProbability == null ? null : serializers.serialize(
      object.masteryProbability,
      specifiedType: const FullType.nullable(num),
    );
    yield r'next_review_at';
    yield object.nextReviewAt == null ? null : serializers.serialize(
      object.nextReviewAt,
      specifiedType: const FullType.nullable(String),
    );
    yield r'subject';
    yield object.subject == null ? null : serializers.serialize(
      object.subject,
      specifiedType: const FullType.nullable(String),
    );
    yield r'topic_id';
    yield object.topicId == null ? null : serializers.serialize(
      object.topicId,
      specifiedType: const FullType.nullable(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    ProgressDecayTopic object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ProgressDecayTopicBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'mastery_probability':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(num),
          ) as num?;
          if (valueDes == null) continue;
          result.masteryProbability = valueDes;
          break;
        case r'next_review_at':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.nextReviewAt = valueDes;
          break;
        case r'subject':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.subject = valueDes;
          break;
        case r'topic_id':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.topicId = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ProgressDecayTopic deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ProgressDecayTopicBuilder();
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

