//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:alfanumrik_api_v2/src/model/today_deep_link_params_value.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'today_deep_link.g.dart';

/// TodayDeepLink
///
/// Properties:
/// * [params] 
/// * [route] 
@BuiltValue()
abstract class TodayDeepLink implements Built<TodayDeepLink, TodayDeepLinkBuilder> {
  @BuiltValueField(wireName: r'params')
  BuiltMap<String, TodayDeepLinkParamsValue>? get params;

  @BuiltValueField(wireName: r'route')
  String get route;

  TodayDeepLink._();

  factory TodayDeepLink([void updates(TodayDeepLinkBuilder b)]) = _$TodayDeepLink;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(TodayDeepLinkBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<TodayDeepLink> get serializer => _$TodayDeepLinkSerializer();
}

class _$TodayDeepLinkSerializer implements PrimitiveSerializer<TodayDeepLink> {
  @override
  final Iterable<Type> types = const [TodayDeepLink, _$TodayDeepLink];

  @override
  final String wireName = r'TodayDeepLink';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    TodayDeepLink object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.params != null) {
      yield r'params';
      yield serializers.serialize(
        object.params,
        specifiedType: const FullType(BuiltMap, [FullType(String), FullType(TodayDeepLinkParamsValue)]),
      );
    }
    yield r'route';
    yield serializers.serialize(
      object.route,
      specifiedType: const FullType(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    TodayDeepLink object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required TodayDeepLinkBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'params':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltMap, [FullType(String), FullType(TodayDeepLinkParamsValue)]),
          ) as BuiltMap<String, TodayDeepLinkParamsValue>;
          result.params.replace(valueDes);
          break;
        case r'route':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.route = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  TodayDeepLink deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = TodayDeepLinkBuilder();
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

