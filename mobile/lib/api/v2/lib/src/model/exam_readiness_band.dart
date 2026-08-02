//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//

// ignore_for_file: unused_element
import 'package:built_collection/built_collection.dart';
import 'package:built_value/built_value.dart';
import 'package:built_value/serializer.dart';

part 'exam_readiness_band.g.dart';

class ExamReadinessBand extends EnumClass {

  @BuiltValueEnumConst(wireName: r'exam_ready')
  static const ExamReadinessBand examReady = _$examReady;
  @BuiltValueEnumConst(wireName: r'getting_it')
  static const ExamReadinessBand gettingIt = _$gettingIt;
  @BuiltValueEnumConst(wireName: r'shaky')
  static const ExamReadinessBand shaky = _$shaky;
  @BuiltValueEnumConst(wireName: r'new')
  static const ExamReadinessBand new_ = _$new_;

  static Serializer<ExamReadinessBand> get serializer => _$examReadinessBandSerializer;

  const ExamReadinessBand._(String name): super(name);

  static BuiltSet<ExamReadinessBand> get values => _$values;
  static ExamReadinessBand valueOf(String name) => _$valueOf(name);
}

/// Optionally, enum_class can generate a mixin to go with your enum for use
/// with Angular. It exposes your enum constants as getters. So, if you mix it
/// in to your Dart component class, the values become available to the
/// corresponding Angular template.
///
/// Trigger mixin generation by writing a line like this one next to your enum.
abstract class ExamReadinessBandMixin = Object with _$ExamReadinessBandMixin;

