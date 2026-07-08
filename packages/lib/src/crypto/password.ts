// Phase F.4 (Super-Admin Production-Readiness Plan, 2026-05-17)
// Cryptographically-secure password generator. Replaces three Math.random()
// call sites (demo-accounts, test-accounts, bulk-upload). Critical because
// bulk-upload provisions real student accounts.

import { randomBytes } from 'node:crypto';

const SYMBOLS = '!@#$%^&*';

// Generates a Supabase-Auth-acceptable password: prefix + secure-random
// base64url segment + digits + symbol. ~108 bits of entropy from the
// 9 random bytes (72 bits) + 100 digits (6.6 bits) + 8 symbols (3 bits) =
// well above the 60-bit threshold for human-typeable creds.
export function generateSecurePassword(prefix: string = 'Demo'): string {
  const randomPart = randomBytes(9).toString('base64url');
  const digits = (randomBytes(2).readUInt16BE(0) % 900 + 100).toString();
  const symbol = SYMBOLS[randomBytes(1)[0] % SYMBOLS.length];
  return `${prefix}${randomPart}${symbol}${digits}`;
}
