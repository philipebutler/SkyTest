import type { ActionStep } from "../../shared/types";

export interface StepValidationError {
  stepIndex: number;
  message: string;
}

export function validateStep(step: ActionStep): string[] {
  const errors: string[] = [];
  const action = step.action;
  if (!action) {
    errors.push("Action is required.");
    return errors;
  }

  if (action === "navigate") {
    if (!step.value?.trim()) errors.push("navigate requires a URL in value.");
  }

  if (["click", "check", "uncheck", "hover", "waitForSelector", "scroll"].includes(action)) {
    if (!step.selector?.trim()) errors.push(`${action} requires selector.`);
  }

  if (["fill", "select"].includes(action)) {
    if (!step.selector?.trim()) errors.push(`${action} requires selector.`);
    if (!step.value?.trim()) errors.push(`${action} requires value.`);
  }

  if (action === "wait") {
    if (!step.value?.trim()) {
      errors.push("wait requires duration in milliseconds.");
    } else if (Number.isNaN(Number(step.value))) {
      errors.push("wait value must be numeric.");
    }
  }

  if (action === "assert") {
    if (!step.selector?.trim() && !step.value?.trim()) {
      errors.push("assert requires selector or value.");
    }
  }

  return errors;
}

export function collectStepValidationErrors(steps: ActionStep[]): StepValidationError[] {
  const errors: StepValidationError[] = [];
  steps.forEach((step, stepIndex) => {
    validateStep(step).forEach((message) => {
      errors.push({ stepIndex, message });
    });
  });
  return errors;
}

export function applyAutoFixForMessage(step: ActionStep, message: string): ActionStep {
  const nextStep: ActionStep = { ...step };

  if (message.includes("navigate requires a URL in value")) {
    nextStep.value = "https://";
    return nextStep;
  }

  if (message.includes("requires selector")) {
    if (nextStep.action === "fill" || nextStep.action === "select") {
      nextStep.selector = "input[name='q']";
    } else if (nextStep.action === "waitForSelector") {
      nextStep.selector = "[data-testid='target-element']";
    } else {
      nextStep.selector = "[data-testid='target-element']";
    }
    return nextStep;
  }

  if (message.includes("requires value") && (nextStep.action === "fill" || nextStep.action === "select")) {
    nextStep.value = nextStep.action === "select" ? "option-value" : "text value";
    return nextStep;
  }

  if (message.includes("wait requires duration") || message.includes("wait value must be numeric")) {
    nextStep.value = "500";
    return nextStep;
  }

  if (message.includes("assert requires selector or value")) {
    nextStep.selector = "[data-testid='target-element']";
    return nextStep;
  }

  return nextStep;
}

export function applyAutoFixesToAllSteps(steps: ActionStep[]): ActionStep[] {
  return steps.map((step) => {
    let fixed = { ...step };
    const messages = validateStep(step);
    for (const message of messages) {
      fixed = applyAutoFixForMessage(fixed, message);
    }
    return fixed;
  });
}

export function reorderSteps(steps: ActionStep[], fromIndex: number, toIndex: number): ActionStep[] {
  if (fromIndex === toIndex) return [...steps];
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= steps.length || toIndex >= steps.length) {
    return [...steps];
  }
  const reordered = [...steps];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  return reordered;
}

export function cloneSteps(steps: ActionStep[]): ActionStep[] {
  return steps.map((step) => ({ ...step }));
}
