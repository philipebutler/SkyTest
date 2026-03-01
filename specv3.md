# Playwright Chat Runner – SPEC v2 (Complete)

Standalone Electron-Based LLM-Assisted Test Automation Suite

-----

## 1. Purpose

This document defines the complete specification for **Playwright Chat Runner v2**, a standalone Electron-based application for:

- Exploratory automation
- User Acceptance Testing (UAT)
- Regression testing
- LLM-assisted test authoring and maintenance

The system combines:

- Human-readable intent
- LLM planning (Copilot or compatible model)
- Deterministic Playwright execution
- Explicit assertions
- Explainable, auditable results

This specification is written to eliminate ambiguity and support **Copilot-driven development**.

> **Implementation Contract:** Every section marked with a wiring requirement (§ Wiring) must have a corresponding entry in the IPC Contract (Section 16) and a GitHub Issue in Addendum B. No UI component may be considered complete until its IPC handler, data binding, and error state are implemented. No IPC handler may be considered complete until it is invoked by a UI component and returns to a rendered output.

-----

## 2. Design Principles

1. **Clarification over assumption**
1. **Deterministic execution**
1. **Explicit safety controls**
1. **Separation of intent, planning, and execution**
1. **Auditability**
1. **Local-first execution**

-----

## 3. Non-Goals (v2)

- No mobile native testing
- No desktop native testing
- No background scheduling
- No credential storage beyond local secure storage
- No autonomous destructive actions

-----

## 4. Architecture Overview

```
┌─────────────────────────────────────────────┐
│ Electron App                                │
│                                             │
│ UI (Renderer Process)                       │
│  - Chat                                    │
│  - Test Library                             │
│  - Run History                              │
│  - Record Mode                              │
│  - Settings                                 │
│                                             │
│ Main Process (Node.js)                      │
│  - LLM Orchestration                        │
│  - Test Runner                              │
│  - Playwright Executor                      │
│  - Assertion Engine                         │
│  - Artifact Manager                         │
│                                             │
│ Local File System                           │
│  - tests/                                  │
│  - runs/                                   │
│  - auth/                                   │
│  - artifacts/                              │
│  - exports/                                │
└─────────────────────────────────────────────┘
```

### 4.1 Component Ownership Table

Every component in the architecture must be owned, wired, and tested. The table below is the source of truth for what exists, where it lives, and what connects it. No component may be built without a corresponding row here being complete.

|Component          |Process |File/Module                    |IPC Channel(s)                                                         |Status|
|-------------------|--------|-------------------------------|-----------------------------------------------------------------------|------|
|Chat UI            |Renderer|`src/renderer/Chat.tsx`        |`chat:send`, `chat:stream`, `chat:save-as-test`                        |[ ]   |
|Test Library UI    |Renderer|`src/renderer/TestLibrary.tsx` |`tests:list`, `tests:get`, `tests:save`, `tests:delete`, `tests:run`   |[ ]   |
|Run History UI     |Renderer|`src/renderer/RunHistory.tsx`  |`runs:list`, `runs:get`, `runs:artifacts`                              |[ ]   |
|Record Mode UI     |Renderer|`src/renderer/RecordMode.tsx`  |`record:start`, `record:stop`, `record:refactor`                       |[ ]   |
|Settings UI        |Renderer|`src/renderer/Settings.tsx`    |`settings:get`, `settings:save`                                        |[ ]   |
|Top Bar            |Renderer|`src/renderer/TopBar.tsx`      |`topbar:env-changed`, `topbar:browser-changed`, `topbar:policy-changed`|[ ]   |
|LLM Orchestrator   |Main    |`src/main/llm/orchestrator.ts` |`chat:send` → `chat:stream`                                            |[ ]   |
|Test Runner        |Main    |`src/main/runner/testRunner.ts`|`tests:run` → `runs:progress`                                          |[ ]   |
|Playwright Executor|Main    |`src/main/runner/executor.ts`  |Called by Test Runner only                                             |[ ]   |
|Assertion Engine   |Main    |`src/main/runner/assertions.ts`|Called by Playwright Executor only                                     |[ ]   |
|Artifact Manager   |Main    |`src/main/artifacts.ts`        |`runs:artifacts`                                                       |[ ]   |
|Settings Manager   |Main    |`src/main/settings.ts`         |`settings:get`, `settings:save`                                        |[ ]   |
|Auth Manager       |Main    |`src/main/auth.ts`             |`auth:save`, `auth:load`, `auth:list`                                  |[ ]   |
|Record Engine      |Main    |`src/main/record/engine.ts`    |`record:start`, `record:stop`, `record:refactor`                       |[ ]   |
|File Store         |Main    |`src/main/store/fileStore.ts`  |Internal only                                                          |[ ]   |


> **Rule:** If a component is not in this table, it must not be built until a row is added and reviewed.

-----

## 5. UI / UX Specification (Detailed)

### 5.1 Global Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Top Bar                                                       │
│ Env ▼  Browser ▼  Headed/Headless  Auth ▼  Tool Policy ▼ Run │
├───────────────┬──────────────────────────────────────────────┤
│ Sidebar       │ Main Workspace                               │
│               │                                              │
│ • Chat        │ Dynamic content area                         │
│ • Tests       │                                              │
│ • Runs        │                                              │
│ • Record      │                                              │
│ • Settings    │                                              │
└───────────────┴──────────────────────────────────────────────┘
```

Top Bar selections apply to the **next execution only**.

**UI Wiring Rule:** Every dropdown and control in the Top Bar must dispatch an IPC event on change. The Top Bar must not store state internally — it reads from and writes to the Settings Manager via IPC. On application load, the Top Bar must request its initial state via `settings:get` and render only after receiving a response.

-----

### 5.2 Chat Mode Workflow

**User Flow**

1. User selects Chat
1. Enters natural language command
1. Presses Send
1. System sends command + enabled tools to LLM
1. LLM responds with:
- Clarifying question OR
- Action DSL plan
1. Playwright executes
1. Results returned to chat

**UI Requirements**

- Transcript view (scrollable, persists across session)
- Multi-line input (Shift+Enter for newline, Enter to send)
- “Save as Test” button (disabled until a successful execution exists in the current turn)
- Tool Policy indicator (reflects current Top Bar selection, read-only in chat)
- Streaming response display (renders tokens as they arrive via `chat:stream`)
- Error state: LLM failure, DSL validation failure, and execution failure must each render a distinct inline error with a retry affordance

**§ Wiring — Chat UI must:**

- Send `chat:send` with `{ prompt: string, toolPolicy: ToolPolicy, environment: string, browser: BrowserType }` on submit
- Listen on `chat:stream` for `{ token: string, done: boolean }` and append to transcript
- Send `chat:save-as-test` with the last successful DSL plan when “Save as Test” is clicked
- Receive and display `{ error: ChatError }` as an inline message, never as a modal

-----

### 5.3 Test Library Workflow

**User Flow**

1. User selects Tests
1. Views folder/tag tree
1. Selects or creates test
1. Edits steps/assertions
1. Saves test
1. Runs test

**UI Requirements**

- Folder structure (reflects `tests/` directory on disk)
- Tag filtering (multi-select, AND logic between tags)
- Test metadata editor (name, description, tags — inline edit)
- Assertion builder (visual form, one assertion per row, add/remove/reorder)
- JSON/DSL editor (advanced toggle, raw ActionStep[] and Assertion[] editing)
- Empty state when no tests exist (prompt to create or import)

**§ Wiring — Test Library UI must:**

- Request `tests:list` on mount and render the result; show loading and empty states
- Request `tests:get` with `{ id: string }` when a test is selected; render only after response
- Send `tests:save` with a complete `TestCase` object on save; display inline success/error
- Send `tests:delete` with `{ id: string }` after confirmation dialog; remove from list on success
- Send `tests:run` with `{ id: string, environment: string, browser: BrowserType }` on run; navigate to Run History after dispatch
- The assertion builder must be the canonical editing surface; the JSON editor is a secondary toggle and must write back to the same `TestCase` object

-----

### 5.4 Run History Workflow

**User Flow**

1. User selects Runs
1. Views list of runs
1. Selects a run
1. Reviews summary
1. Drills into steps

**UI Requirements**

- Status icons (passed/failed/running)
- Filters (by status, date range, browser, environment)
- Timeline view (step sequence with durations)
- Artifact viewer (screenshots inline, traces as download link)
- Empty state when no runs exist

**§ Wiring — Run History UI must:**

- Request `runs:list` on mount with optional filter params; re-request when filters change
- Request `runs:get` with `{ id: string }` when a run is selected
- Request `runs:artifacts` with `{ runId: string, stepIndex: number }` when a step is expanded
- Subscribe to `runs:progress` to update a live run in real time without a full re-fetch
- Never render artifact data that is not returned from the Artifact Manager; do not construct file paths in the renderer

-----

### 5.5 Settings Workflow

Sections:

- Environments (name, base URL, add/remove)
- Browsers (default browser selection)
- Auth profiles (name, storageState path, environment binding)
- Tool policies (per-environment policy override)
- Export settings (output format, export path)

**§ Wiring — Settings UI must:**

- Request `settings:get` on mount and populate all fields from the response
- Send `settings:save` with the full settings object on save; do not send partial updates
- Validate all fields client-side before sending; display inline validation errors
- Auth profile save must call `auth:save` separately from general settings save

-----

## 6. Action DSL Specification

The Action DSL is the canonical interchange format between the LLM planner and the Playwright Executor. The LLM must only output valid DSL. The Executor must only accept DSL — it never receives raw natural language.

### 6.1 DSL Structure

```ts
interface DSLPlan {
  version: "1";
  intent: string;           // Human-readable summary of the plan
  steps: ActionStep[];
}

interface ActionStep {
  action: ActionVerb;
  selector?: string;        // CSS or text selector
  value?: string;           // Input value, URL, etc.
  timeout?: number;         // Override default 30s
  optional?: boolean;       // If true, failure does not halt execution
}

type ActionVerb =
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
```

### 6.2 DSL Verb Reference

|Verb               |Required Fields      |Optional Fields             |Description                                               |
|-------------------|---------------------|----------------------------|----------------------------------------------------------|
|`navigate`         |`value` (URL)        |`timeout`                   |Navigate to a URL                                         |
|`click`            |`selector`           |`timeout`                   |Click an element                                          |
|`fill`             |`selector`, `value`  |`timeout`                   |Clear and fill an input                                   |
|`select`           |`selector`, `value`  |`timeout`                   |Select option by value or label                           |
|`check`            |`selector`           |`timeout`                   |Check a checkbox                                          |
|`uncheck`          |`selector`           |`timeout`                   |Uncheck a checkbox                                        |
|`hover`            |`selector`           |`timeout`                   |Hover over an element                                     |
|`wait`             |`value` (ms)         |—                           |Static wait (discouraged; LLM must prefer waitForSelector)|
|`waitForSelector`  |`selector`           |`timeout`                   |Wait until element is present                             |
|`waitForNavigation`|—                    |`timeout`                   |Wait for next navigation event                            |
|`scroll`           |`selector`           |`value` (direction: up/down)|Scroll element or page                                    |
|`screenshot`       |—                    |`value` (filename)          |Capture screenshot to artifact                            |
|`assert`           |`selector` or `value`|—                           |Inline assertion (see Section 9)                          |

### 6.3 DSL Validation

Before execution, the DSL Validator must:

- Confirm `version` is `"1"`
- Confirm all `action` values are in the ActionVerb enum
- Confirm required fields per verb are present
- Confirm `selector` is not empty when required
- Confirm `value` is a valid URL when `action` is `"navigate"`
- Return a `DSLValidationResult` with a list of all errors; do not fail on first error

```ts
interface DSLValidationResult {
  valid: boolean;
  errors: Array<{ stepIndex: number; message: string }>;
}
```

If validation fails, execution must not begin. The validation result must be returned to the Chat UI or Test Runner as an inline error.

### 6.4 DSL Example

```json
{
  "version": "1",
  "intent": "Log in and verify dashboard is visible",
  "steps": [
    { "action": "navigate", "value": "https://app.example.com/login" },
    { "action": "fill", "selector": "#email", "value": "user@example.com" },
    { "action": "fill", "selector": "#password", "value": "hunter2" },
    { "action": "click", "selector": "button[type=submit]" },
    { "action": "waitForSelector", "selector": ".dashboard-header", "timeout": 10000 },
    { "action": "assert", "selector": ".dashboard-header", "value": "textVisible" }
  ]
}
```

-----

## 7. Tool Policy System

Policies:

- **Read-only** — navigation, assertions, screenshots only; no fill, click, check, or scroll
- **Safe-write** — all read-only actions plus click, fill, check, uncheck, hover, scroll; no destructive operations (delete, submit on forms marked destructive)
- **Full** — all DSL verbs permitted

Rules:

- LLM receives the active policy in its system prompt on every request
- LLM may only include verbs permitted by the active policy
- DSL Validator enforces policy during validation; a policy violation is a validation error, not a runtime error
- Violations must be surfaced before execution with the offending step(s) identified

-----

## 8. Authentication Strategy

Primary:

- Manual login + `storageState.json`

Secondary:

- Service account (optional)

Rules:

- Credentials never sent to LLM
- Sessions scoped per environment
- `storageState.json` files stored under `auth/<profile-name>/storageState.json`
- Session expiry handling: before each test run, the Auth Manager checks the `cookies` array in `storageState.json` for expired entries. If any are expired, the runner emits a `runs:auth-expired` event and halts. The UI must display a prompt to re-authenticate.
- Auth profiles are managed in Settings; the selected profile is passed to the Playwright Executor at run time via the IPC payload, not stored in the DSL

-----

## 9. Core Data Models

### 9.1 TestCase

```ts
interface TestCase {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  engine: "playwright";
  preconditions: ActionStep[];
  steps: ActionStep[];
  assertions: Assertion[];
  teardown: ActionStep[];   // Cleanup steps; always run, even on failure
  createdAt: string;
  updatedAt: string;
}
```

### 9.2 Run

```ts
interface Run {
  id: string;
  testIds: string[];
  environment: string;
  browser: "chromium" | "firefox" | "webkit";
  status: "pending" | "running" | "passed" | "failed" | "aborted";
  startedAt: string;
  finishedAt?: string;
  authProfile?: string;
  workerCount: number;      // Always 1 in MVP; reserved for future parallelism
}
```

### 9.3 StepResult

```ts
interface StepResult {
  index: number;
  action: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  artifacts: string[];
  errorMessage?: string;    // Present when status is "failed"
  retryCount: number;       // 0 if no retry occurred
}
```

### 9.4 Assertion

```ts
interface Assertion {
  type: AssertionType;
  selector?: string;
  expected?: string;
  negate?: boolean;
}

type AssertionType =
  | "textVisible"
  | "elementVisible"
  | "urlContains"
  | "countEquals"
  | "screenshotMatches";   // Future; must throw NotImplemented in v2
```

### 9.5 Settings

```ts
interface AppSettings {
  environments: Environment[];
  defaultBrowser: BrowserType;
  defaultToolPolicy: ToolPolicy;
  exportPath: string;
  exportFormat: "json" | "junit";
  authProfiles: AuthProfile[];
}

interface Environment {
  id: string;
  name: string;
  baseUrl: string;
  toolPolicyOverride?: ToolPolicy;
}

interface AuthProfile {
  id: string;
  name: string;
  environmentId: string;
  storageStatePath: string;
}

type BrowserType = "chromium" | "firefox" | "webkit";
type ToolPolicy = "read-only" | "safe-write" | "full";
```

-----

## 10. Assertion Engine

Supported assertions in v2:

|Type               |Selector Required|Expected Value         |Description                                     |
|-------------------|-----------------|-----------------------|------------------------------------------------|
|`textVisible`      |Yes              |Yes (the text)         |Element contains the expected text              |
|`elementVisible`   |Yes              |No                     |Element exists and is visible                   |
|`urlContains`      |No               |Yes (substring)        |Current URL contains substring                  |
|`countEquals`      |Yes              |Yes (integer as string)|Count of matching elements equals expected      |
|`screenshotMatches`|No               |No                     |**Not implemented in v2; throws NotImplemented**|

**Failure behavior:**

- By default, an assertion failure halts step execution for that test and marks the run as failed
- If `negate: true`, the assertion logic is inverted
- All assertion results are appended to `StepResult.artifacts` as a JSON summary
- The Assertion Engine never throws unhandled exceptions; all errors are caught and returned as `StepResult` with `status: "failed"` and `errorMessage` populated

-----

## 11. LLM Behavior Rules

### 11.1 Output Contract

- The LLM must output either a `DSLPlan` object (valid JSON) or a clarifying question (plain text prefixed with `CLARIFY:`)
- The LLM must not emit code, comments, markdown fences, or any content outside these two forms
- If the LLM cannot produce a valid plan due to policy constraints, it must respond with `CLARIFY:` and explain which tools are unavailable

### 11.2 Context Sent to LLM

Every LLM request must include:

```ts
interface LLMRequest {
  systemPrompt: string;     // See 11.3
  userMessage: string;
  toolPolicy: ToolPolicy;
  allowedVerbs: ActionVerb[];   // Derived from toolPolicy
  environment: string;
  baseUrl: string;
  priorSteps?: ActionStep[];    // For multi-turn refinement
}
```

Credentials, auth tokens, and `storageState` paths must never appear in `LLMRequest`.

### 11.3 System Prompt Template

```
You are a test automation planner. Your job is to convert user intent into a valid DSL plan.

Rules:
- Output only valid JSON conforming to DSLPlan v1, or a clarifying question prefixed with CLARIFY:
- Do not emit code, markdown, or explanation
- Only use verbs from this list: {{allowedVerbs}}
- If intent is ambiguous, output CLARIFY: followed by your question
- The base URL for this session is: {{baseUrl}}
- Do not guess at selectors; use descriptive selectors the user would recognize
```

### 11.4 LLM Adapter Interface

To support Copilot and other models, the LLM layer must use an adapter pattern:

```ts
interface LLMAdapter {
  complete(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest, onToken: (token: string) => void): Promise<LLMResponse>;
}

interface LLMResponse {
  type: "plan" | "clarification" | "error";
  content: DSLPlan | string;
  rawText: string;          // Always populated for audit
  tokensUsed?: number;
}
```

Implementations: `CopilotAdapter`, `OpenAIAdapter`. The active adapter is selected from Settings.

### 11.5 Malformed Output Handling

If the LLM returns content that is neither valid JSON nor a `CLARIFY:` prefix:

1. Log `rawText` to the run artifact store
1. Return `LLMResponse` with `type: "error"`
1. Surface the error inline in the Chat UI with a retry button
1. Do not attempt to parse or execute the malformed content

-----

## 12. Error Handling

### 12.1 Error Categories

|Category               |Source             |UI Behavior                       |Recovery                           |
|-----------------------|-------------------|----------------------------------|-----------------------------------|
|`DSLValidationError`   |DSL Validator      |Inline in chat or test editor     |Edit and retry                     |
|`PolicyViolationError` |DSL Validator      |Inline with offending steps listed|Change policy or edit plan         |
|`LLMError`             |LLM Adapter        |Inline with retry button          |Retry or rephrase                  |
|`ExecutionError`       |Playwright Executor|Inline in step result             |Artifacts captured; retry available|
|`AuthExpiredError`     |Auth Manager       |Modal blocking run                |Re-authenticate in Settings        |
|`SelectorNotFoundError`|Playwright Executor|Inline in step result             |Artifacts captured                 |
|`AssertionFailure`     |Assertion Engine   |Inline in step result             |Review artifact                    |
|`StorageError`         |File Store         |Toast notification                |Check disk space/permissions       |

### 12.2 Error Handling Rules

- Every IPC handler must return either a typed result or a typed error; handlers must never reject without a payload
- The renderer must handle both success and error shapes for every IPC channel
- No unhandled promise rejections are permitted in the main process; all must be caught and emitted as typed errors
- Retry logic in the Playwright Executor: on `SelectorNotFoundError`, retry the step up to 2 times with a 500ms delay before marking as failed

-----

## 13. Acceptance Criteria (Global)

- Tests are repeatable
- Failures produce artifacts
- UI workflows are deterministic
- No secrets exposed
- Exports are reproducible
- Every UI component renders a meaningful empty state and loading state
- Every IPC channel has a corresponding handler; no channel is declared without an implementation
- Every error category in Section 12 is handled in the UI

-----

## 14. MVP Roadmap

### MVP1

- Electron shell with IPC layer
- Top Bar (all controls wired)
- Chat execution (send, stream, display)
- Browser selection
- Manual auth
- Action DSL v1 (all verbs)
- DSL Validator
- LLM Adapter (Copilot)
- Settings (environments, browser, policy)

### MVP2

- Test library (CRUD, assertion builder)
- Assertions (all v2 types)
- Run history (list, detail, artifacts)
- Auth profile management
- Session expiry handling

### MVP3

- Record mode
- Flake detection and retry
- CI exports (JUnit)
- OpenAI adapter

> **MVP Completion Rule:** An MVP is not complete until every component in Section 4.1 assigned to that MVP has its Status marked complete, its IPC channels are listed in Section 16, and its GitHub Issue in Addendum B is closed.

-----

## 15. Addendum A – Record Mode Technical Spec

**Purpose**
Rapid capture of user flows.

**Implementation**

- Playwright event listeners
- Capture:
  - navigation
  - clicks
  - inputs
  - candidate selectors
- Save as raw recording
- LLM refactors into TestCase

**§ Wiring — Record Mode must:**

- `record:start` launches a headed browser with event listeners attached; emits `record:event` for each captured action
- `record:stop` closes the browser and returns the raw `ActionStep[]` array
- `record:refactor` sends the raw steps to the LLM Orchestrator with a special system prompt requesting cleanup; returns a `TestCase`
- The Record Mode UI must display captured steps in real time as `record:event` messages arrive; it must not wait for `record:stop`

-----

## 16. IPC Contract

This section is the authoritative list of all IPC channels. No channel may be used in the renderer or handled in the main process unless it is defined here. Channels added during development must be added here first.

|Channel                 |Direction      |Payload (→ Main)                                         |Response (→ Renderer)                         |Handler Module         |
|------------------------|---------------|---------------------------------------------------------|----------------------------------------------|-----------------------|
|`chat:send`             |Renderer → Main|`{ prompt, toolPolicy, environment, browser }`           |`{ streamId }`                                |`llm/orchestrator.ts`  |
|`chat:stream`           |Main → Renderer|—                                                        |`{ streamId, token, done }`                   |Pushed by orchestrator |
|`chat:save-as-test`     |Renderer → Main|`{ plan: DSLPlan, name: string }`                        |`{ testId }` or `{ error }`                   |`store/fileStore.ts`   |
|`tests:list`            |Renderer → Main|`{ tags?: string[] }`                                    |`TestCase[]` or `{ error }`                   |`store/fileStore.ts`   |
|`tests:get`             |Renderer → Main|`{ id: string }`                                         |`TestCase` or `{ error }`                     |`store/fileStore.ts`   |
|`tests:save`            |Renderer → Main|`TestCase`                                               |`{ id }` or `{ error }`                       |`store/fileStore.ts`   |
|`tests:delete`          |Renderer → Main|`{ id: string }`                                         |`{ ok }` or `{ error }`                       |`store/fileStore.ts`   |
|`tests:run`             |Renderer → Main|`{ id, environment, browser, authProfile? }`             |`{ runId }` or `{ error }`                    |`runner/testRunner.ts` |
|`runs:list`             |Renderer → Main|`{ status?, browser?, environment?, dateFrom?, dateTo? }`|`Run[]` or `{ error }`                        |`store/fileStore.ts`   |
|`runs:get`              |Renderer → Main|`{ id: string }`                                         |`Run & { steps: StepResult[] }` or `{ error }`|`store/fileStore.ts`   |
|`runs:progress`         |Main → Renderer|—                                                        |`{ runId, stepIndex, result: StepResult }`    |Pushed by testRunner   |
|`runs:artifacts`        |Renderer → Main|`{ runId, stepIndex }`                                   |`{ paths: string[] }` or `{ error }`          |`artifacts.ts`         |
|`settings:get`          |Renderer → Main|—                                                        |`AppSettings` or `{ error }`                  |`settings.ts`          |
|`settings:save`         |Renderer → Main|`AppSettings`                                            |`{ ok }` or `{ error }`                       |`settings.ts`          |
|`auth:save`             |Renderer → Main|`AuthProfile`                                            |`{ ok }` or `{ error }`                       |`auth.ts`              |
|`auth:load`             |Renderer → Main|`{ profileId: string }`                                  |`{ storageStatePath }` or `{ error }`         |`auth.ts`              |
|`auth:list`             |Renderer → Main|—                                                        |`AuthProfile[]` or `{ error }`                |`auth.ts`              |
|`record:start`          |Renderer → Main|`{ environment, browser }`                               |`{ ok }` or `{ error }`                       |`record/engine.ts`     |
|`record:stop`           |Renderer → Main|—                                                        |`{ steps: ActionStep[] }` or `{ error }`      |`record/engine.ts`     |
|`record:event`          |Main → Renderer|—                                                        |`ActionStep`                                  |Pushed by record engine|
|`record:refactor`       |Renderer → Main|`{ steps: ActionStep[] }`                                |`TestCase` or `{ error }`                     |`llm/orchestrator.ts`  |
|`topbar:env-changed`    |Renderer → Main|`{ environmentId }`                                      |`{ ok }`                                      |`settings.ts`          |
|`topbar:browser-changed`|Renderer → Main|`{ browser: BrowserType }`                               |`{ ok }`                                      |`settings.ts`          |
|`topbar:policy-changed` |Renderer → Main|`{ policy: ToolPolicy }`                                 |`{ ok }`                                      |`settings.ts`          |

-----

## 17. Addendum B – GitHub Issues (Initial Backlog)

### Epic: Core Application

- [ ] Electron shell setup — main + renderer processes, preload script, context isolation
- [ ] IPC messaging layer — register all channels from Section 16; stub all handlers at project start
- [ ] Persistent storage layout — create `tests/`, `runs/`, `auth/`, `artifacts/`, `exports/` on first launch
- [ ] File Store module — CRUD for TestCase and Run; all methods must return typed results, never throw

### Epic: Top Bar

- [ ] Top Bar UI — all controls render and dispatch IPC on change
- [ ] Top Bar wiring — `topbar:env-changed`, `topbar:browser-changed`, `topbar:policy-changed` handlers
- [ ] Top Bar initial state — loads from `settings:get` on app launch

### Epic: Chat & LLM

- [ ] Chat UI — transcript, input, streaming display, error states
- [ ] Chat wiring — `chat:send`, `chat:stream`, `chat:save-as-test`
- [ ] LLM Adapter interface — `LLMAdapter` base with `complete` and `stream`
- [ ] Copilot adapter — implements `LLMAdapter`
- [ ] DSL validation — `DSLValidationResult` returned before any execution
- [ ] System prompt template — with `{{allowedVerbs}}` and `{{baseUrl}}` substitution
- [ ] Malformed LLM output handling — log, surface inline error, retry button

### Epic: Playwright Runner

- [ ] Browser selection — Chromium, Firefox, WebKit via IPC payload
- [ ] Tool policy enforcement — DSL Validator checks verbs against active policy
- [ ] Artifact capture — screenshot on failure, trace on full policy
- [ ] Selector not found retry — 2 retries, 500ms delay, then StepResult failed
- [ ] Teardown execution — always runs after steps, even on failure

### Epic: Assertion Engine

- [ ] `textVisible` assertion
- [ ] `elementVisible` assertion
- [ ] `urlContains` assertion
- [ ] `countEquals` assertion
- [ ] `screenshotMatches` stub — throws NotImplemented with clear message
- [ ] Negate support — `negate: true` inverts any assertion

### Epic: Test Management

- [ ] Test Library UI — folder/tag tree, empty state, loading state
- [ ] Test list wiring — `tests:list` with tag filter
- [ ] Test detail wiring — `tests:get` on selection
- [ ] Test save wiring — `tests:save` with inline success/error
- [ ] Test delete wiring — `tests:delete` with confirmation dialog
- [ ] Assertion builder UI — add/remove/reorder, all v2 assertion types
- [ ] JSON/DSL editor toggle — writes back to same TestCase object
- [ ] Teardown step editor — same UI as preconditions

### Epic: Run History

- [ ] Run History UI — list with status icons, filters, empty state
- [ ] Run list wiring — `runs:list` with filter params
- [ ] Run detail wiring — `runs:get` on selection
- [ ] Live run updates — subscribe to `runs:progress`, update without re-fetch
- [ ] Artifact viewer — inline screenshots, trace download link
- [ ] `runs:artifacts` wiring — paths from Artifact Manager only

### Epic: Auth

- [ ] Auth profile CRUD — `auth:save`, `auth:load`, `auth:list`
- [ ] Session expiry check — before each run; emits `runs:auth-expired`
- [ ] Auth expired UI — modal blocking run, link to Settings

### Epic: Settings

- [ ] Settings UI — all sections rendered
- [ ] Settings load wiring — `settings:get` on mount
- [ ] Settings save wiring — `settings:save` with full object
- [ ] Client-side validation — inline errors before send

### Epic: Record Mode

- [ ] Capture engine — event listeners, `record:event` push
- [ ] Record Mode UI — real-time step display, start/stop controls
- [ ] Record wiring — `record:start`, `record:stop`, `record:refactor`
- [ ] LLM refactor pipeline — converts raw steps to TestCase

### Epic: Reporting

- [ ] Run history UI (covered in Run History epic)
- [ ] JSON export — full Run + StepResult[] to `exports/`
- [ ] JUnit XML export — MVP3

-----

## 18. Clarification Rule (Mandatory)

If any ambiguity exists in intent, tools, navigation, or data:

**The system must ask a clarifying question before proceeding.**

This rule applies equally to the LLM planner (which outputs `CLARIFY:`) and to the application itself when user input in a Settings or Test editor field is ambiguous or invalid. Clarification is always inline — never a blocking modal except for destructive or auth-related actions.
