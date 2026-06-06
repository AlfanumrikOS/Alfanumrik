//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'dart:core';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';
import 'package:one_of/any_of.dart';

part 'today_deep_link_params_value.g.dart';

/// TodayDeepLinkParamsValue
@BuiltValue()
abstract class TodayDeepLinkParamsValue implements Built<TodayDeepLinkParamsValue, TodayDeepLinkParamsValueBuilder> {
  /// Any Of [String], [num]
  AnyOf get anyOf;

  TodayDeepLinkParamsValue._();

  factory TodayDeepLinkParamsValue([void updates(TodayDeepLinkParamsValueBuilder b)]) = _$TodayDeepLinkParamsValue;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(TodayDeepLinkParamsValueBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<TodayDeepLinkParamsValue> get serializer => _$TodayDeepLinkParamsValueSerializer();
}

class _$TodayDeepLinkParamsValueSerializer implements PrimitiveSerializer<TodayDeepLinkParamsValue> {
  @override
  final Iterable<Type> types = const [TodayDeepLinkParamsValue, _$TodayDeepLinkParamsValue];

  @override
  final String wireName = r'TodayDeepLinkParamsValue';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    TodayDeepLinkParamsValue object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
  }

  @override
  Object serialize(
    Serializers serializers,
    TodayDeepLinkParamsValue object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final anyOf = object.anyOf;
    return serializers.serialize(anyOf, specifiedType: FullType(AnyOf, anyOf.valueTypes.map((type) => FullType(type)).toList()))!;
  }

  @override
  TodayDeepLinkParamsValue deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = TodayDeepLinkParamsValueBuilder();
    Object? anyOfDataSrc;
    final targetType = const FullType(AnyOf, [FullType(String), FullType(num), ]);
    anyOfDataSrc = serialized;
    result.anyOf = serializers.deserialize(anyOfDataSrc, specifiedType: targetType) as AnyOf;
    return result.build();
  }
}

