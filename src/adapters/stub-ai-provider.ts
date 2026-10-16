import type { AIModel, AIProvider, AIRequest, Plan } from "../core/services";

/**
 * Scriptable provider for tests: returns a fixed plan (optionally after
 * calling query tools, like the real model does).
 */
export class StubAIProvider implements AIProvider {
  readonly name = "stub";
  model: AIModel = "claude-opus-5-5";
  configured = true;
  requests: AIRequest[] = [];

  constructor(
    private readonly respond: (req: AIRequest) => Promise<Plan> = async () => ({ summary: "Nothing to do.", steps: [] }),
  ) {}

  isConfigured(): boolean {
    return this.configured;
  }

  async configure(settings: { apiKey?: string | null; model?: AIModel }): Promise<void> {
    if (settings.apiKey !== undefined) this.configured = !!settings.apiKey;
    if (settings.model) this.model = settings.model;
  }

  async propose(req: AIRequest): Promise<Plan> {
    if (!this.configured) throw new Error("Add an Anthropic API key in AI Settings first.");
    this.requests.push(req);
    return this.respond(req);
  }
}
