# alfanumrik_api_v2.api.LearnApi

## Load the API package
```dart
import 'package:alfanumrik_api_v2/api.dart';
```

All URIs are relative to */api*

Method | HTTP request | Description
------------- | ------------- | -------------
[**getLearnConcept**](LearnApi.md#getlearnconcept) | **GET** /v2/learn/concept | Concept content for a subject + chapter
[**getLearnCurriculum**](LearnApi.md#getlearncurriculum) | **GET** /v2/learn/curriculum | Curriculum tree (subjects → chapters → topics)


# **getLearnConcept**
> ConceptResponse getLearnConcept(subject, grade, chapter)

Concept content for a subject + chapter

Returns the ordered NCERT chapter prose (markdown + source attribution) for a subject + chapter. Reuses fetchChapterContent (rag_content_chunks read used by /learn). An unknown `subject` is a 400 UNKNOWN_SUBJECT — the 404 NO_CONTENT response is reserved for a KNOWN subject whose chapter genuinely has no content. Requires study_plan.view.

### Example
```dart
import 'package:alfanumrik_api_v2/api.dart';
// TODO Configure API key authorization: cookieAuth
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKey = 'YOUR_API_KEY';
// uncomment below to setup prefix (e.g. Bearer) for API key, if needed
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKeyPrefix = 'Bearer';

final api = AlfanumrikApiV2().getLearnApi();
final String subject = science; // String | Subject CODE (e.g. `math`, `science`) — NOT the display name (\"Mathematics\"). A value matching none of the student's subjects returns 400 UNKNOWN_SUBJECT with details: SubjectNotAllowedDetails listing the valid codes.
final String grade = grade_example; // String | 
final int chapter = 3; // int | 

try {
    final response = api.getLearnConcept(subject, grade, chapter);
    print(response);
} catch on DioException (e) {
    print('Exception when calling LearnApi->getLearnConcept: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **subject** | **String**| Subject CODE (e.g. `math`, `science`) — NOT the display name (\"Mathematics\"). A value matching none of the student's subjects returns 400 UNKNOWN_SUBJECT with details: SubjectNotAllowedDetails listing the valid codes. | 
 **grade** | **String**|  | 
 **chapter** | **int**|  | 

### Return type

[**ConceptResponse**](ConceptResponse.md)

### Authorization

[cookieAuth](../README.md#cookieAuth), [bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **getLearnCurriculum**
> CurriculumResponse getLearnCurriculum(subject)

Curriculum tree (subjects → chapters → topics)

Returns the plan-gated curriculum tree the mobile Learn screen needs. Reuses get_available_subjects (plan/grade/stream gating) + curriculum_topics. An unknown `subject` filter is a 400 UNKNOWN_SUBJECT (never an empty-success 200 — that shape is reserved for a student who genuinely has zero subjects and sent no filter). Requires study_plan.view.

### Example
```dart
import 'package:alfanumrik_api_v2/api.dart';
// TODO Configure API key authorization: cookieAuth
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKey = 'YOUR_API_KEY';
// uncomment below to setup prefix (e.g. Bearer) for API key, if needed
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKeyPrefix = 'Bearer';

final api = AlfanumrikApiV2().getLearnApi();
final String subject = math; // String | Optional filter. Subject CODE (e.g. `math`, `science`) — NOT the display name (\"Mathematics\"). A value matching none of the student's subjects returns 400 UNKNOWN_SUBJECT with details: SubjectNotAllowedDetails listing the valid codes (locked subjects included — they are valid filter values and render with is_locked).

try {
    final response = api.getLearnCurriculum(subject);
    print(response);
} catch on DioException (e) {
    print('Exception when calling LearnApi->getLearnCurriculum: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **subject** | **String**| Optional filter. Subject CODE (e.g. `math`, `science`) — NOT the display name (\"Mathematics\"). A value matching none of the student's subjects returns 400 UNKNOWN_SUBJECT with details: SubjectNotAllowedDetails listing the valid codes (locked subjects included — they are valid filter values and render with is_locked). | [optional] 

### Return type

[**CurriculumResponse**](CurriculumResponse.md)

### Authorization

[cookieAuth](../README.md#cookieAuth), [bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

