# Identity Service Schema Extraction - Migration Guide

## Overview
This document outlines the high-risk database migration to extract identity-related tables into a dedicated `identity` schema. This migration affects P15 onboarding integrity and requires careful planning and rollback procedures.

## Migration Scope
**Tables to be moved to `identity` schema:**
- `students` - Core student profiles
- `teachers` - Teacher profiles
- `guardians` - Parent/guardian profiles
- `schools` - Educational institutions
- `classes` - Class definitions
- `class_students` - Student-class enrollments
- `guardian_student_links` - Parent-child relationships
- `user_roles` - RBAC role assignments
- `user_active_sessions` - Session tracking
- `identity_events` - Audit trail for identity operations

## Risk Assessment
- **Risk Level**: Critical
- **Impact**: Affects all user authentication, onboarding, and cross-service data access
- **Downtime**: 5-10 minutes during foreign key updates
- **Rollback**: Full rollback possible within 3-5 minutes

## Pre-Migration Checklist

### 1. Backup Verification
- [ ] Manual backup taken within last 24 hours
- [ ] Backup integrity verified with `pg_restore --list`
- [ ] PITR (Point-in-Time Recovery) enabled and tested

### 2. Environment Preparation
- [ ] Migration tested on staging environment
- [ ] Rollback procedures tested on staging
- [ ] Monitoring alerts configured for migration metrics
- [ ] Emergency rollback scripts prepared

### 3. Team Coordination
- [ ] All services notified of potential 10-minute downtime
- [ ] Frontend deployments paused during migration window
- [ ] Support team on standby for user impact

## Migration Execution Plan

### Phase 1: Schema Creation and Permissions (2 minutes)
```sql
-- Create identity schema and set up permissions
\i 20260423151531_identity_service_schema_extraction.sql
-- Verify: SELECT * FROM identity.validate_migration_integrity();
```

### Phase 2: Table Migration (3 minutes)
- Tables moved in dependency order to avoid FK violations
- Foreign keys updated to schema-qualified references
- Progress monitored via batch tracking functions

### Phase 3: RLS Policy Updates (2 minutes)
- RLS policies recreated for new schema locations
- Cross-service permissions granted
- User-level access controls maintained

### Phase 4: Validation and Monitoring (3 minutes)
- Data integrity checks run
- Foreign key constraints verified
- Performance monitoring established

## Monitoring During Migration

### Real-time Metrics
```sql
-- Monitor migration progress
SELECT * FROM identity.get_migration_progress('identity_service_extraction');

-- Check data integrity
SELECT * FROM identity.validate_data_integrity();

-- Monitor system health
SELECT * FROM identity.monitor_migration_health();
```

### Alert Thresholds
- **Critical**: Any orphaned records detected
- **Warning**: Foreign key constraint violations > 0
- **Info**: Migration batch completion

## Rollback Procedures

### Emergency Rollback (if critical issues detected)
```bash
# Execute rollback migration
psql -f supabase/migrations/20260423151532_rollback_identity_service_extraction.sql

# Verify rollback success
psql -c "SELECT * FROM identity.validate_migration_integrity();"
```

### Partial Rollback (if specific issues)
1. Identify affected tables
2. Move only problematic tables back to `public` schema
3. Update their foreign key references
4. Reapply RLS policies

## Post-Migration Validation

### Functional Testing
- [ ] User login/authentication works
- [ ] Student onboarding flow completes
- [ ] Parent-child linking functions
- [ ] Teacher class management works
- [ ] Quiz scoring and XP calculation intact

### Data Integrity Checks
```sql
-- Run comprehensive validation
\i validate_identity_migration.sql

-- Check for orphaned records (should be 0)
SELECT * FROM identity.validate_data_integrity()
WHERE status != 'PASS';
```

### Performance Validation
- [ ] Query performance within 10% of baseline
- [ ] Foreign key joins working correctly
- [ ] RLS policies not causing excessive overhead

## Cross-Service Impact Assessment

### Services Requiring Updates
1. **Quiz Service**: Access to `identity.students` for scoring
2. **Foxy AI Tutor**: Student profile data for personalization
3. **Parent Portal**: Guardian-student relationships
4. **Teacher Dashboard**: Class and student management
5. **Admin Panel**: Full identity data access

### Required Code Changes
- Update all SQL queries to use `identity.` schema prefix
- Modify foreign key references in application code
- Update ORM models to reflect new schema locations

## Contingency Plans

### If Migration Fails Mid-Execution
1. Immediately execute emergency rollback
2. Restore from pre-migration backup
3. Investigate root cause before retry
4. Communicate downtime to users

### If Performance Issues Detected
1. Monitor query performance for 24 hours
2. Add database indexes if needed
3. Consider query optimization
4. Rollback if issues persist beyond acceptable threshold

### If Data Inconsistencies Found
1. Pause all identity-related operations
2. Run data repair scripts
3. Validate with business stakeholders
4. Execute rollback if inconsistencies cannot be resolved

## Success Criteria
- [ ] All tables successfully moved to `identity` schema
- [ ] Zero orphaned records
- [ ] All foreign key constraints intact
- [ ] RLS policies functioning correctly
- [ ] Cross-service permissions working
- [ ] Onboarding flows operational
- [ ] Performance within acceptable limits
- [ ] Rollback procedures tested and ready

## Timeline
- **T-24h**: Final backup, team notification
- **T-1h**: Services paused, final validation
- **T+0**: Migration execution (10 minutes)
- **T+10m**: Validation and monitoring (30 minutes)
- **T+1h**: Full functional testing (2 hours)
- **T+24h**: Performance monitoring (24 hours)

## Communication Plan
- **Internal**: Slack alerts for migration status
- **External**: Status page updates for user-facing downtime
- **Stakeholders**: Email updates on migration progress
- **Support**: Prepared responses for user inquiries

## Lessons Learned Documentation
After migration completion, document:
- Actual vs. estimated downtime
- Issues encountered and resolutions
- Performance impact assessment
- Recommendations for future migrations