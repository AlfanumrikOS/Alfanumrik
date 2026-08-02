//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:alfanumrik_api_v2/src/model/exam_schedule_entry.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'exam_schedule_response.g.dart';

/// ExamScheduleResponse
///
/// Properties:
/// * [entries] 
/// * [schemaVersion] 
@BuiltValue()
abstract class ExamScheduleResponse implements Built<ExamScheduleResponse, ExamScheduleResponseBuilder> {
  @BuiltValueField(wireName: r'entries')
  BuiltList<ExamScheduleEntry> get entries;

  @BuiltValueField(wireName: r'schemaVersion')
  ExamScheduleResponseSchemaVersionEnum get schemaVersion;
  // enum schemaVersionEnum {  1,  };

  ExamScheduleResponse._();

  factory ExamScheduleResponse([void updates(ExamScheduleResponseBuilder b)]) = _$ExamScheduleResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ExamScheduleResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ExamScheduleResponse> get serializer => _$ExamScheduleResponseSerializer();
}

class _$ExamScheduleResponseSerializer implements PrimitiveSerializer<ExamScheduleResponse> {
  @override
  final Iterable<Type> types = const [ExamScheduleResponse, _$ExamScheduleResponse];

  @override
  final String wireName = r'ExamScheduleResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ExamScheduleResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'entries';
    yield serializers.serialize(
      object.entries,
      specifiedType: const FullType(BuiltList, [FullType(ExamScheduleEntry)]),
    );
    yield r'schemaVersion';
    yield serializers.serialize(
      object.schemaVersion,
      specifiedType: const FullType(ExamScheduleResponseSchemaVersionEnum),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    ExamScheduleResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ExamScheduleResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'entries':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ExamScheduleEntry)]),
          ) as BuiltList<ExamScheduleEntry>;
          result.entries.replace(valueDes);
          break;
        case r'schemaVersion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ExamScheduleResponseSchemaVersionEnum),
          ) as ExamScheduleResponseSchemaVersionEnum;
          result.schemaVersion = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ExamScheduleResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ExamScheduleResponseBuilder();
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

class ExamScheduleResponseSchemaVersionEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'1')
  static const ExamScheduleResponseSchemaVersionEnum n1 = _$examScheduleResponseSchemaVersionEnum_n1;

  static Serializer<ExamScheduleResponseSchemaVersionEnum> get serializer => _$examScheduleResponseSchemaVersionEnumSerializer;

  const ExamScheduleResponseSchemaVersionEnum._(String name): super(name);

  static BuiltSet<ExamScheduleResponseSchemaVersionEnum> get values => _$examScheduleResponseSchemaVersionEnumValues;
  static ExamScheduleResponseSchemaVersionEnum valueOf(String name) => _$examScheduleResponseSchemaVersionEnumValueOf(name);
}

