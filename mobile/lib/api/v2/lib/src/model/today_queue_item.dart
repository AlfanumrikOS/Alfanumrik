//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:alfanumrik_api_v2/src/model/today_item_type.dart';
import 'package:alfanumrik_api_v2/src/model/today_deep_link.dart';
import 'package:built_value/json_object.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'today_queue_item.g.dart';

/// TodayQueueItem
///
/// Properties:
/// * [deepLink] 
/// * [estMinutes] 
/// * [iconHint] 
/// * [labelKey] 
/// * [meta] 
/// * [rank] 
/// * [reason] 
/// * [subtitleKey] 
/// * [type] 
@BuiltValue()
abstract class TodayQueueItem implements Built<TodayQueueItem, TodayQueueItemBuilder> {
  @BuiltValueField(wireName: r'deepLink')
  TodayDeepLink get deepLink;

  @BuiltValueField(wireName: r'estMinutes')
  int get estMinutes;

  @BuiltValueField(wireName: r'iconHint')
  String get iconHint;

  @BuiltValueField(wireName: r'labelKey')
  String get labelKey;

  @BuiltValueField(wireName: r'meta')
  BuiltMap<String, JsonObject?>? get meta;

  @BuiltValueField(wireName: r'rank')
  int get rank;

  @BuiltValueField(wireName: r'reason')
  String get reason;

  @BuiltValueField(wireName: r'subtitleKey')
  String get subtitleKey;

  @BuiltValueField(wireName: r'type')
  TodayItemType get type;
  // enum typeEnum {  resume_in_progress,  cold_start_diagnostic,  srs_due,  revise_decayed_topic,  weak_topic_zpd,  continue_lesson,  weekly_dive_due,  monthly_synthesis_due,  practice_weakest,  };

  TodayQueueItem._();

  factory TodayQueueItem([void updates(TodayQueueItemBuilder b)]) = _$TodayQueueItem;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(TodayQueueItemBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<TodayQueueItem> get serializer => _$TodayQueueItemSerializer();
}

class _$TodayQueueItemSerializer implements PrimitiveSerializer<TodayQueueItem> {
  @override
  final Iterable<Type> types = const [TodayQueueItem, _$TodayQueueItem];

  @override
  final String wireName = r'TodayQueueItem';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    TodayQueueItem object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'deepLink';
    yield serializers.serialize(
      object.deepLink,
      specifiedType: const FullType(TodayDeepLink),
    );
    yield r'estMinutes';
    yield serializers.serialize(
      object.estMinutes,
      specifiedType: const FullType(int),
    );
    yield r'iconHint';
    yield serializers.serialize(
      object.iconHint,
      specifiedType: const FullType(String),
    );
    yield r'labelKey';
    yield serializers.serialize(
      object.labelKey,
      specifiedType: const FullType(String),
    );
    if (object.meta != null) {
      yield r'meta';
      yield serializers.serialize(
        object.meta,
        specifiedType: const FullType(BuiltMap, [FullType(String), FullType.nullable(JsonObject)]),
      );
    }
    yield r'rank';
    yield serializers.serialize(
      object.rank,
      specifiedType: const FullType(int),
    );
    yield r'reason';
    yield serializers.serialize(
      object.reason,
      specifiedType: const FullType(String),
    );
    yield r'subtitleKey';
    yield serializers.serialize(
      object.subtitleKey,
      specifiedType: const FullType(String),
    );
    yield r'type';
    yield serializers.serialize(
      object.type,
      specifiedType: const FullType(TodayItemType),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    TodayQueueItem object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required TodayQueueItemBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'deepLink':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(TodayDeepLink),
          ) as TodayDeepLink;
          result.deepLink.replace(valueDes);
          break;
        case r'estMinutes':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.estMinutes = valueDes;
          break;
        case r'iconHint':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.iconHint = valueDes;
          break;
        case r'labelKey':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.labelKey = valueDes;
          break;
        case r'meta':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltMap, [FullType(String), FullType.nullable(JsonObject)]),
          ) as BuiltMap<String, JsonObject?>;
          result.meta.replace(valueDes);
          break;
        case r'rank':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.rank = valueDes;
          break;
        case r'reason':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.reason = valueDes;
          break;
        case r'subtitleKey':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.subtitleKey = valueDes;
          break;
        case r'type':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(TodayItemType),
          ) as TodayItemType;
          result.type = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  TodayQueueItem deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = TodayQueueItemBuilder();
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

