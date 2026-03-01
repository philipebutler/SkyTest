import { chromium, firefox, webkit } from "playwright";
import type { Browser, BrowserContext, BrowserContextOptions, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import type { ActionStep, Artifact, Assertion, AssertionResult, BrowserType, DSLPlan, RetryAttempt, StepResult } from "../../shared/types";
import { AssertionEngine } from "./AssertionEngine";

export interface ExecutionResult {
  stepResults: StepResult[];
  assertionResults: AssertionResult[];
  artifacts: Artifact[];
}

/**
 * Playwright Executor (Issue #9 / SPEC §6, Issue #23 – Retry & Flake Handling).
 *
 * Responsible for:
 * - Launching the browser selected by the user (chromium, firefox, webkit)
 * - Executing a validated DSL plan step-by-step
 * - Capturing artifacts (screenshots) on step failure
 * - Recording the browser choice in run metadata
 * - Retrying failed steps or the entire test run (Issue #23)
 */
export class PlaywrightExecutor {
  /**
   * Execute a DSL plan using the specified browser.
   *
   * @param plan              - Validated DSLPlan to execute.
   * @param browser           - Browser to launch (chromium | firefox | webkit).
   * @param headed            - Whether to run the browser in headed (visible) mode.
   * @param artifactsDir      - Directory to write screenshots and other artifacts.
   * @param storageStatePath  - Optional path to a storageState.json for session reuse (Issue #13).
   * @param assertions        - Optional assertions to evaluate after all steps complete (Issue #17).
   * @param retryCount        - Number of additional attempts on failure (Issue #23).
   * @param retryMode         - "step" retries each failed step individually; "test" retries the
   *                            whole plan from the beginning (Issue #23).
   */
  async execute(
    plan: DSLPlan,
    browser: BrowserType,
    headed: boolean,
    artifactsDir: string,
    storageStatePath?: string,
    assertions?: Assertion[],
    retryCount?: number,
    retryMode?: "step" | "test",
    runId?: string
  ): Promise<ExecutionResult> {
    const launcher = this.getLauncher(browser);
    const browserInstance: Browser = await launcher.launch({ headless: !headed });
    // Reuse authenticated session when a valid storageState file is provided (Issue #13)
    const contextOptions: BrowserContextOptions =
      storageStatePath && fs.existsSync(storageStatePath)
        ? { storageState: storageStatePath }
        : {};
    const context: BrowserContext = await browserInstance.newContext(contextOptions);
    const page: Page = await context.newPage();

    const maxRetries = retryCount ?? 0;
    const mode = retryMode ?? "step";

    let stepResults: StepResult[];
    let artifacts: Artifact[] = [];

    if (mode === "test") {
      ({ stepResults, artifacts } = await this.executeWithTestRetry(
        page,
        plan,
        artifactsDir,
        artifacts,
        maxRetries,
        runId
      ));
    } else {
      ({ stepResults, artifacts } = await this.executeWithStepRetry(
        page,
        plan,
        artifactsDir,
        artifacts,
        maxRetries,
        runId
      ));
    }

    // Run assertions after all steps complete (Issue #17)
    const assertionResults: AssertionResult[] =
      assertions && assertions.length > 0
        ? await new AssertionEngine().runAssertions(page, assertions)
        : [];

    await context.close();
    await browserInstance.close();

    return { stepResults, assertionResults, artifacts };
  }

  /** Returns the Playwright browser launcher for the given BrowserType. */
  getLauncher(browser: BrowserType) {
    switch (browser) {
      case "firefox":
        return firefox;
      case "webkit":
        return webkit;
      case "chromium":
      default:
        return chromium;
    }
  }

  /**
   * Execute all steps with per-step retry (Issue #23).
   * Each failed step is retried up to maxRetries times before giving up.
   */
  private async executeWithStepRetry(
    page: Page,
    plan: DSLPlan,
    artifactsDir: string,
    artifacts: Artifact[],
    maxRetries: number,
    runId?: string
  ): Promise<{ stepResults: StepResult[]; artifacts: Artifact[] }> {
    const stepResults: StepResult[] = [];

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const result = await this.executeStepWithRetry(page, step, i, artifactsDir, artifacts, maxRetries, runId);
      stepResults.push(result);
      if (result.status === "failed") {
        break;
      }
    }

    return { stepResults, artifacts };
  }

  /**
   * Execute all steps with per-test retry (Issue #23).
   * If the test fails, all steps are re-run from the beginning up to maxRetries times.
   * Each test-level attempt is logged distinctly.
   */
  private async executeWithTestRetry(
    page: Page,
    plan: DSLPlan,
    artifactsDir: string,
    artifacts: Artifact[],
    maxRetries: number,
    runId?: string
  ): Promise<{ stepResults: StepResult[]; artifacts: Artifact[] }> {
    let stepResults: StepResult[] = [];
    let testAttempt = 1;
    const totalAttempts = maxRetries + 1;

    while (testAttempt <= totalAttempts) {
      if (testAttempt > 1) {
        console.log(
          `[PlaywrightExecutor] test-level retry attempt ${testAttempt}/${totalAttempts} (previous attempt failed)`
        );
      }
      stepResults = [];

      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        const start = Date.now();
        const result = await this.executeStep(page, step, i, artifactsDir, artifacts, testAttempt, runId);
        result.durationMs = Date.now() - start;
        stepResults.push(result);
        if (result.status === "failed") {
          break;
        }
      }

      const testPassed = stepResults.every((r) => r.status !== "failed");
      if (testPassed || testAttempt >= totalAttempts) {
        break;
      }
      testAttempt++;
    }

    return { stepResults, artifacts };
  }

  /**
   * Execute a single step with per-step retry (Issue #23).
   * Records each attempt in retryAttempts when more than one attempt is made.
   */
  private async executeStepWithRetry(
    page: Page,
    step: ActionStep,
    stepIndex: number,
    artifactsDir: string,
    artifacts: Artifact[],
    maxRetries: number,
    runId?: string
  ): Promise<StepResult> {
    const totalAttempts = maxRetries + 1;
    const retryAttempts: RetryAttempt[] = [];

    // lastResult is always assigned in the loop since totalAttempts >= 1
    let lastResult!: StepResult;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      if (attempt > 1) {
        console.log(
          `[PlaywrightExecutor] step ${stepIndex} ("${step.action}") – retry attempt ${attempt}/${totalAttempts}`
        );
      }
      const start = Date.now();
      const result = await this.executeStep(page, step, stepIndex, artifactsDir, artifacts, undefined, runId);
      result.durationMs = Date.now() - start;
      lastResult = result;

      if (maxRetries > 0) {
        retryAttempts.push({
          attempt,
          status: result.status === "failed" ? "failed" : "passed",
          error: result.error,
          durationMs: result.durationMs,
        });
      }

      if (result.status !== "failed") {
        break;
      }
    }

    if (maxRetries > 0) {
      lastResult.retryAttempts = retryAttempts;
    }

    return lastResult;
  }

  private async executeStep(
    page: Page,
    step: ActionStep,
    stepIndex: number,
    artifactsDir: string,
    artifacts: Artifact[],
    testAttempt?: number,
    runId?: string
  ): Promise<StepResult> {
    const result: StepResult = {
      stepIndex,
      action: step.action,
      status: "passed",
      artifactIds: [],
      durationMs: 0,
    };

    try {
      await this.runAction(page, step, stepIndex, artifactsDir, artifacts, runId);
    } catch (err) {
      result.status = "failed";
      result.error = err instanceof Error ? err.message : String(err);
      // Capture a screenshot on failure for diagnostics (SPEC §10.1)
      const attemptTag = testAttempt !== undefined ? `-attempt${testAttempt}` : "";
      // Use deterministic naming when a runId is supplied (Issue #24); otherwise
      // fall back to timestamp-based naming to preserve backward compatibility.
      const screenshotId = runId
        ? `${runId}-step-${stepIndex}${attemptTag}`
        : `artifact-${Date.now()}-${stepIndex}${attemptTag}`;
      const screenshotPath = path.join(artifactsDir, `${screenshotId}.png`);
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        const artifact: Artifact = {
          id: screenshotId,
          type: "screenshot",
          path: screenshotPath,
          createdAt: new Date().toISOString(),
          stepIndex,
        };
        artifacts.push(artifact);
        result.artifactIds.push(screenshotId);
      } catch {
        console.warn(`[PlaywrightExecutor] Could not capture failure screenshot for step ${stepIndex}`);
      }
    }

    return result;
  }

  private async runAction(page: Page, step: ActionStep, stepIndex: number, artifactsDir: string, artifacts: Artifact[], runId?: string): Promise<void> {
    const timeout = step.timeout ?? 30_000;
    switch (step.action) {
      case "navigate":
        await page.goto(step.value ?? "", { timeout });
        break;
      case "click":
        await page.click(step.selector ?? "", { timeout });
        break;
      case "fill":
        await page.fill(step.selector ?? "", step.value ?? "", { timeout });
        break;
      case "select":
        await page.selectOption(step.selector ?? "", step.value ?? "", { timeout });
        break;
      case "check":
        await page.check(step.selector ?? "", { timeout });
        break;
      case "uncheck":
        await page.uncheck(step.selector ?? "", { timeout });
        break;
      case "hover":
        await page.hover(step.selector ?? "", { timeout });
        break;
      case "wait":
        await page.waitForTimeout(Number(step.value ?? "500"));
        break;
      case "waitForSelector":
        await page.waitForSelector(step.selector ?? "", { timeout });
        break;
      case "waitForNavigation":
        await page.waitForLoadState("load", { timeout });
        break;
      case "scroll":
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView();
        }, step.selector ?? "");
        break;
      case "screenshot": {
        // Named screenshot step – save to the run's artifacts directory and register artifact.
        // Use deterministic naming when a runId is supplied (Issue #24).
        const screenshotId = runId
          ? `${runId}-screenshot-step-${stepIndex}`
          : `artifact-screenshot-${Date.now()}`;
        const screenshotPath = path.join(artifactsDir, `${screenshotId}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        artifacts.push({
          id: screenshotId,
          type: "screenshot",
          path: screenshotPath,
          createdAt: new Date().toISOString(),
          stepIndex,
        });
        break;
      }
      case "assert":
        if (step.selector) {
          await page.waitForSelector(step.selector, { timeout });
        }
        if (step.value) {
          await page.waitForFunction(
            (text) => document.body.innerText.includes(text as string),
            step.value,
            { timeout }
          );
        }
        break;
      default:
        throw new Error(`Unknown action: ${step.action}`);
    }
  }
}
