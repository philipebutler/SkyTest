import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig } from "../App";
import type { ActionStep, ChatHistoryEntry, TestCase } from "../../shared/types";

// Typed IPC bridge exposed by preload.ts
declare global {
  interface Window {
    skytest: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
    };
  }
}

interface Message {
  role: "user" | "assistant" | "result";
  text: string;
  /** Raw command captured for Save as Test (user messages only) */
  command?: string;
  /** True while a streaming response is being received */
  streaming?: boolean;
  /** Correlates a streaming message to its stream session */
  streamId?: string;
  /** Marks this message as a clarification request from the LLM (Issue #6) */
  isClarification?: boolean;
  /** Marks this message as an execution-blocked error (Issue #8) */
  isExecutionError?: boolean;
  /** Command to retry when the user clicks the Retry button (SPEC §5.2) */
  retryCommand?: string;
}

interface Props {
  config: AppConfig;
  /** Incremented by the TopBar Run button to trigger execution (SPEC §5.1) */
  runTrigger: number;
  /** Registers this screen's run handler with the parent (SPEC §5.1 / AGENTS.md §8.2) */
  registerRun: (fn: () => void) => void;
}

function extractJsonFromAssistantMessage(text: string): unknown | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function extractStepsFromPlanLikeJson(value: unknown): ActionStep[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.steps)) return [];

  const result: ActionStep[] = [];
  for (const rawStep of record.steps) {
    if (typeof rawStep !== "object" || rawStep === null) continue;
    const step = rawStep as Record<string, unknown>;
    const action =
      typeof step.action === "string"
        ? step.action
        : typeof step.verb === "string"
        ? step.verb
        : "";
    if (!action) continue;

    const valueFromAliases =
      typeof step.value === "string"
        ? step.value
        : typeof step.text === "string"
        ? step.text
        : typeof step.url === "string"
        ? step.url
        : undefined;

    result.push({
      action,
      selector: typeof step.selector === "string" ? step.selector : undefined,
      value: valueFromAliases,
      timeout: typeof step.timeout === "number" ? step.timeout : undefined,
      optional: typeof step.optional === "boolean" ? step.optional : undefined,
    });
  }

  return result;
}

export default function Chat({ config, runTrigger, registerRun }: Props): React.ReactElement {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Hi! Enter a command and press Send to execute it via Playwright." },
  ]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * Issue #6: Clarification enforcement state.
   * - awaitingClarification: true when the LLM asked a question and we must not execute.
   * - chatHistory: accumulates the conversation so the next request includes context to resolve ambiguity.
   */
  const [awaitingClarification, setAwaitingClarification] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistoryEntry[]>([]);

  const hasBridge =
    typeof window !== "undefined" &&
    typeof window.skytest?.invoke === "function" &&
    typeof window.skytest?.on === "function";

  // inputRef lets handleRun always read the latest input without being in its deps
  const inputRef = useRef(input);
  inputRef.current = input;

  // Track the last sent command so error messages can offer a Retry affordance (SPEC §5.2)
  const lastCommandRef = useRef<string>("");

  // Issue #8: Listen for execution errors (schema/policy violations) pushed from the main process.
  // These surface as visible error messages in the transcript so the user knows why execution was blocked.
  useEffect(() => {
    if (!hasBridge) {
      setMessages((prev) => {
        if (prev.some((m) => m.role === "assistant" && m.text.includes("IPC bridge unavailable"))) {
          return prev;
        }
        return [
          ...prev,
          {
            role: "assistant",
            text: "⚠️ IPC bridge unavailable. Renderer loaded, but preload communication is not ready.",
            isExecutionError: true,
          },
        ];
      });
      return () => undefined;
    }

    const unsub = window.skytest.on("chat:executionError", (data: unknown) => {
      const { reason, errors } = data as {
        reason: "schema" | "policy";
        errors: Array<{ stepIndex: number; message: string }>;
      };
      const label = reason === "policy" ? "Tool policy violation" : "DSL schema error";
      const details = errors.map((e) => `  • ${e.message}`).join("\n");
      setMessages((prev) => [
        ...prev,
        {
          role: "result" as const,
          text: `⛔ Execution blocked – ${label}\n\nThe plan was not executed because one or more steps are not permitted:\n${details}\n\nSwitch to a more permissive tool policy or adjust your request.`,
          isExecutionError: true,
          retryCommand: lastCommandRef.current || undefined,
        },
      ]);
    });
    return unsub;
  }, [hasBridge]);

  // Auto-scroll transcript to bottom on every new message
  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Memoized run handler; config is captured so changes to settings take effect immediately
  const handleRun = useCallback(async () => {
    if (!hasBridge) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "IPC bridge unavailable. Please restart the app so preload can initialize.",
          isExecutionError: true,
        },
      ]);
      return;
    }

    const typedCommand = inputRef.current.trim();
    if (!typedCommand) {
      const latestAssistantPlan = [...messages]
        .reverse()
        .filter((m) => m.role === "assistant" && !m.streaming)
        .map((m) => extractJsonFromAssistantMessage(m.text))
        .find((parsed) => {
          if (!parsed || typeof parsed !== "object") return false;
          const record = parsed as Record<string, unknown>;
          return Array.isArray(record.steps) && record.steps.length > 0;
        });

      if (latestAssistantPlan) {
        setRunning(true);
        try {
          const result = (await window.skytest.invoke("executeDSLPlan", {
            plan: latestAssistantPlan,
            intent: "Run latest chat-defined plan",
            environment: config.environment,
            browser: config.browser,
            headed: config.headed,
            toolPolicy: config.toolPolicy,
          })) as
            | { ok: true; run: { id: string; status: string; stepResults: Array<unknown> } }
            | {
                ok: false;
                reason: "schema" | "policy";
                errors: Array<{ stepIndex: number; message: string }>;
              };

          if (!result.ok) {
            const label = result.reason === "policy" ? "Tool policy violation" : "DSL schema error";
            const details = result.errors.map((e) => `  • ${e.message}`).join("\n");
            setMessages((prev) => [
              ...prev,
              {
                role: "result",
                text:
                  `⛔ Execution blocked – ${label}\n\n` +
                  `The latest plan could not be executed:\n${details}`,
                isExecutionError: true,
              },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                role: "result",
                text: `✅ Run ${result.run.status} (${result.run.stepResults.length} step(s)) [${result.run.id}]`,
              },
            ]);
          }
        } catch (err) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text: `Error running latest plan: ${String(err)}`,
              isExecutionError: true,
            },
          ]);
        } finally {
          setRunning(false);
        }
        return;
      }
    }

    const fallbackCommand =
      lastCommandRef.current ||
      [...messages].reverse().find((m) => m.role === "user" && m.command)?.command ||
      "";
    const command = typedCommand || fallbackCommand;

    if (!command) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "No command to run yet. Enter a command in Chat and click Run (or Send).",
        },
      ]);
      return;
    }

    lastCommandRef.current = command;
    setMessages((prev) => [...prev, { role: "user", text: command, command }]);
    if (typedCommand) {
      setInput("");
    }
    setRunning(true);

    let unsubscribe: (() => void) | null = null;

    try {
      // Issue #5: Send prompt to LLM Orchestrator via chat:send and stream tokens back.
      // Issue #6: Include chatHistory when resuming after a clarification so the LLM has context.
      const { streamId } = (await window.skytest.invoke("chat:send", {
        prompt: command,
        toolPolicy: config.toolPolicy,
        environment: config.environment,
        browser: config.browser,
        headed: config.headed,
        chatHistory: chatHistory.length > 0 ? chatHistory : undefined,
      })) as { streamId: string };

      // Capture the user message for history (will be committed on done)
      const userEntry: ChatHistoryEntry = { role: "user", content: command };

      // Accumulate streamed tokens in a temporary "streaming" message
      let accumulated = "";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "", streaming: true, streamId },
      ]);

      unsubscribe = window.skytest.on(
        "chat:stream",
        (data: unknown) => {
          const { streamId: sid, token, done, responseType } = data as {
            streamId: string;
            token: string;
            done: boolean;
            responseType?: "plan" | "clarification" | "error";
          };
          if (sid !== streamId) return;

          if (done) {
            if (unsubscribe) {
              unsubscribe();
              unsubscribe = null;
            }

            // Issue #6: Classify the completed response and enforce clarification flow.
            const isClarification = responseType === "clarification";
            setMessages((prev) =>
              prev.map((m) =>
                (m as { streamId?: string }).streamId === streamId
                  ? { ...m, streaming: false, isClarification }
                  : m
              )
            );

            if (isClarification) {
              // Persist this exchange in history so the next request can resolve the ambiguity.
              const assistantEntry: ChatHistoryEntry = {
                role: "assistant",
                content: accumulated,
                type: "clarification",
              };
              setChatHistory((prev) => [...prev, userEntry, assistantEntry]);
              setAwaitingClarification(true);
            } else {
              // Plan or error: clear history and clarification flag.
              setChatHistory([]);
              setAwaitingClarification(false);
            }

            setRunning(false);
            return;
          }

          accumulated += token;
          setMessages((prev) =>
            prev.map((m) =>
              (m as { streamId?: string }).streamId === streamId
                ? { ...m, text: accumulated }
                : m
            )
          );
        }
      );
    } catch (err) {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `Error: ${String(err)}`, retryCommand: command },
      ]);
      setRunning(false);
    }
  }, [config, chatHistory, hasBridge, messages]);

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
    const canonicalSteps = messages
      .filter((m) => m.role === "assistant" && !m.streaming)
      .map((m) => extractJsonFromAssistantMessage(m.text))
      .flatMap((parsed) => extractStepsFromPlanLikeJson(parsed));

    if (canonicalSteps.length === 0) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Save failed: no executable plan found in the chat yet. Run a command first, then save.",
        },
      ]);
      return;
    }

    const lastUserCommand = [...messages]
      .reverse()
      .find((m) => m.role === "user" && m.command)?.command;
    const shortCommand = lastUserCommand
      ? lastUserCommand.replace(/\s+/g, " ").trim().slice(0, 40)
      : "Untitled Test";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const testName = `${shortCommand || "Untitled Test"} ${timestamp}`;

    setSaving(true);
    try {
      const testCase = (await window.skytest.invoke("saveTest", {
        name: testName,
        steps: canonicalSteps,
        browser: config.browser,
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

  // SPEC §5.2: Retry affordance — populate input with the failed command so the user can re-send
  const handleRetry = useCallback((command: string) => {
    setInput(command);
  }, []);

  const hasUserMessages = messages.some((m) => m.role === "user");

  return (
    <div style={styles.container}>
      <div ref={transcriptRef} style={styles.transcript}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...styles.message,
              ...(msg.role === "user"
                ? styles.userMessage
                : msg.role === "result"
                ? msg.isExecutionError
                  ? styles.executionErrorMessage
                  : styles.resultMessage
                : msg.isClarification
                ? styles.clarificationMessage
                : styles.assistantMessage),
            }}
          >
            <span style={styles.role}>
              {msg.role === "user"
                ? "You"
                : msg.role === "result"
                ? msg.isExecutionError
                  ? "⛔ Execution Blocked"
                  : "Result"
                : msg.isClarification
                ? "❓ Needs Clarification"
                : "Assistant"}
            </span>
            <span style={msg.isExecutionError ? styles.preWrapText : styles.text}>{msg.text}</span>
            {msg.retryCommand && !running && (
              <button
                style={styles.retryButton}
                onClick={() => msg.retryCommand && handleRetry(msg.retryCommand)}
                type="button"
                title="Copy command back to input to retry"
              >
                🔁 Retry
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Issue #6: Show clarification banner when the system is awaiting user input */}
      {awaitingClarification && (
        <div style={styles.clarificationBanner}>
          ⚠️ Please answer the question above before execution resumes. No Playwright actions will run until clarified.
        </div>
      )}

      <div style={styles.inputRow}>
        <textarea
          style={styles.textarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            awaitingClarification
              ? "Type your clarification and press Send…"
              : "Enter a command… (Ctrl+Enter or ⌘+Enter to send)"
          }
          aria-label="Command input. Press Ctrl+Enter or Command+Enter to send."
          rows={3}
          disabled={running}
        />
        <button
          style={{ ...styles.sendButton, ...(running ? styles.buttonDisabled : {}) }}
          onClick={handleRun}
          disabled={running}
        >
          {running ? "Sending…" : "📤 Send"}
        </button>
      </div>

      <div style={styles.footer}>
        <span style={styles.hint}>
          Tool policy: <strong>{config.toolPolicy}</strong> · Browser:{" "}
          <strong>{config.browser}</strong> · Mode:{" "}
          <strong>{config.headed ? "headed" : "headless"}</strong> · Env:{" "}
          <strong>{config.environment}</strong>
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
  clarificationMessage: {
    alignSelf: "flex-start",
    backgroundColor: "#3d2e00",
    border: "1px solid #7a5c00",
    color: "#ffd580",
  },
  resultMessage: {
    alignSelf: "flex-start",
    backgroundColor: "#1a2d1a",
    border: "1px solid #3a5c3a",
    color: "#a8d5a2",
  },
  executionErrorMessage: {
    alignSelf: "flex-start",
    backgroundColor: "#2d1a1a",
    border: "1px solid #7a3a3a",
    color: "#f4a4a4",
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
  preWrapText: {
    fontSize: "0.875rem",
    lineHeight: "1.4",
    whiteSpace: "pre-wrap",
  },
  retryButton: {
    alignSelf: "flex-start",
    marginTop: "0.4rem",
    backgroundColor: "transparent",
    border: "1px solid currentColor",
    borderRadius: "4px",
    color: "inherit",
    cursor: "pointer",
    fontSize: "0.75rem",
    opacity: 0.8,
    padding: "0.2rem 0.6rem",
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
  sendButton: {
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
  clarificationBanner: {
    backgroundColor: "#3d2e00",
    border: "1px solid #7a5c00",
    borderRadius: "4px",
    color: "#ffd580",
    fontSize: "0.78rem",
    padding: "0.4rem 0.75rem",
  },
};
