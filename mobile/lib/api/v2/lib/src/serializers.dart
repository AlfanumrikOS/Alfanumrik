//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_import

import 'package:one_of_serializer/any_of_serializer.dart';
import 'package:one_of_serializer/one_of_serializer.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/json_object.dart';
import 'package:built_value/serializer.dart';
import 'package:built_value/standard_json_plugin.dart';
import 'package:built_value/iso_8601_date_time_serializer.dart';
import 'package:alfanumrik_api_v2/src/date_serializer.dart';
import 'package:alfanumrik_api_v2/src/model/date.dart';

import 'package:alfanumrik_api_v2/src/model/concept_response.dart';
import 'package:alfanumrik_api_v2/src/model/concept_source.dart';
import 'package:alfanumrik_api_v2/src/model/curriculum_chapter.dart';
import 'package:alfanumrik_api_v2/src/model/curriculum_response.dart';
import 'package:alfanumrik_api_v2/src/model/curriculum_subject.dart';
import 'package:alfanumrik_api_v2/src/model/curriculum_topic.dart';
import 'package:alfanumrik_api_v2/src/model/encourage_request.dart';
import 'package:alfanumrik_api_v2/src/model/error_response.dart';
import 'package:alfanumrik_api_v2/src/model/leaderboard_entry.dart';
import 'package:alfanumrik_api_v2/src/model/leaderboard_response.dart';
import 'package:alfanumrik_api_v2/src/model/parent_child.dart';
import 'package:alfanumrik_api_v2/src/model/parent_children_response.dart';
import 'package:alfanumrik_api_v2/src/model/parent_glance_child.dart';
import 'package:alfanumrik_api_v2/src/model/parent_glance_moments.dart';
import 'package:alfanumrik_api_v2/src/model/parent_glance_response.dart';
import 'package:alfanumrik_api_v2/src/model/parent_glance_snapshot.dart';
import 'package:alfanumrik_api_v2/src/model/parent_glance_weekly_day.dart';
import 'package:alfanumrik_api_v2/src/model/progress_decay_topic.dart';
import 'package:alfanumrik_api_v2/src/model/progress_knowledge_gap.dart';
import 'package:alfanumrik_api_v2/src/model/progress_learning_velocity.dart';
import 'package:alfanumrik_api_v2/src/model/progress_performance_score.dart';
import 'package:alfanumrik_api_v2/src/model/progress_topic_mastery.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_question.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_questions_response.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_start_question.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_start_request.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_start_response.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_submit_request.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_submit_response_item.dart';
import 'package:alfanumrik_api_v2/src/model/quiz_submit_result.dart';
import 'package:alfanumrik_api_v2/src/model/student_profile_response.dart';
import 'package:alfanumrik_api_v2/src/model/student_progress_response.dart';
import 'package:alfanumrik_api_v2/src/model/success_ack.dart';
import 'package:alfanumrik_api_v2/src/model/today_deep_link.dart';
import 'package:alfanumrik_api_v2/src/model/today_deep_link_params_value.dart';
import 'package:alfanumrik_api_v2/src/model/today_item_type.dart';
import 'package:alfanumrik_api_v2/src/model/today_queue_item.dart';
import 'package:alfanumrik_api_v2/src/model/today_response.dart';
import 'package:alfanumrik_api_v2/src/model/today_response_meta.dart';

part 'serializers.g.dart';

@SerializersFor([
  ConceptResponse,
  ConceptSource,
  CurriculumChapter,
  CurriculumResponse,
  CurriculumSubject,
  CurriculumTopic,
  EncourageRequest,
  ErrorResponse,
  LeaderboardEntry,
  LeaderboardResponse,
  ParentChild,
  ParentChildrenResponse,
  ParentGlanceChild,
  ParentGlanceMoments,
  ParentGlanceResponse,
  ParentGlanceSnapshot,
  ParentGlanceWeeklyDay,
  ProgressDecayTopic,
  ProgressKnowledgeGap,
  ProgressLearningVelocity,
  ProgressPerformanceScore,
  ProgressTopicMastery,
  QuizQuestion,
  QuizQuestionsResponse,
  QuizStartQuestion,
  QuizStartRequest,
  QuizStartResponse,
  QuizSubmitRequest,
  QuizSubmitResponseItem,
  QuizSubmitResult,
  StudentProfileResponse,
  StudentProgressResponse,
  SuccessAck,
  TodayDeepLink,
  TodayDeepLinkParamsValue,
  TodayItemType,
  TodayQueueItem,
  TodayResponse,
  TodayResponseMeta,
])
Serializers serializers = (_$serializers.toBuilder()
      ..addBuilderFactory(
        const FullType(BuiltMap, [FullType(String), FullType.nullable(JsonObject)]),
        () => MapBuilder<String, JsonObject>(),
      )
      ..add(const OneOfSerializer())
      ..add(const AnyOfSerializer())
      ..add(const DateSerializer())
      ..add(Iso8601DateTimeSerializer()))
    .build();

Serializers standardSerializers =
    (serializers.toBuilder()..addPlugin(StandardJsonPlugin())).build();
