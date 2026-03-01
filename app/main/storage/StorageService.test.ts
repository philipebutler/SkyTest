/**
 * Unit tests for StorageService auth profile helpers (Issue #13).
 *
 * Tests cover:
 * - listAuthProfiles() returns names of .json files in the auth directory
 * - getStorageStatePath() returns the path when the file exists
 * - getStorageStatePath() returns null when profile is "none" or empty
 * - getStorageStatePath() returns null when the file does not exist
 * - getStorageStatePath() sanitizes the profile name to prevent path traversal
 */

// Must be hoisted before any imports so Jest replaces the Electron module
jest.mock("electron", () => ({
  app: { getPath: jest.fn() },
}));

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { app } from "electron";
import { StorageService } from "./StorageService";

/** Reset the singleton between tests. */
function resetSingleton(): void {
  (StorageService as unknown as { instance: null }).instance = null;
}

let tmpDir: string;
let service: StorageService;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skytest-auth-test-"));
  (app.getPath as jest.Mock).mockReturnValue(tmpDir);
  resetSingleton();
  service = StorageService.init();
});

afterEach(() => {
  resetSingleton();
});

describe("StorageService – listAuthProfiles (Issue #13)", () => {
  it("returns an empty array when no storageState files exist", () => {
    expect(service.listAuthProfiles()).toEqual([]);
  });

  it("returns profile names for every .json file in the auth directory", () => {
    const authDir = service.authDir;
    fs.writeFileSync(path.join(authDir, "staging.json"), "{}");
    fs.writeFileSync(path.join(authDir, "production.json"), "{}");
    const profiles = service.listAuthProfiles().sort();
    expect(profiles).toEqual(["production", "staging"]);
  });

  it("ignores non-.json files", () => {
    const authDir = service.authDir;
    fs.writeFileSync(path.join(authDir, "staging.json"), "{}");
    fs.writeFileSync(path.join(authDir, "readme.txt"), "notes");
    expect(service.listAuthProfiles()).toEqual(["staging"]);
  });
});

describe("StorageService – getStorageStatePath (Issue #13)", () => {
  it("returns null for profile 'none'", () => {
    expect(service.getStorageStatePath("none")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(service.getStorageStatePath("")).toBeNull();
  });

  it("returns null when the storageState file does not exist", () => {
    expect(service.getStorageStatePath("staging")).toBeNull();
  });

  it("returns the correct path when the storageState file exists", () => {
    const authDir = service.authDir;
    fs.writeFileSync(path.join(authDir, "staging.json"), "{}");
    const result = service.getStorageStatePath("staging");
    expect(result).toBe(path.join(authDir, "staging.json"));
  });

  it("sanitizes dangerous characters in the profile name", () => {
    const authDir = service.authDir;
    // A path-traversal attempt should be sanitized; the resulting file is safe
    const safeName = "../evil".replace(/[^a-z0-9_-]/gi, "_");
    fs.writeFileSync(path.join(authDir, `${safeName}.json`), "{}");
    const result = service.getStorageStatePath("../evil");
    // Must not escape the auth directory
    expect(result).not.toContain("..");
    expect(result).toContain(authDir);
  });
});
