//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'quiz_submit_response_item.g.dart';

/// QuizSubmitResponseItem
///
/// Properties:
/// * [questionId] 
/// * [selectedOption] 
/// * [timeTakenSeconds] 
@BuiltValue()
abstract class QuizSubmitResponseItem implements Built<QuizSubmitResponseItem, QuizSubmitResponseItemBuilder> {
  @BuiltValueField(wireName: r'question_id')
  String get questionId;

  @BuiltValueField(wireName: r'selected_option')
  int get selectedOption;

  @BuiltValueField(wireName: r'time_taken_seconds')
  int get timeTakenSeconds;

  QuizSubmitResponseItem._();

  factory QuizSubmitResponseItem([void updates(QuizSubmitResponseItemBuilder b)]) = _$QuizSubmitResponseItem;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(QuizSubmitResponseItemBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<QuizSubmitResponseItem> get serializer => _$QuizSubmitResponseItemSerializer();
}

class _$QuizSubmitResponseItemSerializer implements PrimitiveSerializer<QuizSubmitResponseItem> {
  @override
  final Iterable<Type> types = const [QuizSubmitResponseItem, _$QuizSubmitResponseItem];

  @override
  final String wireName = r'QuizSubmitResponseItem';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    QuizSubmitResponseItem object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'question_id';
    yield serializers.serialize(
      object.questionId,
      specifiedType: const FullType(String),
    );
    yield r'selected_option';
    yield serializers.serialize(
      object.selectedOption,
      specifiedType: const FullType(int),
    );
    yield r'time_taken_seconds';
    yield serializers.serialize(
      object.timeTakenSeconds,
      specifiedType: const FullType(int),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    QuizSubmitResponseItem object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required QuizSubmitResponseItemBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'question_id':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.questionId = valueDes;
          break;
        case r'selected_option':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.selectedOption = valueDes;
          break;
        case r'time_taken_seconds':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.timeTakenSeconds = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  QuizSubmitResponseItem deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = QuizSubmitResponseItemBuilder();
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

