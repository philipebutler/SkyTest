/**
 * RunRepository – Issue #18: Run Record Persistence
 *
 * Responsibilities:
 *  - Save Run objects as human-readable JSON files under the runs directory.
 *  - Load a single Run by ID.
 *  - List all persisted Runs, sorted by startedAt descending.
 *
 * Each file is named `<id>.json` and contains a fully-populated Run with
 * schemaVersion, startedAt, and finishedAt fields for forward compatibility.
 */

import * as fs from "fs";
import * as path from "path";
import type { Run } from "../../shared/types";

export class RunRepository {
  constructor(private readonly runsDir: string) {}

  /**
   * Sanitize a run ID to prevent path traversal.
   * Allows alphanumeric characters, hyphens, and underscores only.
   */
  private static sanitizeId(runId: string): string {
    return runId.replace(/[^a-z0-9_-]/gi, "_");
  }

  /**
   * Persist a Run to disk.
   * Creates the runs directory if it does not yet exist.
   */
  save(run: Run): void {
    if (!fs.existsSync(this.runsDir)) {
      fs.mkdirSync(this.runsDir, { recursive: true });
    }
    const safeId = RunRepository.sanitizeId(run.id);
    const filePath = path.join(this.runsDir, `${safeId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(run, null, 2));
  }

  /**
   * Load a Run by ID.
   * Returns null when the file does not exist or cannot be parsed.
   */
  load(runId: string): Run | null {
    const safeId = RunRepository.sanitizeId(runId);
    const filePath = path.join(this.runsDir, `${safeId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as Run;
    } catch (err) {
      console.warn(`[RunRepository] Failed to parse run file: ${safeId}.json`, err);
      return null;
    }
  }

  /**
   * List all persisted Runs, sorted by startedAt descending (newest first).
   * Skips files that cannot be parsed.
   */
  list(): Run[] {
    if (!fs.existsSync(this.runsDir)) return [];
    const files = fs.readdirSync(this.runsDir).filter((f) => f.endsWith(".json"));
    const results: Run[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(this.runsDir, f), "utf-8");
        results.push(JSON.parse(raw) as Run);
      } catch {
        console.warn(`[RunRepository] Skipping corrupted run file: ${f}`);
      }
    }
    results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return results;
  }
}
