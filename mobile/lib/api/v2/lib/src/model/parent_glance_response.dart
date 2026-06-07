//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:alfanumrik_api_v2/src/model/parent_glance_child.dart';
import 'package:alfanumrik_api_v2/src/model/parent_glance_moments.dart';
import 'package:built_collection/built_collection.dart';
import 'package:alfanumrik_api_v2/src/model/parent_glance_snapshot.dart';
import 'package:alfanumrik_api_v2/src/model/parent_glance_weekly_day.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'parent_glance_response.g.dart';

/// ParentGlanceResponse
///
/// Properties:
/// * [child] 
/// * [moments] 
/// * [schemaVersion] 
/// * [snapshot] 
/// * [weeklyActivity] 
@BuiltValue()
abstract class ParentGlanceResponse implements Built<ParentGlanceResponse, ParentGlanceResponseBuilder> {
  @BuiltValueField(wireName: r'child')
  ParentGlanceChild get child;

  @BuiltValueField(wireName: r'moments')
  ParentGlanceMoments get moments;

  @BuiltValueField(wireName: r'schemaVersion')
  ParentGlanceResponseSchemaVersionEnum get schemaVersion;
  // enum schemaVersionEnum {  1,  };

  @BuiltValueField(wireName: r'snapshot')
  ParentGlanceSnapshot get snapshot;

  @BuiltValueField(wireName: r'weeklyActivity')
  BuiltList<ParentGlanceWeeklyDay>? get weeklyActivity;

  ParentGlanceResponse._();

  factory ParentGlanceResponse([void updates(ParentGlanceResponseBuilder b)]) = _$ParentGlanceResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ParentGlanceResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ParentGlanceResponse> get serializer => _$ParentGlanceResponseSerializer();
}

class _$ParentGlanceResponseSerializer implements PrimitiveSerializer<ParentGlanceResponse> {
  @override
  final Iterable<Type> types = const [ParentGlanceResponse, _$ParentGlanceResponse];

  @override
  final String wireName = r'ParentGlanceResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ParentGlanceResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'child';
    yield serializers.serialize(
      object.child,
      specifiedType: const FullType(ParentGlanceChild),
    );
    yield r'moments';
    yield serializers.serialize(
      object.moments,
      specifiedType: const FullType(ParentGlanceMoments),
    );
    yield r'schemaVersion';
    yield serializers.serialize(
      object.schemaVersion,
      specifiedType: const FullType(ParentGlanceResponseSchemaVersionEnum),
    );
    yield r'snapshot';
    yield serializers.serialize(
      object.snapshot,
      specifiedType: const FullType(ParentGlanceSnapshot),
    );
    if (object.weeklyActivity != null) {
      yield r'weeklyActivity';
      yield serializers.serialize(
        object.weeklyActivity,
        specifiedType: const FullType(BuiltList, [FullType(ParentGlanceWeeklyDay)]),
      );
    }
  }

  @override
  Object serialize(
    Serializers serializers,
    ParentGlanceResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ParentGlanceResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'child':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ParentGlanceChild),
          ) as ParentGlanceChild;
          result.child.replace(valueDes);
          break;
        case r'moments':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ParentGlanceMoments),
          ) as ParentGlanceMoments;
          result.moments.replace(valueDes);
          break;
        case r'schemaVersion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ParentGlanceResponseSchemaVersionEnum),
          ) as ParentGlanceResponseSchemaVersionEnum;
          result.schemaVersion = valueDes;
          break;
        case r'snapshot':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ParentGlanceSnapshot),
          ) as ParentGlanceSnapshot;
          result.snapshot.replace(valueDes);
          break;
        case r'weeklyActivity':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ParentGlanceWeeklyDay)]),
          ) as BuiltList<ParentGlanceWeeklyDay>;
          result.weeklyActivity.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ParentGlanceResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ParentGlanceResponseBuilder();
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

class ParentGlanceResponseSchemaVersionEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'1')
  static const ParentGlanceResponseSchemaVersionEnum n1 = _$parentGlanceResponseSchemaVersionEnum_n1;

  static Serializer<ParentGlanceResponseSchemaVersionEnum> get serializer => _$parentGlanceResponseSchemaVersionEnumSerializer;

  const ParentGlanceResponseSchemaVersionEnum._(String name): super(name);

  static BuiltSet<ParentGlanceResponseSchemaVersionEnum> get values => _$parentGlanceResponseSchemaVersionEnumValues;
  static ParentGlanceResponseSchemaVersionEnum valueOf(String name) => _$parentGlanceResponseSchemaVersionEnumValueOf(name);
}

