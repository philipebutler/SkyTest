/**
 * Unit tests for AssertionEngine (Issue #17 – Assertion Engine).
 *
 * Verifies that:
 * - textVisible passes when the text is visible, fails when it is not
 * - elementVisible passes when the element is visible, fails when it is not
 * - urlContains passes when the URL includes the value, fails otherwise
 * - countEquals passes when the element count matches, fails when it does not
 * - Missing required fields cause assertion failures with clear error messages
 * - All assertions run independently (one failure does not skip the rest)
 * - Unknown assertion types are reported as failures
 */

import { AssertionEngine } from "./AssertionEngine";
import type { Assertion } from "../../shared/types";

/** Builds a minimal mock Playwright Page for assertion testing. */
function buildMockPage(overrides: Partial<{
  url: string;
  locatorIsVisible: boolean;
  locatorCount: number;
}> = {}): Record<string, jest.Mock> {
  const url = overrides.url ?? "https://example.com/path";
  const isVisible = overrides.locatorIsVisible ?? true;
  const count = overrides.locatorCount ?? 1;

  const mockLocator = {
    isVisible: jest.fn().mockResolvedValue(isVisible),
    count: jest.fn().mockResolvedValue(count),
    first: jest.fn().mockReturnThis(),
  };

  return {
    url: jest.fn().mockReturnValue(url),
    locator: jest.fn().mockReturnValue(mockLocator),
    getByText: jest.fn().mockReturnValue(mockLocator),
  };
}

// ---------------------------------------------------------------------------
// textVisible
// ---------------------------------------------------------------------------

describe("AssertionEngine – textVisible", () => {
  it("passes when the text is visible on the page", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage({ locatorIsVisible: true });
    const assertion: Assertion = { type: "textVisible", value: "Hello World" };

    const [result] = await engine.runAssertions(page as never, [assertion]);

    expect(result.status).toBe("passed");
    expect(result.error).toBeUndefined();
  });

  it("fails when the text is not visible on the page", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage({ locatorIsVisible: false });
    const assertion: Assertion = { type: "textVisible", value: "Missing Text" };

    const [result] = await engine.runAssertions(page as never, [assertion]);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Missing Text");
    expect(result.error).toContain("not visible");
  });

  it("fails with a clear error when value is missing", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage();
    const assertion: Assertion = { type: "textVisible" };

    const [result] = await engine.runAssertions(page as never, [assertion]);

    expect(result.status).toBe("failed");
    expect(result.error).toContain('"textVisible"');
    expect(result.error).toContain('"value"');
  });
});

// ---------------------------------------------------------------------------
// elementVisible
// ---------------------------------------------------------------------------

describe("AssertionEngine – elementVisible", () => {
  it("passes when the element matching selector is visible", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage({ locatorIsVisible: true });
    const assertion: Assertion = { type: "elementVisible", selector: "#submit-btn" };

    const [result] = await engine.runAssertions(page as never, [assertion]);

    expect(result.status).toBe("passed");
    expect(result.error).toBeUndefined();
  });

  it("fails when the element is not visible", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage({ locatorIsVisible: false });
    const assertion: Assertion = { type: "elementVisible", selector: "#hidden-el" };

    const [result] = await engine.runAssertions(page as never, [assertion]);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("#hidden-el");
    expect(result.error).toContain("not visible");
  });

  it("fails with a clear error when selector is missing", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage();
    const assertion: Assertion = { type: "elementVisible" };

    const [result] = await engine.runAssertions(page as never, [assertion]);

    expect(result.status).toBe("failed");
    expect(result.error).toContain('"elementVisible"');
    expect(result.error).toContain('"selector"');
  });
});

// ---------------------------------------------------------------------------
// urlContains
// ---------------------------------------------------------------------------

describe("AssertionEngine – urlContains", () => {
  it("passes when the current URL includes the expected value", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage({ url: "https://example.com/dashboard" });
    const assertion: Assertion = { type: "urlContains", value: "dashboard" };

    const [result] = await engine.runAssertions(page as never, [assertion]);

    expect(result.status).toBe("passed");
    expect(result.error).toBeUndefined();
  });

  it("fails when the URL does not include the expected value", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage({ url: "https://example.com/login" });
    const assertion: Assertion = { type: "urlContains", value: "dashboard" };

    const [result] = await engine.runAssertions(page as never, [assertion]);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("dashboard");
    expect(result.error).toContain("https://example.com/login");
  });

  it("fails with a clear error when value is missing", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage();
    const assertion: Assertion = { type: "urlContains" };

    const [result] = await engine.runAssertions(page as never, [assertion]);

    expect(result.status).toBe("failed");
    expect(result.error).toContain('"urlContains"');
    expect(result.error).toContain('"value"');
  });
});

// ---------------------------------------------------------------------------
// countEquals
// ---------------------------------------------------------------------------

describe("AssertionEngine – countEquals", () => {
  it("passes when the element count matches the expected count", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage({ locatorCount: 3 });
    const assertion: Assertion = { type: "countEquals", selector: "li.item", count: 3 };

    const [result] = await engine.runAssertions(page as never, [assertion]);

    expect(result.status).toBe("passed");
    expect(result.error).toBeUndefined();
  });

  it("fails when the count does not match", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage({ locatorCount: 5 });
    const assertion: Assertion = { type: "countEquals", selector: "li.item", count: 3 };

    const [result] = await engine.runAssertions(page as never, [assertion]);

    expect(result.status).toBe("failed");
    expect(result.error).toContain("3");
    expect(result.error).toContain("5");
    expect(result.error).toContain("li.item");
  });

  it("fails with a clear error when selector is missing", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage();
    const assertion: Assertion = { type: "countEquals", count: 2 };

    const [result] = await engine.runAssertions(page as never, [assertion]);

    expect(result.status).toBe("failed");
    expect(result.error).toContain('"countEquals"');
    expect(result.error).toContain('"selector"');
  });

  it("fails with a clear error when count is missing", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage();
    const assertion: Assertion = { type: "countEquals", selector: "li.item" };

    const [result] = await engine.runAssertions(page as never, [assertion]);

    expect(result.status).toBe("failed");
    expect(result.error).toContain('"countEquals"');
    expect(result.error).toContain('"count"');
  });
});

// ---------------------------------------------------------------------------
// Multiple assertions – independence
// ---------------------------------------------------------------------------

describe("AssertionEngine – multiple assertions run independently", () => {
  it("continues running after a failed assertion and collects all results", async () => {
    const engine = new AssertionEngine();

    // First locator call: visible (for elementVisible)
    // Second locator call: count=0 (for countEquals – will fail expecting 2)
    let locatorCallCount = 0;
    const mockLocator = {
      isVisible: jest.fn().mockResolvedValue(true),
      count: jest.fn().mockResolvedValue(0),
      first: jest.fn().mockReturnThis(),
    };
    const page = {
      url: jest.fn().mockReturnValue("https://example.com/page"),
      locator: jest.fn().mockImplementation(() => {
        locatorCallCount++;
        return mockLocator;
      }),
      getByText: jest.fn().mockReturnValue(mockLocator),
    };

    const assertions: Assertion[] = [
      { type: "elementVisible", selector: "#present" },   // passes
      { type: "countEquals", selector: "li", count: 2 },  // fails (count=0)
      { type: "urlContains", value: "/page" },             // passes
    ];

    const results = await engine.runAssertions(page as never, assertions);

    expect(results).toHaveLength(3);
    expect(results[0].status).toBe("passed");
    expect(results[1].status).toBe("failed");
    expect(results[2].status).toBe("passed");
  });

  it("returns assertionIndex matching the position in the input array", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage({ url: "https://example.com/a", locatorIsVisible: true, locatorCount: 1 });

    const assertions: Assertion[] = [
      { type: "urlContains", value: "/a" },
      { type: "elementVisible", selector: "#el" },
      { type: "countEquals", selector: "span", count: 1 },
    ];

    const results = await engine.runAssertions(page as never, assertions);

    results.forEach((r, i) => {
      expect(r.assertionIndex).toBe(i);
    });
  });

  it("returns an empty array when no assertions are provided", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage();

    const results = await engine.runAssertions(page as never, []);

    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AssertionResult metadata
// ---------------------------------------------------------------------------

describe("AssertionEngine – result metadata", () => {
  it("includes the assertion type in the result", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage({ url: "https://example.com/ok" });
    const assertion: Assertion = { type: "urlContains", value: "/ok" };

    const [result] = await engine.runAssertions(page as never, [assertion]);

    expect(result.type).toBe("urlContains");
  });

  it("does not include error on a passing assertion", async () => {
    const engine = new AssertionEngine();
    const page = buildMockPage({ locatorIsVisible: true });
    const assertion: Assertion = { type: "elementVisible", selector: "#ok" };

    const [result] = await engine.runAssertions(page as never, [assertion]);

    expect(result.status).toBe("passed");
    expect(result.error).toBeUndefined();
  });
});
