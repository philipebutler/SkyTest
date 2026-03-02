export type ActionVerb =
  | "navigate"
  | "click"
  | "fill"
  | "select"
  | "check"
  | "uncheck"
  | "hover"
  | "wait"
  | "waitForSelector"
  | "waitForNavigation"
  | "scroll"
  | "screenshot"
  | "assert";

export interface ActionStep {
  action: string;
  selector?: string;
  value?: string;
  url?: string;
  timeout?: number;
  optional?: boolean;
}

/** Canonical interchange format between the LLM planner and the Playwright Executor (SPEC §6). */
export interface DSLPlan {
  version: "1";
  /** Human-readable summary of the plan. */
  intent: string;
  steps: ActionStep[];
}

/** Context sent to the LLM on every request (SPEC §11.2). Credentials must never appear here. */
export interface LLMRequest {
  systemPrompt: string;
  userMessage: string;
  toolPolicy: ToolPolicy;
  allowedVerbs: ActionVerb[];
  environment: string;
  baseUrl: string;
  priorSteps?: ActionStep[];
}

/** Discriminated response returned by any LLMAdapter implementation (SPEC §11.4). */
export interface LLMResponse {
  type: "plan" | "clarification" | "error";
  /** DSLPlan when type is "plan"; clarification/error text otherwise. */
  content: DSLPlan | string;
  /** Always populated for audit — must not contain secrets. */
  rawText: string;
  tokensUsed?: number;
}

/** Single token emitted during a streaming response (SPEC §16 chat:stream). */
export interface LLMStreamToken {
  streamId: string;
  token: string;
  done: boolean;
  /** Present only on the terminal (done=true) token. Carries the classified response type. */
  responseType?: "plan" | "clarification" | "error";
}

/** A single entry in the conversation history used to resume flow after clarification (Issue #6). */
export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
  type?: "plan" | "clarification" | "error";
}

/** Result of DSL pre-execution validation (SPEC §6.3). */
export interface DSLValidationResult {
  valid: boolean;
  errors: Array<{ stepIndex: number; message: string }>;
}

export interface Assertion {
  type: "textVisible" | "elementVisible" | "urlContains" | "countEquals";
  selector?: string;
  value?: string;
  count?: number;
}

export interface TestCase {
  schemaVersion: string;
  id: string;
  name: string;
  tags: string[];
  preconditions: ActionStep[];
  steps: ActionStep[];
  assertions: Assertion[];
  /** Browser used when this test was last saved/run (Issue #9). */
  browser?: BrowserType;
  /** Number of times to retry a failed step or test (Issue #23). */
  retryCount?: number;
  /** Whether to retry per step or per test (Issue #23). */
  retryMode?: "step" | "test";
  createdAt: string;
  updatedAt: string;
}

/** A single attempt recorded during a retried step (Issue #23). */
export interface RetryAttempt {
  /** 1-based attempt number (1 = original, 2 = first retry, etc.). */
  attempt: number;
  status: "passed" | "failed";
  error?: string;
  durationMs: number;
}

export interface StepResult {
  stepIndex: number;
  action: string;
  status: "passed" | "failed" | "skipped";
  error?: string;
  artifactIds: string[];
  durationMs: number;
  /** Populated when one or more retries occurred for this step (Issue #23). */
  retryAttempts?: RetryAttempt[];
}

export interface AssertionResult {
  assertionIndex: number;
  type: Assertion["type"];
  status: "passed" | "failed";
  error?: string;
}

export interface Artifact {
  id: string;
  type: "screenshot" | "log" | "html" | "har";
  path: string;
  createdAt: string;
  stepIndex?: number;
}

export interface Run {
  schemaVersion: string;
  id: string;
  testId?: string;
  environment: string;
  browser: string;
  headed: boolean;
  toolPolicy: ToolPolicy;
  status: "running" | "passed" | "failed" | "aborted";
  stepResults: StepResult[];
  assertionResults?: AssertionResult[];
  artifacts: Artifact[];
  startedAt: string;
  finishedAt?: string;
  /** Number of test-level attempts when retryMode is "test" (Issue #23). */
  testAttempts?: number;
}

export type ToolPolicy = "read-only" | "safe-write" | "full";

export type BrowserType = "chromium" | "firefox" | "webkit";

/** Raw recording captured by RecordEngine (Issue #21). */
export interface RawRecording {
  schemaVersion: string;
  id: string;
  steps: ActionStep[];
  createdAt: string;
}

/** Draft test produced by the LLM that the user reviews before saving (Issue #22). */
export interface RefactoredRecording {
  /** Human-readable summary of what the recording does. */
  intent: string;
  /** Cleaned-up steps with improved selectors. */
  steps: ActionStep[];
  /** Suggested assertions (user may edit before saving). */
  assertions: Assertion[];
}

export interface RunConfig {
  command: string;
  environment: string;
  browser: BrowserType;
  headed: boolean;
  toolPolicy: ToolPolicy;
  authProfile?: string;
  /** Number of times to retry a failed step or test (Issue #23). */
  retryCount?: number;
  /** Whether to retry per step or per test (Issue #23). */
  retryMode?: "step" | "test";
  /** Output format for CI-compatible export (Issue #24). */
  outputFormat?: "junit" | "json";
}

export interface SaveTestPayload {
  name: string;
  /** Raw chat transcript captured as steps */
  steps: ActionStep[];
  /** Assertions to persist with the TestCase (Issue #22). */
  assertions?: Assertion[];
  /** Browser that was active when the test was saved (Issue #9). */
  browser?: BrowserType;
}

// Typed IPC contracts (SPEC §6.1)
export type IpcRequest =
  | { type: "ExecuteCommand"; payload: RunConfig }
  | { type: "ExecuteTest"; payload: { testId: string } }
  | { type: "GetRunHistory"; payload: Record<string, never> }
  | { type: "SaveTest"; payload: SaveTestPayload }
  | { type: "UpdateTest"; payload: { testId: string; rawJson: string } }
  | { type: "ListTests"; payload: Record<string, never> }
  | { type: "DeleteTest"; payload: { testId: string } }
  | { type: "ExportRun"; payload: { runId: string } }
  | { type: "UpdateSession"; payload: { environment: string } }
  | { type: "GetSettings"; payload: Record<string, never> }
  | { type: "SaveSettings"; payload: Partial<Settings> };

export type IpcChannel =
  | "executeCommand"
  | "executeDSLPlan"
  | "executeTest"
  | "getRunHistory"
  | "saveTest"
  | "updateTest"
  | "listTests"
  | "deleteTest"
  | "exportRun"
  | "getSettings"
  | "saveSettings"
  | "chat:send"
  | "auth:updateSession"
  | "auth:listProfiles"
  | "llm:testConnection"
  | "record:start"
  | "record:stop"
  | "record:refactor";

/**
 * Persisted user settings (Issue #2, Issue #3).
 * All paths default to sub-directories of Electron's userData folder.
 * Setting a path to an empty string restores the default.
 */
export interface Settings {
  schemaVersion: string;
  /** Override for the tests directory. Empty string = use default. */
  testsDir: string;
  /** Override for the runs directory. Empty string = use default. */
  runsDir: string;
  /** Override for the auth directory. Empty string = use default. */
  authDir: string;
  /** Override for the artifacts directory. Empty string = use default. */
  artifactsDir: string;
  /** Override for the exports directory. Empty string = use default. */
  exportsDir: string;
  /** Last-used environment (Issue #3). */
  lastEnvironment: string;
  /** Last-used browser (Issue #3). */
  lastBrowser: BrowserType;
  /** Whether headed mode was last enabled (Issue #3). */
  lastHeaded: boolean;
  /** Last-used auth profile (Issue #3). */
  lastAuthProfile: string;
  /** Last-used tool policy (Issue #3). */
  lastToolPolicy: ToolPolicy;
  /** Default retry count for test/step execution (Issue #23). */
  retryCount: number;
  /** Default retry mode: retry per step or per test (Issue #23). */
  retryMode: "step" | "test";
  /** OpenAI-compatible API base URL, e.g. https://api.openai.com/v1 (Issue #5). */
  llmEndpoint: string;
  /** API key for the LLM provider. Never sent to the LLM payload (Issue #5). */
  llmApiKey: string;
  /** Model name, e.g. gpt-4o (Issue #5). */
  llmModel: string;
  createdAt: string;
  updatedAt: string;
}
