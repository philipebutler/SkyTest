import { chromium, firefox, webkit } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import * as path from "path";
import type { ActionStep, Artifact, BrowserType, DSLPlan, StepResult } from "../../shared/types";

export interface ExecutionResult {
  stepResults: StepResult[];
  artifacts: Artifact[];
}

/**
 * Playwright Executor (Issue #9 / SPEC §6).
 *
 * Responsible for:
 * - Launching the browser selected by the user (chromium, firefox, webkit)
 * - Executing a validated DSL plan step-by-step
 * - Capturing artifacts (screenshots) on step failure
 * - Recording the browser choice in run metadata
 */
export class PlaywrightExecutor {
  /**
   * Execute a DSL plan using the specified browser.
   *
   * @param plan         - Validated DSLPlan to execute.
   * @param browser      - Browser to launch (chromium | firefox | webkit).
   * @param headed       - Whether to run the browser in headed (visible) mode.
   * @param artifactsDir - Directory to write screenshots and other artifacts.
   */
  async execute(
    plan: DSLPlan,
    browser: BrowserType,
    headed: boolean,
    artifactsDir: string
  ): Promise<ExecutionResult> {
    const launcher = this.getLauncher(browser);
    const browserInstance: Browser = await launcher.launch({ headless: !headed });
    const context: BrowserContext = await browserInstance.newContext();
    const page: Page = await context.newPage();

    const stepResults: StepResult[] = [];
    const artifacts: Artifact[] = [];

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const start = Date.now();
      const result = await this.executeStep(page, step, i, artifactsDir, artifacts);
      result.durationMs = Date.now() - start;
      stepResults.push(result);
      if (result.status === "failed") {
        break;
      }
    }

    await context.close();
    await browserInstance.close();

    return { stepResults, artifacts };
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

  private async executeStep(
    page: Page,
    step: ActionStep,
    stepIndex: number,
    artifactsDir: string,
    artifacts: Artifact[]
  ): Promise<StepResult> {
    const result: StepResult = {
      stepIndex,
      action: step.action,
      status: "passed",
      artifactIds: [],
      durationMs: 0,
    };

    try {
      await this.runAction(page, step, stepIndex, artifactsDir, artifacts);
    } catch (err) {
      result.status = "failed";
      result.error = err instanceof Error ? err.message : String(err);
      // Capture a screenshot on failure for diagnostics (SPEC §10.1)
      const screenshotId = `artifact-${Date.now()}-${stepIndex}`;
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

  private async runAction(page: Page, step: ActionStep, stepIndex: number, artifactsDir: string, artifacts: Artifact[]): Promise<void> {
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
        // Named screenshot step – save to the run's artifacts directory and register artifact
        const screenshotId = `artifact-screenshot-${Date.now()}`;
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
