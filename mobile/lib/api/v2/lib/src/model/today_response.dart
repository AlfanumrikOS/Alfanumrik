//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:alfanumrik_api_v2/src/model/today_queue_item.dart';
import 'package:alfanumrik_api_v2/src/model/today_response_meta.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'today_response.g.dart';

/// TodayResponse
///
/// Properties:
/// * [meta] 
/// * [primary] 
/// * [queue] 
/// * [resolvedAt] 
/// * [schemaVersion] 
@BuiltValue()
abstract class TodayResponse implements Built<TodayResponse, TodayResponseBuilder> {
  @BuiltValueField(wireName: r'meta')
  TodayResponseMeta get meta;

  @BuiltValueField(wireName: r'primary')
  TodayQueueItem get primary;

  @BuiltValueField(wireName: r'queue')
  BuiltList<TodayQueueItem> get queue;

  @BuiltValueField(wireName: r'resolvedAt')
  String get resolvedAt;

  @BuiltValueField(wireName: r'schemaVersion')
  TodayResponseSchemaVersionEnum get schemaVersion;
  // enum schemaVersionEnum {  1,  };

  TodayResponse._();

  factory TodayResponse([void updates(TodayResponseBuilder b)]) = _$TodayResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(TodayResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<TodayResponse> get serializer => _$TodayResponseSerializer();
}

class _$TodayResponseSerializer implements PrimitiveSerializer<TodayResponse> {
  @override
  final Iterable<Type> types = const [TodayResponse, _$TodayResponse];

  @override
  final String wireName = r'TodayResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    TodayResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'meta';
    yield serializers.serialize(
      object.meta,
      specifiedType: const FullType(TodayResponseMeta),
    );
    yield r'primary';
    yield serializers.serialize(
      object.primary,
      specifiedType: const FullType(TodayQueueItem),
    );
    yield r'queue';
    yield serializers.serialize(
      object.queue,
      specifiedType: const FullType(BuiltList, [FullType(TodayQueueItem)]),
    );
    yield r'resolvedAt';
    yield serializers.serialize(
      object.resolvedAt,
      specifiedType: const FullType(String),
    );
    yield r'schemaVersion';
    yield serializers.serialize(
      object.schemaVersion,
      specifiedType: const FullType(TodayResponseSchemaVersionEnum),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    TodayResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required TodayResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'meta':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(TodayResponseMeta),
          ) as TodayResponseMeta;
          result.meta.replace(valueDes);
          break;
        case r'primary':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(TodayQueueItem),
          ) as TodayQueueItem;
          result.primary.replace(valueDes);
          break;
        case r'queue':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(TodayQueueItem)]),
          ) as BuiltList<TodayQueueItem>;
          result.queue.replace(valueDes);
          break;
        case r'resolvedAt':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.resolvedAt = valueDes;
          break;
        case r'schemaVersion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(TodayResponseSchemaVersionEnum),
          ) as TodayResponseSchemaVersionEnum;
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
  TodayResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = TodayResponseBuilder();
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

class TodayResponseSchemaVersionEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'1')
  static const TodayResponseSchemaVersionEnum n1 = _$todayResponseSchemaVersionEnum_n1;

  static Serializer<TodayResponseSchemaVersionEnum> get serializer => _$todayResponseSchemaVersionEnumSerializer;

  const TodayResponseSchemaVersionEnum._(String name): super(name);

  static BuiltSet<TodayResponseSchemaVersionEnum> get values => _$todayResponseSchemaVersionEnumValues;
  static TodayResponseSchemaVersionEnum valueOf(String name) => _$todayResponseSchemaVersionEnumValueOf(name);
}

