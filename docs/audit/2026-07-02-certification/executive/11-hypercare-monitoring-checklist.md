# Hypercare Monitoring Checklist

For the elevated-attention monitoring window immediately following a certified release
deployment (recommend 48-72 hours, adjust per the Board's own risk assessment of what shipped).

## During the hypercare window

- [ ] Error rate reviewed at least every 2 hours during business hours, once daily overnight.
- [ ] Quiz-submission success rate and average score distribution compared against the pre-
      deploy baseline - a sudden shift could indicate a scoring regression (P1/P2 territory).
- [ ] AI-tutor response latency and error rate compared against baseline.
- [ ] Payment webhook success/failure rate compared against baseline - any spike in failures is
      high-priority given P11.
- [ ] Support ticket volume and category distribution reviewed for anything correlating with the
      deploy timestamp.
- [ ] If CERT-01 (QUIZ-ACTIVE RPC-layer gap) was shipped without a fix, specifically monitor for
      any suspended-account quiz activity as a named watch item, not just generic error-rate
      monitoring.

## Exit criteria for ending hypercare

- [ ] No unresolved P0/P1-severity incident traced to this deployment.
- [ ] Error rate, latency, and success-rate metrics have returned to within normal baseline
      variance for at least 24 continuous hours.
- [ ] Any incident opened during the window has a documented root cause and resolution, or is
      explicitly still being tracked with an owner and target date.

## Escalation

Any P0/P1 incident during hypercare triggers the rollback checklist evaluation immediately, not
after the standard incident-triage process completes - hypercare exists specifically to shorten
that decision latency.
