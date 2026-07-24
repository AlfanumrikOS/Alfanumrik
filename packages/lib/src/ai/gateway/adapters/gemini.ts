/**
 * Model Gateway — Gemini Adapter (Phase 1, DORMANT SEAM)
 *
 * Gemini is not wired in Phase 1. This stub exists to prove the provider seam:
 * a third provider drops in by (1) flipping the two Gemini `configured` flags in
 * registry.ts to true, (2) setting GEMINI_API_KEY, and (3) implementing a real
 * `invoke` here that delegates to a unified Gemini client (to be added under
 * `clients/`, NOT a raw fetch — same ai-boundary rule applies).
 *
 * Until then `invoke` throws `ProviderNotConfiguredError`. The registry keeps
 * both Gemini descriptors `configured:false`, so the router NEVER selects them —
 * this stub is unreachable on every live path and is present for the seam +
 * tests only.
 *
 * Owner: ai-engineer.
 */

import type { AdapterOutcome, GatewayRequest, ModelDescriptor, ProviderAdapter } from '../types';
import { ProviderNotConfiguredError } from '../types';

export const geminiAdapter: ProviderAdapter = {
  provider: 'gemini',

  // eslint-disable-next-line @typescript-eslint/require-await -- uniform async ProviderAdapter contract; stub throws synchronously
  async invoke(_descriptor: ModelDescriptor, _req: GatewayRequest): Promise<AdapterOutcome> {
    if (!process.env.GEMINI_API_KEY) {
      throw new ProviderNotConfiguredError('gemini');
    }
    // Key present but no client wired yet — still not implemented in Phase 1.
    throw new ProviderNotConfiguredError('gemini');
  },
};
