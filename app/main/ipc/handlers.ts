import type { IpcMain, IpcMainInvokeEvent } from "electron";
import * as fs from "fs";
import * as path from "path";
import type { BrowserType, DSLPlan, Run, RunConfig, SaveTestPayload, Settings, TestCase } from "../../shared/types";
import { StorageService } from "../storage/StorageService";
import { CopilotAdapter } from "../llm/CopilotAdapter";
import { LLMOrchestrator, type ChatSendPayload } from "../llm/LLMOrchestrator";
import { validateDSL, validateDSLPolicy } from "../validation/dslValidator";
import { PlaywrightExecutor } from "../runner/PlaywrightExecutor";

export function registerIpcHandlers(ipcMain: IpcMain): void {
  const orchestrator = new LLMOrchestrator(new CopilotAdapter());
  const executor = new PlaywrightExecutor();

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
        // Validate DSL schema before execution (Issue #7)
        // Pass content as unknown so validateDSL performs full runtime checks first.
        const schemaResult = validateDSL(response.content as unknown);
        if (!schemaResult.valid) {
          console.warn(`[chat:send] streamId=${streamId} – DSL schema validation failed:`, schemaResult.errors);
          // Notify the renderer so the user sees an actionable error message (Issue #8)
          if (!sender.isDestroyed()) {
            sender.send("chat:executionError", { streamId, reason: "schema", errors: schemaResult.errors });
          }
          return;
        }
        // Safe cast: validateDSL returned valid=true, confirming the shape is DSLPlan
        const dslPlan = response.content as DSLPlan;
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
        const executionResult = await executor.execute(
          dslPlan,
          (payload.browser ?? "chromium") as BrowserType,
          false,
          storage.artifactsDir
        );
        const allPassed = executionResult.stepResults.every((r) => r.status !== "failed");
        console.log(
          `[chat:send] streamId=${streamId} – execution ${allPassed ? "passed" : "failed"} ` +
          `(${executionResult.stepResults.length} steps, browser=${payload.browser})`
        );
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
        const executionResult = await executor.execute(
          dslPlan,
          config.browser,
          config.headed,
          StorageService.getInstance().artifactsDir
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
    const runsDir = StorageService.getInstance().runsDir;
    fs.writeFileSync(
      path.join(runsDir, `${run.id}.json`),
      JSON.stringify(run, null, 2)
    );
    return run;
  });

  // Channel: executeTest
  // Accepts a testId, loads the TestCase from disk, and executes it.
  // Full Playwright execution will be wired in subsequent issues.
  ipcMain.handle("executeTest", async (_event, payload: { testId: string }): Promise<Run> => {
    const run: Run = {
      schemaVersion: "1",
      id: `run-${Date.now()}`,
      testId: payload.testId,
      environment: "default",
      browser: "chromium",
      headed: false,
      toolPolicy: "read-only",
      status: "running",
      stepResults: [],
      artifacts: [],
      startedAt: new Date().toISOString(),
    };
    // Load TestCase from tests/ directory and execute with the stored browser (Issue #9)
    try {
      const testsDir = StorageService.getInstance().testsDir;
      const testFilePath = path.join(testsDir, `${payload.testId}.json`);
      if (!fs.existsSync(testFilePath)) {
        throw new Error(`Test file not found: ${payload.testId}`);
      }
      const testCase = JSON.parse(fs.readFileSync(testFilePath, "utf-8")) as TestCase;
      // Use browser from TestCase metadata if available, otherwise default to chromium
      const browserToUse: BrowserType = testCase.browser ?? "chromium";
      run.browser = browserToUse;
      const dslPlan: DSLPlan = { version: "1", intent: payload.testId, steps: testCase.steps };
      const executionResult = await executor.execute(
        dslPlan,
        browserToUse,
        run.headed,
        StorageService.getInstance().artifactsDir
      );
      run.stepResults = executionResult.stepResults;
      run.artifacts = executionResult.artifacts;
      run.status = executionResult.stepResults.some((r) => r.status === "failed") ? "failed" : "passed";
    } catch (err) {
      run.status = "failed";
      console.error("[executeTest] Execution error:", err);
    }
    run.finishedAt = new Date().toISOString();
    const runsDir = StorageService.getInstance().runsDir;
    fs.writeFileSync(
      path.join(runsDir, `${run.id}.json`),
      JSON.stringify(run, null, 2)
    );
    return run;
  });

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
      steps: payload.steps,
      assertions: [],
      browser: payload.browser,
      createdAt: now,
      updatedAt: now,
    };
    const testsDir = StorageService.getInstance().testsDir;
    fs.writeFileSync(
      path.join(testsDir, `${testCase.id}.json`),
      JSON.stringify(testCase, null, 2)
    );
    return testCase;
  });

  // Channel: getRunHistory
  // Returns all persisted Run records from the runs/ directory.
  ipcMain.handle("getRunHistory", async (): Promise<Run[]> => {
    const runsDir = StorageService.getInstance().runsDir;
    const files = fs
      .readdirSync(runsDir)
      .filter((f) => f.endsWith(".json"));
    const runs: Run[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(runsDir, f), "utf-8");
        runs.push(JSON.parse(raw) as Run);
      } catch {
        console.warn(`[getRunHistory] Skipping corrupted run file: ${f}`);
      }
    }
    runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return runs;
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
}
