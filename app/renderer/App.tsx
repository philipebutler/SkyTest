import React, { useState } from "react";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Chat from "./screens/Chat";
import type { BrowserType, ToolPolicy } from "../shared/types";

export type Screen = "chat" | "tests" | "runs" | "record" | "settings";

export interface AppConfig {
  environment: string;
  browser: BrowserType;
  headed: boolean;
  toolPolicy: ToolPolicy;
  authProfile: string;
}

const defaultConfig: AppConfig = {
  environment: "default",
  browser: "chromium",
  headed: false,
  toolPolicy: "read-only",
  authProfile: "none",
};

export default function App(): React.ReactElement {
  const [screen, setScreen] = useState<Screen>("chat");
  const [config, setConfig] = useState<AppConfig>(defaultConfig);

  return (
    <div style={styles.shell}>
      <TopBar config={config} onConfigChange={setConfig} />
      <div style={styles.body}>
        <Sidebar active={screen} onNavigate={setScreen} />
        <main style={styles.workspace}>
          {screen === "chat" && <Chat config={config} />}
          {screen === "tests" && <Placeholder title="Test Library" />}
          {screen === "runs" && <Placeholder title="Run History" />}
          {screen === "record" && <Placeholder title="Record Mode" />}
          {screen === "settings" && <Placeholder title="Settings" />}
        </main>
      </div>
    </div>
  );
}

function Placeholder({ title }: { title: string }): React.ReactElement {
  return (
    <div style={styles.placeholder}>
      <h2 style={styles.placeholderTitle}>{title}</h2>
      <p style={styles.placeholderHint}>Coming soon in a future milestone.</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    fontFamily: "system-ui, sans-serif",
    backgroundColor: "#1e1e1e",
    color: "#d4d4d4",
  },
  body: {
    display: "flex",
    flex: 1,
    overflow: "hidden",
  },
  workspace: {
    flex: 1,
    overflow: "auto",
    padding: "1rem",
  },
  placeholder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    opacity: 0.5,
  },
  placeholderTitle: {
    fontSize: "1.5rem",
    marginBottom: "0.5rem",
  },
  placeholderHint: {
    fontSize: "0.875rem",
  },
};
