//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_question.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'quiz_questions_response.g.dart';

/// QuizQuestionsResponse
///
/// Properties:
/// * [questions] 
/// * [schemaVersion] 
@BuiltValue()
abstract class QuizQuestionsResponse implements Built<QuizQuestionsResponse, QuizQuestionsResponseBuilder> {
  @BuiltValueField(wireName: r'questions')
  BuiltList<QuizQuestion> get questions;

  @BuiltValueField(wireName: r'schemaVersion')
  QuizQuestionsResponseSchemaVersionEnum get schemaVersion;
  // enum schemaVersionEnum {  1,  };

  QuizQuestionsResponse._();

  factory QuizQuestionsResponse([void updates(QuizQuestionsResponseBuilder b)]) = _$QuizQuestionsResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(QuizQuestionsResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<QuizQuestionsResponse> get serializer => _$QuizQuestionsResponseSerializer();
}

class _$QuizQuestionsResponseSerializer implements PrimitiveSerializer<QuizQuestionsResponse> {
  @override
  final Iterable<Type> types = const [QuizQuestionsResponse, _$QuizQuestionsResponse];

  @override
  final String wireName = r'QuizQuestionsResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    QuizQuestionsResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'questions';
    yield serializers.serialize(
      object.questions,
      specifiedType: const FullType(BuiltList, [FullType(QuizQuestion)]),
    );
    yield r'schemaVersion';
    yield serializers.serialize(
      object.schemaVersion,
      specifiedType: const FullType(QuizQuestionsResponseSchemaVersionEnum),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    QuizQuestionsResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required QuizQuestionsResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'questions':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(QuizQuestion)]),
          ) as BuiltList<QuizQuestion>;
          result.questions.replace(valueDes);
          break;
        case r'schemaVersion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(QuizQuestionsResponseSchemaVersionEnum),
          ) as QuizQuestionsResponseSchemaVersionEnum;
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
  QuizQuestionsResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = QuizQuestionsResponseBuilder();
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

class QuizQuestionsResponseSchemaVersionEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'1')
  static const QuizQuestionsResponseSchemaVersionEnum n1 = _$quizQuestionsResponseSchemaVersionEnum_n1;

  static Serializer<QuizQuestionsResponseSchemaVersionEnum> get serializer => _$quizQuestionsResponseSchemaVersionEnumSerializer;

  const QuizQuestionsResponseSchemaVersionEnum._(String name): super(name);

  static BuiltSet<QuizQuestionsResponseSchemaVersionEnum> get values => _$quizQuestionsResponseSchemaVersionEnumValues;
  static QuizQuestionsResponseSchemaVersionEnum valueOf(String name) => _$quizQuestionsResponseSchemaVersionEnumValueOf(name);
}

