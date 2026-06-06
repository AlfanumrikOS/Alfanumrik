//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:alfanumrik_api_v2/src/model/curriculum_chapter.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'curriculum_subject.g.dart';

/// CurriculumSubject
///
/// Properties:
/// * [chapters] 
/// * [code] 
/// * [isLocked] 
/// * [name] 
/// * [nameHi] 
@BuiltValue()
abstract class CurriculumSubject implements Built<CurriculumSubject, CurriculumSubjectBuilder> {
  @BuiltValueField(wireName: r'chapters')
  BuiltList<CurriculumChapter> get chapters;

  @BuiltValueField(wireName: r'code')
  String get code;

  @BuiltValueField(wireName: r'is_locked')
  bool get isLocked;

  @BuiltValueField(wireName: r'name')
  String get name;

  @BuiltValueField(wireName: r'name_hi')
  String? get nameHi;

  CurriculumSubject._();

  factory CurriculumSubject([void updates(CurriculumSubjectBuilder b)]) = _$CurriculumSubject;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(CurriculumSubjectBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<CurriculumSubject> get serializer => _$CurriculumSubjectSerializer();
}

class _$CurriculumSubjectSerializer implements PrimitiveSerializer<CurriculumSubject> {
  @override
  final Iterable<Type> types = const [CurriculumSubject, _$CurriculumSubject];

  @override
  final String wireName = r'CurriculumSubject';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    CurriculumSubject object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'chapters';
    yield serializers.serialize(
      object.chapters,
      specifiedType: const FullType(BuiltList, [FullType(CurriculumChapter)]),
    );
    yield r'code';
    yield serializers.serialize(
      object.code,
      specifiedType: const FullType(String),
    );
    yield r'is_locked';
    yield serializers.serialize(
      object.isLocked,
      specifiedType: const FullType(bool),
    );
    yield r'name';
    yield serializers.serialize(
      object.name,
      specifiedType: const FullType(String),
    );
    yield r'name_hi';
    yield object.nameHi == null ? null : serializers.serialize(
      object.nameHi,
      specifiedType: const FullType.nullable(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    CurriculumSubject object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required CurriculumSubjectBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'chapters':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(CurriculumChapter)]),
          ) as BuiltList<CurriculumChapter>;
          result.chapters.replace(valueDes);
          break;
        case r'code':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.code = valueDes;
          break;
        case r'is_locked':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(bool),
          ) as bool;
          result.isLocked = valueDes;
          break;
        case r'name':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.name = valueDes;
          break;
        case r'name_hi':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.nameHi = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  CurriculumSubject deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = CurriculumSubjectBuilder();
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

