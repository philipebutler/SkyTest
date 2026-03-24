/**
 * Unit tests for TestCaseRepository (Issue #15).
 *
 * Tests cover:
 * - save() writes a human-readable JSON file to the tests directory
 * - load() returns the TestCase when the file exists
 * - load() returns null when the file does not exist
 * - load() returns null when the file contains invalid JSON
 * - list() returns all saved TestCases sorted by createdAt descending
 * - list() returns an empty array when the directory is empty
 * - list() skips corrupted files
 * - delete() removes the file
 * - delete() is a no-op when the file does not exist
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { TestCase } from "../../shared/types";
import { TestCaseRepository } from "./TestCaseRepository";

function makeTestCase(overrides: Partial<TestCase> = {}): TestCase {
  const now = new Date().toISOString();
  return {
    schemaVersion: "1",
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "Sample test",
    tags: [],
    preconditions: [],
    steps: [{ action: "navigate", url: "https://example.com" }],
    assertions: [{ type: "urlContains", value: "example" }],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

let tmpDir: string;
let repo: TestCaseRepository;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skytest-tests-"));
  repo = new TestCaseRepository(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("TestCaseRepository – save (Issue #15)", () => {
  it("writes a JSON file named <id>.json to the tests directory", () => {
    const tc = makeTestCase({ id: "test-abc" });
    repo.save(tc);
    expect(fs.existsSync(path.join(tmpDir, "test-abc.json"))).toBe(true);
  });

  it("writes human-readable JSON (indented)", () => {
    const tc = makeTestCase({ id: "test-readable" });
    repo.save(tc);
    const raw = fs.readFileSync(path.join(tmpDir, "test-readable.json"), "utf-8");
    expect(raw).toContain("\n");
    expect(raw).toContain("  ");
  });

  it("includes schemaVersion, id, name, steps, assertions, createdAt, updatedAt", () => {
    const tc = makeTestCase({ id: "test-fields", name: "My Test" });
    repo.save(tc);
    const parsed = JSON.parse(fs.readFileSync(path.join(tmpDir, "test-fields.json"), "utf-8")) as TestCase;
    expect(parsed.schemaVersion).toBe("1");
    expect(parsed.id).toBe("test-fields");
    expect(parsed.name).toBe("My Test");
    expect(Array.isArray(parsed.steps)).toBe(true);
    expect(Array.isArray(parsed.assertions)).toBe(true);
    expect(parsed.createdAt).toBeDefined();
    expect(parsed.updatedAt).toBeDefined();
  });

  it("creates the tests directory if it does not exist", () => {
    const subDir = path.join(tmpDir, "nested", "tests");
    const subRepo = new TestCaseRepository(subDir);
    const tc = makeTestCase({ id: "test-newdir" });
    subRepo.save(tc);
    expect(fs.existsSync(path.join(subDir, "test-newdir.json"))).toBe(true);
  });

  it("sanitizes dangerous characters in the test ID to prevent path traversal", () => {
    const tc = makeTestCase({ id: "../evil/test" });
    repo.save(tc);
    // The sanitized ID must not escape the tests directory
    const files = fs.readdirSync(tmpDir);
    expect(files.some((f) => f.includes(".."))).toBe(false);
    expect(files.some((f) => f.includes("/"))).toBe(false);
  });

  it("overwrites an existing file when saving with the same ID (update)", () => {
    const tc = makeTestCase({ id: "test-update", name: "Original" });
    repo.save(tc);
    const updated: TestCase = { ...tc, name: "Updated", updatedAt: new Date().toISOString() };
    repo.save(updated);
    const parsed = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "test-update.json"), "utf-8")
    ) as TestCase;
    expect(parsed.name).toBe("Updated");
  });
});

describe("TestCaseRepository – load (Issue #15)", () => {
  it("returns the TestCase when the file exists", () => {
    const tc = makeTestCase({ id: "test-load" });
    repo.save(tc);
    const loaded = repo.load("test-load");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("test-load");
    expect(loaded!.name).toBe(tc.name);
  });

  it("returns null when the file does not exist", () => {
    expect(repo.load("nonexistent")).toBeNull();
  });

  it("returns null when the file contains invalid JSON", () => {
    fs.writeFileSync(path.join(tmpDir, "bad.json"), "{ not valid json");
    expect(repo.load("bad")).toBeNull();
  });

  it("preserves steps and assertions on round-trip", () => {
    const tc = makeTestCase({
      id: "test-roundtrip",
      steps: [{ action: "navigate", url: "https://example.com" }, { action: "click", selector: "#btn" }],
      assertions: [{ type: "urlContains", value: "example" }],
    });
    repo.save(tc);
    const loaded = repo.load("test-roundtrip");
    expect(loaded!.steps).toHaveLength(2);
    expect(loaded!.assertions).toHaveLength(1);
  });

  it("preserves uiDraft metadata on round-trip", () => {
    const tc = makeTestCase({
      id: "test-draft-roundtrip",
      uiDraft: {
        isDraft: true,
        invalidRawJson: "{ bad",
        parseError: "Invalid JSON",
        validationErrors: ["Invalid JSON"],
        stagedAt: new Date().toISOString(),
      },
    });
    repo.save(tc);
    const loaded = repo.load("test-draft-roundtrip");
    expect(loaded?.uiDraft?.isDraft).toBe(true);
    expect(loaded?.uiDraft?.invalidRawJson).toBe("{ bad");
  });
});

describe("TestCaseRepository – list (Issue #15)", () => {
  it("returns an empty array when no test files exist", () => {
    expect(repo.list()).toEqual([]);
  });

  it("returns all saved TestCases", () => {
    const tc1 = makeTestCase({ id: "test-list-1", name: "A" });
    const tc2 = makeTestCase({ id: "test-list-2", name: "B" });
    repo.save(tc1);
    repo.save(tc2);
    const list = repo.list();
    expect(list).toHaveLength(2);
    const ids = list.map((t) => t.id).sort();
    expect(ids).toEqual(["test-list-1", "test-list-2"]);
  });

  it("returns TestCases sorted by createdAt descending (newest first)", () => {
    const tc1 = makeTestCase({ id: "test-sort-1", createdAt: "2024-01-01T00:00:00.000Z" });
    const tc2 = makeTestCase({ id: "test-sort-2", createdAt: "2024-06-01T00:00:00.000Z" });
    const tc3 = makeTestCase({ id: "test-sort-3", createdAt: "2024-03-01T00:00:00.000Z" });
    repo.save(tc1);
    repo.save(tc2);
    repo.save(tc3);
    const list = repo.list();
    expect(list[0].id).toBe("test-sort-2");
    expect(list[1].id).toBe("test-sort-3");
    expect(list[2].id).toBe("test-sort-1");
  });

  it("skips corrupted JSON files and returns remaining valid tests", () => {
    const tc = makeTestCase({ id: "test-good" });
    repo.save(tc);
    fs.writeFileSync(path.join(tmpDir, "corrupted.json"), "{ broken");
    const list = repo.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("test-good");
  });

  it("returns an empty array when the directory does not exist", () => {
    const emptyRepo = new TestCaseRepository(path.join(tmpDir, "nonexistent"));
    expect(emptyRepo.list()).toEqual([]);
  });
});

describe("TestCaseRepository – delete (Issue #15)", () => {
  it("removes the JSON file for the given test ID", () => {
    const tc = makeTestCase({ id: "test-delete" });
    repo.save(tc);
    expect(fs.existsSync(path.join(tmpDir, "test-delete.json"))).toBe(true);
    repo.delete("test-delete");
    expect(fs.existsSync(path.join(tmpDir, "test-delete.json"))).toBe(false);
  });

  it("is a no-op when the file does not exist", () => {
    expect(() => repo.delete("ghost")).not.toThrow();
  });

  it("does not affect other test files when deleting one", () => {
    const tc1 = makeTestCase({ id: "test-keep" });
    const tc2 = makeTestCase({ id: "test-remove" });
    repo.save(tc1);
    repo.save(tc2);
    repo.delete("test-remove");
    expect(repo.list()).toHaveLength(1);
    expect(repo.list()[0].id).toBe("test-keep");
  });
});
