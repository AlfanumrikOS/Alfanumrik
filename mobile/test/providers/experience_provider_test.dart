import 'dart:async';

import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:alfanumrik/providers/experience_provider.dart';
import 'package:alfanumrik/providers/parent_provider.dart';
import 'package:alfanumrik/providers/role_provider.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _FakeParentChildrenNotifier extends ParentChildrenNotifier {
  static bool fail = false;

  @override
  Future<ParentChildrenResponse> build() async {
    if (fail) throw StateError('children unavailable');
    return ParentChildrenResponse(
      (builder) => builder
        ..schemaVersion = ParentChildrenResponseSchemaVersionEnum.n1
        ..children.addAll([
          ParentChild((child) => child..studentId = 'child-1'),
          ParentChild((child) => child..studentId = 'child-2'),
        ]),
    );
  }
}

Map<String, dynamic> _enabledResponse(Map<String, dynamic> query) {
  final role = query['role'] as String;
  final capability = role == 'parent' ? 'parent.home' : 'student.today';
  return {
    'enabled': true,
    'capabilities': {capability: true},
    'manifest': {
      'role': role,
      'desktop': [
        {'capability': capability},
      ],
    },
    'routeMapped': true,
    'routeAllowed': true,
    if (role == 'parent') 'scope': {'childId': query['childId']},
  };
}

void main() {
  test('maps only supported native roles to governed web role names', () {
    expect(experienceRoleFor(UserRole.student), 'student');
    expect(experienceRoleFor(UserRole.guardian), 'parent');
    expect(experienceRoleFor(UserRole.unknown), isNull);
  });

  test('includes the active child in parent assignment resolution only', () {
    expect(
      experienceV3QueryParameters(
        'parent',
        childId: 'child-2',
        path: '/parent',
      ),
      {
        'role': 'parent',
        'path': '/parent',
        'childId': 'child-2',
      },
    );
    expect(experienceV3QueryParameters('student', childId: 'child-2'), {
      'role': 'student',
    });
  });

  group('server assignment response is tri-state and fail-closed', () {
    test('accepts only explicit boolean assignments on a 200 response', () {
      expect(
        resolveOneExperienceResolution(
          statusCode: 200,
          data: {
            'enabled': true,
            'capabilities': {'student.today': true},
            'manifest': {
              'role': 'student',
              'desktop': [
                {'capability': 'student.today'},
              ],
            },
            'routeMapped': true,
            'routeAllowed': true,
          },
          expectedRole: 'student',
        ),
        isA<OneExperienceResolution>()
            .having(
              (value) => value.assignment,
              'assignment',
              OneExperienceAssignment.enabled,
            )
            .having(
              (value) => value.allowsCapability('student.today'),
              'today capability',
              isTrue,
            ),
      );
      expect(
        resolveOneExperienceResolution(
          statusCode: 200,
          data: {'enabled': false},
          expectedRole: 'student',
        ).assignment,
        OneExperienceAssignment.legacy,
      );
    });

    test('denies malformed, authorization and server-error responses', () {
      expect(
        resolveOneExperienceResolution(
          statusCode: 200,
          data: {'enabled': 'true'},
          expectedRole: 'student',
        ).assignment,
        OneExperienceAssignment.denied,
      );
      for (final status in [401, 403, 500, 503]) {
        expect(
          resolveOneExperienceResolution(
            statusCode: status,
            data: {'enabled': status == 401 ? false : true},
            expectedRole: 'student',
          ).assignment,
          OneExperienceAssignment.denied,
        );
      }
      expect(
        resolveOneExperienceResolution(
          statusCode: 200,
          data: null,
          expectedRole: 'student',
        ).assignment,
        OneExperienceAssignment.denied,
      );
    });

    test('denies enabled responses with wrong role, route, or child scope', () {
      Map<String, dynamic> enabled({
        String role = 'parent',
        String childId = 'child-2',
        bool routeAllowed = true,
      }) =>
          {
            'enabled': true,
            'capabilities': {'parent.home': true},
            'manifest': {
              'role': role,
              'desktop': [
                {'capability': 'parent.home'},
              ],
            },
            'routeMapped': true,
            'routeAllowed': routeAllowed,
            'scope': {'childId': childId},
          };

      for (final body in [
        enabled(role: 'student'),
        enabled(routeAllowed: false),
        enabled(childId: 'child-1'),
      ]) {
        expect(
          resolveOneExperienceResolution(
            statusCode: 200,
            data: body,
            expectedRole: 'parent',
            requestedChildId: 'child-2',
          ).assignment,
          OneExperienceAssignment.denied,
        );
      }
    });

    test('uses the filtered manifest for mobile route access', () {
      const resolution = OneExperienceResolution(
        assignment: OneExperienceAssignment.enabled,
        role: 'student',
        permittedCapabilities: {'student.today'},
      );
      expect(oneExperienceAllowsPath(resolution, 'student', '/today'), isTrue);
      expect(
          oneExperienceAllowsPath(resolution, 'student', '/progress'), isFalse);
      expect(
          oneExperienceAllowsPath(resolution, 'student', '/settings'), isTrue);
    });
  });

  group('oneExperienceProvider runtime', () {
    test('transitions from loading to denied on an authenticated error',
        () async {
      final request = Completer<ExperienceHttpResponse>();
      final container = ProviderContainer(
        overrides: [
          oneExperienceBuildEnabledProvider.overrideWithValue(true),
          roleProvider.overrideWith((ref) async => UserRole.student),
          experienceRequestProvider.overrideWithValue((_) => request.future),
        ],
      );
      addTearDown(container.dispose);

      expect(container.read(oneExperienceProvider).isLoading, isTrue);
      request.complete(
        const ExperienceHttpResponse(
          statusCode: 403,
          data: {'enabled': false},
        ),
      );
      final result = await container.read(oneExperienceProvider.future);
      expect(result.assignment, OneExperienceAssignment.denied);
    });

    test('denies transport exceptions and permits explicit server legacy',
        () async {
      final denied = ProviderContainer(
        overrides: [
          oneExperienceBuildEnabledProvider.overrideWithValue(true),
          roleProvider.overrideWith((ref) async => UserRole.student),
          experienceRequestProvider.overrideWithValue(
            (_) => Future<ExperienceHttpResponse>.error(
              StateError('network unavailable'),
            ),
          ),
        ],
      );
      addTearDown(denied.dispose);
      expect(
        (await denied.read(oneExperienceProvider.future)).assignment,
        OneExperienceAssignment.denied,
      );

      final legacy = ProviderContainer(
        overrides: [
          oneExperienceBuildEnabledProvider.overrideWithValue(true),
          roleProvider.overrideWith((ref) async => UserRole.student),
          experienceRequestProvider.overrideWithValue(
            (_) async => const ExperienceHttpResponse(
              statusCode: 200,
              data: {'enabled': false},
            ),
          ),
        ],
      );
      addTearDown(legacy.dispose);
      expect(
        (await legacy.read(oneExperienceProvider.future)).assignment,
        OneExperienceAssignment.legacy,
      );
    });

    test('recomputes authoritative parent scope on child switch', () async {
      final queries = <Map<String, dynamic>>[];
      _FakeParentChildrenNotifier.fail = false;
      final container = ProviderContainer(
        overrides: [
          oneExperienceBuildEnabledProvider.overrideWithValue(true),
          roleProvider.overrideWith((ref) async => UserRole.guardian),
          parentChildrenProvider.overrideWith(
            _FakeParentChildrenNotifier.new,
          ),
          experienceRequestProvider.overrideWithValue((query) async {
            queries.add(Map<String, dynamic>.from(query));
            return ExperienceHttpResponse(
              statusCode: 200,
              data: _enabledResponse(query),
            );
          }),
        ],
      );
      addTearDown(container.dispose);

      expect(
        (await container.read(oneExperienceProvider.future)).childId,
        'child-1',
      );
      container.read(selectedParentChildProvider.notifier).state = 'child-2';
      await Future<void>.delayed(Duration.zero);
      expect(
        (await container.read(oneExperienceProvider.future)).childId,
        'child-2',
      );
      expect(queries.map((query) => query['childId']), ['child-1', 'child-2']);
    });

    test('recovers after children and assignment dependencies are retried',
        () async {
      _FakeParentChildrenNotifier.fail = true;
      final container = ProviderContainer(
        overrides: [
          oneExperienceBuildEnabledProvider.overrideWithValue(true),
          roleProvider.overrideWith((ref) async => UserRole.guardian),
          parentChildrenProvider.overrideWith(
            _FakeParentChildrenNotifier.new,
          ),
          experienceRequestProvider.overrideWithValue((query) async {
            return ExperienceHttpResponse(
              statusCode: 200,
              data: _enabledResponse(query),
            );
          }),
        ],
      );
      addTearDown(container.dispose);
      expect(
        (await container.read(oneExperienceProvider.future)).assignment,
        OneExperienceAssignment.denied,
      );

      _FakeParentChildrenNotifier.fail = false;
      container.invalidate(parentChildrenProvider);
      container.invalidate(parentThreadsProvider);
      container.invalidate(oneExperienceProvider);
      expect(
        (await container.read(oneExperienceProvider.future)).assignment,
        OneExperienceAssignment.enabled,
      );
    });
  });
}
