/**
 * RecordingRefactorer – Issue #22: Recording → Test Refactor
 *
 * Responsibilities:
 *  - Send raw ActionStep[] to the LLM with a refactoring prompt.
 *  - Receive a cleaned DSL with improved selectors and suggested assertions.
 *  - Return a RefactoredRecording for the user to review before saving.
 *
 * Per AGENTS.md §1.3 / §12, credentials are never sent to the LLM and the
 * output is validated before use.
 */

import { redactSecrets } from "../llm/credentialSanitizer";
import type { LLMAdapter } from "../llm/LLMAdapter";
import type { ActionStep, ActionVerb, LLMRequest, RefactoredRecording, ToolPolicy } from "../../shared/types";

/** Draft test produced by the LLM that the user reviews before saving. */
export type { RefactoredRecording };

/** All verbs permitted in a refactored recording. */
const REFACTOR_VERBS: ActionVerb[] = [
  "navigate", "click", "fill", "select", "check", "uncheck",
  "hover", "wait", "waitForSelector", "waitForNavigation",
  "scroll", "screenshot", "assert",
];

/**
 * System prompt used when asking the LLM to refactor a raw recording.
 * Exported so tests can verify it contains required instructions.
 */
export const REFACTOR_SYSTEM_PROMPT = `You are a test automation refactoring assistant.
Given a raw list of recorded browser actions, you will:
1. Rewrite brittle selectors (bare tag names, tag+class combos) with more robust alternatives where context allows. Prefer data-testid, aria-label, id, or name attribute selectors.
2. Remove duplicate or redundant navigation steps.
3. Suggest 1–3 meaningful assertions based on the final state the recording reaches.
4. Output ONLY valid JSON conforming to the schema below — no markdown, no explanation.

Output schema:
{
  "intent": "<short human-readable summary of what this test does>",
  "steps": [{ "action": string, "selector"?: string, "value"?: string, "url"?: string, "timeout"?: number }],
  "assertions": [{ "type": "textVisible"|"elementVisible"|"urlContains"|"countEquals", "selector"?: string, "value"?: string, "count"?: number }]
}

Rules:
- Do not invent selectors that have no basis in the recorded steps.
- If you cannot improve a selector, keep it exactly as-is.
- Never include credentials, passwords, or secrets.
- If the recording is empty, return { "intent": "Empty recording", "steps": [], "assertions": [] }.`;

/**
 * Parses the LLM's raw text into a RefactoredRecording.
 * Falls back to the original steps with no assertions on any parse failure.
 */
export function parseRefactorResponse(rawText: string, fallbackSteps: ActionStep[]): RefactoredRecording {
  const trimmed = rawText.trim();
  try {
    const parsed = JSON.parse(trimmed) as Partial<RefactoredRecording>;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.steps)) {
      return {
        intent: typeof parsed.intent === "string" && parsed.intent.trim() !== ""
          ? parsed.intent
          : "Recorded test",
        steps: parsed.steps,
        assertions: Array.isArray(parsed.assertions) ? parsed.assertions : [],
      };
    }
  } catch {
    // Fall through to fallback below
  }
  console.warn("[RecordingRefactorer] Could not parse LLM response – using original steps.");
  return { intent: "Recorded test", steps: fallbackSteps, assertions: [] };
}

/**
 * Uses the LLM adapter to refactor a raw recording into a clean TestCase DSL.
 * The caller (IPC handler) is responsible for instantiating RecordingRefactorer
 * with the active LLM adapter.
 */
export class RecordingRefactorer {
  constructor(private readonly adapter: LLMAdapter) {}

  /**
   * Refactor raw ActionStep[] into a cleaned DSL with suggested assertions.
   * The result must be reviewed by the user before saving (SPEC §9.2).
   */
  async refactor(steps: ActionStep[]): Promise<RefactoredRecording> {
    if (steps.length === 0) {
      return { intent: "Empty recording", steps: [], assertions: [] };
    }

    const stepsJson = JSON.stringify(steps, null, 2);
    // Redact any accidental secrets that might have been captured during recording
    const safeStepsJson = redactSecrets(stepsJson);

    const request: LLMRequest = {
      systemPrompt: REFACTOR_SYSTEM_PROMPT,
      userMessage: `Refactor the following raw recording into clean DSL:\n\n${safeStepsJson}`,
      toolPolicy: "full" as ToolPolicy,
      allowedVerbs: REFACTOR_VERBS,
      environment: "",
      baseUrl: "",
    };

    let response;
    try {
      response = await this.adapter.stream(request, () => {
        // Tokens are not streamed to a UI during refactoring; we consume the final response only.
      });
    } catch (err) {
      console.error("[RecordingRefactorer] LLM adapter error:", err instanceof Error ? err.message : String(err));
      return { intent: "Recorded test", steps, assertions: [] };
    }

    return parseRefactorResponse(response.rawText, steps);
  }
}
