# SkyTest – Installation Guide

This guide covers everything you need to install, configure and run SkyTest on your workstation or in a CI pipeline.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Install from Source](#install-from-source)
3. [First-Launch Configuration](#first-launch-configuration)
4. [LLM API Setup](#llm-api-setup)
5. [Auth Session Setup](#auth-session-setup)
6. [Production Build](#production-build)
7. [CI / Headless Runner](#ci--headless-runner)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | 18 or later | LTS recommended |
| **npm** | 9 or later | Bundled with Node |
| **Git** | any | To clone the repo |
| **Operating System** | macOS, Windows, Linux | Electron supports all three |
| **LLM API access** | — | Any OpenAI-compatible endpoint (see [LLM API Setup](#llm-api-setup)) |

> **Note for Linux users:** Electron requires several system libraries (`libgtk`, `libnss`, `libasound`). On Debian/Ubuntu install them with:
> ```bash
> sudo apt-get install -y libgtk-3-0 libnss3 libasound2 libxss1 libx11-xcb1 libxcb-dri3-0
> ```

---

## Install from Source

```bash
# 1. Clone the repository
git clone https://github.com/philipebutler/SkyTest.git
cd SkyTest

# 2. Install Node dependencies
npm install

# 3. Install Playwright browser binaries (one-time, downloads ~300 MB)
npx playwright install
```

---

## First-Launch Configuration

### Start in development mode

```bash
npm run dev
```

This command starts three concurrent processes:

| Process | What it does |
|---------|-------------|
| `dev:renderer` | Webpack dev server for the React UI on `http://localhost:3000` |
| `dev:main` | Webpack watcher for the Electron main process |
| `electron .` | Launches the Electron shell once the renderer is ready |

The app window opens automatically. DevTools are enabled in development mode.

### Data directories

On first launch, SkyTest creates the following sub-directories inside Electron's `userData` folder:

| Directory | Default path (macOS) | Purpose |
|-----------|---------------------|---------|
| `tests/` | `~/Library/Application Support/skytest/tests/` | TestCase JSON files |
| `runs/` | `~/Library/Application Support/skytest/runs/` | Run record JSON files |
| `auth/` | `~/Library/Application Support/skytest/auth/` | `storageState.json` files |
| `artifacts/` | `~/Library/Application Support/skytest/artifacts/` | Screenshots and HAR files |
| `exports/` | `~/Library/Application Support/skytest/exports/` | Exported Markdown/JSON reports |
| `recordings/` | `~/Library/Application Support/skytest/recordings/` | Raw recording files |

You can override any of these paths in the **Settings** screen.

---

## LLM API Setup

SkyTest requires an OpenAI-compatible API to power the chat-driven automation.

1. Open **Settings** (gear icon in the left sidebar).
2. Scroll to the **LLM API Configuration** section.
3. Fill in the three fields:

   | Field | Example value | Description |
   |-------|---------------|-------------|
   | **API Base URL** | `https://api.openai.com/v1` | Base URL for the OpenAI-compatible API |
   | **API Key** | `sk-…` | Your provider API key (stored locally, never logged) |
   | **Model** | `gpt-4o` | Model name passed to the API |

4. Click **Save Settings**.

> **Security note:** The API key is stored in `settings.json` inside the Electron `userData` folder. It is never included in any LLM request payload and is redacted from all application logs.

---

## Auth Session Setup

If the application under test requires login, use the **Manual Login / Update Session** flow:

1. Open **Settings**.
2. Scroll to **Manual Login / Update Session**.
3. Enter the **Environment** name (e.g. `staging`).
4. Click **Update Session** – a headed Chromium browser opens.
5. Complete the login flow in the browser.
6. Close the browser window.
7. SkyTest saves a `storageState.json` file to the `auth/` directory.

The saved session is automatically loaded for any run that targets the same environment name.

---

## Production Build

To build a distributable version of the app (no dev server):

```bash
# Build both main and renderer bundles
npm run build

# Start the built app
npm start
```

Built bundles are written to `dist/main/` and `dist/renderer/`.

---

## CI / Headless Runner

SkyTest ships a standalone CI runner that runs a saved TestCase without the Electron UI.

### Build the CI bundle

```bash
npm run build:ci
```

The bundle is written to `dist/ci/ci-runner.js`.

### Run a test in CI

```bash
node dist/ci/ci-runner.js \
  --test path/to/my-test.json \
  --output junit \
  --browser chromium \
  --artifacts-dir ./artifacts \
  --runs-dir ./runs
```

#### CLI options

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--test <path>` | ✅ | — | Path to a TestCase JSON file |
| `--output <junit\|json>` | | `json` | Output format |
| `--browser <chromium\|firefox\|webkit>` | | `chromium` | Browser to use |
| `--artifacts-dir <dir>` | | `./artifacts` | Where to save screenshots |
| `--runs-dir <dir>` | | — | Where to persist the Run JSON record |
| `--out-file <path>` | | stdout | Write output to a file instead of stdout |
| `--auth-state <path>` | | — | Path to a `storageState.json` for authenticated sessions |
| `--tool-policy <read-only\|safe-write\|full>` | | `read-only` | Tool policy to enforce |

#### Exit codes

| Code | Meaning |
|------|---------|
| `0` | All steps and assertions passed |
| `1` | One or more steps or assertions failed, or the test file was not found |

### Example GitHub Actions workflow

```yaml
- name: Build CI runner
  run: npm run build:ci

- name: Install Playwright browsers
  run: npx playwright install --with-deps chromium

- name: Run SkyTest suite
  run: |
    node dist/ci/ci-runner.js \
      --test tests/smoke.json \
      --output junit \
      --out-file results/smoke-results.xml

- name: Upload test results
  uses: actions/upload-artifact@v4
  with:
    name: skytest-results
    path: results/
```

---

## Troubleshooting

### "StorageService has not been initialised"

This error appears if the main process IPC handlers are called before `StorageService.init()`. This is always called at startup in production; if you see it in tests, call `StorageService.init()` with a temp directory in your test setup.

### Playwright browser not found

Run `npx playwright install` to download the browser binaries. In CI add `--with-deps` to also install OS-level libraries:

```bash
npx playwright install --with-deps
```

### Electron failed to install correctly (Windows)

If `npm run dev` fails with:

> `Electron failed to install correctly, please delete node_modules/electron and try installing again`

reinstall Electron from PowerShell:

```powershell
Remove-Item -Recurse -Force .\node_modules\electron
npm install electron --save-dev
```

If your company network uses TLS interception / custom root certificates and install fails with `self-signed certificate in certificate chain`, set npm's CA file and retry:

```powershell
npm config set cafile "C:\path\to\corporate-root-ca.pem"
npm install electron --save-dev
```

As a temporary fallback for non-Electron tasks, you can install packages without running postinstall scripts:

```powershell
npm install --ignore-scripts
```

Then run normal setup when certificates are fixed:

```powershell
npm install
npx playwright install
```

### Chat returns "LLM adapter error"

Verify your **API Base URL**, **API Key** and **Model** in Settings. Check that your API key has quota remaining and that the base URL ends with `/v1` (for OpenAI).

### Headed mode does not show a window

On Linux, ensure a display server is available. In CI use a virtual display:

```bash
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99
```
