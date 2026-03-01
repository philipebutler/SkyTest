import React, { useState } from "react";
import type { AppConfig } from "../App";
import type { Run } from "../../shared/types";

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
}

interface Props {
  config: AppConfig;
}

export default function Chat({ config }: Props): React.ReactElement {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Hi! Enter a command and press Run to execute it via Playwright." },
  ]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    const command = input.trim();
    if (!command) return;

    setMessages((prev) => [...prev, { role: "user", text: command }]);
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
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleRun();
    }
  };

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
          style={{ ...styles.runButton, ...(running ? styles.runButtonDisabled : {}) }}
          onClick={handleRun}
          disabled={running}
        >
          {running ? "Running…" : "▶ Run"}
        </button>
      </div>

      <div style={styles.hint}>
        Tool policy: <strong>{config.toolPolicy}</strong> · Browser:{" "}
        <strong>{config.browser}</strong> · Env: <strong>{config.environment}</strong>
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
  runButtonDisabled: {
    backgroundColor: "#555",
    cursor: "not-allowed",
  },
  hint: {
    fontSize: "0.75rem",
    color: "#888",
  },
};
