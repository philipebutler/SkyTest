import React from "react";
import type { AppConfig } from "../App";
import type { BrowserType, ToolPolicy } from "../../shared/types";

interface Props {
  config: AppConfig;
  onConfigChange: (cfg: AppConfig) => void;
}

const BROWSERS: BrowserType[] = ["chromium", "firefox", "webkit"];
const TOOL_POLICIES: ToolPolicy[] = ["read-only", "safe-write", "full"];

export default function TopBar({ config, onConfigChange }: Props): React.ReactElement {
  const update = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) =>
    onConfigChange({ ...config, [key]: value });

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
        Policy
        <select
          style={styles.select}
          value={config.toolPolicy}
          onChange={(e) => update("toolPolicy", e.target.value as ToolPolicy)}
        >
          {TOOL_POLICIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>

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
