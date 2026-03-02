# SkyTest – User Guide

This guide walks through every screen in SkyTest with step-by-step instructions.

---

## Table of Contents

1. [Application Layout](#application-layout)
2. [Top Bar – Run Controls](#top-bar--run-controls)
3. [Chat Screen](#chat-screen)
4. [Test Library](#test-library)
5. [Run History](#run-history)
6. [Record Mode](#record-mode)
7. [Settings](#settings)
8. [Concepts Reference](#concepts-reference)

---

## Application Layout

```
┌─────────────────────────────────────────────────────┐
│  TOP BAR  [Env] [Browser] [Headed] [Auth] [Policy] ▶ Run │
├──────────┬──────────────────────────────────────────┤
│          │                                          │
│ SIDEBAR  │           ACTIVE SCREEN                  │
│          │                                          │
│  💬 Chat │                                          │
│  📚 Tests│                                          │
│  🕰 Runs │                                          │
│  🎙 Record│                                          │
│  ⚙ Settings│                                        │
│          │                                          │
└──────────┴──────────────────────────────────────────┘
```

Use the **sidebar** to navigate between screens. Use the **top bar** to configure the run context before sending a command or executing a test.

---

## Top Bar – Run Controls

The top bar controls apply to the **next run** and are persisted across restarts.

| Control | Options | Effect |
|---------|---------|--------|
| **Environment** | Free-text field | Sets the base URL / environment label for the run |
| **Browser** | `chromium` / `firefox` / `webkit` | Browser that Playwright launches |
| **Headed** | Toggle | When on, the browser window is visible during the run |
| **Auth Profile** | Dropdown of saved profiles | Loads a `storageState.json` for authenticated sessions |
| **Tool Policy** | `read-only` / `safe-write` / `full` | Controls which browser actions the LLM may plan |
| **▶ Run** | Button | Triggers execution on the active screen |

### Tool Policy reference

| Policy | Permitted actions |
|--------|-------------------|
| `read-only` | `navigate`, `screenshot`, `assert`, `wait`, `waitForSelector`, `waitForNavigation` |
| `safe-write` | All of `read-only` plus `click`, `fill`, `select`, `check`, `uncheck`, `hover`, `scroll` |
| `full` | All available actions (same as `safe-write` in v1) |

---

## Chat Screen

The Chat screen is the primary way to run ad-hoc automation.

### Step-by-step: Send a command

1. Make sure the **Top Bar** shows the correct environment, browser and tool policy.
2. Type a plain-English command in the text area at the bottom, for example:
   ```
   Navigate to https://example.com, click the "More information…" link,
   then take a screenshot.
   ```
3. Press **📤 Send** or `Ctrl+Enter` (`⌘+Enter` on macOS).
4. The assistant replies by streaming the LLM plan; once planning finishes Playwright executes each step.
5. A result message appears showing pass / fail status for each step.

### Step-by-step: Handle a clarification

When your command is ambiguous the LLM replies with a **❓ Needs Clarification** message instead of running anything. A yellow banner appears at the bottom of the transcript.

1. Read the clarification question in the chat.
2. Type your answer in the text area.
3. Press **Send** – the answer is added to the conversation history and a new plan is produced.

### Step-by-step: Retry a failed command

After a failure, a **🔁 Retry** button appears on the error message.

1. Click **🔁 Retry** – the original command is copied back into the text area.
2. Adjust the command if needed.
3. Press **Send** to re-run.

### Step-by-step: Save a session as a Test Case

1. After one or more successful commands, click **💾 Save as Test** in the bottom-right footer.
2. Enter a name for the test when prompted.
3. The test is saved to the **Test Library** and can be re-run at any time.

### Chat message types

| Message style | Meaning |
|--------------|---------|
| **Blue (right-aligned)** | Your command |
| **Dark grey (left-aligned)** | LLM plan or assistant message |
| **Yellow border** | LLM clarification request – no execution will happen until you answer |
| **Green border** | Successful execution result |
| **Red border** | Execution-blocked error (policy or schema violation) |

---

## Test Library

The Test Library stores all saved test cases as local JSON files.

### Step-by-step: Browse and filter tests

1. Click **📚 Tests** in the sidebar.
2. Use the **Search** box to filter by test name or tag.
3. Click a **tag pill** to filter to tests that share that tag.
4. Click a test row to open the detail panel on the right.

### Step-by-step: Run a test

1. Open the test in the detail panel.
2. Optionally adjust the **Top Bar** controls (browser, environment, etc.).
3. Click **▶ Run** in the detail panel (or use the top-bar Run button while the test is selected).
4. The run status updates inline: `⏳ Running` → `✅ Passed` / `❌ Failed`.
5. Click **View Run →** to open the full run details in Run History.

### Step-by-step: Delete a test

1. Click the test row to select it.
2. Click **Delete** in the detail panel.
3. Confirm the deletion in the confirmation prompt that appears.

### Step-by-step: Edit raw JSON

1. Open a test in the detail panel.
2. In **Raw JSON**, edit the JSON directly.
3. Click **Save JSON** to persist changes.
4. If JSON parsing or schema checks fail, fix the inline error and save again.
5. Click **Reset** to discard unsaved edits and restore the last saved version.

> Legacy compatibility: older tests that contain `action: "chat"` steps are converted to executable DSL steps when run.

---

## Run History

Run History shows every past run with full step-level detail.

### Step-by-step: Browse runs

1. Click **🕰 Runs** in the sidebar.
2. Use the filter fields at the top to narrow results by **Environment**, **Browser** or **Date**.
3. Click any run row to open the detail panel.

### Run status icons

| Icon | Status |
|------|--------|
| ✅ | Passed |
| ❌ | Failed |
| ⏳ | Running |
| 🚫 | Aborted |

### Step-by-step: View step details

1. Click a run to open the detail panel.
2. Each step shows its **action**, **status**, **duration** and any **error message**.
3. If a step failed, the failure screenshot is listed under **Artifacts** – click the path to locate the file on disk.

### Step-by-step: Export a run

1. Open the run in the detail panel.
2. Click **📤 Export Run**.
3. Two files are written to the `exports/` directory:
   - `<runId>.md` – human-readable Markdown report
   - `<runId>.json` – machine-readable JSON (the full Run record)
4. A success message confirms the export path.

---

## Record Mode

Record Mode lets you capture a live browser session and convert it into a reusable test case.

### Step-by-step: Record a session

1. Click **🎙 Record** in the sidebar.
2. Click **Start Recording**.
3. A headed browser window opens.
4. Perform the actions you want to capture (navigate, click, fill in forms, etc.).
5. When finished, click **Stop Recording** in SkyTest.
6. The raw recording is saved and displayed as a list of captured steps.

### Step-by-step: Refactor a recording into a test

1. After stopping the recording, click **Refactor with LLM**.
2. The LLM analyses the raw steps, improves selector quality and suggests assertions.
3. Review the proposed test in the preview panel.
4. Edit any steps or assertions as needed.
5. Click **Save as Test** to add it to the Test Library.

> **Tip:** Recordings are saved automatically to the `recordings/` directory even if you do not refactor them immediately.

---

## Settings

The Settings screen lets you configure all persistent preferences.

### Step-by-step: Change file system paths

1. Click **⚙ Settings** in the sidebar.
2. Find the directory field you want to change (`Tests`, `Runs`, `Auth`, `Artifacts` or `Exports`).
3. Enter an absolute path, or leave blank to use the default inside Electron's `userData` folder.
4. Click **Reset** to restore the default for a single field.
5. Click **Save Settings** when done.

### Step-by-step: Configure LLM API

1. Scroll to **LLM API Configuration**.
2. Fill in **API Base URL** (e.g. `https://api.openai.com/v1`).
3. Fill in **API Key** (stored locally; never logged or sent in LLM payloads).
4. Fill in **Model** (e.g. `gpt-4o`).
5. Click **Save Settings**.

### Step-by-step: Set default retry behaviour

1. Scroll to **Retry Settings**.
2. Set **Retry count** to the number of additional attempts after a failure (0 = no retries).
3. Set **Retry mode**:
   - `step` – retry only the failed step in place.
   - `test` – restart the entire test run from the beginning.
4. Click **Save Settings**.

### Step-by-step: Update an auth session

1. Scroll to **Manual Login / Update Session**.
2. Enter the **Environment** name (e.g. `staging`).
3. Click **Update Session**.
4. A headed Chromium browser opens – complete the login flow.
5. Close the browser window when done.
6. SkyTest saves `auth/<environment>.json` and shows a confirmation message.

---

## Concepts Reference

### DSL Plan

Every chat command is converted by the LLM into a structured DSL (Domain-Specific Language) plan before anything runs. A plan looks like this:

```json
{
  "version": "1",
  "intent": "Navigate to example.com and take a screenshot",
  "steps": [
    { "action": "navigate", "value": "https://example.com" },
    { "action": "screenshot" }
  ]
}
```

The plan is **validated** against the schema and the active **tool policy** before Playwright executes it. If validation fails, an error message is shown and no browser actions occur.

### Supported actions

| Action | Required fields | Description |
|--------|----------------|-------------|
| `navigate` | `value` (URL) | Navigate to a URL |
| `click` | `selector` | Click an element |
| `fill` | `selector`, `value` | Type text into an input |
| `select` | `selector`, `value` | Choose a dropdown option |
| `check` | `selector` | Check a checkbox |
| `uncheck` | `selector` | Uncheck a checkbox |
| `hover` | `selector` | Hover over an element |
| `wait` | `value` (ms) | Wait for a fixed duration |
| `waitForSelector` | `selector` | Wait until an element appears |
| `waitForNavigation` | — | Wait for the page to finish loading |
| `scroll` | `selector` | Scroll an element into view |
| `screenshot` | — | Take a full-page screenshot |
| `assert` | `selector` and/or `value` | Assert element visibility or text presence |

### Assertion types

When a test case is saved, assertions are evaluated after all steps complete.

| Type | Description |
|------|-------------|
| `textVisible` | Checks that the specified text appears anywhere on the page |
| `elementVisible` | Checks that the selector is visible |
| `urlContains` | Checks that the current URL contains the specified string |
| `countEquals` | Checks that the number of matching elements equals `count` |

### Auth profiles

Auth profiles are `storageState.json` files saved per environment in the `auth/` directory. The file name matches the environment name (sanitised to alphanumeric characters and hyphens). When a profile is selected in the Top Bar, the executor loads the saved cookies and local storage before running any steps.

### Tool policies

Tool policies enforce a safety boundary at the executor level. Even if the LLM produces a step that is not allowed by the active policy, the plan is rejected before any browser is launched. Always use the most restrictive policy that allows your test to function.
