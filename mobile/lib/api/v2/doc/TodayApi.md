# alfanumrik_api_v2.api.TodayApi

## Load the API package
```dart
import 'package:alfanumrik_api_v2/api.dart';
```

All URIs are relative to */api*

Method | HTTP request | Description
------------- | ------------- | -------------
[**getToday**](TodayApi.md#gettoday) | **GET** /v2/today | Today home queue


# **getToday**
> TodayResponse getToday()

Today home queue

Returns the ordered \"what could I do today?\" queue for the authenticated student as render-ready DTOs. Requires study_plan.view. 404 when ff_today_home_v1 is off.

### Example
```dart
import 'package:alfanumrik_api_v2/api.dart';
// TODO Configure API key authorization: cookieAuth
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKey = 'YOUR_API_KEY';
// uncomment below to setup prefix (e.g. Bearer) for API key, if needed
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKeyPrefix = 'Bearer';

final api = AlfanumrikApiV2().getTodayApi();

try {
    final response = api.getToday();
    print(response);
} catch on DioException (e) {
    print('Exception when calling TodayApi->getToday: $e\n');
}
```

### Parameters
This endpoint does not need any parameter.

### Return type

[**TodayResponse**](TodayResponse.md)

### Authorization

[cookieAuth](../README.md#cookieAuth), [bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

