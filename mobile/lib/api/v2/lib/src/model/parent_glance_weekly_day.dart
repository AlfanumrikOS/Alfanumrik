//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'parent_glance_weekly_day.g.dart';

/// ParentGlanceWeeklyDay
///
/// Properties:
/// * [active] 
/// * [label] 
/// * [quizzes] 
@BuiltValue()
abstract class ParentGlanceWeeklyDay implements Built<ParentGlanceWeeklyDay, ParentGlanceWeeklyDayBuilder> {
  @BuiltValueField(wireName: r'active')
  bool get active;

  @BuiltValueField(wireName: r'label')
  String get label;

  @BuiltValueField(wireName: r'quizzes')
  int get quizzes;

  ParentGlanceWeeklyDay._();

  factory ParentGlanceWeeklyDay([void updates(ParentGlanceWeeklyDayBuilder b)]) = _$ParentGlanceWeeklyDay;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ParentGlanceWeeklyDayBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ParentGlanceWeeklyDay> get serializer => _$ParentGlanceWeeklyDaySerializer();
}

class _$ParentGlanceWeeklyDaySerializer implements PrimitiveSerializer<ParentGlanceWeeklyDay> {
  @override
  final Iterable<Type> types = const [ParentGlanceWeeklyDay, _$ParentGlanceWeeklyDay];

  @override
  final String wireName = r'ParentGlanceWeeklyDay';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ParentGlanceWeeklyDay object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'active';
    yield serializers.serialize(
      object.active,
      specifiedType: const FullType(bool),
    );
    yield r'label';
    yield serializers.serialize(
      object.label,
      specifiedType: const FullType(String),
    );
    yield r'quizzes';
    yield serializers.serialize(
      object.quizzes,
      specifiedType: const FullType(int),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    ParentGlanceWeeklyDay object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ParentGlanceWeeklyDayBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'active':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(bool),
          ) as bool;
          result.active = valueDes;
          break;
        case r'label':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.label = valueDes;
          break;
        case r'quizzes':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.quizzes = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ParentGlanceWeeklyDay deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ParentGlanceWeeklyDayBuilder();
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

