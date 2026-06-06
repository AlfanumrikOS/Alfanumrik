//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_submit_response_item.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'quiz_submit_request.g.dart';

/// QuizSubmitRequest
///
/// Properties:
/// * [chapter] 
/// * [grade] 
/// * [responses] 
/// * [sessionId] 
/// * [studentId] 
/// * [subject] 
/// * [topic] 
/// * [totalTimeSeconds] 
@BuiltValue()
abstract class QuizSubmitRequest implements Built<QuizSubmitRequest, QuizSubmitRequestBuilder> {
  @BuiltValueField(wireName: r'chapter')
  int? get chapter;

  @BuiltValueField(wireName: r'grade')
  String? get grade;

  @BuiltValueField(wireName: r'responses')
  BuiltList<QuizSubmitResponseItem> get responses;

  @BuiltValueField(wireName: r'sessionId')
  String get sessionId;

  @BuiltValueField(wireName: r'studentId')
  String get studentId;

  @BuiltValueField(wireName: r'subject')
  String? get subject;

  @BuiltValueField(wireName: r'topic')
  String? get topic;

  @BuiltValueField(wireName: r'totalTimeSeconds')
  int get totalTimeSeconds;

  QuizSubmitRequest._();

  factory QuizSubmitRequest([void updates(QuizSubmitRequestBuilder b)]) = _$QuizSubmitRequest;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(QuizSubmitRequestBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<QuizSubmitRequest> get serializer => _$QuizSubmitRequestSerializer();
}

class _$QuizSubmitRequestSerializer implements PrimitiveSerializer<QuizSubmitRequest> {
  @override
  final Iterable<Type> types = const [QuizSubmitRequest, _$QuizSubmitRequest];

  @override
  final String wireName = r'QuizSubmitRequest';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    QuizSubmitRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.chapter != null) {
      yield r'chapter';
      yield serializers.serialize(
        object.chapter,
        specifiedType: const FullType.nullable(int),
      );
    }
    if (object.grade != null) {
      yield r'grade';
      yield serializers.serialize(
        object.grade,
        specifiedType: const FullType(String),
      );
    }
    yield r'responses';
    yield serializers.serialize(
      object.responses,
      specifiedType: const FullType(BuiltList, [FullType(QuizSubmitResponseItem)]),
    );
    yield r'sessionId';
    yield serializers.serialize(
      object.sessionId,
      specifiedType: const FullType(String),
    );
    yield r'studentId';
    yield serializers.serialize(
      object.studentId,
      specifiedType: const FullType(String),
    );
    if (object.subject != null) {
      yield r'subject';
      yield serializers.serialize(
        object.subject,
        specifiedType: const FullType(String),
      );
    }
    if (object.topic != null) {
      yield r'topic';
      yield serializers.serialize(
        object.topic,
        specifiedType: const FullType.nullable(String),
      );
    }
    yield r'totalTimeSeconds';
    yield serializers.serialize(
      object.totalTimeSeconds,
      specifiedType: const FullType(int),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    QuizSubmitRequest object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required QuizSubmitRequestBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'chapter':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(int),
          ) as int?;
          if (valueDes == null) continue;
          result.chapter = valueDes;
          break;
        case r'grade':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.grade = valueDes;
          break;
        case r'responses':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(QuizSubmitResponseItem)]),
          ) as BuiltList<QuizSubmitResponseItem>;
          result.responses.replace(valueDes);
          break;
        case r'sessionId':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.sessionId = valueDes;
          break;
        case r'studentId':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.studentId = valueDes;
          break;
        case r'subject':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.subject = valueDes;
          break;
        case r'topic':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.topic = valueDes;
          break;
        case r'totalTimeSeconds':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.totalTimeSeconds = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  QuizSubmitRequest deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = QuizSubmitRequestBuilder();
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

