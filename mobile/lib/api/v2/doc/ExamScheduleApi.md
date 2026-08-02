# alfanumrik_api_v2.api.ExamScheduleApi

## Load the API package
```dart
import 'package:alfanumrik_api_v2/api.dart';
```

All URIs are relative to */api*

Method | HTTP request | Description
------------- | ------------- | -------------
[**getExamSchedule**](ExamScheduleApi.md#getexamschedule) | **GET** /v2/exam-schedule | Three-tier exam schedule for the authenticated student


# **getExamSchedule**
> ExamScheduleResponse getExamSchedule()

Three-tier exam schedule for the authenticated student

Returns the school/teacher/student exam-schedule entries in school > teacher > student precedence order. Tier 2 (teacher-set, dated + chapter-scoped) is not bound yet — a fast-follow; only tier 3 (student_exam_entries) is populated today. Chapter mastery bands come from resolveExamReadinessBand(), a relabel of the canonical concept_mastery.mastery_level. Requires study_plan.view. 404 when ff_exam_schedule_v1 is off.

### Example
```dart
import 'package:alfanumrik_api_v2/api.dart';
// TODO Configure API key authorization: cookieAuth
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKey = 'YOUR_API_KEY';
// uncomment below to setup prefix (e.g. Bearer) for API key, if needed
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKeyPrefix = 'Bearer';

final api = AlfanumrikApiV2().getExamScheduleApi();

try {
    final response = api.getExamSchedule();
    print(response);
} catch on DioException (e) {
    print('Exception when calling ExamScheduleApi->getExamSchedule: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**ExamScheduleResponse**](ExamScheduleResponse.md)

### Authorization

[cookieAuth](../README.md#cookieAuth), [bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

