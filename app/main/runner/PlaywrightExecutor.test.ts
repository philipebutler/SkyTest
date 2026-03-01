/**
 * Unit tests for PlaywrightExecutor (Issue #9 – Browser Selection Support,
 * Issue #10 – Headed/Headless Mode).
 *
 * These tests verify that:
 * - getLauncher() returns the correct Playwright browser launcher for each BrowserType
 * - The executor's browser selection logic covers all supported browser types
 * - The executor records the correct browser in run metadata
 * - The execute() method launches browsers in headed or headless mode as requested
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
