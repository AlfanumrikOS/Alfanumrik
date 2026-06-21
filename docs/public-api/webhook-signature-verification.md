# Verifying Alfanumrik webhook signatures

Alfanumrik delivers outbound webhooks as an HTTP `POST` to your configured
`target_url`. Every delivery carries an HMAC-SHA256 signature in the
`X-Alfanumrik-Signature` header so you can confirm the request genuinely came
from Alfanumrik and was not modified in transit.

**Verify every webhook before acting on it.**

---

## IMPORTANT — non-standard signing key (read this first)

Unlike Stripe / GitHub, the signing key is **NOT your raw webhook secret**.

> The signing key is `SHA256(your_webhook_secret)` — the SHA-256 digest
> (32 raw bytes) of your secret — **not** the raw `whsec_...` secret string.

### Why

Alfanumrik **never stores your raw webhook secret**. At creation time we keep
only its SHA-256 hash, so a database read can never leak the secret. The
dispatcher therefore signs each delivery using that stored hash as the HMAC key.

To reproduce the identical key on your side, take your copy of the raw secret
and hash it with SHA-256 yourself, then use those bytes as the HMAC key.

If you naively HMAC with the raw `whsec_...` secret (the Stripe / GitHub
convention), **every signature will mismatch** with no obvious cause. This is
the single most common integration mistake — derive the key first.

---

## The three rules

1. **Key** — `SHA256(your_webhook_secret)` (the raw 32-byte digest), **not** the
   raw secret string.
2. **Header** — `X-Alfanumrik-Signature: sha256=<hex>`. Strip the `sha256=`
   prefix; the remainder is lowercase hex.
3. **Message** — the **exact raw request body bytes**, read off the wire *before*
   any JSON parsing. Do **not** parse-and-re-serialize the JSON: key order,
   whitespace, or unicode escaping would change the bytes and break the
   signature. HMAC the raw body, then compare to the header hex using a
   **constant-time** comparison.

---

## Worked example — Node.js

```js
const crypto = require('crypto');

/**
 * @param rawBody          The EXACT bytes received (Buffer or raw string).
 *                         NOT JSON.parse(...) then JSON.stringify(...).
 * @param signatureHeader  The value of the X-Alfanumrik-Signature header.
 * @param webhookSecret    Your raw webhook secret (the whsec_... value).
 */
function verifyAlfanumrikWebhook(rawBody, signatureHeader, webhookSecret) {
  // Key derivation: the HMAC key is SHA256(secret), NOT the raw secret.
  const key = crypto.createHash('sha256').update(webhookSecret).digest();

  const expected = crypto
    .createHmac('sha256', key)
    .update(rawBody)
    .digest('hex');

  // Header looks like "sha256=<hex>" — compare only the hex part.
  const received = (signatureHeader || '').replace(/^sha256=/, '');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

> **Express tip:** capture the raw body with
> `express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } })` and
> verify against `req.rawBody`. Do not verify against `JSON.stringify(req.body)`.

---

## Worked example — Python

```python
import hashlib
import hmac

def verify_alfanumrik_webhook(raw_body: bytes, signature_header: str, webhook_secret: str) -> bool:
    # Key derivation: the HMAC key is SHA256(secret), NOT the raw secret.
    key = hashlib.sha256(webhook_secret.encode("utf-8")).digest()

    expected = hmac.new(key, raw_body, hashlib.sha256).hexdigest()

    # Header looks like "sha256=<hex>".
    received = (signature_header or "").removeprefix("sha256=")

    return hmac.compare_digest(expected, received)
```

`raw_body` must be the exact request body bytes (e.g. `request.get_data()` /
`await request.body()`), not a re-encoded parse of the JSON.

---

## Companion delivery headers

| Header | Meaning |
|---|---|
| `X-Alfanumrik-Signature` | `sha256=<hex>` HMAC of the raw body, keyed by `SHA256(secret)`. |
| `X-Alfanumrik-Event` | The event type (e.g. `roster.updated`). |
| `X-Alfanumrik-Delivery` | Unique delivery id for this attempt. |

Deliveries are retried on failure (exponential backoff, up to 8 attempts).
**Deduplicate** on the `event_id` field inside the JSON body so a retried
delivery is not processed twice. Return any `2xx` status to acknowledge; a
non-2xx (or timeout) is treated as a failed attempt and re-queued.

---

This guide mirrors the `Verifying webhook signatures` section in the
machine-readable spec at
[`docs/public-api/openapi.json`](./openapi.json) (served by
`GET /api/public/v1/openapi`).
