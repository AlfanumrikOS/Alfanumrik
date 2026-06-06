//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'quiz_start_question.g.dart';

/// QuizStartQuestion
///
/// Properties:
/// * [bloomLevel] 
/// * [chapterNumber] 
/// * [difficulty] 
/// * [explanation] 
/// * [explanationHi] 
/// * [hint] 
/// * [optionsDisplayed] 
/// * [questionHi] 
/// * [questionId] 
/// * [questionText] 
/// * [questionType] 
@BuiltValue()
abstract class QuizStartQuestion implements Built<QuizStartQuestion, QuizStartQuestionBuilder> {
  @BuiltValueField(wireName: r'bloom_level')
  String? get bloomLevel;

  @BuiltValueField(wireName: r'chapter_number')
  int? get chapterNumber;

  @BuiltValueField(wireName: r'difficulty')
  num get difficulty;

  @BuiltValueField(wireName: r'explanation')
  String? get explanation;

  @BuiltValueField(wireName: r'explanation_hi')
  String? get explanationHi;

  @BuiltValueField(wireName: r'hint')
  String? get hint;

  @BuiltValueField(wireName: r'options_displayed')
  BuiltList<String> get optionsDisplayed;

  @BuiltValueField(wireName: r'question_hi')
  String? get questionHi;

  @BuiltValueField(wireName: r'question_id')
  String get questionId;

  @BuiltValueField(wireName: r'question_text')
  String get questionText;

  @BuiltValueField(wireName: r'question_type')
  String get questionType;

  QuizStartQuestion._();

  factory QuizStartQuestion([void updates(QuizStartQuestionBuilder b)]) = _$QuizStartQuestion;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(QuizStartQuestionBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<QuizStartQuestion> get serializer => _$QuizStartQuestionSerializer();
}

class _$QuizStartQuestionSerializer implements PrimitiveSerializer<QuizStartQuestion> {
  @override
  final Iterable<Type> types = const [QuizStartQuestion, _$QuizStartQuestion];

  @override
  final String wireName = r'QuizStartQuestion';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    QuizStartQuestion object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'bloom_level';
    yield object.bloomLevel == null ? null : serializers.serialize(
      object.bloomLevel,
      specifiedType: const FullType.nullable(String),
    );
    yield r'chapter_number';
    yield object.chapterNumber == null ? null : serializers.serialize(
      object.chapterNumber,
      specifiedType: const FullType.nullable(int),
    );
    yield r'difficulty';
    yield serializers.serialize(
      object.difficulty,
      specifiedType: const FullType(num),
    );
    yield r'explanation';
    yield object.explanation == null ? null : serializers.serialize(
      object.explanation,
      specifiedType: const FullType.nullable(String),
    );
    yield r'explanation_hi';
    yield object.explanationHi == null ? null : serializers.serialize(
      object.explanationHi,
      specifiedType: const FullType.nullable(String),
    );
    yield r'hint';
    yield object.hint == null ? null : serializers.serialize(
      object.hint,
      specifiedType: const FullType.nullable(String),
    );
    yield r'options_displayed';
    yield serializers.serialize(
      object.optionsDisplayed,
      specifiedType: const FullType(BuiltList, [FullType(String)]),
    );
    yield r'question_hi';
    yield object.questionHi == null ? null : serializers.serialize(
      object.questionHi,
      specifiedType: const FullType.nullable(String),
    );
    yield r'question_id';
    yield serializers.serialize(
      object.questionId,
      specifiedType: const FullType(String),
    );
    yield r'question_text';
    yield serializers.serialize(
      object.questionText,
      specifiedType: const FullType(String),
    );
    yield r'question_type';
    yield serializers.serialize(
      object.questionType,
      specifiedType: const FullType(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    QuizStartQuestion object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required QuizStartQuestionBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'bloom_level':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.bloomLevel = valueDes;
          break;
        case r'chapter_number':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(int),
          ) as int?;
          if (valueDes == null) continue;
          result.chapterNumber = valueDes;
          break;
        case r'difficulty':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(num),
          ) as num;
          result.difficulty = valueDes;
          break;
        case r'explanation':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.explanation = valueDes;
          break;
        case r'explanation_hi':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.explanationHi = valueDes;
          break;
        case r'hint':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.hint = valueDes;
          break;
        case r'options_displayed':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.optionsDisplayed.replace(valueDes);
          break;
        case r'question_hi':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.questionHi = valueDes;
          break;
        case r'question_id':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.questionId = valueDes;
          break;
        case r'question_text':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.questionText = valueDes;
          break;
        case r'question_type':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.questionType = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  QuizStartQuestion deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = QuizStartQuestionBuilder();
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

