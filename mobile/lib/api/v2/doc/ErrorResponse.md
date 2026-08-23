# alfanumrik_api_v2.model.ErrorResponse

## Load the model package
```dart
import 'package:alfanumrik_api_v2/api.dart';
```

## Properties
Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**code** | **String** |  | [optional] 
**details** | [**BuiltMap&lt;String, JsonObject&gt;**](JsonObject.md) | OPTIONAL machine-readable, code-specific detail payload. For code `subject_not_allowed` (403) and `UNKNOWN_SUBJECT` (400) the shape is `SubjectNotAllowedDetails` ({ subject, reason, allowed }). Absent on every other error response. | [optional] 
**error** | **String** |  | 
**retryable** | **bool** |  | [optional] 
**success** | **bool** |  | 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


