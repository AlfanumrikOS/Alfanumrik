/**
 * Identity Service Circuit Breaker
 *
 * Implements circuit breaker pattern for identity service calls during migration.
 * Automatically falls back to monolith when service is unavailable or failing.
 *
 * Circuit states:
 * - CLOSED: Normal operation, calls go through
 * - OPEN: Service is failing, all calls fail fast and fallback to monolith
 * - HALF_OPEN: Testing if service has recovered
 */

import { logOpsEvent } from '../_shared/ops-events.ts';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;    // Failures before opening circuit
  recoveryTimeout: number;     // Ms to wait before trying HALF_OPEN
  monitoringWindow: number;    // Ms window for failure counting
  successThreshold: number;    // Successes needed to close circuit from HALF_OPEN
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalCalls: number;
  totalFailures: number;
}

export class IdentityServiceCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private totalCalls = 0;
  private totalFailures = 0;

  constructor(
    private config: CircuitBreakerConfig,
    private serviceName = 'identity-service'
  ) {}

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(
    operation: () => Promise<T>,
    fallback: () => Promise<T>
  ): Promise<{ result: T; usedFallback: boolean; error?: string }> {
    this.totalCalls++;

    // Circuit is OPEN - fail fast and use fallback
    if (this.state === 'OPEN') {
      if (Date.now() - (this.lastFailureTime || 0) > this.config.recoveryTimeout) {
        this.state = 'HALF_OPEN';
        this.successes = 0;
        await this.logStateChange('HALF_OPEN', 'Recovery timeout elapsed');
      } else {
        await this.logCircuitOpen();
        const result = await fallback();
        return { result, usedFallback: true };
      }
    }

    try {
      const result = await operation();
      await this.recordSuccess();
      return { result, usedFallback: false };
    } catch (error) {
      await this.recordFailure(error);
      const result = await fallback();
      return { result, usedFallback: true, error: error.message };
    }
  }

  /**
   * Record a successful call
   */
  private async recordSuccess(): Promise<void> {
    this.successes++;
    this.lastSuccessTime = Date.now();

    if (this.state === 'HALF_OPEN' && this.successes >= this.config.successThreshold) {
      this.state = 'CLOSED';
      this.failures = 0;
      await this.logStateChange('CLOSED', `Success threshold reached (${this.successes})`);
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success in CLOSED state
      this.failures = 0;
    }
  }

  /**
   * Record a failed call
   */
  private async recordFailure(error: any): Promise<void> {
    this.failures++;
    this.totalFailures++;
    this.lastFailureTime = Date.now();

    // Clean up old failures outside monitoring window
    const windowStart = Date.now() - this.config.monitoringWindow;
    if (this.lastFailureTime && this.lastFailureTime < windowStart) {
      this.failures = 1; // Current failure
    }

    if (this.state === 'CLOSED' && this.failures >= this.config.failureThreshold) {
      this.state = 'OPEN';
      await this.logStateChange('OPEN', `Failure threshold reached (${this.failures})`);
    } else if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      await this.logStateChange('OPEN', 'Failed during HALF_OPEN test');
    }

    await this.logFailure(error);
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
    };
  }

  /**
   * Manually reset the circuit breaker (admin operation)
   */
  async reset(): Promise<void> {
    const oldState = this.state;
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;

    await this.logStateChange('CLOSED', `Manual reset from ${oldState}`);
  }

  /**
   * Log state changes
   */
  private async logStateChange(newState: CircuitState, reason: string): Promise<void> {
    await logOpsEvent({
      category: 'identity-migration',
      source: 'circuit-breaker',
      severity: 'info',
      message: `Circuit breaker state changed: ${this.state} → ${newState}`,
      context: {
        service: this.serviceName,
        reason,
        stats: this.getStats(),
      },
    });
  }

  /**
   * Log circuit open events
   */
  private async logCircuitOpen(): Promise<void> {
    await logOpsEvent({
      category: 'identity-migration',
      source: 'circuit-breaker',
      severity: 'warning',
      message: 'Circuit breaker is OPEN - using fallback',
      context: {
        service: this.serviceName,
        stats: this.getStats(),
      },
    });
  }

  /**
   * Log individual failures
   */
  private async logFailure(error: any): Promise<void> {
    await logOpsEvent({
      category: 'identity-migration',
      source: 'circuit-breaker',
      severity: 'error',
      message: `Identity service call failed: ${error.message}`,
      context: {
        service: this.serviceName,
        error: error.message,
        stack: error.stack,
        stats: this.getStats(),
      },
    });
  }
}

// Global circuit breaker instance
export const identityCircuitBreaker = new IdentityServiceCircuitBreaker({
  failureThreshold: 5,      // Open after 5 failures
  recoveryTimeout: 30000,   // Try again after 30 seconds
  monitoringWindow: 60000,  // Count failures in last 60 seconds
  successThreshold: 3,      // Need 3 successes to close from HALF_OPEN
});