/**
 * StorageService – Issue #2: Define Local File System Layout
 *
 * Responsibilities:
 *  - Resolve deterministic paths for tests, runs, auth, artifacts, exports.
 *  - Create all required directories on first launch.
 *  - Persist user-configurable path overrides to settings.json.
 *  - Expose no hardcoded absolute paths; all defaults derive from
 *    Electron's app.getPath('userData').
 */

import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import type { Settings } from "../../shared/types";

const SETTINGS_FILE = "settings.json";
const SCHEMA_VERSION = "1";

/**
 * Ordered list of sub-directory names that must exist under the base path.
 */
const REQUIRED_DIRS = ["tests", "runs", "auth", "artifacts", "exports", "recordings"] as const;

type DirKey = (typeof REQUIRED_DIRS)[number];

/**
 * Singleton StorageService.
 * Call `StorageService.init()` once in the main process before any
 * IPC handlers attempt to read/write files.
 */
export class StorageService {
  private static instance: StorageService | null = null;

  /** Absolute path to the Electron userData folder (non-configurable). */
  private readonly userDataPath: string;

  /** Current resolved settings (in-memory cache). */
  private settings: Settings;

  private constructor(userDataPath: string) {
    this.userDataPath = userDataPath;
    this.settings = this.loadSettings();
    this.ensureDirectories();
  }

  /** Initialise (or return the existing) StorageService singleton. */
  static init(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService(app.getPath("userData"));
    }
    return StorageService.instance;
  }

  /** Return the singleton (throws if init() was never called). */
  static getInstance(): StorageService {
    if (!StorageService.instance) {
      throw new Error("StorageService has not been initialised. Call StorageService.init() first.");
    }
    return StorageService.instance;
  }

  // ---------------------------------------------------------------------------
  // Path accessors
  // ---------------------------------------------------------------------------

  get testsDir(): string {
    return this.resolve("tests");
  }

  get runsDir(): string {
    return this.resolve("runs");
  }

  get authDir(): string {
    return this.resolve("auth");
  }

  get artifactsDir(): string {
    return this.resolve("artifacts");
  }

  get exportsDir(): string {
    return this.resolve("exports");
  }

  get recordingsDir(): string {
    return this.resolve("recordings");
  }

  /**
   * Returns the absolute path to the storageState.json for a given auth profile.
   * Returns null when profile is absent ("none"/empty) or the file does not exist.
   * The profile name is sanitized to prevent path traversal (Issue #13).
   */
  getStorageStatePath(profile: string): string | null {
    if (!profile || profile === "none") return null;
    const safeName = profile.replace(/[^a-z0-9_-]/gi, "_");
    const p = path.join(this.authDir, `${safeName}.json`);
    return fs.existsSync(p) ? p : null;
  }

  /**
   * Returns a list of auth profile names that have a saved storageState.json
   * inside the auth directory (Issue #13).
   */
  listAuthProfiles(): string[] {
    const dir = this.authDir;
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  getSettings(): Settings {
    return { ...this.settings };
  }

  saveSettings(patch: Partial<Omit<Settings, "schemaVersion" | "createdAt" | "updatedAt">>): Settings {
    this.settings = {
      ...this.settings,
      ...patch,
      schemaVersion: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
    };
    this.persistSettings();
    // Re-create any directories that might have changed path.
    this.ensureDirectories();
    return { ...this.settings };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve the absolute path for a named directory.
   * If the user has specified a non-empty override in settings, that is used;
   * otherwise the default `<userData>/<name>` is returned.
   */
  private resolve(dir: DirKey): string {
    const override = this.settings[`${dir}Dir` as keyof Settings] as string;
    if (override && override.trim() !== "") {
      return override;
    }
    return path.join(this.userDataPath, dir);
  }

  /**
   * Create all required directories (idempotent).
   */
  private ensureDirectories(): void {
    for (const dir of REQUIRED_DIRS) {
      const dirPath = this.resolve(dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`[StorageService] Created directory: ${dirPath}`);
      }
    }
  }

  /**
   * Load settings from disk or return safe defaults.
   */
  private loadSettings(): Settings {
    const settingsPath = path.join(this.userDataPath, SETTINGS_FILE);
    if (fs.existsSync(settingsPath)) {
      try {
        const raw = fs.readFileSync(settingsPath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<Settings>;
        const defaults = this.defaultSettings();
        const now = new Date().toISOString();
        return {
          schemaVersion: parsed.schemaVersion ?? SCHEMA_VERSION,
          testsDir: parsed.testsDir ?? "",
          runsDir: parsed.runsDir ?? "",
          authDir: parsed.authDir ?? "",
          artifactsDir: parsed.artifactsDir ?? "",
          exportsDir: parsed.exportsDir ?? "",
          lastEnvironment: parsed.lastEnvironment ?? defaults.lastEnvironment,
          lastBrowser: parsed.lastBrowser ?? defaults.lastBrowser,
          lastHeaded: parsed.lastHeaded ?? defaults.lastHeaded,
          lastAuthProfile: parsed.lastAuthProfile ?? defaults.lastAuthProfile,
          lastToolPolicy: parsed.lastToolPolicy ?? defaults.lastToolPolicy,
          createdAt: parsed.createdAt ?? now,
          updatedAt: parsed.updatedAt ?? now,
        };
      } catch (err) {
        console.warn("[StorageService] Failed to parse settings.json, using defaults.", err);
      }
    }
    return this.defaultSettings();
  }

  private defaultSettings(): Settings {
    const now = new Date().toISOString();
    return {
      schemaVersion: SCHEMA_VERSION,
      testsDir: "",
      runsDir: "",
      authDir: "",
      artifactsDir: "",
      exportsDir: "",
      lastEnvironment: "default",
      lastBrowser: "chromium",
      lastHeaded: false,
      lastAuthProfile: "none",
      lastToolPolicy: "read-only",
      createdAt: now,
      updatedAt: now,
    };
  }

  private persistSettings(): void {
    // Ensure the userData directory exists (Electron normally does this, but
    // in tests the path may be a temp folder that hasn't been created yet).
    if (!fs.existsSync(this.userDataPath)) {
      fs.mkdirSync(this.userDataPath, { recursive: true });
    }
    const settingsPath = path.join(this.userDataPath, SETTINGS_FILE);
    fs.writeFileSync(settingsPath, JSON.stringify(this.settings, null, 2));
  }
}
