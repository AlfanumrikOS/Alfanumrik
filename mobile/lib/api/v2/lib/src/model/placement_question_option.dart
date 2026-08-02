//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'placement_question_option.g.dart';

/// PlacementQuestionOption
///
/// Properties:
/// * [id] 
/// * [label] 
@BuiltValue()
abstract class PlacementQuestionOption implements Built<PlacementQuestionOption, PlacementQuestionOptionBuilder> {
  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'label')
  String get label;

  PlacementQuestionOption._();

  factory PlacementQuestionOption([void updates(PlacementQuestionOptionBuilder b)]) = _$PlacementQuestionOption;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(PlacementQuestionOptionBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<PlacementQuestionOption> get serializer => _$PlacementQuestionOptionSerializer();
}

class _$PlacementQuestionOptionSerializer implements PrimitiveSerializer<PlacementQuestionOption> {
  @override
  final Iterable<Type> types = const [PlacementQuestionOption, _$PlacementQuestionOption];

  @override
  final String wireName = r'PlacementQuestionOption';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    PlacementQuestionOption object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'id';
    yield serializers.serialize(
      object.id,
      specifiedType: const FullType(String),
    );
    yield r'label';
    yield serializers.serialize(
      object.label,
      specifiedType: const FullType(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    PlacementQuestionOption object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required PlacementQuestionOptionBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'id':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.id = valueDes;
          break;
        case r'label':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.label = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  PlacementQuestionOption deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = PlacementQuestionOptionBuilder();
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

