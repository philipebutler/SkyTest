/**
 * Unit tests for RecordingRefactorer – Issue #22: Recording → Test Refactor.
 *
 * Verifies:
 * - parseRefactorResponse() handles valid JSON, invalid JSON, and missing fields
 * - RecordingRefactorer.refactor() returns empty result for empty input
 * - RecordingRefactorer.refactor() passes correct request to the adapter
 * - RecordingRefactorer.refactor() handles a well-formed LLM response
 * - RecordingRefactorer.refactor() falls back gracefully on adapter error
 * - REFACTOR_SYSTEM_PROMPT contains required instructions (no credentials, JSON-only)
 */

import type { LLMAdapter } from "../llm/LLMAdapter";
import type { ActionStep, LLMRequest, LLMResponse } from "../../shared/types";
import {
  parseRefactorResponse,
  RecordingRefactorer,
  REFACTOR_SYSTEM_PROMPT,
} from "./RecordingRefactorer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(rawText: string): LLMAdapter {
  return {
    complete: jest.fn().mockResolvedValue({ type: "plan", content: rawText, rawText }),
    stream: jest.fn().mockImplementation(
      async (_req: LLMRequest, _onToken: (t: string) => void): Promise<LLMResponse> => ({
        type: "plan",
        content: rawText,
        rawText,
      })
    ),
  };
}

const SAMPLE_STEPS: ActionStep[] = [
  { action: "navigate", value: "https://example.com" },
  { action: "click", selector: "button.primary" },
  { action: "fill", selector: "[name='email']", value: "user@example.com" },
];

// ---------------------------------------------------------------------------
// REFACTOR_SYSTEM_PROMPT sanity checks
// ---------------------------------------------------------------------------

describe("REFACTOR_SYSTEM_PROMPT", () => {
  it("instructs the LLM to output only JSON", () => {
    expect(REFACTOR_SYSTEM_PROMPT).toMatch(/Output ONLY valid JSON/i);
  });

  it("prohibits credentials in the output", () => {
    expect(REFACTOR_SYSTEM_PROMPT).toMatch(/Never include credentials/i);
  });

  it("specifies the assertion type enum", () => {
    expect(REFACTOR_SYSTEM_PROMPT).toContain("textVisible");
    expect(REFACTOR_SYSTEM_PROMPT).toContain("urlContains");
  });
});

// ---------------------------------------------------------------------------
// parseRefactorResponse – unit tests
// ---------------------------------------------------------------------------

describe("parseRefactorResponse", () => {
  it("returns parsed result for valid JSON with all fields", () => {
    const raw = JSON.stringify({
      intent: "Login flow",
      steps: [{ action: "navigate", value: "https://example.com" }],
      assertions: [{ type: "urlContains", value: "example.com" }],
    });
    const result = parseRefactorResponse(raw, []);
    expect(result.intent).toBe("Login flow");
    expect(result.steps).toHaveLength(1);
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0].type).toBe("urlContains");
  });

  it("uses fallback steps when JSON does not contain a steps array", () => {
    const raw = JSON.stringify({ intent: "Bad response" });
    const result = parseRefactorResponse(raw, SAMPLE_STEPS);
    expect(result.steps).toEqual(SAMPLE_STEPS);
    expect(result.assertions).toEqual([]);
  });

  it("uses default intent when intent field is missing", () => {
    const raw = JSON.stringify({ steps: [], assertions: [] });
    const result = parseRefactorResponse(raw, []);
    expect(result.intent).toBe("Recorded test");
  });

  it("uses default intent when intent field is an empty string", () => {
    const raw = JSON.stringify({ intent: "   ", steps: [], assertions: [] });
    const result = parseRefactorResponse(raw, []);
    expect(result.intent).toBe("Recorded test");
  });

  it("defaults assertions to [] when assertions field is missing", () => {
    const raw = JSON.stringify({ intent: "Test", steps: [{ action: "navigate", value: "/" }] });
    const result = parseRefactorResponse(raw, []);
    expect(result.assertions).toEqual([]);
  });

  it("falls back to original steps on invalid JSON", () => {
    const result = parseRefactorResponse("not json at all", SAMPLE_STEPS);
    expect(result.steps).toEqual(SAMPLE_STEPS);
    expect(result.intent).toBe("Recorded test");
    expect(result.assertions).toEqual([]);
  });

  it("falls back to original steps on CLARIFY: prefix", () => {
    const result = parseRefactorResponse("CLARIFY: Please provide more details.", SAMPLE_STEPS);
    expect(result.steps).toEqual(SAMPLE_STEPS);
    expect(result.assertions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// RecordingRefactorer.refactor()
// ---------------------------------------------------------------------------

describe("RecordingRefactorer – empty steps", () => {
  it("returns empty result without calling the adapter when steps is empty", async () => {
    const adapter = makeAdapter("");
    const refactorer = new RecordingRefactorer(adapter);
    const result = await refactorer.refactor([]);
    expect(result.intent).toBe("Empty recording");
    expect(result.steps).toEqual([]);
    expect(result.assertions).toEqual([]);
    expect(adapter.stream).not.toHaveBeenCalled();
  });
});

describe("RecordingRefactorer – LLM call", () => {
  it("passes the raw steps JSON to the adapter in the user message", async () => {
    const adapter = makeAdapter(
      JSON.stringify({ intent: "Test", steps: SAMPLE_STEPS, assertions: [] })
    );
    const refactorer = new RecordingRefactorer(adapter);
    await refactorer.refactor(SAMPLE_STEPS);

    expect(adapter.stream).toHaveBeenCalledTimes(1);
    const [req] = (adapter.stream as jest.Mock).mock.calls[0] as [LLMRequest];
    expect(req.systemPrompt).toBe(REFACTOR_SYSTEM_PROMPT);
    expect(req.userMessage).toContain("navigate");
    expect(req.userMessage).toContain("https://example.com");
  });

  it("returns refactored steps and assertions from a valid LLM response", async () => {
    const refactoredSteps: ActionStep[] = [
      { action: "navigate", value: "https://example.com" },
      { action: "fill", selector: "[aria-label='Email']", value: "user@example.com" },
    ];
    const adapter = makeAdapter(
      JSON.stringify({
        intent: "Fill email form",
        steps: refactoredSteps,
        assertions: [{ type: "elementVisible", selector: "[aria-label='Email']" }],
      })
    );
    const refactorer = new RecordingRefactorer(adapter);
    const result = await refactorer.refactor(SAMPLE_STEPS);

    expect(result.intent).toBe("Fill email form");
    expect(result.steps).toEqual(refactoredSteps);
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0]).toMatchObject({ type: "elementVisible", selector: "[aria-label='Email']" });
  });

  it("falls back gracefully when the LLM adapter throws an error", async () => {
    const adapter: LLMAdapter = {
      complete: jest.fn(),
      stream: jest.fn().mockRejectedValue(new Error("Network error")),
    };
    const refactorer = new RecordingRefactorer(adapter);
    const result = await refactorer.refactor(SAMPLE_STEPS);

    expect(result.intent).toBe("Recorded test");
    expect(result.steps).toEqual(SAMPLE_STEPS);
    expect(result.assertions).toEqual([]);
  });

  it("falls back to original steps when LLM returns malformed output", async () => {
    const adapter = makeAdapter("CLARIFY: What is the base URL?");
    const refactorer = new RecordingRefactorer(adapter);
    const result = await refactorer.refactor(SAMPLE_STEPS);

    expect(result.steps).toEqual(SAMPLE_STEPS);
    expect(result.assertions).toEqual([]);
  });

  it("does not include URL-embedded credentials in the request sent to the adapter", async () => {
    const stepsWithCredentialUrl: ActionStep[] = [
      { action: "navigate", value: "https://admin:s3cr3tP4ss@example.com/login" },
    ];
    const adapter = makeAdapter(
      JSON.stringify({ intent: "Login", steps: stepsWithCredentialUrl, assertions: [] })
    );
    const refactorer = new RecordingRefactorer(adapter);
    await refactorer.refactor(stepsWithCredentialUrl);

    const [req] = (adapter.stream as jest.Mock).mock.calls[0] as [LLMRequest];
    // The credential sanitizer redacts URL-embedded credentials (scheme://user:pass@host)
    expect(req.userMessage).not.toContain("admin:s3cr3tP4ss");
  });
});
