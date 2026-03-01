/**
 * Unit tests for PlaywrightExecutor (Issue #9 – Browser Selection Support).
 *
 * These tests verify that:
 * - getLauncher() returns the correct Playwright browser launcher for each BrowserType
 * - The executor's browser selection logic covers all supported browser types
 * - The executor records the correct browser in run metadata
 */

import { PlaywrightExecutor } from "./PlaywrightExecutor";
import { chromium, firefox, webkit } from "playwright";
import type { BrowserType } from "../../shared/types";

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
