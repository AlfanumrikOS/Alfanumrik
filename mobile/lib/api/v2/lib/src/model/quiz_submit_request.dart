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
/// * [attemptMode] 
/// * [capturedAt] 
/// * [chapter] 
/// * [clientCapturedTotalSeconds] 
/// * [drainAttempt] 
/// * [grade] 
/// * [responses] 
/// * [sessionId] 
/// * [shuffleMapsClientGradedAgainst] 
/// * [studentId] 
/// * [subject] 
/// * [topic] 
/// * [totalTimeSeconds] 
@BuiltValue()
abstract class QuizSubmitRequest implements Built<QuizSubmitRequest, QuizSubmitRequestBuilder> {
  @BuiltValueField(wireName: r'attemptMode')
  QuizSubmitRequestAttemptModeEnum? get attemptMode;
  // enum attemptModeEnum {  online,  offline_replay,  };

  @BuiltValueField(wireName: r'capturedAt')
  DateTime? get capturedAt;

  @BuiltValueField(wireName: r'chapter')
  int? get chapter;

  @BuiltValueField(wireName: r'clientCapturedTotalSeconds')
  int? get clientCapturedTotalSeconds;

  @BuiltValueField(wireName: r'drainAttempt')
  int? get drainAttempt;

  @BuiltValueField(wireName: r'grade')
  String? get grade;

  @BuiltValueField(wireName: r'responses')
  BuiltList<QuizSubmitResponseItem> get responses;

  @BuiltValueField(wireName: r'sessionId')
  String get sessionId;

  @BuiltValueField(wireName: r'shuffleMapsClientGradedAgainst')
  BuiltMap<String, BuiltList<int>>? get shuffleMapsClientGradedAgainst;

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
  static void _defaults(QuizSubmitRequestBuilder b) => b
      ..attemptMode = const QuizSubmitRequestAttemptModeEnum._('online');

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
    if (object.attemptMode != null) {
      yield r'attemptMode';
      yield serializers.serialize(
        object.attemptMode,
        specifiedType: const FullType(QuizSubmitRequestAttemptModeEnum),
      );
    }
    if (object.capturedAt != null) {
      yield r'capturedAt';
      yield serializers.serialize(
        object.capturedAt,
        specifiedType: const FullType(DateTime),
      );
    }
    if (object.chapter != null) {
      yield r'chapter';
      yield serializers.serialize(
        object.chapter,
        specifiedType: const FullType.nullable(int),
      );
    }
    if (object.clientCapturedTotalSeconds != null) {
      yield r'clientCapturedTotalSeconds';
      yield serializers.serialize(
        object.clientCapturedTotalSeconds,
        specifiedType: const FullType(int),
      );
    }
    if (object.drainAttempt != null) {
      yield r'drainAttempt';
      yield serializers.serialize(
        object.drainAttempt,
        specifiedType: const FullType(int),
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
    if (object.shuffleMapsClientGradedAgainst != null) {
      yield r'shuffleMapsClientGradedAgainst';
      yield serializers.serialize(
        object.shuffleMapsClientGradedAgainst,
        specifiedType: const FullType(BuiltMap, [FullType(String), FullType(BuiltList, [FullType(int)])]),
      );
    }
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
        case r'attemptMode':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(QuizSubmitRequestAttemptModeEnum),
          ) as QuizSubmitRequestAttemptModeEnum;
          result.attemptMode = valueDes;
          break;
        case r'capturedAt':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(DateTime),
          ) as DateTime;
          result.capturedAt = valueDes;
          break;
        case r'chapter':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(int),
          ) as int?;
          if (valueDes == null) continue;
          result.chapter = valueDes;
          break;
        case r'clientCapturedTotalSeconds':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.clientCapturedTotalSeconds = valueDes;
          break;
        case r'drainAttempt':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.drainAttempt = valueDes;
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
        case r'shuffleMapsClientGradedAgainst':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltMap, [FullType(String), FullType(BuiltList, [FullType(int)])]),
          ) as BuiltMap<String, BuiltList<int>>;
          result.shuffleMapsClientGradedAgainst.replace(valueDes);
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

class QuizSubmitRequestAttemptModeEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'online')
  static const QuizSubmitRequestAttemptModeEnum online = _$quizSubmitRequestAttemptModeEnum_online;
  @BuiltValueEnumConst(wireName: r'offline_replay')
  static const QuizSubmitRequestAttemptModeEnum offlineReplay = _$quizSubmitRequestAttemptModeEnum_offlineReplay;

  static Serializer<QuizSubmitRequestAttemptModeEnum> get serializer => _$quizSubmitRequestAttemptModeEnumSerializer;

  const QuizSubmitRequestAttemptModeEnum._(String name): super(name);

  static BuiltSet<QuizSubmitRequestAttemptModeEnum> get values => _$quizSubmitRequestAttemptModeEnumValues;
  static QuizSubmitRequestAttemptModeEnum valueOf(String name) => _$quizSubmitRequestAttemptModeEnumValueOf(name);
}

