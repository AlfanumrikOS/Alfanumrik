//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:alfanumrik_api_v2/src/model/placement_question.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'placement_response.g.dart';

/// PlacementResponse
///
/// Properties:
/// * [grade] 
/// * [questions] 
/// * [schemaVersion] 
/// * [subject] 
@BuiltValue()
abstract class PlacementResponse implements Built<PlacementResponse, PlacementResponseBuilder> {
  @BuiltValueField(wireName: r'grade')
  String get grade;

  @BuiltValueField(wireName: r'questions')
  BuiltList<PlacementQuestion> get questions;

  @BuiltValueField(wireName: r'schemaVersion')
  PlacementResponseSchemaVersionEnum get schemaVersion;
  // enum schemaVersionEnum {  1,  };

  @BuiltValueField(wireName: r'subject')
  String get subject;

  PlacementResponse._();

  factory PlacementResponse([void updates(PlacementResponseBuilder b)]) = _$PlacementResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(PlacementResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<PlacementResponse> get serializer => _$PlacementResponseSerializer();
}

class _$PlacementResponseSerializer implements PrimitiveSerializer<PlacementResponse> {
  @override
  final Iterable<Type> types = const [PlacementResponse, _$PlacementResponse];

  @override
  final String wireName = r'PlacementResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    PlacementResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'grade';
    yield serializers.serialize(
      object.grade,
      specifiedType: const FullType(String),
    );
    yield r'questions';
    yield serializers.serialize(
      object.questions,
      specifiedType: const FullType(BuiltList, [FullType(PlacementQuestion)]),
    );
    yield r'schemaVersion';
    yield serializers.serialize(
      object.schemaVersion,
      specifiedType: const FullType(PlacementResponseSchemaVersionEnum),
    );
    yield r'subject';
    yield serializers.serialize(
      object.subject,
      specifiedType: const FullType(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    PlacementResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required PlacementResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'grade':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.grade = valueDes;
          break;
        case r'questions':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(PlacementQuestion)]),
          ) as BuiltList<PlacementQuestion>;
          result.questions.replace(valueDes);
          break;
        case r'schemaVersion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(PlacementResponseSchemaVersionEnum),
          ) as PlacementResponseSchemaVersionEnum;
          result.schemaVersion = valueDes;
          break;
        case r'subject':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.subject = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  PlacementResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = PlacementResponseBuilder();
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

class PlacementResponseSchemaVersionEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'1')
  static const PlacementResponseSchemaVersionEnum n1 = _$placementResponseSchemaVersionEnum_n1;

  static Serializer<PlacementResponseSchemaVersionEnum> get serializer => _$placementResponseSchemaVersionEnumSerializer;

  const PlacementResponseSchemaVersionEnum._(String name): super(name);

  static BuiltSet<PlacementResponseSchemaVersionEnum> get values => _$placementResponseSchemaVersionEnumValues;
  static PlacementResponseSchemaVersionEnum valueOf(String name) => _$placementResponseSchemaVersionEnumValueOf(name);
}

