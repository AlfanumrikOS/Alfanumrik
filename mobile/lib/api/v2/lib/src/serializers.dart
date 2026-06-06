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

import 'package:alfanumrik_api_v2/src/model/encourage_request.dart';
import 'package:alfanumrik_api_v2/src/model/error_response.dart';
import 'package:alfanumrik_api_v2/src/model/success_ack.dart';
import 'package:alfanumrik_api_v2/src/model/today_deep_link.dart';
import 'package:alfanumrik_api_v2/src/model/today_deep_link_params_value.dart';
import 'package:alfanumrik_api_v2/src/model/today_item_type.dart';
import 'package:alfanumrik_api_v2/src/model/today_queue_item.dart';
import 'package:alfanumrik_api_v2/src/model/today_response.dart';
import 'package:alfanumrik_api_v2/src/model/today_response_meta.dart';

part 'serializers.g.dart';

@SerializersFor([
  EncourageRequest,
  ErrorResponse,
  SuccessAck,
  TodayDeepLink,
  TodayDeepLinkParamsValue,
  TodayItemType,
  TodayQueueItem,
  TodayResponse,
  TodayResponseMeta,
])
Serializers serializers = (_$serializers.toBuilder()
      ..add(const OneOfSerializer())
      ..add(const AnyOfSerializer())
      ..add(const DateSerializer())
      ..add(Iso8601DateTimeSerializer()))
    .build();

Serializers standardSerializers =
    (serializers.toBuilder()..addPlugin(StandardJsonPlugin())).build();
