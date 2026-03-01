/**
 * Unit tests for CIRunner (Issue #24 – CI-Compatible Output).
 *
 * Tests cover:
 * - Returns exit code 1 when the test file does not exist
 * - Returns exit code 1 when the test file contains invalid JSON
 * - Runs successfully with a valid TestCase file (mocked executor)
 * - Produces JSON output by default
 * - Produces JUnit XML output when outputFormat is "junit"
 * - Saves a run record to runsDir when specified
 * - Generates deterministic artifact path prefix (runId based)
 * - Runs headless (headed: false) in all cases
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { TestCase } from "../../shared/types";
import { runCI } from "./CIRunner";

// ── Mock PlaywrightExecutor so we never actually launch a browser ─────────────

jest.mock("./PlaywrightExecutor", () => {
  return {
    PlaywrightExecutor: jest.fn().mockImplementation(() => ({
      execute: jest.fn().mockResolvedValue({
        stepResults: [
          { stepIndex: 0, action: "navigate", status: "passed", artifactIds: [], durationMs: 100 },
        ],
        assertionResults: [],
        artifacts: [],
      }),
    })),
  };
});

function makeTestCase(overrides: Partial<TestCase> = {}): TestCase {
  const now = new Date().toISOString();
  return {
    schemaVersion: "1",
    id: "test-ci-001",
    name: "CI test",
    tags: [],
    preconditions: [],
    steps: [{ action: "navigate", value: "https://example.com" }],
    assertions: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skytest-ci-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("CIRunner – file validation (Issue #24)", () => {
  it("returns exit code 1 when the test file does not exist", async () => {
    const { exitCode } = await runCI({
      testFile: path.join(tmpDir, "nonexistent.json"),
      outputFormat: "json",
      artifactsDir: path.join(tmpDir, "artifacts"),
      browser: "chromium",
    });
    expect(exitCode).toBe(1);
  });

  it("returns exit code 1 when the test file contains invalid JSON", async () => {
    const testFile = path.join(tmpDir, "bad.json");
    fs.writeFileSync(testFile, "{ not valid json");
    const { exitCode } = await runCI({
      testFile,
      outputFormat: "json",
      artifactsDir: path.join(tmpDir, "artifacts"),
      browser: "chromium",
    });
    expect(exitCode).toBe(1);
  });
});

describe("CIRunner – successful run (Issue #24)", () => {
  it("returns exit code 0 when the test passes", async () => {
    const testFile = path.join(tmpDir, "test-ci-001.json");
    fs.writeFileSync(testFile, JSON.stringify(makeTestCase()));
    const { exitCode } = await runCI({
      testFile,
      outputFormat: "json",
      artifactsDir: path.join(tmpDir, "artifacts"),
      browser: "chromium",
    });
    expect(exitCode).toBe(0);
  });

  it("produces JSON output containing the run id", async () => {
    const testFile = path.join(tmpDir, "test-ci-001.json");
    fs.writeFileSync(testFile, JSON.stringify(makeTestCase()));
    const { output } = await runCI({
      testFile,
      outputFormat: "json",
      artifactsDir: path.join(tmpDir, "artifacts"),
      browser: "chromium",
    });
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(typeof parsed["id"]).toBe("string");
    expect((parsed["id"] as string).startsWith("ci-")).toBe(true);
  });

  it("produces JUnit XML output when outputFormat is 'junit'", async () => {
    const testFile = path.join(tmpDir, "test-ci-001.json");
    fs.writeFileSync(testFile, JSON.stringify(makeTestCase()));
    const { output } = await runCI({
      testFile,
      outputFormat: "junit",
      artifactsDir: path.join(tmpDir, "artifacts"),
      browser: "chromium",
    });
    expect(output).toMatch(/^<\?xml/);
    expect(output).toContain("<testsuites");
  });

  it("writes output to outFile when specified", async () => {
    const testFile = path.join(tmpDir, "test-ci-001.json");
    fs.writeFileSync(testFile, JSON.stringify(makeTestCase()));
    const outFile = path.join(tmpDir, "results", "output.json");
    await runCI({
      testFile,
      outputFormat: "json",
      artifactsDir: path.join(tmpDir, "artifacts"),
      browser: "chromium",
      outFile,
    });
    expect(fs.existsSync(outFile)).toBe(true);
    const content = fs.readFileSync(outFile, "utf-8");
    expect(JSON.parse(content)).toHaveProperty("id");
  });

  it("persists run record to runsDir when specified", async () => {
    const testFile = path.join(tmpDir, "test-ci-001.json");
    fs.writeFileSync(testFile, JSON.stringify(makeTestCase()));
    const runsDir = path.join(tmpDir, "runs");
    await runCI({
      testFile,
      outputFormat: "json",
      artifactsDir: path.join(tmpDir, "artifacts"),
      runsDir,
      browser: "chromium",
    });
    expect(fs.existsSync(runsDir)).toBe(true);
    const files = fs.readdirSync(runsDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);
  });

  it("uses chromium as the default browser", async () => {
    const { PlaywrightExecutor } = jest.requireMock("./PlaywrightExecutor") as {
      PlaywrightExecutor: jest.Mock;
    };
    const testFile = path.join(tmpDir, "test-ci-001.json");
    fs.writeFileSync(testFile, JSON.stringify(makeTestCase()));
    await runCI({
      testFile,
      outputFormat: "json",
      artifactsDir: path.join(tmpDir, "artifacts"),
      browser: "chromium",
    });
    const mockInstance = PlaywrightExecutor.mock.results[PlaywrightExecutor.mock.results.length - 1].value as { execute: jest.Mock };
    const callArgs = mockInstance.execute.mock.calls[0] as unknown[];
    // Second argument is browser
    expect(callArgs[1]).toBe("chromium");
  });

  it("always runs headless (headed: false)", async () => {
    const { PlaywrightExecutor } = jest.requireMock("./PlaywrightExecutor") as {
      PlaywrightExecutor: jest.Mock;
    };
    const testFile = path.join(tmpDir, "test-ci-001.json");
    fs.writeFileSync(testFile, JSON.stringify(makeTestCase()));
    await runCI({
      testFile,
      outputFormat: "json",
      artifactsDir: path.join(tmpDir, "artifacts"),
      browser: "chromium",
    });
    const mockInstance = PlaywrightExecutor.mock.results[PlaywrightExecutor.mock.results.length - 1].value as { execute: jest.Mock };
    const callArgs = mockInstance.execute.mock.calls[0] as unknown[];
    // Third argument is headed
    expect(callArgs[2]).toBe(false);
  });

  it("uses a deterministic runId starting with 'ci-'", async () => {
    const { PlaywrightExecutor } = jest.requireMock("./PlaywrightExecutor") as {
      PlaywrightExecutor: jest.Mock;
    };
    const testFile = path.join(tmpDir, "test-ci-001.json");
    fs.writeFileSync(testFile, JSON.stringify(makeTestCase()));
    await runCI({
      testFile,
      outputFormat: "json",
      artifactsDir: path.join(tmpDir, "artifacts"),
      browser: "chromium",
    });
    const mockInstance = PlaywrightExecutor.mock.results[PlaywrightExecutor.mock.results.length - 1].value as { execute: jest.Mock };
    const callArgs = mockInstance.execute.mock.calls[0] as unknown[];
    // Last argument (index 8) is runId
    const runId = callArgs[8] as string;
    expect(typeof runId).toBe("string");
    expect(runId.startsWith("ci-")).toBe(true);
  });
});

describe("CIRunner – failed run (Issue #24)", () => {
  it("returns exit code 1 when a step fails", async () => {
    const { PlaywrightExecutor } = jest.requireMock("./PlaywrightExecutor") as {
      PlaywrightExecutor: jest.Mock;
    };
    // Override mock to return a failed step
    (PlaywrightExecutor as jest.Mock).mockImplementationOnce(() => ({
      execute: jest.fn().mockResolvedValue({
        stepResults: [
          { stepIndex: 0, action: "navigate", status: "failed", artifactIds: [], durationMs: 50, error: "Timeout" },
        ],
        assertionResults: [],
        artifacts: [],
      }),
    }));

    const testFile = path.join(tmpDir, "test-ci-fail.json");
    fs.writeFileSync(testFile, JSON.stringify(makeTestCase({ id: "test-ci-fail" })));
    const { exitCode } = await runCI({
      testFile,
      outputFormat: "json",
      artifactsDir: path.join(tmpDir, "artifacts"),
      browser: "chromium",
    });
    expect(exitCode).toBe(1);
  });
});
