# AGENTS.md — Copilot Development Guide
Playwright Chat Runner v2 (Electron + TypeScript + Playwright + LLM)

## 0) Purpose
This file tells GitHub Copilot (and human contributors) **how to implement this repo** to match:
- **SPEC v2 (Complete)**: `Playwright_Test_Suite_SPEC_v2_COMPLETE.md`
- **Backlog**: Numbered GitHub Issues (Epics 1–9)

Copilot must treat the SPEC + backlog as the source of truth and follow the rules below.

---

## 1) Golden Rules (Non-Negotiable)

### 1.1 Clarification Over Assumption
If any requirement is ambiguous or missing, **do not guess**. Instead:
- Add a TODO comment that names the ambiguity and references the SPEC section and/or issue number.
- If implementing an LLM prompt/policy: enforce clarification behavior (LLM asks questions instead of assuming).

**Examples of ambiguity that require clarification:**
- Which environment/base URL to use
- Whether login is required and how to obtain auth state
- Which tools are enabled under the current tool policy
- Whether headed mode is required

### 1.2 Deterministic Execution
- Test outcomes must be determined by **explicit assertions**, not by the LLM.
- The LLM may help author tests and explain results, but it must not decide pass/fail beyond assertions.

### 1.3 Safety and Secrets
- **Never** send credentials, tokens, or secrets to the LLM.
- **Never** store secrets in plaintext.
- Prefer manual login + Playwright `storageState.json` saved per environment.
- Redact sensitive data from logs and exports.

### 1.4 Strict Separation of Concerns
- UI (renderer) is presentation + user workflow only.
- Backend (main process) owns:
  - LLM orchestration
  - DSL validation
  - Playwright execution
  - Assertion engine
  - Run/Artifact persistence

### 1.5 No “Freeform Code Generation”
- The LLM must output either:
  1) **Clarifying questions**, OR
  2) **Valid DSL** (Action DSL / Test DSL)
- Reject any output that tries to generate executable code.

---

## 2) Repository Structure (Expected)
Copilot should implement within this structure (or propose changes with SPEC references):

/app
/main                  # Electron main process (Node)
ipc/
llm/
runner/
storage/
validation/
/renderer              # Electron renderer (UI)
components/
screens/
state/
/shared                # Shared types, schemas, constants
/tests                   # Persisted TestCase definitions (JSON/YAML)
/runs                    # Persisted Run records (JSON)
/auth                    # storageState per environment (JSON)
/artifacts               # screenshots, logs, html snapshots, har
/exports                 # exported reports
AGENTS.md
Playwright_Test_Suite_SPEC_v2_COMPLETE.md

---

## 3) Issue-Driven Development (How to Work)
All work must map to a numbered issue from the backlog.

### 3.1 Commit Hygiene
- Each commit message must reference an issue number, e.g. `#11 Implement Playwright Action Executor`.
- Each PR description must reference:
  - Issue number(s)
  - SPEC sections impacted
  - Acceptance criteria checklist

### 3.2 Definition of Done (Per Issue)
An issue is done only when:
- All acceptance criteria in the issue description are met
- The implementation aligns with the SPEC
- Logging is safe (no secrets)
- State persists where required (tests, runs, artifacts, settings)

---

## 4) Data Contracts (Must Be Stable)
All key data structures must be defined in `/app/shared/types.ts` (or equivalent) and kept stable.

### 4.1 Minimum Required Models
Implement and use these models as per SPEC:
- `TestCase`
- `Run`
- `StepResult`
- `Artifact`

### 4.2 Persistence Format
- Use human-readable JSON by default.
- Each file must include:
  - `schemaVersion`
  - `createdAt`, `updatedAt` (where applicable)
  - stable IDs

---

## 5) DSL Requirements (Critical)
### 5.1 Action DSL
- Used for chat-driven automation
- Contains `steps[]` with permitted actions
- Must be validated (schema + tool policy)

### 5.2 Test DSL
- Extends Action DSL with assertions and metadata
- Pass/fail must come from assertions

### 5.3 Validation and Error Handling
- Invalid DSL must not execute.
- UI must display an actionable error message.
- If disabled tools are required, the system must request clarification or instruct the user to enable tools.

---

## 6) Tool Policy Enforcement
Tool policies are mandatory and must be visible in UI:
- `read-only`
- `safe-write`
- `full`

### 6.1 Enforcement Rules
- The executor must refuse steps whose actions are not enabled in current policy.
- The LLM must be prompted with the enabled tool list and instructed to:
  - Plan only with enabled tools
  - Ask clarifying questions when blocked

---

## 7) Authentication Rules
### 7.1 Default (v2): Manual Login + storageState
- Provide “Update Session” flow:
  - launch headed browser
  - user logs in manually
  - save `storageState.json` per environment

### 7.2 Prohibited
- Sending credentials to LLM
- Persisting credentials in plaintext

### 7.3 Logging
- All logs must redact secrets and PII where feasible.

---

## 8) UI/UX Requirements (No Ambiguity)
Copilot must implement UI workflows exactly as specified:

### 8.1 Required Screens
- Chat
- Tests (Test Library)
- Runs (Run History)
- Record
- Settings

### 8.2 Required Top Bar Controls (Apply to Next Run)
- Environment dropdown
- Browser dropdown
- Headed/Headless toggle
- Auth profile selector
- Tool policy selector
- Run button

### 8.3 Required Workflows
- Chat command -> LLM -> DSL -> Playwright -> results -> chat
- Save chat session as TestCase
- Run a TestCase from Test Library
- View Run details (step timeline + artifacts)
- Export run results (Markdown + JSON + artifact refs)

---

## 9) Record Mode (Addendum Implementation Rules)
Record Mode is required by backlog issues #21–#22.

### 9.1 Capture Requirements
- Capture navigation, clicks, inputs
- Capture candidate selectors:
  - prefer role/label/testid if available
- Save a raw recording file
- Recording must be replayable

### 9.2 Refactor Requirements
- LLM can refactor raw recordings to TestCase DSL
- User must review before saving
- Add suggested assertions, but keep them editable

---

## 10) Reporting & Artifacts
### 10.1 On Failure (Minimum)
- Capture screenshot
- Capture error message with step context
- Link artifacts to `StepResult`

### 10.2 Export
Exports must include:
- Run summary
- Step results
- Assertion results
- Artifact references
- Markdown + JSON formats

---

## 11) Testing Expectations (Repo Quality)
Copilot should:
- Add unit tests for:
  - DSL validation
  - tool policy enforcement
  - assertion engine
- Add integration tests for:
  - executor step sequencing
  - artifact capture on failure
- Keep UI tests optional initially (unless asked)

---

## 12) LLM Prompting Rules (Copilot-Compatible)
When implementing prompts, always include:
- Enabled tool list
- “Ask clarification questions if missing info”
- “Output JSON only” (for DSL responses)
- “Never include credentials or secrets”

### 12.1 LLM Output Handling
- If response is not valid JSON DSL:
  - treat as clarification OR
  - request the model to correct output (single retry)
- Never execute if validation fails.

---

## 13) Implementation Priorities
Follow MVP sequencing unless directed otherwise:

### MVP1
- Electron shell, Chat, basic runner, browser selection, manual auth, Action DSL

### MVP2
- Test library, assertions, run history, tool policies

### MVP3
- Record mode, flakes/retries, CI outputs

---

## 14) How to Ask for Clarification (When Needed)
If a decision is required and not specified:
1) Create an issue comment / TODO with:
   - the question
   - the options
   - suggested default
2) Do not implement the default without confirmation unless it is explicitly allowed by SPEC.

**Examples**
- “Should tool policies persist across restarts?”
- “Should headed mode be default in Record Mode?”

---

## 15) References
- SPEC: `Playwright_Test_Suite_SPEC_v2_COMPLETE.md`
- Backlog: numbered issues (Epics 1–9)

Copilot must follow this AGENTS.md and keep the implementation aligned with the SPEC and issue acceptance criteria.
