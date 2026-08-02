//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:alfanumrik_api_v2/src/model/exam_readiness_band.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'exam_schedule_entry_topic.g.dart';

/// ExamScheduleEntryTopic
///
/// Properties:
/// * [band] 
/// * [id] 
/// * [label] 
@BuiltValue()
abstract class ExamScheduleEntryTopic implements Built<ExamScheduleEntryTopic, ExamScheduleEntryTopicBuilder> {
  @BuiltValueField(wireName: r'band')
  ExamReadinessBand get band;
  // enum bandEnum {  exam_ready,  getting_it,  shaky,  new,  };

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'label')
  String get label;

  ExamScheduleEntryTopic._();

  factory ExamScheduleEntryTopic([void updates(ExamScheduleEntryTopicBuilder b)]) = _$ExamScheduleEntryTopic;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ExamScheduleEntryTopicBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ExamScheduleEntryTopic> get serializer => _$ExamScheduleEntryTopicSerializer();
}

class _$ExamScheduleEntryTopicSerializer implements PrimitiveSerializer<ExamScheduleEntryTopic> {
  @override
  final Iterable<Type> types = const [ExamScheduleEntryTopic, _$ExamScheduleEntryTopic];

  @override
  final String wireName = r'ExamScheduleEntryTopic';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ExamScheduleEntryTopic object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'band';
    yield serializers.serialize(
      object.band,
      specifiedType: const FullType(ExamReadinessBand),
    );
    yield r'id';
    yield serializers.serialize(
      object.id,
      specifiedType: const FullType(String),
    );
    yield r'label';
    yield serializers.serialize(
      object.label,
      specifiedType: const FullType(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    ExamScheduleEntryTopic object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ExamScheduleEntryTopicBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'band':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ExamReadinessBand),
          ) as ExamReadinessBand;
          result.band = valueDes;
          break;
        case r'id':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.id = valueDes;
          break;
        case r'label':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.label = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ExamScheduleEntryTopic deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ExamScheduleEntryTopicBuilder();
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

