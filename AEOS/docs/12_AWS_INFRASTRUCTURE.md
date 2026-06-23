# 12_AWS_INFRASTRUCTURE.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory AWS Infrastructure & Cloud Operations Standard
**Priority:** P0 (Critical)
**Applies To:** Every AWS operation, infrastructure change, deployment, monitoring activity, and cloud resource associated with the Alfanumrik platform.

---

# Purpose

This document defines the mandatory governance, operational procedures, architecture standards, and safety requirements for AWS infrastructure used by Alfanumrik.

AWS is the production backbone of the platform.

Infrastructure changes can impact availability, security, data integrity, and business continuity.

Every cloud operation shall therefore be deliberate, auditable, reversible, and verified.

---

# Engineering Philosophy

Infrastructure is software.

Every AWS resource shall be:

- Version controlled
- Reproducible
- Observable
- Secure
- Cost-aware
- Recoverable
- Least-privileged
- Documented

Manual production changes should be exceptional rather than routine.

---

# AWS Services

Primary AWS services include:

- IAM
- Organizations
- VPC
- Route53
- CloudFront
- ACM
- WAF
- Application Load Balancer (ALB)
- ECS Fargate
- ECR
- CloudWatch
- EventBridge
- SNS
- SQS
- Lambda
- Secrets Manager
- Systems Manager Parameter Store
- RDS (if applicable)
- S3
- CloudTrail
- AWS Config
- KMS

Claude must understand how these services interact before proposing changes.

---

# Infrastructure as Code

Infrastructure should be managed through code whenever practical.

Preferred tools:

- AWS CDK
- Terraform
- CloudFormation

Avoid manual console modifications except for emergency recovery or explicitly approved operational tasks.

---

# Production Safety Rules

Claude Code shall never:

- delete production resources without explicit approval,
- replace databases without verified backups,
- rotate secrets without documenting dependent systems,
- modify IAM permissions without least-privilege review,
- disable monitoring,
- disable logging,
- remove backups,
- disable encryption,
- bypass deployment pipelines.

If a requested action is destructive, require explicit confirmation.

---

# IAM

All IAM changes must follow least privilege.

Never use wildcard permissions unless technically unavoidable and documented.

Prefer:

- Roles
- Role Assumption
- Temporary Credentials

Avoid long-lived access keys.

---

# Secrets Management

All secrets belong in:

- AWS Secrets Manager
- AWS Systems Manager Parameter Store (when appropriate)

Never:

- commit secrets,
- print secrets,
- expose secrets in logs,
- embed secrets in Docker images,
- hardcode secrets in source code.

---

# Environment Configuration

Every environment should maintain isolated configuration.

Typical environments:

- Development
- Staging
- Production

Cross-environment secret sharing is prohibited unless explicitly documented.

---

# Networking

Networking should follow least-access principles.

Private resources should remain private.

Public exposure should occur only through approved ingress points such as:

- CloudFront
- ALB
- API Gateway

Security Groups should allow only required traffic.

---

# VPC

Resources should be organized within well-defined VPCs.

Separate:

- Public subnets
- Private application subnets
- Private database subnets

Avoid unnecessary public IP allocation.

---

# ECS

Every ECS deployment should verify:

- task definition revision,
- image digest,
- CPU allocation,
- memory allocation,
- environment variables,
- secrets injection,
- health checks,
- autoscaling configuration.

Do not assume successful deployment until tasks become healthy.

---

# ECR

Container images should:

- use immutable tags for production,
- be vulnerability scanned,
- minimize image size,
- avoid unnecessary packages.

Never deploy "latest" to production.

---

# CloudFront

CloudFront distributions should verify:

- origin health,
- HTTPS,
- ACM certificates,
- cache policies,
- security headers,
- compression,
- invalidation strategy.

Do not assume CloudFront propagation is immediate.

---

# Application Load Balancer

Verify:

- listener configuration,
- target groups,
- health checks,
- routing rules,
- SSL termination,
- security groups.

Healthy targets are mandatory before considering deployment successful.

---

# ACM

Certificates should:

- auto-renew,
- remain monitored,
- match deployed domains,
- never expire unnoticed.

---

# Route53

DNS changes require verification.

Confirm:

- record type,
- TTL,
- propagation,
- certificate compatibility,
- CloudFront or ALB routing.

---

# CloudWatch

Every production workload must emit:

- structured logs,
- metrics,
- alarms,
- dashboards,
- health checks.

Logs should support troubleshooting without exposing secrets.

---

# Monitoring

Critical metrics include:

- ECS task health
- CPU
- Memory
- Request latency
- HTTP 5xx
- HTTP 4xx
- ALB Target Health
- CloudFront Errors
- Database Connections
- Queue Depth
- Lambda Errors

---

# Alerting

Production alarms should exist for:

- unhealthy ECS tasks,
- deployment failures,
- certificate expiration,
- high error rates,
- excessive latency,
- infrastructure failures.

---

# Backups

Critical data must support:

- scheduled backups,
- retention policies,
- restoration testing,
- disaster recovery documentation.

A backup is not considered valid until restoration has been verified.

---

# Cost Management

Every AWS resource should be evaluated for:

- utilization,
- waste,
- idle resources,
- over-provisioning,
- storage growth,
- data transfer costs.

Cost optimization must not compromise reliability.

---

# Deployment Verification

A deployment is considered successful only after verifying:

- build success,
- image pushed to ECR,
- ECS service updated,
- new task revision running,
- ALB targets healthy,
- CloudFront reachable,
- HTTPS operational,
- authentication functioning,
- database connectivity,
- application health endpoint,
- CloudWatch logs.

Deployment completion requires evidence.

---

# Incident Handling

If production issues occur:

1. Preserve evidence.
2. Collect CloudWatch logs.
3. Inspect ECS events.
4. Inspect ALB target health.
5. Verify secrets.
6. Verify task definition.
7. Identify root cause.
8. Apply minimal corrective action.
9. Re-verify.
10. Document incident.

Never guess.

---

# AWS MCP Usage

When AWS MCP is available, Claude Code shall:

- inspect infrastructure before proposing changes,
- prefer execution over speculation,
- verify current resource state,
- collect evidence,
- report observed state,
- distinguish verified information from inferred information.

Claude shall never fabricate AWS state.

---

# Infrastructure Review Checklist

Before approving infrastructure changes verify:

- IAM reviewed
- Security Groups reviewed
- Secrets managed securely
- Encryption maintained
- Monitoring configured
- Health checks verified
- Rollback documented
- Cost impact assessed
- Deployment validated
- Documentation updated

---

# Definition of Infrastructure Readiness

Infrastructure is production-ready when:

- secure,
- observable,
- scalable,
- monitored,
- recoverable,
- documented,
- reproducible,
- verified.

---

# Final Directive

AWS infrastructure is a mission-critical asset.

Every change must increase the reliability, security, and operational maturity of the Alfanumrik platform.

Never trade operational excellence for short-term convenience.

When execution is possible through AWS MCP, execute, verify, and report evidence rather than relying on assumptions.

**End of Document**
