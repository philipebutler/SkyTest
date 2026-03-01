/**
 * RecordEngine – Issue #21: Record Mode Capture Engine
 *
 * Responsibilities:
 *  - Launch a headed Playwright browser for user-driven recording.
 *  - Attach event listeners for navigation, clicks, and inputs.
 *  - Capture candidate selectors (prefers data-testid > aria-label > id > name > tag+class).
 *  - Push each captured ActionStep to the renderer via a caller-supplied callback.
 *  - Save the raw recording as a JSON file when recording stops.
 *  - Return the raw ActionStep[] so recordings can be replayed (SPEC §9.1).
 */

import { chromium, firefox, webkit } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import type { ActionStep, BrowserType, RawRecording } from "../../shared/types";

export class RecordEngine {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private steps: ActionStep[] = [];
  private onStep: ((step: ActionStep) => void) | null = null;
  private _recording = false;

  get isRecording(): boolean {
    return this._recording;
  }

  /**
   * Start recording user interactions.
   *
   * @param onStep   Callback invoked for every captured ActionStep in real-time.
   * @param browser  Browser to launch (always headed – SPEC §9.1).
   */
  async start(onStep: (step: ActionStep) => void, browser: BrowserType = "chromium"): Promise<void> {
    if (this._recording) {
      throw new Error("Recording already in progress.");
    }
    this.steps = [];
    this.onStep = onStep;
    this._recording = true;

    // Record mode always uses headed browser (SPEC §9.1)
    const launcher = this.getLauncher(browser);
    this.browser = await launcher.launch({ headless: false });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();

    await this.attachListeners(this.page);
  }

  /**
   * Stop recording, save the raw recording to disk, and return captured steps.
   *
   * @param recordingsDir  Directory in which to write the raw recording JSON file.
   * @returns The captured ActionStep[] (can be used to replay the recording).
   */
  async stop(recordingsDir: string): Promise<ActionStep[]> {
    const steps = [...this.steps];

    // Persist raw recording so it can be replayed later (acceptance criterion §21)
    if (steps.length > 0) {
      const id = `recording-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const recordingPath = path.join(recordingsDir, `${id}.json`);
      const raw: RawRecording = {
        schemaVersion: "1",
        id,
        steps,
        createdAt: new Date().toISOString(),
      };
      fs.writeFileSync(recordingPath, JSON.stringify(raw, null, 2), "utf-8");
      console.log(`[RecordEngine] Saved recording to: ${recordingPath}`);
    }

    try {
      if (this.context) await this.context.close();
      if (this.browser) await this.browser.close();
    } catch (err) {
      console.warn("[RecordEngine] Error closing browser:", err);
    }

    this.browser = null;
    this.context = null;
    this.page = null;
    this.onStep = null;
    this.steps = [];
    this._recording = false;

    return steps;
  }

  /** Returns the Playwright launcher for the given BrowserType. */
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

  private async attachListeners(page: Page): Promise<void> {
    // Expose a Node.js function so injected browser-side scripts can push events back.
    await page.exposeFunction("__skytest_capture__", (step: ActionStep) => {
      this.pushStep(step);
    });

    // Inject DOM event listeners into every page load (runs before page scripts).
    // The callback must be self-contained – no references to outer scope.
    await page.addInitScript(() => {
      const capture = (step: Record<string, unknown>) => {
        // exposeFunction bridge returns a Promise; void suppresses the unhandled-promise lint warning.
        void (window as unknown as { __skytest_capture__: (s: unknown) => void }).__skytest_capture__(step);
      };

      /**
       * Candidate selector heuristic (AGENTS.md §9.1):
       * data-testid > aria-label > id > name attribute > tag+class
       */
      const getBestSelector = (el: Element): string => {
        const testid = el.getAttribute("data-testid");
        if (testid) return `[data-testid="${testid}"]`;

        const ariaLabel = el.getAttribute("aria-label");
        if (ariaLabel) return `[aria-label="${ariaLabel}"]`;

        if (el.id) return `#${el.id}`;

        const name = el.getAttribute("name");
        if (name) return `[name="${name}"]`;

        const tag = el.tagName.toLowerCase();
        const classes = Array.from(el.classList)
          .filter(Boolean)
          .map((c) => `.${c}`)
          .join("");
        return classes ? `${tag}${classes}` : tag;
      };

      // Click capture (exclude form inputs; those are captured by change events)
      document.addEventListener(
        "click",
        (e) => {
          const el = e.target as Element;
          if (!el || !el.tagName) return;
          const tag = el.tagName.toLowerCase();
          if (tag === "input" || tag === "select" || tag === "textarea") return;
          capture({ action: "click", selector: getBestSelector(el) });
        },
        { capture: true, passive: true }
      );

      // Fill / select / check capture
      document.addEventListener(
        "change",
        (e) => {
          const el = e.target as HTMLInputElement;
          if (!el || !("value" in el)) return;
          const tag = el.tagName.toLowerCase();
          if (tag === "select") {
            capture({ action: "select", selector: getBestSelector(el), value: el.value });
          } else if (tag === "input" && (el.type === "checkbox" || el.type === "radio")) {
            capture({ action: el.checked ? "check" : "uncheck", selector: getBestSelector(el) });
          } else {
            capture({ action: "fill", selector: getBestSelector(el), value: el.value });
          }
        },
        { capture: true, passive: true }
      );
    });

    // Navigation capture (main frame only)
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        this.pushStep({ action: "navigate", value: frame.url() });
      }
    });
  }

  private pushStep(step: ActionStep): void {
    this.steps.push(step);
    if (this.onStep) {
      this.onStep(step);
    }
  }
}

/**
 * Pure selector-building helper (exported for unit tests).
 * Mirrors the inline getBestSelector logic injected into the browser.
 *
 * Priority: data-testid > aria-label > id > name > tagName+classes
 */
export function buildBestSelector(opts: {
  testid: string | null;
  ariaLabel: string | null;
  id: string | null;
  name: string | null;
  tagName: string;
  classNames: string[];
}): string {
  if (opts.testid) return `[data-testid="${opts.testid}"]`;
  if (opts.ariaLabel) return `[aria-label="${opts.ariaLabel}"]`;
  if (opts.id) return `#${opts.id}`;
  if (opts.name) return `[name="${opts.name}"]`;
  const cls = opts.classNames.filter(Boolean).map((c) => `.${c}`).join("");
  return cls ? `${opts.tagName}${cls}` : opts.tagName;
}
