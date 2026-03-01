/**
 * Unit tests for RunRepository (Issue #18).
 *
 * Tests cover:
 * - save() writes a human-readable JSON file to the runs directory
 * - load() returns the Run when the file exists
 * - load() returns null when the file does not exist
 * - load() returns null when the file contains invalid JSON
 * - list() returns all saved Runs sorted by startedAt descending
 * - list() returns an empty array when the directory is empty
 * - list() skips corrupted files
 * - save() sanitizes dangerous characters in the run ID
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { Run } from "../../shared/types";
import { RunRepository } from "./RunRepository";

function makeRun(overrides: Partial<Run> = {}): Run {
  const now = new Date().toISOString();
  return {
    schemaVersion: "1",
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    environment: "default",
    browser: "chromium",
    headed: false,
    toolPolicy: "read-only",
    status: "passed",
    stepResults: [],
    artifacts: [],
    startedAt: now,
    finishedAt: now,
    ...overrides,
  };
}

let tmpDir: string;
let repo: RunRepository;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skytest-runs-"));
  repo = new RunRepository(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("RunRepository – save (Issue #18)", () => {
  it("writes a JSON file named <id>.json to the runs directory", () => {
    const run = makeRun({ id: "run-abc" });
    repo.save(run);
    expect(fs.existsSync(path.join(tmpDir, "run-abc.json"))).toBe(true);
  });

  it("writes human-readable JSON (indented)", () => {
    const run = makeRun({ id: "run-readable" });
    repo.save(run);
    const raw = fs.readFileSync(path.join(tmpDir, "run-readable.json"), "utf-8");
    expect(raw).toContain("\n");
    expect(raw).toContain("  ");
  });

  it("includes schemaVersion, id, environment, browser, status, startedAt, finishedAt", () => {
    const run = makeRun({ id: "run-fields", environment: "staging", browser: "firefox", status: "failed" });
    repo.save(run);
    const parsed = JSON.parse(fs.readFileSync(path.join(tmpDir, "run-fields.json"), "utf-8")) as Run;
    expect(parsed.schemaVersion).toBe("1");
    expect(parsed.id).toBe("run-fields");
    expect(parsed.environment).toBe("staging");
    expect(parsed.browser).toBe("firefox");
    expect(parsed.status).toBe("failed");
    expect(parsed.startedAt).toBeDefined();
    expect(parsed.finishedAt).toBeDefined();
  });

  it("creates the runs directory if it does not exist", () => {
    const subDir = path.join(tmpDir, "nested", "runs");
    const subRepo = new RunRepository(subDir);
    const run = makeRun({ id: "run-newdir" });
    subRepo.save(run);
    expect(fs.existsSync(path.join(subDir, "run-newdir.json"))).toBe(true);
  });

  it("sanitizes dangerous characters in the run ID to prevent path traversal", () => {
    const run = makeRun({ id: "../evil/run" });
    repo.save(run);
    const files = fs.readdirSync(tmpDir);
    expect(files.some((f) => f.includes(".."))).toBe(false);
    expect(files.some((f) => f.includes("/"))).toBe(false);
  });

  it("overwrites an existing file when saving with the same ID (update)", () => {
    const run = makeRun({ id: "run-update", status: "running" });
    repo.save(run);
    const updated: Run = { ...run, status: "passed", finishedAt: new Date().toISOString() };
    repo.save(updated);
    const parsed = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "run-update.json"), "utf-8")
    ) as Run;
    expect(parsed.status).toBe("passed");
  });
});

describe("RunRepository – load (Issue #18)", () => {
  it("returns the Run when the file exists", () => {
    const run = makeRun({ id: "run-load", environment: "production" });
    repo.save(run);
    const loaded = repo.load("run-load");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("run-load");
    expect(loaded!.environment).toBe("production");
  });

  it("returns null when the file does not exist", () => {
    expect(repo.load("nonexistent")).toBeNull();
  });

  it("returns null when the file contains invalid JSON", () => {
    fs.writeFileSync(path.join(tmpDir, "bad.json"), "{ not valid json");
    expect(repo.load("bad")).toBeNull();
  });

  it("preserves all Run fields on round-trip", () => {
    const run = makeRun({
      id: "run-roundtrip",
      environment: "staging",
      browser: "webkit",
      headed: true,
      toolPolicy: "full",
      status: "failed",
      stepResults: [{ stepIndex: 0, action: "navigate", status: "failed", artifactIds: [], durationMs: 100 }],
    });
    repo.save(run);
    const loaded = repo.load("run-roundtrip");
    expect(loaded!.browser).toBe("webkit");
    expect(loaded!.toolPolicy).toBe("full");
    expect(loaded!.stepResults).toHaveLength(1);
  });
});

describe("RunRepository – list (Issue #18)", () => {
  it("returns an empty array when no run files exist", () => {
    expect(repo.list()).toEqual([]);
  });

  it("returns all saved Runs", () => {
    const r1 = makeRun({ id: "run-list-1" });
    const r2 = makeRun({ id: "run-list-2" });
    repo.save(r1);
    repo.save(r2);
    const list = repo.list();
    expect(list).toHaveLength(2);
    const ids = list.map((r) => r.id).sort();
    expect(ids).toEqual(["run-list-1", "run-list-2"]);
  });

  it("returns Runs sorted by startedAt descending (newest first)", () => {
    const r1 = makeRun({ id: "run-sort-1", startedAt: "2024-01-01T00:00:00.000Z" });
    const r2 = makeRun({ id: "run-sort-2", startedAt: "2024-06-01T00:00:00.000Z" });
    const r3 = makeRun({ id: "run-sort-3", startedAt: "2024-03-01T00:00:00.000Z" });
    repo.save(r1);
    repo.save(r2);
    repo.save(r3);
    const list = repo.list();
    expect(list[0].id).toBe("run-sort-2");
    expect(list[1].id).toBe("run-sort-3");
    expect(list[2].id).toBe("run-sort-1");
  });

  it("skips corrupted JSON files and returns remaining valid runs", () => {
    const run = makeRun({ id: "run-good" });
    repo.save(run);
    fs.writeFileSync(path.join(tmpDir, "corrupted.json"), "{ broken");
    const list = repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("run-good");
  });

  it("returns an empty array when the directory does not exist", () => {
    const emptyRepo = new RunRepository(path.join(tmpDir, "nonexistent"));
    expect(emptyRepo.list()).toEqual([]);
  });
});
