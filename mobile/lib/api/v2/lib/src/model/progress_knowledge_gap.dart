//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'progress_knowledge_gap.g.dart';

/// ProgressKnowledgeGap
///
/// Properties:
/// * [masteryProbability] 
/// * [severity] 
/// * [subject] 
/// * [topic] 
@BuiltValue()
abstract class ProgressKnowledgeGap implements Built<ProgressKnowledgeGap, ProgressKnowledgeGapBuilder> {
  @BuiltValueField(wireName: r'mastery_probability')
  num? get masteryProbability;

  @BuiltValueField(wireName: r'severity')
  String? get severity;

  @BuiltValueField(wireName: r'subject')
  String? get subject;

  @BuiltValueField(wireName: r'topic')
  String? get topic;

  ProgressKnowledgeGap._();

  factory ProgressKnowledgeGap([void updates(ProgressKnowledgeGapBuilder b)]) = _$ProgressKnowledgeGap;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ProgressKnowledgeGapBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ProgressKnowledgeGap> get serializer => _$ProgressKnowledgeGapSerializer();
}

class _$ProgressKnowledgeGapSerializer implements PrimitiveSerializer<ProgressKnowledgeGap> {
  @override
  final Iterable<Type> types = const [ProgressKnowledgeGap, _$ProgressKnowledgeGap];

  @override
  final String wireName = r'ProgressKnowledgeGap';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ProgressKnowledgeGap object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'mastery_probability';
    yield object.masteryProbability == null ? null : serializers.serialize(
      object.masteryProbability,
      specifiedType: const FullType.nullable(num),
    );
    yield r'severity';
    yield object.severity == null ? null : serializers.serialize(
      object.severity,
      specifiedType: const FullType.nullable(String),
    );
    yield r'subject';
    yield object.subject == null ? null : serializers.serialize(
      object.subject,
      specifiedType: const FullType.nullable(String),
    );
    yield r'topic';
    yield object.topic == null ? null : serializers.serialize(
      object.topic,
      specifiedType: const FullType.nullable(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    ProgressKnowledgeGap object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ProgressKnowledgeGapBuilder result,
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
        case r'severity':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.severity = valueDes;
          break;
        case r'subject':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.subject = valueDes;
          break;
        case r'topic':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.topic = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ProgressKnowledgeGap deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ProgressKnowledgeGapBuilder();
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

