//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'curriculum_topic.g.dart';

/// CurriculumTopic
///
/// Properties:
/// * [id] 
/// * [title] 
/// * [titleHi] 
@BuiltValue()
abstract class CurriculumTopic implements Built<CurriculumTopic, CurriculumTopicBuilder> {
  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'title')
  String? get title;

  @BuiltValueField(wireName: r'title_hi')
  String? get titleHi;

  CurriculumTopic._();

  factory CurriculumTopic([void updates(CurriculumTopicBuilder b)]) = _$CurriculumTopic;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(CurriculumTopicBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<CurriculumTopic> get serializer => _$CurriculumTopicSerializer();
}

class _$CurriculumTopicSerializer implements PrimitiveSerializer<CurriculumTopic> {
  @override
  final Iterable<Type> types = const [CurriculumTopic, _$CurriculumTopic];

  @override
  final String wireName = r'CurriculumTopic';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    CurriculumTopic object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'id';
    yield serializers.serialize(
      object.id,
      specifiedType: const FullType(String),
    );
    yield r'title';
    yield object.title == null ? null : serializers.serialize(
      object.title,
      specifiedType: const FullType.nullable(String),
    );
    yield r'title_hi';
    yield object.titleHi == null ? null : serializers.serialize(
      object.titleHi,
      specifiedType: const FullType.nullable(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    CurriculumTopic object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required CurriculumTopicBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'id':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.id = valueDes;
          break;
        case r'title':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.title = valueDes;
          break;
        case r'title_hi':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.titleHi = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  CurriculumTopic deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = CurriculumTopicBuilder();
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

