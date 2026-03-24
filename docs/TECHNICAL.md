# SkyTest – Technical Reference

This document describes the internal architecture, data contracts, IPC protocol, module responsibilities and security model of SkyTest.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Process Boundary](#process-boundary)
3. [Directory Layout](#directory-layout)
4. [Data Contracts](#data-contracts)
5. [IPC Protocol](#ipc-protocol)
6. [Module Reference – Main Process](#module-reference--main-process)
7. [Module Reference – Renderer Process](#module-reference--renderer-process)
8. [DSL Specification](#dsl-specification)
9. [Tool Policy Enforcement](#tool-policy-enforcement)
10. [LLM Integration](#llm-integration)
11. [Auth & Session Management](#auth--session-management)
12. [Retry & Flake Handling](#retry--flake-handling)
13. [Artifact Management](#artifact-management)
14. [CI Runner](#ci-runner)
15. [Export Formats](#export-formats)
16. [Security Model](#security-model)
17. [Testing](#testing)

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│ Electron App                                │
│                                             │
│  Renderer Process (React / browser sandbox) │
│  ┌──────────────────────────────────────┐   │
│  │  Chat · TestLibrary · RunHistory     │   │
│  │  Record · Settings                   │   │
│  │  TopBar · Sidebar                    │   │
│  └──────────────────┬───────────────────┘   │
│                     │  contextBridge (IPC)  │
│  Main Process (Node.js)                     │
│  ┌──────────────────▼───────────────────┐   │
│  │  IPC handlers (ipc/handlers.ts)      │   │
│  │  LLMOrchestrator + CopilotAdapter    │   │
│  │  PlaywrightExecutor + AssertionEngine│   │
│  │  StorageService + Repositories      │   │
│  │  RecordEngine + RecordingRefactorer  │   │
│  │  RunExporter · credentialSanitizer   │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  Local File System                          │
│  tests/ · runs/ · auth/ · artifacts/        │
│  exports/ · recordings/                     │
└─────────────────────────────────────────────┘
```

---

## Process Boundary

Electron enforces a strict separation between the **renderer process** (sandboxed browser context, no Node.js access) and the **main process** (full Node.js / file system access).

Communication between the two is mediated by a **preload script** (`app/main/preload.ts`) that exposes a typed `window.skytest` bridge via Electron's `contextBridge`:

```typescript
window.skytest = {
  invoke(channel, ...args): Promise<unknown>  // request/response
  on(channel, listener): () => void           // push events (unsubscribe on return)
}
```

No raw Node.js APIs or file system paths are ever exposed to the renderer.

---

## Directory Layout

```
/app
  /main
    index.ts                 # Electron app entry – init storage, create window, register IPC
    preload.ts               # contextBridge definition
    /ipc
      handlers.ts            # Registers all ipcMain.handle() and ipcMain.on() listeners
    /llm
      LLMAdapter.ts          # Abstract adapter interface
      CopilotAdapter.ts      # OpenAI-compatible HTTP streaming adapter
      LLMOrchestrator.ts     # Prompt building, response classification, stream relay
      credentialSanitizer.ts # Regex-based secret redaction
    /runner
      PlaywrightExecutor.ts  # Browser launch, step execution, retry logic, artifact capture
      AssertionEngine.ts     # Post-run assertion evaluation
      CIRunner.ts            # Headless CLI entry point
    /storage
      StorageService.ts      # File-system layout, settings persistence, path resolution
      TestCaseRepository.ts  # CRUD for TestCase JSON files
      RunRepository.ts       # CRUD for Run JSON files
      RunExporter.ts         # Markdown, JSON and JUnit XML export
    /validation
      dslValidator.ts        # Schema validation and tool policy enforcement
    /record
      RecordEngine.ts        # Playwright CDP-based event capture
      RecordingRefactorer.ts # LLM-assisted recording cleanup
  /renderer
    index.tsx                # React root
    App.tsx                  # Shell layout, config state, screen routing
    /components
      TopBar.tsx             # Environment, browser, headed, auth, policy, Run button
      Sidebar.tsx            # Screen navigation
    /screens
      Chat.tsx               # Chat transcript, LLM streaming, Save as Test
      TestLibrary.tsx        # Test list, visual builder, quick wizard presets, raw JSON editor, run inline
      RunHistory.tsx         # Run list, filters, step timeline, export
      Record.tsx             # Record start/stop, refactor, save
      Settings.tsx           # All persistent settings, auth session update
  /shared
    types.ts                 # All shared TypeScript interfaces and type aliases
```

---

## Data Contracts

All shared types are defined in `app/shared/types.ts`. Each persisted file includes a `schemaVersion` field (currently `"1"`).

### TestCase

```typescript
interface TestCase {
  schemaVersion: string;       // "1"
  id: string;                  // UUID
  name: string;
  tags: string[];
  preconditions: ActionStep[];
  steps: ActionStep[];
  assertions: Assertion[];
  browser?: BrowserType;
  retryCount?: number;
  retryMode?: "step" | "test";
  createdAt: string;           // ISO 8601
  updatedAt: string;           // ISO 8601
}
```

### Run

```typescript
interface Run {
  schemaVersion: string;       // "1"
  id: string;                  // UUID or CI run ID
  testId?: string;             // References a TestCase.id
  environment: string;
  browser: string;
  headed: boolean;
  toolPolicy: ToolPolicy;
  status: "running" | "passed" | "failed" | "aborted";
  stepResults: StepResult[];
  assertionResults?: AssertionResult[];
  artifacts: Artifact[];
  startedAt: string;           // ISO 8601
  finishedAt?: string;         // ISO 8601
  testAttempts?: number;       // Populated when retryMode is "test"
}
```

### StepResult

```typescript
interface StepResult {
  stepIndex: number;
  action: string;
  status: "passed" | "failed" | "skipped";
  error?: string;
  artifactIds: string[];
  durationMs: number;
  retryAttempts?: RetryAttempt[];
}
```

### Artifact

```typescript
interface Artifact {
  id: string;
  type: "screenshot" | "log" | "html" | "har";
  path: string;               // Absolute path on disk
  createdAt: string;          // ISO 8601
  stepIndex?: number;
}
```

### DSLPlan

```typescript
interface DSLPlan {
  version: "1";
  intent: string;
  steps: ActionStep[];
}
```

### ActionStep

```typescript
interface ActionStep {
  action: string;             // One of the supported ActionVerb values
  selector?: string;
  value?: string;
  url?: string;
  timeout?: number;           // Milliseconds; defaults to 30 000
  optional?: boolean;
}
```

### Settings

```typescript
interface Settings {
  schemaVersion: string;
  testsDir: string;           // Empty = use default userData sub-directory
  runsDir: string;
  authDir: string;
  artifactsDir: string;
  exportsDir: string;
  lastEnvironment: string;
  lastBrowser: BrowserType;
  lastHeaded: boolean;
  lastAuthProfile: string;
  lastToolPolicy: ToolPolicy;
  retryCount: number;
  retryMode: "step" | "test";
  llmEndpoint: string;        // OpenAI-compatible base URL
  llmApiKey: string;          // Never logged or sent to LLM
  llmModel: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## IPC Protocol

All renderer ↔ main communication uses the `window.skytest` bridge.

### Request / response channels (`invoke`)

| Channel | Payload | Returns | Description |
|---------|---------|---------|-------------|
| `chat:send` | `ChatSendPayload` | `{ streamId: string }` | Start an LLM streaming session |
| `executeCommand` | `RunConfig` | `Run` | Execute a DSL command directly |
| `executeTest` | `{ testId: string }` | `Run` | Run a saved TestCase by ID |
| `getRunHistory` | `{}` | `Run[]` | List all Run records |
| `saveTest` | `SaveTestPayload` | `TestCase` | Save a new TestCase |
| `updateTest` | `{ testId: string; rawJson: string }` | `TestCase` | Update an existing TestCase from raw JSON |
| `validateTestDraft` | `{ steps: ActionStep[]; toolPolicy: ToolPolicy }` | `TestEditorValidationState` | Validate schema + tool policy for builder preview without execution |
| `convertLegacyChatSteps` | `{ steps: ActionStep[] }` | `{ converted: boolean; steps: ActionStep[] }` | Preview-convert legacy `action:"chat"` steps |
| `listTests` | `{}` | `TestCase[]` | List all TestCase records |
| `deleteTest` | `{ testId: string }` | `void` | Delete a TestCase |
| `exportRun` | `{ runId: string }` | `{ markdown: string; json: string }` | Export a run |
| `getSettings` | `{}` | `Settings` | Get the current settings |
| `saveSettings` | `Partial<Settings>` | `Settings` | Patch and persist settings |
| `auth:updateSession` | `{ environment: string }` | `{ saved: boolean; path: string }` | Launch headed browser for manual login |
| `auth:listProfiles` | `{}` | `string[]` | List saved auth profile names |
| `record:start` | `{}` | `void` | Start recording |
| `record:stop` | `{}` | `RawRecording` | Stop recording and return the raw recording |
| `record:refactor` | `{ recordingId: string }` | `RefactoredRecording` | LLM-refactor a recording |

### Push channels (`on`)

| Channel | Payload | Direction | Description |
|---------|---------|-----------|-------------|
| `chat:stream` | `LLMStreamToken` | main → renderer | Streams LLM tokens as they arrive |
| `chat:executionError` | `{ reason: string; errors: ValidationError[] }` | main → renderer | Notifies the renderer that execution was blocked |

---

## Module Reference – Main Process

### `ipc/handlers.ts`

Registers all `ipcMain.handle()` and `ipcMain.on()` listeners. This is the single wiring point between IPC channels and business-logic modules. Each handler:

1. Reads payload from the IPC event.
2. Delegates to the appropriate service (orchestrator, executor, repository, etc.).
3. Returns a serialisable result or throws a typed error.

### `renderer/screens/TestLibrary.tsx`

The Tests screen now provides three editing modes in the detail panel:

- **Visual Builder**: schema-driven step and assertion editing with inline validation.
- **Quick Wizard**: guided test creation for non-DSL users, including richer presets for common flows (search and login).
- **Raw JSON**: direct JSON editing for advanced users.

Visual Builder step cards support drag-and-drop reordering in the renderer before persistence. Save and run actions continue using existing IPC channels (`saveTest`, `updateTest`, `executeTest`, `executeDSLPlan` for drafts).

Validation UX in Visual Builder includes:

- Live validation banner (ready/error state)
- Per-error one-click **Fix** suggestions
- Banner-level **Fix All** for common validation issues
- **Undo Fix** to revert the most recent auto-fix operation

Raw JSON mode supports a draft-safe update path: invalid/raw edits can be saved as draft metadata (`TestCase.uiDraft`) while preserving current executable `steps` until a valid apply is performed.

### `llm/LLMAdapter.ts`

Abstract interface for LLM providers:

```typescript
interface LLMAdapter {
  stream(request: LLMRequest, onToken: (token: string) => void): Promise<LLMResponse>;
}
```

### `llm/CopilotAdapter.ts`

Concrete `LLMAdapter` implementation for any OpenAI-compatible `/chat/completions` endpoint. Reads `llmEndpoint`, `llmApiKey` and `llmModel` from `StorageService`. Uses `fetch` with `stream: true` and server-sent events (SSE) to forward tokens to the caller as they arrive.

### `llm/LLMOrchestrator.ts`

Coordinates the full chat:send lifecycle:

1. Resolves allowed verbs from the tool policy.
2. Builds a `LLMRequest` (system prompt + user message; no credentials).
3. Streams tokens to the renderer via `sender.send("chat:stream", …)`.
4. Classifies the completed response as `plan | clarification | error`.
5. Sends a terminal `done=true` token carrying the `responseType`.
6. Logs the redacted raw text for audit.

### `llm/credentialSanitizer.ts`

Exports `redactSecrets(text: string): string`. Uses a set of regex patterns to replace API keys, bearer tokens, passwords and other secrets with `[REDACTED]`. Applied to all log output and LLM prompt construction.

### `runner/PlaywrightExecutor.ts`

Launches the browser, executes a `DSLPlan` step-by-step and returns an `ExecutionResult`:

- **Browser selection:** `chromium` (default), `firefox` or `webkit`.
- **Headed mode:** controlled by the `headed` parameter.

### Legacy `action: "chat"` step migration

For backward compatibility, `executeTest` detects legacy saved steps using `action: "chat"` and converts each chat command into canonical DSL steps through the configured LLM adapter before Playwright execution.
- **Storage state:** if a valid `storageState.json` path is provided it is applied to the browser context before the first page is opened.
- **Step execution:** each `ActionStep` is dispatched via a `switch` on `step.action`.
- **Failure handling:** a full-page screenshot is captured on every step failure.
- **Retry:** supports per-step retry (`retryMode: "step"`) and per-test retry (`retryMode: "test"`); retry attempts are recorded in `StepResult.retryAttempts`.

### `runner/AssertionEngine.ts`

Evaluates `Assertion[]` against an open Playwright `Page` after all steps complete.

| Assertion type | Implementation |
|---------------|----------------|
| `textVisible` | `page.waitForFunction` checking `document.body.innerText.includes(value)` |
| `elementVisible` | `page.waitForSelector(selector, { state: "visible" })` |
| `urlContains` | `page.url().includes(value)` |
| `countEquals` | `page.locator(selector).count()` equals `count` |

### `runner/CIRunner.ts`

Standalone Node.js CLI that runs a TestCase JSON file without the Electron UI. See [CI Runner](#ci-runner).

### `storage/StorageService.ts`

Singleton. Initialised once in `main/index.ts` via `StorageService.init()`.

Responsibilities:
- Resolves all data directories (default or user-overridden).
- Creates missing directories on startup (idempotent).
- Loads and persists `settings.json`.
- Provides `getStorageStatePath(profile)` and `listAuthProfiles()`.

Path sanitisation: `getStorageStatePath` replaces any non-alphanumeric character with `_` before constructing the file path to prevent directory traversal.

### `storage/TestCaseRepository.ts`

CRUD operations for `TestCase` JSON files stored in `testsDir`.

| Method | Behaviour |
|--------|-----------|
| `save(tc)` | Writes `<testsDir>/<id>.json` |
| `list()` | Reads and parses all `.json` files in `testsDir` |
| `get(id)` | Reads a single file |
| `delete(id)` | Deletes the file |

### `storage/RunRepository.ts`

Identical structure to `TestCaseRepository`, operating on `runsDir`.

### `storage/RunExporter.ts`

Converts a `Run` record to Markdown, JSON and JUnit XML. See [Export Formats](#export-formats).

### `validation/dslValidator.ts`

Exports two functions:

- **`validateDSL(plan: unknown): DSLValidationResult`** – schema validation (version, intent, step structure, per-verb required fields, URL validity for `navigate`).
- **`validateDSLPolicy(plan: DSLPlan, policy: ToolPolicy): DSLValidationResult`** – checks that every step action is permitted under the active policy.

Both functions collect all errors without fail-fast and return `{ valid: boolean; errors: Array<{ stepIndex: number; message: string }> }`.

### `record/RecordEngine.ts`

Attaches to a Playwright `Page` via CDP (Chrome DevTools Protocol) and records navigation, click and input events as `ActionStep` objects. Saves the raw recording as a `RawRecording` JSON file in `recordingsDir`.

### `record/RecordingRefactorer.ts`

Sends a raw `RawRecording` to the LLM with a prompt requesting a cleaned-up set of steps and suggested assertions. Returns a `RefactoredRecording` for user review before saving.

---

## Module Reference – Renderer Process

### `App.tsx`

Root component. Manages:
- Active screen state (`chat | tests | runs | record | settings`).
- `AppConfig` state (environment, browser, headed, toolPolicy, authProfile).
- Settings load on mount and persistence on every config change.
- `runTrigger` counter incremented by the TopBar Run button.
- `registerRun` callback that lets each screen register its own run handler.

### `components/TopBar.tsx`

Renders environment, browser, headed, auth profile and tool policy controls. Calls `onConfigChange` on every change. The **▶ Run** button calls `onRun`.

### `components/Sidebar.tsx`

Vertical navigation list. Calls `onNavigate` with the selected `Screen` value.

### `screens/Chat.tsx`

Manages the chat transcript. Key responsibilities:
- Sends `chat:send` via `window.skytest.invoke`.
- Subscribes to `chat:stream` push events to accumulate streamed tokens.
- Classifies the final response type (`plan | clarification | error`).
- Enforces clarification gating: when `awaitingClarification` is `true`, the next `chat:send` includes the full `chatHistory` for context.
- Listens for `chat:executionError` push events from the main process.
- `💾 Save as Test` collects all user-message commands and calls `saveTest`.

### `screens/TestLibrary.tsx`

Lists all `TestCase` records. Supports search by name/tag and tag-pill filtering. The detail panel shows all fields and a **▶ Run** button that calls `executeTest`.

### `screens/RunHistory.tsx`

Lists all `Run` records. Supports filtering by environment, browser and date. The detail panel shows the step timeline, assertion results and artifacts. The **📤 Export** button calls `exportRun`.

### `screens/Record.tsx`

Start/stop recording UI. After stopping, shows a preview of captured steps. **Refactor** calls `record:refactor`. **Save as Test** calls `saveTest` with the refactored steps.

### `screens/Settings.tsx`

Full settings form. Sections: file system paths, run defaults, LLM API configuration, retry settings, manual login / update session.

---

## DSL Specification

### Version

All DSL plans must have `"version": "1"`.

### Required top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | `"1"` | Schema version |
| `intent` | `string` | Human-readable description of the plan |
| `steps` | `ActionStep[]` | Non-empty array of steps |

### ActionStep fields

| Field | Type | Required by | Description |
|-------|------|------------|-------------|
| `action` | `ActionVerb` | all | The action to perform |
| `selector` | `string` | click, fill, select, check, uncheck, hover, waitForSelector, scroll | CSS or Playwright selector |
| `value` | `string` | navigate (URL), fill, select, wait (ms), assert | Action-specific value |
| `timeout` | `number` | — | Override default 30 000 ms timeout |
| `optional` | `boolean` | — | If `true`, a failure does not stop execution |

### Validation rules

1. `version` must equal `"1"`.
2. `intent` must be a non-empty string.
3. `steps` must be a non-empty array.
4. Each step's `action` must be a recognised `ActionVerb`.
5. `navigate` value must be a valid `http:` or `https:` URL.
6. `click`, `check`, `uncheck`, `hover`, `waitForSelector`, `scroll` require a non-empty `selector`.
7. `fill` and `select` require both a non-empty `selector` and a non-empty `value`.
8. `wait` requires a `value` that parses as a number.
9. `assert` requires at least one of `selector` or `value`.

---

## Tool Policy Enforcement

Tool policies are enforced at two layers:

1. **Prompt layer** – the LLM system prompt lists only the verbs allowed by the active policy. The LLM is instructed to ask a clarification question if it cannot complete the task with the available verbs.

2. **Validator layer** – `validateDSLPolicy` is called after `validateDSL` inside the IPC handler. If any step violates the policy, a `chat:executionError` event is pushed to the renderer and no browser is launched.

| Policy | Permitted verbs |
|--------|----------------|
| `read-only` | `navigate`, `screenshot`, `assert`, `wait`, `waitForSelector`, `waitForNavigation` |
| `safe-write` | All of `read-only` plus `click`, `fill`, `select`, `check`, `uncheck`, `hover`, `scroll` |
| `full` | All verbs, including advanced domains: keyboard, frames, tabs, dialogs, uploads/downloads, network waits, storage, cookies |

---

## LLM Integration

### System prompt structure

```
You are a test automation planner. Your job is to convert user intent into a valid DSL plan.

Rules:
- Output only valid JSON conforming to DSLPlan v1, or a clarifying question prefixed with CLARIFY:
- Do not emit code, markdown, or explanation
- Only use verbs from this list: <comma-separated allowed verbs>
- If intent is ambiguous, output CLARIFY: followed by your question
- The base URL for this session is: <redacted base URL>
- Do not guess at selectors; use descriptive selectors the user would recognize
```

### Response classification

The orchestrator classifies the raw LLM text after the stream completes:

| Raw text starts with | Classified as | Behaviour |
|---------------------|--------------|-----------|
| Valid JSON with `version: "1"` | `plan` | Validate and execute |
| `CLARIFY: ` prefix | `clarification` | Display question; block execution |
| Anything else | `error` | Display error; block execution |

### Clarification flow

1. LLM returns `CLARIFY: <question>`.
2. Renderer marks `awaitingClarification = true`.
3. User answer is appended to `chatHistory`.
4. Next `chat:send` includes the full `chatHistory`.
5. LLM uses context to produce a plan without guessing.

---

## Auth & Session Management

### storageState files

Each auth profile is a Playwright `storageState.json` saved at `auth/<profileName>.json`. The profile name is sanitised (`[^a-z0-9_-]` → `_`) before use.

### Update Session flow

1. IPC handler receives `auth:updateSession({ environment })`.
2. A headed Chromium browser is launched with no initial `storageState`.
3. The handler waits for the browser context to close (user logs in and closes the window).
4. `context.storageState()` is called and the result is written to `auth/<environment>.json`.
5. The handler returns `{ saved: true, path: <absolute path> }`.

### Using a session in a run

The `PlaywrightExecutor.execute()` method accepts an optional `storageStatePath`. When non-null and the file exists, it is passed as `storageState` in `browserInstance.newContext(options)`.

---

## Retry & Flake Handling

Retry behaviour is controlled by two settings: `retryCount` (number of additional attempts, default 0) and `retryMode` (`"step"` or `"test"`).

### Step retry (`retryMode: "step"`)

Each step is retried up to `retryCount` times before the run is marked failed. All attempts are recorded in `StepResult.retryAttempts`. The run stops at the first step that exhausts all retries.

### Test retry (`retryMode: "test"`)

If any step fails, the entire test is restarted from step 1. This repeats up to `retryCount` additional times. Each attempt is logged with an attempt number.

### RetryAttempt record

```typescript
interface RetryAttempt {
  attempt: number;      // 1-based (1 = original)
  status: "passed" | "failed";
  error?: string;
  durationMs: number;
}
```

---

## Artifact Management

### Artifact naming

| Context | Pattern |
|---------|---------|
| Step failure (UI run) | `artifact-<timestamp>-<stepIndex>[.png]` |
| Step failure (CI run) | `<runId>-step-<stepIndex>[.png]` |
| Step failure with test retry | `<runId>-step-<stepIndex>-attempt<n>[.png]` |
| Named screenshot step | `<runId>-screenshot-step-<stepIndex>[.png]` |

### Artifact record

Each artifact is registered in `Run.artifacts` with a unique `id` matching the file name (without extension) and an absolute `path`. Step results reference artifacts by ID in `StepResult.artifactIds`.

---

## CI Runner

`CIRunner` is a self-contained Node.js module (`app/main/runner/CIRunner.ts`) with no Electron dependency. It can be built with `npm run build:ci` and invoked with `node dist/ci/ci-runner.js`.

### Execution flow

1. Parse CLI arguments.
2. Load and parse the TestCase JSON file.
3. Construct a `DSLPlan` from `testCase.steps`.
4. Call `PlaywrightExecutor.execute()` with `headed=false`.
5. Optionally persist the `Run` record to `runsDir`.
6. Generate output via `RunExporter`.
7. Write output to stdout or `--out-file`.
8. Exit with code `0` (passed) or `1` (failed).

---

## Export Formats

`RunExporter` produces three formats from a single `Run` record:

### Markdown

Human-readable report with:
- Summary table (status, environment, browser, duration, tool policy)
- Per-step sections with status icon, duration, error and artifact IDs
- Assertion results
- Artifact references

### JSON

Pretty-printed full `Run` record (the same object stored on disk in `runsDir`).

### JUnit XML

CI-compatible format:
- One `<testcase>` per step and assertion
- `<failure>` elements carry the error message for failed cases
- `tests`, `failures` and `time` attributes on `<testsuite>`

---

## Security Model

| Concern | Mitigation |
|---------|-----------|
| Credentials in LLM prompts | `credentialSanitizer.ts` redacts secrets from all prompt text and log output |
| Credentials in logs | All `console.log` calls in the orchestrator pass text through `redactSecrets()` |
| API key exposure | `llmApiKey` is stored in `settings.json` (userData folder, user-only access); it is excluded from `LLMRequest` payloads |
| Path traversal in auth profiles | Profile name is sanitised with `[^a-z0-9_-]` → `_` before file path construction |
| Node.js in renderer | `contextIsolation: true` and `nodeIntegration: false` enforced in `BrowserWindow` options; only `window.skytest` bridge is exposed |
| Arbitrary code from LLM | LLM output is parsed as DSL JSON; free-form code generation is rejected by the validator |
| Destructive actions | Tool policy enforced at the validator level before any browser is launched |

---

## Testing

Unit tests are co-located with the modules they test in `app/main/**/*.test.ts`.

### Run all tests

```bash
npm test
```

### Test coverage areas

| Module | Test file |
|--------|-----------|
| DSL validator | `app/main/validation/dslValidator.test.ts` |
| Playwright executor | `app/main/runner/PlaywrightExecutor.test.ts` |
| Assertion engine | `app/main/runner/AssertionEngine.test.ts` |
| CI runner | `app/main/runner/CIRunner.test.ts` |
| Credential sanitiser | `app/main/llm/credentialSanitizer.test.ts` |
| Storage service | `app/main/storage/StorageService.test.ts` |
| TestCase repository | `app/main/storage/TestCaseRepository.test.ts` |
| Run repository | `app/main/storage/RunRepository.test.ts` |
| Run exporter | `app/main/storage/RunExporter.test.ts` |
| Record engine | `app/main/record/RecordEngine.test.ts` |
| Recording refactorer | `app/main/record/RecordingRefactorer.test.ts` |

### TypeScript type checking

```bash
npm run typecheck
```
