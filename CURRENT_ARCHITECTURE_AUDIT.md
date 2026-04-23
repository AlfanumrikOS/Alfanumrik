# CURRENT_ARCHITECTURE_AUDIT.md

## Executive Summary

Alfanumrik is a live EdTech platform serving K-12 CBSE students with adaptive learning features. The current architecture is a monolithic Next.js application with Supabase backend, featuring AI tutoring, quiz generation, and gamification. The system handles 5,000+ concurrent students with complex business logic around RBAC, tenant isolation, and AI safety.

## Current System Architecture

### Frontend Layer
- **Framework**: Next.js 16.2 App Router, React 18
- **Styling**: Tailwind CSS 3.4
- **State Management**: SWR for remote data, React Context for auth
- **PWA**: Service Worker with offline capabilities
- **Routing**: File-based routing with role-based page access

### Backend Layer
- **API Routes**: Next.js API routes (`src/app/api/`) - 151 routes total
- **Edge Functions**: Supabase Edge Functions (Deno runtime) - 29 functions
- **Database**: Supabase PostgreSQL with:
  - 265+ migrations
  - 120+ tables
  - 440+ RLS policies
  - pgvector for RAG embeddings
  - Row-level security with tenant isolation

### Authentication & Authorization
- **Auth Provider**: Supabase Auth (PKCE flow)
- **RBAC System**: Custom implementation with 6 roles, 71 permissions
- **Session Management**: JWT tokens with auto-refresh
- **Multi-role Support**: Students, Teachers, Parents, Institution Admins, Super Admins

### AI & Learning Engine
- **AI Provider**: Claude Haiku via Edge Functions
- **RAG Pipeline**: Voyage embeddings → pgvector similarity search
- **Learning Models**: BKT, IRT, spaced repetition (SM-2)
- **Content Sources**: NCERT syllabus alignment

### Business Domains

#### 1. Identity & User Management
- **Tables**: students, teachers, guardians, users
- **Features**: Multi-role profiles, parent-child linking, school assignments
- **Auth Flow**: Supabase Auth → profile bootstrap → role detection
- **Current Coupling**: Auth logic scattered across AuthContext, API routes, Edge Functions

#### 2. Quiz Engine
- **Tables**: quiz_sessions, quiz_responses, question_bank, user_question_history
- **Features**: Adaptive difficulty, anti-cheat measures, XP calculation
- **API**: `/api/quiz` with multiple actions (questions, progress, history)
- **Edge Function**: `quiz-engine` for advanced question selection
- **Current Coupling**: Business logic in API routes, scoring in lib/scoring.ts

#### 3. Foxy AI Tutor
- **Tables**: foxy_sessions, foxy_chat_messages, ai_tutor_logs
- **Features**: Context-aware tutoring, daily usage limits, RAG retrieval
- **API**: `/api/foxy` (new) + `foxy-tutor` Edge Function (legacy)
- **Current Coupling**: Two implementations, migration in progress

#### 4. Billing & Subscriptions
- **Tables**: student_subscriptions, payments, razorpay_webhooks
- **Features**: Razorpay integration, plan management, webhook verification
- **API**: `/api/payments/`, `/api/billing/`
- **Current Coupling**: Payment logic in API routes, subscription state in DB

#### 5. Analytics & Reporting
- **Tables**: audit_logs, student_daily_usage, quiz_analytics
- **Features**: Usage tracking, performance metrics, admin dashboards
- **API**: `/api/analytics/`, `/api/reports/`
- **Current Coupling**: Analytics scattered across multiple domains

#### 6. Admin & Operations
- **Tables**: Various admin tables, feature_flags, system_config
- **Features**: Super admin panel, feature flags, audit trails
- **API**: `/api/super-admin/`, `/api/internal/`
- **Current Coupling**: Admin logic mixed with business logic

## Coupling Analysis

### Tight Coupling Issues

#### 1. Cross-Domain Database Access
- **Issue**: API routes directly query tables from other domains
- **Example**: Quiz API queries student profiles, subscription tables
- **Impact**: Changes in one domain break others, no clear ownership

#### 2. Business Logic in UI Layer
- **Issue**: XP calculations, scoring formulas in client components
- **Example**: `QuizResults.tsx` contains scoring logic
- **Impact**: Inconsistent calculations, hard to maintain

#### 3. Scattered Authorization Checks
- **Issue**: Permission checks in random API routes and components
- **Example**: Role-based UI hiding in `Dashboard.tsx`
- **Impact**: Inconsistent enforcement, security gaps

#### 4. Synchronous Cross-Domain Calls
- **Issue**: API routes call other domains synchronously
- **Example**: Quiz submission triggers XP updates immediately
- **Impact**: Cascading failures, tight coupling

#### 5. Mixed Concerns in API Routes
- **Issue**: Single route handles auth, business logic, and data access
- **Example**: `/api/quiz` does auth, validation, DB queries, and responses
- **Impact**: Hard to test, maintain, and extract

### Data Ownership Violations

#### Current State
- **Students table**: Queried by quiz, foxy, analytics, admin domains
- **Quiz sessions**: Owned by quiz but queried by analytics and XP systems
- **Audit logs**: Written by all domains, read by admin
- **Feature flags**: Global state queried everywhere

#### Missing Boundaries
- No clear "owned by" vs "read-only access" contracts
- No event-driven communication between domains
- Direct table joins across domain boundaries

## Stability Risks

### Critical Flows Analysis

#### 1. Student Onboarding
- **Path**: Signup → Email verification → Profile creation → Role assignment
- **Risks**: 
  - Bootstrap API failure leaves users in limbo
  - Race conditions in profile creation
  - Email delivery failures block verification

#### 2. Quiz Attempt Flow
- **Path**: Question fetch → Attempt → Submission → Scoring → XP update
- **Risks**:
  - Anti-cheat bypasses possible
  - Scoring inconsistencies between client/server
  - XP calculation errors affect gamification

#### 3. Payment Processing
- **Path**: Plan selection → Razorpay order → Payment → Webhook → Subscription update
- **Risks**:
  - Webhook signature verification failures
  - Race conditions in subscription updates
  - Payment state inconsistencies

#### 4. AI Tutor Interactions
- **Path**: Message → Quota check → RAG retrieval → Claude API → Response → Logging
- **Risks**:
  - API rate limits causing failures
  - RAG retrieval quality issues
  - Usage tracking inconsistencies

### Performance Bottlenecks

#### 1. Database Query Patterns
- **Issue**: N+1 queries in quiz question fetching
- **Impact**: Slow quiz loading for large question sets
- **Current**: Some optimization with RPCs, but not comprehensive

#### 2. AI API Latency
- **Issue**: Claude API calls block user interactions
- **Impact**: Poor UX during AI tutoring sessions
- **Current**: Circuit breaker implemented, but synchronous calls

#### 3. Analytics Queries
- **Issue**: Heavy aggregation queries on audit_logs table
- **Impact**: Slow admin dashboard loading
- **Current**: BRIN indexes on timestamps, but table growing rapidly

## Scaling Risks

### Current Capacity
- **Database**: Supabase Pro (60 direct + 200 pooled connections)
- **AI**: Claude Haiku rate limits (~100 req/min)
- **Frontend**: Vercel auto-scaling with ISR caching

### Growth Projections
- **5K concurrent**: Currently supported with headroom
- **50K concurrent**: Would need Team plan, regional replicas, caching layers

### Domain-Specific Scaling Needs

#### Quiz Engine
- **Load**: Question generation under concurrent quiz attempts
- **Solution**: Extract to dedicated service with queue processing

#### AI Tutor
- **Load**: Claude API calls + RAG retrieval
- **Solution**: Async processing, response caching, model optimization

#### Analytics
- **Load**: Real-time dashboard queries
- **Solution**: Pre-computed aggregates, data warehouse separation

## Security Assessment

### Current Controls
- **Network**: HTTPS, CSP, CORS allowlist
- **Application**: Input validation, rate limiting
- **Database**: RLS policies (440+), service role isolation
- **Auth**: RBAC with permission caching

### Gaps Identified
- **Insecure Direct Object References**: Some admin routes lack resource ownership checks
- **Privilege Escalation**: Role switching logic could be exploited
- **PII Exposure**: Student data in client-side logs
- **Webhook Security**: Razorpay webhook verification implemented but complex

## Observability Gaps

### Current Monitoring
- **Metrics**: Vercel Analytics, basic health endpoints
- **Logging**: Structured JSON logs, audit trails
- **Error Tracking**: Sentry integration

### Missing Coverage
- **Business Metrics**: Quiz completion rates, AI response quality
- **Performance**: API latency tracking, DB query performance
- **Domain Events**: Cross-service communication visibility
- **Failure Correlation**: Request tracing across services

## Migration Readiness

### Extraction Candidates

#### High Priority
1. **Billing & Subscription Service**
   - Clear boundaries, payment integrity critical
   - Webhook processing isolated
   - Subscription state owned exclusively

2. **Quiz Engine Service**
   - Complex business logic already partially modularized
   - Anti-cheat and scoring rules well-defined
   - Performance bottleneck under load

3. **AI Tutor Service**
   - Two implementations already (legacy + new)
   - Usage limits and safety rules isolated
   - RAG pipeline can be extracted

#### Medium Priority
4. **Analytics Service**
   - Heavy queries impacting core performance
   - Clear data ownership (read-only access to other domains)
   - Can be async/background processed

5. **Admin Operations Service**
   - Security-critical functions
   - Audit logging requirements
   - Feature flag management

### Current Modularization State

#### Existing Domain Modules
- `src/lib/domains/quiz.ts`: Quiz operations with fallback chains
- `src/lib/domains/identity.ts`: User/profile operations
- `src/lib/domains/profile.ts`: Learning profile management
- `src/lib/domains/types.ts`: Shared service contracts

#### Gaps
- No event publishing/subscription system
- Domain modules still call Supabase directly
- No service-level testing
- API routes not using domain modules consistently

## Recommendations

### Immediate Actions (Phase 0)
1. Complete domain modularization for all business logic
2. Implement event-driven communication patterns
3. Add comprehensive service-level testing
4. Enhance observability with domain-specific metrics

### Phase 1 Extraction
1. Extract Billing & Subscription Service
2. Extract Quiz Engine Service
3. Extract AI Tutor Service

### Phase 2 Optimization
1. Extract Analytics Service
2. Implement cross-service caching layers
3. Add comprehensive monitoring and alerting

### Long-term Architecture
- Event-sourced architecture for learning events
- CQRS pattern for read/write separation
- Multi-region deployment for global scalability
- Data mesh for analytics and reporting</content>
<parameter name="filePath">c:\Users\Bharangpur Primary\Alfanumrik-repo\.claude\worktrees\compassionate-curie\CURRENT_ARCHITECTURE_AUDIT.md