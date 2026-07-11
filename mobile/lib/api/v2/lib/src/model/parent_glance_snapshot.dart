//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'parent_glance_snapshot.g.dart';

/// ParentGlanceSnapshot
///
/// Properties:
/// * [accuracy]
/// * [avgScore]
/// * [sessionsThisWeek]
/// * [streakDays]
/// * [timeMinutes]
/// * [totalChats]
/// * [totalQuizzes]
/// * [xp]
@BuiltValue()
abstract class ParentGlanceSnapshot
    implements Built<ParentGlanceSnapshot, ParentGlanceSnapshotBuilder> {
  @BuiltValueField(wireName: r'accuracy')
  num? get accuracy;

  @BuiltValueField(wireName: r'avg_score')
  num? get avgScore;

  @BuiltValueField(wireName: r'sessions_this_week')
  int? get sessionsThisWeek;

  @BuiltValueField(wireName: r'streak_days')
  int? get streakDays;

  @BuiltValueField(wireName: r'time_minutes')
  num? get timeMinutes;

  @BuiltValueField(wireName: r'total_chats')
  num? get totalChats;

  @BuiltValueField(wireName: r'total_quizzes')
  num? get totalQuizzes;

  @BuiltValueField(wireName: r'xp')
  num? get xp;

  ParentGlanceSnapshot._();

  factory ParentGlanceSnapshot([void updates(ParentGlanceSnapshotBuilder b)]) =
      _$ParentGlanceSnapshot;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ParentGlanceSnapshotBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ParentGlanceSnapshot> get serializer =>
      _$ParentGlanceSnapshotSerializer();
}

class _$ParentGlanceSnapshotSerializer
    implements PrimitiveSerializer<ParentGlanceSnapshot> {
  @override
  final Iterable<Type> types = const [
    ParentGlanceSnapshot,
    _$ParentGlanceSnapshot
  ];

  @override
  final String wireName = r'ParentGlanceSnapshot';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ParentGlanceSnapshot object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.accuracy != null) {
      yield r'accuracy';
      yield serializers.serialize(
        object.accuracy,
        specifiedType: const FullType.nullable(num),
      );
    }
    if (object.avgScore != null) {
      yield r'avg_score';
      yield serializers.serialize(
        object.avgScore,
        specifiedType: const FullType.nullable(num),
      );
    }
    yield r'sessions_this_week';
    yield object.sessionsThisWeek == null
        ? null
        : serializers.serialize(
            object.sessionsThisWeek,
            specifiedType: const FullType.nullable(int),
          );
    yield r'streak_days';
    yield object.streakDays == null
        ? null
        : serializers.serialize(
            object.streakDays,
            specifiedType: const FullType.nullable(int),
          );
    if (object.timeMinutes != null) {
      yield r'time_minutes';
      yield serializers.serialize(
        object.timeMinutes,
        specifiedType: const FullType.nullable(num),
      );
    }
    if (object.totalChats != null) {
      yield r'total_chats';
      yield serializers.serialize(
        object.totalChats,
        specifiedType: const FullType.nullable(num),
      );
    }
    if (object.totalQuizzes != null) {
      yield r'total_quizzes';
      yield serializers.serialize(
        object.totalQuizzes,
        specifiedType: const FullType.nullable(num),
      );
    }
    if (object.xp != null) {
      yield r'xp';
      yield serializers.serialize(
        object.xp,
        specifiedType: const FullType.nullable(num),
      );
    }
  }

  @override
  Object serialize(
    Serializers serializers,
    ParentGlanceSnapshot object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object,
            specifiedType: specifiedType)
        .toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ParentGlanceSnapshotBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'accuracy':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(num),
          ) as num?;
          if (valueDes == null) continue;
          result.accuracy = valueDes;
          break;
        case r'avg_score':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(num),
          ) as num?;
          if (valueDes == null) continue;
          result.avgScore = valueDes;
          break;
        case r'sessions_this_week':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(int),
          ) as int?;
          if (valueDes == null) continue;
          result.sessionsThisWeek = valueDes;
          break;
        case r'streak_days':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(int),
          ) as int?;
          if (valueDes == null) continue;
          result.streakDays = valueDes;
          break;
        case r'time_minutes':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(num),
          ) as num?;
          if (valueDes == null) continue;
          result.timeMinutes = valueDes;
          break;
        case r'total_chats':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(num),
          ) as num?;
          if (valueDes == null) continue;
          result.totalChats = valueDes;
          break;
        case r'total_quizzes':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(num),
          ) as num?;
          if (valueDes == null) continue;
          result.totalQuizzes = valueDes;
          break;
        case r'xp':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(num),
          ) as num?;
          if (valueDes == null) continue;
          result.xp = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ParentGlanceSnapshot deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ParentGlanceSnapshotBuilder();
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
