import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { dialog } from "electron";
import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";
import { ADVANCED_ACTION_VERBS, CORE_ACTION_VERBS } from "../../shared/types";
import type { ActionStep, Assertion, BrowserType, DSLPlan, LLMRequest, LLMResponse, Run, RunConfig, SaveTestPayload, Settings, TestCase, TestEditorValidationState, ToolPolicy } from "../../shared/types";
import { StorageService } from "../storage/StorageService";
import { TestCaseRepository } from "../storage/TestCaseRepository";
import { RunRepository } from "../storage/RunRepository";
import { RunExporter } from "../storage/RunExporter";
import { CopilotAdapter } from "../llm/CopilotAdapter";
import { buildChatCompletionsUrl } from "../llm/endpoint";
import { LLMOrchestrator, type ChatSendPayload } from "../llm/LLMOrchestrator";
import { normalizeDSLPlan, validateDSL, validateDSLPolicy } from "../validation/dslValidator";
import { PlaywrightExecutor } from "../runner/PlaywrightExecutor";
import { RecordEngine } from "../record/RecordEngine";
import { RecordingRefactorer, type RefactoredRecording } from "../record/RecordingRefactorer";

const LEGACY_CHAT_ACTION = "chat";

function extractJsonFromText(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(candidate);
}

function sanitizeStep(raw: unknown): ActionStep | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const action = typeof source.action === "string" ? source.action : "";
  if (!action) return null;

  const params =
    typeof source.params === "object" && source.params !== null
      ? (source.params as Record<string, unknown>)
      : undefined;
  const topLevelValue = typeof source.value === "string" ? source.value : undefined;
  const topLevelUrl = typeof source.url === "string" ? source.url : undefined;

  let normalizedValue = topLevelValue;
  if (!normalizedValue) {
    if (typeof params?.value === "string") normalizedValue = params.value;
    else if (typeof params?.text === "string") normalizedValue = params.text;
    else if (typeof params?.url === "string") normalizedValue = params.url;
    else if (topLevelUrl) normalizedValue = topLevelUrl;
  }

  let normalizedParams = params;
  if (action === "keyboardPress" && !normalizedParams?.key && normalizedValue) {
    normalizedParams = { ...(normalizedParams ?? {}), key: normalizedValue };
  }

  return {
    action,
    selector: typeof source.selector === "string" ? source.selector : undefined,
    value: normalizedValue,
    url: topLevelUrl,
    params: normalizedParams,
    timeout: typeof source.timeout === "number" ? source.timeout : undefined,
    optional: typeof source.optional === "boolean" ? source.optional : undefined,
  };
}

function sanitizeTestCaseUpdate(existing: TestCase, raw: unknown): TestCase {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Updated test JSON must be an object.");
  }

  const source = raw as Record<string, unknown>;
  const now = new Date().toISOString();

  const rawSteps = Array.isArray(source.steps) ? source.steps : existing.steps;
  const steps = rawSteps
    .map((s) => sanitizeStep(s))
    .filter((s): s is ActionStep => s !== null);

  if (steps.length === 0) {
    throw new Error("Updated test must contain at least one valid step.");
  }

  const rawPreconditions = Array.isArray(source.preconditions)
    ? source.preconditions
    : existing.preconditions;
  const preconditions = rawPreconditions
    .map((s) => sanitizeStep(s))
    .filter((s): s is ActionStep => s !== null);

  const rawAssertions = Array.isArray(source.assertions) ? source.assertions : existing.assertions;
  const assertions: Assertion[] = [];
  for (const rawAssertion of rawAssertions) {
    if (typeof rawAssertion !== "object" || rawAssertion === null) continue;
    const record = rawAssertion as Record<string, unknown>;
    const type = record.type;
    if (
      type !== "textVisible" &&
      type !== "elementVisible" &&
      type !== "urlContains" &&
      type !== "countEquals"
    ) {
      continue;
    }
    assertions.push({
      type,
      selector: typeof record.selector === "string" ? record.selector : undefined,
      value: typeof record.value === "string" ? record.value : undefined,
      count: typeof record.count === "number" ? record.count : undefined,
    });
  }

  const nextName =
    typeof source.name === "string" && source.name.trim() !== ""
      ? source.name.trim()
      : existing.name;
  const nextTags = Array.isArray(source.tags)
    ? source.tags.filter((t): t is string => typeof t === "string")
    : existing.tags;
  const nextBrowser =
    source.browser === "chromium" || source.browser === "firefox" || source.browser === "webkit"
      ? source.browser
      : existing.browser;
  const nextRetryCount =
    typeof source.retryCount === "number" && source.retryCount >= 0
      ? Math.floor(source.retryCount)
      : existing.retryCount;
  const nextRetryMode =
    source.retryMode === "step" || source.retryMode === "test"
      ? source.retryMode
      : existing.retryMode;

  return {
    schemaVersion:
      typeof source.schemaVersion === "string" && source.schemaVersion.trim() !== ""
        ? source.schemaVersion
        : existing.schemaVersion,
    id: existing.id,
    name: nextName,
    tags: nextTags,
    preconditions,
    steps,
    assertions,
    browser: nextBrowser,
    retryCount: nextRetryCount,
    retryMode: nextRetryMode,
    uiDraft: undefined,
    createdAt: existing.createdAt,
    updatedAt: now,
  };
}

function buildDraftPreservingUpdate(existing: TestCase, rawJson: string, message: string): TestCase {
  return {
    ...existing,
    uiDraft: {
      isDraft: true,
      invalidRawJson: rawJson,
      parseError: message,
      validationErrors: [message],
      stagedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
}

export function applyRawTestUpdate(existing: TestCase, payload: { rawJson: string; allowDraft?: boolean }): TestCase {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.rawJson);
  } catch (err) {
    const message = `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
    if (payload.allowDraft) {
      return buildDraftPreservingUpdate(existing, payload.rawJson, message);
    }
    throw new Error(message);
  }

  try {
    return sanitizeTestCaseUpdate(existing, parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (payload.allowDraft) {
      return buildDraftPreservingUpdate(existing, payload.rawJson, message);
    }
    throw err;
  }
}

export async function expandLegacyChatSteps(
  steps: ActionStep[],
  adapter: { complete: (request: LLMRequest) => Promise<LLMResponse> }
): Promise<ActionStep[]> {
  const expanded: ActionStep[] = [];

  for (const step of steps) {
    if (step.action !== LEGACY_CHAT_ACTION) {
      expanded.push(step);
      continue;
    }

    const prompt = step.value?.trim();
    if (!prompt) {
      throw new Error("Legacy chat step is missing a command value.");
    }

    const llmResponse = await adapter.complete({
      systemPrompt:
        "You are a test automation planner. Output only JSON that conforms to DSLPlan v1 with fields version, intent, and steps. Do not include markdown or explanations.",
      userMessage: prompt,
      toolPolicy: "full",
      allowedVerbs: [...CORE_ACTION_VERBS, ...ADVANCED_ACTION_VERBS],
      environment: "default",
      baseUrl: "",
    });

    if (llmResponse.type !== "plan") {
      throw new Error("Legacy chat step could not be converted to executable steps.");
    }

    const parsed = extractJsonFromText(llmResponse.rawText);
    const normalizedPlan = normalizeDSLPlan(parsed, prompt);
    const schemaResult = validateDSL(normalizedPlan);
    if (!schemaResult.valid) {
      const details = schemaResult.errors.map((e) => e.message).join("; ");
      throw new Error(`Legacy chat step conversion produced invalid DSL: ${details}`);
    }

    expanded.push(...(normalizedPlan as DSLPlan).steps);
  }

  return expanded;
}

export function registerIpcHandlers(ipcMain: IpcMain): void {
  const orchestrator = new LLMOrchestrator(new CopilotAdapter());
  const executor = new PlaywrightExecutor();
  const recordEngine = new RecordEngine();
  const runRepo = new RunRepository(StorageService.getInstance().runsDir);

  // Channel: chat:send (Issue #5 / SPEC §16, Issue #6 clarification enforcement)
  // Accepts a prompt + context from the renderer, starts an async LLM stream,
  // and pushes chat:stream tokens back to the renderer window.
  // Returns { streamId } immediately so the renderer can correlate stream events.
  // If the LLM response is a clarification, the terminal token carries responseType="clarification"
  // and no Playwright execution is triggered (Issue #6).
  ipcMain.handle("chat:send", async (event: IpcMainInvokeEvent, payload: ChatSendPayload): Promise<{ streamId: string }> => {
    const streamId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const sender = event.sender;
    // Run asynchronously so the invoke call returns streamId without waiting for the full LLM response
    void orchestrator.handleChatSend(streamId, payload, sender).then(async (response) => {
      // Issue #6: Never execute Playwright when the LLM is asking for clarification.
      // Execution is only permitted when the response is a resolved DSL plan.
      if (response.type === "plan") {
        const normalizedPlan = normalizeDSLPlan(response.content as unknown, payload.prompt);
        // Validate DSL schema before execution (Issue #7)
        // Pass content as unknown so validateDSL performs full runtime checks first.
        const schemaResult = validateDSL(normalizedPlan);
        if (!schemaResult.valid) {
          console.warn(`[chat:send] streamId=${streamId} – DSL schema validation failed:`, schemaResult.errors);
          // Notify the renderer so the user sees an actionable error message (Issue #8)
          if (!sender.isDestroyed()) {
            sender.send("chat:executionError", { streamId, reason: "schema", errors: schemaResult.errors });
          }
          return;
        }
        // Safe cast: validateDSL returned valid=true, confirming the shape is DSLPlan
        const dslPlan = normalizedPlan as DSLPlan;
        const policyResult = validateDSLPolicy(dslPlan, payload.toolPolicy);
        if (!policyResult.valid) {
          console.warn(`[chat:send] streamId=${streamId} – DSL policy validation failed:`, policyResult.errors);
          // Notify the renderer so the user sees which actions are blocked (Issue #8 / SPEC §8)
          if (!sender.isDestroyed()) {
            sender.send("chat:executionError", { streamId, reason: "policy", errors: policyResult.errors });
          }
          return;
        }
        // Wire Playwright executor – only reached when type === "plan" and DSL is valid (Issue #9)
        const storage = StorageService.getInstance();
        const browserToUse = (payload.browser ?? "chromium") as BrowserType;
        const run: Run = {
          schemaVersion: "1",
          id: `run-${Date.now()}-${streamId}`,
          environment: payload.environment ?? "default",
          browser: browserToUse,
          headed: payload.headed ?? false,
          toolPolicy: payload.toolPolicy,
          status: "running",
          stepResults: [],
          artifacts: [],
          startedAt: new Date().toISOString(),
        };
        try {
          const executionResult = await executor.execute(
            dslPlan,
            browserToUse,
            payload.headed ?? false,
            storage.artifactsDir
          );
          run.stepResults = executionResult.stepResults;
          run.artifacts = executionResult.artifacts;
          const allPassed = executionResult.stepResults.every((r) => r.status !== "failed");
          run.status = allPassed ? "passed" : "failed";
          console.log(
            `[chat:send] streamId=${streamId} – execution ${run.status} ` +
            `(${executionResult.stepResults.length} steps, browser=${browserToUse})`
          );
        } catch (err) {
          run.status = "failed";
          console.error(`[chat:send] streamId=${streamId} – execution error:`, err);
        }
        run.finishedAt = new Date().toISOString();
        // Persist the run record so it survives app restart (Issue #18)
        runRepo.save(run);
      } else {
        console.log(`[chat:send] streamId=${streamId} – no execution: response type is "${response.type}"`);
      }
    });
    return { streamId };
  });
  // Channel: executeCommand
  // Accepts a RunConfig from the renderer, runs the given command and returns a Run record.
  // Full Playwright execution will be wired in subsequent issues.
  ipcMain.handle("executeCommand", async (_event, config: RunConfig): Promise<Run> => {
    const run: Run = {
      schemaVersion: "1",
      id: `run-${Date.now()}`,
      environment: config.environment,
      browser: config.browser,
      headed: config.headed,
      toolPolicy: config.toolPolicy,
      status: "running",
      stepResults: [],
      artifacts: [],
      startedAt: new Date().toISOString(),
    };
    // Execute the plan with the selected browser (Issue #9).
    // An empty DSLPlan is used here when no steps are provided; full command parsing
    // (turning config.command into DSL steps) is part of Issue #11.
    try {
      const dslPlan: DSLPlan = { version: "1", intent: config.command, steps: [] };
      if (dslPlan.steps.length > 0) {
        const storage = StorageService.getInstance();
        const storageStatePath = storage.getStorageStatePath(config.authProfile ?? "none") ?? undefined;
        const executionResult = await executor.execute(
          dslPlan,
          config.browser,
          config.headed,
          storage.artifactsDir,
          storageStatePath,
          undefined,
          config.retryCount,
          config.retryMode
        );
        run.stepResults = executionResult.stepResults;
        run.artifacts = executionResult.artifacts;
        run.status = executionResult.stepResults.some((r) => r.status === "failed") ? "failed" : "passed";
      } else {
        run.status = "passed";
      }
    } catch (err) {
      run.status = "failed";
      console.error("[executeCommand] Execution error:", err);
    }
    run.finishedAt = new Date().toISOString();
    runRepo.save(run);
    return run;
  });

  // Channel: executeDSLPlan
  // Executes a pre-defined DSL plan directly (without LLM round-trip).
  ipcMain.handle(
    "executeDSLPlan",
    async (
      _event,
      payload: {
        plan: unknown;
        intent?: string;
        environment: string;
        browser: BrowserType;
        headed: boolean;
        toolPolicy: ToolPolicy;
      }
    ): Promise<
      | { ok: true; run: Run }
      | { ok: false; reason: "schema" | "policy"; errors: Array<{ stepIndex: number; message: string }> }
    > => {
      const normalizedPlan = normalizeDSLPlan(payload.plan, payload.intent ?? "Execute DSL plan");

      const schemaResult = validateDSL(normalizedPlan);
      if (!schemaResult.valid) {
        return { ok: false, reason: "schema", errors: schemaResult.errors };
      }

      const dslPlan = normalizedPlan as DSLPlan;
      const policyResult = validateDSLPolicy(dslPlan, payload.toolPolicy);
      if (!policyResult.valid) {
        return { ok: false, reason: "policy", errors: policyResult.errors };
      }

      const storage = StorageService.getInstance();
      const run: Run = {
        schemaVersion: "1",
        id: `run-${Date.now()}-direct`,
        environment: payload.environment ?? "default",
        browser: payload.browser ?? "chromium",
        headed: payload.headed ?? false,
        toolPolicy: payload.toolPolicy,
        status: "running",
        stepResults: [],
        artifacts: [],
        startedAt: new Date().toISOString(),
      };

      try {
        const executionResult = await executor.execute(
          dslPlan,
          payload.browser,
          payload.headed,
          storage.artifactsDir
        );
        run.stepResults = executionResult.stepResults;
        run.artifacts = executionResult.artifacts;
        const allPassed = executionResult.stepResults.every((r) => r.status !== "failed");
        run.status = allPassed ? "passed" : "failed";
      } catch (err) {
        run.status = "failed";
        console.error("[executeDSLPlan] Execution error:", err);
      }

      run.finishedAt = new Date().toISOString();
      runRepo.save(run);
      return { ok: true, run };
    }
  );

  // Channel: executeTest
  // Accepts a testId, loads the TestCase from disk, and executes it.
  // Full Playwright execution will be wired in subsequent issues.
  ipcMain.handle(
    "executeTest",
    async (
      _event,
      payload: {
        testId: string;
        environment?: string;
        browser?: BrowserType;
        headed?: boolean;
        toolPolicy?: ToolPolicy;
        authProfile?: string;
      }
    ): Promise<Run> => {
    const run: Run = {
      schemaVersion: "1",
      id: `run-${Date.now()}`,
      testId: payload.testId,
      environment: payload.environment ?? "default",
      browser: payload.browser ?? "chromium",
      headed: payload.headed ?? false,
      toolPolicy: payload.toolPolicy ?? "read-only",
      status: "running",
      stepResults: [],
      artifacts: [],
      startedAt: new Date().toISOString(),
    };
    // Load TestCase from tests/ directory and execute with the stored browser (Issue #9)
    try {
      const testsDir = StorageService.getInstance().testsDir;
      const testRepo = new TestCaseRepository(testsDir);
      const testCase = testRepo.load(payload.testId);
      if (!testCase) {
        throw new Error(`Test file not found: ${payload.testId}`);
      }

      let executableSteps = testCase.steps;
      if (testCase.steps.some((step) => step.action === LEGACY_CHAT_ACTION)) {
        executableSteps = await expandLegacyChatSteps(testCase.steps, new CopilotAdapter());
      }

      // Use explicit run browser when provided, otherwise TestCase browser, then chromium.
      const browserToUse: BrowserType = payload.browser ?? testCase.browser ?? "chromium";
      run.browser = browserToUse;
      const normalizedPlan = normalizeDSLPlan({ version: "1", intent: payload.testId, steps: executableSteps }, payload.testId) as DSLPlan;
      const dslPlan: DSLPlan = { ...normalizedPlan, intent: payload.testId };
      const storage = StorageService.getInstance();
      // Reuse auth session using selected profile when provided, otherwise environment profile.
      const authProfileName = payload.authProfile && payload.authProfile !== "none"
        ? payload.authProfile
        : run.environment;
      const storageStatePath = storage.getStorageStatePath(authProfileName) ?? undefined;
      // Use retry settings from the TestCase if set, otherwise fall back to global settings (Issue #23)
      const settings = storage.getSettings();
      const retryCount = testCase.retryCount ?? settings.retryCount;
      const retryMode = testCase.retryMode ?? settings.retryMode;
      const executionResult = await executor.execute(
        dslPlan,
        browserToUse,
        run.headed,
        storage.artifactsDir,
        storageStatePath,
        testCase.assertions,
        retryCount,
        retryMode
      );
      run.stepResults = executionResult.stepResults;
      run.assertionResults = executionResult.assertionResults;
      run.artifacts = executionResult.artifacts;
      const stepsFailed = executionResult.stepResults.some((r) => r.status === "failed");
      const assertionsFailed = executionResult.assertionResults.some((r) => r.status === "failed");
      run.status = stepsFailed || assertionsFailed ? "failed" : "passed";
    } catch (err) {
      run.status = "failed";
      const errorMessage = err instanceof Error ? err.message : String(err);
      run.stepResults = [
        {
          stepIndex: 0,
          action: "executeTest",
          status: "failed",
          error: errorMessage,
          artifactIds: [],
          durationMs: 0,
        },
      ];
      console.error("[executeTest] Execution error:", err);
    }
    run.finishedAt = new Date().toISOString();
    runRepo.save(run);
    return run;
  }
  );

  // Channel: saveTest
  // Accepts a test name and chat-sourced steps, persists as a TestCase in tests/.
  ipcMain.handle("saveTest", async (_event, payload: SaveTestPayload): Promise<TestCase> => {
    const now = new Date().toISOString();
    const testCase: TestCase = {
      schemaVersion: "1",
      id: `test-${Date.now()}`,
      name: payload.name,
      tags: [],
      preconditions: [],
      steps: payload.steps
        .map((step) => sanitizeStep(step))
        .filter((step): step is ActionStep => step !== null),
      assertions: payload.assertions ?? [],
      browser: payload.browser,
      uiDraft: payload.uiDraft,
      createdAt: now,
      updatedAt: now,
    };

    if (testCase.steps.length === 0) {
      throw new Error("Cannot save a test without at least one valid step.");
    }

    const testRepo = new TestCaseRepository(StorageService.getInstance().testsDir);
    testRepo.save(testCase);
    return testCase;
  });

  // Channel: updateTest
  // Replaces a TestCase by ID using raw JSON edited from the Test Library.
  ipcMain.handle(
    "updateTest",
    async (_event, payload: { testId: string; rawJson: string; allowDraft?: boolean }): Promise<TestCase> => {
      const testRepo = new TestCaseRepository(StorageService.getInstance().testsDir);
      const existing = testRepo.load(payload.testId);
      if (!existing) {
        throw new Error(`Test not found: ${payload.testId}`);
      }

      const updated = applyRawTestUpdate(existing, payload);
      testRepo.save(updated);
      return updated;
    }
  );

  // Channel: validateTestDraft
  // Validates builder steps against schema and tool policy without execution.
  ipcMain.handle(
    "validateTestDraft",
    async (
      _event,
      payload: { steps: ActionStep[]; toolPolicy: ToolPolicy }
    ): Promise<TestEditorValidationState> => {
      const plan: DSLPlan = {
        version: "1",
        intent: "Builder validation preview",
        steps: payload.steps ?? [],
      };

      const schema = validateDSL(plan);
      const policy = schema.valid ? validateDSLPolicy(plan, payload.toolPolicy) : { valid: false, errors: [] };

      return {
        schemaValid: schema.valid,
        schemaErrors: schema.errors,
        policyValid: schema.valid ? policy.valid : false,
        policyErrors: schema.valid ? policy.errors : [],
      };
    }
  );

  // Channel: convertLegacyChatSteps
  // Converts legacy action:"chat" steps to canonical executable steps for preview/apply in UI.
  ipcMain.handle(
    "convertLegacyChatSteps",
    async (_event, payload: { steps: ActionStep[] }): Promise<{ converted: boolean; steps: ActionStep[] }> => {
      const inputSteps = payload.steps ?? [];
      if (!inputSteps.some((step) => step.action === LEGACY_CHAT_ACTION)) {
        return { converted: false, steps: inputSteps };
      }

      const convertedSteps = await expandLegacyChatSteps(inputSteps, new CopilotAdapter());
      return { converted: true, steps: convertedSteps };
    }
  );

  // Channel: listTests
  // Returns all persisted TestCase records from the tests/ directory (Issue #15).
  ipcMain.handle("listTests", async (): Promise<TestCase[]> => {
    const testRepo = new TestCaseRepository(StorageService.getInstance().testsDir);
    return testRepo.list();
  });

  // Channel: deleteTest
  // Deletes a TestCase by ID from the tests/ directory (Issue #15).
  ipcMain.handle("deleteTest", async (_event, payload: { testId: string }): Promise<void> => {
    const testRepo = new TestCaseRepository(StorageService.getInstance().testsDir);
    testRepo.delete(payload.testId);
  });

  // Channel: exportRun (Issue #20)
  // Loads a Run by ID, prompts the user to choose an export directory,
  // and writes <runId>.md and <runId>.json to that location.
  // Returns { mdPath, jsonPath } on success or throws on cancellation/error.
  ipcMain.handle(
    "exportRun",
    async (_event, payload: { runId: string }): Promise<{ mdPath: string; jsonPath: string }> => {
      const run = runRepo.load(payload.runId);
      if (!run) {
        throw new Error(`Run not found: ${payload.runId}`);
      }

      // Prompt the user to select an export directory.
      const result = await dialog.showOpenDialog({
        title: "Select Export Folder",
        defaultPath: StorageService.getInstance().exportsDir,
        properties: ["openDirectory", "createDirectory"],
      });

      if (result.canceled || result.filePaths.length === 0) {
        throw new Error("Export cancelled by user.");
      }

      const exportDir = result.filePaths[0];
      // Sanitize the run ID to prevent path traversal: strip all non-alphanumeric characters
      // except hyphens and underscores, then apply path.basename as a second guard.
      const safeId = path.basename(payload.runId.replace(/[^a-z0-9_-]/gi, "_"));
      const { markdown, json } = new RunExporter().export(run);

      const mdPath = path.join(exportDir, `${safeId}.md`);
      const jsonPath = path.join(exportDir, `${safeId}.json`);

      fs.writeFileSync(mdPath, markdown, "utf-8");
      fs.writeFileSync(jsonPath, json, "utf-8");

      console.log(`[exportRun] Exported run ${payload.runId} to: ${exportDir}`);
      return { mdPath, jsonPath };
    }
  );

  // Channel: getRunHistory
  // Returns all persisted Run records from the runs/ directory (Issue #18).
  ipcMain.handle("getRunHistory", async (): Promise<Run[]> => {
    return runRepo.list();
  });

  // Channel: getSettings
  // Returns the current persisted settings (Issue #2).
  ipcMain.handle("getSettings", async (): Promise<Settings> => {
    return StorageService.getInstance().getSettings();
  });

  // Channel: saveSettings
  // Persists user-supplied path overrides and returns the updated settings (Issue #2).
  ipcMain.handle(
    "saveSettings",
    async (_event, patch: Partial<Settings>): Promise<Settings> => {
      return StorageService.getInstance().saveSettings(patch);
    }
  );

  // Channel: llm:testConnection
  // Sends a minimal request to the configured LLM endpoint to verify connectivity.
  // Returns { ok, message, model?, latencyMs? }.
  ipcMain.handle(
    "llm:testConnection",
    async (): Promise<{ ok: boolean; message: string; model?: string; latencyMs?: number }> => {
      const settings = StorageService.getInstance().getSettings();
      const endpoint = settings.llmEndpoint?.trim();
      const apiKey = settings.llmApiKey?.trim();
      const model = settings.llmModel?.trim() || "gpt-4o";

      if (!endpoint || !apiKey) {
        return { ok: false, message: "API Base URL and API Key must be configured before testing." };
      }

      const start = Date.now();
      try {
        const response = await fetch(buildChatCompletionsUrl(endpoint), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "Reply with exactly: OK" }],
          }),
        });
        const latencyMs = Date.now() - start;

        if (!response.ok) {
          const errText = await response.text().catch(() => "(no body)");
          return { ok: false, message: `HTTP ${response.status}: ${errText.slice(0, 200)}`, latencyMs };
        }

        const data = (await response.json()) as { model?: string; choices?: Array<{ message?: { content?: string } }> };
        const reply = data.choices?.[0]?.message?.content ?? "(no reply)";
        const usedModel = data.model ?? model;
        return { ok: true, message: `Connected! Model: ${usedModel} — Reply: "${reply.trim()}"`, model: usedModel, latencyMs };
      } catch (err) {
        const latencyMs = Date.now() - start;
        return { ok: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`, latencyMs };
      }
    }
  );

  // Channel: auth:updateSession (Issue #13)
  // Launches a headed Chromium browser so the user can log in manually.
  // Saves storageState.json to the auth directory for the given environment.
  // The IPC call blocks until the user closes the browser window.
  ipcMain.handle(
    "auth:updateSession",
    async (_event, payload: { environment: string }): Promise<{ saved: boolean; path: string }> => {
      const environment = payload.environment ?? "default";
      const authDir = StorageService.getInstance().authDir;
      // Sanitize environment name to prevent path traversal (Issue #13)
      const safeName = environment.replace(/[^a-z0-9_-]/gi, "_");
      const storageStatePath = path.join(authDir, `${safeName}.json`);

      const browser = await chromium.launch({ headless: false });
      const context = await browser.newContext();
      await context.newPage();

      let stateSaved = false;

      // Save storageState when a page closes while the context is still valid.
      // Page-close events fire before the context/browser-disconnect events,
      // so context.storageState() is callable here (Issue #13).
      // stateSaved is set to true before the first await, preventing concurrent
      // duplicate saves across multiple page-close events in the same event loop.
      const onPageClose = async () => {
        if (stateSaved) return;
        stateSaved = true;
        try {
          await context.storageState({ path: storageStatePath });
          console.log(`[auth:updateSession] storageState saved to: ${storageStatePath}`);
        } catch (err) {
          console.warn(`[auth:updateSession] Could not save storageState:`, err);
        }
      };

      // Register listener for the initial page and any future pages the user opens.
      for (const p of context.pages()) {
        p.on("close", () => void onPageClose());
      }
      context.on("page", (p) => p.on("close", () => void onPageClose()));

      // Wait for the user to close the browser window.
      await new Promise<void>((resolve) => {
        browser.on("disconnected", () => resolve());
      });

      return { saved: stateSaved, path: storageStatePath };
    }
  );

  // Channel: auth:listProfiles (Issue #13)
  // Returns the list of saved auth profile names (environments with a storageState file).
  ipcMain.handle("auth:listProfiles", async (): Promise<string[]> => {
    return StorageService.getInstance().listAuthProfiles();
  });

  // Channel: record:start (Issue #21)
  // Launches a headed browser, attaches DOM event listeners for navigation/clicks/inputs,
  // and pushes record:event messages to the renderer for each captured ActionStep.
  // Returns { ok: true } when the browser is ready.
  ipcMain.handle(
    "record:start",
    async (event: IpcMainInvokeEvent, payload: { browser?: BrowserType }): Promise<{ ok: true }> => {
      const sender = event.sender;
      const browser = payload?.browser ?? "chromium";
      await recordEngine.start((step) => {
        if (!sender.isDestroyed()) {
          sender.send("record:event", step);
        }
      }, browser);
      return { ok: true };
    }
  );

  // Channel: record:stop (Issue #21)
  // Stops the in-progress recording, saves the raw recording file to the recordings directory,
  // and returns the captured steps as ActionStep[].
  ipcMain.handle(
    "record:stop",
    async (): Promise<{ steps: ActionStep[] }> => {
      const recordingsDir = StorageService.getInstance().recordingsDir;
      const steps = await recordEngine.stop(recordingsDir);
      return { steps };
    }
  );

  // Channel: record:refactor (Issue #22)
  // Sends raw ActionStep[] to the LLM for refactoring into clean DSL with suggested assertions.
  // Returns a RefactoredRecording for the user to review before saving.
  ipcMain.handle(
    "record:refactor",
    async (_event, payload: { steps: ActionStep[] }): Promise<RefactoredRecording> => {
      const refactorer = new RecordingRefactorer(new CopilotAdapter());
      return refactorer.refactor(payload.steps ?? []);
    }
  );
}
