## 1. Purpose

This specification defines **Playwright Chat Runner v2**, a standalone Electron-based application for:

- Exploratory browser automation
- User Acceptance Testing (UAT)
- Regression testing
- LLM-assisted test authoring, execution, and maintenance

The system converts **human intent → LLM planning → deterministic execution → explainable results**, while enforcing safety, auditability, and correctness.

This document is the **authoritative source of truth** for:
- Architecture
- UI/UX workflows
- Execution semantics
- Safety and governance
- Acceptance criteria

---

## 2. Core Design Principles (Non-Negotiable)

1. Clarification over assumption
2. Deterministic execution
3. Explicit assertions determine pass/fail
4. No UI controls without real functionality
5. No secrets sent to the LLM
6. Local-first, auditable operation
7. Typed contracts between UI and backend
8. Spec intent must be provably implemented

---

## 3. Non-Goals (v2)

- Native mobile testing
- Native desktop application testing
- Autonomous scheduling
- Cloud execution or SaaS dependency
- Storing credentials in plaintext
- Self-modifying test behavior

---

## 4. System Architecture (Electron)

```
┌─────────────────────────────────────────────┐
│ Electron Application                        │
│                                             │
│ Renderer Process (UI)                       │
│  - Chat                                    │
│  - Test Library                             │
│  - Run History                              │
│  - Record Mode                              │
│  - Settings                                 │
│                                             │
│ Main Process (Node.js)                      │
│  - LLM Orchestration                        │
│  - Action/Test DSL Validation               │
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

---

## 5. UI / UX Specification (Fully Defined)

### 5.1 Global Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Top Bar                                                       │
│ Env ▼  Browser ▼  Headed/Headless  Auth ▼  Tool Policy ▼ Run │
├───────────────┬──────────────────────────────────────────────┤
│ Sidebar       │ Main Workspace                               │
│               │                                              │
│ • Chat        │ Context-dependent content                    │
│ • Tests       │                                              │
│ • Runs        │                                              │
│ • Record      │                                              │
│ • Settings    │                                              │
└───────────────┴──────────────────────────────────────────────┘
```

Top Bar Rules:
- All selections apply to the next execution only
- Active selections must be visibly indicated
- Invalid combinations must be blocked with explanation

---

### 5.2 Chat Mode

Workflow:
1. User enters command
2. Sent to LLM with enabled tools
3. LLM returns clarification or Action DSL
4. Steps validated and executed
5. Results rendered in chat

UI Requirements:
- Scrollable transcript
- Multi-line input
- Save as Test button
- Tool policy indicator

---

### 5.3 Test Library Mode

Workflow:
1. Browse or create test
2. Edit steps and assertions
3. Save test
4. Execute test
5. Review results

UI Requirements:
- Folder and tag navigation
- Assertion builder
- DSL editor
- Pass/fail visualization

---

### 5.4 Run History Mode

Workflow:
1. Select run
2. View summary
3. Inspect steps
4. View artifacts

UI Requirements:
- Status icons
- Filters
- Timeline view
- Artifact viewer

---

### 5.5 Record Mode

See Addendum A.

---

### 5.6 Settings Mode

Sections:
- Environments
- Browsers
- Authentication
- Tool policies
- Export defaults

---

## 6. UI Control Wiring (Governance)

### 6.1 Typed IPC Contracts

All UI actions must map to typed IPC requests.

```ts
type IpcRequest =
  | { type: "ExecuteCommand"; payload: RunConfig }
  | { type: "ExecuteTest"; payload: { testId: string } }
  | { type: "ExportRun"; payload: { runId: string } }
  | { type: "UpdateSession"; payload: { environment: string } };
```

Rules:
- No string-based IPC
- No UI controls without handlers
- Missing handlers fail fast

---

### 6.2 UI Control Matrix

A file UI_CONTROL_MATRIX.md must exist listing all controls and handlers.

CI must validate:
- Every IPC event has a handler
- Every handler has a UI control

---

## 7. Tool Policy System

Policies:
- Read-only
- Safe-write
- Full

Rules:
- Default is Read-only
- Full requires explicit confirmation
- Violations trigger clarification

---

## 8. Authentication Strategy

Default:
- Manual login via headed browser
- Save storageState.json per environment
- Reuse for future runs

Prohibited:
- Credentials in prompts
- Credentials in logs

---

## 9. Data Models

### TestCase
```ts
interface TestCase {
  id: string;
  name: string;
  tags: string[];
  preconditions: ActionStep[];
  steps: ActionStep[];
  assertions: Assertion[];
}
```

### Run
```ts
interface Run {
  id: string;
  environment: string;
  browser: string;
  status: "passed" | "failed";
  startedAt: string;
  finishedAt?: string;
}
```

---

## 10. Assertion Engine

Assertions define pass/fail:
- textVisible
- elementVisible
- urlContains
- countEquals

---

## 11. LLM Behavior Rules

- Output DSL or clarification only
- Never guess
- Never emit executable code
- Respect tool policy

---

## 12. Spec Compliance Verification

Golden path scenarios must be automated:
1. Chat execution
2. Load TXT execution
3. Save and run test
4. Auth reuse
5. Export run

No-stubs rule enforced.

---

## 13. MVP Roadmap

MVP1:
- Chat runner
- Browser selection
- Manual auth

MVP2:
- Tests
- Assertions
- Runs

MVP3:
- Record mode
- Flake handling
- CI outputs

---

## 14. Addendum A – Record Mode Technical Spec

Capture:
- Navigation
- Clicks
- Inputs
- Candidate selectors

Output:
- Raw recording
- Replayable

Refactor:
- LLM → TestCase DSL
- User approval required

---

## 15. Addendum B – PR Governance Checklist

- UI controls wired
- Acceptance criteria met
- No secrets exposed
- Tool policy enforced
- Golden paths tested

---

## 16. Clarification Rule

If ambiguity exists, the system must stop and ask a clarifying question.
