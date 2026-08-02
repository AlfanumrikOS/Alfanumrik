# alfanumrik_api_v2.api.PlacementApi

## Load the API package
```dart
import 'package:alfanumrik_api_v2/api.dart';
```

All URIs are relative to */api*

Method | HTTP request | Description
------------- | ------------- | -------------
[**getPlacement**](PlacementApi.md#getplacement) | **GET** /v2/placement | Six cold-start placement probes for a subject
[**postPlacementAnswer**](PlacementApi.md#postplacementanswer) | **POST** /v2/placement/answer | Record one placement-probe response


# **getPlacement**
> PlacementResponse getPlacement(subject, lang)

Six cold-start placement probes for a subject

Returns up to 6 placement probes for the given subject at the student's own grade, via selectPlacementQuestions (the cold-start sibling of the live adaptive selector — same table, same P6 shape guard, no second question source). Read-only; no mastery write happens here. Requires study_plan.view. 404 when ff_placement_v1 is off.

### Example
```dart
import 'package:alfanumrik_api_v2/api.dart';
// TODO Configure API key authorization: cookieAuth
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKey = 'YOUR_API_KEY';
// uncomment below to setup prefix (e.g. Bearer) for API key, if needed
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKeyPrefix = 'Bearer';

final api = AlfanumrikApiV2().getPlacementApi();
final String subject = math; // String | 
final String lang = lang_example; // String | 

try {
    final response = api.getPlacement(subject, lang);
    print(response);
} catch on DioException (e) {
    print('Exception when calling PlacementApi->getPlacement: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **subject** | **String**|  | 
 **lang** | **String**|  | [optional] 

### Return type

[**PlacementResponse**](PlacementResponse.md)

### Authorization

[cookieAuth](../README.md#cookieAuth), [bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **postPlacementAnswer**
> PlacementAnswerResult postPlacementAnswer(placementAnswerRequest)

Record one placement-probe response

Writes a single append-only learning_events row (event_type = placement_probe). Sets a BKT prior via the projector; never recorded as a graded quiz attempt, and an unseen-topic response never counts as a wrong answer. A duplicate idempotencyKey returns 200 with duplicate: true instead of a second row or an error (learning_events_placement_probe_idempotency_uniq). Requires study_plan.create (a write, unlike the sibling GET routes in this family). 404 when ff_placement_v1 is off.

### Example
```dart
import 'package:alfanumrik_api_v2/api.dart';
// TODO Configure API key authorization: cookieAuth
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKey = 'YOUR_API_KEY';
// uncomment below to setup prefix (e.g. Bearer) for API key, if needed
//defaultApiClient.getAuthentication<ApiKeyAuth>('cookieAuth').apiKeyPrefix = 'Bearer';

final api = AlfanumrikApiV2().getPlacementApi();
final PlacementAnswerRequest placementAnswerRequest = ; // PlacementAnswerRequest | 

try {
    final response = api.postPlacementAnswer(placementAnswerRequest);
    print(response);
} catch on DioException (e) {
    print('Exception when calling PlacementApi->postPlacementAnswer: $e\n');
}
```

### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **placementAnswerRequest** | [**PlacementAnswerRequest**](PlacementAnswerRequest.md)|  | [optional] 

### Return type

[**PlacementAnswerResult**](PlacementAnswerResult.md)

### Authorization

[cookieAuth](../README.md#cookieAuth), [bearerAuth](../README.md#bearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

