//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'parent_glance_child.g.dart';

/// ParentGlanceChild
///
/// Properties:
/// * [grade] 
/// * [name] 
/// * [studentId] 
@BuiltValue()
abstract class ParentGlanceChild implements Built<ParentGlanceChild, ParentGlanceChildBuilder> {
  @BuiltValueField(wireName: r'grade')
  String? get grade;

  @BuiltValueField(wireName: r'name')
  String? get name;

  @BuiltValueField(wireName: r'student_id')
  String get studentId;

  ParentGlanceChild._();

  factory ParentGlanceChild([void updates(ParentGlanceChildBuilder b)]) = _$ParentGlanceChild;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ParentGlanceChildBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ParentGlanceChild> get serializer => _$ParentGlanceChildSerializer();
}

class _$ParentGlanceChildSerializer implements PrimitiveSerializer<ParentGlanceChild> {
  @override
  final Iterable<Type> types = const [ParentGlanceChild, _$ParentGlanceChild];

  @override
  final String wireName = r'ParentGlanceChild';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ParentGlanceChild object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'grade';
    yield object.grade == null ? null : serializers.serialize(
      object.grade,
      specifiedType: const FullType.nullable(String),
    );
    yield r'name';
    yield object.name == null ? null : serializers.serialize(
      object.name,
      specifiedType: const FullType.nullable(String),
    );
    yield r'student_id';
    yield serializers.serialize(
      object.studentId,
      specifiedType: const FullType(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    ParentGlanceChild object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ParentGlanceChildBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'grade':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.grade = valueDes;
          break;
        case r'name':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.name = valueDes;
          break;
        case r'student_id':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.studentId = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ParentGlanceChild deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ParentGlanceChildBuilder();
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

