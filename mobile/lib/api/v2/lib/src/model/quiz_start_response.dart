//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_start_question.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'quiz_start_response.g.dart';

/// QuizStartResponse
///
/// Properties:
/// * [questions] 
/// * [schemaVersion] 
/// * [sessionId] 
@BuiltValue()
abstract class QuizStartResponse implements Built<QuizStartResponse, QuizStartResponseBuilder> {
  @BuiltValueField(wireName: r'questions')
  BuiltList<QuizStartQuestion> get questions;

  @BuiltValueField(wireName: r'schemaVersion')
  QuizStartResponseSchemaVersionEnum get schemaVersion;
  // enum schemaVersionEnum {  1,  };

  @BuiltValueField(wireName: r'session_id')
  String get sessionId;

  QuizStartResponse._();

  factory QuizStartResponse([void updates(QuizStartResponseBuilder b)]) = _$QuizStartResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(QuizStartResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<QuizStartResponse> get serializer => _$QuizStartResponseSerializer();
}

class _$QuizStartResponseSerializer implements PrimitiveSerializer<QuizStartResponse> {
  @override
  final Iterable<Type> types = const [QuizStartResponse, _$QuizStartResponse];

  @override
  final String wireName = r'QuizStartResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    QuizStartResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'questions';
    yield serializers.serialize(
      object.questions,
      specifiedType: const FullType(BuiltList, [FullType(QuizStartQuestion)]),
    );
    yield r'schemaVersion';
    yield serializers.serialize(
      object.schemaVersion,
      specifiedType: const FullType(QuizStartResponseSchemaVersionEnum),
    );
    yield r'session_id';
    yield serializers.serialize(
      object.sessionId,
      specifiedType: const FullType(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    QuizStartResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required QuizStartResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'questions':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(QuizStartQuestion)]),
          ) as BuiltList<QuizStartQuestion>;
          result.questions.replace(valueDes);
          break;
        case r'schemaVersion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(QuizStartResponseSchemaVersionEnum),
          ) as QuizStartResponseSchemaVersionEnum;
          result.schemaVersion = valueDes;
          break;
        case r'session_id':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.sessionId = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  QuizStartResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = QuizStartResponseBuilder();
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

class QuizStartResponseSchemaVersionEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'1')
  static const QuizStartResponseSchemaVersionEnum n1 = _$quizStartResponseSchemaVersionEnum_n1;

  static Serializer<QuizStartResponseSchemaVersionEnum> get serializer => _$quizStartResponseSchemaVersionEnumSerializer;

  const QuizStartResponseSchemaVersionEnum._(String name): super(name);

  static BuiltSet<QuizStartResponseSchemaVersionEnum> get values => _$quizStartResponseSchemaVersionEnumValues;
  static QuizStartResponseSchemaVersionEnum valueOf(String name) => _$quizStartResponseSchemaVersionEnumValueOf(name);
}

