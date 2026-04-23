# API_CONTRACTS_MATRIX.md

## Service API Contracts Matrix

This document defines the API contracts between services and domains in the Alfanumrik platform. All contracts follow RESTful principles with JSON payloads and standard HTTP status codes.

## Contract Standards

### Response Format
```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: {
    requestId: string;
    timestamp: string;
    version: string;
  };
}
```

### Error Codes
- `VALIDATION_ERROR`: Invalid input parameters
- `NOT_FOUND`: Resource does not exist
- `FORBIDDEN`: Authorization failed
- `RATE_LIMITED`: Too many requests
- `INTERNAL_ERROR`: Server error
- `SERVICE_UNAVAILABLE`: Downstream service failure

### Authentication
- All service-to-service calls use API keys
- User-scoped requests include JWT tokens
- API keys rotated quarterly

## Domain Service Contracts

### 1. Identity Service

**Base URL**: `https://identity.alfanumrik.com/api/v1`

#### User Management
```
POST /users
Authorization: Bearer <service-key>
Body: { email, role, profile }
Response: { success: true, data: { userId, profile } }
```

```
GET /users/{userId}
Authorization: Bearer <jwt-token>
Response: { success: true, data: { profile, roles, permissions } }
```

#### Role Management
```
POST /users/{userId}/roles
Authorization: Bearer <service-key>
Body: { role, context }
Response: { success: true }
```

```
GET /users/{userId}/permissions
Authorization: Bearer <jwt-token>
Response: { success: true, data: { roles, permissions } }
```

#### Relationships
```
POST /relationships/guardian-student
Authorization: Bearer <jwt-token>
Body: { guardianId, studentId, relationship }
Response: { success: true, data: { linkId } }
```

```
GET /students/{studentId}/guardians
Authorization: Bearer <jwt-token>
Response: { success: true, data: { guardians: [...] } }
```

### 2. Quiz Service

**Base URL**: `https://quiz.alfanumrik.com/api/v1`

#### Quiz Lifecycle
```
POST /quizzes
Authorization: Bearer <jwt-token>
Body: {
  studentId: string,
  subject: string,
  grade: string,
  count: number,
  difficulty: string
}
Response: {
  success: true,
  data: {
    sessionId: string,
    questions: [...],
    timeLimit: number
  }
}
```

```
POST /quizzes/{sessionId}/submit
Authorization: Bearer <jwt-token>
Body: {
  responses: [{ questionId, selectedIndex, timeTaken }],
  clientChecksum: string
}
Response: {
  success: true,
  data: {
    score: number,
    correct: number,
    total: number,
    xpEarned: number,
    feedback: [...]
  }
}
```

#### Question Management
```
GET /questions
Authorization: Bearer <jwt-token>
Query: ?subject=math&grade=9&count=10&difficulty=medium
Response: {
  success: true,
  data: {
    questions: [...],
    source: "rag" | "rpc" | "cache"
  }
}
```

#### Analytics
```
GET /students/{studentId}/quiz-history
Authorization: Bearer <jwt-token>
Query: ?subject=math&timeframe=30d
Response: {
  success: true,
  data: {
    sessions: [...],
    averages: { score: 85, time: 120 }
  }
}
```

### 3. Foxy AI Service

**Base URL**: `https://foxy.alfanumrik.com/api/v1`

#### Conversation Management
```
POST /conversations
Authorization: Bearer <jwt-token>
Body: {
  studentId: string,
  subject: string,
  grade: string,
  mode: "learn" | "quiz" | "revise" | "doubt",
  topic?: string
}
Response: {
  success: true,
  data: {
    sessionId: string,
    welcomeMessage: string
  }
}
```

```
POST /conversations/{sessionId}/messages
Authorization: Bearer <jwt-token>
Body: {
  message: string,
  context?: { chapter, topic, difficulty }
}
Response: {
  success: true,
  data: {
    response: string,
    sources: [...],
    sessionId: string,
    quotaRemaining: number
  }
}
```

#### Usage Management
```
GET /quota/{studentId}
Authorization: Bearer <jwt-token>
Response: {
  success: true,
  data: {
    used: number,
    limit: number,
    remaining: number,
    resetsAt: string
  }
}
```

### 4. Billing Service

**Base URL**: `https://billing.alfanumrik.com/api/v1`

#### Payment Processing
```
POST /orders
Authorization: Bearer <jwt-token>
Body: {
  studentId: string,
  planId: string,
  amount: number,
  currency: "INR"
}
Response: {
  success: true,
  data: {
    orderId: string,
    razorpayOrderId: string,
    amount: number,
    currency: string
  }
}
```

```
POST /payments/verify
Authorization: Bearer <service-key>
Body: {
  razorpayPaymentId: string,
  razorpayOrderId: string,
  razorpaySignature: string
}
Response: {
  success: true,
  data: {
    paymentId: string,
    subscriptionId: string,
    status: "completed"
  }
}
```

#### Subscription Management
```
GET /subscriptions/{studentId}
Authorization: Bearer <jwt-token>
Response: {
  success: true,
  data: {
    planId: string,
    status: "active" | "cancelled",
    currentPeriodEnd: string,
    features: [...]
  }
}
```

```
POST /subscriptions/{subscriptionId}/cancel
Authorization: Bearer <jwt-token>
Body: { reason?: string }
Response: { success: true }
```

#### Webhooks
```
POST /webhooks/razorpay
Authorization: Bearer <razorpay-signature>
X-Razorpay-Signature: <signature>
Body: <razorpay-webhook-payload>
Response: { success: true }
```

### 5. Content Service

**Base URL**: `https://content.alfanumrik.com/api/v1`

#### Question Bank
```
GET /questions/search
Authorization: Bearer <service-key>
Query: ?subject=math&grade=9&difficulty=medium&limit=20
Response: {
  success: true,
  data: {
    questions: [...],
    total: number,
    hasMore: boolean
  }
}
```

```
POST /questions
Authorization: Bearer <service-key>
Body: {
  question: string,
  options: [...],
  correctAnswerIndex: number,
  explanation: string,
  subject: string,
  grade: string,
  chapter: number,
  difficulty: number,
  bloomLevel: string
}
Response: {
  success: true,
  data: { questionId: string }
}
```

#### RAG Operations
```
POST /rag/retrieve
Authorization: Bearer <service-key>
Body: {
  query: string,
  subject: string,
  grade: string,
  chapter?: number,
  limit: number
}
Response: {
  success: true,
  data: {
    chunks: [...],
    quality: number,
    sources: [...]
  }
}
```

### 6. Analytics Service

**Base URL**: `https://analytics.alfanumrik.com/api/v1`

#### Metrics Collection
```
POST /events
Authorization: Bearer <service-key>
Body: {
  eventType: string,
  userId?: string,
  studentId?: string,
  data: Record<string, unknown>,
  timestamp: string
}
Response: { success: true }
```

#### Reporting
```
GET /students/{studentId}/metrics
Authorization: Bearer <jwt-token>
Query: ?timeframe=30d&subject=math
Response: {
  success: true,
  data: {
    quizzesCompleted: number,
    averageScore: number,
    timeSpent: number,
    topicsMastered: [...]
  }
}
```

```
GET /reports/class/{classId}
Authorization: Bearer <jwt-token>
Response: {
  success: true,
  data: {
    students: [...],
    averages: {...},
    trends: [...]
  }
}
```

### 7. Assessment Service

**Base URL**: `https://assessment.alfanumrik.com/api/v1`

#### Diagnostic Assessment
```
POST /diagnostics
Authorization: Bearer <jwt-token>
Body: {
  studentId: string,
  subject: string,
  grade: string
}
Response: {
  success: true,
  data: {
    sessionId: string,
    questions: [...]
  }
}
```

#### Mastery Tracking
```
POST /mastery
Authorization: Bearer <service-key>
Body: {
  studentId: string,
  conceptId: string,
  performance: number,
  context: { quizId?, practiceId? }
}
Response: { success: true }
```

```
GET /students/{studentId}/gaps
Authorization: Bearer <jwt-token>
Response: {
  success: true,
  data: {
    knowledgeGaps: [...],
    recommendedTopics: [...]
  }
}
```

## Cross-Service Communication

### Synchronous Calls
- Identity → All services (user validation)
- Quiz → Content (question retrieval)
- Foxy → Content (RAG retrieval)
- All → Analytics (event publishing)

### Event-Driven Communication
```typescript
// Event publishing contract
interface DomainEvent {
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  data: Record<string, unknown>;
  metadata: {
    timestamp: string;
    correlationId: string;
    userId?: string;
    studentId?: string;
    service: string;
  };
}

// Example events
{
  eventType: "quiz.completed",
  aggregateId: "quiz-123",
  data: { score: 85, xpEarned: 50, subject: "math" },
  metadata: { correlationId: "req-456", studentId: "stu-789" }
}

{
  eventType: "payment.completed",
  aggregateId: "pay-123",
  data: { amount: 999, planId: "pro" },
  metadata: { correlationId: "req-456", studentId: "stu-789" }
}
```

## Service Discovery & Routing

### API Gateway Configuration
```
# Identity routes
/identity/* → identity.alfanumrik.com

# Quiz routes
/quiz/* → quiz.alfanumrik.com

# Foxy routes
/foxy/* → foxy.alfanumrik.com

# Billing routes
/payments/* → billing.alfanumrik.com
/billing/* → billing.alfanumrik.com

# Content routes (internal only)
/content/* → content.alfanumrik.com

# Analytics routes
/analytics/* → analytics.alfanumrik.com

# Assessment routes
/assessment/* → assessment.alfanumrik.com
```

### Circuit Breaker Configuration
```typescript
const circuitBreakers = {
  identity: { failureThreshold: 5, resetTimeout: 30000 },
  quiz: { failureThreshold: 3, resetTimeout: 15000 },
  foxy: { failureThreshold: 5, resetTimeout: 60000 },
  billing: { failureThreshold: 2, resetTimeout: 10000 },
  content: { failureThreshold: 3, resetTimeout: 20000 },
  analytics: { failureThreshold: 5, resetTimeout: 45000 },
  assessment: { failureThreshold: 4, resetTimeout: 25000 }
};
```

## Versioning Strategy

### API Versioning
- URL path versioning: `/api/v1/resource`
- Backward compatibility maintained for 6 months
- Breaking changes require new version

### Schema Versioning
- Event schemas versioned with `eventType.v2`
- Database migrations include version compatibility
- Client libraries updated with deprecation warnings

## Monitoring & Observability

### Health Checks
```
GET /health
Response: {
  status: "healthy" | "degraded" | "unhealthy",
  version: string,
  dependencies: {
    database: "healthy",
    redis: "healthy"
  }
}
```

### Metrics Endpoints
```
GET /metrics
Response: Prometheus format metrics
- http_requests_total
- http_request_duration_seconds
- service_errors_total
- business_metrics (quiz_completion_rate, etc.)
```

### Distributed Tracing
- Correlation IDs propagated across service calls
- OpenTelemetry integration
- Trace sampling: 10% for normal traffic, 100% for errors

## Security Requirements

### Authentication
- Service-to-service: API keys with HMAC signatures
- User requests: JWT tokens validated by Identity service
- Webhooks: Signature verification (Razorpay, etc.)

### Authorization
- Role-based access control via Identity service
- Resource ownership validation
- Rate limiting per service and user

### Data Protection
- TLS 1.3 for all service communication
- PII encryption at rest
- Audit logging for sensitive operations

## Testing Strategy

### Contract Tests
```typescript
// Example contract test
describe('Quiz Service Contract', () => {
  it('should return valid quiz session', async () => {
    const response = await callQuizService({
      studentId: 'test-student',
      subject: 'math',
      grade: '9'
    });

    expect(response.success).toBe(true);
    expect(response.data.sessionId).toBeDefined();
    expect(response.data.questions).toHaveLength(10);
  });
});
```

### Integration Tests
- Service mesh testing with Docker Compose
- End-to-end user journey tests
- Chaos engineering for failure scenarios

### Performance Tests
- Load testing each service independently
- Cross-service latency testing
- Database connection pool testing</content>
<parameter name="filePath">c:\Users\Bharangpur Primary\Alfanumrik-repo\.claude\worktrees\compassionate-curie\API_CONTRACTS_MATRIX.md