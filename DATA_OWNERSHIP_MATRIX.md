# DATA_OWNERSHIP_MATRIX.md

## Data Ownership and Access Control Matrix

This document defines data ownership boundaries, access patterns, and consistency guarantees for the Alfanumrik platform. Clear ownership prevents data inconsistency and enables independent service evolution.

## Ownership Principles

### 1. Single Writer Principle
- Each table/entity has exactly one service with write access
- Read access can be granted to multiple services
- Schema changes require owner approval

### 2. Domain Isolation
- Services own their core business entities
- Cross-domain references use foreign keys or events
- No direct table joins across domain boundaries

### 3. Consistency Guarantees
- Strong consistency within domain boundaries
- Eventual consistency for cross-domain updates
- Explicit contracts for data sharing

## Data Ownership Matrix

### Identity Domain

**Owner Service**: Identity Service
**Database Schema**: `identity` (future partitioning)

| Table/Entity | Write Access | Read Access | Description |
|-------------|-------------|-------------|-------------|
| `users` | Identity | All services | Supabase Auth users |
| `students` | Identity | Quiz, Foxy, Analytics, Billing | Student profiles and preferences |
| `teachers` | Identity | Analytics, Admin | Teacher profiles and assignments |
| `guardians` | Identity | Analytics, Notification | Parent profiles |
| `user_roles` | Identity | All services | Role assignments |
| `guardian_student_links` | Identity | Analytics, Notification | Parent-child relationships |
| `school_memberships` | Identity | Analytics, Admin | Institution affiliations |

**Consistency Requirements**:
- Student profile changes must be atomic
- Role changes require audit logging
- Relationship changes trigger notifications

### Quiz Domain

**Owner Service**: Quiz Service
**Database Schema**: `quiz` (future partitioning)

| Table/Entity | Write Access | Read Access | Description |
|-------------|-------------|-------------|-------------|
| `quiz_sessions` | Quiz | Analytics, Assessment | Quiz attempt records |
| `quiz_responses` | Quiz | Analytics, Assessment | Individual question responses |
| `user_question_history` | Quiz | Analytics, Assessment | Question exposure tracking |
| `quiz_analytics` | Quiz | Analytics | Performance aggregations |

**Read-Only Dependencies**:
- `question_bank` (Content Domain) - for question retrieval
- `students` (Identity Domain) - for profile validation
- `concept_mastery` (Assessment Domain) - for adaptive selection

**Consistency Requirements**:
- Quiz submission must be atomic (responses + scoring + XP)
- Anti-cheat validation before scoring
- Question history updates must be idempotent

### Foxy AI Domain

**Owner Service**: Foxy Service
**Database Schema**: `foxy` (future partitioning)

| Table/Entity | Write Access | Read Access | Description |
|-------------|-------------|-------------|-------------|
| `foxy_sessions` | Foxy | Analytics | Conversation sessions |
| `foxy_chat_messages` | Foxy | Analytics | Individual messages |
| `ai_tutor_logs` | Foxy | Analytics | AI interaction logs |
| `student_daily_usage` | Foxy | Billing, Analytics | Usage quotas |

**Read-Only Dependencies**:
- `rag_chunks` (Content Domain) - for retrieval
- `students` (Identity Domain) - for profile access
- `concept_mastery` (Assessment Domain) - for cognitive context

**Consistency Requirements**:
- Usage tracking must be atomic with message storage
- Session continuity across page refreshes
- Quota enforcement before AI API calls

### Billing Domain

**Owner Service**: Billing Service
**Database Schema**: `billing` (future partitioning)

| Table/Entity | Write Access | Read Access | Description |
|-------------|-------------|-------------|-------------|
| `student_subscriptions` | Billing | All services | Active subscriptions |
| `payments` | Billing | Analytics, Admin | Payment records |
| `razorpay_orders` | Billing | Analytics | Order records |
| `razorpay_webhooks` | Billing | Admin | Webhook logs |

**Read-Only Dependencies**:
- `students` (Identity Domain) - for subscription ownership

**Consistency Requirements**:
- Payment verification must be atomic with subscription updates
- Webhook processing must be idempotent
- No subscription access without verified payment

### Content Domain

**Owner Service**: Content Service
**Database Schema**: `content` (future partitioning)

| Table/Entity | Write Access | Read Access | Description |
|-------------|-------------|-------------|-------------|
| `question_bank` | Content | Quiz, Foxy, Analytics | Question repository |
| `rag_chunks` | Content | Foxy, Analytics | Content chunks for RAG |
| `ncert_content` | Content | Foxy, Analytics | NCERT textbook content |
| `chapter_concepts` | Content | Assessment, Analytics | Concept mappings |
| `embeddings` | Content | Foxy | Vector embeddings |

**Read-Only Dependencies**:
- None (content is relatively independent)

**Consistency Requirements**:
- Question validation before insertion
- Embedding generation must be atomic with content storage
- Content updates require re-embedding

### Analytics Domain

**Owner Service**: Analytics Service
**Database Schema**: `analytics` (future partitioning)

| Table/Entity | Write Access | Read Access | Description |
|-------------|-------------|-------------|-------------|
| `audit_logs` | All services (append-only) | Analytics, Admin | Security audit trail |
| `student_analytics` | Analytics | Admin, Reporting | Aggregated metrics |
| `usage_metrics` | Analytics | Admin, Billing | Usage statistics |
| `performance_reports` | Analytics | Admin | Generated reports |

**Read-Only Dependencies**:
- All domain tables (read-only access for aggregation)

**Consistency Requirements**:
- Audit logs must be append-only
- Analytics aggregations can be eventually consistent
- Report generation should not block core services

### Assessment Domain

**Owner Service**: Assessment Service
**Database Schema**: `assessment` (future partitioning)

| Table/Entity | Write Access | Read Access | Description |
|-------------|-------------|-------------|-------------|
| `concept_mastery` | Assessment | Quiz, Foxy, Analytics | Knowledge state |
| `knowledge_gaps` | Assessment | Foxy, Analytics | Identified gaps |
| `diagnostic_sessions` | Assessment | Analytics | Diagnostic attempts |
| `learning_graph_nodes` | Assessment | Analytics | Concept relationships |
| `cme_error_log` | Assessment | Analytics | Cognitive model errors |

**Read-Only Dependencies**:
- `quiz_sessions` (Quiz Domain) - for performance analysis
- `students` (Identity Domain) - for profile access

**Consistency Requirements**:
- Mastery updates must be atomic
- Diagnostic results must be consistent
- Learning graph updates require transaction safety

## Cross-Domain Data Access Patterns

### 1. Foreign Key References
```sql
-- Identity domain references
ALTER TABLE quiz_sessions ADD CONSTRAINT fk_student
  FOREIGN KEY (student_id) REFERENCES identity.students(id);

-- Content domain references
ALTER TABLE quiz_responses ADD CONSTRAINT fk_question
  FOREIGN KEY (question_id) REFERENCES content.question_bank(id);
```

### 2. Read-Only Views
```sql
-- Analytics can read quiz data via views
CREATE VIEW analytics.quiz_performance AS
SELECT * FROM quiz.quiz_sessions
WHERE created_at > CURRENT_DATE - INTERVAL '90 days';
```

### 3. Event-Driven Updates
```typescript
// Quiz completion triggers analytics update
eventBus.publish({
  eventType: 'quiz.completed',
  data: { studentId, score, subject, duration }
});

// Analytics service subscribes and updates aggregates
eventBus.subscribe('quiz.completed', async (event) => {
  await analyticsService.updateStudentMetrics(event.data);
});
```

### 4. API-Based Access
```typescript
// Foxy service reads student cognitive state via API
const cognitiveState = await assessmentService.getCognitiveState(studentId);

// Instead of direct DB access
// const { data } = await supabase.from('concept_mastery').select('*').eq('student_id', studentId);
```

## Data Consistency Guarantees

### Strong Consistency (ACID)
- Within domain boundaries
- Financial transactions (Billing)
- User identity changes (Identity)
- Quiz submissions (Quiz)

### Eventual Consistency
- Cross-domain analytics updates
- Search index updates
- Cache invalidation
- Notification delivery

### Conflict Resolution
- Last-write-wins for non-critical updates
- Manual resolution for conflicting business rules
- Audit logging for all conflicts

## Database Partitioning Strategy

### Schema Separation
```
-- Future partitioning by domain
CREATE SCHEMA identity;
CREATE SCHEMA quiz;
CREATE SCHEMA foxy;
CREATE SCHEMA billing;
CREATE SCHEMA content;
CREATE SCHEMA analytics;
CREATE SCHEMA assessment;

-- Cross-schema foreign keys with proper permissions
GRANT USAGE ON SCHEMA identity TO quiz_service;
GRANT SELECT ON identity.students TO quiz_service;
```

### Migration Strategy
1. **Phase 1**: Logical separation (same database, different schemas)
2. **Phase 2**: Physical separation (separate database instances)
3. **Phase 3**: Geographic distribution (region-specific replicas)

## Access Control Implementation

### Service-Level Permissions
```sql
-- Create service roles
CREATE ROLE quiz_service LOGIN;
CREATE ROLE foxy_service LOGIN;

-- Grant minimal permissions
GRANT SELECT ON identity.students TO quiz_service;
GRANT SELECT, INSERT, UPDATE ON quiz.* TO quiz_service;
```

### Row-Level Security
```sql
-- RLS policies for cross-domain access
CREATE POLICY quiz_access_students ON identity.students
  FOR SELECT TO quiz_service
  USING (true); -- Service-level access control

CREATE POLICY student_own_data ON quiz.quiz_sessions
  FOR ALL TO student_role
  USING (student_id = current_student_id());
```

### Audit Logging
```sql
-- All cross-domain data access is logged
CREATE TABLE audit.data_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  record_id UUID,
  user_id UUID,
  accessed_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Migration Planning

### Phase 1: Logical Separation
- Create domain schemas
- Move tables to appropriate schemas
- Update foreign key references
- Grant cross-schema permissions
- Update application code

### Phase 2: Service Extraction
- Deploy services with separate databases
- Implement API-based cross-domain communication
- Add circuit breakers and retries
- Monitor performance and errors

### Phase 3: Physical Separation
- Move to separate database instances
- Implement database-level replication
- Add cross-region data synchronization
- Optimize for geographic distribution

## Monitoring and Compliance

### Data Access Monitoring
- Log all cross-domain data access
- Alert on unusual access patterns
- Audit trail for compliance

### Performance Monitoring
- Query performance by domain
- Cross-domain call latency
- Database connection usage

### Data Quality Monitoring
- Schema consistency checks
- Foreign key integrity validation
- Data duplication detection

## Rollback Procedures

### Schema Rollback
```sql
-- Revert schema changes
DROP SCHEMA IF EXISTS quiz;
ALTER TABLE quiz_sessions SET SCHEMA public;
-- Restore original permissions
```

### Service Rollback
- Route traffic back to monolithic API
- Decommission extracted service
- Restore database permissions
- Update application configuration

### Data Recovery
- Point-in-time database recovery
- Selective data restoration
- Consistency validation
- User notification for data loss</content>
<parameter name="filePath">c:\Users\Bharangpur Primary\Alfanumrik-repo\.claude\worktrees\compassionate-curie\DATA_OWNERSHIP_MATRIX.md