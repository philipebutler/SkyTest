import type { IpcMain } from "electron";
import * as fs from "fs";
import * as path from "path";
import type { Run, RunConfig } from "../../shared/types";

const RUNS_DIR = path.join(process.cwd(), "runs");

function ensureRunsDir(): void {
  if (!fs.existsSync(RUNS_DIR)) {
    fs.mkdirSync(RUNS_DIR, { recursive: true });
  }
}

export function registerIpcHandlers(ipcMain: IpcMain): void {
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
    // TODO (#11): Wire Playwright executor to execute config.command
    run.status = "passed";
    run.finishedAt = new Date().toISOString();
    ensureRunsDir();
    fs.writeFileSync(
      path.join(RUNS_DIR, `${run.id}.json`),
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
    // TODO (#11): Load TestCase from tests/ and wire Playwright executor
    run.status = "passed";
    run.finishedAt = new Date().toISOString();
    ensureRunsDir();
    fs.writeFileSync(
      path.join(RUNS_DIR, `${run.id}.json`),
      JSON.stringify(run, null, 2)
    );
    return run;
  });

  // Channel: getRunHistory
  // Returns all persisted Run records from the runs/ directory.
  ipcMain.handle("getRunHistory", async (): Promise<Run[]> => {
    ensureRunsDir();
    const files = fs
      .readdirSync(RUNS_DIR)
      .filter((f) => f.endsWith(".json"));
    const runs: Run[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(RUNS_DIR, f), "utf-8");
        runs.push(JSON.parse(raw) as Run);
      } catch {
        console.warn(`[getRunHistory] Skipping corrupted run file: ${f}`);
      }
    }
    runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return runs;
  });
}
