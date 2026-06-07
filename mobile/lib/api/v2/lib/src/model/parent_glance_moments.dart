//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'parent_glance_moments.g.dart';

/// ParentGlanceMoments
///
/// Properties:
/// * [concerns] 
/// * [highlights] 
/// * [suggestion] 
@BuiltValue()
abstract class ParentGlanceMoments implements Built<ParentGlanceMoments, ParentGlanceMomentsBuilder> {
  @BuiltValueField(wireName: r'concerns')
  BuiltList<String> get concerns;

  @BuiltValueField(wireName: r'highlights')
  BuiltList<String> get highlights;

  @BuiltValueField(wireName: r'suggestion')
  String? get suggestion;

  ParentGlanceMoments._();

  factory ParentGlanceMoments([void updates(ParentGlanceMomentsBuilder b)]) = _$ParentGlanceMoments;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(ParentGlanceMomentsBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<ParentGlanceMoments> get serializer => _$ParentGlanceMomentsSerializer();
}

class _$ParentGlanceMomentsSerializer implements PrimitiveSerializer<ParentGlanceMoments> {
  @override
  final Iterable<Type> types = const [ParentGlanceMoments, _$ParentGlanceMoments];

  @override
  final String wireName = r'ParentGlanceMoments';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    ParentGlanceMoments object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'concerns';
    yield serializers.serialize(
      object.concerns,
      specifiedType: const FullType(BuiltList, [FullType(String)]),
    );
    yield r'highlights';
    yield serializers.serialize(
      object.highlights,
      specifiedType: const FullType(BuiltList, [FullType(String)]),
    );
    if (object.suggestion != null) {
      yield r'suggestion';
      yield serializers.serialize(
        object.suggestion,
        specifiedType: const FullType.nullable(String),
      );
    }
  }

  @override
  Object serialize(
    Serializers serializers,
    ParentGlanceMoments object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required ParentGlanceMomentsBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'concerns':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.concerns.replace(valueDes);
          break;
        case r'highlights':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.highlights.replace(valueDes);
          break;
        case r'suggestion':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType.nullable(String),
          ) as String?;
          if (valueDes == null) continue;
          result.suggestion = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  ParentGlanceMoments deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = ParentGlanceMomentsBuilder();
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

