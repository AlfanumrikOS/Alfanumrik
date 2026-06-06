//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:alfanumrik_api_v2/src/model/curriculum_subject.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'curriculum_response.g.dart';

/// CurriculumResponse
///
/// Properties:
/// * [grade] 
/// * [schemaVersion] 
/// * [subjects] 
@BuiltValue()
abstract class CurriculumResponse implements Built<CurriculumResponse, CurriculumResponseBuilder> {
  @BuiltValueField(wireName: r'grade')
  String? get grade;

  @BuiltValueField(wireName: r'schemaVersion')
  CurriculumResponseSchemaVersionEnum get schemaVersion;
  // enum schemaVersionEnum {  1,  };

  @BuiltValueField(wireName: r'subjects')
  BuiltList<CurriculumSubject> get subjects;

  CurriculumResponse._();

  factory CurriculumResponse([void updates(CurriculumResponseBuilder b)]) = _$CurriculumResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(CurriculumResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<CurriculumResponse> get serializer => _$CurriculumResponseSerializer();
}

class _$CurriculumResponseSerializer implements PrimitiveSerializer<CurriculumResponse> {
  @override
  final Iterable<Type> types = const [CurriculumResponse, _$CurriculumResponse];

  @override
  final String wireName = r'CurriculumResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    CurriculumResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'grade';
    yield object.grade == null ? null : serializers.serialize(
      object.grade,
      specifiedType: const FullType.nullable(String),
    );
    yield r'schemaVersion';
    yield serializers.serialize(
      object.schemaVersion,
      specifiedType: const FullType(CurriculumResponseSchemaVersionEnum),
    );
    yield r'subjects';
    yield serializers.serialize(
      object.subjects,
      specifiedType: const FullType(BuiltList, [FullType(CurriculumSubject)]),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    CurriculumResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required CurriculumResponseBuilder result,
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
        case r'schemaVersion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(CurriculumResponseSchemaVersionEnum),
          ) as CurriculumResponseSchemaVersionEnum;
          result.schemaVersion = valueDes;
          break;
        case r'subjects':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(CurriculumSubject)]),
          ) as BuiltList<CurriculumSubject>;
          result.subjects.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  CurriculumResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = CurriculumResponseBuilder();
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

class CurriculumResponseSchemaVersionEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'1')
  static const CurriculumResponseSchemaVersionEnum n1 = _$curriculumResponseSchemaVersionEnum_n1;

  static Serializer<CurriculumResponseSchemaVersionEnum> get serializer => _$curriculumResponseSchemaVersionEnumSerializer;

  const CurriculumResponseSchemaVersionEnum._(String name): super(name);

  static BuiltSet<CurriculumResponseSchemaVersionEnum> get values => _$curriculumResponseSchemaVersionEnumValues;
  static CurriculumResponseSchemaVersionEnum valueOf(String name) => _$curriculumResponseSchemaVersionEnumValueOf(name);
}

