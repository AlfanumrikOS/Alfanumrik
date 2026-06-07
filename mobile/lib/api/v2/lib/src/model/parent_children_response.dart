//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:alfanumrik_api_v2/src/model/parent_child.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'parent_children_response.g.dart';

/// ParentChildrenResponse
///
/// Properties:
/// * [children] 
/// * [schemaVersion] 
@BuiltValue()
abstract class ParentChildrenResponse implements Built<ParentChildrenResponse, ParentChildrenResponseBuilder> {
  @BuiltValueField(wireName: r'children')
  BuiltList<ParentChild> get children;

  @BuiltValueField(wireName: r'schemaVersion')
  ParentChildrenResponseSchemaVersionEnum get schemaVersion;
  // enum schemaVersionEnum {  1,  };

  ParentChildrenResponse._();

  factory ParentChildrenResponse([void updates(ParentChildrenResponseBuilder b)]) = _$ParentChildrenResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ParentChildrenResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ParentChildrenResponse> get serializer => _$ParentChildrenResponseSerializer();
}

class _$ParentChildrenResponseSerializer implements PrimitiveSerializer<ParentChildrenResponse> {
  @override
  final Iterable<Type> types = const [ParentChildrenResponse, _$ParentChildrenResponse];

  @override
  final String wireName = r'ParentChildrenResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ParentChildrenResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'children';
    yield serializers.serialize(
      object.children,
      specifiedType: const FullType(BuiltList, [FullType(ParentChild)]),
    );
    yield r'schemaVersion';
    yield serializers.serialize(
      object.schemaVersion,
      specifiedType: const FullType(ParentChildrenResponseSchemaVersionEnum),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    ParentChildrenResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ParentChildrenResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'children':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ParentChild)]),
          ) as BuiltList<ParentChild>;
          result.children.replace(valueDes);
          break;
        case r'schemaVersion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ParentChildrenResponseSchemaVersionEnum),
          ) as ParentChildrenResponseSchemaVersionEnum;
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
  ParentChildrenResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ParentChildrenResponseBuilder();
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

class ParentChildrenResponseSchemaVersionEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'1')
  static const ParentChildrenResponseSchemaVersionEnum n1 = _$parentChildrenResponseSchemaVersionEnum_n1;

  static Serializer<ParentChildrenResponseSchemaVersionEnum> get serializer => _$parentChildrenResponseSchemaVersionEnumSerializer;

  const ParentChildrenResponseSchemaVersionEnum._(String name): super(name);

  static BuiltSet<ParentChildrenResponseSchemaVersionEnum> get values => _$parentChildrenResponseSchemaVersionEnumValues;
  static ParentChildrenResponseSchemaVersionEnum valueOf(String name) => _$parentChildrenResponseSchemaVersionEnumValueOf(name);
}

