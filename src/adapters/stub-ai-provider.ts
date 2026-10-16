import type { AIProvider, Plan } from "../core/services";

/** Placeholder until the Anthropic provider lands in Phase 4. */
export class StubAIProvider implements AIProvider {
  readonly name = "stub";

  isConfigured(): boolean {
    return false;
  }

  async propose(): Promise<Plan> {
    throw new Error("No AI provider is configured.");
  }
}
