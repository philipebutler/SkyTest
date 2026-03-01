/**
 * Assertion Engine (Issue #17 / SPEC §5.2)
 *
 * Executes deterministic assertions against a live Playwright Page and
 * returns a structured result per assertion.  Supported assertion types:
 *
 *  - textVisible    – checks that specified text is visible on the page
 *  - elementVisible – checks that an element matching selector is visible
 *  - urlContains    – checks that the current URL includes the specified string
 *  - countEquals    – checks that the count of elements matching selector equals count
 *
 * Assertions determine pass/fail independently of the step results and are
 * always run after all DSL steps have completed.
 */

import type { Page } from "playwright";
import type { Assertion, AssertionResult } from "../../shared/types";

export class AssertionEngine {
  /**
   * Runs all assertions sequentially against the given page.
   * Each assertion is evaluated independently; a failure does not stop
   * subsequent assertions from running.
   */
  async runAssertions(page: Page, assertions: Assertion[]): Promise<AssertionResult[]> {
    const results: AssertionResult[] = [];
    for (let i = 0; i < assertions.length; i++) {
      results.push(await this.runOne(page, assertions[i], i));
    }
    return results;
  }

  private async runOne(page: Page, assertion: Assertion, index: number): Promise<AssertionResult> {
    try {
      await this.evaluate(page, assertion);
      return { assertionIndex: index, type: assertion.type, status: "passed" };
    } catch (err) {
      return {
        assertionIndex: index,
        type: assertion.type,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async evaluate(page: Page, assertion: Assertion): Promise<void> {
    switch (assertion.type) {
      case "textVisible": {
        if (!assertion.value) {
          throw new Error(`"textVisible" assertion requires a "value" (the text to find).`);
        }
        const visible = await page.getByText(assertion.value).first().isVisible();
        if (!visible) {
          throw new Error(`Text "${assertion.value}" is not visible on the page.`);
        }
        break;
      }

      case "elementVisible": {
        if (!assertion.selector) {
          throw new Error(`"elementVisible" assertion requires a "selector".`);
        }
        const visible = await page.locator(assertion.selector).isVisible();
        if (!visible) {
          throw new Error(`Element "${assertion.selector}" is not visible.`);
        }
        break;
      }

      case "urlContains": {
        if (!assertion.value) {
          throw new Error(`"urlContains" assertion requires a "value".`);
        }
        const url = page.url();
        if (!url.includes(assertion.value)) {
          throw new Error(`URL "${url}" does not contain "${assertion.value}".`);
        }
        break;
      }

      case "countEquals": {
        if (!assertion.selector) {
          throw new Error(`"countEquals" assertion requires a "selector".`);
        }
        if (assertion.count === undefined) {
          throw new Error(`"countEquals" assertion requires a "count".`);
        }
        const count = await page.locator(assertion.selector).count();
        if (count !== assertion.count) {
          throw new Error(
            `Expected ${assertion.count} element(s) matching "${assertion.selector}", found ${count}.`
          );
        }
        break;
      }

      default:
        throw new Error(`Unknown assertion type: "${(assertion as Assertion).type}".`);
    }
  }
}
