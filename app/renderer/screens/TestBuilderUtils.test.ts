import type { ActionStep } from "../../shared/types";
import {
  applyAutoFixForMessage,
  applyAutoFixesToAllSteps,
  cloneSteps,
  collectStepValidationErrors,
  reorderSteps,
  validateStep,
} from "./TestBuilderUtils";

describe("TestBuilderUtils – validateStep", () => {
  it("reports missing URL for navigate", () => {
    const errors = validateStep({ action: "navigate" });
    expect(errors).toContain("navigate requires a URL in value.");
  });

  it("reports missing selector/value for fill", () => {
    const errors = validateStep({ action: "fill" });
    expect(errors).toContain("fill requires selector.");
    expect(errors).toContain("fill requires value.");
  });

  it("accepts valid wait numeric value", () => {
    const errors = validateStep({ action: "wait", value: "750" });
    expect(errors).toHaveLength(0);
  });
});

describe("TestBuilderUtils – collectStepValidationErrors", () => {
  it("returns step-indexed validation errors", () => {
    const steps: ActionStep[] = [{ action: "navigate" }, { action: "fill" }];
    const errors = collectStepValidationErrors(steps);
    expect(errors.some((e) => e.stepIndex === 0 && e.message.includes("navigate"))).toBe(true);
    expect(errors.some((e) => e.stepIndex === 1 && e.message.includes("fill requires selector"))).toBe(true);
  });
});

describe("TestBuilderUtils – applyAutoFixForMessage", () => {
  it("adds https:// for missing navigate URL", () => {
    const fixed = applyAutoFixForMessage({ action: "navigate" }, "navigate requires a URL in value.");
    expect(fixed.value).toBe("https://");
  });

  it("adds default selector for selector-required error", () => {
    const fixed = applyAutoFixForMessage({ action: "click" }, "click requires selector.");
    expect(fixed.selector).toBe("[data-testid='target-element']");
  });

  it("normalizes wait duration to numeric string", () => {
    const fixed = applyAutoFixForMessage({ action: "wait", value: "abc" }, "wait value must be numeric.");
    expect(fixed.value).toBe("500");
  });
});

describe("TestBuilderUtils – applyAutoFixesToAllSteps", () => {
  it("applies automatic fixes across all invalid steps", () => {
    const steps: ActionStep[] = [
      { action: "navigate" },
      { action: "fill" },
      { action: "wait", value: "bad" },
    ];

    const fixed = applyAutoFixesToAllSteps(steps);
    expect(fixed[0].value).toBe("https://");
    expect(fixed[1].selector).toBe("input[name='q']");
    expect(fixed[1].value).toBe("text value");
    expect(fixed[2].value).toBe("500");
  });
});

describe("TestBuilderUtils – reorderSteps", () => {
  it("moves a step from one index to another", () => {
    const steps: ActionStep[] = [
      { action: "navigate", value: "https://a" },
      { action: "click", selector: "#b" },
      { action: "screenshot" },
    ];

    const reordered = reorderSteps(steps, 0, 2);
    expect(reordered.map((s) => s.action)).toEqual(["click", "screenshot", "navigate"]);
  });

  it("returns unchanged copy for out-of-range moves", () => {
    const steps: ActionStep[] = [{ action: "navigate", value: "https://a" }];
    const reordered = reorderSteps(steps, 0, 2);
    expect(reordered).toEqual(steps);
    expect(reordered).not.toBe(steps);
  });
});

describe("TestBuilderUtils – cloneSteps (undo snapshot safety)", () => {
  it("preserves original snapshot after fixes are applied", () => {
    const original: ActionStep[] = [{ action: "navigate" }, { action: "fill" }];
    const snapshot = cloneSteps(original);
    const fixed = applyAutoFixesToAllSteps(original);

    expect(snapshot[0].value).toBeUndefined();
    expect(snapshot[1].selector).toBeUndefined();
    expect(snapshot[1].value).toBeUndefined();

    expect(fixed[0].value).toBe("https://");
    expect(fixed[1].selector).toBe("input[name='q']");
    expect(fixed[1].value).toBe("text value");
  });
});
