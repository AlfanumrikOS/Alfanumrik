# alfanumrik_api_v2.api.StudentApi

## Load the API package
```dart
import 'package:alfanumrik_api_v2/api.dart';
```

All URIs are relative to */api*

Method | HTTP request | Description
------------- | ------------- | -------------
[**getStudentLeaderboard**](StudentApi.md#getstudentleaderboard) | **GET** /v2/student/leaderboard | XP leaderboard
[**getStudentProfile**](StudentApi.md#getstudentprofile) | **GET** /v2/student/profile | Authenticated student profile
[**getStudentProgress**](StudentApi.md#getstudentprogress) | **GET** /v2/student/progress | Authenticated student progress


# **getStudentLeaderboard**
> LeaderboardResponse getStudentLeaderboard(period, scope)

XP leaderboard

Returns ranked leaderboard entries via the get_leaderboard RPC the web /leaderboard page uses. No PII beyond what the existing leaderboard exposes (P13). Requires progress.view_own.

### Example
```dart
import 'package:alfanumrik_api_v2/api.dart';
// TODO Configure API key authorization: cookieAuth
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKey = 'YOUR_API_KEY';
// uncomment below to setup prefix (e.g. Bearer) for API key, if needed
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKeyPrefix = 'Bearer';

final api = AlfanumrikApiV2().getStudentApi();
final String period = period_example; // String | 
final String scope = scope_example; // String | 

try {
    final response = api.getStudentLeaderboard(period, scope);
    print(response);
} catch on DioException (e) {
    print('Exception when calling StudentApi->getStudentLeaderboard: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **period** | **String**|  | [optional] 
 **scope** | **String**|  | [optional] 

### Return type

[**LeaderboardResponse**](LeaderboardResponse.md)

### Authorization

[cookieAuth](../README.md#cookieAuth), [bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **getStudentProfile**
> StudentProfileResponse getStudentProfile()

Authenticated student profile

Returns the authenticated student's profile (name, grade(string,P5), board, stream, plan, language). Reuses the identity profile read. Requires profile.view_own.

### Example
```dart
import 'package:alfanumrik_api_v2/api.dart';
// TODO Configure API key authorization: cookieAuth
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKey = 'YOUR_API_KEY';
// uncomment below to setup prefix (e.g. Bearer) for API key, if needed
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKeyPrefix = 'Bearer';

final api = AlfanumrikApiV2().getStudentApi();

try {
    final response = api.getStudentProfile();
    print(response);
} catch on DioException (e) {
    print('Exception when calling StudentApi->getStudentProfile: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**StudentProfileResponse**](StudentProfileResponse.md)

### Authorization

[cookieAuth](../README.md#cookieAuth), [bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **getStudentProgress**
> StudentProgressResponse getStudentProgress()

Authenticated student progress

Returns the structured progress payload (performance_scores, topic_mastery, knowledge_gaps, learning_velocity, decay_topics) the web /progress page reads. RLS-safe. Requires progress.view_own.

### Example
```dart
import 'package:alfanumrik_api_v2/api.dart';
// TODO Configure API key authorization: cookieAuth
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKey = 'YOUR_API_KEY';
// uncomment below to setup prefix (e.g. Bearer) for API key, if needed
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKeyPrefix = 'Bearer';

final api = AlfanumrikApiV2().getStudentApi();

try {
    final response = api.getStudentProgress();
    print(response);
} catch on DioException (e) {
    print('Exception when calling StudentApi->getStudentProgress: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**StudentProgressResponse**](StudentProgressResponse.md)

### Authorization

[cookieAuth](../README.md#cookieAuth), [bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

