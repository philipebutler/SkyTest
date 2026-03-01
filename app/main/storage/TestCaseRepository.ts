/**
 * TestCaseRepository – Issue #15: Test Case Model & Persistence
 *
 * Responsibilities:
 *  - Save TestCase objects as human-readable JSON files under the tests directory.
 *  - Load a single TestCase by ID.
 *  - List all persisted TestCases.
 *  - Delete a TestCase by ID.
 *
 * Each file is named `<id>.json` and contains a fully-populated TestCase with
 * schemaVersion, createdAt, and updatedAt fields for forward compatibility.
 */

import * as fs from "fs";
import * as path from "path";
import type { TestCase } from "../../shared/types";

export class TestCaseRepository {
  constructor(private readonly testsDir: string) {}

  /**
   * Sanitize a test ID to prevent path traversal.
   * Allows alphanumeric characters, hyphens, and underscores only.
   */
  private static sanitizeId(testId: string): string {
    return testId.replace(/[^a-z0-9_-]/gi, "_");
  }

  /**
   * Persist a TestCase to disk.
   * Creates the tests directory if it does not yet exist.
   */
  save(testCase: TestCase): void {
    if (!fs.existsSync(this.testsDir)) {
      fs.mkdirSync(this.testsDir, { recursive: true });
    }
    const safeId = TestCaseRepository.sanitizeId(testCase.id);
    const filePath = path.join(this.testsDir, `${safeId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(testCase, null, 2));
  }

  /**
   * Load a TestCase by ID.
   * Returns null when the file does not exist or cannot be parsed.
   */
  load(testId: string): TestCase | null {
    const safeId = TestCaseRepository.sanitizeId(testId);
    const filePath = path.join(this.testsDir, `${safeId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as TestCase;
    } catch (err) {
      console.warn(`[TestCaseRepository] Failed to parse test file: ${safeId}.json`, err);
      return null;
    }
  }

  /**
   * List all persisted TestCases, sorted by createdAt descending.
   * Skips files that cannot be parsed.
   */
  list(): TestCase[] {
    if (!fs.existsSync(this.testsDir)) return [];
    const files = fs.readdirSync(this.testsDir).filter((f) => f.endsWith(".json"));
    const results: TestCase[] = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(this.testsDir, f), "utf-8");
        results.push(JSON.parse(raw) as TestCase);
      } catch {
        console.warn(`[TestCaseRepository] Skipping corrupted test file: ${f}`);
      }
    }
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return results;
  }

  /**
   * Delete a TestCase by ID.
   * No-op when the file does not exist.
   */
  delete(testId: string): void {
    const safeId = TestCaseRepository.sanitizeId(testId);
    const filePath = path.join(this.testsDir, `${safeId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}
