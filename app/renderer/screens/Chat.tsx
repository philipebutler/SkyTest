import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig } from "../App";
import type { ActionStep, Run, TestCase } from "../../shared/types";

// Typed IPC bridge exposed by preload.ts
declare global {
  interface Window {
    skytest: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };
  }
}

interface Message {
  role: "user" | "assistant";
  text: string;
  /** Raw command captured for Save as Test (user messages only) */
  command?: string;
}

interface Props {
  config: AppConfig;
  /** Incremented by the TopBar Run button to trigger execution (SPEC §5.1) */
  runTrigger: number;
  /** Registers this screen's run handler with the parent (SPEC §5.1 / AGENTS.md §8.2) */
  registerRun: (fn: () => void) => void;
}

export default function Chat({ config, runTrigger, registerRun }: Props): React.ReactElement {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Hi! Enter a command and press Run to execute it via Playwright." },
  ]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);

  // inputRef lets handleRun always read the latest input without being in its deps
  const inputRef = useRef(input);
  inputRef.current = input;

  // Memoized run handler; config is captured so changes to settings take effect immediately
  const handleRun = useCallback(async () => {
    const command = inputRef.current.trim();
    if (!command) return;

    setMessages((prev) => [...prev, { role: "user", text: command, command }]);
    setInput("");
    setRunning(true);

    try {
      const run = (await window.skytest.invoke("executeCommand", {
        command,
        environment: config.environment,
        browser: config.browser,
        headed: config.headed,
        toolPolicy: config.toolPolicy,
        authProfile: config.authProfile,
      })) as Run;

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Run ${run.id} completed with status: ${run.status}`,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `Error: ${String(err)}` },
      ]);
    } finally {
      setRunning(false);
    }
  }, [config, setMessages, setInput, setRunning]);

  // Register this screen's run handler so the TopBar Run button can trigger it
  useEffect(() => {
    registerRun(handleRun);
  }, [registerRun, handleRun]);

  // React to external runTrigger increments (TopBar Run button)
  const prevTrigger = useRef(runTrigger);
  useEffect(() => {
    if (runTrigger > prevTrigger.current) {
      prevTrigger.current = runTrigger;
      handleRun();
    }
  }, [runTrigger, handleRun]);

  // SPEC §5.2: "Save as Test button" — saves the chat session commands as a TestCase
  const handleSaveAsTest = async () => {
    const testName = window.prompt("Test name:", "Untitled Test");
    if (!testName) return;

    const steps: ActionStep[] = messages
      .filter((m) => m.role === "user" && m.command)
      .map((m) => ({ action: "chat", value: m.command }));

    setSaving(true);
    try {
      const testCase = (await window.skytest.invoke("saveTest", {
        name: testName,
        steps,
      })) as TestCase;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `✅ Saved as test "${testCase.name}" (${testCase.id})` },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `Error saving test: ${String(err)}` },
      ]);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleRun();
    }
  };

  const hasUserMessages = messages.some((m) => m.role === "user");

  return (
    <div style={styles.container}>
      <div style={styles.transcript}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...styles.message,
              ...(msg.role === "user" ? styles.userMessage : styles.assistantMessage),
            }}
          >
            <span style={styles.role}>{msg.role === "user" ? "You" : "Assistant"}</span>
            <span style={styles.text}>{msg.text}</span>
          </div>
        ))}
      </div>

      <div style={styles.inputRow}>
        <textarea
          style={styles.textarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter a command… (Ctrl+Enter or ⌘+Enter to run)"
          aria-label="Command input. Press Ctrl+Enter or Command+Enter to run."
          rows={3}
          disabled={running}
        />
        <button
          style={{ ...styles.runButton, ...(running ? styles.buttonDisabled : {}) }}
          onClick={handleRun}
          disabled={running}
        >
          {running ? "Running…" : "▶ Run"}
        </button>
      </div>

      <div style={styles.footer}>
        <span style={styles.hint}>
          Tool policy: <strong>{config.toolPolicy}</strong> · Browser:{" "}
          <strong>{config.browser}</strong> · Env: <strong>{config.environment}</strong>
        </span>
        {/* SPEC §5.2: Save as Test button */}
        <button
          style={{
            ...styles.saveButton,
            ...(!hasUserMessages || saving ? styles.buttonDisabled : {}),
          }}
          onClick={handleSaveAsTest}
          disabled={!hasUserMessages || saving}
          title="Save this chat session as a reusable test case"
        >
          {saving ? "Saving…" : "💾 Save as Test"}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    gap: "0.75rem",
  },
  transcript: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    padding: "0.5rem",
    backgroundColor: "#1a1a1a",
    borderRadius: "6px",
    border: "1px solid #3c3c3c",
  },
  message: {
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
    padding: "0.5rem 0.75rem",
    borderRadius: "6px",
    maxWidth: "85%",
  },
  userMessage: {
    alignSelf: "flex-end",
    backgroundColor: "#0e639c",
  },
  assistantMessage: {
    alignSelf: "flex-start",
    backgroundColor: "#2d2d2d",
  },
  role: {
    fontSize: "0.7rem",
    opacity: 0.7,
    fontWeight: "bold",
  },
  text: {
    fontSize: "0.875rem",
    lineHeight: "1.4",
  },
  inputRow: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "flex-end",
  },
  textarea: {
    flex: 1,
    backgroundColor: "#1e1e1e",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#d4d4d4",
    padding: "0.5rem",
    fontSize: "0.875rem",
    resize: "none",
    fontFamily: "inherit",
  },
  runButton: {
    backgroundColor: "#0e639c",
    border: "none",
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    padding: "0.5rem 1rem",
    fontSize: "0.875rem",
    fontWeight: "bold",
    height: "fit-content",
    alignSelf: "flex-end",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  hint: {
    fontSize: "0.75rem",
    color: "#888",
  },
  saveButton: {
    backgroundColor: "#2d4a22",
    border: "1px solid #4a7a38",
    borderRadius: "4px",
    color: "#a8d5a2",
    cursor: "pointer",
    padding: "0.3rem 0.8rem",
    fontSize: "0.75rem",
    fontWeight: "bold",
  },
  buttonDisabled: {
    backgroundColor: "#555",
    borderColor: "#555",
    color: "#999",
    cursor: "not-allowed",
  },
};
