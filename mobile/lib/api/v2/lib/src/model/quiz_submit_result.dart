//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/json_object.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'quiz_submit_result.g.dart';

/// QuizSubmitResult
///
/// Properties:
/// * [correct] 
/// * [flagged] 
/// * [idempotentReplay] 
/// * [markingAuthenticityPath] 
/// * [questions] 
/// * [schemaVersion] 
/// * [scorePercent] 
/// * [sessionId] 
/// * [total] 
/// * [xpCapped] 
/// * [xpEarned] 
@BuiltValue()
abstract class QuizSubmitResult implements Built<QuizSubmitResult, QuizSubmitResultBuilder> {
  @BuiltValueField(wireName: r'correct')
  int get correct;

  @BuiltValueField(wireName: r'flagged')
  bool get flagged;

  @BuiltValueField(wireName: r'idempotent_replay')
  bool get idempotentReplay;

  @BuiltValueField(wireName: r'marking_authenticity_path')
  String get markingAuthenticityPath;

  @BuiltValueField(wireName: r'questions')
  BuiltList<BuiltMap<String, JsonObject?>> get questions;

  @BuiltValueField(wireName: r'schemaVersion')
  QuizSubmitResultSchemaVersionEnum get schemaVersion;
  // enum schemaVersionEnum {  1,  };

  @BuiltValueField(wireName: r'score_percent')
  num get scorePercent;

  @BuiltValueField(wireName: r'session_id')
  String? get sessionId;

  @BuiltValueField(wireName: r'total')
  int get total;

  @BuiltValueField(wireName: r'xp_capped')
  bool? get xpCapped;

  @BuiltValueField(wireName: r'xp_earned')
  num get xpEarned;

  QuizSubmitResult._();

  factory QuizSubmitResult([void updates(QuizSubmitResultBuilder b)]) = _$QuizSubmitResult;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(QuizSubmitResultBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<QuizSubmitResult> get serializer => _$QuizSubmitResultSerializer();
}

class _$QuizSubmitResultSerializer implements PrimitiveSerializer<QuizSubmitResult> {
  @override
  final Iterable<Type> types = const [QuizSubmitResult, _$QuizSubmitResult];

  @override
  final String wireName = r'QuizSubmitResult';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    QuizSubmitResult object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'correct';
    yield serializers.serialize(
      object.correct,
      specifiedType: const FullType(int),
    );
    yield r'flagged';
    yield serializers.serialize(
      object.flagged,
      specifiedType: const FullType(bool),
    );
    yield r'idempotent_replay';
    yield serializers.serialize(
      object.idempotentReplay,
      specifiedType: const FullType(bool),
    );
    yield r'marking_authenticity_path';
    yield serializers.serialize(
      object.markingAuthenticityPath,
      specifiedType: const FullType(String),
    );
    yield r'questions';
    yield serializers.serialize(
      object.questions,
      specifiedType: const FullType(BuiltList, [FullType(BuiltMap, [FullType(String), FullType.nullable(JsonObject)])]),
    );
    yield r'schemaVersion';
    yield serializers.serialize(
      object.schemaVersion,
      specifiedType: const FullType(QuizSubmitResultSchemaVersionEnum),
    );
    yield r'score_percent';
    yield serializers.serialize(
      object.scorePercent,
      specifiedType: const FullType(num),
    );
    yield r'session_id';
    yield object.sessionId == null ? null : serializers.serialize(
      object.sessionId,
      specifiedType: const FullType.nullable(String),
    );
    yield r'total';
    yield serializers.serialize(
      object.total,
      specifiedType: const FullType(int),
    );
    if (object.xpCapped != null) {
      yield r'xp_capped';
      yield serializers.serialize(
        object.xpCapped,
        specifiedType: const FullType(bool),
      );
    }
    yield r'xp_earned';
    yield serializers.serialize(
      object.xpEarned,
      specifiedType: const FullType(num),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    QuizSubmitResult object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required QuizSubmitResultBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'correct':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.correct = valueDes;
          break;
        case r'flagged':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(bool),
          ) as bool;
          result.flagged = valueDes;
          break;
        case r'idempotent_replay':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(bool),
          ) as bool;
          result.idempotentReplay = valueDes;
          break;
        case r'marking_authenticity_path':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.markingAuthenticityPath = valueDes;
          break;
        case r'questions':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(BuiltMap, [FullType(String), FullType.nullable(JsonObject)])]),
          ) as BuiltList<BuiltMap<String, JsonObject?>>;
          result.questions.replace(valueDes);
          break;
        case r'schemaVersion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(QuizSubmitResultSchemaVersionEnum),
          ) as QuizSubmitResultSchemaVersionEnum;
          result.schemaVersion = valueDes;
          break;
        case r'score_percent':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(num),
          ) as num;
          result.scorePercent = valueDes;
          break;
        case r'session_id':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.sessionId = valueDes;
          break;
        case r'total':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.total = valueDes;
          break;
        case r'xp_capped':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(bool),
          ) as bool;
          result.xpCapped = valueDes;
          break;
        case r'xp_earned':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(num),
          ) as num;
          result.xpEarned = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  QuizSubmitResult deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = QuizSubmitResultBuilder();
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

class QuizSubmitResultSchemaVersionEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'1')
  static const QuizSubmitResultSchemaVersionEnum n1 = _$quizSubmitResultSchemaVersionEnum_n1;

  static Serializer<QuizSubmitResultSchemaVersionEnum> get serializer => _$quizSubmitResultSchemaVersionEnumSerializer;

  const QuizSubmitResultSchemaVersionEnum._(String name): super(name);

  static BuiltSet<QuizSubmitResultSchemaVersionEnum> get values => _$quizSubmitResultSchemaVersionEnumValues;
  static QuizSubmitResultSchemaVersionEnum valueOf(String name) => _$quizSubmitResultSchemaVersionEnumValueOf(name);
}

