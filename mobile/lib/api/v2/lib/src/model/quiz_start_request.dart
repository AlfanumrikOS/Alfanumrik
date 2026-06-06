//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'quiz_start_request.g.dart';

/// QuizStartRequest
///
/// Properties:
/// * [questionIds] 
/// * [studentId] 
@BuiltValue()
abstract class QuizStartRequest implements Built<QuizStartRequest, QuizStartRequestBuilder> {
  @BuiltValueField(wireName: r'questionIds')
  BuiltList<String> get questionIds;

  @BuiltValueField(wireName: r'studentId')
  String get studentId;

  QuizStartRequest._();

  factory QuizStartRequest([void updates(QuizStartRequestBuilder b)]) = _$QuizStartRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(QuizStartRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<QuizStartRequest> get serializer => _$QuizStartRequestSerializer();
}

class _$QuizStartRequestSerializer implements PrimitiveSerializer<QuizStartRequest> {
  @override
  final Iterable<Type> types = const [QuizStartRequest, _$QuizStartRequest];

  @override
  final String wireName = r'QuizStartRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    QuizStartRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'questionIds';
    yield serializers.serialize(
      object.questionIds,
      specifiedType: const FullType(BuiltList, [FullType(String)]),
    );
    yield r'studentId';
    yield serializers.serialize(
      object.studentId,
      specifiedType: const FullType(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    QuizStartRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required QuizStartRequestBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'questionIds':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.questionIds.replace(valueDes);
          break;
        case r'studentId':
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
  QuizStartRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = QuizStartRequestBuilder();
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

