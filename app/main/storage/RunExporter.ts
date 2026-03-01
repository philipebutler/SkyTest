/**
 * RunExporter – Issue #20: Export Run Results
 *
 * Generates Markdown and JSON export content from a Run record.
 * The output includes:
 *  - Summary (status, environment, browser, duration, tool policy)
 *  - Step timeline with status, duration, errors, and artifact IDs
 *  - Assertion results
 *  - Artifact references (type, path, step association)
 */

import type { Artifact, AssertionResult, Run, StepResult } from "../../shared/types";

export interface ExportContent {
  /** Human-readable Markdown report. */
  markdown: string;
  /** Raw JSON serialization of the Run record (pretty-printed). */
  json: string;
  /** JUnit XML report compatible with CI systems (Issue #24). */
  junit: string;
}

export class RunExporter {
  /**
   * Produce both Markdown and JSON export content for the given Run.
   */
  export(run: Run): ExportContent {
    return {
      markdown: this.toMarkdown(run),
      json: JSON.stringify(run, null, 2),
      junit: this.toJUnit(run),
    };
  }

  private toMarkdown(run: Run): string {
    const lines: string[] = [];

    // ── Title ──────────────────────────────────────────────────────────────
    lines.push(`# Run Report: ${run.id}`);
    lines.push("");

    // ── Summary table ──────────────────────────────────────────────────────
    lines.push("## Summary");
    lines.push("");
    lines.push("| Field | Value |");
    lines.push("|-------|-------|");
    lines.push(`| Status | ${run.status} |`);
    if (run.testId) lines.push(`| Test ID | ${run.testId} |`);
    lines.push(`| Environment | ${run.environment} |`);
    lines.push(`| Browser | ${run.browser} |`);
    lines.push(`| Headed | ${run.headed ? "Yes" : "No"} |`);
    lines.push(`| Tool Policy | ${run.toolPolicy} |`);
    lines.push(`| Started | ${run.startedAt} |`);
    if (run.finishedAt) {
      const durationMs =
        new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
      lines.push(`| Finished | ${run.finishedAt} |`);
      lines.push(`| Duration | ${durationMs}ms |`);
    }
    lines.push("");

    // ── Steps ──────────────────────────────────────────────────────────────
    lines.push("## Steps");
    lines.push("");
    if (run.stepResults.length === 0) {
      lines.push("_No steps recorded._");
      lines.push("");
    } else {
      for (const step of run.stepResults) {
        lines.push(...this.stepToMarkdown(step));
      }
    }

    // ── Assertions ─────────────────────────────────────────────────────────
    if (run.assertionResults && run.assertionResults.length > 0) {
      lines.push("## Assertion Results");
      lines.push("");
      for (const assertion of run.assertionResults) {
        lines.push(...this.assertionToMarkdown(assertion));
      }
    }

    // ── Artifacts ──────────────────────────────────────────────────────────
    if (run.artifacts.length > 0) {
      lines.push("## Artifacts");
      lines.push("");
      for (const artifact of run.artifacts) {
        lines.push(...this.artifactToMarkdown(artifact));
      }
    }

    return lines.join("\n");
  }

  private stepToMarkdown(step: StepResult): string[] {
    const icon =
      step.status === "passed" ? "✅" : step.status === "failed" ? "❌" : "⏭";
    const lines: string[] = [];
    lines.push(`### Step ${step.stepIndex + 1}: \`${step.action}\``);
    lines.push("");
    lines.push(`- **Status**: ${icon} ${step.status}`);
    lines.push(`- **Duration**: ${step.durationMs}ms`);
    if (step.error) {
      lines.push(`- **Error**: ${step.error}`);
    }
    if (step.artifactIds.length > 0) {
      lines.push(`- **Artifacts**: ${step.artifactIds.map((id) => `\`${id}\``).join(", ")}`);
    }
    lines.push("");
    return lines;
  }

  private assertionToMarkdown(assertion: AssertionResult): string[] {
    const icon = assertion.status === "passed" ? "✅" : "❌";
    const error = assertion.error ? ` — ${assertion.error}` : "";
    return [
      `- ${icon} **[${assertion.assertionIndex}] \`${assertion.type}\`**: ${assertion.status}${error}`,
    ];
  }

  private artifactToMarkdown(artifact: Artifact): string[] {
    const stepNote =
      artifact.stepIndex !== undefined ? ` (step ${artifact.stepIndex})` : "";
    return [
      `- **${artifact.type}**${stepNote} · ID: \`${artifact.id}\` · Path: \`${artifact.path}\``,
    ];
  }

  /**
   * Produce a JUnit XML report compatible with CI systems (Issue #24).
   *
   * Each step and assertion becomes a <testcase>. Failed steps/assertions
   * include a <failure> element. The total time is derived from the run
   * duration in seconds (or 0 when finishedAt is absent).
   */
  private toJUnit(run: Run): string {
    const durationSec = run.finishedAt
      ? ((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(3)
      : "0.000";

    const testCases: string[] = [];

    for (const step of run.stepResults) {
      const name = this.xmlEsc(`step ${step.stepIndex}: ${step.action}`);
      const timeSec = (step.durationMs / 1000).toFixed(3);
      const cls = this.xmlEsc(run.id);
      if (step.status === "failed") {
        const msg = this.xmlEsc(step.error ?? "step failed");
        testCases.push(
          `    <testcase name="${name}" classname="${cls}" time="${timeSec}">\n` +
          `      <failure message="${msg}" type="AssertionError">${msg}</failure>\n` +
          `    </testcase>`
        );
      } else {
        testCases.push(`    <testcase name="${name}" classname="${cls}" time="${timeSec}"/>`);
      }
    }

    for (const assertion of run.assertionResults ?? []) {
      const name = this.xmlEsc(`assertion ${assertion.assertionIndex}: ${assertion.type}`);
      const cls = this.xmlEsc(run.id);
      if (assertion.status === "failed") {
        const msg = this.xmlEsc(assertion.error ?? "assertion failed");
        testCases.push(
          `    <testcase name="${name}" classname="${cls}" time="0.000">\n` +
          `      <failure message="${msg}" type="AssertionError">${msg}</failure>\n` +
          `    </testcase>`
        );
      } else {
        testCases.push(`    <testcase name="${name}" classname="${cls}" time="0.000"/>`);
      }
    }

    const totalTests = testCases.length;
    const totalFailures = (run.stepResults.filter((s) => s.status === "failed").length) +
      ((run.assertionResults ?? []).filter((a) => a.status === "failed").length);
    const suiteId = this.xmlEsc(run.id);
    const timestamp = this.xmlEsc(run.startedAt);

    const lines: string[] = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<testsuites name="SkyTest" tests="${totalTests}" failures="${totalFailures}" errors="0" time="${durationSec}">`,
      `  <testsuite name="${suiteId}" tests="${totalTests}" failures="${totalFailures}" errors="0" time="${durationSec}" timestamp="${timestamp}">`,
      ...testCases,
      `  </testsuite>`,
      `</testsuites>`,
    ];

    return lines.join("\n");
  }

  /** Escape special XML characters in attribute values and text content. */
  private xmlEsc(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}
