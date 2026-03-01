/**
 * Credential Sanitizer (Issue #14 – Credential Safety Enforcement / SPEC §1.3).
 *
 * Provides a single `redactSecrets()` function that replaces known credential
 * patterns with the literal string "[REDACTED]".  It must be applied to every
 * string before it is:
 *   1. Embedded in an LLM prompt (LLMRequest.systemPrompt / LLMRequest.userMessage)
 *   2. Written to any log line
 *
 * Patterns covered:
 *   - URL-embedded credentials  (scheme://user:pass@host)
 *   - HTTP Authorization header values  (Bearer / Basic / Token / Digest)
 *   - JSON / object credential fields   (password, secret, api_key, token, …)
 *   - Query-string credential parameters
 */

export const REDACTED = "[REDACTED]";

/**
 * Ordered list of [pattern, replacement] pairs applied left-to-right.
 * Each pattern is re-created per call via the function factory to reset the
 * lastIndex of global regexes and keep behaviour predictable.
 */
const PATTERNS: Array<[RegExp, string]> = [
  // URL-embedded credentials: scheme://user:pass@host
  [/([a-zA-Z][a-zA-Z0-9+\-.]*:\/\/)[^@/\s]+:[^@/\s]+@/g, `$1${REDACTED}@`],

  // HTTP Authorization header value (Bearer <token>, Basic <b64>, …)
  [/(Authorization\s*[=:]\s*(?:Bearer|Basic|Token|Digest)\s+)\S+/gi, `$1${REDACTED}`],

  // JSON / structured credential fields:  "password": "s3cr3t"
  [
    /("(?:password|passwd|secret|api_?key|apikey|token|access_token|refresh_token|client_secret|private_key|auth_token)"\s*:\s*)"[^"]{3,}"/gi,
    `$1"${REDACTED}"`,
  ],

  // Query-string / form-encoded credential parameters:  ?password=s3cr3t
  [
    /([?&](?:password|passwd|secret|api_?key|apikey|token|access_token|refresh_token|client_secret)=)[^&\s#]*/gi,
    `$1${REDACTED}`,
  ],
];

/**
 * Returns a copy of `text` with known credential patterns replaced by
 * `"[REDACTED]"`.  Non-string values are returned unchanged.
 */
export function redactSecrets(text: unknown): string {
  if (typeof text !== "string") return String(text);
  return PATTERNS.reduce((s, [pattern, replacement]) => s.replace(pattern, replacement), text);
}
