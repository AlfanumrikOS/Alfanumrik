//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:alfanumrik_api_v2/src/model/exam_schedule_entry_topic.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'exam_schedule_entry.g.dart';

/// ExamScheduleEntry
///
/// Properties:
/// * [chapters] 
/// * [editable] 
/// * [endsOn] 
/// * [id] 
/// * [setBy] 
/// * [setByInitials] 
/// * [source_] 
/// * [startsOn] 
/// * [title] 
@BuiltValue()
abstract class ExamScheduleEntry implements Built<ExamScheduleEntry, ExamScheduleEntryBuilder> {
  @BuiltValueField(wireName: r'chapters')
  BuiltList<ExamScheduleEntryTopic>? get chapters;

  @BuiltValueField(wireName: r'editable')
  bool? get editable;

  @BuiltValueField(wireName: r'endsOn')
  String get endsOn;

  @BuiltValueField(wireName: r'id')
  String get id;

  @BuiltValueField(wireName: r'setBy')
  String? get setBy;

  @BuiltValueField(wireName: r'setByInitials')
  String? get setByInitials;

  @BuiltValueField(wireName: r'source')
  ExamScheduleEntrySource_Enum get source_;
  // enum source_Enum {  school,  teacher,  student,  };

  @BuiltValueField(wireName: r'startsOn')
  String get startsOn;

  @BuiltValueField(wireName: r'title')
  String get title;

  ExamScheduleEntry._();

  factory ExamScheduleEntry([void updates(ExamScheduleEntryBuilder b)]) = _$ExamScheduleEntry;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ExamScheduleEntryBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ExamScheduleEntry> get serializer => _$ExamScheduleEntrySerializer();
}

class _$ExamScheduleEntrySerializer implements PrimitiveSerializer<ExamScheduleEntry> {
  @override
  final Iterable<Type> types = const [ExamScheduleEntry, _$ExamScheduleEntry];

  @override
  final String wireName = r'ExamScheduleEntry';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ExamScheduleEntry object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    if (object.chapters != null) {
      yield r'chapters';
      yield serializers.serialize(
        object.chapters,
        specifiedType: const FullType(BuiltList, [FullType(ExamScheduleEntryTopic)]),
      );
    }
    if (object.editable != null) {
      yield r'editable';
      yield serializers.serialize(
        object.editable,
        specifiedType: const FullType(bool),
      );
    }
    yield r'endsOn';
    yield serializers.serialize(
      object.endsOn,
      specifiedType: const FullType(String),
    );
    yield r'id';
    yield serializers.serialize(
      object.id,
      specifiedType: const FullType(String),
    );
    if (object.setBy != null) {
      yield r'setBy';
      yield serializers.serialize(
        object.setBy,
        specifiedType: const FullType(String),
      );
    }
    if (object.setByInitials != null) {
      yield r'setByInitials';
      yield serializers.serialize(
        object.setByInitials,
        specifiedType: const FullType(String),
      );
    }
    yield r'source';
    yield serializers.serialize(
      object.source_,
      specifiedType: const FullType(ExamScheduleEntrySource_Enum),
    );
    yield r'startsOn';
    yield serializers.serialize(
      object.startsOn,
      specifiedType: const FullType(String),
    );
    yield r'title';
    yield serializers.serialize(
      object.title,
      specifiedType: const FullType(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    ExamScheduleEntry object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ExamScheduleEntryBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'chapters':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ExamScheduleEntryTopic)]),
          ) as BuiltList<ExamScheduleEntryTopic>;
          result.chapters.replace(valueDes);
          break;
        case r'editable':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(bool),
          ) as bool;
          result.editable = valueDes;
          break;
        case r'endsOn':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.endsOn = valueDes;
          break;
        case r'id':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.id = valueDes;
          break;
        case r'setBy':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.setBy = valueDes;
          break;
        case r'setByInitials':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.setByInitials = valueDes;
          break;
        case r'source':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ExamScheduleEntrySource_Enum),
          ) as ExamScheduleEntrySource_Enum;
          result.source_ = valueDes;
          break;
        case r'startsOn':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.startsOn = valueDes;
          break;
        case r'title':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.title = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ExamScheduleEntry deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ExamScheduleEntryBuilder();
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

class ExamScheduleEntrySource_Enum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'school')
  static const ExamScheduleEntrySource_Enum school = _$examScheduleEntrySourceEnum_school;
  @BuiltValueEnumConst(wireName: r'teacher')
  static const ExamScheduleEntrySource_Enum teacher = _$examScheduleEntrySourceEnum_teacher;
  @BuiltValueEnumConst(wireName: r'student')
  static const ExamScheduleEntrySource_Enum student = _$examScheduleEntrySourceEnum_student;

  static Serializer<ExamScheduleEntrySource_Enum> get serializer => _$examScheduleEntrySourceEnumSerializer;

  const ExamScheduleEntrySource_Enum._(String name): super(name);

  static BuiltSet<ExamScheduleEntrySource_Enum> get values => _$examScheduleEntrySourceEnumValues;
  static ExamScheduleEntrySource_Enum valueOf(String name) => _$examScheduleEntrySourceEnumValueOf(name);
}

