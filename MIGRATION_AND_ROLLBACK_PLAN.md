# MIGRATION_AND_ROLLBACK_PLAN.md

## Migration and Rollback Plan

This document outlines the phased migration from monolithic Next.js application to microservices architecture, including rollback procedures and risk mitigation.

## Migration Overview

### Current Architecture
- **Monolithic Next.js App**: Single application serving all features
- **Shared Supabase Database**: All data in one PostgreSQL instance
- **Shared Infrastructure**: Vercel hosting, single domain

### Target Architecture
- **7 Microservices**: Identity, Quiz, Foxy, Billing, Content, Analytics, Assessment
- **Domain-Isolated Databases**: Separate schemas initially, physical separation later
- **API Gateway**: Route requests to appropriate services
- **Event-Driven Communication**: Async updates between services

### Migration Principles
1. **Incremental Migration**: Extract one service at a time
2. **Backward Compatibility**: Monolithic app remains functional during migration
3. **Feature Flags**: Gradual rollout with rollback capability
4. **Data Consistency**: Zero data loss, eventual consistency for cross-domain updates
5. **Monitoring First**: Comprehensive observability before, during, and after migration

## Phase 1: Foundation (Weeks 1-4)

### Objectives
- Establish migration infrastructure
- Implement monitoring and observability
- Create service extraction framework
- Fix critical monolithic issues

### Tasks

#### Week 1: Infrastructure Setup
```bash
# 1. Create separate databases for each domain
supabase db create identity_db
supabase db create quiz_db
supabase db create foxy_db
# ... etc

# 2. Set up API gateway (Cloudflare Workers or similar)
# 3. Implement distributed tracing (OpenTelemetry)
# 4. Set up centralized logging (ELK stack or similar)
```

#### Week 2: Monitoring Implementation
```typescript
// Implement comprehensive monitoring
const monitoringSetup = {
  metrics: ['response_time', 'error_rate', 'throughput'],
  tracing: 'open_telemetry',
  logging: 'structured_json',
  alerting: 'pagerduty_integration'
};
```

#### Week 3: Data Migration Framework
```typescript
// Create migration framework
class DataMigration {
  async migrateTable(sourceTable: string, targetSchema: string) {
    // 1. Create backup
    // 2. Validate data integrity
    // 3. Migrate data with transformation
    // 4. Update foreign keys
    // 5. Validate migration
  }
}
```

#### Week 4: Critical Bug Fixes
- Implement atomic quiz submissions
- Fix payment processing idempotency
- Add AI service circuit breaker
- Implement proper error handling

### Success Criteria
- ✅ All monitoring dashboards operational
- ✅ Data migration framework tested
- ✅ Critical bugs resolved
- ✅ Rollback procedures documented

## Phase 2: Identity Service Extraction (Weeks 5-8)

### Why Identity First?
- Foundational service used by all others
- Relatively isolated domain boundaries
- Critical for authentication and authorization

### Migration Steps

#### Step 1: Code Extraction (Week 5)
```typescript
// Extract identity-related code
src/
├── app/api/auth/          # Move to identity service
├── app/api/users/         # Move to identity service
├── lib/auth/              # Extract shared auth logic
└── lib/rbac/              # Extract permission logic
```

#### Step 2: Database Migration (Week 6)
```sql
-- Create identity schema
CREATE SCHEMA identity;

-- Migrate tables
ALTER TABLE users SET SCHEMA identity;
ALTER TABLE user_roles SET SCHEMA identity;
ALTER TABLE guardian_student_links SET SCHEMA identity;

-- Update foreign key references
-- Add cross-schema permissions
GRANT SELECT ON identity.users TO quiz_service;
```

#### Step 3: API Implementation (Week 7)
```typescript
// Identity service API
app/
├── api/users/
│   ├── route.ts           # GET /users/:id
│   └── [id]/
│       └── roles/
│           └── route.ts   # POST /users/:id/roles
└── api/auth/
    ├── login/route.ts     # POST /auth/login
    └── refresh/route.ts   # POST /auth/refresh
```

#### Step 4: Traffic Migration (Week 8)
```typescript
// Feature flag rollout
const identityMigration = {
  phase1: 'monolithic_only',    // 100% monolithic
  phase2: 'dual_write',         // Write to both systems
  phase3: 'identity_primary',   // 90% identity service, 10% fallback
  phase4: 'identity_only'       // 100% identity service
};
```

### Rollback Plan
```bash
# Rollback script for identity service
rollback_identity() {
  # 1. Switch feature flags back to monolithic
  # 2. Redirect traffic back to monolithic routes
  # 3. Restore database permissions
  # 4. Validate functionality
}
```

## Phase 3: Billing Service Extraction (Weeks 9-12)

### Why Billing Next?
- High business criticality
- Relatively isolated (mainly payment processing)
- Complex transaction requirements

### Migration Steps

#### Step 1: Payment Processing Extraction
```typescript
// Extract Razorpay integration
src/
├── lib/razorpay.ts        # Move to billing service
├── app/api/payments/      # Move to billing service
└── app/api/webhooks/      # Move to billing service
```

#### Step 2: Subscription Management
```sql
-- Migrate billing tables
CREATE SCHEMA billing;
ALTER TABLE student_subscriptions SET SCHEMA billing;
ALTER TABLE payments SET SCHEMA billing;
ALTER TABLE razorpay_orders SET SCHEMA billing;
```

#### Step 3: Idempotency Implementation
```typescript
// Implement idempotent webhook processing
class PaymentProcessor {
  async processWebhook(webhookData: WebhookPayload) {
    const idempotencyKey = generateIdempotencyKey(webhookData);

    if (await isProcessed(idempotencyKey)) {
      return { status: 'already_processed' };
    }

    return await db.transaction(async (tx) => {
      // Process payment and update subscription atomically
    });
  }
}
```

### Rollback Plan
- Switch payment processing back to monolithic routes
- Manual reconciliation of payments during transition period
- Customer notification for any payment issues

## Phase 4: Quiz Service Extraction (Weeks 13-16)

### Migration Steps

#### Step 1: Quiz Logic Extraction
```typescript
// Extract quiz components and logic
src/
├── components/quiz/       # Move to quiz service
├── lib/exam-engine.ts     # Move to quiz service
├── lib/xp-rules.ts        # Move to quiz service
└── app/quiz/              # Move to quiz service
```

#### Step 2: Database Migration
```sql
CREATE SCHEMA quiz;
ALTER TABLE quiz_sessions SET SCHEMA quiz;
ALTER TABLE quiz_responses SET SCHEMA quiz;
-- Add cross-schema views for analytics
```

#### Step 3: Atomic Operations
```sql
-- Implement atomic quiz submission
CREATE OR REPLACE FUNCTION atomic_quiz_profile_update(
  p_session_id UUID,
  p_responses JSONB,
  p_client_checksum TEXT
) RETURNS JSONB AS $$
-- Atomic quiz processing logic
$$ LANGUAGE plpgsql;
```

### Rollback Plan
- Feature flag to disable quiz service
- Fallback to monolithic quiz routes
- Data reconciliation for in-flight quizzes

## Phase 5: Foxy AI Service Extraction (Weeks 17-20)

### Migration Steps

#### Step 1: AI Logic Extraction
```typescript
// Extract Foxy components
src/
├── components/foxy/       # Move to foxy service
├── lib/cognitive-engine.ts # Move to foxy service
├── lib/feedback-engine.ts  # Move to foxy service
└── app/foxy/               # Move to foxy service
```

#### Step 2: Circuit Breaker Implementation
```typescript
// Implement Claude API circuit breaker
class ClaudeCircuitBreaker {
  async call(prompt: string) {
    if (this.isOpen()) {
      return this.fallbackResponse();
    }

    try {
      const response = await claudeAPI.generate(prompt);
      this.recordSuccess();
      return response;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
}
```

### Rollback Plan
- Disable AI features, show maintenance message
- Queue requests for processing when service recovers
- Implement rule-based fallback responses

## Phase 6: Content & Analytics Services (Weeks 21-24)

### Migration Steps

#### Content Service
```sql
CREATE SCHEMA content;
ALTER TABLE question_bank SET SCHEMA content;
ALTER TABLE rag_chunks SET SCHEMA content;
-- Implement content validation pipeline
```

#### Analytics Service
```sql
CREATE SCHEMA analytics;
-- Migrate analytics tables
-- Implement event-driven analytics updates
```

### Rollback Plan
- Content: Fallback to cached content
- Analytics: Defer analytics updates during rollback

## Phase 7: Assessment Service & Final Integration (Weeks 25-28)

### Migration Steps

#### Assessment Service
```sql
CREATE SCHEMA assessment;
ALTER TABLE concept_mastery SET SCHEMA assessment;
-- Implement learning graph algorithms
```

#### Final Integration
- Remove monolithic routes
- Update API gateway configuration
- Implement cross-service testing

### Rollback Plan
- Complete rollback to monolithic architecture
- Data reconciliation across all services

## Testing Strategy

### Pre-Migration Testing
```typescript
// Contract testing between services
describe('Service Contracts', () => {
  it('should maintain API compatibility', async () => {
    const monolithicResponse = await monolithicAPI.call(endpoint);
    const microserviceResponse = await microserviceAPI.call(endpoint);

    expect(microserviceResponse).toEqual(monolithicResponse);
  });
});
```

### Migration Testing
```typescript
// Dual-write testing
describe('Dual Write Consistency', () => {
  it('should maintain data consistency', async () => {
    // Write to both systems
    await monolithicDB.write(data);
    await microserviceDB.write(data);

    // Verify consistency
    const monoData = await monolithicDB.read();
    const microData = await microserviceDB.read();

    expect(monoData).toEqual(microData);
  });
});
```

### Post-Migration Testing
```typescript
// End-to-end testing
describe('E2E User Journeys', () => {
  it('should complete full user flow', async () => {
    // Register user
    // Complete quiz
    // Use AI tutor
    // Make payment
    // Verify all data consistent
  });
});
```

## Monitoring and Observability

### Key Metrics
```typescript
const migrationMetrics = {
  serviceHealth: 'uptime_percentage',
  dataConsistency: 'consistency_check_pass_rate',
  performance: 'response_time_p95',
  errors: 'error_rate_per_service',
  traffic: 'traffic_distribution_per_service'
};
```

### Alerting
```typescript
const migrationAlerts = {
  serviceDown: { threshold: '5m', severity: 'critical' },
  dataInconsistency: { threshold: '1%', severity: 'high' },
  performanceDegradation: { threshold: '200ms', severity: 'medium' },
  errorRateSpike: { threshold: '5%', severity: 'high' }
};
```

## Rollback Procedures

### Service-Level Rollback
```bash
# Generic rollback script
rollback_service() {
  local service_name=$1

  # 1. Update API gateway to route to monolithic
  update_gateway "monolithic"

  # 2. Disable service in load balancer
  disable_service "$service_name"

  # 3. Restore database permissions
  restore_db_permissions "$service_name"

  # 4. Update feature flags
  update_feature_flags "rollback_$service_name"

  # 5. Validate functionality
  validate_rollback "$service_name"
}
```

### Full System Rollback
```bash
# Complete rollback to monolithic
full_rollback() {
  # 1. Stop all microservices
  stop_all_services

  # 2. Restore monolithic application
  deploy_monolithic "latest_stable"

  # 3. Update DNS and API gateway
  update_dns "monolithic"

  # 4. Restore database schema
  restore_database_schema

  # 5. Validate full functionality
  validate_full_system
}
```

## Data Migration Strategy

### Schema Migration
```sql
-- Schema migration with rollback capability
CREATE TABLE schema_migrations (
  version VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  rollback_script TEXT
);

-- Migration procedure
CREATE OR REPLACE FUNCTION migrate_schema(target_version TEXT)
RETURNS VOID AS $$
BEGIN
  -- Apply migration
  -- Update version
  -- Store rollback script
END;
$$ LANGUAGE plpgsql;
```

### Data Validation
```typescript
// Data integrity validation
class DataValidator {
  async validateMigration(sourceTable: string, targetTable: string) {
    const sourceCount = await sourceDB.count(sourceTable);
    const targetCount = await targetDB.count(targetTable);

    if (sourceCount !== targetCount) {
      throw new Error(`Data count mismatch: ${sourceCount} vs ${targetCount}`);
    }

    // Validate data integrity
    const inconsistencies = await compareData(sourceTable, targetTable);
    if (inconsistencies.length > 0) {
      throw new Error(`Data inconsistencies found: ${inconsistencies}`);
    }
  }
}
```

## Risk Mitigation

### Technical Risks
- **Data Loss**: Daily backups, point-in-time recovery
- **Service Downtime**: Blue-green deployments, canary releases
- **Performance Issues**: Load testing, auto-scaling policies
- **Security**: Security audit before each phase

### Operational Risks
- **Team Coordination**: Daily standups, cross-team reviews
- **Communication**: Stakeholder updates, incident response plan
- **Training**: Service-specific training for developers

### Business Risks
- **User Impact**: Feature flags, gradual rollouts
- **Revenue Impact**: Payment processing monitoring
- **Compliance**: Audit logging, data privacy checks

## Success Criteria

### Phase Completion Criteria
- **Code Coverage**: >90% for extracted services
- **Performance**: No degradation in response times
- **Availability**: 99.9% uptime during migration
- **Data Consistency**: Zero data loss or corruption

### Final Success Metrics
- **Scalability**: Independent scaling of services
- **Reliability**: Improved error isolation
- **Maintainability**: Easier deployment and debugging
- **Cost Efficiency**: Optimized resource utilization

## Timeline and Milestones

```
Week 1-4:   Foundation & Monitoring
Week 5-8:   Identity Service
Week 9-12:  Billing Service
Week 13-16: Quiz Service
Week 17-20: Foxy AI Service
Week 21-24: Content & Analytics
Week 25-28: Assessment & Integration
Week 29-32: Optimization & Hardening
```

## Communication Plan

### Internal Communication
- **Daily Standups**: Progress updates and blockers
- **Weekly Reviews**: Phase completion and risk assessment
- **Architecture Reviews**: Design decisions and changes

### External Communication
- **Status Page**: Migration progress and maintenance windows
- **Customer Updates**: Major changes and potential impacts
- **Stakeholder Reports**: Weekly progress and risk updates

This migration plan provides a structured approach to transforming the monolithic application into a scalable microservices architecture while maintaining system stability and user experience.</content>
<parameter name="filePath">c:\Users\Bharangpur Primary\Alfanumrik-repo\.claude\worktrees\compassionate-curie\MIGRATION_AND_ROLLBACK_PLAN.md