/**
 * Unit tests for RecordEngine – Issue #21: Record Mode Capture Engine.
 *
 * Verifies:
 * - getLauncher() returns the correct Playwright launcher per BrowserType
 * - isRecording state transitions (idle → recording → idle)
 * - stop() before start() returns an empty array without throwing
 * - start() throws when already recording
 * - start() launches a headed browser and attaches listeners
 * - stop() saves a raw recording JSON file when steps were captured
 * - stop() skips file creation when no steps were captured
 * - pushStep: onStep callback is invoked for each captured step
 * - buildBestSelector() covers all selector priority cases
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { chromium, firefox, webkit } from "playwright";
import type { BrowserType } from "../../shared/types";
import { RecordEngine, buildBestSelector } from "./RecordEngine";

// ---------------------------------------------------------------------------
// buildBestSelector – pure selector heuristic unit tests
// ---------------------------------------------------------------------------

describe("buildBestSelector – selector priority", () => {
  it("prefers data-testid above all others", () => {
    expect(
      buildBestSelector({ testid: "submit-btn", ariaLabel: "Submit", id: "btn", name: "submit", tagName: "button", classNames: ["primary"] })
    ).toBe('[data-testid="submit-btn"]');
  });

  it("uses aria-label when testid is absent", () => {
    expect(
      buildBestSelector({ testid: null, ariaLabel: "Close dialog", id: "close", name: null, tagName: "button", classNames: [] })
    ).toBe('[aria-label="Close dialog"]');
  });

  it("uses id when testid and aria-label are absent", () => {
    expect(
      buildBestSelector({ testid: null, ariaLabel: null, id: "username", name: "user", tagName: "input", classNames: ["field"] })
    ).toBe("#username");
  });

  it("uses name attribute when testid, aria-label and id are absent", () => {
    expect(
      buildBestSelector({ testid: null, ariaLabel: null, id: null, name: "email", tagName: "input", classNames: [] })
    ).toBe('[name="email"]');
  });

  it("uses tagName + classes as a fallback", () => {
    expect(
      buildBestSelector({ testid: null, ariaLabel: null, id: null, name: null, tagName: "div", classNames: ["card", "active"] })
    ).toBe("div.card.active");
  });

  it("uses bare tagName when no classes are present", () => {
    expect(
      buildBestSelector({ testid: null, ariaLabel: null, id: null, name: null, tagName: "span", classNames: [] })
    ).toBe("span");
  });

  it("ignores empty strings in classNames", () => {
    expect(
      buildBestSelector({ testid: null, ariaLabel: null, id: null, name: null, tagName: "p", classNames: ["", "highlight", ""] })
    ).toBe("p.highlight");
  });
});

// ---------------------------------------------------------------------------
// getLauncher – browser selection
// ---------------------------------------------------------------------------

describe("RecordEngine – getLauncher", () => {
  const engine = new RecordEngine();

  it("returns chromium launcher for 'chromium'", () => {
    expect(engine.getLauncher("chromium")).toBe(chromium);
  });

  it("returns firefox launcher for 'firefox'", () => {
    expect(engine.getLauncher("firefox")).toBe(firefox);
  });

  it("returns webkit launcher for 'webkit'", () => {
    expect(engine.getLauncher("webkit")).toBe(webkit);
  });

  it("defaults to chromium for an unrecognised browser type", () => {
    expect(engine.getLauncher("unknown" as BrowserType)).toBe(chromium);
  });
});

// ---------------------------------------------------------------------------
// isRecording state
// ---------------------------------------------------------------------------

describe("RecordEngine – isRecording", () => {
  it("is false before any recording has been started", () => {
    const engine = new RecordEngine();
    expect(engine.isRecording).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stop() before start() – should return [] without throwing
// ---------------------------------------------------------------------------

describe("RecordEngine – stop before start", () => {
  it("returns an empty array when stop is called without a prior start", async () => {
    const engine = new RecordEngine();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skytest-rec-"));
    const steps = await engine.stop(tmpDir);
    expect(steps).toEqual([]);
    // No recording file should be created because there are no steps
    const files = fs.readdirSync(tmpDir);
    expect(files).toHaveLength(0);
    fs.rmdirSync(tmpDir);
  });
});

// ---------------------------------------------------------------------------
// start() – headed browser launch and state transition
// ---------------------------------------------------------------------------

function buildMockBrowserStack() {
  const mockPage = {
    exposeFunction: jest.fn().mockResolvedValue(undefined),
    addInitScript: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    mainFrame: jest.fn().mockReturnValue({}),
  };
  const mockContext = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const mockBrowser = {
    newContext: jest.fn().mockResolvedValue(mockContext),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return { mockPage, mockContext, mockBrowser };
}

describe("RecordEngine – start()", () => {
  it("transitions isRecording to true after start", async () => {
    const engine = new RecordEngine();
    const { mockBrowser } = buildMockBrowserStack();
    const launchSpy = jest.fn().mockResolvedValue(mockBrowser);
    jest.spyOn(engine, "getLauncher").mockReturnValue({ launch: launchSpy } as never);

    await engine.start(jest.fn(), "chromium");

    expect(engine.isRecording).toBe(true);
    // Clean up – stop recording to avoid interference
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skytest-start-"));
    await engine.stop(tmpDir);
    fs.rmdirSync(tmpDir);
  });

  it("always launches the browser in headed mode", async () => {
    const engine = new RecordEngine();
    const { mockBrowser } = buildMockBrowserStack();
    const launchSpy = jest.fn().mockResolvedValue(mockBrowser);
    jest.spyOn(engine, "getLauncher").mockReturnValue({ launch: launchSpy } as never);

    await engine.start(jest.fn());

    expect(launchSpy).toHaveBeenCalledWith({ headless: false });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skytest-headed-"));
    await engine.stop(tmpDir);
    fs.rmdirSync(tmpDir);
  });

  it("throws when start() is called while already recording", async () => {
    const engine = new RecordEngine();
    const { mockBrowser } = buildMockBrowserStack();
    jest.spyOn(engine, "getLauncher").mockReturnValue({ launch: jest.fn().mockResolvedValue(mockBrowser) } as never);

    await engine.start(jest.fn());
    await expect(engine.start(jest.fn())).rejects.toThrow("Recording already in progress");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skytest-double-"));
    await engine.stop(tmpDir);
    fs.rmdirSync(tmpDir);
  });
});

// ---------------------------------------------------------------------------
// stop() – file persistence and state reset
// ---------------------------------------------------------------------------

describe("RecordEngine – stop()", () => {
  it("resets isRecording to false after stop", async () => {
    const engine = new RecordEngine();
    const { mockBrowser } = buildMockBrowserStack();
    jest.spyOn(engine, "getLauncher").mockReturnValue({ launch: jest.fn().mockResolvedValue(mockBrowser) } as never);

    await engine.start(jest.fn());
    expect(engine.isRecording).toBe(true);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skytest-stop-"));
    await engine.stop(tmpDir);
    expect(engine.isRecording).toBe(false);
    fs.rmdirSync(tmpDir);
  });

  it("does not create a recording file when no steps were captured", async () => {
    const engine = new RecordEngine();
    const { mockBrowser } = buildMockBrowserStack();
    jest.spyOn(engine, "getLauncher").mockReturnValue({ launch: jest.fn().mockResolvedValue(mockBrowser) } as never);

    await engine.start(jest.fn());
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skytest-nofile-"));
    await engine.stop(tmpDir);

    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
    fs.rmdirSync(tmpDir);
  });
});

// ---------------------------------------------------------------------------
// onStep callback – invoked in real time
// ---------------------------------------------------------------------------

describe("RecordEngine – onStep callback", () => {
  it("calls the onStep callback immediately when a step is pushed internally", async () => {
    const engine = new RecordEngine();
    const { mockBrowser, mockPage } = buildMockBrowserStack();
    jest.spyOn(engine, "getLauncher").mockReturnValue({ launch: jest.fn().mockResolvedValue(mockBrowser) } as never);

    const received: unknown[] = [];
    await engine.start((step) => received.push(step));

    // Simulate a navigation event by invoking the framenavigated handler
    // The page.on mock captures the registered listener; we call it manually.
    const frameNavCall = mockPage.on.mock.calls.find(([event]: [string]) => event === "framenavigated");
    expect(frameNavCall).toBeDefined();
    const frameNavHandler = frameNavCall![1] as (frame: { url: () => string }) => void;

    // Simulate a navigation to a URL (frame === page.mainFrame())
    const fakeFrame = { url: () => "https://example.com" };
    // mainFrame() returns an object – we need the frame to be the same reference
    mockPage.mainFrame.mockReturnValue(fakeFrame);
    frameNavHandler(fakeFrame);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ action: "navigate", value: "https://example.com" });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skytest-cb-"));
    const steps = await engine.stop(tmpDir);
    expect(steps).toHaveLength(1);
    // Recording file should be written since we have one step
    expect(fs.readdirSync(tmpDir).some((f) => f.startsWith("recording-") && f.endsWith(".json"))).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// Raw recording file format
// ---------------------------------------------------------------------------

describe("RecordEngine – raw recording file format", () => {
  it("writes valid JSON with schemaVersion, id, steps, and createdAt", async () => {
    const engine = new RecordEngine();
    const { mockBrowser, mockPage } = buildMockBrowserStack();
    jest.spyOn(engine, "getLauncher").mockReturnValue({ launch: jest.fn().mockResolvedValue(mockBrowser) } as never);

    await engine.start(jest.fn());

    // Push a step by simulating framenavigated
    const frameNavCall = mockPage.on.mock.calls.find(([event]: [string]) => event === "framenavigated");
    const frameNavHandler = frameNavCall![1] as (frame: { url: () => string }) => void;
    const fakeFrame = { url: () => "https://skytest.example.com" };
    mockPage.mainFrame.mockReturnValue(fakeFrame);
    frameNavHandler(fakeFrame);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skytest-fmt-"));
    await engine.stop(tmpDir);

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);

    const raw = JSON.parse(fs.readFileSync(path.join(tmpDir, files[0]), "utf-8")) as {
      schemaVersion: string;
      id: string;
      steps: unknown[];
      createdAt: string;
    };
    expect(raw.schemaVersion).toBe("1");
    expect(typeof raw.id).toBe("string");
    expect(Array.isArray(raw.steps)).toBe(true);
    expect(raw.steps).toHaveLength(1);
    expect(typeof raw.createdAt).toBe("string");

    fs.rmSync(tmpDir, { recursive: true });
  });
});
