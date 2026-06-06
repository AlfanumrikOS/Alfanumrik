//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'success_ack.g.dart';

/// SuccessAck
///
/// Properties:
/// * [success] 
@BuiltValue()
abstract class SuccessAck implements Built<SuccessAck, SuccessAckBuilder> {
  @BuiltValueField(wireName: r'success')
  SuccessAckSuccessEnum get success;
  // enum successEnum {  true,  };

  SuccessAck._();

  factory SuccessAck([void updates(SuccessAckBuilder b)]) = _$SuccessAck;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(SuccessAckBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<SuccessAck> get serializer => _$SuccessAckSerializer();
}

class _$SuccessAckSerializer implements PrimitiveSerializer<SuccessAck> {
  @override
  final Iterable<Type> types = const [SuccessAck, _$SuccessAck];

  @override
  final String wireName = r'SuccessAck';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    SuccessAck object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'success';
    yield serializers.serialize(
      object.success,
      specifiedType: const FullType(SuccessAckSuccessEnum),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    SuccessAck object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required SuccessAckBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'success':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(SuccessAckSuccessEnum),
          ) as SuccessAckSuccessEnum;
          result.success = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  SuccessAck deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = SuccessAckBuilder();
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

class SuccessAckSuccessEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'true')
  static const SuccessAckSuccessEnum true_ = _$successAckSuccessEnum_true_;

  static Serializer<SuccessAckSuccessEnum> get serializer => _$successAckSuccessEnumSerializer;

  const SuccessAckSuccessEnum._(String name): super(name);

  static BuiltSet<SuccessAckSuccessEnum> get values => _$successAckSuccessEnumValues;
  static SuccessAckSuccessEnum valueOf(String name) => _$successAckSuccessEnumValueOf(name);
}

