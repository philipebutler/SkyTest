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
import * as fs from "fs";
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
      keyboard: {
        type: jest.fn(),
        press: jest.fn(),
        down: jest.fn(),
        up: jest.fn(),
      },
      context: jest.fn(),
      waitForEvent: jest.fn(),
      frame: jest.fn(),
      $: jest.fn(),
      title: jest.fn(),
      url: jest.fn(),
      close: jest.fn(),
      setInputFiles: jest.fn(),
      once: jest.fn(),
    };
    const mockContext = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn(),
      pages: jest.fn().mockReturnValue([mockPage]),
      addCookies: jest.fn(),
      clearCookies: jest.fn(),
      cookies: jest.fn().mockResolvedValue([]),
    };
    mockPage.context.mockReturnValue(mockContext);
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
  const mockPage: Record<string, unknown> = {
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
    waitForEvent: jest.fn().mockResolvedValue(undefined),
    frame: jest.fn().mockReturnValue(null),
    $: jest.fn().mockResolvedValue(null),
    title: jest.fn().mockResolvedValue("tab"),
    url: jest.fn().mockReturnValue("https://example.com"),
    close: jest.fn().mockResolvedValue(undefined),
    setInputFiles: jest.fn().mockResolvedValue(undefined),
    once: jest.fn(),
    keyboard: {
      type: jest.fn().mockResolvedValue(undefined),
      press: jest.fn().mockResolvedValue(undefined),
      down: jest.fn().mockResolvedValue(undefined),
      up: jest.fn().mockResolvedValue(undefined),
    },
    context: jest.fn(),
  };
  const mockContext = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    close: jest.fn(),
    pages: jest.fn().mockReturnValue([mockPage]),
    addCookies: jest.fn().mockResolvedValue(undefined),
    clearCookies: jest.fn().mockResolvedValue(undefined),
    cookies: jest.fn().mockResolvedValue([]),
  };
  (mockPage.context as jest.Mock).mockReturnValue(mockContext);
  const mockBrowser = { newContext: jest.fn().mockResolvedValue(mockContext), close: jest.fn() };
  jest.spyOn(executor, "getLauncher").mockReturnValue({ launch: jest.fn().mockResolvedValue(mockBrowser) } as never);
  return mockPage as Record<string, jest.Mock>;
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

// ---------------------------------------------------------------------------
// Issue #12 – Artifact Capture acceptance criteria
// ---------------------------------------------------------------------------

describe("PlaywrightExecutor – artifact capture on step failure (Issue #12)", () => {
  it("captures a screenshot artifact when a step fails", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    mockPage.goto.mockRejectedValue(new Error("Navigation timed out"));

    const plan: DSLPlan = {
      version: "1",
      intent: "artifact capture on failure",
      steps: [{ action: "navigate", value: "https://example.com" }],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp");

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].type).toBe("screenshot");
  });

  it("links the captured artifact to the failed step result via artifactIds", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    mockPage.click.mockRejectedValue(new Error("Element not found"));

    const plan: DSLPlan = {
      version: "1",
      intent: "artifact linkage test",
      steps: [
        { action: "navigate", value: "https://example.com" },
        { action: "click", selector: "#missing" },
      ],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp");

    const failedStep = result.stepResults.find((r) => r.status === "failed");
    expect(failedStep).toBeDefined();
    expect(failedStep!.artifactIds).toHaveLength(1);
    expect(result.artifacts[0].id).toBe(failedStep!.artifactIds[0]);
  });

  it("stores artifact metadata including path and stepIndex", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    mockPage.goto.mockRejectedValue(new Error("Timeout"));

    const plan: DSLPlan = {
      version: "1",
      intent: "artifact metadata test",
      steps: [{ action: "navigate", value: "https://example.com" }],
    };

    const result = await executor.execute(plan, "chromium", false, "/artifacts");

    const artifact = result.artifacts[0];
    expect(artifact.stepIndex).toBe(0);
    expect(artifact.path).toContain("/artifacts");
    expect(artifact.path).toContain(".png");
    expect(artifact.createdAt).toBeDefined();
  });

  it("does not add artifacts when all steps pass", async () => {
    const executor = new PlaywrightExecutor();
    setupExecutorWithMockPage(executor);

    const plan: DSLPlan = {
      version: "1",
      intent: "no artifact on success",
      steps: [{ action: "navigate", value: "https://example.com" }],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp");

    expect(result.stepResults[0].status).toBe("passed");
    expect(result.artifacts).toHaveLength(0);
    expect(result.stepResults[0].artifactIds).toHaveLength(0);
  });

  it("still captures the error message when the failure screenshot also fails", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    mockPage.goto.mockRejectedValue(new Error("Navigation error"));
    mockPage.screenshot.mockRejectedValue(new Error("Screenshot failed"));

    const plan: DSLPlan = {
      version: "1",
      intent: "screenshot failure resilience",
      steps: [{ action: "navigate", value: "https://example.com" }],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp");

    expect(result.stepResults[0].status).toBe("failed");
    expect(result.stepResults[0].error).toBe("Navigation error");
    // No artifact because screenshot itself failed
    expect(result.artifacts).toHaveLength(0);
  });
});

describe("PlaywrightExecutor – screenshot action registers artifact (Issue #12)", () => {
  it("adds an artifact to the artifacts array when the screenshot action step is executed", async () => {
    const executor = new PlaywrightExecutor();
    setupExecutorWithMockPage(executor);

    const plan: DSLPlan = {
      version: "1",
      intent: "screenshot action artifact",
      steps: [{ action: "screenshot" }],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp");

    expect(result.stepResults[0].status).toBe("passed");
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].type).toBe("screenshot");
    expect(result.artifacts[0].path).toContain(".png");
    expect(result.artifacts[0].stepIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Issue #13 – storageState (session reuse) acceptance criteria
// ---------------------------------------------------------------------------

describe("PlaywrightExecutor – storageState session reuse (Issue #13)", () => {
  let executor: PlaywrightExecutor;
  let newContextSpy: jest.Mock;

  beforeEach(() => {
    executor = new PlaywrightExecutor();
    const mockPage = {
      goto: jest.fn().mockResolvedValue(undefined),
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
    newContextSpy = jest.fn().mockResolvedValue({ newPage: jest.fn().mockResolvedValue(mockPage), close: jest.fn() });
    const mockBrowser = { newContext: newContextSpy, close: jest.fn() };
    jest.spyOn(executor, "getLauncher").mockReturnValue({ launch: jest.fn().mockResolvedValue(mockBrowser) } as never);
  });

  it("passes storageState option to newContext when a valid path is provided", async () => {
    // Write a real temp file so fs.existsSync returns true
    const tmpFile = require("os").tmpdir() + "/skytest-storagestate-test.json";
    fs.writeFileSync(tmpFile, "{}");
    const plan: DSLPlan = { version: "1", intent: "session reuse", steps: [] };
    await executor.execute(plan, "chromium", false, "/tmp", tmpFile);
    expect(newContextSpy).toHaveBeenCalledWith({ storageState: tmpFile });
    fs.unlinkSync(tmpFile);
  });

  it("passes an empty context options when storageStatePath is not provided", async () => {
    const plan: DSLPlan = { version: "1", intent: "no session", steps: [] };
    await executor.execute(plan, "chromium", false, "/tmp");
    expect(newContextSpy).toHaveBeenCalledWith({});
  });

  it("passes empty context options when storageStatePath file does not exist", async () => {
    const plan: DSLPlan = { version: "1", intent: "missing state", steps: [] };
    await executor.execute(plan, "chromium", false, "/tmp", "/auth/does-not-exist-12345.json");
    expect(newContextSpy).toHaveBeenCalledWith({});
  });
});

// ---------------------------------------------------------------------------
// Issue #23 – Retry & Flake Handling acceptance criteria
// ---------------------------------------------------------------------------

describe("PlaywrightExecutor – per-step retry (Issue #23)", () => {
  it("retries a failing step and marks it passed when a later attempt succeeds", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    // First call fails, second call succeeds
    mockPage.goto
      .mockRejectedValueOnce(new Error("Flaky navigation"))
      .mockResolvedValueOnce(undefined);

    const plan: DSLPlan = {
      version: "1",
      intent: "step retry pass",
      steps: [{ action: "navigate", value: "https://example.com" }],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp", undefined, undefined, 1, "step");

    expect(result.stepResults[0].status).toBe("passed");
    expect(result.stepResults[0].retryAttempts).toHaveLength(2);
    expect(result.stepResults[0].retryAttempts![0].status).toBe("failed");
    expect(result.stepResults[0].retryAttempts![0].attempt).toBe(1);
    expect(result.stepResults[0].retryAttempts![1].status).toBe("passed");
    expect(result.stepResults[0].retryAttempts![1].attempt).toBe(2);
  });

  it("marks step as failed when all retry attempts fail", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    mockPage.goto.mockRejectedValue(new Error("Always fails"));

    const plan: DSLPlan = {
      version: "1",
      intent: "step retry all fail",
      steps: [{ action: "navigate", value: "https://example.com" }],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp", undefined, undefined, 2, "step");

    expect(result.stepResults[0].status).toBe("failed");
    // 3 total attempts (1 original + 2 retries)
    expect(result.stepResults[0].retryAttempts).toHaveLength(3);
    expect(result.stepResults[0].retryAttempts!.every((a) => a.status === "failed")).toBe(true);
  });

  it("records the error message in each failed retry attempt", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    mockPage.goto.mockRejectedValue(new Error("Network error"));

    const plan: DSLPlan = {
      version: "1",
      intent: "retry error messages",
      steps: [{ action: "navigate", value: "https://example.com" }],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp", undefined, undefined, 1, "step");

    expect(result.stepResults[0].retryAttempts).toBeDefined();
    for (const attempt of result.stepResults[0].retryAttempts!) {
      if (attempt.status === "failed") {
        expect(attempt.error).toBe("Network error");
      }
    }
  });

  it("does not populate retryAttempts when retryCount is 0 (default)", async () => {
    const executor = new PlaywrightExecutor();
    setupExecutorWithMockPage(executor);

    const plan: DSLPlan = {
      version: "1",
      intent: "no retries",
      steps: [{ action: "navigate", value: "https://example.com" }],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp");

    expect(result.stepResults[0].retryAttempts).toBeUndefined();
  });

  it("final status reflects retries: overall run passes when all steps eventually pass", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    // First navigate fails, second succeeds; click always passes
    mockPage.goto
      .mockRejectedValueOnce(new Error("Flaky"))
      .mockResolvedValueOnce(undefined);

    const plan: DSLPlan = {
      version: "1",
      intent: "final status reflects retries",
      steps: [
        { action: "navigate", value: "https://example.com" },
        { action: "click", selector: "#btn" },
      ],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp", undefined, undefined, 1, "step");

    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults.every((r) => r.status === "passed")).toBe(true);
  });
});

describe("PlaywrightExecutor – per-test retry (Issue #23)", () => {
  it("retries the entire test when a step fails and succeeds on the next attempt", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    // First test attempt: navigate fails; second attempt: navigate passes
    mockPage.goto
      .mockRejectedValueOnce(new Error("Flaky navigation"))
      .mockResolvedValueOnce(undefined);

    const plan: DSLPlan = {
      version: "1",
      intent: "test retry pass",
      steps: [{ action: "navigate", value: "https://example.com" }],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp", undefined, undefined, 1, "test");

    expect(result.stepResults[0].status).toBe("passed");
  });

  it("marks the test as failed when all test-level retries are exhausted", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    mockPage.goto.mockRejectedValue(new Error("Always fails"));

    const plan: DSLPlan = {
      version: "1",
      intent: "test retry all fail",
      steps: [{ action: "navigate", value: "https://example.com" }],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp", undefined, undefined, 2, "test");

    expect(result.stepResults[0].status).toBe("failed");
  });
});

describe("PlaywrightExecutor – advanced action domains", () => {
  it("executes keyboard actions", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    const plan: DSLPlan = {
      version: "1",
      intent: "keyboard",
      steps: [
        { action: "keyboardType", params: { text: "hello" } },
        { action: "keyboardPress", params: { key: "Enter" } },
      ],
    };

    await executor.execute(plan, "chromium", false, "/tmp");

    expect((mockPage.keyboard as any).type).toHaveBeenCalledWith("hello", { delay: undefined });
    expect((mockPage.keyboard as any).press).toHaveBeenCalledWith("Enter", { delay: undefined });
  });

  it("executes tab and frame actions", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);
    const mockFrame = {
      click: jest.fn().mockResolvedValue(undefined),
      fill: jest.fn().mockResolvedValue(undefined),
      selectOption: jest.fn().mockResolvedValue(undefined),
      check: jest.fn().mockResolvedValue(undefined),
      uncheck: jest.fn().mockResolvedValue(undefined),
      hover: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(undefined),
      evaluate: jest.fn().mockResolvedValue(undefined),
      setInputFiles: jest.fn().mockResolvedValue(undefined),
    };
    mockPage.frame.mockReturnValue(mockFrame as never);

    const context = mockPage.context();
    const secondPage = { ...mockPage, title: jest.fn().mockResolvedValue("second"), url: jest.fn().mockReturnValue("https://second.example") };
    context.pages.mockReturnValue([mockPage, secondPage]);
    context.newPage.mockResolvedValue(secondPage);

    const plan: DSLPlan = {
      version: "1",
      intent: "frame and tabs",
      steps: [
        { action: "frameSelect", params: { name: "frame-1" } },
        { action: "click", selector: "#inside-frame" },
        { action: "frameClear" },
        { action: "tabNew", params: { url: "https://new.example" } },
        { action: "tabSwitch", params: { index: 0 } },
      ],
    };

    await executor.execute(plan, "chromium", false, "/tmp");

    expect(mockFrame.click).toHaveBeenCalled();
    expect(context.newPage).toHaveBeenCalled();
  });

  it("executes upload, download, network, storage, and cookie actions", async () => {
    const executor = new PlaywrightExecutor();
    const mockPage = setupExecutorWithMockPage(executor);

    const downloadMock = {
      suggestedFilename: jest.fn().mockReturnValue("report.csv"),
      saveAs: jest.fn().mockResolvedValue(undefined),
    };

    mockPage.waitForEvent.mockImplementation((event: string) => {
      if (event === "download") return Promise.resolve(downloadMock);
      if (event === "request") {
        return Promise.resolve({ url: () => "https://example.com/api", method: () => "GET" });
      }
      if (event === "response") {
        return Promise.resolve({ url: () => "https://example.com/api", status: () => 200 });
      }
      return Promise.resolve(undefined);
    });

    const context = mockPage.context();
    context.cookies.mockResolvedValue([{ name: "sid", value: "x", domain: "example.com", path: "/" }]);

    const plan: DSLPlan = {
      version: "1",
      intent: "advanced io",
      steps: [
        { action: "uploadFile", selector: "input[type=file]", params: { files: ["./fixtures/a.txt"] } },
        { action: "downloadExpect" },
        { action: "networkWaitForRequest", params: { urlIncludes: "/api" } },
        { action: "networkWaitForResponse", params: { urlIncludes: "/api", status: 200 } },
        { action: "storageSet", params: { key: "token", value: "abc" } },
        { action: "cookieSet", params: { name: "sid", value: "x", domain: "example.com" } },
        { action: "cookieDelete", params: { name: "sid" } },
        { action: "cookieClear" },
      ],
    };

    const result = await executor.execute(plan, "chromium", false, "/tmp");

    expect(mockPage.setInputFiles).toHaveBeenCalled();
    expect(downloadMock.saveAs).toHaveBeenCalled();
    expect(mockPage.evaluate).toHaveBeenCalled();
    expect(context.addCookies).toHaveBeenCalled();
    expect(context.clearCookies).toHaveBeenCalled();
    expect(result.artifacts.some((a) => a.type === "download")).toBe(true);
  });
});
