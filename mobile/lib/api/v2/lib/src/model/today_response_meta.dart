//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'today_response_meta.g.dart';

/// TodayResponseMeta
///
/// Properties:
/// * [branch] 
/// * [dueReviewCount] 
/// * [masterySubjectCount] 
@BuiltValue()
abstract class TodayResponseMeta implements Built<TodayResponseMeta, TodayResponseMetaBuilder> {
  @BuiltValueField(wireName: r'branch')
  String get branch;

  @BuiltValueField(wireName: r'dueReviewCount')
  int get dueReviewCount;

  @BuiltValueField(wireName: r'masterySubjectCount')
  int get masterySubjectCount;

  TodayResponseMeta._();

  factory TodayResponseMeta([void updates(TodayResponseMetaBuilder b)]) = _$TodayResponseMeta;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(TodayResponseMetaBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<TodayResponseMeta> get serializer => _$TodayResponseMetaSerializer();
}

class _$TodayResponseMetaSerializer implements PrimitiveSerializer<TodayResponseMeta> {
  @override
  final Iterable<Type> types = const [TodayResponseMeta, _$TodayResponseMeta];

  @override
  final String wireName = r'TodayResponseMeta';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    TodayResponseMeta object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'branch';
    yield serializers.serialize(
      object.branch,
      specifiedType: const FullType(String),
    );
    yield r'dueReviewCount';
    yield serializers.serialize(
      object.dueReviewCount,
      specifiedType: const FullType(int),
    );
    yield r'masterySubjectCount';
    yield serializers.serialize(
      object.masterySubjectCount,
      specifiedType: const FullType(int),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    TodayResponseMeta object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required TodayResponseMetaBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'branch':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.branch = valueDes;
          break;
        case r'dueReviewCount':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.dueReviewCount = valueDes;
          break;
        case r'masterySubjectCount':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.masterySubjectCount = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  TodayResponseMeta deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = TodayResponseMetaBuilder();
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

