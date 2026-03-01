/**
 * CIRunner – Issue #24: CI-Compatible Output
 *
 * A standalone Node.js CLI tool for running SkyTest TestCase files without
 * requiring the Electron UI.  Outputs JUnit XML or JSON results to stdout
 * (or a file) and exits with code 0 on pass, 1 on failure.
 *
 * Usage:
 *   node dist/ci/ci-runner.js \
 *     --test <path-to-test.json> \
 *     [--output <junit|json>] \
 *     [--artifacts-dir <dir>] \
 *     [--runs-dir <dir>] \
 *     [--browser <chromium|firefox|webkit>] \
 *     [--out-file <path>] \
 *     [--auth-state <path-to-storageState.json>] \
 *     [--tool-policy <read-only|safe-write|full>]
 *
 * Acceptance criteria (Issue #24):
 *  - Headless execution: browser always launched headless
 *  - JUnit or JSON output: --output flag selects format
 *  - Deterministic artifact paths: <runId>-step-<n>[.png]
 *  - No UI dependency: does not import Electron
 */

import * as fs from "fs";
import * as path from "path";
import type { Assertion, BrowserType, DSLPlan, Run, TestCase, ToolPolicy } from "../../shared/types";
import { PlaywrightExecutor } from "./PlaywrightExecutor";
import { RunExporter } from "../storage/RunExporter";

export interface CIRunOptions {
  /** Absolute path to a TestCase JSON file. */
  testFile: string;
  /** Output format – defaults to "json". */
  outputFormat: "junit" | "json";
  /** Directory where artifact screenshots are saved. */
  artifactsDir: string;
  /** Optional directory to persist the Run record as JSON. */
  runsDir?: string;
  /** Browser to use – defaults to "chromium". */
  browser: BrowserType;
  /** Optional file path to write the output instead of stdout. */
  outFile?: string;
  /** Optional path to a storageState.json file for authenticated sessions (AGENTS.md §7.1). */
  authStatePath?: string;
  /** Tool policy to enforce during execution (AGENTS.md §6) – defaults to "read-only". */
  toolPolicy?: ToolPolicy;
}

/**
 * Execute a TestCase from a JSON file and return an exit code.
 * Exported for unit-testing without spawning a subprocess.
 */
export async function runCI(options: CIRunOptions): Promise<{ exitCode: number; output: string }> {
  const { testFile, outputFormat, artifactsDir, runsDir, browser, outFile, authStatePath } = options;
  const toolPolicy: ToolPolicy = options.toolPolicy ?? "read-only";

  // ── Load TestCase ─────────────────────────────────────────────────────────
  if (!fs.existsSync(testFile)) {
    const msg = `[CIRunner] Test file not found: ${testFile}`;
    console.error(msg);
    return { exitCode: 1, output: msg };
  }

  let testCase: TestCase;
  try {
    testCase = JSON.parse(fs.readFileSync(testFile, "utf-8")) as TestCase;
  } catch (err) {
    const msg = `[CIRunner] Failed to parse test file: ${err instanceof Error ? err.message : String(err)}`;
    console.error(msg);
    return { exitCode: 1, output: msg };
  }

  // ── Ensure artifacts directory exists ─────────────────────────────────────
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  // ── Build a deterministic run ID ──────────────────────────────────────────
  // Format: ci-<testId>-<ISO date without special chars>
  const safeTestId = testCase.id.replace(/[^a-z0-9_-]/gi, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runId = `ci-${safeTestId}-${timestamp}`;

  const startedAt = new Date().toISOString();

  // ── Execute ───────────────────────────────────────────────────────────────
  const executor = new PlaywrightExecutor();
  const dslPlan: DSLPlan = {
    version: "1",
    intent: testCase.name,
    steps: testCase.steps,
  };
  const assertions: Assertion[] = testCase.assertions ?? [];

  let run: Run;
  try {
    const result = await executor.execute(
      dslPlan,
      browser,
      false, // always headless in CI (Issue #24)
      artifactsDir,
      authStatePath, // support storageState for authenticated CI sessions (AGENTS.md §7.1)
      assertions,
      testCase.retryCount,
      testCase.retryMode,
      runId
    );

    const stepsFailed = result.stepResults.some((r) => r.status === "failed");
    const assertionsFailed = result.assertionResults.some((r) => r.status === "failed");

    run = {
      schemaVersion: "1",
      id: runId,
      testId: testCase.id,
      environment: "ci",
      browser,
      headed: false,
      toolPolicy,
      status: stepsFailed || assertionsFailed ? "failed" : "passed",
      stepResults: result.stepResults,
      assertionResults: result.assertionResults,
      artifacts: result.artifacts,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (err) {
    run = {
      schemaVersion: "1",
      id: runId,
      testId: testCase.id,
      environment: "ci",
      browser,
      headed: false,
      toolPolicy,
      status: "failed",
      stepResults: [],
      assertionResults: [],
      artifacts: [],
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    console.error(`[CIRunner] Execution error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Persist run record when runsDir is specified ───────────────────────────
  if (runsDir) {
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }
    const runFile = path.join(runsDir, `${runId}.json`);
    fs.writeFileSync(runFile, JSON.stringify(run, null, 2), "utf-8");
    console.log(`[CIRunner] Run record saved: ${runFile}`);
  }

  // ── Generate output ───────────────────────────────────────────────────────
  const exported = new RunExporter().export(run);
  const output = outputFormat === "junit" ? exported.junit : exported.json;

  if (outFile) {
    const outDir = path.dirname(outFile);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(outFile, output, "utf-8");
    console.log(`[CIRunner] Output written to: ${outFile}`);
  } else {
    process.stdout.write(output + "\n");
  }

  const exitCode = run.status === "passed" ? 0 : 1;
  console.log(`[CIRunner] Run ${runId} ${run.status} (exit ${exitCode})`);
  return { exitCode, output };
}

// ── Parse command-line arguments ─────────────────────────────────────────────

function parseArgs(argv: string[]): CIRunOptions {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key && value !== undefined) {
      args[key] = value;
    }
  }

  if (!args["test"]) {
    console.error("[CIRunner] --test <path> is required");
    process.exit(1);
  }

  const outputFormat = args["output"] === "junit" ? "junit" : "json";
  const artifactsDir = args["artifacts-dir"] ?? path.join(process.cwd(), "artifacts");
  const browser = (args["browser"] as BrowserType) ?? "chromium";
  const rawPolicy = args["tool-policy"];
  const toolPolicy: ToolPolicy =
    rawPolicy === "safe-write" || rawPolicy === "full" ? rawPolicy : "read-only";

  return {
    testFile: path.resolve(args["test"]),
    outputFormat,
    artifactsDir: path.resolve(artifactsDir),
    runsDir: args["runs-dir"] ? path.resolve(args["runs-dir"]) : undefined,
    browser,
    outFile: args["out-file"] ? path.resolve(args["out-file"]) : undefined,
    authStatePath: args["auth-state"] ? path.resolve(args["auth-state"]) : undefined,
    toolPolicy,
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));
  runCI(options)
    .then(({ exitCode }) => process.exit(exitCode))
    .catch((err) => {
      console.error("[CIRunner] Unexpected error:", err);
      process.exit(1);
    });
}
