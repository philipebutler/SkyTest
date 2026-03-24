import type { ActionStep, TestCase } from "../../shared/types";
import { applyRawTestUpdate, expandLegacyChatSteps } from "./handlers";

function makeTestCase(overrides: Partial<TestCase> = {}): TestCase {
  const now = new Date().toISOString();
  return {
    schemaVersion: "1",
    id: "test-1",
    name: "Sample",
    tags: [],
    preconditions: [],
    steps: [{ action: "navigate", value: "https://example.com" }],
    assertions: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("applyRawTestUpdate", () => {
  it("updates test with valid raw JSON and clears uiDraft", () => {
    const existing = makeTestCase({
      uiDraft: {
        isDraft: true,
        invalidRawJson: "{}",
        parseError: "x",
        stagedAt: new Date().toISOString(),
      },
    });

    const rawJson = JSON.stringify({
      name: "Updated",
      steps: [{ action: "click", selector: "#go" }],
      assertions: [],
    });

    const updated = applyRawTestUpdate(existing, { rawJson });
    expect(updated.name).toBe("Updated");
    expect(updated.steps).toEqual([{ action: "click", selector: "#go", value: undefined, url: undefined, timeout: undefined, optional: undefined }]);
    expect(updated.uiDraft).toBeUndefined();
  });

  it("throws on invalid JSON when allowDraft is false", () => {
    const existing = makeTestCase();
    expect(() => applyRawTestUpdate(existing, { rawJson: "{ bad" })).toThrow(/Invalid JSON/);
  });

  it("stores draft metadata and preserves executable steps on invalid JSON when allowDraft is true", () => {
    const existing = makeTestCase();
    const updated = applyRawTestUpdate(existing, { rawJson: "{ bad", allowDraft: true });

    expect(updated.steps).toEqual(existing.steps);
    expect(updated.uiDraft?.isDraft).toBe(true);
    expect(updated.uiDraft?.invalidRawJson).toBe("{ bad");
    expect(updated.uiDraft?.parseError).toMatch(/Invalid JSON/);
  });

  it("stores draft metadata on invalid structure when allowDraft is true", () => {
    const existing = makeTestCase();
    const updated = applyRawTestUpdate(existing, {
      rawJson: JSON.stringify({ name: "Broken", steps: [] }),
      allowDraft: true,
    });

    expect(updated.steps).toEqual(existing.steps);
    expect(updated.uiDraft?.isDraft).toBe(true);
    expect(updated.uiDraft?.validationErrors?.[0]).toMatch(/at least one valid step/i);
  });

  it("normalizes navigate url into value when saving", () => {
    const existing = makeTestCase();
    const updated = applyRawTestUpdate(existing, {
      rawJson: JSON.stringify({
        name: "Navigate with url",
        steps: [{ action: "navigate", url: "https://www.google.com" }],
        assertions: [],
      }),
    });

    expect(updated.steps[0]).toMatchObject({
      action: "navigate",
      value: "https://www.google.com",
      url: "https://www.google.com",
    });
  });

  it("normalizes keyboardPress value into params.key", () => {
    const existing = makeTestCase();
    const updated = applyRawTestUpdate(existing, {
      rawJson: JSON.stringify({
        name: "Keyboard press",
        steps: [{ action: "keyboardPress", value: "Enter" }],
        assertions: [],
      }),
    });

    expect(updated.steps[0]).toMatchObject({
      action: "keyboardPress",
      value: "Enter",
      params: { key: "Enter" },
    });
  });
});

describe("expandLegacyChatSteps", () => {
  it("returns unchanged steps when no legacy chat step exists", async () => {
    const steps: ActionStep[] = [{ action: "navigate", value: "https://example.com" }];
    const result = await expandLegacyChatSteps(steps, {
      complete: async () => ({
        type: "plan",
        content: "",
        rawText: "",
      }),
    });
    expect(result).toEqual(steps);
  });

  it("converts action:chat step using adapter DSL response", async () => {
    const steps: ActionStep[] = [{ action: "chat", value: "go to example and screenshot" }];
    const result = await expandLegacyChatSteps(steps, {
      complete: async () => ({
        type: "plan",
        content: "",
        rawText: JSON.stringify({
          version: "1",
          intent: "converted",
          steps: [
            { action: "navigate", value: "https://example.com" },
            { action: "screenshot" },
          ],
        }),
      }),
    });

    expect(result).toHaveLength(2);
    expect(result[0].action).toBe("navigate");
    expect(result[1].action).toBe("screenshot");
  });

  it("throws when adapter cannot provide a plan", async () => {
    const steps: ActionStep[] = [{ action: "chat", value: "do thing" }];
    await expect(
      expandLegacyChatSteps(steps, {
        complete: async () => ({
          type: "clarification",
          content: "need more info",
          rawText: "CLARIFY: need more info",
        }),
      })
    ).rejects.toThrow(/could not be converted/i);
  });
});
