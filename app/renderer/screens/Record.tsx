/**
 * Record Mode Screen – Issue #21 / Issue #22
 *
 * Issue #21: Displays real-time captured steps as the user interacts with the browser.
 *            Provides Start/Stop controls.
 *
 * Issue #22: After recording stops, allows the user to:
 *   1. Refactor the raw recording with the LLM ("Refactor with AI" button).
 *   2. Review and edit the refactored steps and suggested assertions.
 *   3. Save the reviewed TestCase to the test library.
 *   The user may also skip AI refactoring and save the raw recording directly.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ActionStep, Assertion, RefactoredRecording, TestCase } from "../../shared/types";

// Typed IPC bridge exposed by preload.ts
declare global {
  interface Window {
    skytest: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
    };
  }
}

type RecordState = "idle" | "recording" | "stopped" | "refactoring" | "reviewing";

/** Editable row for a single suggested assertion. */
function AssertionRow({
  assertion,
  index,
  onChange,
  onRemove,
}: {
  assertion: Assertion;
  index: number;
  onChange: (index: number, updated: Assertion) => void;
  onRemove: (index: number) => void;
}): React.ReactElement {
  return (
    <div style={styles.assertionRow}>
      <span style={styles.stepIndex}>{index + 1}</span>
      <select
        style={styles.assertionTypeSelect}
        value={assertion.type}
        onChange={(e) => onChange(index, { ...assertion, type: e.target.value as Assertion["type"] })}
        aria-label={`Assertion ${index + 1} type`}
      >
        <option value="textVisible">textVisible</option>
        <option value="elementVisible">elementVisible</option>
        <option value="urlContains">urlContains</option>
        <option value="countEquals">countEquals</option>
      </select>
      <input
        style={styles.assertionInput}
        placeholder="selector (optional)"
        value={assertion.selector ?? ""}
        onChange={(e) => onChange(index, { ...assertion, selector: e.target.value || undefined })}
        aria-label={`Assertion ${index + 1} selector`}
      />
      <input
        style={styles.assertionInput}
        placeholder="value (optional)"
        value={assertion.value ?? ""}
        onChange={(e) => onChange(index, { ...assertion, value: e.target.value || undefined })}
        aria-label={`Assertion ${index + 1} value`}
      />
      <button
        style={styles.removeButton}
        onClick={() => onRemove(index)}
        type="button"
        aria-label={`Remove assertion ${index + 1}`}
        title="Remove"
      >
        ✕
      </button>
    </div>
  );
}

export default function RecordScreen(): React.ReactElement {
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const [steps, setSteps] = useState<ActionStep[]>([]);
  const [refactored, setRefactored] = useState<RefactoredRecording | null>(null);
  const [editedAssertions, setEditedAssertions] = useState<Assertion[]>([]);
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
    setRefactored(null);
    setEditedAssertions([]);
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

  // Issue #22: Send raw steps to LLM for refactoring; show review panel on success.
  const handleRefactor = useCallback(async () => {
    if (steps.length === 0) return;
    setError(null);
    setRecordState("refactoring");
    try {
      const result = (await window.skytest.invoke("record:refactor", { steps })) as RefactoredRecording;
      setRefactored(result);
      setEditedAssertions(result.assertions ?? []);
      setRecordState("reviewing");
    } catch (err) {
      setError(`Refactoring failed: ${String(err)}`);
      setRecordState("stopped");
    }
  }, [steps]);

  // Save raw recording (skips AI refactoring) – Issue #21 path
  const handleSaveRaw = useCallback(async () => {
    if (steps.length === 0) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const testName = `Recorded Test ${timestamp}`;

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

  // Save the reviewed + (optionally edited) refactored TestCase – Issue #22 path
  const handleSaveRefactored = useCallback(async () => {
    if (!refactored) return;
    const defaultName = refactored.intent !== "Recorded test" && refactored.intent !== "Empty recording"
      ? refactored.intent
      : "Recorded Test";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const testName = `${defaultName} ${timestamp}`;

    setSaving(true);
    try {
      const testCase = (await window.skytest.invoke("saveTest", {
        name: testName,
        steps: refactored.steps,
        assertions: editedAssertions,
      })) as TestCase;
      setError(null);
      alert(`✅ Saved as test "${testCase.name}" (${testCase.id})`);
    } catch (err) {
      setError(`Failed to save test: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [refactored, editedAssertions]);

  const handleAddAssertion = useCallback(() => {
    setEditedAssertions((prev) => [...prev, { type: "elementVisible" }]);
  }, []);

  const handleAssertionChange = useCallback((index: number, updated: Assertion) => {
    setEditedAssertions((prev) => prev.map((a, i) => (i === index ? updated : a)));
  }, []);

  const handleAssertionRemove = useCallback((index: number) => {
    setEditedAssertions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleReset = useCallback(() => {
    setSteps([]);
    setRefactored(null);
    setEditedAssertions([]);
    setError(null);
    setRecordState("idle");
  }, []);

  const displaySteps: ActionStep[] = recordState === "reviewing" && refactored ? refactored.steps : steps;
  const stepListLabel =
    recordState === "reviewing"
      ? `Refactored Steps (${displaySteps.length})`
      : `Captured Steps (${displaySteps.length})`;

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
                style={{ ...styles.refactorButton, ...(steps.length === 0 ? styles.buttonDisabled : {}) }}
                onClick={() => void handleRefactor()}
                disabled={steps.length === 0}
                type="button"
                title="Send the recording to the LLM to clean up selectors and suggest assertions"
              >
                🤖 Refactor with AI
              </button>
              <button
                style={{ ...styles.saveButton, ...(steps.length === 0 || saving ? styles.buttonDisabled : {}) }}
                onClick={() => void handleSaveRaw()}
                disabled={steps.length === 0 || saving}
                type="button"
              >
                {saving ? "Saving…" : "💾 Save Raw"}
              </button>
              <button style={styles.resetButton} onClick={handleReset} type="button">
                🔄 New Recording
              </button>
            </>
          )}
          {recordState === "refactoring" && (
            <span style={styles.refactoringHint}>🤖 Refactoring with AI…</span>
          )}
          {recordState === "reviewing" && (
            <>
              <button
                style={{ ...styles.saveButton, ...(saving ? styles.buttonDisabled : {}) }}
                onClick={() => void handleSaveRefactored()}
                disabled={saving}
                type="button"
              >
                {saving ? "Saving…" : "💾 Save Refactored Test"}
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
          ...(recordState === "reviewing" ? styles.statusReviewing : {}),
        }}
      >
        {recordState === "idle" && "⬜ Ready — click Start Recording to open the browser"}
        {recordState === "recording" && "🔴 Recording… interact with the browser to capture steps"}
        {recordState === "stopped" &&
          `✅ Recording stopped — ${steps.length} step${steps.length !== 1 ? "s" : ""} captured. Refactor with AI or save raw.`}
        {recordState === "refactoring" &&
          "🤖 Asking the LLM to clean up selectors and suggest assertions…"}
        {recordState === "reviewing" &&
          "🔍 Review the refactored test — edit assertions below, then save when ready."}
      </div>

      {error && <div style={styles.errorBanner}>{error}</div>}

      {/* Step list */}
      <div style={styles.sectionLabel}>{stepListLabel}</div>
      <div style={styles.stepListWrapper}>
        <div ref={stepListRef} style={styles.stepList}>
          {displaySteps.length === 0 ? (
            <p style={styles.emptyText}>
              {recordState === "idle"
                ? "No steps yet. Start recording to capture browser interactions."
                : recordState === "recording"
                ? "Waiting for interactions…"
                : "No steps were captured during this recording."}
            </p>
          ) : (
            displaySteps.map((step, i) => (
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

      {/* Assertions review panel – shown only in reviewing state (Issue #22) */}
      {recordState === "reviewing" && (
        <div style={styles.assertionsPanel}>
          <div style={styles.assertionsPanelHeader}>
            <span style={styles.sectionLabel}>Suggested Assertions (editable)</span>
            <button style={styles.addAssertionButton} onClick={handleAddAssertion} type="button">
              + Add Assertion
            </button>
          </div>
          {editedAssertions.length === 0 ? (
            <p style={styles.emptyText}>No assertions suggested. Click "+ Add Assertion" to add one.</p>
          ) : (
            editedAssertions.map((assertion, i) => (
              <AssertionRow
                key={i}
                assertion={assertion}
                index={i}
                onChange={handleAssertionChange}
                onRemove={handleAssertionRemove}
              />
            ))
          )}
        </div>
      )}

      {/* Footer hint */}
      <div style={styles.footer}>
        <span style={styles.hint}>
          {recordState === "reviewing"
            ? `Edit assertions above then click "💾 Save Refactored Test" — the assertions will be run when you execute this test.`
            : "Captured steps are saved as a raw recording file and can be replayed as a test."}
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
  refactorButton: {
    backgroundColor: "#1a3a5c",
    border: "1px solid #3a7ab8",
    borderRadius: "4px",
    color: "#7ec8f4",
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
  refactoringHint: {
    color: "#7ec8f4",
    fontSize: "0.875rem",
    fontStyle: "italic",
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
  statusReviewing: {
    backgroundColor: "#1a2d3d",
    borderColor: "#3a5c8c",
    color: "#a2c8d5",
  },
  errorBanner: {
    backgroundColor: "#2d1a1a",
    border: "1px solid #7a3a3a",
    borderRadius: "4px",
    color: "#f4a4a4",
    fontSize: "0.8rem",
    padding: "0.4rem 0.75rem",
  },
  sectionLabel: {
    color: "#888",
    fontSize: "0.75rem",
    fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  stepListWrapper: {
    flex: 1,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    minHeight: "6rem",
    maxHeight: "14rem",
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
  // Assertions panel (Issue #22)
  assertionsPanel: {
    backgroundColor: "#1a1a2a",
    border: "1px solid #3c3c5c",
    borderRadius: "6px",
    padding: "0.6rem 0.75rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    maxHeight: "12rem",
    overflowY: "auto",
  },
  assertionsPanelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  assertionRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    flexWrap: "wrap",
  },
  assertionTypeSelect: {
    backgroundColor: "#2d2d3d",
    border: "1px solid #555",
    borderRadius: "3px",
    color: "#d4d4d4",
    fontSize: "0.75rem",
    padding: "0.15rem 0.3rem",
  },
  assertionInput: {
    backgroundColor: "#2d2d3d",
    border: "1px solid #555",
    borderRadius: "3px",
    color: "#d4d4d4",
    fontSize: "0.75rem",
    padding: "0.15rem 0.4rem",
    flex: 1,
    minWidth: "80px",
  },
  removeButton: {
    backgroundColor: "transparent",
    border: "1px solid #555",
    borderRadius: "3px",
    color: "#888",
    cursor: "pointer",
    fontSize: "0.7rem",
    padding: "0.1rem 0.4rem",
  },
  addAssertionButton: {
    backgroundColor: "transparent",
    border: "1px solid #3a5c8c",
    borderRadius: "3px",
    color: "#7ec8f4",
    cursor: "pointer",
    fontSize: "0.75rem",
    padding: "0.2rem 0.6rem",
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
