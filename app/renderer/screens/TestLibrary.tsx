/**
 * TestLibrary – Issue #16: Test Library UI
 *
 * Acceptance Criteria:
 *  - Folder/tag navigation (click a tag pill to filter)
 *  - Search by name/tag
 *  - Open test in editor (inline detail/editor panel)
 *  - Run test from UI (via executeTest IPC, result shown inline)
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig } from "../App";
import { ADVANCED_ACTION_VERBS, CORE_ACTION_VERBS } from "../../shared/types";
import type { ActionStep, Assertion, BrowserType, Run, TestCase, TestEditorMode, TestEditorValidationState } from "../../shared/types";
import {
  applyAutoFixForMessage,
  applyAutoFixesToAllSteps,
  cloneSteps,
  collectStepValidationErrors,
  reorderSteps,
  validateStep,
} from "./TestBuilderUtils";

interface Props {
  config: AppConfig;
  runTrigger: number;
  registerRun: (fn: () => void) => void;
}

type RunStatus = "idle" | "running" | "passed" | "failed";

interface TestRunState {
  status: RunStatus;
  run?: Run;
}

type WizardPreset = "custom" | "search" | "login";

const ACTION_OPTIONS: Array<ActionStep["action"]> = [
  ...CORE_ACTION_VERBS,
  ...ADVANCED_ACTION_VERBS,
];

function createDraftTest(browser: BrowserType): TestCase {
  const now = new Date().toISOString();
  return {
    schemaVersion: "1",
    id: `draft-${Date.now()}`,
    name: "Untitled Test",
    tags: [],
    preconditions: [],
    steps: [],
    assertions: [],
    browser,
    createdAt: now,
    updatedAt: now,
  };
}

function buildWizardPresetSteps(
  preset: WizardPreset,
  startUrl: string,
  primaryValue: string,
  secondaryValue: string
): ActionStep[] {
  if (preset === "search") {
    return [
      { action: "navigate", value: startUrl || "https://www.google.com" },
      { action: "waitForSelector", selector: "textarea[name='q'], input[name='q'], input[type='search']" },
      { action: "fill", selector: "textarea[name='q'], input[name='q'], input[type='search']", value: primaryValue || "search term" },
      { action: "click", selector: "input[type='submit'], button[type='submit'], button:has-text('Search')" },
      { action: "waitForNavigation" },
      { action: "screenshot", value: "search-results" },
    ];
  }

  if (preset === "login") {
    return [
      { action: "navigate", value: startUrl || "https://example.com/login" },
      { action: "waitForSelector", selector: "input[type='email'], input[name*='email'], input[type='text']" },
      { action: "fill", selector: "input[type='email'], input[name*='email'], input[type='text']", value: primaryValue || "{{username}}" },
      { action: "fill", selector: "input[type='password'], input[name*='password']", value: secondaryValue || "{{password}}" },
      { action: "click", selector: "button[type='submit'], input[type='submit'], button:has-text('Sign in'), button:has-text('Log in')" },
      { action: "waitForNavigation" },
      { action: "screenshot", value: "post-login" },
    ];
  }

  return [];
}

export default function TestLibrary({ config, runTrigger, registerRun }: Props): React.ReactElement {
  const [tests, setTests] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search and tag filter
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Selected test for the detail/editor panel
  const [selectedTest, setSelectedTest] = useState<TestCase | null>(null);
  const [editorMode, setEditorMode] = useState<TestEditorMode>("visual");

  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorSuccess, setEditorSuccess] = useState<string | null>(null);
  const [lastAutoFixSnapshot, setLastAutoFixSnapshot] = useState<ActionStep[] | null>(null);
  const [validationState, setValidationState] = useState<TestEditorValidationState | null>(null);
  const [legacyConversionPreview, setLegacyConversionPreview] = useState<ActionStep[] | null>(null);
  const [legacyConverting, setLegacyConverting] = useState(false);
  const [legacyConversionError, setLegacyConversionError] = useState<string | null>(null);

  // Quick wizard state
  const [wizardAction, setWizardAction] = useState<ActionStep["action"]>("navigate");
  const [wizardPreset, setWizardPreset] = useState<WizardPreset>("custom");
  const [wizardGoal, setWizardGoal] = useState("");
  const [wizardSelector, setWizardSelector] = useState("");
  const [wizardValue, setWizardValue] = useState("");
  const [wizardStartUrl, setWizardStartUrl] = useState("");
  const [wizardPrimaryValue, setWizardPrimaryValue] = useState("");
  const [wizardSecondaryValue, setWizardSecondaryValue] = useState("");

  const [draggedStepIndex, setDraggedStepIndex] = useState<number | null>(null);
  const [dragOverStepIndex, setDragOverStepIndex] = useState<number | null>(null);

  // Raw JSON editor state
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonDirty, setJsonDirty] = useState(false);
  const [jsonSaving, setJsonSaving] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonSuccess, setJsonSuccess] = useState<string | null>(null);

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
          environment: config.environment,
          browser: config.browser,
          headed: config.headed,
          toolPolicy: config.toolPolicy,
          authProfile: config.authProfile,
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
    [config.authProfile, config.browser, config.environment, config.headed, config.toolPolicy]
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

  const updateSelectedTest = useCallback((updater: (test: TestCase) => TestCase) => {
    setSelectedTest((prev) => {
      if (!prev) return prev;
      const updated = updater(prev);
      return {
        ...updated,
        updatedAt: new Date().toISOString(),
      };
    });
    setEditorError(null);
    setEditorSuccess(null);
  }, []);

  const runState = (testId: string): TestRunState =>
    runStates[testId] ?? { status: "idle" };

  const selectedStepErrors = validationState?.schemaErrors ?? [];
  const selectedPolicyErrors = validationState?.policyErrors ?? [];
  const totalValidationIssues = selectedStepErrors.length + selectedPolicyErrors.length;
  const selectedTestCanRun =
    !!selectedTest &&
    (selectedTest.steps.length ?? 0) > 0 &&
    (validationState?.schemaValid ?? false) &&
    (validationState?.policyValid ?? false);

  const handleRunSelected = useCallback(async () => {
    if (!selectedTest) {
      setEditorError("Select or create a test before running from the top bar.");
      return;
    }

    setEditorSuccess(`Running: ${selectedTest.name}`);

    if (selectedTest.id.startsWith("draft-")) {
      setRunStates((prev) => ({ ...prev, [selectedTest.id]: { status: "running" } }));
      try {
        const result = (await window.skytest.invoke("executeDSLPlan", {
          plan: {
            version: "1",
            intent: selectedTest.name,
            steps: selectedTest.steps,
          },
          environment: config.environment,
          browser: selectedTest.browser ?? config.browser,
          headed: config.headed,
          toolPolicy: config.toolPolicy,
        })) as
          | { ok: true; run: Run }
          | { ok: false; reason: "schema" | "policy"; errors: Array<{ stepIndex: number; message: string }> };

        if (!result.ok) {
          const message = result.errors.map((e) => `Step ${e.stepIndex + 1}: ${e.message}`).join(" | ");
          setRunStates((prev) => ({
            ...prev,
            [selectedTest.id]: {
              status: "failed",
              run: {
                schemaVersion: "1",
                id: `draft-run-${Date.now()}`,
                environment: config.environment,
                browser: selectedTest.browser ?? config.browser,
                headed: config.headed,
                toolPolicy: config.toolPolicy,
                status: "failed",
                stepResults: [
                  {
                    stepIndex: 0,
                    action: "validate",
                    status: "failed",
                    error: message,
                    artifactIds: [],
                    durationMs: 0,
                  },
                ],
                artifacts: [],
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
              },
            },
          }));
          return;
        }

        setRunStates((prev) => ({
          ...prev,
          [selectedTest.id]: {
            status: result.run.status === "passed" ? "passed" : "failed",
            run: result.run,
          },
        }));
      } catch (err) {
        setRunStates((prev) => ({ ...prev, [selectedTest.id]: { status: "failed" } }));
        setEditorError(`Run failed: ${String(err)}`);
      }
      return;
    }

    await handleRunTest(selectedTest.id);
  }, [config.browser, config.headed, config.toolPolicy, handleRunTest, selectedTest]);

  useEffect(() => {
    registerRun(handleRunSelected);
  }, [handleRunSelected, registerRun]);

  const prevRunTriggerRef = useRef(runTrigger);
  useEffect(() => {
    if (runTrigger > prevRunTriggerRef.current) {
      prevRunTriggerRef.current = runTrigger;
      void handleRunSelected();
    }
  }, [handleRunSelected, runTrigger]);

  useEffect(() => {
    if (!selectedTest) {
      setJsonDraft("");
      setJsonDirty(false);
      setJsonError(null);
      setJsonSuccess(null);
      setLastAutoFixSnapshot(null);
      setValidationState(null);
      setLegacyConversionPreview(null);
      setLegacyConversionError(null);
      return;
    }
    setJsonDraft(JSON.stringify(selectedTest, null, 2));
    setJsonDirty(false);
    setJsonError(null);
    setJsonSuccess(null);
    setLegacyConversionPreview(null);
    setLegacyConversionError(null);
  }, [selectedTest]);

  const hasLegacyChatSteps = selectedTest?.steps.some((step) => step.action === "chat") ?? false;

  const handlePreviewLegacyConversion = useCallback(async () => {
    if (!selectedTest || !hasLegacyChatSteps) return;
    setLegacyConverting(true);
    setLegacyConversionError(null);
    try {
      const result = (await window.skytest.invoke("convertLegacyChatSteps", {
        steps: selectedTest.steps,
      })) as { converted: boolean; steps: ActionStep[] };

      if (!result.converted) {
        setLegacyConversionPreview(null);
        setLegacyConversionError("No legacy chat steps were found to convert.");
      } else {
        setLegacyConversionPreview(result.steps);
      }
    } catch (err) {
      setLegacyConversionError(`Legacy conversion failed: ${String(err)}`);
    } finally {
      setLegacyConverting(false);
    }
  }, [hasLegacyChatSteps, selectedTest]);

  const handleApplyLegacyConversion = useCallback(() => {
    if (!legacyConversionPreview) return;
    updateSelectedTest((test) => ({
      ...test,
      steps: legacyConversionPreview,
      uiDraft: undefined,
    }));
    setLegacyConversionPreview(null);
    setLegacyConversionError(null);
    setEditorSuccess("Applied legacy chat-step conversion preview.");
  }, [legacyConversionPreview, updateSelectedTest]);

  useEffect(() => {
    if (!selectedTest) return;
    let disposed = false;
    void (async () => {
      try {
        const result = (await window.skytest.invoke("validateTestDraft", {
          steps: selectedTest.steps,
          toolPolicy: config.toolPolicy,
        })) as TestEditorValidationState;
        if (!disposed) {
          setValidationState(result);
        }
      } catch (err) {
        if (!disposed) {
          setValidationState({
            schemaValid: false,
            schemaErrors: [{ stepIndex: -1, message: `Validation failed: ${String(err)}` }],
            policyValid: false,
            policyErrors: [],
          });
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [config.toolPolicy, selectedTest]);

  const handleSaveRawJson = useCallback(async (saveMode: "strict" | "draft") => {
    if (!selectedTest || !jsonDirty) return;
    setJsonSaving(true);
    setJsonError(null);
    setJsonSuccess(null);

    const allowDraft = saveMode === "draft";
    let parsed: Partial<TestCase> | null = null;
    try {
      parsed = JSON.parse(jsonDraft) as Partial<TestCase>;
    } catch (err) {
      if (!allowDraft) {
        setJsonError(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
        setJsonSaving(false);
        return;
      }
    }

    try {
      let updated: TestCase;
      if (selectedTest.id.startsWith("draft-")) {
        updated = (await window.skytest.invoke("saveTest", {
          name: parsed?.name ?? selectedTest.name,
          steps: parsed?.steps ?? selectedTest.steps,
          assertions: parsed?.assertions ?? selectedTest.assertions,
          browser: parsed?.browser ?? selectedTest.browser ?? config.browser,
          uiDraft: allowDraft
            ? {
                isDraft: true,
                invalidRawJson: jsonDraft,
                parseError: parsed ? undefined : "Invalid JSON while saving draft",
                validationErrors: parsed ? undefined : ["Invalid JSON while saving draft"],
                stagedAt: new Date().toISOString(),
              }
            : undefined,
        })) as TestCase;
        setTests((prev) => [updated, ...prev]);
      } else {
        updated = (await window.skytest.invoke("updateTest", {
          testId: selectedTest.id,
          rawJson: jsonDraft,
          allowDraft,
        })) as TestCase;
        setTests((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      }

      setSelectedTest(updated);
      if (updated.uiDraft?.isDraft) {
        setJsonSuccess("Draft saved. Executable steps were left unchanged until fixes are applied.");
      } else {
        setJsonSuccess("Saved.");
      }
      setJsonDirty(false);
    } catch (err) {
      setJsonError(`Save failed: ${String(err)}`);
    } finally {
      setJsonSaving(false);
    }
  }, [config.browser, selectedTest, jsonDraft, jsonDirty]);

  const handleResetRawJson = useCallback(() => {
    if (!selectedTest) return;
    setJsonDraft(JSON.stringify(selectedTest, null, 2));
    setJsonDirty(false);
    setJsonError(null);
    setJsonSuccess(null);
  }, [selectedTest]);

  const handleCreateDraft = useCallback(
    (mode: TestEditorMode) => {
      setSelectedTest(createDraftTest(config.browser));
      setEditorMode(mode);
      setEditorError(null);
      setEditorSuccess(null);
      setWizardAction("navigate");
      setWizardPreset("custom");
      setWizardGoal("");
      setWizardSelector("");
      setWizardValue("");
      setWizardStartUrl("");
      setWizardPrimaryValue("");
      setWizardSecondaryValue("");
    },
    [config.browser]
  );

  const handleSaveBuilder = useCallback(async () => {
    if (!selectedTest) return;

    setEditorSaving(true);
    setEditorError(null);
    setEditorSuccess(null);

    const hasNoSteps = selectedTest.steps.length === 0;
    if (hasNoSteps) {
      setEditorError("Add at least one step before saving.");
      setEditorSaving(false);
      return;
    }

    try {
      let saved: TestCase;
      const isDraft = selectedTest.id.startsWith("draft-");
      if (isDraft) {
        saved = (await window.skytest.invoke("saveTest", {
          name: selectedTest.name,
          steps: selectedTest.steps,
          assertions: selectedTest.assertions,
          browser: selectedTest.browser ?? config.browser,
        })) as TestCase;
        setTests((prev) => [saved, ...prev]);
      } else {
        saved = (await window.skytest.invoke("updateTest", {
          testId: selectedTest.id,
          rawJson: JSON.stringify(selectedTest, null, 2),
        })) as TestCase;
        setTests((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
      }

      setSelectedTest(saved);
      setEditorSuccess(isDraft ? "Saved test." : "Updated test.");
    } catch (err) {
      setEditorError(`Save failed: ${String(err)}`);
    } finally {
      setEditorSaving(false);
    }
  }, [config.browser, selectedTest]);

  const handleAddStep = useCallback(() => {
    updateSelectedTest((test) => ({
      ...test,
      steps: [...test.steps, { action: "navigate", value: "https://" }],
    }));
  }, [updateSelectedTest]);

  const handleAddWizardStep = useCallback(() => {
    const nextStep: ActionStep = {
      action: wizardAction,
      selector: wizardSelector.trim() || undefined,
      value: wizardValue.trim() || undefined,
    };

    updateSelectedTest((test) => ({
      ...test,
      name: wizardGoal.trim() ? wizardGoal.trim() : test.name,
      steps: [...test.steps, nextStep],
    }));

    setWizardSelector("");
    setWizardValue("");
    setEditorMode("visual");
  }, [updateSelectedTest, wizardAction, wizardGoal, wizardSelector, wizardValue]);

  const handleApplyWizardStartUrl = useCallback(() => {
    if (!wizardStartUrl.trim()) return;
    updateSelectedTest((test) => {
      const steps = [...test.steps];
      if (steps.length > 0 && steps[0].action === "navigate") {
        steps[0] = { ...steps[0], value: wizardStartUrl.trim() };
      } else {
        steps.unshift({ action: "navigate", value: wizardStartUrl.trim() });
      }
      return { ...test, steps };
    });
    setEditorMode("visual");
  }, [updateSelectedTest, wizardStartUrl]);

  const handleApplyWizardPreset = useCallback(() => {
    if (wizardPreset === "custom") return;
    const presetSteps = buildWizardPresetSteps(
      wizardPreset,
      wizardStartUrl.trim(),
      wizardPrimaryValue.trim(),
      wizardSecondaryValue.trim()
    );

    if (presetSteps.length === 0) return;

    updateSelectedTest((test) => ({
      ...test,
      name: wizardGoal.trim() ? wizardGoal.trim() : test.name,
      steps: presetSteps,
    }));
    setEditorMode("visual");
    setEditorSuccess(`Applied ${wizardPreset} preset. You can fine-tune steps in Visual Builder.`);
  }, [updateSelectedTest, wizardGoal, wizardPreset, wizardStartUrl, wizardPrimaryValue, wizardSecondaryValue]);

  const handleStepDragStart = useCallback((index: number) => {
    setDraggedStepIndex(index);
    setDragOverStepIndex(index);
  }, []);

  const handleStepDragOver = useCallback((index: number, event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (dragOverStepIndex !== index) {
      setDragOverStepIndex(index);
    }
  }, [dragOverStepIndex]);

  const handleStepDrop = useCallback((index: number) => {
    if (draggedStepIndex === null || !selectedTest || draggedStepIndex === index) {
      setDraggedStepIndex(null);
      setDragOverStepIndex(null);
      return;
    }

    updateSelectedTest((test) => {
      const reordered = reorderSteps(test.steps, draggedStepIndex, index);
      return {
        ...test,
        steps: reordered,
      };
    });

    setDraggedStepIndex(null);
    setDragOverStepIndex(null);
  }, [draggedStepIndex, selectedTest, updateSelectedTest]);

  const handleStepDragEnd = useCallback(() => {
    setDraggedStepIndex(null);
    setDragOverStepIndex(null);
  }, []);

  const handleMoveStep = useCallback(
    (fromIndex: number, direction: "up" | "down") => {
      updateSelectedTest((test) => {
        const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
        const reordered = reorderSteps(test.steps, fromIndex, toIndex);
        return {
          ...test,
          steps: reordered,
        };
      });
    },
    [updateSelectedTest]
  );

  const handleAutoFixStepError = useCallback(
    (stepIndex: number, message: string) => {
      if (!selectedTest) return;
      setLastAutoFixSnapshot(cloneSteps(selectedTest.steps));
      updateSelectedTest((test) => {
        const steps = [...test.steps];
        const step = steps[stepIndex];
        if (!step) return test;

        const nextStep = applyAutoFixForMessage(step, message);

        steps[stepIndex] = nextStep;
        return {
          ...test,
          steps,
        };
      });
      setEditorSuccess("Applied one auto-fix. You can undo from the validation banner.");
    },
    [selectedTest, updateSelectedTest]
  );

  const handleFixAllStepErrors = useCallback(() => {
    if (!selectedTest) return;
    setLastAutoFixSnapshot(cloneSteps(selectedTest.steps));
    updateSelectedTest((test) => {
      const steps = applyAutoFixesToAllSteps(test.steps);
      return {
        ...test,
        steps,
      };
    });
    setEditorSuccess("Applied auto-fix suggestions to all steps. You can undo from the validation banner.");
  }, [selectedTest, updateSelectedTest]);

  const handleUndoAutoFix = useCallback(() => {
    if (!lastAutoFixSnapshot) return;
    updateSelectedTest((test) => ({
      ...test,
      steps: cloneSteps(lastAutoFixSnapshot),
    }));
    setLastAutoFixSnapshot(null);
    setEditorSuccess("Reverted the last auto-fix changes.");
  }, [lastAutoFixSnapshot, updateSelectedTest]);

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
        <div style={styles.headerActions}>
          <button
            style={styles.newButton}
            onClick={() => handleCreateDraft("visual")}
            title="Create a new test in Visual Builder"
            type="button"
          >
            ＋ New Test
          </button>
          <button
            style={styles.newWizardButton}
            onClick={() => handleCreateDraft("wizard")}
            title="Create a new test with Quick Wizard"
            type="button"
          >
            ✨ Quick Wizard
          </button>
          <button style={styles.refreshButton} onClick={() => void loadTests()} title="Refresh test list" type="button">
            🔄 Refresh
          </button>
        </div>
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
                      onClick={() => {
                        setSelectedTest(isSelected ? null : test);
                        if (!isSelected) setEditorMode("visual");
                      }}
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

            <div style={styles.modeTabs}>
              <button
                type="button"
                style={{ ...styles.modeTabButton, ...(editorMode === "visual" ? styles.modeTabButtonActive : {}) }}
                onClick={() => setEditorMode("visual")}
              >
                Visual Builder
              </button>
              <button
                type="button"
                style={{ ...styles.modeTabButton, ...(editorMode === "wizard" ? styles.modeTabButtonActive : {}) }}
                onClick={() => setEditorMode("wizard")}
              >
                Quick Wizard
              </button>
              <button
                type="button"
                style={{ ...styles.modeTabButton, ...(editorMode === "raw" ? styles.modeTabButtonActive : {}) }}
                onClick={() => setEditorMode("raw")}
              >
                Raw JSON
              </button>
            </div>

            {editorMode === "visual" && (
              <>
                <div
                  style={{
                    ...styles.validationBanner,
                    ...(selectedStepErrors.length > 0 ? styles.validationBannerError : styles.validationBannerOk),
                  }}
                >
                  <div style={styles.validationBannerRow}>
                    <span>
                      {totalValidationIssues > 0
                        ? `⚠ ${totalValidationIssues} validation issue${totalValidationIssues === 1 ? "" : "s"} must be fixed before run.`
                        : "✅ Steps are valid and ready to run."}
                    </span>
                    {totalValidationIssues > 0 && (
                      <div style={styles.validationActionsGroup}>
                        <button
                          type="button"
                          style={styles.fixAllButton}
                          onClick={handleFixAllStepErrors}
                          title="Apply automatic fixes for common validation issues"
                        >
                          Fix All
                        </button>
                        {lastAutoFixSnapshot && (
                          <button
                            type="button"
                            style={styles.undoFixButton}
                            onClick={handleUndoAutoFix}
                            title="Undo most recent auto-fix changes"
                          >
                            Undo Fix
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {selectedPolicyErrors.length > 0 && (
                  <ul style={styles.inlineErrorList}>
                    {selectedPolicyErrors.map((error, index) => (
                      <li key={`${error.stepIndex}-${index}`} style={styles.inlineErrorItemRow}>
                        <span style={styles.inlineErrorItem}>
                          Policy: step {error.stepIndex + 1} — {error.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {hasLegacyChatSteps && (
                  <div style={styles.legacyConversionPanel}>
                    <span style={styles.legacyConversionText}>
                      This test contains legacy <code style={styles.code}>action:"chat"</code> steps.
                    </span>
                    <button
                      type="button"
                      style={{ ...styles.fixAllButton, ...(legacyConverting ? styles.buttonDisabled : {}) }}
                      onClick={() => void handlePreviewLegacyConversion()}
                      disabled={legacyConverting}
                    >
                      {legacyConverting ? "Previewing…" : "Preview Conversion"}
                    </button>
                    {legacyConversionPreview && (
                      <button
                        type="button"
                        style={styles.fixAllButton}
                        onClick={handleApplyLegacyConversion}
                      >
                        Apply Preview ({legacyConversionPreview.length} steps)
                      </button>
                    )}
                    {legacyConversionError && <span style={styles.jsonError}>{legacyConversionError}</span>}
                  </div>
                )}

                <div style={styles.detailSection}>
                  <strong style={styles.detailLabel}>Test Name</strong>
                  <input
                    style={styles.editorInput}
                    value={selectedTest.name}
                    onChange={(e) => updateSelectedTest((test) => ({ ...test, name: e.target.value }))}
                    aria-label="Test name"
                  />
                </div>

                <div style={styles.detailSection}>
                  <strong style={styles.detailLabel}>Steps ({selectedTest.steps.length})</strong>
                  {selectedTest.steps.length === 0 ? (
                    <p style={styles.emptyText}>No steps yet. Add one to begin.</p>
                  ) : (
                    <div style={styles.builderStepList}>
                      {selectedTest.steps.map((step, i) => {
                        const stepErrors = validateStep(step);
                        return (
                          <div
                            key={i}
                            style={{
                              ...styles.builderStepCard,
                              ...(dragOverStepIndex === i ? styles.builderStepCardDragOver : {}),
                            }}
                            draggable
                            onDragStart={() => handleStepDragStart(i)}
                            onDragOver={(event) => handleStepDragOver(i, event)}
                            onDrop={() => handleStepDrop(i)}
                            onDragEnd={handleStepDragEnd}
                          >
                            <div style={styles.builderStepHeader}>
                              <span style={styles.builderStepTitle}>Step {i + 1}</span>
                              <div style={styles.reorderButtonsGroup}>
                                <button
                                  type="button"
                                  style={{
                                    ...styles.reorderButton,
                                    ...(i === 0 ? styles.buttonDisabled : {}),
                                  }}
                                  onClick={() => handleMoveStep(i, "up")}
                                  disabled={i === 0}
                                  aria-label={`Move step ${i + 1} up`}
                                  title="Move up"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  style={{
                                    ...styles.reorderButton,
                                    ...(i === selectedTest.steps.length - 1 ? styles.buttonDisabled : {}),
                                  }}
                                  onClick={() => handleMoveStep(i, "down")}
                                  disabled={i === selectedTest.steps.length - 1}
                                  aria-label={`Move step ${i + 1} down`}
                                  title="Move down"
                                >
                                  ↓
                                </button>
                              </div>
                              <span style={styles.dragHandle}>⋮⋮ Drag</span>
                              <button
                                type="button"
                                style={styles.smallDangerButton}
                                onClick={() =>
                                  updateSelectedTest((test) => ({
                                    ...test,
                                    steps: test.steps.filter((_, index) => index !== i),
                                  }))
                                }
                              >
                                Remove
                              </button>
                            </div>
                            <select
                              style={styles.editorInput}
                              value={step.action}
                              onChange={(e) =>
                                updateSelectedTest((test) => ({
                                  ...test,
                                  steps: test.steps.map((existing, index) =>
                                    index === i ? { ...existing, action: e.target.value } : existing
                                  ),
                                }))
                              }
                            >
                              {ACTION_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                            <input
                              style={styles.editorInput}
                              placeholder="selector (if needed)"
                              value={step.selector ?? ""}
                              onChange={(e) =>
                                updateSelectedTest((test) => ({
                                  ...test,
                                  steps: test.steps.map((existing, index) =>
                                    index === i ? { ...existing, selector: e.target.value || undefined } : existing
                                  ),
                                }))
                              }
                            />
                            <input
                              style={styles.editorInput}
                              placeholder="value / url / text"
                              value={step.value ?? ""}
                              onChange={(e) =>
                                updateSelectedTest((test) => ({
                                  ...test,
                                  steps: test.steps.map((existing, index) =>
                                    index === i ? { ...existing, value: e.target.value || undefined } : existing
                                  ),
                                }))
                              }
                            />
                            {stepErrors.length > 0 && (
                              <ul style={styles.inlineErrorList}>
                                {stepErrors.map((message) => (
                                  <li key={message} style={styles.inlineErrorItemRow}>
                                    <span style={styles.inlineErrorItem}>{message}</span>
                                    <button
                                      type="button"
                                      style={styles.fixErrorButton}
                                      onClick={() => handleAutoFixStepError(i, message)}
                                    >
                                      Fix
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <button type="button" style={styles.addStepButton} onClick={handleAddStep}>
                    ＋ Add Step
                  </button>
                </div>

                <div style={styles.detailSection}>
                  <strong style={styles.detailLabel}>Assertions ({selectedTest.assertions.length})</strong>
                  {selectedTest.assertions.length > 0 && (
                    <div style={styles.builderStepList}>
                      {selectedTest.assertions.map((assertion, index) => (
                        <div key={index} style={styles.builderStepCard}>
                          <div style={styles.builderStepHeader}>
                            <span style={styles.builderStepTitle}>Assertion {index + 1}</span>
                            <button
                              type="button"
                              style={styles.smallDangerButton}
                              onClick={() =>
                                updateSelectedTest((test) => ({
                                  ...test,
                                  assertions: test.assertions.filter((_, i) => i !== index),
                                }))
                              }
                            >
                              Remove
                            </button>
                          </div>
                          <select
                            style={styles.editorInput}
                            value={assertion.type}
                            onChange={(e) =>
                              updateSelectedTest((test) => ({
                                ...test,
                                assertions: test.assertions.map((existing, i) =>
                                  i === index
                                    ? {
                                        ...existing,
                                        type: e.target.value as Assertion["type"],
                                      }
                                    : existing
                                ),
                              }))
                            }
                          >
                            <option value="textVisible">textVisible</option>
                            <option value="elementVisible">elementVisible</option>
                            <option value="urlContains">urlContains</option>
                            <option value="countEquals">countEquals</option>
                          </select>
                          <input
                            style={styles.editorInput}
                            placeholder="selector"
                            value={assertion.selector ?? ""}
                            onChange={(e) =>
                              updateSelectedTest((test) => ({
                                ...test,
                                assertions: test.assertions.map((existing, i) =>
                                  i === index ? { ...existing, selector: e.target.value || undefined } : existing
                                ),
                              }))
                            }
                          />
                          <input
                            style={styles.editorInput}
                            placeholder="value"
                            value={assertion.value ?? ""}
                            onChange={(e) =>
                              updateSelectedTest((test) => ({
                                ...test,
                                assertions: test.assertions.map((existing, i) =>
                                  i === index ? { ...existing, value: e.target.value || undefined } : existing
                                ),
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    style={styles.addStepButton}
                    onClick={() =>
                      updateSelectedTest((test) => ({
                        ...test,
                        assertions: [...test.assertions, { type: "elementVisible", selector: "" }],
                      }))
                    }
                  >
                    ＋ Add Assertion
                  </button>
                </div>
              </>
            )}

            {editorMode === "wizard" && (
              <div style={styles.detailSection}>
                <strong style={styles.detailLabel}>Quick Wizard</strong>
                <p style={styles.wizardHint}>
                  Build tests step-by-step without writing JSON. Add a start URL, then add actions.
                </p>
                <input
                  style={styles.editorInput}
                  placeholder="Goal (optional)"
                  value={wizardGoal}
                  onChange={(e) => setWizardGoal(e.target.value)}
                />
                <select
                  style={styles.editorInput}
                  value={wizardPreset}
                  onChange={(e) => setWizardPreset(e.target.value as WizardPreset)}
                >
                  <option value="custom">Custom step</option>
                  <option value="search">Preset: Search flow</option>
                  <option value="login">Preset: Login flow</option>
                </select>
                <input
                  style={styles.editorInput}
                  placeholder="Start URL (https://...)"
                  value={wizardStartUrl}
                  onChange={(e) => setWizardStartUrl(e.target.value)}
                />
                <button type="button" style={styles.addStepButton} onClick={handleApplyWizardStartUrl}>
                  Set Start URL
                </button>

                {wizardPreset !== "custom" && (
                  <>
                    <input
                      style={styles.editorInput}
                      placeholder={wizardPreset === "search" ? "Search term" : "Username / Email"}
                      value={wizardPrimaryValue}
                      onChange={(e) => setWizardPrimaryValue(e.target.value)}
                    />
                    {wizardPreset === "login" && (
                      <input
                        style={styles.editorInput}
                        placeholder="Password (or placeholder)"
                        value={wizardSecondaryValue}
                        onChange={(e) => setWizardSecondaryValue(e.target.value)}
                      />
                    )}
                    <button type="button" style={styles.addStepButton} onClick={handleApplyWizardPreset}>
                      Apply {wizardPreset === "search" ? "Search" : "Login"} Preset
                    </button>
                    <div style={styles.wizardPreviewBox}>
                      <strong style={styles.detailLabel}>Preset Review</strong>
                      <ol style={styles.stepList}>
                        {buildWizardPresetSteps(
                          wizardPreset,
                          wizardStartUrl.trim(),
                          wizardPrimaryValue.trim(),
                          wizardSecondaryValue.trim()
                        ).map((step, index) => (
                          <li key={`${step.action}-${index}`} style={styles.stepItem}>
                            <code style={styles.code}>{step.action}</code>
                            {step.selector ? <span style={styles.stepDetail}> selector: {step.selector}</span> : null}
                            {step.value ? <span style={styles.stepDetail}> value: {step.value}</span> : null}
                          </li>
                        ))}
                      </ol>
                    </div>
                    <p style={styles.wizardHint}>
                      Presets generate a full starting flow. Adjust selectors and assertions in Visual Builder.
                    </p>
                  </>
                )}

                <select
                  style={styles.editorInput}
                  value={wizardAction}
                  onChange={(e) => setWizardAction(e.target.value as ActionStep["action"])}
                >
                  {ACTION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <input
                  style={styles.editorInput}
                  placeholder="Selector (if needed)"
                  value={wizardSelector}
                  onChange={(e) => setWizardSelector(e.target.value)}
                />
                <input
                  style={styles.editorInput}
                  placeholder="Value / URL / text (if needed)"
                  value={wizardValue}
                  onChange={(e) => setWizardValue(e.target.value)}
                />
                <button type="button" style={styles.addStepButton} onClick={handleAddWizardStep}>
                  Add Step and Return to Visual Builder
                </button>
                {wizardPreset === "custom" && (
                  <div style={styles.wizardPreviewBox}>
                    <strong style={styles.detailLabel}>Step Review</strong>
                    <p style={styles.wizardHint}>
                      {wizardAction}
                      {wizardSelector ? ` · selector: ${wizardSelector}` : ""}
                      {wizardValue ? ` · value: ${wizardValue}` : ""}
                    </p>
                  </div>
                )}
              </div>
            )}

            {editorMode === "raw" && (
              <div style={styles.detailSection}>
                <strong style={styles.detailLabel}>Raw JSON</strong>
                <textarea
                  style={styles.jsonEditor}
                  value={jsonDraft}
                  onChange={(e) => {
                    setJsonDraft(e.target.value);
                    setJsonDirty(true);
                    setJsonError(null);
                    setJsonSuccess(null);
                  }}
                  spellCheck={false}
                  aria-label="Edit test raw JSON"
                />
                <div style={styles.jsonActionsRow}>
                  <button
                    type="button"
                    style={{
                      ...styles.saveJsonButton,
                      ...((!jsonDirty || jsonSaving) ? styles.buttonDisabled : {}),
                    }}
                    onClick={() => void handleSaveRawJson("strict")}
                    disabled={!jsonDirty || jsonSaving}
                  >
                    {jsonSaving ? "Saving…" : "Save JSON"}
                  </button>
                  <button
                    type="button"
                    style={{
                      ...styles.saveDraftButton,
                      ...((!jsonDirty || jsonSaving) ? styles.buttonDisabled : {}),
                    }}
                    onClick={() => void handleSaveRawJson("draft")}
                    disabled={!jsonDirty || jsonSaving}
                  >
                    Save Draft
                  </button>
                  <button
                    type="button"
                    style={{
                      ...styles.resetJsonButton,
                      ...((!jsonDirty || jsonSaving) ? styles.buttonDisabled : {}),
                    }}
                    onClick={handleResetRawJson}
                    disabled={!jsonDirty || jsonSaving}
                  >
                    Reset
                  </button>
                  {jsonError && <span style={styles.jsonError}>{jsonError}</span>}
                  {!jsonError && jsonSuccess && <span style={styles.jsonSuccess}>{jsonSuccess}</span>}
                </div>
                {selectedTest.uiDraft?.isDraft && (
                  <p style={styles.draftBadge}>
                    Draft staged at {new Date(selectedTest.uiDraft.stagedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    {selectedTest.uiDraft.parseError ? ` · ${selectedTest.uiDraft.parseError}` : ""}
                  </p>
                )}
              </div>
            )}

            {editorError && <p style={styles.errorText}>{editorError}</p>}
            {!editorError && editorSuccess && <p style={styles.successText}>{editorSuccess}</p>}

            <div style={styles.detailFooter}>
              <button
                style={{
                  ...styles.saveBuilderButton,
                  ...(editorSaving ? styles.buttonDisabled : {}),
                }}
                onClick={() => void handleSaveBuilder()}
                disabled={editorSaving}
                type="button"
              >
                {editorSaving ? "Saving…" : selectedTest.id.startsWith("draft-") ? "Save Test" : "Save Changes"}
              </button>
              <button
                style={{
                  ...styles.runButton,
                  ...(runState(selectedTest.id).status === "running"
                    ? styles.buttonDisabled
                    : {}),
                }}
                onClick={() => void handleRunSelected()}
                disabled={runState(selectedTest.id).status === "running" || !selectedTestCanRun}
                title={
                  !selectedTestCanRun
                    ? "Fix validation issues before running this test"
                    : "Run selected test"
                }
                type="button"
              >
                {runState(selectedTest.id).status === "running"
                  ? "⏳ Running…"
                  : selectedTest.id.startsWith("draft-")
                  ? "▶ Run Draft"
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
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  heading: {
    fontSize: "1.25rem",
    fontWeight: "bold",
    margin: 0,
  },
  newButton: {
    backgroundColor: "#0e639c",
    border: "none",
    borderRadius: "4px",
    color: "#fff",
    cursor: "pointer",
    fontSize: "0.75rem",
    fontWeight: "bold",
    padding: "0.3rem 0.7rem",
  },
  newWizardButton: {
    backgroundColor: "#2d2d2d",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#d4d4d4",
    cursor: "pointer",
    fontSize: "0.75rem",
    padding: "0.3rem 0.7rem",
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
  successText: {
    color: "#a8d5a2",
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
  modeTabs: {
    display: "flex",
    gap: "0.4rem",
    flexWrap: "wrap",
  },
  modeTabButton: {
    backgroundColor: "transparent",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#aaa",
    cursor: "pointer",
    fontSize: "0.72rem",
    padding: "0.2rem 0.5rem",
  },
  modeTabButtonActive: {
    backgroundColor: "#0e4d78",
    borderColor: "#007acc",
    color: "#fff",
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
    gap: "0.4rem",
  },
  validationBanner: {
    borderRadius: "4px",
    fontSize: "0.75rem",
    padding: "0.35rem 0.5rem",
  },
  validationBannerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.5rem",
  },
  validationActionsGroup: {
    display: "flex",
    alignItems: "center",
    gap: "0.3rem",
  },
  validationBannerOk: {
    backgroundColor: "#1a2d1a",
    border: "1px solid #3a5c3a",
    color: "#a8d5a2",
  },
  validationBannerError: {
    backgroundColor: "#2d1a1a",
    border: "1px solid #7a3a3a",
    color: "#f4a4a4",
  },
  legacyConversionPanel: {
    alignItems: "center",
    backgroundColor: "#2d2d1a",
    border: "1px solid #6b6b3a",
    borderRadius: "4px",
    display: "flex",
    flexWrap: "wrap",
    gap: "0.4rem",
    padding: "0.35rem 0.5rem",
  },
  legacyConversionText: {
    color: "#e0d8a8",
    fontSize: "0.75rem",
  },
  fixAllButton: {
    backgroundColor: "transparent",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#ddd",
    cursor: "pointer",
    fontSize: "0.68rem",
    padding: "0.15rem 0.4rem",
    whiteSpace: "nowrap",
  },
  undoFixButton: {
    backgroundColor: "transparent",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#ddd",
    cursor: "pointer",
    fontSize: "0.68rem",
    padding: "0.15rem 0.4rem",
    whiteSpace: "nowrap",
  },
  editorInput: {
    backgroundColor: "#1a1a1a",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#ddd",
    fontSize: "0.75rem",
    padding: "0.35rem 0.45rem",
    width: "100%",
    fontFamily: "inherit",
  },
  builderStepList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.45rem",
  },
  builderStepCard: {
    border: "1px solid #3c3c3c",
    borderRadius: "4px",
    padding: "0.45rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.35rem",
    backgroundColor: "#1a1a1a",
    cursor: "grab",
  },
  builderStepCardDragOver: {
    borderColor: "#007acc",
    boxShadow: "inset 0 0 0 1px #007acc",
  },
  builderStepHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  reorderButtonsGroup: {
    display: "flex",
    gap: "0.25rem",
    marginLeft: "auto",
    marginRight: "0.35rem",
  },
  reorderButton: {
    backgroundColor: "transparent",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#bbb",
    cursor: "pointer",
    fontSize: "0.68rem",
    lineHeight: 1,
    padding: "0.2rem 0.3rem",
  },
  dragHandle: {
    color: "#777",
    fontSize: "0.7rem",
    marginRight: "0.35rem",
    userSelect: "none",
  },
  builderStepTitle: {
    fontSize: "0.75rem",
    color: "#aaa",
    fontWeight: "bold",
  },
  addStepButton: {
    backgroundColor: "transparent",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#bbb",
    cursor: "pointer",
    fontSize: "0.74rem",
    padding: "0.25rem 0.5rem",
    alignSelf: "flex-start",
  },
  smallDangerButton: {
    backgroundColor: "transparent",
    border: "1px solid #7a3a3a",
    borderRadius: "4px",
    color: "#f4a4a4",
    cursor: "pointer",
    fontSize: "0.7rem",
    padding: "0.15rem 0.35rem",
  },
  inlineErrorList: {
    margin: 0,
    paddingLeft: "1rem",
  },
  inlineErrorItemRow: {
    alignItems: "center",
    display: "flex",
    gap: "0.4rem",
    justifyContent: "space-between",
  },
  inlineErrorItem: {
    color: "#f4a4a4",
    fontSize: "0.7rem",
    flex: 1,
  },
  fixErrorButton: {
    backgroundColor: "transparent",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#bbb",
    cursor: "pointer",
    fontSize: "0.68rem",
    padding: "0.1rem 0.35rem",
  },
  wizardHint: {
    margin: 0,
    fontSize: "0.75rem",
    color: "#9b9b9b",
  },
  wizardPreviewBox: {
    backgroundColor: "#1a1a1a",
    border: "1px solid #3c3c3c",
    borderRadius: "4px",
    padding: "0.45rem",
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
  jsonEditor: {
    backgroundColor: "#1a1a1a",
    border: "1px solid #3c3c3c",
    borderRadius: "4px",
    color: "#a8d5a2",
    fontFamily: "monospace",
    fontSize: "0.72rem",
    lineHeight: "1.4",
    margin: 0,
    padding: "0.5rem",
    maxHeight: "250px",
    minHeight: "250px",
    resize: "vertical",
    width: "100%",
  },
  jsonActionsRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  saveJsonButton: {
    backgroundColor: "#0e639c",
    border: "none",
    borderRadius: "4px",
    color: "#fff",
    cursor: "pointer",
    fontSize: "0.75rem",
    fontWeight: "bold",
    padding: "0.25rem 0.6rem",
  },
  saveDraftButton: {
    backgroundColor: "transparent",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#ddd",
    cursor: "pointer",
    fontSize: "0.75rem",
    padding: "0.25rem 0.6rem",
  },
  resetJsonButton: {
    backgroundColor: "transparent",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#aaa",
    cursor: "pointer",
    fontSize: "0.75rem",
    padding: "0.25rem 0.6rem",
  },
  jsonError: {
    color: "#f4a4a4",
    fontSize: "0.72rem",
  },
  jsonSuccess: {
    color: "#a8d5a2",
    fontSize: "0.72rem",
  },
  draftBadge: {
    color: "#c8b37a",
    fontSize: "0.72rem",
    margin: 0,
  },
  detailFooter: {
    display: "flex",
    gap: "0.5rem",
    justifyContent: "flex-end",
    paddingTop: "0.25rem",
    borderTop: "1px solid #3c3c3c",
  },
  saveBuilderButton: {
    backgroundColor: "#2d2d2d",
    border: "1px solid #555",
    borderRadius: "4px",
    color: "#fff",
    cursor: "pointer",
    fontSize: "0.78rem",
    fontWeight: "bold",
    padding: "0.3rem 0.7rem",
    whiteSpace: "nowrap",
  },
};
