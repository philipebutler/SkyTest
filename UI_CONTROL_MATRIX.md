# UI Control Matrix

> Required by SPEC §6.2: "A file UI_CONTROL_MATRIX.md must exist listing all controls and handlers."
>
> Every IPC-triggering UI control must have a listed handler, and every handler must have a listed control.

---

## Top Bar Controls

| Control | Type | IPC Channel / Action | Handler Location |
|---|---|---|---|
| Env input | text input | persisted via `saveSettings` on change | `app/renderer/App.tsx` + `app/main/ipc/handlers.ts` |
| Browser select | dropdown | persisted via `saveSettings` on change | `app/renderer/App.tsx` + `app/main/ipc/handlers.ts` |
| Headed toggle | checkbox | persisted via `saveSettings` on change | `app/renderer/App.tsx` + `app/main/ipc/handlers.ts` |
| Auth select | dropdown | `auth:listProfiles` on mount, persisted via `saveSettings` | `app/renderer/components/TopBar.tsx` + `app/main/ipc/handlers.ts` |
| Policy select | dropdown | confirmation dialog for `full`; persisted via `saveSettings` | `app/renderer/components/TopBar.tsx` + `app/main/ipc/handlers.ts` |
| ▶ Run button | button | delegates to active screen via `screenRunRef` | `app/renderer/App.tsx` → `screenRunRef` |

---

## Chat Screen Controls

| Control | Type | IPC Channel | Handler Location |
|---|---|---|---|
| 📤 Send button | button | `chat:send` | `app/main/ipc/handlers.ts` |
| Ctrl+Enter / ⌘+Enter | keyboard shortcut | `chat:send` | `app/main/ipc/handlers.ts` |
| 💾 Save as Test button | button | `saveTest` | `app/main/ipc/handlers.ts` |
| 🔁 Retry button (error messages) | button | populates input; re-triggers `chat:send` on Send | `app/renderer/screens/Chat.tsx` |
| chat:stream listener | IPC event | `chat:stream` (push from main) | `app/renderer/screens/Chat.tsx` |
| chat:executionError listener | IPC event | `chat:executionError` (push from main) | `app/renderer/screens/Chat.tsx` |

---

## Test Library Screen Controls

| Control | Type | IPC Channel | Handler Location |
|---|---|---|---|
| Search input | text input | (client-side filter, no IPC) | `app/renderer/screens/TestLibrary.tsx` |
| Tag pill filter | button | (client-side filter, no IPC) | `app/renderer/screens/TestLibrary.tsx` |
| 🔄 Refresh button | button | `listTests` | `app/main/ipc/handlers.ts` |
| Test card (open details) | button | `listTests` (on mount) | `app/main/ipc/handlers.ts` |
| ▶ Run button | button | `executeTest` | `app/main/ipc/handlers.ts` |
| 🗑 Delete button | button | `deleteTest` (after inline confirmation) | `app/main/ipc/handlers.ts` |

---

## Run History Screen Controls

| Control | Type | IPC Channel | Handler Location |
|---|---|---|---|
| 🔄 Refresh button | button | `getRunHistory` | `app/main/ipc/handlers.ts` |
| Environment filter | dropdown | (client-side filter, no IPC) | `app/renderer/screens/RunHistory.tsx` |
| Browser filter | dropdown | (client-side filter, no IPC) | `app/renderer/screens/RunHistory.tsx` |
| Date filter | date input | (client-side filter, no IPC) | `app/renderer/screens/RunHistory.tsx` |
| Run card (view details) | button | (client-side selection, no IPC) | `app/renderer/screens/RunHistory.tsx` |
| ⬇ Export button | button | `exportRun` | `app/main/ipc/handlers.ts` |

---

## Record Mode Screen Controls

| Control | Type | IPC Channel | Handler Location |
|---|---|---|---|
| ⏺ Start Recording button | button | `record:start` | `app/main/ipc/handlers.ts` |
| ⏹ Stop Recording button | button | `record:stop` | `app/main/ipc/handlers.ts` |
| 🤖 Refactor with AI button | button | `record:refactor` | `app/main/ipc/handlers.ts` |
| 💾 Save Raw button | button | `saveTest` | `app/main/ipc/handlers.ts` |
| 💾 Save Refactored Test button | button | `saveTest` | `app/main/ipc/handlers.ts` |
| 🔄 New Recording button | button | (resets local state, no IPC) | `app/renderer/screens/Record.tsx` |
| record:event listener | IPC event | `record:event` (push from main) | `app/renderer/screens/Record.tsx` |
| Assertion row edits | inline form | (local state, saved on Save) | `app/renderer/screens/Record.tsx` |

---

## Settings Screen Controls

| Control | Type | IPC Channel | Handler Location |
|---|---|---|---|
| Directory path inputs (5×) | text input | `saveSettings` | `app/main/ipc/handlers.ts` |
| Reset buttons | button | (clears field locally) | `app/renderer/screens/Settings.tsx` |
| Run defaults fields | various | `saveSettings` | `app/main/ipc/handlers.ts` |
| LLM API Base URL input | text input | `saveSettings` | `app/main/ipc/handlers.ts` |
| LLM API Key input | password input | `saveSettings` | `app/main/ipc/handlers.ts` |
| LLM Model input | text input | `saveSettings` | `app/main/ipc/handlers.ts` |
| Retry count input | number input | `saveSettings` | `app/main/ipc/handlers.ts` |
| Retry mode select | dropdown | `saveSettings` | `app/main/ipc/handlers.ts` |
| Update Session button | button | `auth:updateSession` | `app/main/ipc/handlers.ts` |
| Save Settings button | button | `saveSettings` | `app/main/ipc/handlers.ts` |

---

## IPC Handlers

| Channel | Trigger(s) | Handler Location | Notes |
|---|---|---|---|
| `chat:send` | Chat Send, TopBar ▶ Run (in Chat) | `app/main/ipc/handlers.ts` | Streams tokens via `chat:stream`; executes DSL plan via Playwright |
| `chat:stream` | Emitted by `chat:send` handler | `app/main/ipc/handlers.ts` → renderer | Push event; renderer appends tokens to transcript |
| `chat:executionError` | Emitted by `chat:send` when DSL/policy invalid | `app/main/ipc/handlers.ts` → renderer | Push event; renderer renders inline error with Retry |
| `executeTest` | Test Library ▶ Run | `app/main/ipc/handlers.ts` | Persists Run to `runs/` |
| `getRunHistory` | Run History on mount / 🔄 Refresh | `app/main/ipc/handlers.ts` | Reads `runs/*.json` |
| `exportRun` | Run History ⬇ Export | `app/main/ipc/handlers.ts` | Writes `.md` + `.json` to user-chosen directory |
| `saveTest` | Chat 💾 Save as Test, Record Save buttons | `app/main/ipc/handlers.ts` | Persists TestCase to `tests/` |
| `listTests` | Test Library on mount / 🔄 Refresh | `app/main/ipc/handlers.ts` | Reads `tests/*.json` |
| `deleteTest` | Test Library 🗑 Delete | `app/main/ipc/handlers.ts` | Removes TestCase file from `tests/` |
| `getSettings` | App init, Settings on mount | `app/main/ipc/handlers.ts` | Reads `settings.json` |
| `saveSettings` | TopBar config changes, Settings Save | `app/main/ipc/handlers.ts` | Writes `settings.json` |
| `auth:updateSession` | Settings Update Session | `app/main/ipc/handlers.ts` | Launches headed browser; saves `storageState.json` |
| `auth:listProfiles` | TopBar on mount | `app/main/ipc/handlers.ts` | Lists auth profiles from `auth/` directory |
| `record:start` | Record ⏺ Start | `app/main/ipc/handlers.ts` | Launches headed browser and attaches DOM listeners |
| `record:stop` | Record ⏹ Stop | `app/main/ipc/handlers.ts` | Stops recording; saves raw file; returns steps |
| `record:refactor` | Record 🤖 Refactor with AI | `app/main/ipc/handlers.ts` | Sends steps to LLM; returns RefactoredRecording |
