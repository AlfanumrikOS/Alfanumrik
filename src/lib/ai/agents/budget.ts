import { BudgetExceeded, type AgentBudget } from './types';

export class BudgetTracker {
  private steps = 0;
  private tokensInput = 0;
  private tokensOutput = 0;
  private readonly startedAt = Date.now();

  constructor(private readonly budget: AgentBudget) {}

  incrementStep(): void {
    this.steps += 1;
    if (this.steps > this.budget.maxSteps) {
      throw new BudgetExceeded('max_steps');
    }
  }

  recordTokens(input: number, output: number): void {
    this.tokensInput += input;
    this.tokensOutput += output;
  }

  assertTokens(): void {
    if (this.tokensInput + this.tokensOutput > this.budget.maxTotalTokens) {
      throw new BudgetExceeded('max_tokens');
    }
  }

  assertWallTime(): void {
    if (Date.now() - this.startedAt > this.budget.maxWallMs) {
      throw new BudgetExceeded('max_wall_ms');
    }
  }

  snapshot(): { steps: number; tokensInput: number; tokensOutput: number; elapsedMs: number } {
    return {
      steps: this.steps,
      tokensInput: this.tokensInput,
      tokensOutput: this.tokensOutput,
      elapsedMs: Date.now() - this.startedAt,
    };
  }
}
