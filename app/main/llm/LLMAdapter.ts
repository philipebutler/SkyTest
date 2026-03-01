import type { LLMRequest, LLMResponse } from "../../shared/types";

/**
 * Adapter interface for LLM backends (SPEC §11.4).
 * Implementations: CopilotAdapter, OpenAIAdapter.
 * The active adapter is selected from Settings.
 */
export interface LLMAdapter {
  /**
   * Send a request to the LLM and return the full response.
   * Implementations must not include credentials in the request.
   */
  complete(request: LLMRequest): Promise<LLMResponse>;

  /**
   * Stream a response from the LLM, calling onToken for each token received.
   * Returns the final aggregated LLMResponse once streaming is complete.
   */
  stream(
    request: LLMRequest,
    onToken: (token: string) => void
  ): Promise<LLMResponse>;
}
