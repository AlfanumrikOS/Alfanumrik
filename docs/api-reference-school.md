# Alfanumrik School API Reference

> For school IT administrators and ERP/SIS vendors integrating with Alfanumrik.

## Base URL

```
https://alfanumrik.com/api/v1/school
```

## Authentication

All requests require an API key in the `Authorization` header:

```
Authorization: Bearer sk_school_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

API keys are generated in the **School Admin Portal** → **API Keys** page. Keys:
- Begin with `sk_school_` prefix
- Are SHA-256 hashed at rest (shown once at creation, cannot be recovered)
- Have scoped permissions: `students.read`, `reports.read`, `classes.read`
- Can have optional expiry dates

## Rate Limiting

- **60 requests per minute** per IP address
- Returns `429 Too Many Requests` when exceeded
- `Retry-After` header indicates seconds to wait

## Response Format

All responses follow this structure:

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

On error:
```json
{
  "success": false,
  "data": null,
  "error": "Error description"
}
```

---

## Endpoints

### GET /students

List all students for your school.

**Permission required:** `students.read`

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 50 | Items per page (max 100) |
| `grade` | string | - | Filter by grade ("6" through "12") |

**Example Request:**

```bash
curl -H "Authorization: Bearer sk_school_abc123..." \
  "https://alfanumrik.com/api/v1/school/students?grade=10&limit=50"
```

**Example Response:**

```json
{
  "success": true,
  "data": {
    "students": [
      {
        "id": "a1b2c3d4-...",
        "name": "Aarav Sharma",
        "grade": "10",
        "is_active": true,
        "xp_total": 1250,
        "last_active": "2026-04-16T10:30:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 142,
      "total_pages": 3
    }
  }
}
```

> **Note:** Student email and phone are not returned via this endpoint for data privacy compliance.

---

### GET /reports

Get academic reports for your school.

**Permission required:** `reports.read`

**Query Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `type` | string | Yes | Report type: `overview` or `student_summary` |

#### type=overview

School-wide academic metrics.

```bash
curl -H "Authorization: Bearer sk_school_abc123..." \
  "https://alfanumrik.com/api/v1/school/reports?type=overview"
```

```json
{
  "success": true,
  "data": {
    "total_students": 142,
    "active_students": 128,
    "avg_score": 72,
    "quizzes_this_month": 1847
  }
}
```

#### type=student_summary

Per-student academic summary. Useful for ERP grade sync.

```bash
curl -H "Authorization: Bearer sk_school_abc123..." \
  "https://alfanumrik.com/api/v1/school/reports?type=student_summary"
```

```json
{
  "success": true,
  "data": {
    "students": [
      {
        "id": "a1b2c3d4-...",
        "name": "Aarav Sharma",
        "grade": "10",
        "avg_score": 78,
        "total_quizzes": 23,
        "is_active": true,
        "xp_total": 1250,
        "last_active": "2026-04-16T10:30:00Z"
      }
    ]
  }
}
```

---

## Error Codes

| Status | Code | Meaning |
|---|---|---|
| 401 | `INVALID_KEY` | API key not found or revoked |
| 401 | `KEY_EXPIRED` | API key has expired |
| 403 | `INSUFFICIENT_PERMISSIONS` | Key lacks required permission |
| 429 | `RATE_LIMITED` | Too many requests (60/min) |
| 500 | `INTERNAL_ERROR` | Server error — contact support |

---

## Integration Examples

### Node.js

```javascript
const res = await fetch('https://alfanumrik.com/api/v1/school/students', {
  headers: { 'Authorization': 'Bearer sk_school_your_key_here' }
});
const { data } = await res.json();
console.log(`${data.pagination.total} students found`);
```

### Python

```python
import requests

r = requests.get(
    'https://alfanumrik.com/api/v1/school/students',
    headers={'Authorization': 'Bearer sk_school_your_key_here'}
)
students = r.json()['data']['students']
```

---

## Coming Soon

- **GET /classes** — Class roster with enrollment data
- **Webhooks** — Real-time events for student enrollment, quiz completion, subscription changes
- **SDKs** — `@alfanumrik/school-sdk` (Node.js), `alfanumrik-school` (Python)

## Support

- Email: support@alfanumrik.com
- Documentation: https://alfanumrik.com/docs