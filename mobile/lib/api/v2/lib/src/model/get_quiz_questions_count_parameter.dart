//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'dart:core';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';
import 'package:one_of/any_of.dart';

part 'get_quiz_questions_count_parameter.g.dart';

/// GetQuizQuestionsCountParameter
@BuiltValue()
abstract class GetQuizQuestionsCountParameter implements Built<GetQuizQuestionsCountParameter, GetQuizQuestionsCountParameterBuilder> {
  /// Any Of [num]
  AnyOf get anyOf;

  GetQuizQuestionsCountParameter._();

  factory GetQuizQuestionsCountParameter([void updates(GetQuizQuestionsCountParameterBuilder b)]) = _$GetQuizQuestionsCountParameter;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(GetQuizQuestionsCountParameterBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<GetQuizQuestionsCountParameter> get serializer => _$GetQuizQuestionsCountParameterSerializer();
}

class _$GetQuizQuestionsCountParameterSerializer implements PrimitiveSerializer<GetQuizQuestionsCountParameter> {
  @override
  final Iterable<Type> types = const [GetQuizQuestionsCountParameter, _$GetQuizQuestionsCountParameter];

  @override
  final String wireName = r'GetQuizQuestionsCountParameter';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    GetQuizQuestionsCountParameter object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
  }

  @override
  Object serialize(
    Serializers serializers,
    GetQuizQuestionsCountParameter object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final anyOf = object.anyOf;
    return serializers.serialize(anyOf, specifiedType: FullType(AnyOf, anyOf.valueTypes.map((type) => FullType(type)).toList()))!;
  }

  @override
  GetQuizQuestionsCountParameter deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = GetQuizQuestionsCountParameterBuilder();
    Object? anyOfDataSrc;
    final targetType = const FullType(AnyOf, [FullType(AnyOf0Enum), FullType(AnyOf1Enum), FullType(AnyOf2Enum), FullType(AnyOf3Enum), ]);
    anyOfDataSrc = serialized;
    result.anyOf = serializers.deserialize(anyOfDataSrc, specifiedType: targetType) as AnyOf;
    return result.build();
  }
}

