import type Anthropic from "@anthropic-ai/sdk";
import * as z from "zod/v4";
import { isVisionResult, type AIModel, type AIProvider, type AIRequest, type Plan, type SettingsStore } from "../../core/services";

const KEY_SETTING = "ai.apiKey";
const MODEL_SETTING = "ai.model";
export const AI_MODELS: Array<{ id: AIModel; label: string }> = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (best plans)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (faster)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest, cheapest)" },
];

/** Planning turns: lookups via query tools, then the final plan. */
const MAX_TURNS = 8;
/** Tool results larger than this are cut, with a note telling the model to narrow the query. */
const MAX_TOOL_RESULT_CHARS = 60_000;

const PlanSchema = z.object({
  summary: z
    .string()
    .describe("One or two sentences for the user: what the plan does, or why nothing can be done / what to clarify."),
  steps: z.array(
    z.object({
      actionId: z.string().describe("An action id from the manifest."),
      paramsJson: z.string().describe('The params object as a JSON string, e.g. {"rating":3}. Use {} when the action takes none.'),
      reason: z.string().describe("Why this step, in a short phrase the user will read."),
    }),
  ),
});

const INSTRUCTIONS = `You plan changes for Photo, a photo culling and editing app. The user asks in natural language; you reply with a plan: an ordered list of actions from the manifest that the app will show the user to review, preview and apply as one undoable step. You never apply anything yourself.

How to plan:
- Use only action ids and parameter shapes from the manifest below. Params must match the action's JSON Schema.
- Read the app context first. When you need photo ids or metadata (e.g. "4+ star photos from this morning", "the blurry duplicates"), call the read-only query tools before planning. Photo ids are paths relative to the folder; capture times are camera-local.
- "Selected" means the current selection: omit photoIds so commands act on it. Otherwise pass explicit photoIds from your queries.
- Keep plans minimal and in the order they should run. Prefer one develop.settings.apply over many separate adjustments for a look.
- When the request depends on what is in the photos (sharpness, blur, faces, eyes closed, subject, composition, colour casts, how an edit looks), look at them with library.photos.view before deciding. Viewing costs tokens: use thumbnail size to scan many photos, detail to check focus, and view only what you need. Base edits on what you see.
- If the request needs something you can't determine, say so in the summary and plan what you can, or return no steps.
- Never plan permanent deletion (library.removed.empty) unless the user explicitly asks to delete files permanently. Prefer flagging as rejected to removing photos.
- Don't pass advance: true unless the user asks to move through photos.

Conversation:
- This may be a follow-up. Your earlier suggestions are in the conversation, and <suggestion_status> says what the user did with each: applied (possibly with edited params), not applied, or dismissed. The app context shows the current state, including applied changes.
- Build on what was applied. Don't re-propose steps the user dismissed or left unapplied unless they ask again. If they ask to adjust an applied change ("a bit less warm"), propose the new values relative to what was applied.`;

/** The SDK is loaded on first use, keeping it out of the main bundle. */
const loadSdk = async () => {
  const [{ default: AnthropicSdk }, { betaZodOutputFormat }] = await Promise.all([
    import("@anthropic-ai/sdk"),
    import("@anthropic-ai/sdk/helpers/beta/zod"),
  ]);
  return { Anthropic: AnthropicSdk, betaZodOutputFormat };
};

function messageOf(error: unknown, apiKey: string | null, Anthropic?: typeof import("@anthropic-ai/sdk").default): string {
  let text: string;
  if (!Anthropic) text = error instanceof Error ? error.message : String(error);
  else if (error instanceof Anthropic.AuthenticationError) text = "The API key was rejected. Check it in AI Settings.";
  else if (error instanceof Anthropic.PermissionDeniedError) text = "This API key doesn't have access to that model.";
  else if (error instanceof Anthropic.RateLimitError) text = "Rate limited by the Anthropic API. Try again in a moment.";
  else if (error instanceof Anthropic.APIConnectionError) text = "Couldn't reach the Anthropic API. Check your connection.";
  else if (error instanceof Anthropic.APIError) text = `Anthropic API error (${error.status ?? "?"}): ${error.message}`;
  else text = error instanceof Error ? error.message : String(error);
  // Never let the key leak into messages, logs or toasts.
  return apiKey ? text.split(apiKey).join("[redacted]") : text;
}

function parseParams(json: string): unknown {
  try {
    const value = JSON.parse(json || "{}") as unknown;
    return value && typeof value === "object" && Object.keys(value).length === 0 ? undefined : value;
  } catch {
    // Kept as text so review shows it as invalid instead of silently dropping the step.
    return json;
  }
}

/**
 * Calls Claude directly from the browser with the user's own API key, which
 * is stored only in this browser. Read-only query actions are offered as
 * tools; the final answer is a structured-output plan.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "Anthropic";
  private apiKey: string | null = null;
  private currentModel: AIModel = "claude-opus-5-5";

  constructor(
    private readonly settings: SettingsStore,
    /** For tests: a fetch to use instead of the network. */
    private readonly fetchImpl?: typeof fetch,
  ) {}

  get model(): AIModel {
    return this.currentModel;
  }

  async load(): Promise<void> {
    this.apiKey = (await this.settings.get<string>(KEY_SETTING)) || null;
    const model = await this.settings.get<string>(MODEL_SETTING);
    if (AI_MODELS.some((m) => m.id === model)) this.currentModel = model as AIModel;
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async configure({ apiKey, model }: { apiKey?: string | null; model?: AIModel }): Promise<void> {
    if (apiKey !== undefined) {
      this.apiKey = apiKey?.trim() || null;
      if (this.apiKey) await this.settings.set(KEY_SETTING, this.apiKey);
      else await this.settings.delete(KEY_SETTING);
    }
    if (model) {
      this.currentModel = model;
      await this.settings.set(MODEL_SETTING, model);
    }
  }

  async propose(req: AIRequest): Promise<Plan> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error("Add an Anthropic API key in AI Settings first.");
    const { Anthropic, betaZodOutputFormat } = await loadSdk();
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, ...(this.fetchImpl ? { fetch: this.fetchImpl } : {}) });

    // Tool names can't contain dots.
    const toolIds = new Map<string, string>();
    const tools: Anthropic.Beta.BetaTool[] = req.tools.map((t) => {
      const name = t.actionId.replace(/[^a-zA-Z0-9_-]/g, "_");
      toolIds.set(name, t.actionId);
      return { name, description: t.description, input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema };
    });

    // Stable prefix first (instructions + manifest, cached); volatile context goes in the user turn.
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: "text", text: INSTRUCTIONS },
      { type: "text", text: `<action_manifest>\n${JSON.stringify(req.manifest)}\n</action_manifest>`, cache_control: { type: "ephemeral" } },
    ];
    // Earlier turns verbatim (cache breakpoint on the last one), then this turn's message.
    const messages: Anthropic.Beta.BetaMessageParam[] = req.history.map((m, i) => ({
      role: m.role,
      content: [
        {
          type: "text" as const,
          text: m.text,
          ...(i === req.history.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
        },
      ],
    }));
    messages.push({ role: "user", content: req.message });

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const response = await client.beta.messages.parse(
          {
            model: this.currentModel,
            max_tokens: 16000,
            // Refusal fallback chosen by the server per category (no-op on models without it).
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system,
            tools,
            messages,
            output_config: { effort: "medium", format: betaZodOutputFormat(PlanSchema) },
          },
          { signal: req.signal },
        );

        if (response.stop_reason === "refusal") {
          throw new Error("Claude declined this request. Try rephrasing it.");
        }
        if (response.stop_reason === "max_tokens") {
          throw new Error("The plan was too long to finish. Try a narrower request.");
        }
        if (response.stop_reason === "tool_use") {
          messages.push({ role: "assistant", content: response.content });
          const results = await Promise.all(
            response.content
              .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
              .map(async (b): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
                try {
                  const value = await req.callTool(toolIds.get(b.name) ?? b.name, b.input);
                  if (isVisionResult(value)) {
                    // Photos go to Claude as images, each labelled with its id.
                    return {
                      type: "tool_result",
                      tool_use_id: b.id,
                      content: value.images.flatMap((img): Array<Anthropic.Beta.BetaTextBlockParam | Anthropic.Beta.BetaImageBlockParam> => [
                        { type: "text", text: `Photo ${img.photoId} (${img.width}×${img.height}${img.edited ? ", with current edits" : ""}):` },
                        { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } },
                      ]),
                    };
                  }
                  const out = JSON.stringify(value);
                  const content =
                    out.length > MAX_TOOL_RESULT_CHARS
                      ? `${out.slice(0, MAX_TOOL_RESULT_CHARS)}\n[Result truncated at ${MAX_TOOL_RESULT_CHARS} characters. Narrow the query with filters or limit.]`
                      : out;
                  return { type: "tool_result", tool_use_id: b.id, content };
                } catch (e) {
                  return { type: "tool_result", tool_use_id: b.id, content: messageOf(e, apiKey, Anthropic), is_error: true };
                }
              }),
          );
          messages.push({ role: "user", content: results });
          continue;
        }

        const plan = response.parsed_output;
        if (!plan) throw new Error("Claude's reply wasn't a valid plan. Try again.");
        return {
          summary: plan.summary,
          steps: plan.steps.map((s) => ({ actionId: s.actionId, params: parseParams(s.paramsJson), reason: s.reason })),
        };
      }
      throw new Error("Claude needed too many lookups. Try a more specific request.");
    } catch (error) {
      if (req.signal?.aborted) throw new Error("Cancelled.");
      throw new Error(messageOf(error, apiKey, Anthropic));
    }
  }
}
