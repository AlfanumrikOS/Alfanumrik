# alfanumrik_api_v2.model.QuizSubmitRequest

## Load the model package
```dart
import 'package:alfanumrik_api_v2/api.dart';
```

## Properties
Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**attemptMode** | **String** |  | [optional] [default to 'online']
**capturedAt** | [**DateTime**](DateTime.md) |  | [optional] 
**chapter** | **int** |  | [optional] 
**clientCapturedTotalSeconds** | **int** |  | [optional] 
**drainAttempt** | **int** |  | [optional] 
**grade** | **String** |  | [optional] 
**responses** | [**BuiltList&lt;QuizSubmitResponseItem&gt;**](QuizSubmitResponseItem.md) |  | 
**sessionId** | **String** |  | 
**shuffleMapsClientGradedAgainst** | [**BuiltMap&lt;String, BuiltList&lt;int&gt;&gt;**](BuiltList.md) |  | [optional] 
**studentId** | **String** |  | 
**subject** | **String** |  | [optional] 
**topic** | **String** |  | [optional] 
**totalTimeSeconds** | **int** |  | 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


