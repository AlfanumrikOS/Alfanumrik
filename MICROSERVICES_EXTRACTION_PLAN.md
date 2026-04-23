# MICROSERVICES_EXTRACTION_PLAN.md

## Microservices Extraction Strategy for Alfanumrik

This document outlines the phased plan for extracting microservices from the current monolithic Next.js application. The strategy prioritizes stability, business value, and risk mitigation.

## Strategic Principles

### Extraction Criteria
1. **Business Value**: Services that unlock independent scaling or deployment
2. **Technical Risk**: Services with clear boundaries and minimal coupling
3. **Performance Impact**: Services that are current or future bottlenecks
4. **Security Requirements**: Services handling sensitive data or operations

### Non-Extraction Criteria
1. **Tight Coupling**: Services with complex interdependencies
2. **Low Business Value**: Services that don't benefit from isolation
3. **High Migration Risk**: Services requiring complex data migrations
4. **Minimal Load**: Services that don't justify operational overhead

### Success Metrics
- **Stability**: Zero downtime during extraction
- **Performance**: No degradation in user experience
- **Maintainability**: Clear service boundaries and contracts
- **Scalability**: Independent scaling of extracted services

## Current State Assessment

### Coupling Analysis Results
- **Database Coupling**: High - most services query across domain boundaries
- **API Coupling**: Medium - some cross-domain API calls, but mostly contained
- **Event Coupling**: Low - minimal event-driven communication
- **UI Coupling**: High - business logic scattered in components

### Extraction Readiness Score

| Domain | Readiness | Coupling Level | Business Value | Risk Level |
|--------|-----------|----------------|----------------|------------|
| Billing | High | Low | High | Low |
| Quiz | Medium | Medium | High | Medium |
| Foxy AI | Medium | Low | High | Medium |
| Analytics | Low | High | Medium | High |
| Content | Low | Medium | Medium | High |
| Identity | Low | High | High | High |

## Phase 1: Foundation (Weeks 1-2)

### Objective
Establish domain boundaries and modularize the monolith before extraction.

### Tasks

#### 1.1 Complete Domain Modularization
**Goal**: Move all business logic into domain modules
**Files to Create/Modify**:
- `src/lib/domains/billing/service.ts`
- `src/lib/domains/billing/repository.ts`
- `src/lib/domains/analytics/service.ts`
- `src/lib/domains/content/service.ts`
- `src/lib/domains/assessment/service.ts`

**Implementation**:
```typescript
// Example: Billing domain module
export class BillingService {
  async createSubscription(params: CreateSubscriptionParams): Promise<ServiceResult<Subscription>> {
    // Business logic here
  }

  async processWebhook(webhook: RazorpayWebhook): Promise<ServiceResult<void>> {
    // Webhook processing logic
  }
}
```

#### 1.2 Implement Event System
**Goal**: Establish async communication between domains
**Files to Create**:
- `src/lib/events/event-bus.ts`
- `src/lib/events/publishers/`
- `src/lib/events/consumers/`

**Implementation**:
```typescript
// Event publishing
await eventBus.publish({
  eventType: 'quiz.completed',
  aggregateId: sessionId,
  data: { score: 85, xpEarned: 50 }
});

// Event consumption
eventBus.subscribe('quiz.completed', async (event) => {
  await analyticsService.recordQuizCompletion(event.data);
});
```

#### 1.3 Add Service-Level Testing
**Goal**: Ensure domain modules work correctly
**Files to Create**:
- `src/lib/domains/*/service.test.ts`
- `src/lib/domains/*/repository.test.ts`

#### 1.4 Update API Routes
**Goal**: API routes use domain modules instead of direct DB access
**Files to Modify**:
- `src/app/api/quiz/route.ts`
- `src/app/api/payments/route.ts`
- `src/app/api/foxy/route.ts`

### Success Criteria
- All business logic moved to domain modules
- Event system operational
- 80% test coverage on domain modules
- API routes using domain services

## Phase 2: First Extractions (Weeks 3-6)

### 2.1 Extract Billing Service

**Business Justification**:
- Payment processing is security-critical
- Subscription state affects all user experiences
- Webhook processing needs isolation
- Independent scaling for payment load

**Technical Scope**:
- **Owned Tables**: `student_subscriptions`, `payments`, `razorpay_orders`, `razorpay_webhooks`
- **API Endpoints**: `/api/payments/*`, `/api/billing/*`
- **Dependencies**: Identity domain (read-only), Analytics domain (events)

**Implementation Plan**:

#### Step 2.1.1: Create Service Infrastructure
```typescript
// src/services/billing/
├── index.ts              # Service entry point
├── app.ts               # Express/Fastify app
├── routes/
│   ├── payments.ts
│   ├── subscriptions.ts
│   └── webhooks.ts
├── services/
│   ├── payment-service.ts
│   └── subscription-service.ts
├── repositories/
│   └── billing-repository.ts
├── events/
│   └── billing-events.ts
└── config/
    └── database.ts
```

#### Step 2.1.2: Database Migration
- Extract billing tables to separate schema (optional)
- Update RLS policies for service role access
- Create migration scripts with rollback

#### Step 2.1.3: API Migration
- Deploy billing service to separate container/host
- Update Next.js API routes to proxy to billing service
- Implement circuit breaker pattern

#### Step 2.1.4: Event Integration
- Publish billing events to event bus
- Subscribe to user registration events
- Update dependent services

**Risk Mitigation**:
- **Rollback Plan**: Keep original API routes as fallback
- **Data Consistency**: Use database transactions for state changes
- **Testing**: Comprehensive integration tests before cutover

**Timeline**: 2 weeks
**Team**: Backend Engineer + DevOps

### 2.2 Extract Quiz Service

**Business Justification**:
- Quiz generation is computationally expensive
- Anti-cheat logic is complex and critical
- Independent scaling needed for concurrent quiz attempts
- Scoring consistency across all quiz types

**Technical Scope**:
- **Owned Tables**: `quiz_sessions`, `quiz_responses`, `user_question_history`
- **API Endpoints**: `/api/quiz/*`
- **Dependencies**: Content domain (questions), Identity domain (students), Assessment domain (cognitive state)

**Implementation Plan**:

#### Step 2.2.1: Service Architecture
```typescript
// src/services/quiz/
├── index.ts
├── app.ts
├── routes/
│   ├── quiz.ts
│   └── questions.ts
├── services/
│   ├── quiz-engine.ts
│   ├── scoring-service.ts
│   └── anti-cheat.ts
├── repositories/
│   └── quiz-repository.ts
└── workers/
    └── question-generator.ts
```

#### Step 2.2.2: Performance Optimization
- Implement question caching
- Add connection pooling
- Optimize database queries

#### Step 2.2.3: Anti-Cheat Integration
- Move all anti-cheat logic to service
- Implement server-side validation
- Add audit logging

**Risk Mitigation**:
- **Gradual Rollout**: Feature flag to route traffic
- **Fallback**: Keep monolithic quiz API as backup
- **Monitoring**: Detailed performance metrics

**Timeline**: 3 weeks
**Team**: Backend Engineer + Assessment Specialist

### 2.3 Extract Foxy AI Service

**Business Justification**:
- AI API calls are expensive and rate-limited
- Usage quotas need strict enforcement
- RAG retrieval can be resource-intensive
- Independent scaling for AI load

**Technical Scope**:
- **Owned Tables**: `foxy_sessions`, `foxy_chat_messages`, `ai_tutor_logs`, `student_daily_usage`
- **API Endpoints**: `/api/foxy/*`
- **Dependencies**: Content domain (RAG), Identity domain (students), Assessment domain (cognitive state)

**Implementation Plan**:

#### Step 2.3.1: Service Structure
```typescript
// src/services/foxy/
├── index.ts
├── app.ts
├── routes/
│   └── chat.ts
├── services/
│   ├── conversation-service.ts
│   ├── rag-service.ts
│   └── quota-service.ts
├── ai/
│   ├── claude-client.ts
│   └── prompt-engine.ts
└── repositories/
    └── foxy-repository.ts
```

#### Step 2.3.2: AI Optimization
- Implement response caching
- Add prompt optimization
- Circuit breaker for Claude API

#### Step 2.3.3: Streaming Integration
- WebSocket support for real-time responses
- Connection pooling for concurrent users

**Risk Mitigation**:
- **Quota Safety**: Strict enforcement prevents cost overruns
- **Fallback**: Cached responses for API failures
- **Monitoring**: AI usage and performance metrics

**Timeline**: 2 weeks
**Team**: AI Engineer + Backend Engineer

## Phase 3: Secondary Extractions (Weeks 7-12)

### 3.1 Extract Analytics Service

**Business Justification**:
- Heavy aggregation queries impact core performance
- Analytics needs different scaling characteristics
- Data retention and compliance requirements
- Real-time dashboard demands

**Technical Scope**:
- **Owned Tables**: `audit_logs`, `student_analytics`, `usage_metrics`
- **Read Access**: All domain events and tables (read-only)
- **API Endpoints**: `/api/analytics/*`, `/api/reports/*`

### 3.2 Extract Content Service

**Business Justification**:
- RAG embedding generation is compute-intensive
- Question bank management needs isolation
- Content quality validation is complex
- Independent deployment for content updates

**Technical Scope**:
- **Owned Tables**: `question_bank`, `rag_chunks`, `embeddings`
- **Dependencies**: Minimal (mostly read-only access from other domains)

### 3.3 Extract Assessment Service

**Business Justification**:
- Cognitive models are computationally intensive
- Learning state updates need consistency
- Diagnostic assessments require isolation
- Mastery tracking is business-critical

## Phase 4: Infrastructure & Operations (Weeks 13-16)

### 4.1 Service Mesh Implementation
- **API Gateway**: Route requests to appropriate services
- **Service Discovery**: Automatic service location
- **Load Balancing**: Distribute traffic across instances

### 4.2 Observability Enhancement
- **Distributed Tracing**: Request correlation across services
- **Centralized Logging**: Structured logs from all services
- **Metrics Collection**: Business and technical metrics

### 4.3 Deployment Automation
- **CI/CD Pipelines**: Independent deployment of services
- **Blue-Green Deployments**: Zero-downtime updates
- **Rollback Automation**: Quick recovery procedures

## Risk Assessment & Mitigation

### High-Risk Items

#### 1. Data Consistency During Migration
**Risk**: Services have inconsistent views during transition
**Mitigation**:
- Use database transactions for multi-service operations
- Implement eventual consistency checks
- Maintain monolithic fallback during transition

#### 2. Performance Degradation
**Risk**: Network latency between services
**Mitigation**:
- Optimize service communication patterns
- Implement caching layers
- Monitor performance metrics closely

#### 3. Increased Operational Complexity
**Risk**: Managing multiple services increases overhead
**Mitigation**:
- Automate deployment and monitoring
- Use managed services where possible
- Start with minimal viable services

### Rollback Strategies

#### Service-Level Rollback
- Keep monolithic versions deployed
- Feature flags to route traffic back
- Database migration rollbacks

#### Full System Rollback
- Complete backup of monolithic state
- Automated redeployment scripts
- Data restoration procedures

## Success Metrics

### Phase 1 Success
- ✅ Domain modules implemented and tested
- ✅ Event system operational
- ✅ 80% of API routes using domain services
- ✅ No performance degradation

### Phase 2 Success
- ✅ Billing, Quiz, and Foxy services extracted
- ✅ Independent scaling demonstrated
- ✅ Improved performance metrics
- ✅ Zero downtime during extractions

### Overall Success
- ✅ 50% reduction in monolithic complexity
- ✅ Improved deployment frequency
- ✅ Better fault isolation
- ✅ Maintained or improved user experience

## Timeline Summary

| Phase | Duration | Services Extracted | Key Milestones |
|-------|----------|-------------------|----------------|
| 1 | 2 weeks | None (modularization) | Domain boundaries established |
| 2 | 4 weeks | Billing, Quiz, Foxy | Core business services isolated |
| 3 | 6 weeks | Analytics, Content, Assessment | Secondary services extracted |
| 4 | 4 weeks | Infrastructure | Production-ready deployment |

## Resource Requirements

### Team Composition
- **Principal Architect**: Overall design and technical leadership
- **Backend Engineers (2)**: Service implementation and API development
- **DevOps Engineer**: Infrastructure and deployment automation
- **QA Engineer**: Testing strategy and execution
- **Domain Experts**: Business logic validation

### Infrastructure Costs
- **Additional Servers**: 3-5 service instances ($200-500/month)
- **Database**: Separate schemas or instances ($100-300/month)
- **Monitoring**: Enhanced observability tools ($50-150/month)

## Conclusion

This extraction plan prioritizes business value and stability over architectural purity. By starting with high-value, low-risk services and establishing strong foundations, we can achieve significant improvements in scalability and maintainability while minimizing disruption to users.</content>
<parameter name="filePath">c:\Users\Bharangpur Primary\Alfanumrik-repo\.claude\worktrees\compassionate-curie\MICROSERVICES_EXTRACTION_PLAN.md