import type { LLMAdapter } from "./LLMAdapter";
import type { LLMRequest, LLMResponse } from "../../shared/types";
import { StorageService } from "../storage/StorageService";

/** Shape of a non-streaming OpenAI chat completion response. */
interface OpenAIChatCompletion {
  choices: Array<{ message: { content: string } }>;
}

/** Shape of a single SSE chunk in a streaming OpenAI response. */
interface OpenAIChatChunk {
  choices: Array<{ delta: { content?: string } }>;
}

/**
 * OpenAI-compatible LLM adapter (SPEC §11.4, Issue #5).
 * Reads endpoint, API key, and model from Settings at call time so changes
 * in the Settings screen take effect without an app restart.
 * Credentials are sourced exclusively from Settings and never included in
 * LLMRequest payloads sent to the renderer.
 */
export class CopilotAdapter implements LLMAdapter {
  /** Returns the configured LLM settings, or null when not yet configured. */
  private getConfig(): { endpoint: string; apiKey: string; model: string } | null {
    const settings = StorageService.getInstance().getSettings();
    const endpoint = settings.llmEndpoint?.trim();
    const apiKey = settings.llmApiKey?.trim();
    const model = settings.llmModel?.trim() || "gpt-4o";
    if (!endpoint || !apiKey) return null;
    return { endpoint, apiKey, model };
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const cfg = this.getConfig();
    if (!cfg) {
      const rawText =
        "CLARIFY: No LLM endpoint is configured. Please set up the LLM API endpoint and key in Settings.";
      console.log("[CopilotAdapter] complete() called – no endpoint configured");
      return {
        type: "clarification",
        content: rawText.replace(/^CLARIFY:\s*/, ""),
        rawText,
      };
    }

    const response = await fetch(`${cfg.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userMessage },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`LLM API error (HTTP ${response.status}): ${errText}`);
    }

    const data = (await response.json()) as OpenAIChatCompletion;
    const rawText = data.choices?.[0]?.message?.content ?? "";
    // rawText is returned as-is; the orchestrator calls parseRawResponse to classify it
    return { type: "plan", content: rawText, rawText };
  }

  async stream(
    request: LLMRequest,
    onToken: (token: string) => void
  ): Promise<LLMResponse> {
    const cfg = this.getConfig();
    if (!cfg) {
      const rawText =
        "CLARIFY: No LLM endpoint is configured. Please set up the LLM API endpoint and key in Settings.";
      console.log("[CopilotAdapter] stream() called – no endpoint configured");
      onToken(rawText.replace(/^CLARIFY:\s*/, ""));
      return {
        type: "clarification",
        content: rawText.replace(/^CLARIFY:\s*/, ""),
        rawText,
      };
    }

    const response = await fetch(`${cfg.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userMessage },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`LLM API error (HTTP ${response.status}): ${errText}`);
    }

    // Parse Server-Sent Events from the streaming response body
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body from LLM endpoint");

    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const chunk = JSON.parse(trimmed.slice(6)) as OpenAIChatChunk;
          const token = chunk.choices?.[0]?.delta?.content ?? "";
          if (token) {
            accumulated += token;
            onToken(token);
          }
        } catch {
          // Skip malformed SSE lines; debug log for troubleshooting
          console.debug("[CopilotAdapter] Skipping malformed SSE line:", trimmed);
        }
      }
    }

    // accumulated is the full raw text; the orchestrator classifies it
    return { type: "plan", content: accumulated, rawText: accumulated };
  }
}
