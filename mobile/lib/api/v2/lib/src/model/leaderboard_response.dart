//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:alfanumrik_api_v2/src/model/leaderboard_entry.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'leaderboard_response.g.dart';

/// LeaderboardResponse
///
/// Properties:
/// * [entries] 
/// * [period] 
/// * [schemaVersion] 
/// * [scope] 
@BuiltValue()
abstract class LeaderboardResponse implements Built<LeaderboardResponse, LeaderboardResponseBuilder> {
  @BuiltValueField(wireName: r'entries')
  BuiltList<LeaderboardEntry> get entries;

  @BuiltValueField(wireName: r'period')
  LeaderboardResponsePeriodEnum get period;
  // enum periodEnum {  weekly,  monthly,  all,  };

  @BuiltValueField(wireName: r'schemaVersion')
  LeaderboardResponseSchemaVersionEnum get schemaVersion;
  // enum schemaVersionEnum {  1,  };

  @BuiltValueField(wireName: r'scope')
  LeaderboardResponseScopeEnum get scope;
  // enum scopeEnum {  school,  global,  };

  LeaderboardResponse._();

  factory LeaderboardResponse([void updates(LeaderboardResponseBuilder b)]) = _$LeaderboardResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(LeaderboardResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<LeaderboardResponse> get serializer => _$LeaderboardResponseSerializer();
}

class _$LeaderboardResponseSerializer implements PrimitiveSerializer<LeaderboardResponse> {
  @override
  final Iterable<Type> types = const [LeaderboardResponse, _$LeaderboardResponse];

  @override
  final String wireName = r'LeaderboardResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    LeaderboardResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'entries';
    yield serializers.serialize(
      object.entries,
      specifiedType: const FullType(BuiltList, [FullType(LeaderboardEntry)]),
    );
    yield r'period';
    yield serializers.serialize(
      object.period,
      specifiedType: const FullType(LeaderboardResponsePeriodEnum),
    );
    yield r'schemaVersion';
    yield serializers.serialize(
      object.schemaVersion,
      specifiedType: const FullType(LeaderboardResponseSchemaVersionEnum),
    );
    yield r'scope';
    yield serializers.serialize(
      object.scope,
      specifiedType: const FullType(LeaderboardResponseScopeEnum),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    LeaderboardResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required LeaderboardResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'entries':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(LeaderboardEntry)]),
          ) as BuiltList<LeaderboardEntry>;
          result.entries.replace(valueDes);
          break;
        case r'period':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(LeaderboardResponsePeriodEnum),
          ) as LeaderboardResponsePeriodEnum;
          result.period = valueDes;
          break;
        case r'schemaVersion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(LeaderboardResponseSchemaVersionEnum),
          ) as LeaderboardResponseSchemaVersionEnum;
          result.schemaVersion = valueDes;
          break;
        case r'scope':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(LeaderboardResponseScopeEnum),
          ) as LeaderboardResponseScopeEnum;
          result.scope = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  LeaderboardResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = LeaderboardResponseBuilder();
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

class LeaderboardResponsePeriodEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'weekly')
  static const LeaderboardResponsePeriodEnum weekly = _$leaderboardResponsePeriodEnum_weekly;
  @BuiltValueEnumConst(wireName: r'monthly')
  static const LeaderboardResponsePeriodEnum monthly = _$leaderboardResponsePeriodEnum_monthly;
  @BuiltValueEnumConst(wireName: r'all')
  static const LeaderboardResponsePeriodEnum all = _$leaderboardResponsePeriodEnum_all;

  static Serializer<LeaderboardResponsePeriodEnum> get serializer => _$leaderboardResponsePeriodEnumSerializer;

  const LeaderboardResponsePeriodEnum._(String name): super(name);

  static BuiltSet<LeaderboardResponsePeriodEnum> get values => _$leaderboardResponsePeriodEnumValues;
  static LeaderboardResponsePeriodEnum valueOf(String name) => _$leaderboardResponsePeriodEnumValueOf(name);
}

class LeaderboardResponseSchemaVersionEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'1')
  static const LeaderboardResponseSchemaVersionEnum n1 = _$leaderboardResponseSchemaVersionEnum_n1;

  static Serializer<LeaderboardResponseSchemaVersionEnum> get serializer => _$leaderboardResponseSchemaVersionEnumSerializer;

  const LeaderboardResponseSchemaVersionEnum._(String name): super(name);

  static BuiltSet<LeaderboardResponseSchemaVersionEnum> get values => _$leaderboardResponseSchemaVersionEnumValues;
  static LeaderboardResponseSchemaVersionEnum valueOf(String name) => _$leaderboardResponseSchemaVersionEnumValueOf(name);
}

class LeaderboardResponseScopeEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'school')
  static const LeaderboardResponseScopeEnum school = _$leaderboardResponseScopeEnum_school;
  @BuiltValueEnumConst(wireName: r'global')
  static const LeaderboardResponseScopeEnum global = _$leaderboardResponseScopeEnum_global;

  static Serializer<LeaderboardResponseScopeEnum> get serializer => _$leaderboardResponseScopeEnumSerializer;

  const LeaderboardResponseScopeEnum._(String name): super(name);

  static BuiltSet<LeaderboardResponseScopeEnum> get values => _$leaderboardResponseScopeEnumValues;
  static LeaderboardResponseScopeEnum valueOf(String name) => _$leaderboardResponseScopeEnumValueOf(name);
}

