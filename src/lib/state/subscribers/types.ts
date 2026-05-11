/**
 * src/lib/state/subscribers/types.ts — convenience type aliases.
 *
 * Re-exports `Subscriber<K>` and `SubscriberContext` from
 * subscriber.ts, and provides narrowed event aliases per kind for
 * subscriber implementations to consume. Centralised so subscribers
 * import a single module.
 */

import type { DomainEvent } from '../events/registry';
export type { Subscriber, SubscriberContext, SubscriberLogLine } from './subscriber';

export type LearnerSignedUpEvent = Extract<DomainEvent, { kind: 'learner.signed_up' }>;
export type LearnerSessionStartedEvent = Extract<DomainEvent, { kind: 'learner.session_started' }>;
export type LearnerQuizCompletedEvent = Extract<DomainEvent, { kind: 'learner.quiz_completed' }>;
export type LearnerLessonCompletedEvent = Extract<DomainEvent, { kind: 'learner.lesson_completed' }>;
export type LearnerMasteryChangedEvent = Extract<DomainEvent, { kind: 'learner.mastery_changed' }>;
export type FoxySessionStartedEvent = Extract<DomainEvent, { kind: 'ai.foxy_session_started' }>;
export type FoxySessionCompletedEvent = Extract<DomainEvent, { kind: 'ai.foxy_session_completed' }>;
export type ParentLinkedEvent = Extract<DomainEvent, { kind: 'parent.linked_to_learner' }>;
export type ParentReportViewedEvent = Extract<DomainEvent, { kind: 'parent.report_viewed' }>;
export type TeacherAssignmentCreatedEvent = Extract<DomainEvent, { kind: 'teacher.assignment_created' }>;
export type SchoolModuleToggledEvent = Extract<DomainEvent, { kind: 'school.module_toggled' }>;
export type BillingInvoicePaidEvent = Extract<DomainEvent, { kind: 'billing.invoice_paid' }>;
export type MeshCycleCompletedEvent = Extract<DomainEvent, { kind: 'mesh.cycle_completed' }>;
