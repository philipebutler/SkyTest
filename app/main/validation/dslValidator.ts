/**
 * DSL Validator (Issue #7 / SPEC §6.3)
 *
 * Validates a DSLPlan before execution:
 *  - version must be "1"
 *  - every action must be a known ActionVerb
 *  - required fields per verb must be present and non-empty
 *  - "navigate" value must be a valid URL
 *  - all errors are collected (no fail-fast)
 *
 * Policy enforcement (SPEC §8) is handled separately by
 * validateDSLPolicy(), which checks verbs against the active
 * ToolPolicy and returns the same DSLValidationResult shape.
 */

import {
  ADVANCED_ACTION_VERBS,
  CORE_ACTION_VERBS,
} from "../../shared/types";
import type { ActionStep, ActionVerb, DSLPlan, DSLValidationResult, ToolPolicy } from "../../shared/types";

type AnyRecord = Record<string, unknown>;

/** Full set of recognised ActionVerb values (SPEC §6.1). */
const VALID_VERBS = new Set<ActionVerb>([...CORE_ACTION_VERBS, ...ADVANCED_ACTION_VERBS]);
const ADVANCED_VERB_SET = new Set<ActionVerb>(ADVANCED_ACTION_VERBS);

/** Verbs permitted under each tool policy (SPEC §8). */
const POLICY_ALLOWED_VERBS: Record<ToolPolicy, Set<ActionVerb>> = {
  "read-only": new Set([
    "navigate", "screenshot", "assert", "wait", "waitForSelector", "waitForNavigation",
  ]),
  "safe-write": new Set([
    "navigate", "click", "fill", "select", "check", "uncheck", "hover",
    "wait", "waitForSelector", "waitForNavigation", "scroll", "screenshot", "assert",
  ]),
  full: new Set([...CORE_ACTION_VERBS, ...ADVANCED_ACTION_VERBS]),
};

const ACTION_ALIASES: Record<string, ActionVerb> = {
  goto: "navigate",
  press: "keyboardPress",
  "keyboard.press": "keyboardPress",
  "keyboard.type": "keyboardType",
  upload: "uploadFile",
  download: "downloadExpect",
  newTab: "tabNew",
  switchTab: "tabSwitch",
  switchFrame: "frameSelect",
};

function canonicalizeAction(action: string): string {
  return ACTION_ALIASES[action] ?? action;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Normalizes common LLM JSON variants into the canonical DSLPlan shape.
 *
 * Supported step aliases:
 * - verb -> action
 * - url  -> value (for navigate)
 * - selector -> value (for navigate, legacy/non-canonical output)
 * - text -> value
 * - name -> ignored (non-canonical screenshot metadata)
 */
export function normalizeDSLPlan(plan: unknown, fallbackIntent = "Generated plan"): unknown {
  if (typeof plan !== "object" || plan === null) return plan;

  const input = plan as AnyRecord;
  const rawSteps = Array.isArray(input.steps) ? (input.steps as unknown[]) : [];

  const steps: ActionStep[] = rawSteps.map((raw) => {
    if (typeof raw !== "object" || raw === null) {
      return { action: "" };
    }

    const step = raw as AnyRecord;
    const rawAction =
      (typeof step.action === "string" ? step.action : undefined) ??
      (typeof step.verb === "string" ? step.verb : undefined) ??
      "";
    const action = canonicalizeAction(rawAction);

    const params = asObject(step.params);
    const selector =
      (typeof step.selector === "string" ? step.selector : undefined) ??
      (typeof params.selector === "string" ? params.selector : undefined);
    const timeout =
      (typeof step.timeout === "number" ? step.timeout : undefined) ??
      (typeof params.timeoutMs === "number" ? params.timeoutMs : undefined);
    const optional =
      (typeof step.optional === "boolean" ? step.optional : undefined) ??
      (typeof params.optional === "boolean" ? params.optional : undefined);

    const targetCandidate = typeof step.target === "string" ? step.target : undefined;

    const valueCandidate =
      (typeof step.value === "string" ? step.value : undefined) ??
      (typeof step.text === "string" ? step.text : undefined) ??
      (typeof step.url === "string" ? step.url : undefined) ??
      (typeof params.value === "string" ? params.value : undefined) ??
      (typeof params.text === "string" ? params.text : undefined) ??
      (typeof params.url === "string" ? params.url : undefined) ??
      (action === "navigate" || action === "wait" || action === "fill" || action === "select"
        ? targetCandidate
        : undefined);

    const selectorCandidate =
      selector ??
      (action === "click" ||
      action === "check" ||
      action === "uncheck" ||
      action === "hover" ||
      action === "waitForSelector" ||
      action === "scroll" ||
      action === "uploadFile" ||
      action === "assert"
        ? targetCandidate
        : undefined);

    const normalizedValue = valueCandidate ?? (action === "navigate" ? selector : undefined);

    return {
      action,
      selector: selectorCandidate,
      value: normalizedValue,
      params,
      timeout,
      optional,
    };
  });

  const intent =
    (typeof input.intent === "string" && input.intent.trim() !== ""
      ? input.intent
      : fallbackIntent).trim();

  return {
    version: "1",
    intent,
    steps,
  } satisfies DSLPlan;
}

/**
 * Returns true if the string looks like a valid absolute URL.
 * Accepts http: and https: schemes only (file: and others are intentionally excluded).
 */
function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates a single ActionStep and pushes errors into the provided array.
 * @param step       - The step to validate.
 * @param stepIndex  - 0-based index used in error messages.
 * @param errors     - Mutable errors array to push into.
 */
function validateStep(
  step: ActionStep,
  stepIndex: number,
  errors: DSLValidationResult["errors"]
): void {
  const push = (message: string) => errors.push({ stepIndex, message });

  // Unknown action verb
  if (!VALID_VERBS.has(step.action as ActionVerb)) {
    push(`Unknown action "${step.action}". Allowed verbs: ${[...VALID_VERBS].join(", ")}.`);
    // No point checking required fields if the verb is unknown
    return;
  }

  const verb = step.action as ActionVerb;
  const selector = step.selector?.trim();
  const value = step.value?.trim();
  const params = asObject(step.params);
  const requireParamsString = (key: string, message: string) => {
    if (typeof params[key] !== "string" || String(params[key]).trim() === "") {
      push(message);
    }
  };
  const requireParamsOneOf = (keys: string[], message: string) => {
    const ok = keys.some((key) => typeof params[key] === "string" && String(params[key]).trim() !== "")
      || keys.some((key) => typeof params[key] === "number");
    if (!ok) {
      push(message);
    }
  };

  switch (verb) {
    case "navigate":
      if (!value) {
        push(`"navigate" requires a non-empty "value" (URL).`);
      } else if (!isValidUrl(value)) {
        push(`"navigate" value must be a valid http/https URL, got "${value}".`);
      }
      break;

    case "click":
    case "check":
    case "uncheck":
    case "hover":
    case "waitForSelector":
    case "scroll":
      if (!selector) {
        push(`"${verb}" requires a non-empty "selector".`);
      }
      break;

    case "fill":
    case "select":
      if (!selector) {
        push(`"${verb}" requires a non-empty "selector".`);
      }
      if (value === undefined || value === "") {
        push(`"${verb}" requires a non-empty "value".`);
      }
      break;

    case "wait":
      if (!value) {
        push(`"wait" requires a non-empty "value" (duration in ms).`);
      } else if (isNaN(Number(value))) {
        push(`"wait" value must be a numeric duration in ms, got "${value}".`);
      }
      break;

    case "assert":
      if (!selector && !value) {
        push(`"assert" requires at least one of "selector" or "value".`);
      }
      break;

    // These verbs have no required fields beyond "action"
    case "waitForNavigation":
    case "screenshot":
      break;

    case "keyboardType":
      requireParamsString("text", '"keyboardType" requires params.text.');
      break;
    case "keyboardPress":
    case "keyboardDown":
    case "keyboardUp":
      requireParamsString("key", `"${verb}" requires params.key.`);
      break;
    case "frameSelect":
      requireParamsOneOf(["selector", "name", "url"], '"frameSelect" requires one of params.selector, params.name, or params.url.');
      break;
    case "frameClear":
      break;
    case "tabNew":
      if (params.url !== undefined && typeof params.url !== "string") {
        push('"tabNew" params.url must be a string when provided.');
      }
      break;
    case "tabSwitch":
      if (typeof params.index !== "number" && typeof params.titleIncludes !== "string" && typeof params.urlIncludes !== "string") {
        push('"tabSwitch" requires params.index or params.titleIncludes or params.urlIncludes.');
      }
      break;
    case "tabClose":
      if (params.index !== undefined && typeof params.index !== "number") {
        push('"tabClose" params.index must be a number when provided.');
      }
      break;
    case "dialogExpect":
      if (params.type !== undefined && !["alert", "confirm", "prompt"].includes(String(params.type))) {
        push('"dialogExpect" params.type must be alert, confirm, or prompt.');
      }
      break;
    case "dialogAccept":
    case "dialogDismiss":
      break;
    case "uploadFile":
      if (!selector) {
        push('"uploadFile" requires a non-empty "selector".');
      }
      if (
        !(typeof params.files === "string" && params.files.trim() !== "") &&
        !(Array.isArray(params.files) && params.files.length > 0 && params.files.every((f) => typeof f === "string" && f.trim() !== ""))
      ) {
        push('"uploadFile" requires params.files as a file path string or non-empty string array.');
      }
      break;
    case "downloadExpect":
      break;
    case "networkWaitForRequest":
    case "networkWaitForResponse":
      if (typeof params.urlIncludes !== "string" && typeof params.urlRegex !== "string") {
        push(`"${verb}" requires params.urlIncludes or params.urlRegex.`);
      }
      break;
    case "storageSet":
      requireParamsString("key", '"storageSet" requires params.key.');
      if (params.value === undefined) {
        push('"storageSet" requires params.value.');
      }
      break;
    case "storageRemove":
      requireParamsString("key", '"storageRemove" requires params.key.');
      break;
    case "storageClear":
      break;
    case "cookieSet":
      requireParamsString("name", '"cookieSet" requires params.name.');
      requireParamsString("value", '"cookieSet" requires params.value.');
      if (typeof params.url !== "string" && typeof params.domain !== "string") {
        push('"cookieSet" requires params.url or params.domain.');
      }
      break;
    case "cookieDelete":
      requireParamsString("name", '"cookieDelete" requires params.name.');
      break;
    case "cookieClear":
      break;
  }
}

/**
 * Validates a DSLPlan against the schema (SPEC §6.3).
 *
 * Checks:
 *  - version is "1"
 *  - steps is a non-empty array
 *  - each step passes per-verb field validation
 *
 * Does NOT enforce tool policy — use `validateDSLPolicy` for that.
 */
export function validateDSL(plan: unknown): DSLValidationResult {
  const errors: DSLValidationResult["errors"] = [];

  if (typeof plan !== "object" || plan === null) {
    return { valid: false, errors: [{ stepIndex: -1, message: "DSL must be a JSON object." }] };
  }

  const p = plan as Record<string, unknown>;

  if (p["version"] !== "1") {
    errors.push({ stepIndex: -1, message: `DSL "version" must be "1", got "${String(p["version"])}".` });
  }

  if (typeof p["intent"] !== "string" || (p["intent"] as string).trim() === "") {
    errors.push({ stepIndex: -1, message: `DSL "intent" must be a non-empty string.` });
  }

  if (!Array.isArray(p["steps"])) {
    errors.push({ stepIndex: -1, message: `DSL "steps" must be an array.` });
    return { valid: errors.length === 0, errors };
  }

  if ((p["steps"] as unknown[]).length === 0) {
    errors.push({ stepIndex: -1, message: `DSL "steps" must contain at least one step.` });
  }

  for (let i = 0; i < (p["steps"] as unknown[]).length; i++) {
    const step = (p["steps"] as unknown[])[i];
    if (typeof step !== "object" || step === null) {
      errors.push({ stepIndex: i, message: `Step at index ${i} must be a JSON object.` });
      continue;
    }
    validateStep(step as ActionStep, i, errors);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Enforces tool policy against an already schema-valid DSLPlan (SPEC §8).
 * Policy violations are returned as validation errors so they surface before execution.
 *
 * This should be called after `validateDSL` returns valid=true.
 */
export function validateDSLPolicy(plan: DSLPlan, policy: ToolPolicy): DSLValidationResult {
  const allowed = POLICY_ALLOWED_VERBS[policy];
  const errors: DSLValidationResult["errors"] = [];

  plan.steps.forEach((step, i) => {
    const action = canonicalizeAction(step.action);
    if (!allowed.has(action as ActionVerb)) {
      errors.push({
        stepIndex: i,
        message: `Action "${step.action}" is not permitted under the "${policy}" tool policy.`,
      });
      return;
    }

    if (policy !== "full" && ADVANCED_VERB_SET.has(action as ActionVerb)) {
      errors.push({
        stepIndex: i,
        message: `Action "${step.action}" requires the "full" tool policy.`,
      });
    }
  });

  return { valid: errors.length === 0, errors };
}
