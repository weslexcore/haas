import { expect, test, type Page, type Route } from "@playwright/test";

const panel = (page: Page) => page.getByRole("complementary", { name: "AI conversation" });
const grid = (page: Page) => page.getByRole("list", { name: "Photos" });
const cell = (page: Page, name: string) => grid(page).getByRole("button", { name, exact: true });
const count = (page: Page) => page.getByRole("toolbar", { name: "Filter and sort" });

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
const text = (value: unknown) => message([{ type: "text", text: JSON.stringify(value) }], "end_turn");

const PLAN = {
  summary: "Give the 3 best morning photos 5 stars, brighten them, and show only 5-star photos.",
  steps: [
    { actionId: "library.rating.set", paramsJson: '{"rating":5,"photoIds":["DSC_0002.jpg","DSC_0003.jpg","DSC_0004.jpg"]}', reason: "They are the earliest shots." },
    { actionId: "develop.adjust", paramsJson: '{"setting":"exposure","delta":0.5,"photoIds":["DSC_0002.jpg","DSC_0003.jpg","DSC_0004.jpg"]}', reason: "A little brighter." },
    { actionId: "library.filter.set", paramsJson: '{"minRating":5}', reason: "Show only them." },
    { actionId: "library.rating.set", paramsJson: '{"rating":11}', reason: "An invalid step the review should catch." },
  ],
};

/** Fake Anthropic API. `replies` are served in order; requests are recorded. */
async function mockClaude(page: Page, replies: unknown[]) {
  const requests: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
  await page.route("https://api.anthropic.com/**", async (route: Route) => {
    const req = route.request();
    requests.push({ headers: req.headers(), body: req.postDataJSON() });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(replies[requests.length - 1] ?? text({ summary: "No more replies.", steps: [] })),
    });
  });
  return requests;
}

async function withKey(page: Page) {
  await page.evaluate(() => localStorage.setItem("photo:ai.apiKey", JSON.stringify("sk-ant-e2e-key")));
  await page.reload(); // the sample library reopens by itself
  await expect(grid(page)).toBeVisible();
}

async function ask(page: Page, prompt: string) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type(`?${prompt}`);
  await page.keyboard.press("Enter");
}

async function send(page: Page, prompt: string) {
  await panel(page).getByRole("textbox", { name: "Message the AI" }).fill(prompt);
  await panel(page).getByRole("button", { name: "Send" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Sample Library" }).click();
  await expect(grid(page)).toBeVisible();
});

test("without a key, the conversation points to AI Settings, where the key is saved locally", async ({ page }) => {
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

test("review, preview, edit and apply a suggestion as one undo step", async ({ page }) => {
  await withKey(page);
  const requests = await mockClaude(page, [
    message([{ type: "tool_use", id: "toolu_1", name: "library_photos_list", input: { capturedBefore: "2026-09-12T06:36" } }], "tool_use"),
    text(PLAN),
  ]);

  await ask(page, "give my three best morning photos five stars and brighten them");
  const p = panel(page);
  await expect(p).toContainText(PLAN.summary);
  await expect(p.getByRole("listitem", { name: "Suggestion 1" })).toBeVisible();

  // The browser called the API directly with the user's key; the lookup ran and went back to Claude.
  expect(requests).toHaveLength(2);
  expect(requests[0]!.headers["x-api-key"]).toBe("sk-ant-e2e-key");
  expect(requests[0]!.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  expect(JSON.stringify(requests[1]!.body.messages)).toContain("DSC_0003.jpg");

  const card = p.getByRole("listitem", { name: "Suggestion 1" });
  const steps = card.locator("ol > li");
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(0)).toContainText("Rate ★★★★★ on 3 photos");
  await expect(steps.nth(1)).toContainText("Exposure +0.50 on 3 photos");
  await expect(steps.nth(3).getByRole("checkbox")).not.toBeChecked();

  // Live preview, with other edits refused meanwhile.
  await expect(grid(page).getByRole("listitem")).toHaveCount(3);
  await expect(cell(page, "DSC_0003.jpg").getByLabel("5 stars")).toBeVisible();
  await page.keyboard.press("1");
  await expect(cell(page, "DSC_0003.jpg").getByLabel("5 stars")).toBeVisible();

  await steps.nth(2).getByRole("checkbox").uncheck();
  await expect(count(page)).toContainText("48 photos");
  await steps.nth(0).getByRole("button", { name: "Edit" }).click();
  await steps.nth(0).getByRole("textbox", { name: "Parameters for step 1" }).fill('{"rating":4,"photoIds":["DSC_0002.jpg","DSC_0003.jpg"]}');
  await expect(steps.nth(0)).toContainText("Rate ★★★★ on 2 photos");
  await expect(cell(page, "DSC_0002.jpg").getByLabel("4 stars")).toBeVisible();

  await card.getByRole("button", { name: "Apply 2 of 4" }).click();
  await expect(page.getByText("Applied 2 AI-suggested changes")).toBeVisible();
  await expect(card).toContainText("Partly applied");
  await expect(card).toContainText("edited");
  await expect(page.getByRole("contentinfo")).toContainText("Last change: AI:");
  await expect(cell(page, "DSC_0003.jpg").getByLabel("4 stars")).toBeVisible();

  // One undo reverts the edits and the suggestion's status together.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(cell(page, "DSC_0003.jpg").getByLabel("Unrated")).toBeVisible();
  await expect(card).toContainText("Not applied");
});

test("follow-ups: Claude sees what was applied, and the conversation is kept", async ({ page }) => {
  await withKey(page);
  const requests = await mockClaude(page, [
    text(PLAN),
    text({ summary: "Brighten a little more.", steps: [{ actionId: "develop.adjust", paramsJson: '{"setting":"exposure","delta":0.2}', reason: "More light." }] }),
  ]);
  await ask(page, "best morning photos");
  const card1 = panel(page).getByRole("listitem", { name: "Suggestion 1" });
  await card1.locator("ol > li").nth(2).getByRole("checkbox").uncheck(); // keep the filter out
  await card1.getByRole("button", { name: "Apply 2 of 4" }).click();
  await expect(card1).toContainText("Partly applied");

  await send(page, "a bit brighter please");
  await expect(panel(page).getByRole("listitem", { name: "Suggestion 2" })).toContainText("Brighten a little more.");

  const followUp = requests[1]!.body.messages as Array<{ role: string; content: unknown }>;
  expect(followUp.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  const latest = String(followUp[2]!.content);
  expect(latest).toContain("<suggestion_status>");
  expect(latest).toContain("applied steps 1, 2");
  expect(latest).toContain("not applied: steps 3, 4");
  expect(latest).toContain("a bit brighter please");

  // Dismiss the second suggestion; it stays in the panel, marked.
  await panel(page).getByRole("listitem", { name: "Suggestion 2" }).getByRole("button", { name: "Dismiss" }).click();
  await expect(panel(page).getByRole("listitem", { name: "Suggestion 2" })).toContainText("Dismissed");

  // The panel closes and opens (⌘J); the conversation survives a reload.
  await page.keyboard.press("ControlOrMeta+j");
  await expect(panel(page)).toBeHidden();
  await page.reload();
  await expect(grid(page)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(panel(page).getByRole("listitem", { name: "Suggestion 1" })).toContainText("Partly applied");
  await expect(panel(page).getByRole("listitem", { name: "Suggestion 2" })).toContainText("Dismissed");
  await expect(panel(page)).toContainText("a bit brighter please");
});

test("closing a review discards the preview completely; the suggestion stays for later", async ({ page }) => {
  await withKey(page);
  await mockClaude(page, [text(PLAN)]);
  await ask(page, "best morning photos");
  await expect(grid(page).getByRole("listitem")).toHaveCount(3); // previewing
  const card = panel(page).getByRole("listitem", { name: "Suggestion 1" });
  await card.getByRole("button", { name: "Close" }).click();
  await expect(count(page)).toContainText("48 photos");
  await expect(cell(page, "DSC_0003.jpg").getByLabel("Unrated")).toBeVisible();
  await expect(page.getByRole("contentinfo")).not.toContainText("Last change");
  await expect(card).toContainText("Not applied");
  // Later: review it again and apply.
  await card.getByRole("button", { name: "Review…" }).click();
  await expect(grid(page).getByRole("listitem")).toHaveCount(3);
  await card.getByRole("button", { name: "Apply 3 of 4" }).click();
  await expect(card).toContainText("Partly applied");
});

test("Claude can see the photos: rendered with current edits and sent as images", async ({ page }) => {
  await withKey(page);
  await page.evaluate(() => window.photo!.dispatch("develop.settings.apply", { settings: { saturation: -100 } }));
  const requests = await mockClaude(page, [
    message([{ type: "tool_use", id: "toolu_v", name: "library_photos_view", input: { photoIds: ["DSC_0001.jpg"], size: "preview" } }], "tool_use"),
    text({ summary: "It is black and white already.", steps: [] }),
  ]);
  await ask(page, "does this photo look black and white?");
  await expect(panel(page)).toContainText("It is black and white already.");

  const messages = requests[1]!.body.messages as Array<{ content: Array<{ type: string; content?: Array<{ type: string; source?: { data: string; media_type: string } }> }> }>;
  const result = messages.at(-1)!.content[0]!;
  expect(result.type).toBe("tool_result");
  const image = result.content!.find((c) => c.type === "image")!;
  expect(image.source!.media_type).toBe("image/jpeg");
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
  expect(decoded).toMatchObject({ width: 1024, height: 683 });
  expect(decoded.spread).toBeLessThan(12);
});
