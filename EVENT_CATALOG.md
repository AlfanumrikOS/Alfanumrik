# EVENT_CATALOG.md

## Domain Event Catalog

This document defines all domain events in the Alfanumrik platform. Events enable loose coupling between services and support eventual consistency for cross-domain updates.

## Event Standards

### Event Structure
```typescript
interface DomainEvent {
  eventId: string;           // UUID for deduplication
  eventType: string;         // e.g., "quiz.completed"
  aggregateId: string;       // Primary entity ID
  aggregateType: string;     // e.g., "quiz_session"
  data: Record<string, unknown>; // Event payload
  metadata: {
    timestamp: string;       // ISO 8601 timestamp
    correlationId: string;   // Request correlation ID
    causationId?: string;    // ID of event that caused this
    userId?: string;         // User who triggered the event
    studentId?: string;      // Student context
    service: string;         // Service that published the event
    version: string;         // Event schema version
  };
}
```

### Publishing Rules
- Events are immutable once published
- Use past tense for event names (e.g., "quiz.completed", not "complete_quiz")
- Include all relevant context in the event payload
- Correlation IDs must be propagated across service boundaries

### Consumption Rules
- Consumers should be idempotent (handle duplicate events)
- Eventual consistency is acceptable for most use cases
- Dead letter queues for failed event processing
- Circuit breakers for downstream service failures

## Identity Domain Events

### User Lifecycle Events
```typescript
// Published by: Identity Service
// Consumers: Billing, Analytics, Notification
{
  eventType: "user.registered",
  aggregateId: "user-uuid",
  aggregateType: "user",
  data: {
    email: "student@example.com",
    role: "student",
    signupSource: "website"
  }
}

// Published by: Identity Service
// Consumers: Billing, Analytics
{
  eventType: "user.profile_completed",
  aggregateId: "user-uuid",
  aggregateType: "user",
  data: {
    studentId: "stu-uuid",
    grade: "9",
    board: "CBSE",
    subjects: ["math", "science"]
  }
}

// Published by: Identity Service
// Consumers: All services
{
  eventType: "user.role_assigned",
  aggregateId: "user-uuid",
  aggregateType: "user",
  data: {
    role: "teacher",
    schoolId: "school-uuid",
    subjects: ["math", "physics"],
    grades: ["9", "10"]
  }
}
```

### Relationship Events
```typescript
// Published by: Identity Service
// Consumers: Analytics, Notification
{
  eventType: "relationship.established",
  aggregateId: "link-uuid",
  aggregateType: "guardian_student_link",
  data: {
    guardianId: "guardian-uuid",
    studentId: "stu-uuid",
    relationship: "parent",
    status: "approved"
  }
}

// Published by: Identity Service
// Consumers: Analytics
{
  eventType: "school.membership_joined",
  aggregateId: "membership-uuid",
  aggregateType: "school_membership",
  data: {
    userId: "user-uuid",
    schoolId: "school-uuid",
    role: "student"
  }
}
```

## Quiz Domain Events

### Quiz Lifecycle Events
```typescript
// Published by: Quiz Service
// Consumers: Analytics, Assessment, XP Service
{
  eventType: "quiz.started",
  aggregateId: "session-uuid",
  aggregateType: "quiz_session",
  data: {
    studentId: "stu-uuid",
    subject: "math",
    grade: "9",
    questionCount: 10,
    difficulty: "medium",
    source: "rag" // rag | rpc | cache
  }
}

// Published by: Quiz Service
// Consumers: Analytics, Assessment, XP Service, Notification
{
  eventType: "quiz.completed",
  aggregateId: "session-uuid",
  aggregateType: "quiz_session",
  data: {
    studentId: "stu-uuid",
    subject: "math",
    grade: "9",
    score: 85,
    correct: 8,
    total: 10,
    timeTakenSeconds: 420,
    xpEarned: 50,
    antiCheatPassed: true
  }
}

// Published by: Quiz Service
// Consumers: Analytics
{
  eventType: "question.answered",
  aggregateId: "response-uuid",
  aggregateType: "quiz_response",
  data: {
    sessionId: "session-uuid",
    questionId: "q-uuid",
    selectedIndex: 2,
    correct: true,
    timeTakenSeconds: 45,
    hintUsed: false
  }
}
```

### Quiz Quality Events
```typescript
// Published by: Quiz Service
// Consumers: Analytics, Content
{
  eventType: "quiz.quality_issue",
  aggregateId: "session-uuid",
  aggregateType: "quiz_session",
  data: {
    issue: "insufficient_questions",
    subject: "math",
    grade: "9",
    requested: 10,
    available: 3,
    chapter: 5
  }
}
```

## Foxy AI Domain Events

### Conversation Events
```typescript
// Published by: Foxy Service
// Consumers: Analytics, Assessment
{
  eventType: "foxy.conversation_started",
  aggregateId: "session-uuid",
  aggregateType: "foxy_session",
  data: {
    studentId: "stu-uuid",
    subject: "science",
    grade: "9",
    mode: "learn",
    topic: "photosynthesis"
  }
}

// Published by: Foxy Service
// Consumers: Analytics, Assessment
{
  eventType: "foxy.message_sent",
  aggregateId: "message-uuid",
  aggregateType: "foxy_chat_message",
  data: {
    sessionId: "session-uuid",
    studentId: "stu-uuid",
    messageLength: 150,
    responseLength: 300,
    tokensUsed: 45,
    ragSourcesUsed: 3,
    cognitiveGuidanceProvided: true
  }
}
```

### Usage Events
```typescript
// Published by: Foxy Service
// Consumers: Billing, Analytics
{
  eventType: "foxy.quota_exceeded",
  aggregateId: "usage-uuid",
  aggregateType: "student_daily_usage",
  data: {
    studentId: "stu-uuid",
    used: 10,
    limit: 10,
    plan: "free",
    nextReset: "2024-01-01T00:00:00Z"
  }
}

// Published by: Foxy Service
// Consumers: Analytics
{
  eventType: "foxy.circuit_breaker_tripped",
  aggregateId: "service-health",
  aggregateType: "service",
  data: {
    service: "claude-api",
    failures: 5,
    threshold: 5,
    resetTime: "2024-01-01T00:05:00Z"
  }
}
```

## Billing Domain Events

### Payment Events
```typescript
// Published by: Billing Service
// Consumers: Identity, Analytics, Notification
{
  eventType: "payment.initiated",
  aggregateId: "order-uuid",
  aggregateType: "razorpay_order",
  data: {
    studentId: "stu-uuid",
    amount: 999,
    currency: "INR",
    planId: "starter",
    razorpayOrderId: "order_xyz"
  }
}

// Published by: Billing Service
// Consumers: Identity, Analytics, Notification, All Services
{
  eventType: "payment.completed",
  aggregateId: "payment-uuid",
  aggregateType: "payment",
  data: {
    studentId: "stu-uuid",
    amount: 999,
    planId: "starter",
    subscriptionId: "sub-uuid",
    effectiveDate: "2024-01-01T00:00:00Z"
  }
}

// Published by: Billing Service
// Consumers: Identity, Analytics, Notification
{
  eventType: "subscription.activated",
  aggregateId: "sub-uuid",
  aggregateType: "student_subscription",
  data: {
    studentId: "stu-uuid",
    planId: "starter",
    features: ["unlimited_quiz", "ai_tutor"],
    currentPeriodEnd: "2024-02-01T00:00:00Z"
  }
}
```

### Subscription Events
```typescript
// Published by: Billing Service
// Consumers: Identity, Analytics, Notification
{
  eventType: "subscription.cancelled",
  aggregateId: "sub-uuid",
  aggregateType: "student_subscription",
  data: {
    studentId: "stu-uuid",
    planId: "starter",
    cancelledAt: "2024-01-15T00:00:00Z",
    reason: "user_requested"
  }
}

// Published by: Billing Service
// Consumers: Identity, Analytics
{
  eventType: "subscription.plan_changed",
  aggregateId: "sub-uuid",
  aggregateType: "student_subscription",
  data: {
    studentId: "stu-uuid",
    oldPlan: "starter",
    newPlan: "pro",
    effectiveDate: "2024-01-01T00:00:00Z"
  }
}
```

## Content Domain Events

### Content Management Events
```typescript
// Published by: Content Service
// Consumers: Analytics, Quiz, Foxy
{
  eventType: "content.question_added",
  aggregateId: "question-uuid",
  aggregateType: "question_bank",
  data: {
    subject: "math",
    grade: "9",
    chapter: 5,
    difficulty: 2,
    bloomLevel: "application"
  }
}

// Published by: Content Service
// Consumers: Foxy, Analytics
{
  eventType: "content.chunk_embedded",
  aggregateId: "chunk-uuid",
  aggregateType: "rag_chunk",
  data: {
    subject: "science",
    grade: "9",
    chapter: 3,
    embeddingModel: "voyage-3",
    qualityScore: 0.87
  }
}
```

### Content Quality Events
```typescript
// Published by: Content Service
// Consumers: Analytics, Admin
{
  eventType: "content.quality_validation_failed",
  aggregateId: "question-uuid",
  aggregateType: "question_bank",
  data: {
    validationErrors: ["missing_explanation", "invalid_options"],
    subject: "math",
    grade: "9"
  }
}
```

## Assessment Domain Events

### Learning Events
```typescript
// Published by: Assessment Service
// Consumers: Analytics, Foxy
{
  eventType: "assessment.mastery_achieved",
  aggregateId: "mastery-uuid",
  aggregateType: "concept_mastery",
  data: {
    studentId: "stu-uuid",
    conceptId: "concept-uuid",
    masteryLevel: 0.85,
    attempts: 3,
    timeToMastery: 86400 // seconds
  }
}

// Published by: Assessment Service
// Consumers: Analytics, Foxy, Quiz
{
  eventType: "assessment.gap_identified",
  aggregateId: "gap-uuid",
  aggregateType: "knowledge_gap",
  data: {
    studentId: "stu-uuid",
    conceptId: "concept-uuid",
    gapSeverity: "high",
    recommendedActions: ["practice_problems", "video_tutorial"]
  }
}
```

### Diagnostic Events
```typescript
// Published by: Assessment Service
// Consumers: Analytics, Foxy
{
  eventType: "assessment.diagnostic_completed",
  aggregateId: "diagnostic-uuid",
  aggregateType: "diagnostic_session",
  data: {
    studentId: "stu-uuid",
    subject: "math",
    grade: "9",
    overallScore: 75,
    weakAreas: ["algebra", "geometry"],
    recommendedFocus: "algebra"
  }
}
```

## Analytics Domain Events

### System Events
```typescript
// Published by: Analytics Service
// Consumers: Admin, Notification
{
  eventType: "analytics.threshold_exceeded",
  aggregateId: "metric-uuid",
  aggregateType: "usage_metric",
  data: {
    metric: "daily_active_users",
    value: 5200,
    threshold: 5000,
    severity: "warning"
  }
}

// Published by: Analytics Service
// Consumers: Admin
{
  eventType: "analytics.report_generated",
  aggregateId: "report-uuid",
  aggregateType: "performance_report",
  data: {
    reportType: "weekly_performance",
    studentCount: 1200,
    averageScore: 82,
    topSubject: "math"
  }
}
```

## Cross-Domain Event Flows

### Quiz Completion Flow
```
1. Quiz Service → quiz.completed
2. Assessment Service → assessment.mastery_updated
3. Analytics Service → analytics.metrics_updated
4. Notification Service → notification.quiz_complete_sent
```

### Payment Flow
```
1. Billing Service → payment.completed
2. Identity Service → user.subscription_updated
3. All Services → feature_access_updated
4. Analytics Service → analytics.revenue_updated
```

### Learning Progress Flow
```
1. Quiz Service → quiz.completed
2. Assessment Service → assessment.gap_identified
3. Foxy Service → foxy.guidance_targeted
4. Analytics Service → analytics.learning_progress_updated
```

## Event Processing Patterns

### Event Sourcing
```typescript
// Event-sourced aggregates
class QuizSession {
  private events: DomainEvent[] = [];

  apply(event: DomainEvent) {
    this.events.push(event);
    // Update internal state
  }

  getState() {
    // Reconstruct state from events
    return this.events.reduce((state, event) => {
      return this.applyEvent(state, event);
    }, {});
  }
}
```

### Saga Pattern for Complex Workflows
```typescript
// Payment processing saga
class PaymentSaga {
  async process(paymentEvent: DomainEvent) {
    // Step 1: Validate payment
    await this.validatePayment(paymentEvent);

    // Step 2: Update subscription
    await this.updateSubscription(paymentEvent);

    // Step 3: Send notifications
    await this.sendNotifications(paymentEvent);

    // Step 4: Update analytics
    await this.updateAnalytics(paymentEvent);
  }
}
```

### Event Replay
```typescript
// Rebuild analytics from events
async function rebuildAnalytics(studentId: string) {
  const events = await eventStore.getEventsForStudent(studentId);

  const analytics = events.reduce((acc, event) => {
    switch (event.eventType) {
      case 'quiz.completed':
        acc.quizzesCompleted++;
        acc.totalScore += event.data.score;
        break;
      case 'foxy.message_sent':
        acc.aiInteractions++;
        break;
    }
    return acc;
  }, { quizzesCompleted: 0, totalScore: 0, aiInteractions: 0 });

  return analytics;
}
```

## Event Infrastructure

### Event Store Schema
```sql
CREATE TABLE event_store (
  event_id UUID PRIMARY KEY,
  event_type VARCHAR(255) NOT NULL,
  aggregate_id VARCHAR(255) NOT NULL,
  aggregate_type VARCHAR(255) NOT NULL,
  data JSONB NOT NULL,
  metadata JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_event_store_aggregate ON event_store(aggregate_type, aggregate_id);
CREATE INDEX idx_event_store_type ON event_store(event_type);
CREATE INDEX idx_event_store_created ON event_store(created_at);
```

### Message Queue Configuration
```typescript
// Dead letter queue for failed processing
const eventProcessingConfig = {
  maxRetries: 3,
  retryDelay: 1000, // ms
  deadLetterQueue: 'failed_events',
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 30000
  }
};
```

### Monitoring
```typescript
// Event processing metrics
const eventMetrics = {
  eventsPublished: new Counter('events_published_total', ['event_type']),
  eventsProcessed: new Counter('events_processed_total', ['event_type']),
  processingErrors: new Counter('event_processing_errors_total', ['event_type']),
  processingLatency: new Histogram('event_processing_duration_seconds', ['event_type'])
};
```

## Event Versioning

### Schema Evolution
```typescript
// Version 1
{
  eventType: "quiz.completed.v1",
  data: {
    score: 85,
    xpEarned: 50
  }
}

// Version 2 (backward compatible)
{
  eventType: "quiz.completed.v2",
  data: {
    score: 85,
    xpEarned: 50,
    accuracy: 0.85, // new field
    timeBonus: 5     // new field
  }
}
```

### Consumer Migration
```typescript
function handleQuizCompleted(event: DomainEvent) {
  const data = event.data;

  // Handle both v1 and v2
  const score = data.score;
  const xpEarned = data.xpEarned;
  const accuracy = data.accuracy || (score / 100); // fallback for v1
  const timeBonus = data.timeBonus || 0; // default for v1

  // Process with unified interface
}
```

## Testing Event-Driven Systems

### Event Contract Tests
```typescript
describe('Quiz Completed Event', () => {
  it('should contain required fields', () => {
    const event = createQuizCompletedEvent(sessionData);

    expect(event.eventType).toBe('quiz.completed');
    expect(event.data.score).toBeDefined();
    expect(event.data.xpEarned).toBeDefined();
    expect(event.metadata.correlationId).toBeDefined();
  });

  it('should be consumed by analytics service', async () => {
    const event = createQuizCompletedEvent(sessionData);

    await analyticsService.processEvent(event);

    expect(mockDatabase.updateStudentMetrics).toHaveBeenCalledWith({
      studentId: event.data.studentId,
      score: event.data.score
    });
  });
});
```

### Integration Tests
```typescript
describe('Quiz to Analytics Flow', () => {
  it('should update student metrics after quiz completion', async () => {
    // Submit quiz
    const result = await quizService.submitQuiz(sessionId, responses);

    // Wait for event processing
    await waitForEventProcessing();

    // Verify analytics updated
    const metrics = await analyticsService.getStudentMetrics(studentId);
    expect(metrics.quizzesCompleted).toBe(1);
    expect(metrics.averageScore).toBe(result.score);
  });
});
```</content>
<parameter name="filePath">c:\Users\Bharangpur Primary\Alfanumrik-repo\.claude\worktrees\compassionate-curie\EVENT_CATALOG.md