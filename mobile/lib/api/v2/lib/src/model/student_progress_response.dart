//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:alfanumrik_api_v2/src/model/progress_knowledge_gap.dart';
import 'package:alfanumrik_api_v2/src/model/progress_performance_score.dart';
import 'package:built_collection/built_collection.dart';
import 'package:alfanumrik_api_v2/src/model/progress_decay_topic.dart';
import 'package:alfanumrik_api_v2/src/model/progress_learning_velocity.dart';
import 'package:alfanumrik_api_v2/src/model/progress_topic_mastery.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'student_progress_response.g.dart';

/// StudentProgressResponse
///
/// Properties:
/// * [decayTopics] 
/// * [knowledgeGaps] 
/// * [learningVelocity] 
/// * [performanceScores] 
/// * [schemaVersion] 
/// * [studentId] 
/// * [topicMastery] 
@BuiltValue()
abstract class StudentProgressResponse implements Built<StudentProgressResponse, StudentProgressResponseBuilder> {
  @BuiltValueField(wireName: r'decay_topics')
  BuiltList<ProgressDecayTopic> get decayTopics;

  @BuiltValueField(wireName: r'knowledge_gaps')
  BuiltList<ProgressKnowledgeGap> get knowledgeGaps;

  @BuiltValueField(wireName: r'learning_velocity')
  BuiltList<ProgressLearningVelocity> get learningVelocity;

  @BuiltValueField(wireName: r'performance_scores')
  BuiltList<ProgressPerformanceScore> get performanceScores;

  @BuiltValueField(wireName: r'schemaVersion')
  StudentProgressResponseSchemaVersionEnum get schemaVersion;
  // enum schemaVersionEnum {  1,  };

  @BuiltValueField(wireName: r'student_id')
  String get studentId;

  @BuiltValueField(wireName: r'topic_mastery')
  BuiltList<ProgressTopicMastery> get topicMastery;

  StudentProgressResponse._();

  factory StudentProgressResponse([void updates(StudentProgressResponseBuilder b)]) = _$StudentProgressResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(StudentProgressResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<StudentProgressResponse> get serializer => _$StudentProgressResponseSerializer();
}

class _$StudentProgressResponseSerializer implements PrimitiveSerializer<StudentProgressResponse> {
  @override
  final Iterable<Type> types = const [StudentProgressResponse, _$StudentProgressResponse];

  @override
  final String wireName = r'StudentProgressResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    StudentProgressResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'decay_topics';
    yield serializers.serialize(
      object.decayTopics,
      specifiedType: const FullType(BuiltList, [FullType(ProgressDecayTopic)]),
    );
    yield r'knowledge_gaps';
    yield serializers.serialize(
      object.knowledgeGaps,
      specifiedType: const FullType(BuiltList, [FullType(ProgressKnowledgeGap)]),
    );
    yield r'learning_velocity';
    yield serializers.serialize(
      object.learningVelocity,
      specifiedType: const FullType(BuiltList, [FullType(ProgressLearningVelocity)]),
    );
    yield r'performance_scores';
    yield serializers.serialize(
      object.performanceScores,
      specifiedType: const FullType(BuiltList, [FullType(ProgressPerformanceScore)]),
    );
    yield r'schemaVersion';
    yield serializers.serialize(
      object.schemaVersion,
      specifiedType: const FullType(StudentProgressResponseSchemaVersionEnum),
    );
    yield r'student_id';
    yield serializers.serialize(
      object.studentId,
      specifiedType: const FullType(String),
    );
    yield r'topic_mastery';
    yield serializers.serialize(
      object.topicMastery,
      specifiedType: const FullType(BuiltList, [FullType(ProgressTopicMastery)]),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    StudentProgressResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required StudentProgressResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'decay_topics':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ProgressDecayTopic)]),
          ) as BuiltList<ProgressDecayTopic>;
          result.decayTopics.replace(valueDes);
          break;
        case r'knowledge_gaps':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ProgressKnowledgeGap)]),
          ) as BuiltList<ProgressKnowledgeGap>;
          result.knowledgeGaps.replace(valueDes);
          break;
        case r'learning_velocity':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ProgressLearningVelocity)]),
          ) as BuiltList<ProgressLearningVelocity>;
          result.learningVelocity.replace(valueDes);
          break;
        case r'performance_scores':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ProgressPerformanceScore)]),
          ) as BuiltList<ProgressPerformanceScore>;
          result.performanceScores.replace(valueDes);
          break;
        case r'schemaVersion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(StudentProgressResponseSchemaVersionEnum),
          ) as StudentProgressResponseSchemaVersionEnum;
          result.schemaVersion = valueDes;
          break;
        case r'student_id':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.studentId = valueDes;
          break;
        case r'topic_mastery':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ProgressTopicMastery)]),
          ) as BuiltList<ProgressTopicMastery>;
          result.topicMastery.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  StudentProgressResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = StudentProgressResponseBuilder();
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

class StudentProgressResponseSchemaVersionEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'1')
  static const StudentProgressResponseSchemaVersionEnum n1 = _$studentProgressResponseSchemaVersionEnum_n1;

  static Serializer<StudentProgressResponseSchemaVersionEnum> get serializer => _$studentProgressResponseSchemaVersionEnumSerializer;

  const StudentProgressResponseSchemaVersionEnum._(String name): super(name);

  static BuiltSet<StudentProgressResponseSchemaVersionEnum> get values => _$studentProgressResponseSchemaVersionEnumValues;
  static StudentProgressResponseSchemaVersionEnum valueOf(String name) => _$studentProgressResponseSchemaVersionEnumValueOf(name);
}

