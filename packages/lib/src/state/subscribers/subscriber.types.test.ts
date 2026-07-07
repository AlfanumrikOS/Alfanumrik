import { describe, it } from 'vitest';
import type { Subscriber } from './subscriber';
import type { DomainEvent } from '../events/registry';

describe('Subscriber interface', () => {
  it('accepts optional maxRetries and studentIdFromEvent', () => {
    const s: Subscriber<'learner.mastery_changed'> = {
      name: 'test',
      kind: 'learner.mastery_changed',
      maxRetries: 5,
      studentIdFromEvent: (e) => e.actorAuthUserId,
      async handle(_event, _ctx) {},
    };
    void s;
  });

  it('accepts a subscriber without the new optional fields', () => {
    const s: Subscriber<'learner.mastery_changed'> = {
      name: 'minimal',
      kind: 'learner.mastery_changed',
      async handle(_event, _ctx) {},
    };
    void s;
  });
});
