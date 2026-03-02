import React, { useEffect, useState } from "react";
import type { AppConfig } from "../App";
import type { BrowserType, ToolPolicy } from "../../shared/types";

interface Props {
  config: AppConfig;
  onConfigChange: (cfg: AppConfig) => void;
  onRun: () => void;
  onOpenSettings: () => void;
}

const BROWSERS: BrowserType[] = ["chromium", "firefox", "webkit"];
const TOOL_POLICIES: ToolPolicy[] = ["read-only", "safe-write", "full"];

export default function TopBar({
  config,
  onConfigChange,
  onRun,
  onOpenSettings,
}: Props): React.ReactElement {
  // Auth profiles are loaded from the auth/ directory (Issue #13).
  // The list always includes "none" (no auth) as the default option.
  const [authProfiles, setAuthProfiles] = useState<string[]>(["none"]);

  useEffect(() => {
    void (async () => {
      try {
        const profiles = (await window.skytest.invoke("auth:listProfiles")) as string[];
        setAuthProfiles(["none", ...profiles]);
      } catch {
        // Keep the default ["none"] on error
      }
    })();
  }, []);
  const update = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) =>
    onConfigChange({ ...config, [key]: value });

  const handlePolicyChange = (value: ToolPolicy) => {
    // SPEC §7: "Full requires explicit confirmation"
    if (value === "full") {
      const confirmed = window.confirm(
        "⚠️ Full tool policy allows destructive browser actions.\n\nAre you sure you want to enable Full policy?"
      );
      if (!confirmed) return;
    }
    update("toolPolicy", value);
  };

  return (
    <header style={styles.topBar}>
      <span style={styles.brand}>SkyTest</span>

      <label style={styles.label}>
        Env
        <input
          style={styles.input}
          value={config.environment}
          onChange={(e) => update("environment", e.target.value)}
          placeholder="default"
        />
      </label>

      <label style={styles.label}>
        Browser
        <select
          style={styles.select}
          value={config.browser}
          onChange={(e) => update("browser", e.target.value as BrowserType)}
        >
          {BROWSERS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>

      <label style={styles.label}>
        <input
          type="checkbox"
          checked={config.headed}
          onChange={(e) => update("headed", e.target.checked)}
        />
        Headed
      </label>

      <label style={styles.label}>
        Auth
        <select
          style={styles.select}
          value={config.authProfile}
          onChange={(e) => update("authProfile", e.target.value)}
        >
          {authProfiles.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      <label style={styles.label}>
        Policy
        <select
          style={styles.select}
          value={config.toolPolicy}
          onChange={(e) => handlePolicyChange(e.target.value as ToolPolicy)}
        >
          {TOOL_POLICIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

      <button style={styles.runButton} onClick={onRun} title="Run with current configuration">
        ▶ Run
      </button>

      <button
        style={styles.iconButton}
        onClick={onOpenSettings}
        title="Open Settings"
        aria-label="Open Settings"
      >
        ⚙️
      </button>

      <span style={styles.policyBadge} title="Active tool policy">
        🛡 {config.toolPolicy}
      </span>
    </header>
  );
}

const styles: Record<string, React.CSSProperties> = {
  topBar: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    padding: "0.4rem 1rem",
    backgroundColor: "#333333",
    borderBottom: "1px solid #3c3c3c",
    flexShrink: 0,
    flexWrap: "wrap",
  },
  brand: {
    fontWeight: "bold",
    fontSize: "1rem",
    color: "#4fc3f7",
    marginRight: "0.5rem",
  },
  label: {
    display: "flex",
    alignItems: "center",
    gap: "0.35rem",
    fontSize: "0.8rem",
    color: "#cccccc",
  },
  input: {
    backgroundColor: "#1e1e1e",
    border: "1px solid #555",
    borderRadius: "3px",
    color: "#d4d4d4",
    padding: "0.2rem 0.4rem",
    fontSize: "0.8rem",
    width: "100px",
  },
  select: {
    backgroundColor: "#1e1e1e",
    border: "1px solid #555",
    borderRadius: "3px",
    color: "#d4d4d4",
    padding: "0.2rem 0.4rem",
    fontSize: "0.8rem",
  },
  runButton: {
    backgroundColor: "#0e639c",
    border: "none",
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    padding: "0.3rem 0.9rem",
    fontSize: "0.8rem",
    fontWeight: "bold",
  },
  iconButton: {
    backgroundColor: "#2a2a2a",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    padding: "0.25rem 0.55rem",
    fontSize: "0.9rem",
    lineHeight: 1.2,
  },
  policyBadge: {
    marginLeft: "auto",
    fontSize: "0.75rem",
    color: "#ffd700",
    backgroundColor: "#2a2a2a",
    border: "1px solid #555",
    borderRadius: "4px",
    padding: "0.2rem 0.5rem",
  },
};
