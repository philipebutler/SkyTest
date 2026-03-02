import React, { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Chat from "./screens/Chat";
import RunHistory from "./screens/RunHistory";
import RecordScreen from "./screens/Record";
import SettingsScreen from "./screens/Settings";
import TestLibrary from "./screens/TestLibrary";
import type { BrowserType, Settings, ToolPolicy } from "../shared/types";

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
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Load persisted settings on mount and initialise config from last-used values (Issue #3)
  useEffect(() => {
    void (async () => {
      try {
        const s = (await window.skytest.invoke("getSettings")) as Settings;
        setConfig({
          environment: s.lastEnvironment ?? defaultConfig.environment,
          browser: s.lastBrowser ?? defaultConfig.browser,
          headed: s.lastHeaded ?? defaultConfig.headed,
          toolPolicy: s.lastToolPolicy ?? defaultConfig.toolPolicy,
          authProfile: s.lastAuthProfile ?? defaultConfig.authProfile,
        });
      } catch (err) {
        console.warn("[App] Failed to load settings, using defaults.", err);
      } finally {
        setSettingsLoaded(true);
      }
    })();
  }, []);

  // Persist last-used run configuration whenever it changes (Issue #3)
  const handleConfigChange = useCallback((cfg: AppConfig) => {
    setConfig(cfg);
    if (!settingsLoaded) return;
    void window.skytest
      .invoke("saveSettings", {
        lastEnvironment: cfg.environment,
        lastBrowser: cfg.browser,
        lastHeaded: cfg.headed,
        lastAuthProfile: cfg.authProfile,
        lastToolPolicy: cfg.toolPolicy,
      })
      .catch((err: unknown) => {
        console.warn("[App] Failed to persist settings.", err);
      });
  }, [settingsLoaded]);

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
      <TopBar
        config={config}
        onConfigChange={handleConfigChange}
        onRun={handleRun}
        onOpenSettings={() => setScreen("settings")}
      />
      <div style={styles.body}>
        <Sidebar active={screen} onNavigate={setScreen} />
        <main style={styles.workspace}>
          {screen === "chat" && (
          <Chat config={config} runTrigger={runTrigger} registerRun={registerRun} />
          )}
          {screen === "tests" && <TestLibrary config={config} />}
          {screen === "runs" && <RunHistory />}
          {screen === "record" && <RecordScreen />}
          {screen === "settings" && <SettingsScreen />}
        </main>
      </div>
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
};
