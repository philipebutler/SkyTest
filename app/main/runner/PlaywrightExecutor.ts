import { chromium, firefox, webkit } from "playwright";
import type { Browser, BrowserContext, BrowserContextOptions, Dialog, Download, Frame, Page, Request, Response } from "playwright";
import * as fs from "fs";
import * as path from "path";
import type { ActionStep, Artifact, Assertion, AssertionResult, BrowserType, DSLPlan, RetryAttempt, StepResult } from "../../shared/types";
import { AssertionEngine } from "./AssertionEngine";

export interface ExecutionResult {
  stepResults: StepResult[];
  assertionResults: AssertionResult[];
  artifacts: Artifact[];
}

interface RuntimeState {
  currentPage: Page;
  currentFrame: Frame | null;
  pendingDialog: Promise<void> | null;
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
  private static escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private static escapeCssString(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  private async trySemanticFill(page: Page, selector: string, value: string, timeout: number): Promise<boolean> {
    const label = selector.trim();
    if (!label) return false;

    const safeLabel = PlaywrightExecutor.escapeRegExp(label);
    const safeCss = PlaywrightExecutor.escapeCssString(label);
    const labelRegex = new RegExp(safeLabel, "i");

    const attempts: Array<() => Promise<void>> = [
      async () => {
        await page.getByLabel(label, { exact: false }).first().fill(value, { timeout });
      },
      async () => {
        await page.getByPlaceholder(label, { exact: false }).first().fill(value, { timeout });
      },
      async () => {
        await page.getByRole("textbox", { name: labelRegex }).first().fill(value, { timeout });
      },
      async () => {
        await page.getByRole("combobox", { name: labelRegex }).first().fill(value, { timeout });
      },
      async () => {
        await page
          .locator(`input[name="${safeCss}"], textarea[name="${safeCss}"], input[aria-label="${safeCss}"], textarea[aria-label="${safeCss}"]`)
          .first()
          .fill(value, { timeout });
      },
    ];

    if (/search\s*(input|box|field)?/i.test(label)) {
      attempts.push(async () => {
        await page.locator('textarea[name="q"], input[name="q"], input[type="search"]').first().fill(value, { timeout });
      });
    }

    for (const attempt of attempts) {
      try {
        await attempt();
        return true;
      } catch {
        // Continue trying fallback selectors.
      }
    }

    return false;
  }

  private async trySemanticClick(page: Page, selector: string, timeout: number): Promise<boolean> {
    const label = selector.trim();
    if (!label) return false;

    const safeLabel = PlaywrightExecutor.escapeRegExp(label);
    const labelRegex = new RegExp(safeLabel, "i");
    const safeCss = PlaywrightExecutor.escapeCssString(label);

    const attempts: Array<() => Promise<void>> = [
      async () => {
        await page.getByRole("button", { name: labelRegex }).first().click({ timeout });
      },
      async () => {
        await page.getByRole("link", { name: labelRegex }).first().click({ timeout });
      },
      async () => {
        await page.getByText(label, { exact: false }).first().click({ timeout });
      },
      async () => {
        await page.locator(`[aria-label="${safeCss}"], [title="${safeCss}"], [data-testid="${safeCss}"]`).first().click({ timeout });
      },
    ];

    for (const attempt of attempts) {
      try {
        await attempt();
        return true;
      } catch {
        // Continue trying fallback selectors.
      }
    }

    return false;
  }

  private getTarget(runtime: RuntimeState): Page | Frame {
    return runtime.currentFrame ?? runtime.currentPage;
  }

  private buildUrlMatcher(params: Record<string, unknown>): (url: string) => boolean {
    const urlIncludes = typeof params.urlIncludes === "string" ? params.urlIncludes : undefined;
    const urlRegex = typeof params.urlRegex === "string" ? params.urlRegex : undefined;

    if (urlRegex) {
      const regex = new RegExp(urlRegex);
      return (url: string) => regex.test(url);
    }

    if (urlIncludes) {
      return (url: string) => url.includes(urlIncludes);
    }

    return () => true;
  }

  private async armDialogHandler(
    runtime: RuntimeState,
    mode: "accept" | "dismiss",
    timeout: number,
    options: { messageIncludes?: string; promptText?: string } = {}
  ): Promise<void> {
    runtime.pendingDialog = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for dialog to ${mode}.`));
      }, timeout);

      runtime.currentPage.once("dialog", async (dialog: Dialog) => {
        try {
          if (options.messageIncludes && !dialog.message().includes(options.messageIncludes)) {
            throw new Error(`Dialog message did not include expected text: ${options.messageIncludes}`);
          }
          if (mode === "accept") {
            await dialog.accept(options.promptText);
          } else {
            await dialog.dismiss();
          }
          clearTimeout(timer);
          resolve();
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

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
    const runtime: RuntimeState = {
      currentPage: page,
      currentFrame: null,
      pendingDialog: null,
    };

    const maxRetries = retryCount ?? 0;
    const mode = retryMode ?? "step";

    let stepResults: StepResult[];
    let artifacts: Artifact[] = [];

    if (mode === "test") {
      ({ stepResults, artifacts } = await this.executeWithTestRetry(
        page,
        runtime,
        plan,
        artifactsDir,
        artifacts,
        maxRetries,
        runId
      ));
    } else {
      ({ stepResults, artifacts } = await this.executeWithStepRetry(
        page,
        runtime,
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
    runtime: RuntimeState,
    plan: DSLPlan,
    artifactsDir: string,
    artifacts: Artifact[],
    maxRetries: number,
    runId?: string
  ): Promise<{ stepResults: StepResult[]; artifacts: Artifact[] }> {
    const stepResults: StepResult[] = [];

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const result = await this.executeStepWithRetry(page, runtime, step, i, artifactsDir, artifacts, maxRetries, runId);
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
    runtime: RuntimeState,
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
        const result = await this.executeStep(page, runtime, step, i, artifactsDir, artifacts, testAttempt, runId);
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
    runtime: RuntimeState,
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
      const result = await this.executeStep(page, runtime, step, stepIndex, artifactsDir, artifacts, undefined, runId);
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
    runtime: RuntimeState,
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
      await this.runAction(page, runtime, step, stepIndex, artifactsDir, artifacts, runId);
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

  private async runAction(page: Page, runtime: RuntimeState, step: ActionStep, stepIndex: number, artifactsDir: string, artifacts: Artifact[], runId?: string): Promise<void> {
    const timeout = step.timeout ?? 30_000;
    const target = this.getTarget(runtime);
    const params = (typeof step.params === "object" && step.params !== null ? step.params : {}) as Record<string, unknown>;

    switch (step.action) {
      case "navigate":
        await runtime.currentPage.goto(step.value ?? "", { timeout });
        runtime.currentFrame = null;
        break;
      case "click":
        try {
          await target.click(step.selector ?? "", { timeout });
        } catch (err) {
          const recovered = runtime.currentFrame
            ? false
            : await this.trySemanticClick(runtime.currentPage, step.selector ?? "", timeout);
          if (!recovered) {
            throw err;
          }
        }
        break;
      case "fill":
        try {
          await target.fill(step.selector ?? "", step.value ?? "", { timeout });
        } catch (err) {
          const recovered = runtime.currentFrame
            ? false
            : await this.trySemanticFill(runtime.currentPage, step.selector ?? "", step.value ?? "", timeout);
          if (!recovered) {
            throw err;
          }
        }
        break;
      case "select":
        await target.selectOption(step.selector ?? "", step.value ?? "", { timeout });
        break;
      case "check":
        await target.check(step.selector ?? "", { timeout });
        break;
      case "uncheck":
        await target.uncheck(step.selector ?? "", { timeout });
        break;
      case "hover":
        await target.hover(step.selector ?? "", { timeout });
        break;
      case "wait":
        await runtime.currentPage.waitForTimeout(Number(step.value ?? "500"));
        break;
      case "waitForSelector":
        await target.waitForSelector(step.selector ?? "", { timeout });
        break;
      case "waitForNavigation":
        await runtime.currentPage.waitForLoadState("load", { timeout });
        break;
      case "scroll":
        await target.evaluate((sel) => {
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
        await runtime.currentPage.screenshot({ path: screenshotPath, fullPage: true });
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
          await target.waitForSelector(step.selector, { timeout });
        }
        if (step.value) {
          await runtime.currentPage.waitForFunction(
            (text) => document.body.innerText.includes(text as string),
            step.value,
            { timeout }
          );
        }
        break;
      case "keyboardType":
        await runtime.currentPage.keyboard.type(String(params.text ?? ""), { delay: typeof params.delayMs === "number" ? params.delayMs : undefined });
        break;
      case "keyboardPress":
        await runtime.currentPage.keyboard.press(String(params.key ?? ""), {
          delay: typeof params.delayMs === "number" ? params.delayMs : undefined,
        });
        break;
      case "keyboardDown":
        await runtime.currentPage.keyboard.down(String(params.key ?? ""));
        break;
      case "keyboardUp":
        await runtime.currentPage.keyboard.up(String(params.key ?? ""));
        break;
      case "frameSelect": {
        const byName = typeof params.name === "string" ? params.name : undefined;
        const byUrl = typeof params.url === "string" ? params.url : undefined;
        const bySelector = typeof params.selector === "string" ? params.selector : undefined;
        let frame: Frame | null = null;
        if (byName || byUrl) {
          frame = runtime.currentPage.frame({
            name: byName,
            url: byUrl ? new RegExp(PlaywrightExecutor.escapeRegExp(byUrl)) : undefined,
          });
        }
        if (!frame && bySelector) {
          const element = await runtime.currentPage.$(bySelector);
          frame = (await element?.contentFrame()) ?? null;
        }
        if (!frame) {
          throw new Error("frameSelect could not find a matching frame.");
        }
        runtime.currentFrame = frame;
        break;
      }
      case "frameClear":
        runtime.currentFrame = null;
        break;
      case "tabNew": {
        const newPage = await runtime.currentPage.context().newPage();
        runtime.currentPage = newPage;
        runtime.currentFrame = null;
        if (typeof params.url === "string" && params.url.trim() !== "") {
          await runtime.currentPage.goto(params.url, { timeout });
        }
        break;
      }
      case "tabSwitch": {
        const pages = runtime.currentPage.context().pages();
        let nextPage: Page | undefined;
        if (typeof params.index === "number") {
          nextPage = pages[params.index];
        } else if (typeof params.titleIncludes === "string") {
          for (const candidate of pages) {
            const title = await candidate.title();
            if (title.includes(params.titleIncludes)) {
              nextPage = candidate;
              break;
            }
          }
        } else if (typeof params.urlIncludes === "string") {
          nextPage = pages.find((candidate) => candidate.url().includes(params.urlIncludes as string));
        }
        if (!nextPage) {
          throw new Error("tabSwitch could not find a matching tab.");
        }
        runtime.currentPage = nextPage;
        runtime.currentFrame = null;
        break;
      }
      case "tabClose": {
        const pages = runtime.currentPage.context().pages();
        const pageToClose =
          typeof params.index === "number" && pages[params.index] ? pages[params.index] : runtime.currentPage;
        await pageToClose.close({ runBeforeUnload: true });
        const remaining = runtime.currentPage.context().pages();
        if (remaining.length === 0) {
          runtime.currentPage = await runtime.currentPage.context().newPage();
        } else {
          runtime.currentPage = remaining[0];
        }
        runtime.currentFrame = null;
        break;
      }
      case "dialogExpect": {
        const dialog = await runtime.currentPage.waitForEvent("dialog", { timeout });
        if (typeof params.type === "string" && dialog.type() !== params.type) {
          throw new Error(`Expected dialog type ${params.type} but received ${dialog.type()}.`);
        }
        if (typeof params.messageIncludes === "string" && !dialog.message().includes(params.messageIncludes)) {
          throw new Error(`Dialog message did not include expected text: ${params.messageIncludes}`);
        }
        await dialog.dismiss();
        break;
      }
      case "dialogAccept":
        await this.armDialogHandler(runtime, "accept", timeout, {
          messageIncludes: typeof params.messageIncludes === "string" ? params.messageIncludes : undefined,
          promptText: typeof params.promptText === "string" ? params.promptText : undefined,
        });
        break;
      case "dialogDismiss":
        await this.armDialogHandler(runtime, "dismiss", timeout, {
          messageIncludes: typeof params.messageIncludes === "string" ? params.messageIncludes : undefined,
        });
        break;
      case "uploadFile": {
        const files = Array.isArray(params.files)
          ? params.files.filter((file): file is string => typeof file === "string")
          : typeof params.files === "string"
          ? [params.files]
          : [];
        await target.setInputFiles(step.selector ?? "", files, { timeout });
        break;
      }
      case "downloadExpect": {
        const download = await runtime.currentPage.waitForEvent("download", { timeout });
        const suggestedName = download.suggestedFilename();
        const expectedName = typeof params.fileNameContains === "string" ? params.fileNameContains : undefined;
        if (expectedName && !suggestedName.includes(expectedName)) {
          throw new Error(`Downloaded file name "${suggestedName}" did not include "${expectedName}".`);
        }
        const downloadId = runId
          ? `${runId}-download-step-${stepIndex}`
          : `artifact-download-${Date.now()}-${stepIndex}`;
        const downloadPath = path.join(artifactsDir, `${downloadId}-${suggestedName}`);
        await download.saveAs(downloadPath);
        artifacts.push({
          id: downloadId,
          type: "download",
          path: downloadPath,
          createdAt: new Date().toISOString(),
          stepIndex,
        });
        break;
      }
      case "networkWaitForRequest": {
        const matches = this.buildUrlMatcher(params);
        const method = typeof params.method === "string" ? params.method.toUpperCase() : undefined;
        await runtime.currentPage.waitForEvent("request", {
          timeout,
          predicate: (request: Request) => matches(request.url()) && (!method || request.method().toUpperCase() === method),
        });
        break;
      }
      case "networkWaitForResponse": {
        const matches = this.buildUrlMatcher(params);
        const status = typeof params.status === "number" ? params.status : undefined;
        await runtime.currentPage.waitForEvent("response", {
          timeout,
          predicate: (response: Response) => matches(response.url()) && (!status || response.status() === status),
        });
        break;
      }
      case "storageSet": {
        const storage = params.storage === "session" ? "sessionStorage" : "localStorage";
        const key = String(params.key ?? "");
        const data = typeof params.value === "string" ? params.value : JSON.stringify(params.value);
        await runtime.currentPage.evaluate(
          ({ targetStorage, itemKey, itemValue }) => {
            window[targetStorage as "localStorage" | "sessionStorage"].setItem(itemKey, itemValue);
          },
          { targetStorage: storage, itemKey: key, itemValue: data }
        );
        break;
      }
      case "storageRemove": {
        const storage = params.storage === "session" ? "sessionStorage" : "localStorage";
        const key = String(params.key ?? "");
        await runtime.currentPage.evaluate(
          ({ targetStorage, itemKey }) => {
            window[targetStorage as "localStorage" | "sessionStorage"].removeItem(itemKey);
          },
          { targetStorage: storage, itemKey: key }
        );
        break;
      }
      case "storageClear": {
        const storage = params.storage === "session" ? "sessionStorage" : "localStorage";
        await runtime.currentPage.evaluate((targetStorage) => {
          window[targetStorage as "localStorage" | "sessionStorage"].clear();
        }, storage);
        break;
      }
      case "cookieSet": {
        const cookie: Parameters<BrowserContext["addCookies"]>[0][number] = {
          name: String(params.name ?? ""),
          value: String(params.value ?? ""),
          path: typeof params.path === "string" ? params.path : "/",
          httpOnly: typeof params.httpOnly === "boolean" ? params.httpOnly : false,
          secure: typeof params.secure === "boolean" ? params.secure : false,
          sameSite: params.sameSite === "Lax" || params.sameSite === "None" || params.sameSite === "Strict" ? params.sameSite : "Lax",
        };
        if (typeof params.url === "string") {
          cookie.url = params.url;
        } else if (typeof params.domain === "string") {
          cookie.domain = params.domain;
        }
        await runtime.currentPage.context().addCookies([cookie]);
        break;
      }
      case "cookieDelete": {
        const name = String(params.name ?? "");
        const allCookies = await runtime.currentPage.context().cookies();
        const remaining = allCookies.filter((cookie) => cookie.name !== name);
        await runtime.currentPage.context().clearCookies();
        if (remaining.length > 0) {
          await runtime.currentPage.context().addCookies(remaining);
        }
        break;
      }
      case "cookieClear":
        await runtime.currentPage.context().clearCookies();
        break;
      default:
        throw new Error(`Unknown action: ${step.action}`);
    }

    if (
      runtime.pendingDialog &&
      step.action !== "dialogAccept" &&
      step.action !== "dialogDismiss" &&
      step.action !== "dialogExpect"
    ) {
      await runtime.pendingDialog;
      runtime.pendingDialog = null;
    }
  }
}
