/**
 * Pure environment-variable validators.
 *
 * Extracted from index.ts so they can be unit-tested without triggering
 * index.ts's import-time side effects (reading env, opening the DB, starting
 * the HTTP server, and registering signal handlers).
 */

/**
 * Read a required env var by name, rejecting absent / empty / whitespace-only
 * values. Returns the raw (un-trimmed) value when present and non-blank.
 */
export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const v = env[name];
  if (!v || v.trim() === "") throw new Error(`${name} environment variable is required`);
  return v;
}

/**
 * Parse a PORT string into an integer in [1, 65535], rejecting anything that
 * is not an integer in range.
 */
export function parsePort(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`PORT must be an integer in [1, 65535], got: ${JSON.stringify(raw)}`);
  }
  return n;
}
