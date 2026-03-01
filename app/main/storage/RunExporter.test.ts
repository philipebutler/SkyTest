/**
 * Unit tests for RunExporter (Issue #20, Issue #24).
 *
 * Tests cover:
 * - export() returns both markdown and json fields
 * - JSON export is a pretty-printed serialization of the Run record
 * - Markdown includes a summary table with all required fields
 * - Markdown includes the step timeline
 * - Markdown includes assertion results when present
 * - Markdown includes artifact references when present
 * - Duration is calculated and included when finishedAt is set
 * - Steps with errors include the error text
 * - Artifact IDs on steps are rendered correctly
 * - JUnit XML output is valid and CI-compatible (Issue #24)
 */

import type { Run } from "../../shared/types";
import { RunExporter } from "./RunExporter";

function makeRun(overrides: Partial<Run> = {}): Run {
  const now = "2024-06-01T10:00:00.000Z";
  return {
    schemaVersion: "1",
    id: "run-test-123",
    environment: "staging",
    browser: "chromium",
    headed: false,
    toolPolicy: "read-only",
    status: "passed",
    stepResults: [],
    artifacts: [],
    startedAt: now,
    finishedAt: "2024-06-01T10:00:05.000Z",
    ...overrides,
  };
}

let exporter: RunExporter;

beforeEach(() => {
  exporter = new RunExporter();
});

describe("RunExporter – export() (Issue #20)", () => {
  it("returns both markdown and json fields", () => {
    const result = exporter.export(makeRun());
    expect(typeof result.markdown).toBe("string");
    expect(typeof result.json).toBe("string");
  });

  it("returns a junit field (Issue #24)", () => {
    const result = exporter.export(makeRun());
    expect(typeof result.junit).toBe("string");
  });

  it("JSON export is pretty-printed serialization of the Run", () => {
    const run = makeRun();
    const { json } = exporter.export(run);
    const parsed = JSON.parse(json) as Run;
    expect(parsed.id).toBe(run.id);
    expect(parsed.environment).toBe(run.environment);
    expect(parsed.status).toBe(run.status);
    expect(json).toContain("\n"); // pretty-printed
    expect(json).toContain("  ");
  });
});

describe("RunExporter – Markdown summary (Issue #20)", () => {
  it("includes the run ID in the title", () => {
    const { markdown } = exporter.export(makeRun({ id: "run-export-abc" }));
    expect(markdown).toContain("run-export-abc");
  });

  it("includes status, environment, browser, headed, toolPolicy, startedAt", () => {
    const { markdown } = exporter.export(makeRun());
    expect(markdown).toContain("staging");
    expect(markdown).toContain("chromium");
    expect(markdown).toContain("No"); // headed=false
    expect(markdown).toContain("read-only");
    expect(markdown).toContain("2024-06-01T10:00:00.000Z");
  });

  it("includes testId in summary when present", () => {
    const { markdown } = exporter.export(makeRun({ testId: "test-xyz" }));
    expect(markdown).toContain("test-xyz");
  });

  it("includes duration when finishedAt is set", () => {
    const { markdown } = exporter.export(
      makeRun({
        startedAt: "2024-06-01T10:00:00.000Z",
        finishedAt: "2024-06-01T10:00:05.000Z",
      })
    );
    expect(markdown).toContain("5000ms");
  });

  it("omits duration when finishedAt is absent", () => {
    const run = makeRun();
    delete (run as Partial<Run>).finishedAt;
    const { markdown } = exporter.export(run);
    expect(markdown).not.toContain("Duration");
  });
});

describe("RunExporter – Markdown steps (Issue #20)", () => {
  it("shows 'No steps recorded' when stepResults is empty", () => {
    const { markdown } = exporter.export(makeRun({ stepResults: [] }));
    expect(markdown).toContain("No steps recorded");
  });

  it("includes each step action and status", () => {
    const run = makeRun({
      stepResults: [
        { stepIndex: 0, action: "navigate", status: "passed", artifactIds: [], durationMs: 200 },
        { stepIndex: 1, action: "click", status: "failed", artifactIds: [], durationMs: 50, error: "Element not found" },
      ],
    });
    const { markdown } = exporter.export(run);
    expect(markdown).toContain("navigate");
    expect(markdown).toContain("click");
    expect(markdown).toContain("passed");
    expect(markdown).toContain("failed");
    expect(markdown).toContain("200ms");
    expect(markdown).toContain("50ms");
  });

  it("includes error text for failed steps", () => {
    const run = makeRun({
      stepResults: [
        {
          stepIndex: 0,
          action: "fill",
          status: "failed",
          artifactIds: [],
          durationMs: 10,
          error: "Timeout waiting for selector",
        },
      ],
    });
    const { markdown } = exporter.export(run);
    expect(markdown).toContain("Timeout waiting for selector");
  });

  it("includes artifact IDs for steps with artifacts", () => {
    const run = makeRun({
      stepResults: [
        {
          stepIndex: 0,
          action: "screenshot",
          status: "passed",
          artifactIds: ["artifact-001", "artifact-002"],
          durationMs: 100,
        },
      ],
    });
    const { markdown } = exporter.export(run);
    expect(markdown).toContain("artifact-001");
    expect(markdown).toContain("artifact-002");
  });

  it("uses ✅ for passed and ❌ for failed steps", () => {
    const run = makeRun({
      stepResults: [
        { stepIndex: 0, action: "navigate", status: "passed", artifactIds: [], durationMs: 10 },
        { stepIndex: 1, action: "click", status: "failed", artifactIds: [], durationMs: 10 },
      ],
    });
    const { markdown } = exporter.export(run);
    expect(markdown).toContain("✅");
    expect(markdown).toContain("❌");
  });
});

describe("RunExporter – Markdown assertion results (Issue #20)", () => {
  it("omits the assertion section when assertionResults is absent", () => {
    const { markdown } = exporter.export(makeRun());
    expect(markdown).not.toContain("## Assertion Results");
  });

  it("omits the assertion section when assertionResults is empty", () => {
    const { markdown } = exporter.export(makeRun({ assertionResults: [] }));
    expect(markdown).not.toContain("## Assertion Results");
  });

  it("includes assertion type and status", () => {
    const run = makeRun({
      assertionResults: [
        { assertionIndex: 0, type: "textVisible", status: "passed" },
        { assertionIndex: 1, type: "urlContains", status: "failed", error: "URL mismatch" },
      ],
    });
    const { markdown } = exporter.export(run);
    expect(markdown).toContain("## Assertion Results");
    expect(markdown).toContain("textVisible");
    expect(markdown).toContain("urlContains");
    expect(markdown).toContain("URL mismatch");
  });
});

describe("RunExporter – Markdown artifacts (Issue #20)", () => {
  it("omits the artifact section when artifacts is empty", () => {
    const { markdown } = exporter.export(makeRun({ artifacts: [] }));
    expect(markdown).not.toContain("## Artifacts");
  });

  it("includes artifact type, id, path, and step index when present", () => {
    const run = makeRun({
      artifacts: [
        {
          id: "art-001",
          type: "screenshot",
          path: "/artifacts/art-001.png",
          createdAt: "2024-06-01T10:00:03.000Z",
          stepIndex: 2,
        },
        {
          id: "art-002",
          type: "log",
          path: "/artifacts/art-002.txt",
          createdAt: "2024-06-01T10:00:04.000Z",
        },
      ],
    });
    const { markdown } = exporter.export(run);
    expect(markdown).toContain("## Artifacts");
    expect(markdown).toContain("art-001");
    expect(markdown).toContain("/artifacts/art-001.png");
    expect(markdown).toContain("screenshot");
    expect(markdown).toContain("step 2");
    expect(markdown).toContain("art-002");
    expect(markdown).toContain("log");
  });
});

// ---------------------------------------------------------------------------
// Issue #24 – CI-Compatible Output: JUnit XML
// ---------------------------------------------------------------------------

describe("RunExporter – JUnit XML output (Issue #24)", () => {
  it("begins with an XML declaration", () => {
    const { junit } = exporter.export(makeRun());
    expect(junit).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  });

  it("contains a <testsuites> root element", () => {
    const { junit } = exporter.export(makeRun());
    expect(junit).toContain("<testsuites");
    expect(junit).toContain("</testsuites>");
  });

  it("contains a <testsuite> element with the run id", () => {
    const { junit } = exporter.export(makeRun({ id: "run-junit-abc" }));
    expect(junit).toContain('name="run-junit-abc"');
  });

  it("counts tests equal to step count", () => {
    const run = makeRun({
      stepResults: [
        { stepIndex: 0, action: "navigate", status: "passed", artifactIds: [], durationMs: 200 },
        { stepIndex: 1, action: "click", status: "passed", artifactIds: [], durationMs: 50 },
      ],
    });
    const { junit } = exporter.export(run);
    expect(junit).toContain('tests="2"');
    expect(junit).toContain('failures="0"');
  });

  it("counts failures equal to failed step count", () => {
    const run = makeRun({
      stepResults: [
        { stepIndex: 0, action: "navigate", status: "passed", artifactIds: [], durationMs: 100 },
        { stepIndex: 1, action: "click", status: "failed", artifactIds: [], durationMs: 50, error: "Not found" },
      ],
    });
    const { junit } = exporter.export(run);
    expect(junit).toContain('failures="1"');
  });

  it("includes a <failure> element for each failed step", () => {
    const run = makeRun({
      stepResults: [
        { stepIndex: 0, action: "fill", status: "failed", artifactIds: [], durationMs: 10, error: "Timeout" },
      ],
    });
    const { junit } = exporter.export(run);
    expect(junit).toContain("<failure");
    expect(junit).toContain("Timeout");
  });

  it("uses self-closing <testcase/> for passing steps", () => {
    const run = makeRun({
      stepResults: [
        { stepIndex: 0, action: "navigate", status: "passed", artifactIds: [], durationMs: 100 },
      ],
    });
    const { junit } = exporter.export(run);
    expect(junit).toContain("<testcase");
    expect(junit).not.toContain("<failure");
  });

  it("includes a testcase for each assertion result", () => {
    const run = makeRun({
      assertionResults: [
        { assertionIndex: 0, type: "textVisible", status: "passed" },
        { assertionIndex: 1, type: "urlContains", status: "failed", error: "URL mismatch" },
      ],
    });
    const { junit } = exporter.export(run);
    expect(junit).toContain("textVisible");
    expect(junit).toContain("urlContains");
    expect(junit).toContain("URL mismatch");
  });

  it("totals include both step and assertion failures", () => {
    const run = makeRun({
      stepResults: [
        { stepIndex: 0, action: "navigate", status: "failed", artifactIds: [], durationMs: 10, error: "oops" },
      ],
      assertionResults: [
        { assertionIndex: 0, type: "textVisible", status: "failed", error: "missing" },
      ],
    });
    const { junit } = exporter.export(run);
    expect(junit).toContain('tests="2"');
    expect(junit).toContain('failures="2"');
  });

  it("calculates duration in seconds from startedAt/finishedAt", () => {
    const run = makeRun({
      startedAt: "2024-06-01T10:00:00.000Z",
      finishedAt: "2024-06-01T10:00:05.000Z",
    });
    const { junit } = exporter.export(run);
    expect(junit).toContain('time="5.000"');
  });

  it("uses 0.000 for duration when finishedAt is absent", () => {
    const run = makeRun();
    delete (run as Partial<Run>).finishedAt;
    const { junit } = exporter.export(run);
    expect(junit).toContain('time="0.000"');
  });

  it("escapes XML special characters in error messages", () => {
    const run = makeRun({
      stepResults: [
        {
          stepIndex: 0,
          action: "fill",
          status: "failed",
          artifactIds: [],
          durationMs: 10,
          error: 'Error: expected "foo" & <bar>',
        },
      ],
    });
    const { junit } = exporter.export(run);
    expect(junit).toContain("&amp;");
    expect(junit).toContain("&lt;");
    expect(junit).toContain("&gt;");
    expect(junit).toContain("&quot;");
  });

  it("includes timestamp from startedAt in the testsuite element", () => {
    const run = makeRun({ startedAt: "2024-06-01T10:00:00.000Z" });
    const { junit } = exporter.export(run);
    expect(junit).toContain('timestamp="2024-06-01T10:00:00.000Z"');
  });

  it("produces an empty testsuite when there are no steps or assertions", () => {
    const run = makeRun({ stepResults: [], assertionResults: [] });
    const { junit } = exporter.export(run);
    expect(junit).toContain('tests="0"');
    expect(junit).toContain('failures="0"');
  });
});
