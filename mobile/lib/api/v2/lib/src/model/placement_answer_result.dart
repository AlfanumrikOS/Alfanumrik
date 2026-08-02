//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'placement_answer_result.g.dart';

/// PlacementAnswerResult
///
/// Properties:
/// * [accepted] 
/// * [duplicate] 
@BuiltValue()
abstract class PlacementAnswerResult implements Built<PlacementAnswerResult, PlacementAnswerResultBuilder> {
  @BuiltValueField(wireName: r'accepted')
  PlacementAnswerResultAcceptedEnum get accepted;
  // enum acceptedEnum {  true,  };

  @BuiltValueField(wireName: r'duplicate')
  bool get duplicate;

  PlacementAnswerResult._();

  factory PlacementAnswerResult([void updates(PlacementAnswerResultBuilder b)]) = _$PlacementAnswerResult;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(PlacementAnswerResultBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<PlacementAnswerResult> get serializer => _$PlacementAnswerResultSerializer();
}

class _$PlacementAnswerResultSerializer implements PrimitiveSerializer<PlacementAnswerResult> {
  @override
  final Iterable<Type> types = const [PlacementAnswerResult, _$PlacementAnswerResult];

  @override
  final String wireName = r'PlacementAnswerResult';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    PlacementAnswerResult object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'accepted';
    yield serializers.serialize(
      object.accepted,
      specifiedType: const FullType(PlacementAnswerResultAcceptedEnum),
    );
    yield r'duplicate';
    yield serializers.serialize(
      object.duplicate,
      specifiedType: const FullType(bool),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    PlacementAnswerResult object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required PlacementAnswerResultBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'accepted':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(PlacementAnswerResultAcceptedEnum),
          ) as PlacementAnswerResultAcceptedEnum;
          result.accepted = valueDes;
          break;
        case r'duplicate':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(bool),
          ) as bool;
          result.duplicate = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  PlacementAnswerResult deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = PlacementAnswerResultBuilder();
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

class PlacementAnswerResultAcceptedEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'true')
  static const PlacementAnswerResultAcceptedEnum true_ = _$placementAnswerResultAcceptedEnum_true_;

  static Serializer<PlacementAnswerResultAcceptedEnum> get serializer => _$placementAnswerResultAcceptedEnumSerializer;

  const PlacementAnswerResultAcceptedEnum._(String name): super(name);

  static BuiltSet<PlacementAnswerResultAcceptedEnum> get values => _$placementAnswerResultAcceptedEnumValues;
  static PlacementAnswerResultAcceptedEnum valueOf(String name) => _$placementAnswerResultAcceptedEnumValueOf(name);
}

