# alfanumrik_api_v2.model.SubjectNotAllowedDetails

## Load the model package
```dart
import 'package:alfanumrik_api_v2/api.dart';
```

## Properties
Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**allowed** | **BuiltList&lt;String&gt;** | The subject CODES valid for this student on the rejecting route. For the 403 governance rejection: unlocked codes only. For the learn routes: every subject in the student tree (locked included — locked subjects are still valid read params). | 
**reason** | **String** | Cause discriminator. Governance rejections (403 subject_not_allowed) emit 'grade' (not in this student's grade subject list) or 'plan' (plan-locked); other SubjectWriteError reasons ('stream', 'inactive', 'unknown', 'max_subjects') are reserved. The learn routes' 400 UNKNOWN_SUBJECT emits 'unknown_subject'. Kept a string (not an enum) so adding a reason is non-breaking for generated clients. | 
**subject** | **String** | The rejected subject value, verbatim as the client sent it. | 

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


