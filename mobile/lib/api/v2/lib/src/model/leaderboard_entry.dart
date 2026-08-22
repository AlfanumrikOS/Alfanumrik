//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'leaderboard_entry.g.dart';

/// LeaderboardEntry
///
/// Properties:
/// * [avatarUrl] 
/// * [city] 
/// * [grade] 
/// * [name] 
/// * [rank] 
/// * [school] 
/// * [streak] 
/// * [studentId] 
/// * [totalXp] 
@BuiltValue()
abstract class LeaderboardEntry implements Built<LeaderboardEntry, LeaderboardEntryBuilder> {
  @BuiltValueField(wireName: r'avatar_url')
  String? get avatarUrl;

  @BuiltValueField(wireName: r'city')
  String? get city;

  @BuiltValueField(wireName: r'grade')
  String? get grade;

  @BuiltValueField(wireName: r'name')
  String? get name;

  @BuiltValueField(wireName: r'rank')
  int get rank;

  @BuiltValueField(wireName: r'school')
  String? get school;

  @BuiltValueField(wireName: r'streak')
  int get streak;

  @BuiltValueField(wireName: r'student_id')
  String get studentId;

  @BuiltValueField(wireName: r'total_xp')
  int get totalXp;

  LeaderboardEntry._();

  factory LeaderboardEntry([void updates(LeaderboardEntryBuilder b)]) = _$LeaderboardEntry;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(LeaderboardEntryBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<LeaderboardEntry> get serializer => _$LeaderboardEntrySerializer();
}

class _$LeaderboardEntrySerializer implements PrimitiveSerializer<LeaderboardEntry> {
  @override
  final Iterable<Type> types = const [LeaderboardEntry, _$LeaderboardEntry];

  @override
  final String wireName = r'LeaderboardEntry';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    LeaderboardEntry object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'avatar_url';
    yield object.avatarUrl == null ? null : serializers.serialize(
      object.avatarUrl,
      specifiedType: const FullType.nullable(String),
    );
    yield r'city';
    yield object.city == null ? null : serializers.serialize(
      object.city,
      specifiedType: const FullType.nullable(String),
    );
    yield r'grade';
    yield object.grade == null ? null : serializers.serialize(
      object.grade,
      specifiedType: const FullType.nullable(String),
    );
    yield r'name';
    yield object.name == null ? null : serializers.serialize(
      object.name,
      specifiedType: const FullType.nullable(String),
    );
    yield r'rank';
    yield serializers.serialize(
      object.rank,
      specifiedType: const FullType(int),
    );
    yield r'school';
    yield object.school == null ? null : serializers.serialize(
      object.school,
      specifiedType: const FullType.nullable(String),
    );
    yield r'streak';
    yield serializers.serialize(
      object.streak,
      specifiedType: const FullType(int),
    );
    yield r'student_id';
    yield serializers.serialize(
      object.studentId,
      specifiedType: const FullType(String),
    );
    yield r'total_xp';
    yield serializers.serialize(
      object.totalXp,
      specifiedType: const FullType(int),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    LeaderboardEntry object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required LeaderboardEntryBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'avatar_url':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.avatarUrl = valueDes;
          break;
        case r'city':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.city = valueDes;
          break;
        case r'grade':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.grade = valueDes;
          break;
        case r'name':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.name = valueDes;
          break;
        case r'rank':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.rank = valueDes;
          break;
        case r'school':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.school = valueDes;
          break;
        case r'streak':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.streak = valueDes;
          break;
        case r'student_id':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.studentId = valueDes;
          break;
        case r'total_xp':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.totalXp = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  LeaderboardEntry deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = LeaderboardEntryBuilder();
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

