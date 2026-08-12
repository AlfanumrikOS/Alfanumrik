//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'subject_not_allowed_details.g.dart';

/// SubjectNotAllowedDetails
///
/// Properties:
/// * [allowed] - The subject CODES valid for this student on the rejecting route. For the 403 governance rejection: unlocked codes only. For the learn routes: every subject in the student tree (locked included — locked subjects are still valid read params).
/// * [reason] - Cause discriminator. Governance rejections (403 subject_not_allowed) emit 'grade' (not in this student's grade subject list) or 'plan' (plan-locked); other SubjectWriteError reasons ('stream', 'inactive', 'unknown', 'max_subjects') are reserved. The learn routes' 400 UNKNOWN_SUBJECT emits 'unknown_subject'. Kept a string (not an enum) so adding a reason is non-breaking for generated clients.
/// * [subject] - The rejected subject value, verbatim as the client sent it.
@BuiltValue()
abstract class SubjectNotAllowedDetails implements Built<SubjectNotAllowedDetails, SubjectNotAllowedDetailsBuilder> {
  /// The subject CODES valid for this student on the rejecting route. For the 403 governance rejection: unlocked codes only. For the learn routes: every subject in the student tree (locked included — locked subjects are still valid read params).
  @BuiltValueField(wireName: r'allowed')
  BuiltList<String> get allowed;

  /// Cause discriminator. Governance rejections (403 subject_not_allowed) emit 'grade' (not in this student's grade subject list) or 'plan' (plan-locked); other SubjectWriteError reasons ('stream', 'inactive', 'unknown', 'max_subjects') are reserved. The learn routes' 400 UNKNOWN_SUBJECT emits 'unknown_subject'. Kept a string (not an enum) so adding a reason is non-breaking for generated clients.
  @BuiltValueField(wireName: r'reason')
  String get reason;

  /// The rejected subject value, verbatim as the client sent it.
  @BuiltValueField(wireName: r'subject')
  String get subject;

  SubjectNotAllowedDetails._();

  factory SubjectNotAllowedDetails([void updates(SubjectNotAllowedDetailsBuilder b)]) = _$SubjectNotAllowedDetails;

  @BuiltValueHook(initializeBuilder: true)
  static void _defaults(SubjectNotAllowedDetailsBuilder b) => b;

  @BuiltValueSerializer(custom: true)
  static Serializer<SubjectNotAllowedDetails> get serializer => _$SubjectNotAllowedDetailsSerializer();
}

class _$SubjectNotAllowedDetailsSerializer implements PrimitiveSerializer<SubjectNotAllowedDetails> {
  @override
  final Iterable<Type> types = const [SubjectNotAllowedDetails, _$SubjectNotAllowedDetails];

  @override
  final String wireName = r'SubjectNotAllowedDetails';

  Iterable<Object?> _serializeProperties(
    Serializers serializers,
    SubjectNotAllowedDetails object, {
    FullType specifiedType = FullType.unspecified,
  }) sync* {
    yield r'allowed';
    yield serializers.serialize(
      object.allowed,
      specifiedType: const FullType(BuiltList, [FullType(String)]),
    );
    yield r'reason';
    yield serializers.serialize(
      object.reason,
      specifiedType: const FullType(String),
    );
    yield r'subject';
    yield serializers.serialize(
      object.subject,
      specifiedType: const FullType(String),
    );
  }

  @override
  Object serialize(
    Serializers serializers,
    SubjectNotAllowedDetails object, {
    FullType specifiedType = FullType.unspecified,
  }) {
    return _serializeProperties(serializers, object, specifiedType: specifiedType).toList();
  }

  void _deserializeProperties(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
    required List<Object?> serializedList,
    required SubjectNotAllowedDetailsBuilder result,
    required List<Object?> unhandled,
  }) {
    for (var i = 0; i < serializedList.length; i += 2) {
      final key = serializedList[i] as String;
      final value = serializedList[i + 1];
      switch (key) {
        case r'allowed':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(BuiltList, [FullType(String)]),
          ) as BuiltList<String>;
          result.allowed.replace(valueDes);
          break;
        case r'reason':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.reason = valueDes;
          break;
        case r'subject':
          final valueDes = serializers.deserialize(
            value,
            specifiedType: const FullType(String),
          ) as String;
          result.subject = valueDes;
          break;
        default:
          unhandled.add(key);
          unhandled.add(value);
          break;
      }
    }
  }

  @override
  SubjectNotAllowedDetails deserialize(
    Serializers serializers,
    Object serialized, {
    FullType specifiedType = FullType.unspecified,
  }) {
    final result = SubjectNotAllowedDetailsBuilder();
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

