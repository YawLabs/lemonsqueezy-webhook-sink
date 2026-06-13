import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePort, requireEnv } from "./env.js";

describe("parsePort", () => {
  it("accepts the index.ts default '8787'", () => {
    assert.equal(parsePort("8787"), 8787);
  });

  it("accepts the in-range boundaries 1 and 65535", () => {
    assert.equal(parsePort("1"), 1);
    assert.equal(parsePort("65535"), 65535);
  });

  it("accepts numeric strings with surrounding whitespace (Number coercion)", () => {
    // Number(" 3000 ") === 3000, and 3000 is an in-range integer.
    assert.equal(parsePort(" 3000 "), 3000);
  });

  it("rejects 0 (below range)", () => {
    assert.throws(() => parsePort("0"), /PORT must be an integer in \[1, 65535\]/);
  });

  it("rejects 65536 (above range)", () => {
    assert.throws(() => parsePort("65536"), /PORT must be an integer in \[1, 65535\]/);
  });

  it("rejects a negative port", () => {
    assert.throws(() => parsePort("-1"), /PORT must be an integer in \[1, 65535\]/);
  });

  it("rejects a non-integer (fractional) value", () => {
    assert.throws(() => parsePort("3000.5"), /PORT must be an integer in \[1, 65535\]/);
  });

  it("rejects a non-numeric string", () => {
    assert.throws(() => parsePort("abc"), /PORT must be an integer in \[1, 65535\]/);
  });

  it("rejects an empty string (Number('') === 0, out of range)", () => {
    assert.throws(() => parsePort(""), /PORT must be an integer in \[1, 65535\]/);
  });

  it("rejects whitespace-only (Number('  ') === 0, out of range)", () => {
    assert.throws(() => parsePort("   "), /PORT must be an integer in \[1, 65535\]/);
  });

  it("rejects 'NaN'-producing input like 'Infinity'", () => {
    assert.throws(() => parsePort("Infinity"), /PORT must be an integer in \[1, 65535\]/);
  });

  it("includes the offending raw value (JSON-quoted) in the error", () => {
    assert.throws(() => parsePort("nope"), /got: "nope"/);
  });
});

describe("requireEnv", () => {
  it("returns the value when present and non-blank", () => {
    assert.equal(requireEnv("MY_SECRET", { MY_SECRET: "whsec_live" }), "whsec_live");
  });

  it("returns the raw (un-trimmed) value when it has non-blank content", () => {
    // The validator only rejects fully-blank values; it does not trim the result.
    assert.equal(requireEnv("MY_SECRET", { MY_SECRET: "  padded  " }), "  padded  ");
  });

  it("throws when the var is absent", () => {
    assert.throws(() => requireEnv("MY_SECRET", {}), /MY_SECRET environment variable is required/);
  });

  it("throws when the var is an empty string", () => {
    assert.throws(() => requireEnv("MY_SECRET", { MY_SECRET: "" }), /MY_SECRET environment variable is required/);
  });

  it("throws when the var is whitespace-only", () => {
    assert.throws(() => requireEnv("MY_SECRET", { MY_SECRET: "   " }), /MY_SECRET environment variable is required/);
  });

  it("throws when the var is a tab/newline-only string", () => {
    assert.throws(() => requireEnv("MY_SECRET", { MY_SECRET: "\t\n" }), /MY_SECRET environment variable is required/);
  });

  it("interpolates the requested name into the error message", () => {
    assert.throws(
      () => requireEnv("LEMONSQUEEZY_SIGNING_SECRET", {}),
      /LEMONSQUEEZY_SIGNING_SECRET environment variable is required/,
    );
  });
});
