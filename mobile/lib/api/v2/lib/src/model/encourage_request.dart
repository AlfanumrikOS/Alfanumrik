//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'encourage_request.g.dart';

/// EncourageRequest
///
/// Properties:
/// * [messageKey] 
/// * [studentId] 
@BuiltValue()
abstract class EncourageRequest implements Built<EncourageRequest, EncourageRequestBuilder> {
  @BuiltValueField(wireName: r'message_key')
  String? get messageKey;

  @BuiltValueField(wireName: r'student_id')
  String get studentId;

  EncourageRequest._();

  factory EncourageRequest([void updates(EncourageRequestBuilder b)]) = _$EncourageRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(EncourageRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<EncourageRequest> get serializer => _$EncourageRequestSerializer();
}

class _$EncourageRequestSerializer implements PrimitiveSerializer<EncourageRequest> {
  @override
  final Iterable<Type> types = const [EncourageRequest, _$EncourageRequest];

  @override
  final String wireName = r'EncourageRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    EncourageRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.messageKey != null) {
      yield r'message_key';
      yield serializers.serialize(
        object.messageKey,
        specifiedType: const FullType(String),
      );
    }
    yield r'student_id';
    yield serializers.serialize(
      object.studentId,
      specifiedType: const FullType(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    EncourageRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required EncourageRequestBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'message_key':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.messageKey = valueDes;
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
  EncourageRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = EncourageRequestBuilder();
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

