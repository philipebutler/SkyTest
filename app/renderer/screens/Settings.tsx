import React, { useCallback, useEffect, useState } from "react";
import type { BrowserType, Settings, ToolPolicy } from "../../shared/types";

// Typed IPC bridge exposed by preload.ts
declare global {
  interface Window {
    skytest: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
    };
  }
}

/** Friendly label / description for each configurable directory. */
const DIR_FIELDS: Array<{
  key: keyof Omit<Settings, "schemaVersion" | "updatedAt">;
  label: string;
  hint: string;
}> = [
  { key: "testsDir", label: "Tests directory", hint: "Stores saved TestCase JSON files." },
  { key: "runsDir", label: "Runs directory", hint: "Stores Run result JSON files." },
  { key: "authDir", label: "Auth directory", hint: "Stores storageState.json per environment." },
  { key: "artifactsDir", label: "Artifacts directory", hint: "Stores screenshots, logs, HAR files." },
  { key: "exportsDir", label: "Exports directory", hint: "Stores exported Markdown / JSON reports." },
];

const BROWSERS: BrowserType[] = ["chromium", "firefox", "webkit"];
const TOOL_POLICIES: ToolPolicy[] = ["read-only", "safe-write", "full"];

export default function SettingsScreen(): React.ReactElement {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Partial<Settings>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  // LLM connection test state
  const [llmTestStatus, setLlmTestStatus] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [llmTestResult, setLlmTestResult] = useState<string | null>(null);
  const [llmTestLatency, setLlmTestLatency] = useState<number | null>(null);

  // Auth session update state (Issue #13)
  const [authEnv, setAuthEnv] = useState<string>("");
  const [authStatus, setAuthStatus] = useState<"idle" | "launching" | "saved" | "error">("idle");
  const [authError, setAuthError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = (await window.skytest.invoke("getSettings")) as Settings;
      setSettings(s);
      setDraft({
        testsDir: s.testsDir,
        runsDir: s.runsDir,
        authDir: s.authDir,
        artifactsDir: s.artifactsDir,
        exportsDir: s.exportsDir,
        lastEnvironment: s.lastEnvironment,
        lastBrowser: s.lastBrowser,
        lastHeaded: s.lastHeaded,
        lastAuthProfile: s.lastAuthProfile,
        lastToolPolicy: s.lastToolPolicy,
        retryCount: s.retryCount,
        retryMode: s.retryMode,
        llmEndpoint: s.llmEndpoint,
        llmApiKey: s.llmApiKey,
        llmModel: s.llmModel,
      });
      setAuthEnv(s.lastEnvironment ?? "default");
    } catch (err) {
      setError(`Failed to load settings: ${String(err)}`);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleChange = (key: keyof Settings, value: string | boolean | number) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setStatus("idle");
  };

  const handleSave = async () => {
    setStatus("saving");
    setError(null);
    try {
      const updated = (await window.skytest.invoke("saveSettings", draft)) as Settings;
      setSettings(updated);
      setStatus("saved");
    } catch (err) {
      setError(`Failed to save settings: ${String(err)}`);
      setStatus("error");
    }
  };

  const handleReset = (key: keyof Settings) => {
    handleChange(key, "");
  };

  // Launch headed browser for manual login and save storageState (Issue #13)
  const handleUpdateSession = async () => {
    setAuthStatus("launching");
    setAuthError(null);
    try {
      const result = (await window.skytest.invoke("auth:updateSession", { environment: authEnv || "default" })) as {
        saved: boolean;
        path: string;
      };
      setAuthStatus(result.saved ? "saved" : "error");
      if (!result.saved) {
        setAuthError("Session was not saved — the browser may have been closed before login completed.");
      }
    } catch (err) {
      setAuthError(`Failed to update session: ${String(err)}`);
      setAuthStatus("error");
    }
  };

  if (!settings) {
    return (
      <div style={styles.container}>
        {error ? (
          <p style={styles.errorText}>{error}</p>
        ) : (
          <p style={styles.loading}>Loading settings…</p>
        )}
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Settings</h2>
      <p style={styles.subheading}>
        Configure the local file system paths used by SkyTest. Leave a field blank to use the
        default location inside Electron's userData folder.
      </p>

      <div style={styles.form}>
        {DIR_FIELDS.map(({ key, label, hint }) => (
          <div key={key} style={styles.field}>
            <label style={styles.label} htmlFor={`setting-${key}`}>
              {label}
            </label>
            <p style={styles.hint}>{hint}</p>
            <div style={styles.inputRow}>
              <input
                id={`setting-${key}`}
                style={styles.input}
                type="text"
                value={(draft[key] as string) ?? ""}
                onChange={(e) => handleChange(key, e.target.value)}
                placeholder="(default)"
                aria-label={label}
              />
              <button
                style={styles.resetButton}
                onClick={() => handleReset(key)}
                title="Reset to default"
                type="button"
              >
                Reset
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Run defaults section (Issue #3) */}
      <h3 style={styles.sectionHeading}>Run Defaults</h3>
      <p style={styles.subheading}>
        These values are auto-saved whenever you change the TopBar controls and are restored on
        restart.
      </p>

      <div style={styles.form}>
        <div style={styles.field}>
          <label style={styles.label} htmlFor="setting-lastEnvironment">
            Last-used environment
          </label>
          <input
            id="setting-lastEnvironment"
            style={styles.input}
            type="text"
            value={(draft.lastEnvironment as string) ?? ""}
            onChange={(e) => handleChange("lastEnvironment", e.target.value)}
            placeholder="default"
            aria-label="Last-used environment"
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label} htmlFor="setting-lastBrowser">
            Last-used browser
          </label>
          <select
            id="setting-lastBrowser"
            style={styles.select}
            value={(draft.lastBrowser as string) ?? "chromium"}
            onChange={(e) => handleChange("lastBrowser", e.target.value as BrowserType)}
            aria-label="Last-used browser"
          >
            {BROWSERS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.field}>
          <label style={styles.label}>
            <input
              type="checkbox"
              checked={(draft.lastHeaded as boolean) ?? false}
              onChange={(e) => handleChange("lastHeaded", e.target.checked)}
              style={{ marginRight: "0.4rem" }}
            />
            Headed mode
          </label>
        </div>

        <div style={styles.field}>
          <label style={styles.label} htmlFor="setting-lastAuthProfile">
            Last-used auth profile
          </label>
          <input
            id="setting-lastAuthProfile"
            style={styles.input}
            type="text"
            value={(draft.lastAuthProfile as string) ?? ""}
            onChange={(e) => handleChange("lastAuthProfile", e.target.value)}
            placeholder="none"
            aria-label="Last-used auth profile"
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label} htmlFor="setting-lastToolPolicy">
            Last-used tool policy
          </label>
          <select
            id="setting-lastToolPolicy"
            style={styles.select}
            value={(draft.lastToolPolicy as string) ?? "read-only"}
            onChange={(e) => handleChange("lastToolPolicy", e.target.value as ToolPolicy)}
            aria-label="Tool policy"
          >
            {TOOL_POLICIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p style={styles.errorText}>{error}</p>}

      {/* LLM API Configuration (Issue #5) */}
      <h3 style={styles.sectionHeading}>LLM API Configuration</h3>
      <p style={styles.subheading}>
        Configure an OpenAI-compatible endpoint to enable chat-driven automation. The API key is
        stored locally and never sent as part of LLM request payloads.
      </p>
      <div style={styles.form}>
        <div style={styles.field}>
          <label style={styles.label} htmlFor="setting-llmEndpoint">
            API Base URL
          </label>
          <p style={styles.hint}>
            OpenAI-compatible base URL, e.g. <code style={styles.inlineCode}>https://api.openai.com/v1</code>
          </p>
          <input
            id="setting-llmEndpoint"
            style={styles.input}
            type="text"
            value={(draft.llmEndpoint as string) ?? ""}
            onChange={(e) => handleChange("llmEndpoint", e.target.value)}
            placeholder="https://api.openai.com/v1"
            aria-label="LLM API base URL"
            spellCheck={false}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label} htmlFor="setting-llmApiKey">
            API Key
          </label>
          <p style={styles.hint}>Your provider API key. Stored locally; never logged or transmitted to the LLM.</p>
          <input
            id="setting-llmApiKey"
            style={styles.input}
            type="password"
            value={(draft.llmApiKey as string) ?? ""}
            onChange={(e) => handleChange("llmApiKey", e.target.value)}
            placeholder="sk-…"
            aria-label="LLM API key"
            autoComplete="off"
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label} htmlFor="setting-llmModel">
            Model
          </label>
          <p style={styles.hint}>Model name passed to the API, e.g. <code style={styles.inlineCode}>gpt-4o</code></p>
          <input
            id="setting-llmModel"
            style={styles.input}
            type="text"
            value={(draft.llmModel as string) ?? ""}
            onChange={(e) => handleChange("llmModel", e.target.value)}
            placeholder="gpt-4o"
            aria-label="LLM model"
            spellCheck={false}
          />
        </div>
      </div>

      <div style={{ ...styles.field, marginTop: "0.75rem" }}>
          <div style={styles.inputRow}>
            <button
              style={{
                ...styles.saveButton,
                backgroundColor: llmTestStatus === "testing" ? "#555" : "#2e7d32",
                ...(llmTestStatus === "testing" ? styles.buttonDisabled : {}),
              }}
              onClick={async () => {
                setLlmTestStatus("testing");
                setLlmTestResult(null);
                setLlmTestLatency(null);
                // Save current draft first so the handler reads the latest values
                try {
                  await window.skytest.invoke("saveSettings", draft);
                } catch { /* ignore save errors during test */ }
                try {
                  const result = (await window.skytest.invoke("llm:testConnection")) as {
                    ok: boolean;
                    message: string;
                    latencyMs?: number;
                  };
                  setLlmTestStatus(result.ok ? "ok" : "error");
                  setLlmTestResult(result.message);
                  setLlmTestLatency(result.latencyMs ?? null);
                } catch (err) {
                  setLlmTestStatus("error");
                  setLlmTestResult(`Test failed: ${String(err)}`);
                }
              }}
              disabled={llmTestStatus === "testing"}
              type="button"
            >
              {llmTestStatus === "testing" ? "Testing…" : "🔌 Test Connection"}
            </button>
            {llmTestLatency != null && (
              <span style={{ fontSize: "0.75rem", color: "#888" }}>{llmTestLatency}ms</span>
            )}
          </div>
          {llmTestStatus === "ok" && llmTestResult && (
            <p style={{ ...styles.savedText, marginTop: "0.4rem" }}>✅ {llmTestResult}</p>
          )}
          {llmTestStatus === "error" && llmTestResult && (
            <p style={{ ...styles.errorText, marginTop: "0.4rem" }}>❌ {llmTestResult}</p>
          )}
        </div>

      {/* Retry Settings (Issue #23) */}
      <h3 style={styles.sectionHeading}>Retry Settings</h3>
      <p style={styles.subheading}>
        Default retry behaviour for test and step execution. Individual tests can override these
        values.
      </p>
      <div style={styles.form}>
        <div style={styles.field}>
          <label style={styles.label} htmlFor="setting-retryCount">
            Retry count
          </label>
          <p style={styles.hint}>Number of additional attempts after a failure (0 = no retries).</p>
          <input
            id="setting-retryCount"
            style={{ ...styles.input, width: "80px" }}
            type="number"
            min={0}
            max={10}
            value={(draft.retryCount as number) ?? 0}
            onChange={(e) => handleChange("retryCount", parseInt(e.target.value, 10) || 0)}
            aria-label="Retry count"
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label} htmlFor="setting-retryMode">
            Retry mode
          </label>
          <p style={styles.hint}>
            <strong>step</strong>: retry only the failed step.{" "}
            <strong>test</strong>: restart the full test from the beginning.
          </p>
          <select
            id="setting-retryMode"
            style={styles.select}
            value={(draft.retryMode as string) ?? "step"}
            onChange={(e) => handleChange("retryMode", e.target.value as "step" | "test")}
            aria-label="Retry mode"
          >
            <option value="step">step</option>
            <option value="test">test</option>
          </select>
        </div>
      </div>

      {/* Manual Login / Update Session section (Issue #13) */}
      <h3 style={styles.sectionHeading}>Manual Login / Update Session</h3>
      <p style={styles.subheading}>
        Launch a headed browser, log in manually, then close the browser. SkyTest will save the
        session as <code>storageState.json</code> for the chosen environment and reuse it in future
        runs.
      </p>
      <div style={styles.form}>
        <div style={styles.field}>
          <label style={styles.label} htmlFor="auth-env">
            Environment
          </label>
          <div style={styles.inputRow}>
            <input
              id="auth-env"
              style={styles.input}
              type="text"
              value={authEnv}
              onChange={(e) => { setAuthEnv(e.target.value); setAuthStatus("idle"); }}
              placeholder="default"
              aria-label="Auth environment"
              disabled={authStatus === "launching"}
            />
            <button
              style={{
                ...styles.saveButton,
                ...(authStatus === "launching" ? styles.buttonDisabled : {}),
              }}
              onClick={() => void handleUpdateSession()}
              disabled={authStatus === "launching"}
              type="button"
            >
              {authStatus === "launching" ? "Browser open – log in and close…" : "Update Session"}
            </button>
          </div>
          {authStatus === "saved" && (
            <p style={styles.savedText}>✅ Session saved for environment "{authEnv || "default"}".</p>
          )}
          {authError && <p style={styles.errorText}>{authError}</p>}
        </div>
      </div>

      <div style={styles.footer}>
        {status === "saved" && <span style={styles.savedText}>✅ Settings saved.</span>}
        <button
          style={{
            ...styles.saveButton,
            ...(status === "saving" ? styles.buttonDisabled : {}),
          }}
          onClick={handleSave}
          disabled={status === "saving"}
          type="button"
        >
          {status === "saving" ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 640,
    margin: "0 auto",
    padding: "1.5rem 1rem",
    color: "#d4d4d4",
  },
  heading: {
    fontSize: "1.25rem",
    fontWeight: "bold",
    marginBottom: "0.25rem",
  },
  subheading: {
    fontSize: "0.8rem",
    color: "#999",
    marginBottom: "1.5rem",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "1.25rem",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
  },
  label: {
    fontSize: "0.875rem",
    fontWeight: "bold",
  },
  hint: {
    fontSize: "0.75rem",
    color: "#888",
    margin: 0,
  },
  inputRow: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
    marginTop: "0.25rem",
  },
  input: {
    flex: 1,
    backgroundColor: "#1e1e1e",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#d4d4d4",
    padding: "0.4rem 0.6rem",
    fontSize: "0.8rem",
    fontFamily: "monospace",
  },
  resetButton: {
    backgroundColor: "transparent",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#888",
    cursor: "pointer",
    padding: "0.3rem 0.6rem",
    fontSize: "0.75rem",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "1rem",
    marginTop: "2rem",
  },
  savedText: {
    fontSize: "0.8rem",
    color: "#4ec94e",
  },
  errorText: {
    fontSize: "0.8rem",
    color: "#f44336",
    marginTop: "0.5rem",
  },
  saveButton: {
    backgroundColor: "#0e639c",
    border: "none",
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    padding: "0.5rem 1.25rem",
    fontSize: "0.875rem",
    fontWeight: "bold",
  },
  buttonDisabled: {
    backgroundColor: "#555",
    color: "#999",
    cursor: "not-allowed",
  },
  loading: {
    color: "#888",
    fontSize: "0.875rem",
  },
  sectionHeading: {
    fontSize: "1rem",
    fontWeight: "bold",
    marginTop: "2rem",
    marginBottom: "0.25rem",
  },
  select: {
    backgroundColor: "#1e1e1e",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#d4d4d4",
    padding: "0.4rem 0.6rem",
    fontSize: "0.8rem",
  },
  inlineCode: {
    backgroundColor: "#2d2d2d",
    borderRadius: "3px",
    fontFamily: "monospace",
    fontSize: "0.78rem",
    padding: "0.05rem 0.3rem",
    color: "#9cdcfe",
  },
};
