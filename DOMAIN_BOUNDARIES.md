# DOMAIN_BOUNDARIES.md

## Domain-Driven Design for Alfanumrik

This document defines the bounded contexts and domain boundaries for the Alfanumrik platform. Each domain represents a cohesive business capability with clear ownership, contracts, and communication patterns.

## Core Domain Model

### Platform Layer (Cross-cutting)
- **Super Admin Domain**: Platform-wide administration, feature flags, system configuration
- **Tenant Management Domain**: School/institution management, multi-tenancy controls

### User Experience Layer
- **Identity & Access Domain**: Authentication, authorization, user profiles, role management
- **Student Experience Domain**: Dashboard, progress tracking, gamification
- **Parent Portal Domain**: Child monitoring, communication, approvals
- **Teacher Portal Domain**: Class management, student feedback, assignments

### Learning Engine Layer
- **Content Domain**: Question bank, NCERT content, RAG retrieval
- **Quiz Domain**: Quiz generation, attempt tracking, scoring, anti-cheat
- **Practice Domain**: Spaced repetition, review cards, adaptive difficulty
- **Foxy AI Tutor Domain**: Conversational tutoring, cognitive guidance
- **Assessment Domain**: Diagnostic tests, progress evaluation, mastery tracking

### Business Operations Layer
- **Billing Domain**: Subscriptions, payments, plan management
- **Analytics Domain**: Usage tracking, performance metrics, reporting
- **Notification Domain**: Email, SMS, in-app notifications
- **Audit Domain**: Compliance logging, security monitoring

## Domain Boundaries & Ownership

### 1. Identity & Access Domain

**Owned Entities:**
- `users` (Supabase Auth users)
- `students` (student profiles)
- `teachers` (teacher profiles)
- `guardians` (parent profiles)
- `user_roles` (role assignments)
- `guardian_student_links` (parent-child relationships)
- `school_memberships` (institution affiliations)

**Read-Only Access:**
- Subscription status (from Billing Domain)
- Usage metrics (from Analytics Domain)

**Published Events:**
- `user.registered`
- `user.profile_completed`
- `role.assigned`
- `relationship.established`

**Consumed Events:**
- `subscription.activated`
- `school.provisioned`

**API Contracts:**
```typescript
// Core identity operations
createStudent(profile: StudentProfile): Promise<Student>
updateStudent(id: string, updates: Partial<Student>): Promise<Student>
linkGuardianToStudent(guardianId: string, studentId: string): Promise<LinkResult>

// Role management
assignRole(userId: string, role: UserRole, context?: RoleContext): Promise<void>
getUserPermissions(userId: string): Promise<UserPermissions>

// Relationship management
getStudentGuardians(studentId: string): Promise<Guardian[]>
getGuardianChildren(guardianId: string): Promise<Student[]>
```

### 2. Quiz Domain

**Owned Entities:**
- `quiz_sessions`
- `quiz_responses`
- `user_question_history`
- `quiz_analytics` (performance metrics)

**Read-Only Access:**
- Question bank (from Content Domain)
- Student profiles (from Identity Domain)
- Subscription limits (from Billing Domain)

**Published Events:**
- `quiz.started`
- `quiz.submitted`
- `quiz.scored`
- `question.answered`

**Consumed Events:**
- `practice.session_completed`
- `content.question_updated`

**Business Rules:**
- Anti-cheat validation (3s minimum per question, pattern detection)
- Atomic scoring via `atomic_quiz_profile_update()` RPC
- XP calculation: `Math.round((correct/total) * 100)` with bonuses

**API Contracts:**
```typescript
// Quiz lifecycle
generateQuiz(params: QuizGenerationParams): Promise<QuizSession>
submitQuiz(sessionId: string, responses: QuizResponse[]): Promise<QuizResult>

// Question management
fetchQuestions(params: QuestionFetchParams): Promise<QuizQuestion[]>
validateQuizSession(sessionId: string): Promise<ValidationResult>

// Analytics
getQuizHistory(studentId: string, subject: string): Promise<QuizHistory[]>
```

### 3. Foxy AI Tutor Domain

**Owned Entities:**
- `foxy_sessions`
- `foxy_chat_messages`
- `ai_tutor_logs`
- `student_daily_usage` (foxy usage tracking)

**Read-Only Access:**
- Student cognitive state (from Assessment Domain)
- Content chunks (from Content Domain)
- Subscription quotas (from Billing Domain)

**Published Events:**
- `foxy.conversation_started`
- `foxy.message_sent`
- `foxy.quota_exceeded`
- `cognitive.guidance_provided`

**Consumed Events:**
- `quiz.completed`
- `practice.struggled`
- `content.retrieved`

**Business Rules:**
- Daily usage limits by plan (10/30/100/unlimited)
- Age-appropriate responses (grades 6-12)
- CBSE curriculum scope enforcement
- Response streaming for low latency

**API Contracts:**
```typescript
// Conversation management
startConversation(params: ConversationParams): Promise<Conversation>
sendMessage(sessionId: string, message: string): Promise<FoxyResponse>

// Context loading
loadCognitiveContext(studentId: string): Promise<CognitiveState>
retrieveRelevantContent(query: string, context: LearningContext): Promise<ContentChunk[]>

// Usage tracking
checkDailyQuota(studentId: string): Promise<QuotaStatus>
recordUsage(studentId: string, tokens: number): Promise<void>
```

### 4. Billing Domain

**Owned Entities:**
- `student_subscriptions`
- `payments`
- `razorpay_orders`
- `razorpay_webhooks`

**Read-Only Access:**
- Student profiles (from Identity Domain)
- Usage metrics (from Analytics Domain)

**Published Events:**
- `payment.initiated`
- `payment.completed`
- `subscription.activated`
- `subscription.cancelled`
- `plan.changed`

**Consumed Events:**
- `user.registered`
- `usage.quota_exceeded`

**Business Rules:**
- Razorpay webhook signature verification (mandatory)
- Atomic subscription updates with payment records
- No access granting without verified payment
- Subscription status changes written atomically

**API Contracts:**
```typescript
// Payment processing
createOrder(params: OrderParams): Promise<RazorpayOrder>
verifyPayment(paymentId: string, orderId: string, signature: string): Promise<PaymentResult>

// Subscription management
activateSubscription(studentId: string, planId: string): Promise<Subscription>
cancelSubscription(subscriptionId: string): Promise<void>
getSubscriptionStatus(studentId: string): Promise<SubscriptionStatus>

// Webhook handling
processWebhook(payload: RazorpayWebhook): Promise<WebhookResult>
```

### 5. Content Domain

**Owned Entities:**
- `question_bank`
- `rag_chunks`
- `ncert_content`
- `chapter_concepts`
- `embeddings` (via pgvector)

**Read-Only Access:**
- Student grade/subject access (from Identity Domain)

**Published Events:**
- `content.question_added`
- `content.chunk_embedded`
- `content.syllabus_updated`

**Consumed Events:**
- `quiz.question_used`
- `foxy.content_requested`

**Business Rules:**
- Question quality validation (4 options, 1 correct, explanation required)
- NCERT syllabus alignment
- Difficulty and Bloom's taxonomy tagging
- Embedding quality thresholds

**API Contracts:**
```typescript
// Question bank management
addQuestion(question: QuestionInput): Promise<Question>
updateQuestion(id: string, updates: Partial<Question>): Promise<Question>
searchQuestions(params: QuestionSearchParams): Promise<Question[]>

// RAG operations
embedContent(content: ContentChunk): Promise<EmbeddingResult>
retrieveRelevant(query: string, context: RetrievalContext): Promise<ContentChunk[]>

// Content validation
validateQuestion(question: QuestionInput): Promise<ValidationResult>
checkSyllabusAlignment(question: Question, syllabus: Syllabus): Promise<AlignmentResult>
```

### 6. Analytics Domain

**Owned Entities:**
- `audit_logs`
- `student_analytics`
- `usage_metrics`
- `performance_reports`

**Read-Only Access:**
- All domain events (via event log)
- Student profiles (from Identity Domain)
- Quiz sessions (from Quiz Domain)
- Subscription data (from Billing Domain)

**Published Events:**
- `analytics.report_generated`
- `usage.threshold_exceeded`

**Consumed Events:**
- All domain events for aggregation

**Business Rules:**
- No PII in analytics data
- Configurable retention policies
- Real-time dashboard updates
- Export capabilities for compliance

**API Contracts:**
```typescript
// Data aggregation
getStudentMetrics(studentId: string, timeframe: Timeframe): Promise<StudentMetrics>
getClassAnalytics(classId: string): Promise<ClassAnalytics>
getPlatformMetrics(timeframe: Timeframe): Promise<PlatformMetrics>

// Reporting
generateReport(params: ReportParams): Promise<Report>
exportData(params: ExportParams): Promise<ExportResult>

// Real-time updates
subscribeToMetrics(studentId: string): Promise<MetricsStream>
```

### 7. Assessment Domain

**Owned Entities:**
- `concept_mastery`
- `knowledge_gaps`
- `diagnostic_sessions`
- `learning_graph_nodes`
- `cme_error_log`

**Read-Only Access:**
- Quiz performance (from Quiz Domain)
- Student profiles (from Identity Domain)

**Published Events:**
- `assessment.diagnostic_completed`
- `mastery.achieved`
- `gap.identified`
- `learning_path.updated`

**Consumed Events:**
- `quiz.completed`
- `practice.completed`
- `foxy.guidance_provided`

**Business Rules:**
- BKT model for knowledge estimation
- IRT model for ability estimation
- Cognitive learning loop (8-step process)
- Misconception remediation tracking

**API Contracts:**
```typescript
// Diagnostic assessment
startDiagnostic(studentId: string, subject: string): Promise<DiagnosticSession>
submitDiagnostic(sessionId: string, responses: Response[]): Promise<DiagnosticResult>

// Mastery tracking
updateMastery(studentId: string, conceptId: string, performance: number): Promise<MasteryUpdate>
getKnowledgeGaps(studentId: string): Promise<KnowledgeGap[]>

// Learning path
generateLearningPath(studentId: string): Promise<LearningPath>
updateLearningGraph(studentId: string, updates: GraphUpdate[]): Promise<void>
```

## Communication Patterns

### Synchronous APIs (Immediate Responses)
- User authentication and authorization
- Real-time quiz question fetching
- Payment order creation
- Content retrieval for immediate display

### Event-Driven Communication (Async Processing)
- Cross-domain side effects (XP updates, analytics)
- Background processing (report generation, email sending)
- State synchronization (subscription changes, role updates)

### Event Schema Standards
```typescript
interface DomainEvent {
  eventId: string;
  eventType: string; // e.g., "quiz.completed"
  aggregateId: string; // e.g., quiz session ID
  aggregateType: string; // e.g., "quiz_session"
  data: Record<string, unknown>;
  metadata: {
    timestamp: string;
    userId?: string;
    sessionId?: string;
    correlationId: string;
  };
}
```

## Data Ownership Matrix

| Entity | Owner Domain | Read Access | Write Access |
|--------|-------------|-------------|--------------|
| students | Identity | Quiz, Foxy, Analytics, Billing | Identity only |
| quiz_sessions | Quiz | Analytics, Assessment | Quiz only |
| payments | Billing | Analytics, Admin | Billing only |
| question_bank | Content | Quiz, Foxy | Content only |
| audit_logs | Analytics | Admin | All domains (append-only) |
| concept_mastery | Assessment | Foxy, Quiz | Assessment only |

## Service Extraction Priorities

### Phase 1 (High Priority)
1. **Billing Service** - Clear boundaries, payment integrity critical
2. **Quiz Service** - Complex logic, performance bottleneck
3. **Foxy Service** - AI isolation, usage limits

### Phase 2 (Medium Priority)
4. **Analytics Service** - Heavy queries, clear read-only access
5. **Content Service** - RAG pipeline, embedding management
6. **Assessment Service** - Cognitive models, learning state

### Phase 3 (Lower Priority)
7. **Identity Service** - Cross-cutting, complex relationships
8. **Notification Service** - Async processing, delivery tracking
9. **Admin Service** - Security-critical, audit requirements

## Implementation Guidelines

### Domain Module Structure
```
src/lib/domains/{domain}/
├── index.ts          # Public API exports
├── service.ts        # Business logic
├── repository.ts     # Data access
├── events.ts         # Event definitions
├── types.ts          # Domain types
└── __tests__/        # Unit tests
```

### Service Contract Patterns
- All functions return `ServiceResult<T>`
- Explicit error codes for different failure modes
- Idempotent operations where appropriate
- Comprehensive input validation

### Event Publishing
- Domain events published via central event bus
- Async processing with dead letter queues
- Correlation IDs for request tracing
- Event versioning for schema evolution

### Testing Strategy
- Unit tests for domain logic
- Integration tests for service contracts
- Contract tests between domains
- End-to-end tests for critical user journeys</content>
<parameter name="filePath">c:\Users\Bharangpur Primary\Alfanumrik-repo\.claude\worktrees\compassionate-curie\DOMAIN_BOUNDARIES.md