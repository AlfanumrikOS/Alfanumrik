/**
 * ALFANUMRIK — Payment Signature Verification
 *
 * Extracted production invariant P11 (Payment Integrity).
 * Razorpay HMAC-SHA256 signature verification with timing-safe comparison.
 *
 * DO NOT duplicate this logic anywhere. Import from here.
 */

import crypto from 'crypto';

/**
 * P11 Invariant: Razorpay webhook/payment signature verification
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyRazorpaySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  try {
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return sigBuffer.length === expectedBuffer.length &&
           crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
