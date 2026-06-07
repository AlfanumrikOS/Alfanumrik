# alfanumrik_api_v2.api.QuizApi

## Load the API package
```dart
import 'package:alfanumrik_api_v2/api.dart';
```

All URIs are relative to */api*

Method | HTTP request | Description
------------- | ------------- | -------------
[**getQuizQuestions**](QuizApi.md#getquizquestions) | **GET** /v2/quiz/questions | Fetch quiz questions in academic scope
[**postQuizStart**](QuizApi.md#postquizstart) | **POST** /v2/quiz/start | Start a server-shuffled quiz session
[**postQuizSubmit**](QuizApi.md#postquizsubmit) | **POST** /v2/quiz/submit | Submit a quiz for server-authoritative grading


# **getQuizQuestions**
> QuizQuestionsResponse getQuizQuestions(subject, grade, count, chapter, difficulty, mode)

Fetch quiz questions in academic scope

Returns in-scope quiz questions for the authenticated student. Reuses the select_quiz_questions_rag path with subject-governance + academic-scope checks. correct_answer_index is NEVER returned (P6). 422 with { available, requested, scope } when a chapter is set and fewer than `count` in-scope questions exist. Requires quiz.attempt.

### Example
```dart
import 'package:alfanumrik_api_v2/api.dart';
// TODO Configure API key authorization: cookieAuth
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKey = 'YOUR_API_KEY';
// uncomment below to setup prefix (e.g. Bearer) for API key, if needed
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKeyPrefix = 'Bearer';

final api = AlfanumrikApiV2().getQuizApi();
final String subject = math; // String | 
final String grade = grade_example; // String | 
final int count = 10; // int | 
final int chapter = 56; // int | 
final String difficulty = difficulty_example; // String | 
final String mode = mode_example; // String | 

try {
    final response = api.getQuizQuestions(subject, grade, count, chapter, difficulty, mode);
    print(response);
} catch on DioException (e) {
    print('Exception when calling QuizApi->getQuizQuestions: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **subject** | **String**|  | 
 **grade** | **String**|  | 
 **count** | **int**|  | 
 **chapter** | **int**|  | [optional] 
 **difficulty** | **String**|  | [optional] 
 **mode** | **String**|  | [optional] 

### Return type

[**QuizQuestionsResponse**](QuizQuestionsResponse.md)

### Authorization

[cookieAuth](../README.md#cookieAuth), [bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **postQuizStart**
> QuizStartResponse postQuizStart(quizStartRequest)

Start a server-shuffled quiz session

Creates a quiz session via the start_quiz_session RPC (server-owned shuffle authority). Returns the per-session shuffled options; the shuffle_map and correct index stay server-side (P6). studentId is cross-checked against the JWT (403 on mismatch). Requires quiz.attempt.

### Example
```dart
import 'package:alfanumrik_api_v2/api.dart';
// TODO Configure API key authorization: cookieAuth
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKey = 'YOUR_API_KEY';
// uncomment below to setup prefix (e.g. Bearer) for API key, if needed
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKeyPrefix = 'Bearer';

final api = AlfanumrikApiV2().getQuizApi();
final QuizStartRequest quizStartRequest = ; // QuizStartRequest | 

try {
    final response = api.postQuizStart(quizStartRequest);
    print(response);
} catch on DioException (e) {
    print('Exception when calling QuizApi->postQuizStart: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **quizStartRequest** | [**QuizStartRequest**](QuizStartRequest.md)|  | [optional] 

### Return type

[**QuizStartResponse**](QuizStartResponse.md)

### Authorization

[cookieAuth](../README.md#cookieAuth), [bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **postQuizSubmit**
> QuizSubmitResult postQuizSubmit(quizSubmitRequest)

Submit a quiz for server-authoritative grading

Thin pass-through to the submit_quiz_results_v2 RPC, which owns P1 scoring, P2 XP + 200/day cap, all 3 P3 anti-cheat checks, and P4 atomicity. The route does NO score / XP / anti-cheat math — it forwards inputs and returns the RPC result verbatim. Requires an Idempotency-Key (UUID) header and quiz.attempt. studentId is cross-checked against the JWT (403 on mismatch). When attemptMode === offline_replay the route runs offline gates BEFORE the RPC: capturedAt required (400 OFFLINE_CAPTURED_AT_REQUIRED), clock-skew (422 REPLAY_CLOCK_INVALID), staleness >168h (422 REPLAY_TOO_STALE), clientCapturedTotalSeconds mismatch (400 OFFLINE_TIME_INCONSISTENT), and shuffle-map verification against the server snapshot (422 SHUFFLE_MAP_MISMATCH). Online submissions are byte-identical to today — no offline gate fires.

### Example
```dart
import 'package:alfanumrik_api_v2/api.dart';
// TODO Configure API key authorization: cookieAuth
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKey = 'YOUR_API_KEY';
// uncomment below to setup prefix (e.g. Bearer) for API key, if needed
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKeyPrefix = 'Bearer';

final api = AlfanumrikApiV2().getQuizApi();
final QuizSubmitRequest quizSubmitRequest = ; // QuizSubmitRequest | 

try {
    final response = api.postQuizSubmit(quizSubmitRequest);
    print(response);
} catch on DioException (e) {
    print('Exception when calling QuizApi->postQuizSubmit: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **quizSubmitRequest** | [**QuizSubmitRequest**](QuizSubmitRequest.md)|  | [optional] 

### Return type

[**QuizSubmitResult**](QuizSubmitResult.md)

### Authorization

[cookieAuth](../README.md#cookieAuth), [bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

