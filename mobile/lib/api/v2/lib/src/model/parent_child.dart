//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'parent_child.g.dart';

/// ParentChild
///
/// Properties:
/// * [board] 
/// * [grade] 
/// * [lastActiveAt] 
/// * [name] 
/// * [studentId] 
@BuiltValue()
abstract class ParentChild implements Built<ParentChild, ParentChildBuilder> {
  @BuiltValueField(wireName: r'board')
  String? get board;

  @BuiltValueField(wireName: r'grade')
  String? get grade;

  @BuiltValueField(wireName: r'last_active_at')
  String? get lastActiveAt;

  @BuiltValueField(wireName: r'name')
  String? get name;

  @BuiltValueField(wireName: r'student_id')
  String get studentId;

  ParentChild._();

  factory ParentChild([void updates(ParentChildBuilder b)]) = _$ParentChild;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ParentChildBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ParentChild> get serializer => _$ParentChildSerializer();
}

class _$ParentChildSerializer implements PrimitiveSerializer<ParentChild> {
  @override
  final Iterable<Type> types = const [ParentChild, _$ParentChild];

  @override
  final String wireName = r'ParentChild';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ParentChild object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.board != null) {
      yield r'board';
      yield serializers.serialize(
        object.board,
        specifiedType: const FullType.nullable(String),
      );
    }
    yield r'grade';
    yield object.grade == null ? null : serializers.serialize(
      object.grade,
      specifiedType: const FullType.nullable(String),
    );
    if (object.lastActiveAt != null) {
      yield r'last_active_at';
      yield serializers.serialize(
        object.lastActiveAt,
        specifiedType: const FullType.nullable(String),
      );
    }
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
    ParentChild object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ParentChildBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'board':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.board = valueDes;
          break;
        case r'grade':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.grade = valueDes;
          break;
        case r'last_active_at':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.lastActiveAt = valueDes;
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
  ParentChild deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ParentChildBuilder();
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

