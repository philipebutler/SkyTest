# SkyTest – Playwright Chat Runner

**SkyTest** is a standalone Electron application that lets you drive browser automation through natural-language chat. Describe what you want to test, let an LLM translate your intent into a validated step plan, watch Playwright execute it, and save the session as a reusable test case – all from a single desktop app.

---

## Key Features

| Feature | Description |
|---------|-------------|
| 💬 **Chat-driven automation** | Type a plain-English command; the LLM produces a validated DSL plan and Playwright runs it |
| 📚 **Test Library** | Save, search, tag, edit and re-run test cases from a local JSON store |
| 🕰 **Run History** | Browse every past run with step timelines, assertion results and failure screenshots |
| 🎙 **Record Mode** | Capture clicks and form fills in a live browser, then let the LLM clean the recording into a reusable test |
| 🔒 **Tool Policies** | Three safety levels (`read-only`, `safe-write`, `full`) control which browser actions are permitted |
| 🔑 **Auth Sessions** | Manually log in once; the session is saved as `storageState.json` and reused in all future runs |
| 🔁 **Retry & Flake Handling** | Configurable per-step or per-test retries with per-attempt logging |
| 🤖 **CI Runner** | Headless CLI entry point that outputs JUnit XML or JSON – no UI required |
| 📤 **Export** | Export any run as Markdown or JSON from the Run History screen |

---

## Documentation

| Document | Description |
|----------|-------------|
| [Installation Guide](docs/INSTALLATION.md) | Prerequisites, install steps, first-launch checklist |
| [User Guide](docs/USER_GUIDE.md) | Screen-by-screen instructions with explicit steps |
| [Technical Reference](docs/TECHNICAL.md) | Architecture, data contracts, IPC channels, module descriptions |

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/philipebutler/SkyTest.git
cd SkyTest

# 2. Install dependencies
npm install

# 3. Install Playwright browsers (first time only)
npx playwright install

# 4. Start the app in development mode
npm run dev
```

See the full [Installation Guide](docs/INSTALLATION.md) for production builds, LLM API setup and CI integration.

---

## First Run Checklist

1. Open **Settings** (gear icon in the sidebar).
2. Enter your LLM **API Base URL** and **API Key**.
3. Choose a **Model** (e.g. `gpt-4o`).
4. Save settings.
5. Switch to **Chat** and type: `Navigate to https://example.com and take a screenshot`.
6. Press **Send** (or `Ctrl+Enter`).

---

## Project Structure

```
/app
  /main           # Electron main process (Node.js)
    /ipc          # IPC request handlers
    /llm          # LLM adapter, orchestrator, credential sanitiser
    /runner       # Playwright executor, assertion engine, CI runner
    /storage      # File-based repositories, run exporter, settings
    /validation   # DSL schema validator and policy enforcer
    /record       # Recording engine and LLM-powered refactorer
  /renderer       # React UI (renderer process)
    /components   # TopBar, Sidebar
    /screens      # Chat, TestLibrary, RunHistory, Record, Settings
  /shared         # Shared TypeScript types (types.ts)
/tests            # Persisted TestCase JSON files
/runs             # Persisted Run record JSON files
/auth             # storageState.json files (one per environment)
/artifacts        # Screenshots, logs, HTML snapshots, HAR files
/exports          # Exported Markdown and JSON reports
/docs             # This documentation set
```

---

## Tech Stack

- **Electron** – cross-platform desktop shell
- **React 18** – renderer UI
- **TypeScript 5** – end-to-end type safety
- **Playwright** – browser automation engine
- **Webpack 5** – module bundler
- **Jest / ts-jest** – unit test runner

---

## License

MIT
