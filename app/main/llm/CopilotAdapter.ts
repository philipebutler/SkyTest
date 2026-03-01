import type { LLMAdapter } from "./LLMAdapter";
import type { LLMRequest, LLMResponse } from "../../shared/types";

/**
 * Stub Copilot adapter (SPEC §11.4).
 * TODO (#5): Replace stub with real GitHub Copilot / OpenAI-compatible HTTP call
 * once an API endpoint and auth mechanism are configured in Settings.
 * Credentials must be sourced from Settings and must never be included in LLMRequest.
 */
export class CopilotAdapter implements LLMAdapter {
  async complete(request: LLMRequest): Promise<LLMResponse> {
    // TODO (#5): Send request to Copilot API endpoint
    // The system prompt already contains allowedVerbs and baseUrl (SPEC §11.3)
    const rawText =
      "CLARIFY: No LLM endpoint is configured. Please set up the Copilot API in Settings.";
    console.log("[CopilotAdapter] complete() called – stub response returned");
    console.log(`[CopilotAdapter] userMessage: ${request.userMessage}`);
    return {
      type: "clarification",
      content: rawText.replace(/^CLARIFY:\s*/, ""),
      rawText,
    };
  }

  async stream(
    request: LLMRequest,
    onToken: (token: string) => void
  ): Promise<LLMResponse> {
    // TODO (#5): Stream tokens from Copilot API endpoint
    console.log("[CopilotAdapter] stream() called – stub response returned");
    console.log(`[CopilotAdapter] userMessage: ${request.userMessage}`);
    const response = await this.complete(request);
    // Emit the full content as a single "token" for the stub
    onToken(typeof response.content === "string" ? response.content : JSON.stringify(response.content));
    return response;
  }
}
