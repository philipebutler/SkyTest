import React, { useCallback, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Chat from "./screens/Chat";
import SettingsScreen from "./screens/Settings";
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

  // runTrigger: incremented by the TopBar Run button to signal the active screen
  // to execute with the current configuration (AGENTS.md §8.2, SPEC §5.1)
  const [runTrigger, setRunTrigger] = useState(0);
  const handleTopBarRun = useCallback(() => setRunTrigger((n) => n + 1), []);

  // Expose a ref so the active screen can register its own run callback
  // (used by screens other than Chat in future milestones)
  const screenRunRef = useRef<(() => void) | null>(null);

  const handleRun = useCallback(() => {
    if (screenRunRef.current) {
      screenRunRef.current();
    } else {
      handleTopBarRun();
    }
  }, [handleTopBarRun]);

  // Stable callback for the active screen to register its run handler
  const registerRun = useCallback((fn: () => void) => {
    screenRunRef.current = fn;
  }, []);

  return (
    <div style={styles.shell}>
      <TopBar config={config} onConfigChange={setConfig} onRun={handleRun} />
      <div style={styles.body}>
        <Sidebar active={screen} onNavigate={setScreen} />
        <main style={styles.workspace}>
          {screen === "chat" && (
          <Chat config={config} runTrigger={runTrigger} registerRun={registerRun} />
          )}
          {screen === "tests" && <Placeholder title="Test Library" />}
          {screen === "runs" && <Placeholder title="Run History" />}
          {screen === "record" && <Placeholder title="Record Mode" />}
          {screen === "settings" && <SettingsScreen />}
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
