# alfanumrik_api_v2.api.ParentApi

## Load the API package
```dart
import 'package:alfanumrik_api_v2/api.dart';
```

All URIs are relative to */api*

Method | HTTP request | Description
------------- | ------------- | -------------
[**getParentChildren**](ParentApi.md#getparentchildren) | **GET** /v2/parent/children | List the authenticated guardian&#39;s linked children
[**getParentGlance**](ParentApi.md#getparentglance) | **GET** /v2/parent/glance | At-a-glance view for one linked child
[**postParentEncourage**](ParentApi.md#postparentencourage) | **POST** /v2/parent/encourage | Send a preset cheer to a linked child


# **getParentChildren**
> ParentChildrenResponse getParentChildren()

List the authenticated guardian's linked children

Returns the children linked to the authenticated guardian (guardian_student_links status IN active/approved, joined to students). Reuses the relationship domain listChildrenForGuardian read. P13: only name + grade(string,P5) are returned — no email/phone. Requires child.view_progress.

### Example
```dart
import 'package:alfanumrik_api_v2/api.dart';
// TODO Configure API key authorization: cookieAuth
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKey = 'YOUR_API_KEY';
// uncomment below to setup prefix (e.g. Bearer) for API key, if needed
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKeyPrefix = 'Bearer';

final api = AlfanumrikApiV2().getParentApi();

try {
    final response = api.getParentChildren();
    print(response);
} catch on DioException (e) {
    print('Exception when calling ParentApi->getParentChildren: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**ParentChildrenResponse**](ParentChildrenResponse.md)

### Authorization

[cookieAuth](../README.md#cookieAuth), [bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **getParentGlance**
> ParentGlanceResponse getParentGlance(studentId)

At-a-glance view for one linked child

Returns the Snapshot + Moments glance for one linked child (mirrors the web ParentGlanceHome). Reuses the parent-portal Edge Function `get_child_dashboard` payload — no new aggregation. Requires child.view_progress AND an approved guardian↔student link (403 otherwise). P13: only the parent-entitled child data.

### Example
```dart
import 'package:alfanumrik_api_v2/api.dart';
// TODO Configure API key authorization: cookieAuth
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKey = 'YOUR_API_KEY';
// uncomment below to setup prefix (e.g. Bearer) for API key, if needed
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKeyPrefix = 'Bearer';

final api = AlfanumrikApiV2().getParentApi();
final String studentId = 550e8400-e29b-41d4-a716-446655440000; // String | 

try {
    final response = api.getParentGlance(studentId);
    print(response);
} catch on DioException (e) {
    print('Exception when calling ParentApi->getParentGlance: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **studentId** | **String**|  | 

### Return type

[**ParentGlanceResponse**](ParentGlanceResponse.md)

### Authorization

[cookieAuth](../README.md#cookieAuth), [bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **postParentEncourage**
> SuccessAck postParentEncourage(encourageRequest)

Send a preset cheer to a linked child

Parent sends a curated, preset-keyed encouragement to a linked child. Requires child.encourage and an approved guardian↔student link. Rate-limited to one cheer per (guardian, student) per 6 hours.

### Example
```dart
import 'package:alfanumrik_api_v2/api.dart';
// TODO Configure API key authorization: cookieAuth
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKey = 'YOUR_API_KEY';
// uncomment below to setup prefix (e.g. Bearer) for API key, if needed
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKeyPrefix = 'Bearer';

final api = AlfanumrikApiV2().getParentApi();
final EncourageRequest encourageRequest = ; // EncourageRequest | 

try {
    final response = api.postParentEncourage(encourageRequest);
    print(response);
} catch on DioException (e) {
    print('Exception when calling ParentApi->postParentEncourage: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **encourageRequest** | [**EncourageRequest**](EncourageRequest.md)|  | [optional] 

### Return type

[**SuccessAck**](SuccessAck.md)

### Authorization

[cookieAuth](../README.md#cookieAuth), [bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

