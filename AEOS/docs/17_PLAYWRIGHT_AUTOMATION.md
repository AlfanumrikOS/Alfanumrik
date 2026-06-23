# 17_PLAYWRIGHT_AUTOMATION.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory End-to-End Testing & Browser Automation Standard
**Priority:** P0
**Applies To:** Every browser workflow, UI verification, regression test, deployment validation, and user journey.

---

# Purpose

Playwright is the primary browser verification framework for Alfanumrik.

Claude Code shall use Playwright to verify user-visible behavior rather than assuming frontend correctness.

A feature is not complete merely because it compiles.

It must function correctly in the browser.

---

# Philosophy

Browser execution is evidence.

Screenshots are evidence.

Console logs are evidence.

Network requests are evidence.

DOM state is evidence.

Never claim a UI works without browser verification whenever Playwright is available.

---

# Mandatory User Journeys

Every production release should verify applicable flows:

- Landing Page
- Registration
- Login
- Logout
- Password Reset
- Dashboard
- Student Learning Flow
- Assessment
- Teacher Dashboard
- Parent Dashboard
- Admin Portal
- Subscription
- Payment
- AI Tutor
- Search
- Navigation
- Profile Management

---

# Verification Requirements

Every Playwright execution should inspect:

- Page loads
- Console errors
- Network failures
- JavaScript exceptions
- Broken images
- Accessibility
- Responsive layout
- Authentication state
- Navigation
- Form validation

---

# Failure Policy

A browser failure blocks production deployment until:

- Root cause identified
- Fix implemented
- Regression verified

---

# Screenshots

Capture screenshots:

- Before critical actions
- After completion
- On failure

Store as deployment evidence where practical.

---

# Console Validation

Unexpected console errors should be investigated.

Warnings may be acceptable only with documented justification.

---

# Accessibility

Validate:

- Keyboard navigation
- Focus order
- Form labels
- ARIA usage
- Contrast (where tooling supports)

Accessibility regressions are quality defects.

---

# Network Validation

Inspect:

- Failed requests
- 4xx responses
- 5xx responses
- Timeout behavior
- Retry behavior

---

# Reporting

Playwright reports should include:

- Journey executed
- Browser used
- Environment
- Screenshots
- Errors
- Console output
- Network summary
- Overall result

---

# Definition of Browser Readiness

A frontend change is browser-ready only when:

- User journey succeeds

- No blocking console errors

- No failed critical requests

- UI behaves correctly

- Evidence collected

---

# Final Directive

Never report UI success based solely on code inspection.

Browser behavior is authoritative.

**End of Document**
