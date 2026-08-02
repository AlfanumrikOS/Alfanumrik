//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'placement_answer_request.g.dart';

/// PlacementAnswerRequest
///
/// Properties:
/// * [idempotencyKey] 
/// * [occurredAt] 
/// * [optionId] 
/// * [questionId] 
/// * [sessionId] 
/// * [topicId] 
/// * [unseen] 
@BuiltValue()
abstract class PlacementAnswerRequest implements Built<PlacementAnswerRequest, PlacementAnswerRequestBuilder> {
  @BuiltValueField(wireName: r'idempotencyKey')
  String get idempotencyKey;

  @BuiltValueField(wireName: r'occurredAt')
  DateTime get occurredAt;

  @BuiltValueField(wireName: r'optionId')
  String? get optionId;

  @BuiltValueField(wireName: r'questionId')
  String get questionId;

  @BuiltValueField(wireName: r'sessionId')
  String get sessionId;

  @BuiltValueField(wireName: r'topicId')
  String? get topicId;

  @BuiltValueField(wireName: r'unseen')
  bool get unseen;

  PlacementAnswerRequest._();

  factory PlacementAnswerRequest([void updates(PlacementAnswerRequestBuilder b)]) = _$PlacementAnswerRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(PlacementAnswerRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<PlacementAnswerRequest> get serializer => _$PlacementAnswerRequestSerializer();
}

class _$PlacementAnswerRequestSerializer implements PrimitiveSerializer<PlacementAnswerRequest> {
  @override
  final Iterable<Type> types = const [PlacementAnswerRequest, _$PlacementAnswerRequest];

  @override
  final String wireName = r'PlacementAnswerRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    PlacementAnswerRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'idempotencyKey';
    yield serializers.serialize(
      object.idempotencyKey,
      specifiedType: const FullType(String),
    );
    yield r'occurredAt';
    yield serializers.serialize(
      object.occurredAt,
      specifiedType: const FullType(DateTime),
    );
    yield r'optionId';
    yield object.optionId == null ? null : serializers.serialize(
      object.optionId,
      specifiedType: const FullType.nullable(String),
    );
    yield r'questionId';
    yield serializers.serialize(
      object.questionId,
      specifiedType: const FullType(String),
    );
    yield r'sessionId';
    yield serializers.serialize(
      object.sessionId,
      specifiedType: const FullType(String),
    );
    yield r'topicId';
    yield object.topicId == null ? null : serializers.serialize(
      object.topicId,
      specifiedType: const FullType.nullable(String),
    );
    yield r'unseen';
    yield serializers.serialize(
      object.unseen,
      specifiedType: const FullType(bool),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    PlacementAnswerRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required PlacementAnswerRequestBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'idempotencyKey':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.idempotencyKey = valueDes;
          break;
        case r'occurredAt':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(DateTime),
          ) as DateTime;
          result.occurredAt = valueDes;
          break;
        case r'optionId':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.optionId = valueDes;
          break;
        case r'questionId':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.questionId = valueDes;
          break;
        case r'sessionId':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.sessionId = valueDes;
          break;
        case r'topicId':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.topicId = valueDes;
          break;
        case r'unseen':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(bool),
          ) as bool;
          result.unseen = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  PlacementAnswerRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = PlacementAnswerRequestBuilder();
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

