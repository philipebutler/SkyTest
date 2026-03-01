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
}

export class RunExporter {
  /**
   * Produce both Markdown and JSON export content for the given Run.
   */
  export(run: Run): ExportContent {
    return {
      markdown: this.toMarkdown(run),
      json: JSON.stringify(run, null, 2),
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
}
