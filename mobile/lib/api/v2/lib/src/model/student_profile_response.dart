//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'student_profile_response.g.dart';

/// StudentProfileResponse
///
/// Properties:
/// * [board] 
/// * [grade] 
/// * [language] 
/// * [name] 
/// * [plan] 
/// * [schemaVersion] 
/// * [stream] 
/// * [studentId] 
@BuiltValue()
abstract class StudentProfileResponse implements Built<StudentProfileResponse, StudentProfileResponseBuilder> {
  @BuiltValueField(wireName: r'board')
  String? get board;

  @BuiltValueField(wireName: r'grade')
  String? get grade;

  @BuiltValueField(wireName: r'language')
  String? get language;

  @BuiltValueField(wireName: r'name')
  String? get name;

  @BuiltValueField(wireName: r'plan')
  String? get plan;

  @BuiltValueField(wireName: r'schemaVersion')
  StudentProfileResponseSchemaVersionEnum get schemaVersion;
  // enum schemaVersionEnum {  1,  };

  @BuiltValueField(wireName: r'stream')
  String? get stream;

  @BuiltValueField(wireName: r'student_id')
  String get studentId;

  StudentProfileResponse._();

  factory StudentProfileResponse([void updates(StudentProfileResponseBuilder b)]) = _$StudentProfileResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(StudentProfileResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<StudentProfileResponse> get serializer => _$StudentProfileResponseSerializer();
}

class _$StudentProfileResponseSerializer implements PrimitiveSerializer<StudentProfileResponse> {
  @override
  final Iterable<Type> types = const [StudentProfileResponse, _$StudentProfileResponse];

  @override
  final String wireName = r'StudentProfileResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    StudentProfileResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'board';
    yield object.board == null ? null : serializers.serialize(
      object.board,
      specifiedType: const FullType.nullable(String),
    );
    yield r'grade';
    yield object.grade == null ? null : serializers.serialize(
      object.grade,
      specifiedType: const FullType.nullable(String),
    );
    yield r'language';
    yield object.language == null ? null : serializers.serialize(
      object.language,
      specifiedType: const FullType.nullable(String),
    );
    yield r'name';
    yield object.name == null ? null : serializers.serialize(
      object.name,
      specifiedType: const FullType.nullable(String),
    );
    yield r'plan';
    yield object.plan == null ? null : serializers.serialize(
      object.plan,
      specifiedType: const FullType.nullable(String),
    );
    yield r'schemaVersion';
    yield serializers.serialize(
      object.schemaVersion,
      specifiedType: const FullType(StudentProfileResponseSchemaVersionEnum),
    );
    yield r'stream';
    yield object.stream == null ? null : serializers.serialize(
      object.stream,
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
    StudentProfileResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required StudentProfileResponseBuilder result,
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
        case r'language':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.language = valueDes;
          break;
        case r'name':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.name = valueDes;
          break;
        case r'plan':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.plan = valueDes;
          break;
        case r'schemaVersion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(StudentProfileResponseSchemaVersionEnum),
          ) as StudentProfileResponseSchemaVersionEnum;
          result.schemaVersion = valueDes;
          break;
        case r'stream':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.stream = valueDes;
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
  StudentProfileResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = StudentProfileResponseBuilder();
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

class StudentProfileResponseSchemaVersionEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'1')
  static const StudentProfileResponseSchemaVersionEnum n1 = _$studentProfileResponseSchemaVersionEnum_n1;

  static Serializer<StudentProfileResponseSchemaVersionEnum> get serializer => _$studentProfileResponseSchemaVersionEnumSerializer;

  const StudentProfileResponseSchemaVersionEnum._(String name): super(name);

  static BuiltSet<StudentProfileResponseSchemaVersionEnum> get values => _$studentProfileResponseSchemaVersionEnumValues;
  static StudentProfileResponseSchemaVersionEnum valueOf(String name) => _$studentProfileResponseSchemaVersionEnumValueOf(name);
}

