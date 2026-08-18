//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/json_object.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'error_response.g.dart';

/// ErrorResponse
///
/// Properties:
/// * [code] 
/// * [details] - OPTIONAL machine-readable, code-specific detail payload. For code `subject_not_allowed` (403) and `UNKNOWN_SUBJECT` (400) the shape is `SubjectNotAllowedDetails` ({ subject, reason, allowed }). Absent on every other error response.
/// * [error] 
/// * [retryable] 
/// * [success] 
@BuiltValue()
abstract class ErrorResponse implements Built<ErrorResponse, ErrorResponseBuilder> {
  @BuiltValueField(wireName: r'code')
  String? get code;

  /// OPTIONAL machine-readable, code-specific detail payload. For code `subject_not_allowed` (403) and `UNKNOWN_SUBJECT` (400) the shape is `SubjectNotAllowedDetails` ({ subject, reason, allowed }). Absent on every other error response.
  @BuiltValueField(wireName: r'details')
  BuiltMap<String, JsonObject?>? get details;

  @BuiltValueField(wireName: r'error')
  String get error;

  @BuiltValueField(wireName: r'retryable')
  bool? get retryable;

  @BuiltValueField(wireName: r'success')
  ErrorResponseSuccessEnum get success;
  // enum successEnum {  false,  };

  ErrorResponse._();

  factory ErrorResponse([void updates(ErrorResponseBuilder b)]) = _$ErrorResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ErrorResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ErrorResponse> get serializer => _$ErrorResponseSerializer();
}

class _$ErrorResponseSerializer implements PrimitiveSerializer<ErrorResponse> {
  @override
  final Iterable<Type> types = const [ErrorResponse, _$ErrorResponse];

  @override
  final String wireName = r'ErrorResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ErrorResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.code != null) {
      yield r'code';
      yield serializers.serialize(
        object.code,
        specifiedType: const FullType(String),
      );
    }
    if (object.details != null) {
      yield r'details';
      yield serializers.serialize(
        object.details,
        specifiedType: const FullType(BuiltMap, [FullType(String), FullType.nullable(JsonObject)]),
      );
    }
    yield r'error';
    yield serializers.serialize(
      object.error,
      specifiedType: const FullType(String),
    );
    if (object.retryable != null) {
      yield r'retryable';
      yield serializers.serialize(
        object.retryable,
        specifiedType: const FullType(bool),
      );
    }
    yield r'success';
    yield serializers.serialize(
      object.success,
      specifiedType: const FullType(ErrorResponseSuccessEnum),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    ErrorResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ErrorResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'code':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.code = valueDes;
          break;
        case r'details':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltMap, [FullType(String), FullType.nullable(JsonObject)]),
          ) as BuiltMap<String, JsonObject?>;
          result.details.replace(valueDes);
          break;
        case r'error':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.error = valueDes;
          break;
        case r'retryable':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(bool),
          ) as bool;
          result.retryable = valueDes;
          break;
        case r'success':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ErrorResponseSuccessEnum),
          ) as ErrorResponseSuccessEnum;
          result.success = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ErrorResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ErrorResponseBuilder();
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

class ErrorResponseSuccessEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'false')
  static const ErrorResponseSuccessEnum false_ = _$errorResponseSuccessEnum_false_;

  static Serializer<ErrorResponseSuccessEnum> get serializer => _$errorResponseSuccessEnumSerializer;

  const ErrorResponseSuccessEnum._(String name): super(name);

  static BuiltSet<ErrorResponseSuccessEnum> get values => _$errorResponseSuccessEnumValues;
  static ErrorResponseSuccessEnum valueOf(String name) => _$errorResponseSuccessEnumValueOf(name);
}

