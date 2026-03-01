export interface ActionStep {
  action: string;
  selector?: string;
  value?: string;
  url?: string;
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

// Typed IPC contracts (SPEC §6.1)
export type IpcRequest =
  | { type: "ExecuteCommand"; payload: RunConfig }
  | { type: "ExecuteTest"; payload: { testId: string } }
  | { type: "GetRunHistory"; payload: Record<string, never> }
  | { type: "ExportRun"; payload: { runId: string } }
  | { type: "UpdateSession"; payload: { environment: string } };

export type IpcChannel = "executeCommand" | "executeTest" | "getRunHistory";
