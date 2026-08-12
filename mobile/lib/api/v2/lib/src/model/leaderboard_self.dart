//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'leaderboard_self.g.dart';

/// LeaderboardSelf
///
/// Properties:
/// * [onBoard] 
/// * [rank] 
/// * [studentId] 
/// * [totalXp] 
@BuiltValue()
abstract class LeaderboardSelf implements Built<LeaderboardSelf, LeaderboardSelfBuilder> {
  @BuiltValueField(wireName: r'on_board')
  bool get onBoard;

  @BuiltValueField(wireName: r'rank')
  int? get rank;

  @BuiltValueField(wireName: r'student_id')
  String? get studentId;

  @BuiltValueField(wireName: r'total_xp')
  int? get totalXp;

  LeaderboardSelf._();

  factory LeaderboardSelf([void updates(LeaderboardSelfBuilder b)]) = _$LeaderboardSelf;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(LeaderboardSelfBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<LeaderboardSelf> get serializer => _$LeaderboardSelfSerializer();
}

class _$LeaderboardSelfSerializer implements PrimitiveSerializer<LeaderboardSelf> {
  @override
  final Iterable<Type> types = const [LeaderboardSelf, _$LeaderboardSelf];

  @override
  final String wireName = r'LeaderboardSelf';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    LeaderboardSelf object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'on_board';
    yield serializers.serialize(
      object.onBoard,
      specifiedType: const FullType(bool),
    );
    yield r'rank';
    yield object.rank == null ? null : serializers.serialize(
      object.rank,
      specifiedType: const FullType.nullable(int),
    );
    yield r'student_id';
    yield object.studentId == null ? null : serializers.serialize(
      object.studentId,
      specifiedType: const FullType.nullable(String),
    );
    yield r'total_xp';
    yield object.totalXp == null ? null : serializers.serialize(
      object.totalXp,
      specifiedType: const FullType.nullable(int),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    LeaderboardSelf object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required LeaderboardSelfBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'on_board':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(bool),
          ) as bool;
          result.onBoard = valueDes;
          break;
        case r'rank':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(int),
          ) as int?;
          if (valueDes == null) continue;
          result.rank = valueDes;
          break;
        case r'student_id':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.studentId = valueDes;
          break;
        case r'total_xp':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(int),
          ) as int?;
          if (valueDes == null) continue;
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
  LeaderboardSelf deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = LeaderboardSelfBuilder();
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

