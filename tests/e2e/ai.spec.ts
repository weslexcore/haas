import { expect, test, type Page, type Route } from "@playwright/test";

const panel = (page: Page) => page.getByRole("complementary", { name: "AI plan" });
const grid = (page: Page) => page.getByRole("list", { name: "Photos" });
const cell = (page: Page, name: string) => grid(page).getByRole("button", { name, exact: true });

const message = (content: unknown[], stop_reason: string) => ({
  id: `msg_${Math.random().toString(36).slice(2)}`,
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 50 },
});

const PLAN = {
  summary: "Give the 3 best morning photos 5 stars, brighten them, and show only 5-star photos.",
  steps: [
    { actionId: "library.rating.set", paramsJson: '{"rating":5,"photoIds":["DSC_0002.jpg","DSC_0003.jpg","DSC_0004.jpg"]}', reason: "They are the earliest shots." },
    { actionId: "develop.adjust", paramsJson: '{"setting":"exposure","delta":0.5,"photoIds":["DSC_0002.jpg","DSC_0003.jpg","DSC_0004.jpg"]}', reason: "A little brighter." },
    { actionId: "library.filter.set", paramsJson: '{"minRating":5}', reason: "Show only them." },
    { actionId: "library.rating.set", paramsJson: '{"rating":11}', reason: "An invalid step the review should catch." },
  ],
};

/** Fake Anthropic API: one lookup (tool use), then the plan. Records requests. */
async function mockClaude(page: Page) {
  const requests: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
  await page.route("https://api.anthropic.com/**", async (route: Route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST" } });
    requests.push({ headers: req.headers(), body: req.postDataJSON() });
    const body =
      requests.length === 1
        ? message([{ type: "tool_use", id: "toolu_1", name: "library_photos_list", input: { capturedBefore: "2026-09-12T06:36" } }], "tool_use")
        : message([{ type: "text", text: JSON.stringify(PLAN) }], "end_turn");
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });
  return requests;
}

async function ask(page: Page, prompt: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type(`?${prompt}`);
  await page.keyboard.press("Enter");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Sample Library" }).click();
  await expect(grid(page)).toBeVisible();
});

test("without a key, the AI panel points to AI Settings, where the key is saved locally", async ({ page }) => {
  await ask(page, "rate my best photos");
  await expect(panel(page).getByRole("alert")).toContainText("API key");
  await panel(page).getByRole("button", { name: "Open AI Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "AI settings" });
  await dialog.getByLabel(/Anthropic API key/).fill("sk-ant-e2e-key");
  await dialog.getByLabel("Model").selectOption("claude-sonnet-5-5");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("photo:ai.apiKey"))).toBe('"sk-ant-e2e-key"');
  expect(await page.evaluate(() => localStorage.getItem("photo:ai.model"))).toBe('"claude-sonnet-5-5"');
});

test("plan review: lookups, validation, live preview, edit, apply as one undo step", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("photo:ai.apiKey", JSON.stringify("sk-ant-e2e-key")));
  await page.reload(); // the sample library reopens by itself
  await expect(grid(page)).toBeVisible();
  const requests = await mockClaude(page);

  await ask(page, "give my three best morning photos five stars and brighten them");
  const p = panel(page);
  await expect(p).toContainText(PLAN.summary);
  await expect(p).toContainText("Proposed by claude-opus-5-5");

  // The browser called the API directly with the user's key; the lookup ran and went back to Claude.
  expect(requests).toHaveLength(2);
  expect(requests[0]!.headers["x-api-key"]).toBe("sk-ant-e2e-key");
  expect(requests[0]!.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  const toolResult = JSON.stringify(requests[1]!.body.messages);
  expect(toolResult).toContain("tool_result");
  expect(toolResult).toContain("DSC_0003.jpg");

  // Review: readable steps with impact; the invalid one is flagged and off.
  const steps = p.getByRole("listitem");
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(0)).toContainText("Rate ★★★★★ on 3 photos");
  await expect(steps.nth(1)).toContainText("Exposure +0.50 on 3 photos");
  await expect(steps.nth(3)).toContainText("rating");
  await expect(steps.nth(3).getByRole("checkbox")).not.toBeChecked();
  await expect(p.getByRole("button", { name: "Apply 3 of 4" })).toBeEnabled();

  // Live preview: the filter shows only the 3 photos, already rated 5.
  await expect(grid(page).getByRole("listitem")).toHaveCount(3);
  await expect(cell(page, "DSC_0003.jpg").getByLabel("5 stars")).toBeVisible();
  // Edits are refused while previewing.
  await page.keyboard.press("1");
  await expect(cell(page, "DSC_0003.jpg").getByLabel("5 stars")).toBeVisible();

  // Untick the filter step: the preview follows.
  await steps.nth(2).getByRole("checkbox").uncheck();
  await expect(page.getByRole("toolbar", { name: "Filter and sort" })).toContainText("48 photos");

  // Edit params: 4 stars instead of 5.
  await steps.nth(0).getByRole("button", { name: "Edit" }).click();
  const params = steps.nth(0).getByRole("textbox", { name: "Parameters for step 1" });
  await params.fill('{"rating":4,"photoIds":["DSC_0002.jpg","DSC_0003.jpg"]}');
  await expect(steps.nth(0)).toContainText("Rate ★★★★ on 2 photos");
  await expect(cell(page, "DSC_0002.jpg").getByLabel("4 stars")).toBeVisible();
  await expect(cell(page, "DSC_0004.jpg").getByLabel("Unrated")).toBeVisible();

  await p.getByRole("button", { name: "Apply 2 of 4" }).click();
  await expect(p).toBeHidden();
  await expect(page.getByText("Applied 2 AI-proposed changes")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toContainText("Last change: AI:");
  await expect(cell(page, "DSC_0003.jpg").getByLabel("4 stars")).toBeVisible();
  const edit = await page.evaluate(() => window.photo!.dispatch("develop.settings.get", { photoId: "DSC_0003.jpg" }));
  expect(edit).toMatchObject({ ok: true, value: { settings: { exposure: 0.5 } } });

  // One undo reverts the whole plan.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(cell(page, "DSC_0003.jpg").getByLabel("Unrated")).toBeVisible();
  const after = await page.evaluate(() => window.photo!.dispatch("develop.settings.get", { photoId: "DSC_0003.jpg" }));
  expect(after).toMatchObject({ ok: true, value: { edited: false } });
});

test("cancel discards the preview completely", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("photo:ai.apiKey", JSON.stringify("sk-ant-e2e-key")));
  await page.reload(); // the sample library reopens by itself
  await expect(grid(page)).toBeVisible();
  await mockClaude(page);
  await ask(page, "best morning photos");
  await expect(grid(page).getByRole("listitem")).toHaveCount(3); // previewing
  await panel(page).getByRole("button", { name: "Cancel" }).click();
  await expect(panel(page)).toBeHidden();
  await expect(page.getByRole("toolbar", { name: "Filter and sort" })).toContainText("48 photos");
  await expect(cell(page, "DSC_0003.jpg").getByLabel("Unrated")).toBeVisible();
  await expect(page.getByRole("contentinfo")).not.toContainText("Last change");
});

test("Claude can see the photos: rendered with current edits and sent as images", async ({ page }) => {
  await page.evaluate(() => localStorage.setItem("photo:ai.apiKey", JSON.stringify("sk-ant-e2e-key")));
  await page.reload();
  await expect(grid(page)).toBeVisible();
  await page.evaluate(() => window.photo!.dispatch("develop.settings.apply", { settings: { saturation: -100 } }));

  const bodies: Array<Record<string, unknown>> = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    bodies.push(route.request().postDataJSON());
    const body =
      bodies.length === 1
        ? message([{ type: "tool_use", id: "toolu_v", name: "library_photos_view", input: { photoIds: ["DSC_0001.jpg"], size: "preview" } }], "tool_use")
        : message([{ type: "text", text: JSON.stringify({ summary: "It is black and white already.", steps: [] }) }], "end_turn");
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  });

  await ask(page, "does this photo look black and white?");
  await expect(panel(page)).toContainText("It is black and white already.");

  const messages = bodies[1]!.messages as Array<{ role: string; content: Array<{ type: string; content?: Array<{ type: string; source?: { data: string; media_type: string } }> }> }>;
  const result = messages.at(-1)!.content[0]!;
  expect(result.type).toBe("tool_result");
  const image = result.content!.find((c) => c.type === "image")!;
  expect(image.source!.media_type).toBe("image/jpeg");
  // Decode what was sent: 1024px wide, and greyscale because the edit was applied.
  const decoded = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    const c = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
    c.drawImage(bmp, 0, 0);
    const d = c.getImageData(0, 0, bmp.width, bmp.height).data;
    let spread = 0;
    for (let i = 0; i < d.length; i += 4) spread = Math.max(spread, Math.max(d[i]!, d[i + 1]!, d[i + 2]!) - Math.min(d[i]!, d[i + 1]!, d[i + 2]!));
    return { width: bmp.width, height: bmp.height, spread };
  }, image.source!.data);
  expect(decoded.width).toBe(1024);
  expect(decoded.height).toBe(683);
  expect(decoded.spread).toBeLessThan(12);
});
