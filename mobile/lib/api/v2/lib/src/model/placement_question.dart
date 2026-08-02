//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:alfanumrik_api_v2/src/model/placement_question_option.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'placement_question.g.dart';

/// PlacementQuestion
///
/// Properties:
/// * [chapterNumber] 
/// * [id] 
/// * [options] 
/// * [stem] 
/// * [topicId] 
@BuiltValue()
abstract class PlacementQuestion implements Built<PlacementQuestion, PlacementQuestionBuilder> {
  @BuiltValueField(wireName: r'chapterNumber')
  int? get chapterNumber;

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'options')
  BuiltList<PlacementQuestionOption> get options;

  @BuiltValueField(wireName: r'stem')
  String get stem;

  @BuiltValueField(wireName: r'topicId')
  String? get topicId;

  PlacementQuestion._();

  factory PlacementQuestion([void updates(PlacementQuestionBuilder b)]) = _$PlacementQuestion;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(PlacementQuestionBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<PlacementQuestion> get serializer => _$PlacementQuestionSerializer();
}

class _$PlacementQuestionSerializer implements PrimitiveSerializer<PlacementQuestion> {
  @override
  final Iterable<Type> types = const [PlacementQuestion, _$PlacementQuestion];

  @override
  final String wireName = r'PlacementQuestion';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    PlacementQuestion object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'chapterNumber';
    yield object.chapterNumber == null ? null : serializers.serialize(
      object.chapterNumber,
      specifiedType: const FullType.nullable(int),
    );
    yield r'id';
    yield serializers.serialize(
      object.id,
      specifiedType: const FullType(String),
    );
    yield r'options';
    yield serializers.serialize(
      object.options,
      specifiedType: const FullType(BuiltList, [FullType(PlacementQuestionOption)]),
    );
    yield r'stem';
    yield serializers.serialize(
      object.stem,
      specifiedType: const FullType(String),
    );
    yield r'topicId';
    yield object.topicId == null ? null : serializers.serialize(
      object.topicId,
      specifiedType: const FullType.nullable(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    PlacementQuestion object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required PlacementQuestionBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'chapterNumber':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(int),
          ) as int?;
          if (valueDes == null) continue;
          result.chapterNumber = valueDes;
          break;
        case r'id':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.id = valueDes;
          break;
        case r'options':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(PlacementQuestionOption)]),
          ) as BuiltList<PlacementQuestionOption>;
          result.options.replace(valueDes);
          break;
        case r'stem':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.stem = valueDes;
          break;
        case r'topicId':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.topicId = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  PlacementQuestion deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = PlacementQuestionBuilder();
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

