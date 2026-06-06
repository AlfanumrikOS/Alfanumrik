//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:alfanumrik_api_v2/src/model/curriculum_topic.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'curriculum_chapter.g.dart';

/// CurriculumChapter
///
/// Properties:
/// * [chapterNumber] 
/// * [title] 
/// * [titleHi] 
/// * [topics] 
@BuiltValue()
abstract class CurriculumChapter implements Built<CurriculumChapter, CurriculumChapterBuilder> {
  @BuiltValueField(wireName: r'chapter_number')
  int? get chapterNumber;

  @BuiltValueField(wireName: r'title')
  String? get title;

  @BuiltValueField(wireName: r'title_hi')
  String? get titleHi;

  @BuiltValueField(wireName: r'topics')
  BuiltList<CurriculumTopic> get topics;

  CurriculumChapter._();

  factory CurriculumChapter([void updates(CurriculumChapterBuilder b)]) = _$CurriculumChapter;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(CurriculumChapterBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<CurriculumChapter> get serializer => _$CurriculumChapterSerializer();
}

class _$CurriculumChapterSerializer implements PrimitiveSerializer<CurriculumChapter> {
  @override
  final Iterable<Type> types = const [CurriculumChapter, _$CurriculumChapter];

  @override
  final String wireName = r'CurriculumChapter';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    CurriculumChapter object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'chapter_number';
    yield object.chapterNumber == null ? null : serializers.serialize(
      object.chapterNumber,
      specifiedType: const FullType.nullable(int),
    );
    yield r'title';
    yield object.title == null ? null : serializers.serialize(
      object.title,
      specifiedType: const FullType.nullable(String),
    );
    yield r'title_hi';
    yield object.titleHi == null ? null : serializers.serialize(
      object.titleHi,
      specifiedType: const FullType.nullable(String),
    );
    yield r'topics';
    yield serializers.serialize(
      object.topics,
      specifiedType: const FullType(BuiltList, [FullType(CurriculumTopic)]),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    CurriculumChapter object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required CurriculumChapterBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'chapter_number':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(int),
          ) as int?;
          if (valueDes == null) continue;
          result.chapterNumber = valueDes;
          break;
        case r'title':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.title = valueDes;
          break;
        case r'title_hi':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.titleHi = valueDes;
          break;
        case r'topics':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(CurriculumTopic)]),
          ) as BuiltList<CurriculumTopic>;
          result.topics.replace(valueDes);
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  CurriculumChapter deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = CurriculumChapterBuilder();
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

