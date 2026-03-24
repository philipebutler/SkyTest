import type { WebContents } from "electron";
import type { LLMAdapter } from "./LLMAdapter";
import { redactSecrets } from "./credentialSanitizer";
import { ADVANCED_ACTION_VERBS, CORE_ACTION_VERBS } from "../../shared/types";
import type {
  ActionVerb,
  ChatHistoryEntry,
  DSLPlan,
  LLMRequest,
  LLMResponse,
  LLMStreamToken,
  ToolPolicy,
} from "../../shared/types";

/** Verbs permitted under each tool policy (SPEC §8 / §11.2). */
const POLICY_VERBS: Record<ToolPolicy, ActionVerb[]> = {
  "read-only": ["navigate", "screenshot", "assert", "wait", "waitForSelector", "waitForNavigation"],
  "safe-write": [...CORE_ACTION_VERBS],
  full: [...CORE_ACTION_VERBS, ...ADVANCED_ACTION_VERBS],
};

/** System prompt template (SPEC §11.3). */
function buildSystemPrompt(allowedVerbs: ActionVerb[], baseUrl: string): string {
  return `You are a test automation planner. Your job is to convert user intent into a valid DSL plan.

Rules:
- Output only valid JSON conforming to DSLPlan v1, or a clarifying question prefixed with CLARIFY:
- Do not emit code, markdown, or explanation
- Only use verbs from this list: ${allowedVerbs.join(", ")}
- For advanced verbs, put structured arguments under step.params as JSON object fields
- If intent is ambiguous, output CLARIFY: followed by your question
- The base URL for this session is: ${redactSecrets(baseUrl)}
- Do not guess at selectors; use descriptive selectors the user would recognize`;
}

/**
 * Builds the user message, prepending conversation history when resuming from a clarification (Issue #6).
 * The LLM receives the full prior exchange so it can resolve ambiguity without guessing.
 * All content is passed through redactSecrets() before being included (Issue #14).
 */
function buildUserMessage(prompt: string, chatHistory?: ChatHistoryEntry[]): string {
  const safePrompt = redactSecrets(prompt);
  if (!chatHistory || chatHistory.length === 0) return safePrompt;
  const historyText = chatHistory
    .map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${redactSecrets(h.content)}`)
    .join("\n");
  return `Prior conversation:\n${historyText}\n\nUser: ${safePrompt}`;
}

/**
 * Parses a raw LLM text into a typed LLMResponse (SPEC §11.1, §11.5).
 * - Valid JSON → type "plan"
 * - CLARIFY: prefix → type "clarification"
 * - Otherwise → type "error" (malformed output)
 */
function parseRawResponse(rawText: string): LLMResponse {
  const trimmed = rawText.trim();

  if (trimmed.startsWith("CLARIFY:")) {
    return {
      type: "clarification",
      content: trimmed.replace(/^CLARIFY:\s*/, ""),
      rawText,
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as DSLPlan;
    if (parsed.version === "1" && Array.isArray(parsed.steps)) {
      return { type: "plan", content: parsed, rawText };
    }
    console.warn("[LLMOrchestrator] JSON parsed but does not match DSLPlan schema");
    return { type: "error", content: "LLM returned JSON that does not conform to DSLPlan v1.", rawText };
  } catch {
    console.warn("[LLMOrchestrator] Malformed LLM output – neither JSON nor CLARIFY:", rawText);
    return { type: "error", content: "LLM returned malformed output. Please rephrase or retry.", rawText };
  }
}

export interface ChatSendPayload {
  prompt: string;
  toolPolicy: ToolPolicy;
  environment: string;
  browser: string;
  /** Whether to run the browser in headed (visible) mode (Issue #10). */
  headed?: boolean;
  baseUrl?: string;
  priorSteps?: import("../../shared/types").ActionStep[];
  /** Conversation history used to resume flow after a clarification (Issue #6). */
  chatHistory?: ChatHistoryEntry[];
}

/**
 * LLM Orchestration Layer (Issue #5 / SPEC §11).
 *
 * - Accepts prompt + context from the IPC handler
 * - Builds a typed LLMRequest (credentials excluded)
 * - Delegates to the active LLMAdapter
 * - Classifies the response as plan | clarification | error
 * - Streams tokens back to the renderer via chat:stream
 * - Logs raw model responses for audit (non-secret)
 */
export class LLMOrchestrator {
  constructor(private readonly adapter: LLMAdapter) {}

  /**
   * Handle an incoming chat:send request.
   * Streams tokens to the renderer and returns the final LLMResponse.
   *
   * @param streamId - Unique identifier for this stream session.
   * @param payload  - Chat payload from the renderer.
   * @param sender   - WebContents of the originating BrowserWindow.
   */
  async handleChatSend(
    streamId: string,
    payload: ChatSendPayload,
    sender: WebContents
  ): Promise<LLMResponse> {
    const allowedVerbs = POLICY_VERBS[payload.toolPolicy] ?? POLICY_VERBS["read-only"];
    const baseUrl = payload.baseUrl ?? payload.environment ?? "";

    const request: LLMRequest = {
      systemPrompt: buildSystemPrompt(allowedVerbs, baseUrl),
      userMessage: buildUserMessage(payload.prompt, payload.chatHistory),
      toolPolicy: payload.toolPolicy,
      allowedVerbs,
      environment: payload.environment,
      baseUrl,
      priorSteps: payload.priorSteps,
    };

    const onToken = (token: string) => {
      const streamToken: LLMStreamToken = { streamId, token, done: false };
      if (!sender.isDestroyed()) {
        sender.send("chat:stream", streamToken);
      }
    };

    let response: LLMResponse;
    try {
      response = await this.adapter.stream(request, onToken);
      response = parseRawResponse(response.rawText);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[LLMOrchestrator] Adapter error:", errorMsg);
      response = {
        type: "error",
        content: `LLM adapter error: ${errorMsg}`,
        rawText: errorMsg,
      };
    }

    // Log raw text for audit — redacted to ensure no secrets are written to logs (Issue #14)
    console.log(`[LLMOrchestrator] streamId=${streamId} type=${response.type}`);
    console.log(`[LLMOrchestrator] rawText: ${redactSecrets(response.rawText)}`);

    // Send terminal token to signal end of stream, carrying the response classification
    const doneToken: LLMStreamToken = { streamId, token: "", done: true, responseType: response.type };
    if (!sender.isDestroyed()) {
      sender.send("chat:stream", doneToken);
    }

    return response;
  }
}
