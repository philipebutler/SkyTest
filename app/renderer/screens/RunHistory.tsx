/**
 * RunHistory – Issue #19: Run History UI
 *
 * Acceptance Criteria:
 *  - Run list with status icons
 *  - Filter by env/browser/date
 *  - Click run to view details
 *  - Step timeline visible
 */

import React, { useCallback, useEffect, useState } from "react";
import type { Run, StepResult, AssertionResult } from "../../shared/types";

const STATUS_ICON: Record<Run["status"], string> = {
  passed: "✅",
  failed: "❌",
  running: "⏳",
  aborted: "🚫",
};

const STATUS_LABEL: Record<Run["status"], string> = {
  passed: "Passed",
  failed: "Failed",
  running: "Running",
  aborted: "Aborted",
};

const STEP_STATUS_ICON: Record<StepResult["status"], string> = {
  passed: "✅",
  failed: "❌",
  skipped: "⏭",
};

function formatDuration(startedAt: string, finishedAt?: string): string {
  if (!finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function RunHistory(): React.ReactElement {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterEnv, setFilterEnv] = useState("");
  const [filterBrowser, setFilterBrowser] = useState("");
  const [filterDate, setFilterDate] = useState("");

  // Selected run for the detail panel
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await window.skytest.invoke("getRunHistory")) as Run[];
      setRuns(result);
    } catch (err) {
      setError(`Failed to load run history: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // Collect unique envs and browsers for filter dropdowns
  const allEnvs = Array.from(new Set(runs.map((r) => r.environment).filter(Boolean))).sort();
  const allBrowsers = Array.from(new Set(runs.map((r) => r.browser).filter(Boolean))).sort();

  // Apply filters
  const filteredRuns = runs.filter((r) => {
    if (filterEnv && r.environment !== filterEnv) return false;
    if (filterBrowser && r.browser !== filterBrowser) return false;
    if (filterDate) {
      const runDate = new Date(r.startedAt).toISOString().slice(0, 10); // "YYYY-MM-DD"
      if (runDate !== filterDate) return false;
    }
    return true;
  });

  const clearFilters = () => {
    setFilterEnv("");
    setFilterBrowser("");
    setFilterDate("");
  };

  const hasFilters = filterEnv || filterBrowser || filterDate;

  if (loading) {
    return (
      <div style={styles.container}>
        <p style={styles.loading}>Loading run history…</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.heading}>Run History</h2>
        <button
          style={styles.refreshButton}
          onClick={() => void loadRuns()}
          title="Refresh run history"
          type="button"
        >
          🔄 Refresh
        </button>
      </div>

      {error && <p style={styles.errorText}>{error}</p>}

      {/* Filters */}
      <div style={styles.filterRow}>
        <label style={styles.filterLabel} htmlFor="filter-env">Environment</label>
        <select
          id="filter-env"
          style={styles.filterSelect}
          value={filterEnv}
          onChange={(e) => setFilterEnv(e.target.value)}
          aria-label="Filter by environment"
        >
          <option value="">All</option>
          {allEnvs.map((env) => (
            <option key={env} value={env}>{env}</option>
          ))}
        </select>

        <label style={styles.filterLabel} htmlFor="filter-browser">Browser</label>
        <select
          id="filter-browser"
          style={styles.filterSelect}
          value={filterBrowser}
          onChange={(e) => setFilterBrowser(e.target.value)}
          aria-label="Filter by browser"
        >
          <option value="">All</option>
          {allBrowsers.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>

        <label style={styles.filterLabel} htmlFor="filter-date">Date</label>
        <input
          id="filter-date"
          style={styles.dateInput}
          type="date"
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          aria-label="Filter by date"
        />

        {hasFilters && (
          <button
            style={styles.clearButton}
            onClick={clearFilters}
            title="Clear all filters"
            type="button"
          >
            ✕ Clear
          </button>
        )}
      </div>

      <div style={styles.body}>
        {/* Run list */}
        <div style={styles.list}>
          {filteredRuns.length === 0 ? (
            <p style={styles.emptyText}>
              {runs.length === 0
                ? "No runs yet. Use the Chat screen or Test Library to execute a test."
                : "No runs match your filters."}
            </p>
          ) : (
            filteredRuns.map((run) => {
              const isSelected = selectedRun?.id === run.id;
              return (
                <button
                  key={run.id}
                  style={{
                    ...styles.runCard,
                    ...(isSelected ? styles.runCardSelected : {}),
                  }}
                  onClick={() => setSelectedRun(isSelected ? null : run)}
                  title={isSelected ? "Close details" : "View run details"}
                  type="button"
                  aria-pressed={isSelected}
                >
                  <span style={styles.statusIcon} aria-label={STATUS_LABEL[run.status]}>
                    {STATUS_ICON[run.status]}
                  </span>
                  <div style={styles.runInfo}>
                    <div style={styles.runTitle}>
                      <span style={styles.runId}>{run.id}</span>
                      {run.testId && (
                        <span style={styles.runTestId}>· {run.testId}</span>
                      )}
                    </div>
                    <div style={styles.runMeta}>
                      <span>{run.environment}</span>
                      <span aria-hidden="true">·</span>
                      <span>{run.browser}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDate(run.startedAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDuration(run.startedAt, run.finishedAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{run.stepResults.length} step{run.stepResults.length !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <span
                    style={{
                      ...styles.statusBadge,
                      ...(run.status === "passed" ? styles.badgePassed : {}),
                      ...(run.status === "failed" ? styles.badgeFailed : {}),
                      ...(run.status === "running" ? styles.badgeRunning : {}),
                      ...(run.status === "aborted" ? styles.badgeAborted : {}),
                    }}
                  >
                    {STATUS_LABEL[run.status]}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Detail panel */}
        {selectedRun && (
          <div style={styles.detailPanel}>
            <div style={styles.detailHeader}>
              <h3 style={styles.detailTitle}>Run Details</h3>
              <button
                style={styles.closeButton}
                onClick={() => setSelectedRun(null)}
                title="Close"
                type="button"
              >
                ✕
              </button>
            </div>

            {/* Metadata */}
            <div style={styles.detailMeta}>
              <span>
                Status:{" "}
                <strong>
                  {STATUS_ICON[selectedRun.status]} {STATUS_LABEL[selectedRun.status]}
                </strong>
              </span>
              <span>ID: <code style={styles.code}>{selectedRun.id}</code></span>
              {selectedRun.testId && (
                <span>Test: <code style={styles.code}>{selectedRun.testId}</code></span>
              )}
              <span>Environment: <strong>{selectedRun.environment}</strong></span>
              <span>Browser: <strong>{selectedRun.browser}</strong></span>
              <span>Headed: <strong>{selectedRun.headed ? "Yes" : "No"}</strong></span>
              <span>Tool Policy: <strong>{selectedRun.toolPolicy}</strong></span>
              <span>Started: {formatDate(selectedRun.startedAt)}</span>
              {selectedRun.finishedAt && (
                <span>
                  Finished: {formatDate(selectedRun.finishedAt)} &nbsp;
                  (Duration: {formatDuration(selectedRun.startedAt, selectedRun.finishedAt)})
                </span>
              )}
            </div>

            {/* Step timeline */}
            <div style={styles.detailSection}>
              <strong style={styles.detailLabel}>
                Step Timeline ({selectedRun.stepResults.length})
              </strong>
              {selectedRun.stepResults.length === 0 ? (
                <p style={styles.emptyText}>No steps recorded.</p>
              ) : (
                <ol style={styles.timeline} aria-label="Step timeline">
                  {selectedRun.stepResults.map((step) => (
                    <li
                      key={step.stepIndex}
                      style={{
                        ...styles.timelineItem,
                        ...(step.status === "passed" ? styles.timelineItemPassed : {}),
                        ...(step.status === "failed" ? styles.timelineItemFailed : {}),
                        ...(step.status === "skipped" ? styles.timelineItemSkipped : {}),
                      }}
                    >
                      <span style={styles.timelineIcon} aria-label={step.status}>
                        {STEP_STATUS_ICON[step.status]}
                      </span>
                      <div style={styles.timelineContent}>
                        <span style={styles.timelineAction}>
                          <code style={styles.code}>{step.action}</code>
                        </span>
                        <span style={styles.timelineDuration}>
                          {step.durationMs}ms
                        </span>
                        {step.error && (
                          <span style={styles.timelineError}>{step.error}</span>
                        )}
                        {step.artifactIds.length > 0 && (
                          <span style={styles.timelineArtifacts}>
                            📎 {step.artifactIds.length} artifact{step.artifactIds.length !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {/* Assertion results */}
            {selectedRun.assertionResults && selectedRun.assertionResults.length > 0 && (
              <div style={styles.detailSection}>
                <strong style={styles.detailLabel}>
                  Assertions ({selectedRun.assertionResults.length})
                </strong>
                <ol style={styles.timeline} aria-label="Assertion results">
                  {selectedRun.assertionResults.map((a: AssertionResult) => (
                    <li
                      key={a.assertionIndex}
                      style={{
                        ...styles.timelineItem,
                        ...(a.status === "passed" ? styles.timelineItemPassed : styles.timelineItemFailed),
                      }}
                    >
                      <span style={styles.timelineIcon} aria-label={a.status}>
                        {a.status === "passed" ? "✅" : "❌"}
                      </span>
                      <div style={styles.timelineContent}>
                        <code style={styles.code}>{a.type}</code>
                        {a.error && (
                          <span style={styles.timelineError}>{a.error}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Artifacts */}
            {selectedRun.artifacts.length > 0 && (
              <div style={styles.detailSection}>
                <strong style={styles.detailLabel}>
                  Artifacts ({selectedRun.artifacts.length})
                </strong>
                <ul style={styles.artifactList}>
                  {selectedRun.artifacts.map((artifact) => (
                    <li key={artifact.id} style={styles.artifactItem}>
                      <span style={styles.artifactType}>{artifact.type}</span>
                      <code style={styles.artifactPath}>{artifact.path}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
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
  },
  heading: {
    fontSize: "1.25rem",
    fontWeight: "bold",
    margin: 0,
  },
  refreshButton: {
    backgroundColor: "transparent",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#888",
    cursor: "pointer",
    padding: "0.3rem 0.7rem",
    fontSize: "0.75rem",
  },
  filterRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  filterLabel: {
    fontSize: "0.75rem",
    color: "#aaa",
    whiteSpace: "nowrap",
  },
  filterSelect: {
    backgroundColor: "#1e1e1e",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#d4d4d4",
    padding: "0.3rem 0.5rem",
    fontSize: "0.8rem",
    fontFamily: "inherit",
  },
  dateInput: {
    backgroundColor: "#1e1e1e",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#d4d4d4",
    padding: "0.3rem 0.5rem",
    fontSize: "0.8rem",
    fontFamily: "inherit",
  },
  clearButton: {
    backgroundColor: "transparent",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#888",
    cursor: "pointer",
    padding: "0.3rem 0.5rem",
    fontSize: "0.75rem",
  },
  body: {
    display: "flex",
    flex: 1,
    gap: "0.75rem",
    overflow: "hidden",
    minHeight: 0,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
    flex: 1,
    overflowY: "auto",
    minWidth: 0,
  },
  runCard: {
    backgroundColor: "#252526",
    border: "1px solid #3c3c3c",
    borderRadius: "6px",
    padding: "0.6rem 0.75rem",
    display: "flex",
    alignItems: "center",
    gap: "0.65rem",
    cursor: "pointer",
    textAlign: "left",
    color: "#d4d4d4",
    width: "100%",
  },
  runCardSelected: {
    borderColor: "#007acc",
    backgroundColor: "#1e2d3d",
  },
  statusIcon: {
    fontSize: "1.1rem",
    flexShrink: 0,
  },
  runInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
  },
  runTitle: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    overflow: "hidden",
  },
  runId: {
    fontSize: "0.78rem",
    fontFamily: "monospace",
    color: "#9cdcfe",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  runTestId: {
    fontSize: "0.75rem",
    color: "#888",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  runMeta: {
    display: "flex",
    gap: "0.3rem",
    fontSize: "0.72rem",
    color: "#888",
    flexWrap: "wrap",
  },
  statusBadge: {
    fontSize: "0.7rem",
    fontWeight: "bold",
    padding: "0.15rem 0.5rem",
    borderRadius: "10px",
    flexShrink: 0,
    backgroundColor: "#333",
    color: "#aaa",
  },
  badgePassed: {
    backgroundColor: "#1a3d1a",
    color: "#5cba5c",
    border: "1px solid #3a7a3a",
  },
  badgeFailed: {
    backgroundColor: "#3d1a1a",
    color: "#f46b6b",
    border: "1px solid #7a3a3a",
  },
  badgeRunning: {
    backgroundColor: "#1a2d3d",
    color: "#6aafd6",
    border: "1px solid #007acc",
  },
  badgeAborted: {
    backgroundColor: "#2d2d1a",
    color: "#c8a96b",
    border: "1px solid #7a6a3a",
  },
  emptyText: {
    color: "#888",
    fontSize: "0.875rem",
    textAlign: "center",
    marginTop: "2rem",
  },
  loading: {
    color: "#888",
    fontSize: "0.875rem",
  },
  errorText: {
    color: "#f44336",
    fontSize: "0.8rem",
  },
  // Detail panel
  detailPanel: {
    backgroundColor: "#1e1e1e",
    border: "1px solid #3c3c3c",
    borderRadius: "6px",
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    overflowY: "auto",
    padding: "0.75rem",
    width: "400px",
    flexShrink: 0,
  },
  detailHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "0.5rem",
  },
  detailTitle: {
    fontSize: "1rem",
    fontWeight: "bold",
    margin: 0,
    flex: 1,
  },
  closeButton: {
    background: "none",
    border: "none",
    color: "#888",
    cursor: "pointer",
    fontSize: "1rem",
    flexShrink: 0,
    padding: "0 0.2rem",
  },
  detailMeta: {
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
    fontSize: "0.75rem",
    color: "#aaa",
  },
  detailSection: {
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  detailLabel: {
    fontSize: "0.8rem",
    color: "#aaa",
    display: "block",
  },
  code: {
    backgroundColor: "#2d2d2d",
    borderRadius: "3px",
    fontFamily: "monospace",
    fontSize: "0.75rem",
    padding: "0.05rem 0.3rem",
    color: "#9cdcfe",
  },
  // Step timeline
  timeline: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
  },
  timelineItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.5rem",
    padding: "0.35rem 0.5rem",
    borderRadius: "4px",
    backgroundColor: "#252526",
    border: "1px solid #3c3c3c",
  },
  timelineItemPassed: {
    borderColor: "#3a5c3a",
    backgroundColor: "#1a2d1a",
  },
  timelineItemFailed: {
    borderColor: "#7a3a3a",
    backgroundColor: "#2d1a1a",
  },
  timelineItemSkipped: {
    borderColor: "#555",
    backgroundColor: "#252526",
    opacity: 0.6,
  },
  timelineIcon: {
    fontSize: "0.85rem",
    flexShrink: 0,
    marginTop: "0.05rem",
  },
  timelineContent: {
    display: "flex",
    flexDirection: "column",
    gap: "0.15rem",
    flex: 1,
    minWidth: 0,
  },
  timelineAction: {
    fontSize: "0.8rem",
    color: "#ccc",
  },
  timelineDuration: {
    fontSize: "0.7rem",
    color: "#666",
  },
  timelineError: {
    fontSize: "0.72rem",
    color: "#f4a4a4",
    wordBreak: "break-word",
  },
  timelineArtifacts: {
    fontSize: "0.7rem",
    color: "#888",
  },
  // Artifact list
  artifactList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
  },
  artifactItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    fontSize: "0.75rem",
    color: "#aaa",
  },
  artifactType: {
    backgroundColor: "#2d2d2d",
    borderRadius: "3px",
    fontSize: "0.7rem",
    padding: "0.05rem 0.35rem",
    color: "#c8a96b",
    flexShrink: 0,
    textTransform: "uppercase",
  },
  artifactPath: {
    fontFamily: "monospace",
    fontSize: "0.7rem",
    color: "#888",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};
