
# Playwright Chat Runner – SPEC v2 (Complete)
Standalone Electron-Based LLM-Assisted Test Automation Suite

---

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

---

## 2. Design Principles

1. **Clarification over assumption**
2. **Deterministic execution**
3. **Explicit safety controls**
4. **Separation of intent, planning, and execution**
5. **Auditability**
6. **Local-first execution**

---

## 3. Non-Goals (v2)

- No mobile native testing
- No desktop native testing
- No background scheduling
- No credential storage beyond local secure storage
- No autonomous destructive actions

---

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

---

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

---

### 5.2 Chat Mode Workflow

**User Flow**
1. User selects Chat
2. Enters natural language command
3. Presses Send
4. System sends command + enabled tools to LLM
5. LLM responds with:
   - Clarifying question OR
   - Action DSL plan
6. Playwright executes
7. Results returned to chat

**UI Requirements**
- Transcript view
- Multi-line input
- “Save as Test” button
- Tool Policy indicator

---

### 5.3 Test Library Workflow

**User Flow**
1. User selects Tests
2. Views folder/tag tree
3. Selects or creates test
4. Edits steps/assertions
5. Saves test
6. Runs test

**UI Requirements**
- Folder structure
- Tag filtering
- Test metadata editor
- Assertion builder
- JSON/DSL editor (advanced)

---

### 5.4 Run History Workflow

**User Flow**
1. User selects Runs
2. Views list of runs
3. Selects a run
4. Reviews summary
5. Drills into steps

**UI Requirements**
- Status icons
- Filters
- Timeline view
- Artifact viewer

---

### 5.5 Settings Workflow

Sections:
- Environments
- Browsers
- Auth profiles
- Tool policies
- Export settings

---

## 6. Tool Policy System

Policies:
- Read-only
- Safe-write
- Full

Rules:
- LLM may only plan using enabled tools
- Violations require clarification

---

## 7. Authentication Strategy

Primary:
- Manual login + storageState.json

Secondary:
- Service account (optional)

Rules:
- Credentials never sent to LLM
- Sessions scoped per environment

---

## 8. Core Data Models

### 8.1 TestCase

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
}
```

### 8.2 Run

```ts
interface Run {
  id: string;
  testIds: string[];
  environment: string;
  browser: "chromium" | "firefox" | "webkit";
  status: "passed" | "failed";
  startedAt: string;
  finishedAt?: string;
}
```

### 8.3 StepResult

```ts
interface StepResult {
  index: number;
  action: string;
  status: "passed" | "failed";
  durationMs: number;
  artifacts: string[];
}
```

---

## 9. Assertion Engine

Supported assertions:
- textVisible
- elementVisible
- urlContains
- countEquals
- screenshotMatches (future)

Assertions define pass/fail.

---

## 10. LLM Behavior Rules

- Must output valid DSL or clarification
- Must not guess
- Must not emit code
- Must respect tool policy

---

## 11. Acceptance Criteria (Global)

- Tests are repeatable
- Failures produce artifacts
- UI workflows are deterministic
- No secrets exposed
- Exports are reproducible

---

## 12. MVP Roadmap

### MVP1
- Chat execution
- Browser selection
- Manual auth
- Action DSL

### MVP2
- Test library
- Assertions
- Run history

### MVP3
- Record mode
- Flake handling
- CI exports

---

## 13. Addendum A – Record Mode Technical Spec

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

---

## 14. Addendum B – GitHub Issues (Initial Backlog)

### Epic: Core Application
- Electron shell setup
- IPC messaging layer
- Persistent storage layout

### Epic: Chat & LLM
- Chat UI
- Copilot integration
- DSL validation

### Epic: Playwright Runner
- Browser selection
- Tool policy enforcement
- Artifact capture

### Epic: Test Management
- Test CRUD
- Assertion builder
- Versioning

### Epic: Record Mode
- Capture engine
- Refactor pipeline

### Epic: Reporting
- Run history UI
- Export system

---

## 15. Clarification Rule (Mandatory)

If any ambiguity exists in intent, tools, navigation, or data:

**The system must ask a clarifying question before proceeding.**
