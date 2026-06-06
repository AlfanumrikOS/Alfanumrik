//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'progress_learning_velocity.g.dart';

/// ProgressLearningVelocity
///
/// Properties:
/// * [acceleration] 
/// * [predictedMasteryDate] 
/// * [subject] 
/// * [weeklyMasteryRate] 
@BuiltValue()
abstract class ProgressLearningVelocity implements Built<ProgressLearningVelocity, ProgressLearningVelocityBuilder> {
  @BuiltValueField(wireName: r'acceleration')
  num? get acceleration;

  @BuiltValueField(wireName: r'predicted_mastery_date')
  String? get predictedMasteryDate;

  @BuiltValueField(wireName: r'subject')
  String get subject;

  @BuiltValueField(wireName: r'weekly_mastery_rate')
  num? get weeklyMasteryRate;

  ProgressLearningVelocity._();

  factory ProgressLearningVelocity([void updates(ProgressLearningVelocityBuilder b)]) = _$ProgressLearningVelocity;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ProgressLearningVelocityBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ProgressLearningVelocity> get serializer => _$ProgressLearningVelocitySerializer();
}

class _$ProgressLearningVelocitySerializer implements PrimitiveSerializer<ProgressLearningVelocity> {
  @override
  final Iterable<Type> types = const [ProgressLearningVelocity, _$ProgressLearningVelocity];

  @override
  final String wireName = r'ProgressLearningVelocity';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ProgressLearningVelocity object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'acceleration';
    yield object.acceleration == null ? null : serializers.serialize(
      object.acceleration,
      specifiedType: const FullType.nullable(num),
    );
    yield r'predicted_mastery_date';
    yield object.predictedMasteryDate == null ? null : serializers.serialize(
      object.predictedMasteryDate,
      specifiedType: const FullType.nullable(String),
    );
    yield r'subject';
    yield serializers.serialize(
      object.subject,
      specifiedType: const FullType(String),
    );
    yield r'weekly_mastery_rate';
    yield object.weeklyMasteryRate == null ? null : serializers.serialize(
      object.weeklyMasteryRate,
      specifiedType: const FullType.nullable(num),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    ProgressLearningVelocity object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ProgressLearningVelocityBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'acceleration':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(num),
          ) as num?;
          if (valueDes == null) continue;
          result.acceleration = valueDes;
          break;
        case r'predicted_mastery_date':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.predictedMasteryDate = valueDes;
          break;
        case r'subject':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.subject = valueDes;
          break;
        case r'weekly_mastery_rate':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(num),
          ) as num?;
          if (valueDes == null) continue;
          result.weeklyMasteryRate = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ProgressLearningVelocity deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ProgressLearningVelocityBuilder();
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

