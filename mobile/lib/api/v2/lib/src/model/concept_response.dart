//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:alfanumrik_api_v2/src/model/concept_source.dart';
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'concept_response.g.dart';

/// ConceptResponse
///
/// Properties:
/// * [chapterNumber] 
/// * [fellBackFromHindi] 
/// * [grade] 
/// * [language] 
/// * [markdown] 
/// * [schemaVersion] 
/// * [sources] 
/// * [subject] 
/// * [truncated] 
@BuiltValue()
abstract class ConceptResponse implements Built<ConceptResponse, ConceptResponseBuilder> {
  @BuiltValueField(wireName: r'chapter_number')
  int get chapterNumber;

  @BuiltValueField(wireName: r'fell_back_from_hindi')
  bool get fellBackFromHindi;

  @BuiltValueField(wireName: r'grade')
  String get grade;

  @BuiltValueField(wireName: r'language')
  ConceptResponseLanguageEnum get language;
  // enum languageEnum {  en,  hi,  };

  @BuiltValueField(wireName: r'markdown')
  String get markdown;

  @BuiltValueField(wireName: r'schemaVersion')
  ConceptResponseSchemaVersionEnum get schemaVersion;
  // enum schemaVersionEnum {  1,  };

  @BuiltValueField(wireName: r'sources')
  BuiltList<ConceptSource> get sources;

  @BuiltValueField(wireName: r'subject')
  String get subject;

  @BuiltValueField(wireName: r'truncated')
  bool get truncated;

  ConceptResponse._();

  factory ConceptResponse([void updates(ConceptResponseBuilder b)]) = _$ConceptResponse;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ConceptResponseBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ConceptResponse> get serializer => _$ConceptResponseSerializer();
}

class _$ConceptResponseSerializer implements PrimitiveSerializer<ConceptResponse> {
  @override
  final Iterable<Type> types = const [ConceptResponse, _$ConceptResponse];

  @override
  final String wireName = r'ConceptResponse';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ConceptResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'chapter_number';
    yield serializers.serialize(
      object.chapterNumber,
      specifiedType: const FullType(int),
    );
    yield r'fell_back_from_hindi';
    yield serializers.serialize(
      object.fellBackFromHindi,
      specifiedType: const FullType(bool),
    );
    yield r'grade';
    yield serializers.serialize(
      object.grade,
      specifiedType: const FullType(String),
    );
    yield r'language';
    yield serializers.serialize(
      object.language,
      specifiedType: const FullType(ConceptResponseLanguageEnum),
    );
    yield r'markdown';
    yield serializers.serialize(
      object.markdown,
      specifiedType: const FullType(String),
    );
    yield r'schemaVersion';
    yield serializers.serialize(
      object.schemaVersion,
      specifiedType: const FullType(ConceptResponseSchemaVersionEnum),
    );
    yield r'sources';
    yield serializers.serialize(
      object.sources,
      specifiedType: const FullType(BuiltList, [FullType(ConceptSource)]),
    );
    yield r'subject';
    yield serializers.serialize(
      object.subject,
      specifiedType: const FullType(String),
    );
    yield r'truncated';
    yield serializers.serialize(
      object.truncated,
      specifiedType: const FullType(bool),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    ConceptResponse object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ConceptResponseBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'chapter_number':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(int),
          ) as int;
          result.chapterNumber = valueDes;
          break;
        case r'fell_back_from_hindi':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(bool),
          ) as bool;
          result.fellBackFromHindi = valueDes;
          break;
        case r'grade':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.grade = valueDes;
          break;
        case r'language':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ConceptResponseLanguageEnum),
          ) as ConceptResponseLanguageEnum;
          result.language = valueDes;
          break;
        case r'markdown':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.markdown = valueDes;
          break;
        case r'schemaVersion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(ConceptResponseSchemaVersionEnum),
          ) as ConceptResponseSchemaVersionEnum;
          result.schemaVersion = valueDes;
          break;
        case r'sources':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(ConceptSource)]),
          ) as BuiltList<ConceptSource>;
          result.sources.replace(valueDes);
          break;
        case r'subject':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.subject = valueDes;
          break;
        case r'truncated':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(bool),
          ) as bool;
          result.truncated = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ConceptResponse deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ConceptResponseBuilder();
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

class ConceptResponseLanguageEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'en')
  static const ConceptResponseLanguageEnum en = _$conceptResponseLanguageEnum_en;
  @BuiltValueEnumConst(wireName: r'hi')
  static const ConceptResponseLanguageEnum hi = _$conceptResponseLanguageEnum_hi;

  static Serializer<ConceptResponseLanguageEnum> get serializer => _$conceptResponseLanguageEnumSerializer;

  const ConceptResponseLanguageEnum._(String name): super(name);

  static BuiltSet<ConceptResponseLanguageEnum> get values => _$conceptResponseLanguageEnumValues;
  static ConceptResponseLanguageEnum valueOf(String name) => _$conceptResponseLanguageEnumValueOf(name);
}

class ConceptResponseSchemaVersionEnum extends EnumClass {

  @BuiltValueEnumConst(wireName: r'1')
  static const ConceptResponseSchemaVersionEnum n1 = _$conceptResponseSchemaVersionEnum_n1;

  static Serializer<ConceptResponseSchemaVersionEnum> get serializer => _$conceptResponseSchemaVersionEnumSerializer;

  const ConceptResponseSchemaVersionEnum._(String name): super(name);

  static BuiltSet<ConceptResponseSchemaVersionEnum> get values => _$conceptResponseSchemaVersionEnumValues;
  static ConceptResponseSchemaVersionEnum valueOf(String name) => _$conceptResponseSchemaVersionEnumValueOf(name);
}

