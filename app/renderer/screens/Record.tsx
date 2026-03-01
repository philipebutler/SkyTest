/**
 * Record Mode Screen – Issue #21: Record Mode Capture Engine
 *
 * Displays real-time captured steps as the user interacts with the browser.
 * Provides Start/Stop controls and a "Save as Test" button once recording stops.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ActionStep, TestCase } from "../../shared/types";

// Typed IPC bridge exposed by preload.ts
declare global {
  interface Window {
    skytest: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
    };
  }
}

type RecordState = "idle" | "recording" | "stopped";

export default function RecordScreen(): React.ReactElement {
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const [steps, setSteps] = useState<ActionStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const stepListRef = useRef<HTMLDivElement>(null);

  // Auto-scroll step list to bottom as new steps arrive
  useEffect(() => {
    const el = stepListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [steps]);

  // Subscribe to real-time record:event pushes from the main process
  useEffect(() => {
    if (recordState !== "recording") return;

    const unsub = window.skytest.on("record:event", (data: unknown) => {
      setSteps((prev) => [...prev, data as ActionStep]);
    });

    return unsub;
  }, [recordState]);

  const handleStart = useCallback(async () => {
    setError(null);
    setSteps([]);
    try {
      await window.skytest.invoke("record:start", { browser: "chromium" });
      setRecordState("recording");
    } catch (err) {
      setError(`Failed to start recording: ${String(err)}`);
    }
  }, []);

  const handleStop = useCallback(async () => {
    try {
      const result = (await window.skytest.invoke("record:stop")) as { steps: ActionStep[] };
      setSteps(result.steps);
      setRecordState("stopped");
    } catch (err) {
      setError(`Failed to stop recording: ${String(err)}`);
      setRecordState("stopped");
    }
  }, []);

  const handleSaveAsTest = useCallback(async () => {
    if (steps.length === 0) return;
    const testName = window.prompt("Test name:", "Recorded Test");
    if (!testName) return;

    setSaving(true);
    try {
      const testCase = (await window.skytest.invoke("saveTest", {
        name: testName,
        steps,
      })) as TestCase;
      setError(null);
      alert(`✅ Saved as test "${testCase.name}" (${testCase.id})`);
    } catch (err) {
      setError(`Failed to save test: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [steps]);

  const handleReset = useCallback(() => {
    setSteps([]);
    setError(null);
    setRecordState("idle");
  }, []);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.heading}>Record Mode</h2>
        <div style={styles.controls}>
          {recordState === "idle" && (
            <button style={styles.startButton} onClick={() => void handleStart()} type="button">
              ⏺ Start Recording
            </button>
          )}
          {recordState === "recording" && (
            <button style={styles.stopButton} onClick={() => void handleStop()} type="button">
              ⏹ Stop Recording
            </button>
          )}
          {recordState === "stopped" && (
            <>
              <button
                style={{ ...styles.saveButton, ...(steps.length === 0 || saving ? styles.buttonDisabled : {}) }}
                onClick={() => void handleSaveAsTest()}
                disabled={steps.length === 0 || saving}
                type="button"
              >
                {saving ? "Saving…" : "💾 Save as Test"}
              </button>
              <button style={styles.resetButton} onClick={handleReset} type="button">
                🔄 New Recording
              </button>
            </>
          )}
        </div>
      </div>

      {/* Status badge */}
      <div
        style={{
          ...styles.statusBadge,
          ...(recordState === "recording" ? styles.statusRecording : {}),
          ...(recordState === "stopped" ? styles.statusStopped : {}),
        }}
      >
        {recordState === "idle" && "⬜ Ready — click Start Recording to open the browser"}
        {recordState === "recording" && "🔴 Recording… interact with the browser to capture steps"}
        {recordState === "stopped" && `✅ Recording stopped — ${steps.length} step${steps.length !== 1 ? "s" : ""} captured`}
      </div>

      {error && <div style={styles.errorBanner}>{error}</div>}

      {/* Step list */}
      <div style={styles.stepListWrapper}>
        <div ref={stepListRef} style={styles.stepList}>
          {steps.length === 0 ? (
            <p style={styles.emptyText}>
              {recordState === "idle"
                ? "No steps yet. Start recording to capture browser interactions."
                : recordState === "recording"
                ? "Waiting for interactions…"
                : "No steps were captured during this recording."}
            </p>
          ) : (
            steps.map((step, i) => (
              <div key={i} style={styles.stepRow}>
                <span style={styles.stepIndex}>{i + 1}</span>
                <code style={styles.stepAction}>{step.action}</code>
                {step.selector && (
                  <span style={styles.stepDetail} title={step.selector}>
                    {step.selector}
                  </span>
                )}
                {step.value && (
                  <span style={styles.stepValue} title={step.value}>
                    "{step.value}"
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Footer hint */}
      <div style={styles.footer}>
        <span style={styles.hint}>
          Captured steps are saved as a raw recording file and can be replayed as a test.
        </span>
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
    color: "#d4d4d4",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  heading: {
    fontSize: "1.25rem",
    fontWeight: "bold",
    margin: 0,
  },
  controls: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
  },
  startButton: {
    backgroundColor: "#c0392b",
    border: "none",
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "0.875rem",
    padding: "0.45rem 1rem",
  },
  stopButton: {
    backgroundColor: "#555",
    border: "1px solid #888",
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "0.875rem",
    padding: "0.45rem 1rem",
  },
  saveButton: {
    backgroundColor: "#2d4a22",
    border: "1px solid #4a7a38",
    borderRadius: "4px",
    color: "#a8d5a2",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "0.875rem",
    padding: "0.45rem 1rem",
  },
  resetButton: {
    backgroundColor: "transparent",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#888",
    cursor: "pointer",
    fontSize: "0.875rem",
    padding: "0.45rem 0.8rem",
  },
  buttonDisabled: {
    backgroundColor: "#555",
    borderColor: "#555",
    color: "#999",
    cursor: "not-allowed",
  },
  statusBadge: {
    backgroundColor: "#252526",
    border: "1px solid #3c3c3c",
    borderRadius: "6px",
    color: "#aaa",
    fontSize: "0.8rem",
    padding: "0.5rem 0.75rem",
  },
  statusRecording: {
    backgroundColor: "#3d1a1a",
    borderColor: "#c0392b",
    color: "#f4a4a4",
  },
  statusStopped: {
    backgroundColor: "#1a2d1a",
    borderColor: "#3a5c3a",
    color: "#a8d5a2",
  },
  errorBanner: {
    backgroundColor: "#2d1a1a",
    border: "1px solid #7a3a3a",
    borderRadius: "4px",
    color: "#f4a4a4",
    fontSize: "0.8rem",
    padding: "0.4rem 0.75rem",
  },
  stepListWrapper: {
    flex: 1,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  stepList: {
    flex: 1,
    overflowY: "auto",
    backgroundColor: "#1a1a1a",
    border: "1px solid #3c3c3c",
    borderRadius: "6px",
    padding: "0.5rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
  },
  stepRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.25rem 0.4rem",
    borderRadius: "4px",
    backgroundColor: "#252526",
    flexWrap: "wrap",
  },
  stepIndex: {
    color: "#666",
    fontSize: "0.7rem",
    minWidth: "1.4rem",
    textAlign: "right",
    flexShrink: 0,
  },
  stepAction: {
    backgroundColor: "#2d2d2d",
    borderRadius: "3px",
    color: "#9cdcfe",
    fontFamily: "monospace",
    fontSize: "0.78rem",
    padding: "0.05rem 0.35rem",
    flexShrink: 0,
  },
  stepDetail: {
    color: "#888",
    fontSize: "0.75rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "300px",
  },
  stepValue: {
    color: "#ce9178",
    fontSize: "0.75rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "200px",
  },
  emptyText: {
    color: "#666",
    fontSize: "0.8rem",
    textAlign: "center",
    marginTop: "2rem",
  },
  footer: {
    paddingTop: "0.25rem",
    borderTop: "1px solid #3c3c3c",
  },
  hint: {
    color: "#666",
    fontSize: "0.75rem",
  },
};
