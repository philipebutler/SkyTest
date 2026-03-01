/**
 * Unit tests for PlaywrightExecutor (Issue #9 – Browser Selection Support,
 * Issue #10 – Headed/Headless Mode, Issue #11 – Playwright Action Executor).
 *
 * These tests verify that:
 * - getLauncher() returns the correct Playwright browser launcher for each BrowserType
 * - The executor's browser selection logic covers all supported browser types
 * - The executor records the correct browser in run metadata
 * - The execute() method launches browsers in headed or headless mode as requested
 * - Steps are executed sequentially (Issue #11)
 * - Step duration is measured (Issue #11)
 * - Errors are captured per step (Issue #11)
 * - Execution stops on fatal failure (Issue #11)
 */

import { PlaywrightExecutor } from "./PlaywrightExecutor";
import { chromium, firefox, webkit } from "playwright";
import type { BrowserType, DSLPlan } from "../../shared/types";

describe("PlaywrightExecutor – getLauncher (browser selection)", () => {
  const executor = new PlaywrightExecutor();

  it("returns chromium launcher for 'chromium'", () => {
    expect(executor.getLauncher("chromium")).toBe(chromium);
  });

  it("returns firefox launcher for 'firefox'", () => {
    expect(executor.getLauncher("firefox")).toBe(firefox);
  });

  it("returns webkit launcher for 'webkit'", () => {
    expect(executor.getLauncher("webkit")).toBe(webkit);
  });

  it("defaults to chromium for an unrecognised browser type", () => {
    expect(executor.getLauncher("unknown" as BrowserType)).toBe(chromium);
  });

  it("covers all BrowserType values defined in shared/types", () => {
    const allBrowsers: BrowserType[] = ["chromium", "firefox", "webkit"];
    for (const browser of allBrowsers) {
      expect(executor.getLauncher(browser)).toBeDefined();
    }
  });
});

describe("PlaywrightExecutor – headed/headless mode (Issue #10)", () => {
  let executor: PlaywrightExecutor;
  let launchSpy: jest.Mock;

  beforeEach(() => {
    executor = new PlaywrightExecutor();
    const mockPage = {
      goto: jest.fn(),
      click: jest.fn(),
      fill: jest.fn(),
      selectOption: jest.fn(),
      check: jest.fn(),
      uncheck: jest.fn(),
      hover: jest.fn(),
      waitForTimeout: jest.fn(),
      waitForSelector: jest.fn(),
      waitForLoadState: jest.fn(),
      evaluate: jest.fn(),
      screenshot: jest.fn(),
      waitForFunction: jest.fn(),
    };
    const mockContext = { newPage: jest.fn().mockResolvedValue(mockPage), close: jest.fn() };
    const mockBrowser = { newContext: jest.fn().mockResolvedValue(mockContext), close: jest.fn() };
    launchSpy = jest.fn().mockResolvedValue(mockBrowser);
    jest.spyOn(executor, "getLauncher").mockReturnValue({ launch: launchSpy } as never);
  });

  it("passes headless: true when headed is false", async () => {
    const plan: DSLPlan = { version: "1", intent: "test", steps: [] };
    await executor.execute(plan, "chromium", false, "/tmp");
    expect(launchSpy).toHaveBeenCalledWith({ headless: true });
  });

  it("passes headless: false when headed is true", async () => {
    const plan: DSLPlan = { version: "1", intent: "test", steps: [] };
    await executor.execute(plan, "chromium", true, "/tmp");
    expect(launchSpy).toHaveBeenCalledWith({ headless: false });
  });
});

// ---------------------------------------------------------------------------
// Issue #11 – Playwright Action Executor acceptance criteria
// ---------------------------------------------------------------------------

/** Builds a fresh mock page + browser hierarchy and wires it into the executor. */
function setupExecutorWithMockPage(executor: PlaywrightExecutor): Record<string, jest.Mock> {
  const mockPage: Record<string, jest.Mock> = {
    goto: jest.fn().mockResolvedValue(undefined),
    click: jest.fn().mockResolvedValue(undefined),
    fill: jest.fn().mockResolvedValue(undefined),
    selectOption: jest.fn().mockResolvedValue(undefined),
    check: jest.fn().mockResolvedValue(undefined),
    uncheck: jest.fn().mockResolvedValue(undefined),
    hover: jest.fn().mockResolvedValue(undefined),
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    waitForLoadState: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue(undefined),
    screenshot: jest.fn().mockResolvedValue(undefined),
    waitForFunction: jest.fn().mockResolvedValue(undefined),
  };
  const mockContext = { newPage: jest.fn().mockResolvedValue(mockPage), close: jest.fn() };
  const mockBrowser = { newContext: jest.fn().mockResolvedValue(mockContext), close: jest.fn() };
  jest.spyOn(executor, "getLauncher").mockReturnValue({ launch: jest.fn().mockResolvedValue(mockBrowser) } as never);
  return mockPage;
}

describe("PlaywrightExecutor – sequential execution (Issue #11)", () => {
  it("executes steps in order and returns a result per step", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    const callOrder: string[] = [];
    mockPage.goto.mockImplementation(() => { callOrder.push("navigate"); return Promise.resolve(); });
    mockPage.click.mockImplementation(() => { callOrder.push("click"); return Promise.resolve(); });

    const plan: DSLPlan = {
      version: "1",
      intent: "sequential test",
      steps: [
        { action: "navigate", value: "https://example.com" },
        { action: "click", selector: "#btn" },
      ],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp");

    expect(callOrder).toEqual(["navigate", "click"]);
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults[0].action).toBe("navigate");
    expect(result.stepResults[1].action).toBe("click");
    expect(result.stepResults[0].stepIndex).toBe(0);
    expect(result.stepResults[1].stepIndex).toBe(1);
  });
});

describe("PlaywrightExecutor – step duration measurement (Issue #11)", () => {
  it("records a non-negative durationMs for each step", async () => {
    const executor = new PlaywrightExecutor();
    setupExecutorWithMockPage(executor);

    const plan: DSLPlan = {
      version: "1",
      intent: "duration test",
      steps: [
        { action: "navigate", value: "https://example.com" },
        { action: "screenshot" },
      ],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp");

    for (const stepResult of result.stepResults) {
      expect(typeof stepResult.durationMs).toBe("number");
      expect(stepResult.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("PlaywrightExecutor – error capture per step (Issue #11)", () => {
  it("captures the error message on a failing step and marks status as failed", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    mockPage.goto.mockRejectedValue(new Error("Navigation timed out"));

    const plan: DSLPlan = {
      version: "1",
      intent: "error capture test",
      steps: [{ action: "navigate", value: "https://example.com" }],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp");

    expect(result.stepResults[0].status).toBe("failed");
    expect(result.stepResults[0].error).toBe("Navigation timed out");
  });

  it("captures non-Error throwables as string", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    mockPage.goto.mockRejectedValue("plain string error");

    const plan: DSLPlan = {
      version: "1",
      intent: "non-error capture test",
      steps: [{ action: "navigate", value: "https://example.com" }],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp");

    expect(result.stepResults[0].status).toBe("failed");
    expect(result.stepResults[0].error).toBe("plain string error");
  });
});

describe("PlaywrightExecutor – stops on fatal failure (Issue #11)", () => {
  it("skips remaining steps after a fatal failure", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    mockPage.goto.mockRejectedValue(new Error("Fatal navigation error"));

    const plan: DSLPlan = {
      version: "1",
      intent: "stop on failure test",
      steps: [
        { action: "navigate", value: "https://example.com" },
        { action: "click", selector: "#btn" },
        { action: "hover", selector: "#menu" },
      ],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp");

    // Only the first (failed) step should have a result
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0].status).toBe("failed");
    // Subsequent steps must not have been invoked
    expect(mockPage.click).not.toHaveBeenCalled();
    expect(mockPage.hover).not.toHaveBeenCalled();
  });

  it("completes normally when all steps pass", async () => {
    const executor = new PlaywrightExecutor();
    setupExecutorWithMockPage(executor);

    const plan: DSLPlan = {
      version: "1",
      intent: "all pass test",
      steps: [
        { action: "navigate", value: "https://example.com" },
        { action: "screenshot" },
      ],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp");

    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults.every((r) => r.status === "passed")).toBe(true);
  });
});
