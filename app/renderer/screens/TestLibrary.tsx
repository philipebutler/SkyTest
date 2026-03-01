/**
 * TestLibrary – Issue #16: Test Library UI
 *
 * Acceptance Criteria:
 *  - Folder/tag navigation (click a tag pill to filter)
 *  - Search by name/tag
 *  - Open test in editor (inline detail/editor panel)
 *  - Run test from UI (via executeTest IPC, result shown inline)
 */

import React, { useCallback, useEffect, useState } from "react";
import type { AppConfig } from "../App";
import type { Run, TestCase } from "../../shared/types";

interface Props {
  config: AppConfig;
}

type RunStatus = "idle" | "running" | "passed" | "failed";

interface TestRunState {
  status: RunStatus;
  run?: Run;
}

export default function TestLibrary({ config }: Props): React.ReactElement {
  const [tests, setTests] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search and tag filter
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Selected test for the detail/editor panel
  const [selectedTest, setSelectedTest] = useState<TestCase | null>(null);

  // Per-test run state
  const [runStates, setRunStates] = useState<Record<string, TestRunState>>({});

  // Delete confirmation
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const loadTests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = (await window.skytest.invoke("listTests")) as TestCase[];
      setTests(result);
    } catch (err) {
      setError(`Failed to load tests: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTests();
  }, [loadTests]);

  // Collect all unique tags across all tests
  const allTags = Array.from(
    new Set(tests.flatMap((t) => t.tags ?? []))
  ).sort();

  // Filter tests by search query and selected tag
  const filteredTests = tests.filter((t) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      t.name.toLowerCase().includes(q) ||
      (t.tags ?? []).some((tag) => tag.toLowerCase().includes(q));
    const matchesTag = !selectedTag || (t.tags ?? []).includes(selectedTag);
    return matchesSearch && matchesTag;
  });

  const handleRunTest = useCallback(
    async (testId: string) => {
      setRunStates((prev) => ({ ...prev, [testId]: { status: "running" } }));
      try {
        const run = (await window.skytest.invoke("executeTest", {
          testId,
        })) as Run;
        setRunStates((prev) => ({
          ...prev,
          [testId]: { status: run.status === "passed" ? "passed" : "failed", run },
        }));
      } catch (err) {
        setRunStates((prev) => ({
          ...prev,
          [testId]: { status: "failed" },
        }));
        console.error("[TestLibrary] executeTest error:", err);
      }
    },
    []
  );

  const handleDeleteTest = useCallback(
    async (testId: string) => {
      try {
        await window.skytest.invoke("deleteTest", { testId });
        if (selectedTest?.id === testId) {
          setSelectedTest(null);
        }
        setPendingDelete(null);
        await loadTests();
      } catch (err) {
        console.error("[TestLibrary] deleteTest error:", err);
      }
    },
    [selectedTest, loadTests]
  );

  const handleSelectTag = (tag: string) => {
    setSelectedTag((prev) => (prev === tag ? null : tag));
  };

  const runState = (testId: string): TestRunState =>
    runStates[testId] ?? { status: "idle" };

  if (loading) {
    return (
      <div style={styles.container}>
        <p style={styles.loading}>Loading tests…</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.heading}>Test Library</h2>
        <button style={styles.refreshButton} onClick={() => void loadTests()} title="Refresh test list" type="button">
          🔄 Refresh
        </button>
      </div>

      {error && <p style={styles.errorText}>{error}</p>}

      {/* Search bar */}
      <div style={styles.searchRow}>
        <input
          style={styles.searchInput}
          type="search"
          placeholder="Search by name or tag…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search tests by name or tag"
        />
        {searchQuery && (
          <button
            style={styles.clearButton}
            onClick={() => setSearchQuery("")}
            title="Clear search"
            type="button"
          >
            ✕
          </button>
        )}
      </div>

      {/* Tag navigation */}
      {allTags.length > 0 && (
        <div style={styles.tagNav} role="list" aria-label="Filter by tag">
          {allTags.map((tag) => (
            <button
              key={tag}
              role="listitem"
              style={{
                ...styles.tagPill,
                ...(selectedTag === tag ? styles.tagPillActive : {}),
              }}
              onClick={() => handleSelectTag(tag)}
              title={selectedTag === tag ? `Remove filter: ${tag}` : `Filter by tag: ${tag}`}
              type="button"
            >
              {tag}
            </button>
          ))}
          {selectedTag && (
            <button
              style={styles.clearTagButton}
              onClick={() => setSelectedTag(null)}
              title="Clear tag filter"
              type="button"
            >
              ✕ Clear tag
            </button>
          )}
        </div>
      )}

      <div style={styles.body}>
        {/* Test list */}
        <div style={styles.list}>
          {filteredTests.length === 0 ? (
            <p style={styles.emptyText}>
              {tests.length === 0
                ? "No tests saved yet. Use the Chat screen to create a test."
                : "No tests match your search."}
            </p>
          ) : (
            filteredTests.map((test) => {
              const rs = runState(test.id);
              const isSelected = selectedTest?.id === test.id;
              return (
                <div
                  key={test.id}
                  style={{
                    ...styles.testCard,
                    ...(isSelected ? styles.testCardSelected : {}),
                  }}
                >
                  {/* Test header row */}
                  <div style={styles.testCardHeader}>
                    <button
                      style={styles.testNameButton}
                      onClick={() =>
                        setSelectedTest(isSelected ? null : test)
                      }
                      title={isSelected ? "Close details" : "Open test details"}
                      type="button"
                    >
                      <span style={styles.testName}>{test.name}</span>
                      <span style={styles.testMeta}>
                        {test.steps.length} step{test.steps.length !== 1 ? "s" : ""}
                        {test.browser ? ` · ${test.browser}` : ""}
                      </span>
                    </button>
                    <div style={styles.testActions}>
                      {/* Run button */}
                      <button
                        style={{
                          ...styles.runButton,
                          ...(rs.status === "running" ? styles.buttonDisabled : {}),
                          ...(rs.status === "passed" ? styles.runButtonPassed : {}),
                          ...(rs.status === "failed" ? styles.runButtonFailed : {}),
                        }}
                        onClick={() => void handleRunTest(test.id)}
                        disabled={rs.status === "running"}
                        title="Run this test"
                        type="button"
                      >
                        {rs.status === "running"
                          ? "⏳ Running…"
                          : rs.status === "passed"
                          ? "✅ Passed"
                          : rs.status === "failed"
                          ? "❌ Failed"
                          : "▶ Run"}
                      </button>
                      {/* Delete button */}
                      <button
                        style={styles.deleteButton}
                        onClick={() =>
                          setPendingDelete(
                            pendingDelete === test.id ? null : test.id
                          )
                        }
                        title="Delete test"
                        type="button"
                      >
                        🗑
                      </button>
                    </div>
                  </div>

                  {/* Tags */}
                  {(test.tags ?? []).length > 0 && (
                    <div style={styles.testTags}>
                      {(test.tags ?? []).map((tag) => (
                        <span
                          key={tag}
                          style={{
                            ...styles.tagBadge,
                            ...(selectedTag === tag ? styles.tagBadgeActive : {}),
                          }}
                          onClick={() => handleSelectTag(tag)}
                          title={`Filter by tag: ${tag}`}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && handleSelectTag(tag)}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Delete confirmation */}
                  {pendingDelete === test.id && (
                    <div style={styles.deleteConfirm}>
                      <span style={styles.deleteConfirmText}>
                        Delete "{test.name}"?
                      </span>
                      <button
                        style={styles.confirmDeleteButton}
                        onClick={() => void handleDeleteTest(test.id)}
                        type="button"
                      >
                        Yes, Delete
                      </button>
                      <button
                        style={styles.cancelButton}
                        onClick={() => setPendingDelete(null)}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* Run result summary */}
                  {rs.run && (
                    <div
                      style={{
                        ...styles.runResult,
                        ...(rs.status === "passed"
                          ? styles.runResultPassed
                          : styles.runResultFailed),
                      }}
                    >
                      <span>
                        {rs.status === "passed" ? "✅ Passed" : "❌ Failed"} ·{" "}
                        {rs.run.stepResults.length} step
                        {rs.run.stepResults.length !== 1 ? "s" : ""} · {rs.run.browser}
                      </span>
                      {rs.run.stepResults.some((r) => r.error) && (
                        <ul style={styles.errorList}>
                          {rs.run.stepResults
                            .filter((r) => r.error)
                            .map((r) => (
                              <li key={r.stepIndex} style={styles.errorItem}>
                                Step {r.stepIndex + 1}: {r.error}
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Detail / Editor panel */}
        {selectedTest && (
          <div style={styles.detailPanel}>
            <div style={styles.detailHeader}>
              <h3 style={styles.detailTitle}>{selectedTest.name}</h3>
              <button
                style={styles.closeButton}
                onClick={() => setSelectedTest(null)}
                title="Close"
                type="button"
              >
                ✕
              </button>
            </div>

            <div style={styles.detailMeta}>
              <span>ID: <code style={styles.code}>{selectedTest.id}</code></span>
              <span>Browser: <strong>{selectedTest.browser ?? config.browser}</strong></span>
              <span>Created: {new Date(selectedTest.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
              <span>Updated: {new Date(selectedTest.updatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
            </div>

            {(selectedTest.tags ?? []).length > 0 && (
              <div style={styles.detailTags}>
                <strong style={styles.detailLabel}>Tags: </strong>
                {(selectedTest.tags ?? []).map((tag) => (
                  <span key={tag} style={styles.tagBadge}>{tag}</span>
                ))}
              </div>
            )}

            <div style={styles.detailSection}>
              <strong style={styles.detailLabel}>
                Steps ({selectedTest.steps.length})
              </strong>
              {selectedTest.steps.length === 0 ? (
                <p style={styles.emptyText}>No steps.</p>
              ) : (
                <ol style={styles.stepList}>
                  {selectedTest.steps.map((step, i) => (
                    <li key={i} style={styles.stepItem}>
                      <code style={styles.code}>{step.action}</code>
                      {step.selector && (
                        <span style={styles.stepDetail}> selector: {step.selector}</span>
                      )}
                      {step.value && (
                        <span style={styles.stepDetail}> value: {step.value}</span>
                      )}
                      {step.url && (
                        <span style={styles.stepDetail}> url: {step.url}</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {selectedTest.assertions.length > 0 && (
              <div style={styles.detailSection}>
                <strong style={styles.detailLabel}>
                  Assertions ({selectedTest.assertions.length})
                </strong>
                <ol style={styles.stepList}>
                  {selectedTest.assertions.map((a, i) => (
                    <li key={i} style={styles.stepItem}>
                      <code style={styles.code}>{a.type}</code>
                      {a.selector && (
                        <span style={styles.stepDetail}> selector: {a.selector}</span>
                      )}
                      {a.value && (
                        <span style={styles.stepDetail}> value: {a.value}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div style={styles.detailSection}>
              <strong style={styles.detailLabel}>Raw JSON</strong>
              <pre style={styles.jsonViewer}>
                {JSON.stringify(selectedTest, null, 2)}
              </pre>
            </div>

            <div style={styles.detailFooter}>
              <button
                style={{
                  ...styles.runButton,
                  ...(runState(selectedTest.id).status === "running"
                    ? styles.buttonDisabled
                    : {}),
                }}
                onClick={() => void handleRunTest(selectedTest.id)}
                disabled={runState(selectedTest.id).status === "running"}
                type="button"
              >
                {runState(selectedTest.id).status === "running"
                  ? "⏳ Running…"
                  : "▶ Run Test"}
              </button>
            </div>
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
  searchRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  searchInput: {
    flex: 1,
    backgroundColor: "#1e1e1e",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#d4d4d4",
    padding: "0.4rem 0.6rem",
    fontSize: "0.875rem",
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
  tagNav: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.4rem",
    alignItems: "center",
  },
  tagPill: {
    backgroundColor: "#2d2d2d",
    border: "1px solid #555",
    borderRadius: "12px",
    color: "#aaa",
    cursor: "pointer",
    padding: "0.2rem 0.7rem",
    fontSize: "0.75rem",
  },
  tagPillActive: {
    backgroundColor: "#0e4d78",
    borderColor: "#007acc",
    color: "#ffffff",
  },
  clearTagButton: {
    backgroundColor: "transparent",
    border: "none",
    color: "#888",
    cursor: "pointer",
    fontSize: "0.75rem",
    padding: "0.2rem 0.4rem",
    textDecoration: "underline",
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
    gap: "0.5rem",
    flex: 1,
    overflowY: "auto",
    minWidth: 0,
  },
  testCard: {
    backgroundColor: "#252526",
    border: "1px solid #3c3c3c",
    borderRadius: "6px",
    padding: "0.65rem 0.75rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  testCardSelected: {
    borderColor: "#007acc",
    backgroundColor: "#1e2d3d",
  },
  testCardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
  },
  testNameButton: {
    background: "none",
    border: "none",
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "0.1rem",
    padding: 0,
    flex: 1,
    textAlign: "left",
  },
  testName: {
    fontSize: "0.9rem",
    fontWeight: "bold",
    color: "#e8e8e8",
  },
  testMeta: {
    fontSize: "0.72rem",
    color: "#888",
  },
  testActions: {
    display: "flex",
    gap: "0.4rem",
    alignItems: "center",
    flexShrink: 0,
  },
  testTags: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.3rem",
  },
  tagBadge: {
    backgroundColor: "#2d2d2d",
    border: "1px solid #555",
    borderRadius: "10px",
    color: "#aaa",
    cursor: "pointer",
    display: "inline-block",
    fontSize: "0.7rem",
    padding: "0.1rem 0.5rem",
  },
  tagBadgeActive: {
    backgroundColor: "#0e4d78",
    borderColor: "#007acc",
    color: "#ffffff",
  },
  runButton: {
    backgroundColor: "#0e639c",
    border: "none",
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    padding: "0.3rem 0.7rem",
    fontSize: "0.78rem",
    fontWeight: "bold",
    whiteSpace: "nowrap",
  },
  runButtonPassed: {
    backgroundColor: "#1a4d1a",
    borderColor: "#3a7a3a",
  },
  runButtonFailed: {
    backgroundColor: "#4d1a1a",
    borderColor: "#7a3a3a",
  },
  deleteButton: {
    backgroundColor: "transparent",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#888",
    cursor: "pointer",
    padding: "0.3rem 0.5rem",
    fontSize: "0.78rem",
  },
  deleteConfirm: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    backgroundColor: "#2d1a1a",
    border: "1px solid #7a3a3a",
    borderRadius: "4px",
    padding: "0.4rem 0.6rem",
    flexWrap: "wrap",
  },
  deleteConfirmText: {
    fontSize: "0.8rem",
    color: "#f4a4a4",
    flex: 1,
  },
  confirmDeleteButton: {
    backgroundColor: "#7a2020",
    border: "none",
    borderRadius: "4px",
    color: "#ffffff",
    cursor: "pointer",
    padding: "0.25rem 0.6rem",
    fontSize: "0.75rem",
  },
  cancelButton: {
    backgroundColor: "transparent",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#888",
    cursor: "pointer",
    padding: "0.25rem 0.6rem",
    fontSize: "0.75rem",
  },
  runResult: {
    borderRadius: "4px",
    fontSize: "0.78rem",
    padding: "0.35rem 0.6rem",
  },
  runResultPassed: {
    backgroundColor: "#1a2d1a",
    border: "1px solid #3a5c3a",
    color: "#a8d5a2",
  },
  runResultFailed: {
    backgroundColor: "#2d1a1a",
    border: "1px solid #7a3a3a",
    color: "#f4a4a4",
  },
  errorList: {
    margin: "0.3rem 0 0 1rem",
    padding: 0,
  },
  errorItem: {
    fontSize: "0.75rem",
  },
  buttonDisabled: {
    backgroundColor: "#555",
    color: "#999",
    cursor: "not-allowed",
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
    width: "380px",
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
    wordBreak: "break-word",
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
    color: "#888",
  },
  detailTags: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.3rem",
    alignItems: "center",
    fontSize: "0.8rem",
  },
  detailLabel: {
    fontSize: "0.8rem",
    color: "#aaa",
    display: "block",
    marginBottom: "0.3rem",
  },
  detailSection: {
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
  },
  stepList: {
    margin: 0,
    paddingLeft: "1.2rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  stepItem: {
    fontSize: "0.8rem",
    color: "#ccc",
    lineHeight: "1.4",
  },
  stepDetail: {
    color: "#888",
    fontSize: "0.75rem",
  },
  code: {
    backgroundColor: "#2d2d2d",
    borderRadius: "3px",
    fontFamily: "monospace",
    fontSize: "0.78rem",
    padding: "0.05rem 0.3rem",
    color: "#9cdcfe",
  },
  jsonViewer: {
    backgroundColor: "#1a1a1a",
    border: "1px solid #3c3c3c",
    borderRadius: "4px",
    color: "#a8d5a2",
    fontFamily: "monospace",
    fontSize: "0.72rem",
    lineHeight: "1.4",
    margin: 0,
    overflowX: "auto",
    padding: "0.5rem",
    whiteSpace: "pre",
    maxHeight: "250px",
    overflowY: "auto",
  },
  detailFooter: {
    display: "flex",
    justifyContent: "flex-end",
    paddingTop: "0.25rem",
    borderTop: "1px solid #3c3c3c",
  },
};
