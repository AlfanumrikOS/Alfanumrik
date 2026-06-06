# alfanumrik_api_v2.api.ParentApi

## Load the API package
```dart
import 'package:alfanumrik_api_v2/api.dart';
```

All URIs are relative to */api*

Method | HTTP request | Description
------------- | ------------- | -------------
[**postParentEncourage**](ParentApi.md#postparentencourage) | **POST** /v2/parent/encourage | Send a preset cheer to a linked child


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

