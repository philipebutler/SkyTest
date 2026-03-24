/**
 * Unit tests for the DSL Validator (Issue #7 / SPEC §6.3).
 */

import { normalizeDSLPlan, validateDSL, validateDSLPolicy } from "./dslValidator";
import { ADVANCED_ACTION_VERBS, CORE_ACTION_VERBS } from "../../shared/types";
import type { DSLPlan } from "../../shared/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<DSLPlan> = {}): DSLPlan {
  return {
    version: "1",
    intent: "Test plan",
    steps: [{ action: "navigate", value: "https://example.com" }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateDSL – top-level structure
// ---------------------------------------------------------------------------

describe("validateDSL – top-level structure", () => {
  it("accepts a minimal valid plan", () => {
    const result = validateDSL(makePlan());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects non-object input", () => {
    const result = validateDSL("not an object");
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/JSON object/);
  });

  it("rejects null input", () => {
    const result = validateDSL(null);
    expect(result.valid).toBe(false);
  });

  it("rejects wrong version", () => {
    const result = validateDSL({ ...makePlan(), version: "2" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('version'))).toBe(true);
  });

  it("rejects missing intent", () => {
    const plan = makePlan();
    const { intent: _removed, ...rest } = plan;
    const result = validateDSL(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("intent"))).toBe(true);
  });

  it("rejects empty intent", () => {
    const result = validateDSL({ ...makePlan(), intent: "   " });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("intent"))).toBe(true);
  });

  it("rejects non-array steps", () => {
    const result = validateDSL({ ...makePlan(), steps: "not an array" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("steps"))).toBe(true);
  });

  it("rejects empty steps array", () => {
    const result = validateDSL({ ...makePlan(), steps: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("at least one"))).toBe(true);
  });

  it("collects all top-level errors without stopping at first", () => {
    const result = validateDSL({ version: "2", steps: [] });
    // version wrong + intent missing + empty steps = ≥ 3 errors
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// validateDSL – unknown action verbs are rejected
// ---------------------------------------------------------------------------

describe("validateDSL – unknown action verbs", () => {
  it("rejects an unknown action verb", () => {
    const result = validateDSL(
      makePlan({ steps: [{ action: "deleteAllData" as never, selector: "#x" }] })
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].stepIndex).toBe(0);
    expect(result.errors[0].message).toMatch(/Unknown action/);
  });

  it("accepts all valid action verbs", () => {
    const verbs: DSLPlan["steps"][number]["action"][] = [...CORE_ACTION_VERBS, ...ADVANCED_ACTION_VERBS];

    for (const verb of verbs) {
      let step: DSLPlan["steps"][number];
      switch (verb) {
        case "navigate": step = { action: verb, value: "https://example.com" }; break;
        case "fill":
        case "select":   step = { action: verb, selector: "#el", value: "v" }; break;
        case "wait":     step = { action: verb, value: "500" }; break;
        case "assert":   step = { action: verb, selector: "#el" }; break;
        case "waitForNavigation":
        case "screenshot": step = { action: verb }; break;
        case "keyboardType": step = { action: verb, params: { text: "hello" } }; break;
        case "keyboardPress":
        case "keyboardDown":
        case "keyboardUp": step = { action: verb, params: { key: "Enter" } }; break;
        case "frameSelect": step = { action: verb, params: { selector: "iframe" } }; break;
        case "tabSwitch": step = { action: verb, params: { index: 0 } }; break;
        case "uploadFile": step = { action: verb, selector: "input[type=file]", params: { files: "./fixtures/a.txt" } }; break;
        case "networkWaitForRequest":
        case "networkWaitForResponse": step = { action: verb, params: { urlIncludes: "/api" } }; break;
        case "storageSet": step = { action: verb, params: { key: "token", value: "abc" } }; break;
        case "storageRemove": step = { action: verb, params: { key: "token" } }; break;
        case "cookieSet": step = { action: verb, params: { name: "sid", value: "1", domain: "example.com" } }; break;
        case "cookieDelete": step = { action: verb, params: { name: "sid" } }; break;
        default:         step = { action: verb, selector: "#el" };
      }
      const result = validateDSL(makePlan({ steps: [step] }));
      expect(result.valid).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validateDSL – required fields per verb
// ---------------------------------------------------------------------------

describe("validateDSL – navigate", () => {
  it("requires value (URL)", () => {
    const result = validateDSL(makePlan({ steps: [{ action: "navigate" }] }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/"navigate" requires/);
  });

  it("rejects non-http/https URL", () => {
    const result = validateDSL(
      makePlan({ steps: [{ action: "navigate", value: "ftp://files.example.com" }] })
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/valid http\/https URL/);
  });

  it("rejects invalid URL string", () => {
    const result = validateDSL(
      makePlan({ steps: [{ action: "navigate", value: "not-a-url" }] })
    );
    expect(result.valid).toBe(false);
  });
});

describe("validateDSL – click / check / uncheck / hover / waitForSelector / scroll", () => {
  const selectorVerbs = ["click", "check", "uncheck", "hover", "waitForSelector", "scroll"] as const;

  for (const verb of selectorVerbs) {
    it(`"${verb}" requires selector`, () => {
      const result = validateDSL(makePlan({ steps: [{ action: verb }] }));
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toMatch(/"selector"/);
    });

    it(`"${verb}" is valid with selector`, () => {
      const result = validateDSL(makePlan({ steps: [{ action: verb, selector: "#btn" }] }));
      expect(result.valid).toBe(true);
    });
  }
});

describe("validateDSL – fill / select", () => {
  for (const verb of ["fill", "select"] as const) {
    it(`"${verb}" requires selector and value`, () => {
      const result = validateDSL(makePlan({ steps: [{ action: verb }] }));
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('"selector"'))).toBe(true);
      expect(result.errors.some((e) => e.message.includes('"value"'))).toBe(true);
    });

    it(`"${verb}" requires value even when selector is present`, () => {
      const result = validateDSL(makePlan({ steps: [{ action: verb, selector: "#el" }] }));
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toMatch(/"value"/);
    });
  }
});

describe("validateDSL – wait", () => {
  it("requires value", () => {
    const result = validateDSL(makePlan({ steps: [{ action: "wait" }] }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/"wait" requires/);
  });

  it("rejects non-numeric value", () => {
    const result = validateDSL(makePlan({ steps: [{ action: "wait", value: "long" }] }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/numeric/);
  });

  it("accepts numeric string value", () => {
    const result = validateDSL(makePlan({ steps: [{ action: "wait", value: "1000" }] }));
    expect(result.valid).toBe(true);
  });
});

describe("validateDSL – assert", () => {
  it("requires selector or value", () => {
    const result = validateDSL(makePlan({ steps: [{ action: "assert" }] }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/selector.*value/i);
  });

  it("is valid with only selector", () => {
    const result = validateDSL(makePlan({ steps: [{ action: "assert", selector: "#el" }] }));
    expect(result.valid).toBe(true);
  });

  it("is valid with only value", () => {
    const result = validateDSL(makePlan({ steps: [{ action: "assert", value: "some text" }] }));
    expect(result.valid).toBe(true);
  });
});

describe("validateDSL – no-required-field verbs", () => {
  it("screenshot is valid without extra fields", () => {
    const result = validateDSL(makePlan({ steps: [{ action: "screenshot" }] }));
    expect(result.valid).toBe(true);
  });

  it("waitForNavigation is valid without extra fields", () => {
    const result = validateDSL(makePlan({ steps: [{ action: "waitForNavigation" }] }));
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateDSL – non-object step
// ---------------------------------------------------------------------------

describe("validateDSL – non-object step", () => {
  it("reports error for a non-object step", () => {
    const result = validateDSL(makePlan({ steps: ["bad step" as never] }));
    expect(result.valid).toBe(false);
    expect(result.errors[0].stepIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// validateDSLPolicy – tool policy enforcement
// ---------------------------------------------------------------------------

describe("validateDSLPolicy", () => {
  it("allows navigate under read-only", () => {
    const plan = makePlan({ steps: [{ action: "navigate", value: "https://example.com" }] });
    const result = validateDSLPolicy(plan, "read-only");
    expect(result.valid).toBe(true);
  });

  it("blocks click under read-only", () => {
    const plan = makePlan({ steps: [{ action: "click", selector: "#btn" }] });
    const result = validateDSLPolicy(plan, "read-only");
    expect(result.valid).toBe(false);
    expect(result.errors[0].stepIndex).toBe(0);
    expect(result.errors[0].message).toMatch(/read-only/);
  });

  it("allows click under safe-write", () => {
    const plan = makePlan({ steps: [{ action: "click", selector: "#btn" }] });
    const result = validateDSLPolicy(plan, "safe-write");
    expect(result.valid).toBe(true);
  });

  it("allows all verbs under full policy", () => {
    const plan = makePlan({
      steps: [
        { action: "navigate", value: "https://example.com" },
        { action: "fill", selector: "#el", value: "v" },
        { action: "click", selector: "#btn" },
        { action: "screenshot" },
        { action: "keyboardPress", params: { key: "Enter" } },
      ],
    });
    const result = validateDSLPolicy(plan, "full");
    expect(result.valid).toBe(true);
  });

  it("requires full policy for advanced verbs", () => {
    const plan = makePlan({
      steps: [{ action: "keyboardPress", params: { key: "Enter" } }],
    });
    const result = validateDSLPolicy(plan, "safe-write");
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toMatch(/not permitted|requires the "full" tool policy/i);
  });

  it("reports all policy violations, not just the first", () => {
    const plan = makePlan({
      steps: [
        { action: "click", selector: "#a" },
        { action: "fill", selector: "#b", value: "v" },
        { action: "navigate", value: "https://example.com" },
      ],
    });
    const result = validateDSLPolicy(plan, "read-only");
    expect(result.valid).toBe(false);
    // click and fill are blocked; navigate is allowed
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e) => e.stepIndex)).toEqual([0, 1]);
  });
});

describe("normalizeDSLPlan", () => {
  it("maps verb + target aliases into canonical fields", () => {
    const normalized = normalizeDSLPlan(
      {
        version: "1",
        steps: [
          { verb: "navigate", target: "https://example.com" },
          { verb: "waitForSelector", target: "#ready" },
        ],
      },
      "fallback"
    ) as DSLPlan;

    expect(normalized.intent).toBe("fallback");
    expect(normalized.steps[0]).toMatchObject({ action: "navigate", value: "https://example.com" });
    expect(normalized.steps[1]).toMatchObject({ action: "waitForSelector", selector: "#ready" });
  });

  it("maps navigate selector fallback into value", () => {
    const normalized = normalizeDSLPlan(
      {
        version: "1",
        intent: "x",
        steps: [{ verb: "navigate", selector: "https://example.com" }],
      },
      "fallback"
    ) as DSLPlan;

    expect(normalized.steps[0]).toMatchObject({ action: "navigate", value: "https://example.com" });
  });

  it("maps goto alias and preserves params", () => {
    const normalized = normalizeDSLPlan(
      {
        version: "1",
        intent: "x",
        steps: [{ verb: "goto", target: "https://example.com" }, { action: "keyboard.press", params: { key: "Enter" } }],
      },
      "fallback"
    ) as DSLPlan;

    expect(normalized.steps[0]).toMatchObject({ action: "navigate", value: "https://example.com" });
    expect(normalized.steps[1]).toMatchObject({ action: "keyboardPress", params: { key: "Enter" } });
  });

  it("maps core fields from params for verb+params payloads", () => {
    const normalized = normalizeDSLPlan(
      {
        version: "DSLPlan_v1",
        intent: "google search",
        steps: [
          { verb: "navigate", params: { url: "https://www.google.com/" } },
          { verb: "waitForSelector", params: { selector: "Search box", timeoutMs: 15000 } },
          { verb: "fill", params: { selector: "Search box", text: "american cheese" } },
        ],
      },
      "fallback"
    ) as DSLPlan;

    expect(normalized.version).toBe("1");
    expect(normalized.steps[0]).toMatchObject({ action: "navigate", value: "https://www.google.com/" });
    expect(normalized.steps[1]).toMatchObject({ action: "waitForSelector", selector: "Search box", timeout: 15000 });
    expect(normalized.steps[2]).toMatchObject({ action: "fill", selector: "Search box", value: "american cheese" });
  });
});
