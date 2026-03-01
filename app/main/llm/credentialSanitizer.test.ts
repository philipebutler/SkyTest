/**
 * Unit tests for credentialSanitizer (Issue #14 – Credential Safety Enforcement).
 */

import { redactSecrets, REDACTED } from "./credentialSanitizer";

describe("redactSecrets – URL-embedded credentials", () => {
  it("redacts user:pass in an http URL", () => {
    const result = redactSecrets("https://admin:s3cr3t@example.com/path");
    expect(result).not.toContain("admin");
    expect(result).not.toContain("s3cr3t");
    expect(result).toContain(`https://${REDACTED}@example.com/path`);
  });

  it("redacts user:pass in a postgresql URL", () => {
    const result = redactSecrets("postgresql://user:password@db.example.com:5432/mydb");
    expect(result).not.toContain("password");
    expect(result).toContain(`postgresql://${REDACTED}@db.example.com:5432/mydb`);
  });

  it("leaves a URL without credentials untouched", () => {
    const url = "https://example.com/some/path?q=1";
    expect(redactSecrets(url)).toBe(url);
  });
});

describe("redactSecrets – Authorization headers", () => {
  it("redacts Bearer token", () => {
    const result = redactSecrets("Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.abc.def");
    expect(result).not.toContain("eyJhbGciOiJSUzI1NiJ9");
    expect(result).toContain(`Authorization: Bearer ${REDACTED}`);
  });

  it("redacts Basic auth value", () => {
    const result = redactSecrets("Authorization: Basic dXNlcjpwYXNz");
    expect(result).not.toContain("dXNlcjpwYXNz");
    expect(result).toContain(`Authorization: Basic ${REDACTED}`);
  });

  it("redacts Token auth value", () => {
    const result = redactSecrets("Authorization: Token abc123secrettoken");
    expect(result).not.toContain("abc123secrettoken");
    expect(result).toContain(`Authorization: Token ${REDACTED}`);
  });

  it("is case-insensitive for the header name", () => {
    const result = redactSecrets("authorization: bearer mytoken123");
    expect(result).not.toContain("mytoken123");
  });
});

describe("redactSecrets – JSON credential fields", () => {
  it("redacts password field value", () => {
    const result = redactSecrets('{"username":"alice","password":"s3cur3P@ss"}');
    expect(result).not.toContain("s3cur3P@ss");
    expect(result).toContain(REDACTED);
  });

  it("redacts api_key field value", () => {
    const result = redactSecrets('{"api_key":"sk-abc123xyz456"}');
    expect(result).not.toContain("sk-abc123xyz456");
  });

  it("redacts secret field value", () => {
    const result = redactSecrets('{"secret":"topsecretvalue"}');
    expect(result).not.toContain("topsecretvalue");
  });

  it("redacts client_secret field value", () => {
    const result = redactSecrets('{"client_secret":"very-secret-client-value"}');
    expect(result).not.toContain("very-secret-client-value");
  });

  it("redacts token field value", () => {
    const result = redactSecrets('{"token":"myauthtoken123"}');
    expect(result).not.toContain("myauthtoken123");
  });

  it("leaves short values (≤2 chars) untouched to avoid over-redaction", () => {
    // Values with < 3 chars are not considered secrets (e.g. empty or 2-char test values)
    const result = redactSecrets('{"password":"ab"}');
    expect(result).toContain('"password"');
    expect(result).toContain('"ab"');
  });
});

describe("redactSecrets – query-string credential parameters", () => {
  it("redacts password query parameter", () => {
    const result = redactSecrets("https://example.com/login?user=alice&password=s3cr3t");
    expect(result).not.toContain("s3cr3t");
    expect(result).toContain(`password=${REDACTED}`);
  });

  it("redacts token query parameter", () => {
    const result = redactSecrets("https://api.example.com/data?token=abc123&format=json");
    expect(result).not.toContain("abc123");
    expect(result).toContain(`token=${REDACTED}`);
  });

  it("redacts api_key query parameter", () => {
    const result = redactSecrets("https://api.example.com/v1/items?api_key=myapikey123");
    expect(result).not.toContain("myapikey123");
  });

  it("leaves unrelated query parameters untouched", () => {
    const result = redactSecrets("https://example.com/search?q=hello&lang=en");
    expect(result).toBe("https://example.com/search?q=hello&lang=en");
  });
});

describe("redactSecrets – combined / multi-pattern strings", () => {
  it("redacts multiple credential patterns in one string", () => {
    const input =
      'POST https://user:pass@api.example.com/login\nAuthorization: Bearer tok123\n{"password":"secret456"}';
    const result = redactSecrets(input);
    // URL credential removed
    expect(result).toContain(`https://${REDACTED}@api.example.com/login`);
    // Bearer token removed
    expect(result).not.toContain("tok123");
    // JSON password value removed
    expect(result).not.toContain("secret456");
  });
});

describe("redactSecrets – safe inputs", () => {
  it("returns plain text without credentials unchanged", () => {
    const text = "Navigate to the home page and click the login button";
    expect(redactSecrets(text)).toBe(text);
  });

  it("handles an empty string", () => {
    expect(redactSecrets("")).toBe("");
  });
});
