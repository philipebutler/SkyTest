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
  createdAt: string;
  updatedAt: string;
}

export interface StepResult {
  stepIndex: number;
  action: string;
  status: "passed" | "failed" | "skipped";
  error?: string;
  artifactIds: string[];
  durationMs: number;
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
  artifacts: Artifact[];
  startedAt: string;
  finishedAt?: string;
}

export type ToolPolicy = "read-only" | "safe-write" | "full";

export type BrowserType = "chromium" | "firefox" | "webkit";

export interface RunConfig {
  command: string;
  environment: string;
  browser: BrowserType;
  headed: boolean;
  toolPolicy: ToolPolicy;
  authProfile?: string;
}

export interface SaveTestPayload {
  name: string;
  /** Raw chat transcript captured as steps */
  steps: ActionStep[];
}

// Typed IPC contracts (SPEC §6.1)
export type IpcRequest =
  | { type: "ExecuteCommand"; payload: RunConfig }
  | { type: "ExecuteTest"; payload: { testId: string } }
  | { type: "GetRunHistory"; payload: Record<string, never> }
  | { type: "SaveTest"; payload: SaveTestPayload }
  | { type: "ExportRun"; payload: { runId: string } }
  | { type: "UpdateSession"; payload: { environment: string } }
  | { type: "GetSettings"; payload: Record<string, never> }
  | { type: "SaveSettings"; payload: Partial<Settings> };

export type IpcChannel =
  | "executeCommand"
  | "executeTest"
  | "getRunHistory"
  | "saveTest"
  | "getSettings"
  | "saveSettings"
  | "chat:send";

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
  createdAt: string;
  updatedAt: string;
}
