# Identity Service Migration Deployment Plan

## Overview
This document outlines the safe deployment sequence for extracting identity tables to a dedicated schema while maintaining backward compatibility and preserving P15 onboarding integrity.

## Migration Scope
- **Tables Moved**: 10 tables from `public` to `identity` schema
- **FK Updates**: 12 foreign key constraints updated to reference `identity.*`
- **RLS Policies**: Full row-level security on all identity tables
- **Compatibility**: search_path allows unqualified queries during rollout
- **Duration**: Estimated 5-10 minutes downtime during FK updates

## Pre-Deployment Checklist

### Environment Validation
- [ ] Development environment tested with pre-flight script
- [ ] Staging environment prepared (identical to production)
- [ ] Production backup taken within 24 hours
- [ ] Rollback scripts tested in development

### Feature Flags
- [ ] `IDENTITY_SERVICE_ENABLED=false` (default)
- [ ] `IDENTITY_DUAL_WRITE_ENABLED=false` (default)
- [ ] Monolith fallback routes active

### Monitoring Setup
- [ ] Sentry alerts configured for identity endpoints
- [ ] Database performance monitoring active
- [ ] Application logs monitoring active

## Deployment Sequence

### Phase 1: Development Testing (Day 1-2)
```bash
# 1. Run pre-flight checks
./scripts/identity-migration-preflight.sh

# 2. Apply migration
supabase db push

# 3. Run post-flight validation
psql -f supabase/migrations/validate_identity_migration.sql

# 4. Test identity service endpoints
npm run test:e2e -- --grep "identity"

# 5. Test monolith fallback
# Disable identity feature flags, verify app still works
```

### Phase 2: Staging Deployment (Day 3)
```bash
# 1. Deploy to staging
git push origin feat/identity-migration

# 2. Run full test suite
npm run test:e2e

# 3. Load test identity endpoints
# Simulate production traffic patterns

# 4. Monitor for 24 hours
# Check error rates, performance, user flows
```

### Phase 3: Production Deployment (Day 4-5)

#### Pre-Deployment (Maintenance Window Start)
```bash
# 1. Enable maintenance mode
# Show "Scheduled maintenance" page to users

# 2. Stop background jobs
# Pause cron jobs, queue consumers

# 3. Take final backup
supabase db dump > backup_pre_identity_migration.sql
```

#### Migration Execution
```bash
# 1. Apply migration
supabase db push

# 2. Run validation
psql -f supabase/migrations/validate_identity_migration.sql

# 3. Deploy application code
git push origin main

# 4. Restart services
# Vercel auto-deploys, but verify Edge Functions
```

#### Post-Deployment Validation
```bash
# 1. Disable maintenance mode

# 2. Test critical user flows
# - Student registration
# - Teacher login
# - Parent dashboard
# - Quiz submission

# 3. Monitor for 1 hour
# Watch error rates, response times

# 4. Gradually enable identity service
# Start with 10% traffic via feature flags
```

#### Rollback Plan (If Issues Detected)
```bash
# IMMEDIATE: Re-enable maintenance mode

# 1. Restore from backup
psql -f backup_pre_identity_migration.sql

# 2. Rollback application code
git revert HEAD --no-edit
git push origin main

# 3. Disable maintenance mode

# 4. Monitor recovery
```

## Gradual Rollout Strategy

### Week 1: Identity Service Read-Only
- Enable `IDENTITY_SERVICE_ENABLED=true`
- Keep `IDENTITY_DUAL_WRITE_ENABLED=false`
- Identity service handles reads, monolith handles writes
- Monitor consistency between services

### Week 2: Dual-Write Enablement
- Enable `IDENTITY_DUAL_WRITE_ENABLED=true`
- Both services receive writes
- Monitor for drift using drift-detection function
- Validate consistency checks pass

### Week 3: Monolith Deprecation
- Switch read traffic to identity service
- Monitor performance and error rates
- Prepare for monolith removal

### Week 4: Cleanup
- Remove monolith identity code
- Drop unused tables/functions
- Optimize identity service

## Monitoring and Alerts

### Key Metrics to Monitor
- **User Registration**: Success rate, time to complete
- **Login Flows**: Authentication success rate
- **Profile Loads**: Response time, error rate
- **Database Performance**: Query latency, connection count
- **Identity Service**: API success rate, drift detection alerts

### Alert Thresholds
- Error rate > 5% for identity endpoints
- Response time > 2s for profile operations
- FK constraint violations detected
- Data drift > 0.1% between services

## Rollback Procedures

### Emergency Rollback (< 15 minutes)
1. Enable maintenance mode
2. Run rollback migration: `supabase/migrations/20260423151532_rollback_identity_service_extraction.sql`
3. Deploy previous application version
4. Disable maintenance mode

### Controlled Rollback (15-60 minutes)
1. Gradually reduce identity service traffic via feature flags
2. Apply rollback migration
3. Full application rollback
4. Monitor recovery

## Success Criteria

### Technical Success
- [ ] All tables in `identity` schema
- [ ] No orphaned FK records
- [ ] RLS policies active
- [ ] Identity service endpoints responding
- [ ] Monolith fallback working

### Business Success
- [ ] User registration works
- [ ] Login/authentication works
- [ ] Profile management works
- [ ] No user-facing errors
- [ ] Performance within SLA

### Operational Success
- [ ] Rollback tested and ready
- [ ] Monitoring alerts configured
- [ ] Documentation updated
- [ ] Team trained on procedures

## Risk Mitigation

### High-Risk Areas
1. **Onboarding Flow**: P15 integrity must be preserved
2. **Authentication**: Login must work during transition
3. **Data Integrity**: No data loss or corruption
4. **Performance**: Identity service must handle load

### Contingency Plans
1. **Immediate Rollback**: < 15 minutes for critical issues
2. **Feature Flag Rollback**: Reduce identity traffic gradually
3. **Database Restore**: Full backup restore if needed
4. **Service Degradation**: Accept slower performance temporarily

## Communication Plan

### Internal Communication
- Daily status updates during rollout
- Incident response plan documented
- Post-mortem scheduled for completion

### User Communication
- Maintenance window announcement
- Status page updates
- Support team prepared for questions

## Timeline Summary

| Phase | Duration | Activities | Success Criteria |
|-------|----------|------------|------------------|
| Dev Testing | 2 days | Pre-flight, migration, validation | All tests pass |
| Staging | 1 day | Full deployment, load testing | No regressions |
| Production | 2 days | Gradual rollout, monitoring | User flows work |
| Stabilization | 1 week | Traffic ramp-up, optimization | Performance stable |
| Cleanup | 1 week | Code removal, optimization | Technical debt reduced |

## Sign-off Requirements

### Technical Review
- [ ] Database migration reviewed by architect
- [ ] Application changes reviewed by backend/frontend
- [ ] Testing completed by testing team
- [ ] Security review by security team

### Business Approval
- [ ] Product impact assessed
- [ ] Risk assessment approved
- [ ] Rollback plan approved
- [ ] Go-live schedule approved

---

**Document Version**: 1.0
**Last Updated**: April 23, 2026
**Review Date**: April 24, 2026