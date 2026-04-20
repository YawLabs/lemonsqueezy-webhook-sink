import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { verifySignature } from "./verify.js";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifySignature", () => {
  const secret = "whsec_test";
  const body = '{"meta":{"event_name":"order_created"}}';

  it("accepts a valid signature", () => {
    assert.equal(verifySignature(body, sign(body, secret), secret), true);
  });

  it("accepts a valid signature over Buffer body", () => {
    assert.equal(verifySignature(Buffer.from(body), sign(body, secret), secret), true);
  });

  it("rejects tampered body", () => {
    const sig = sign(body, secret);
    assert.equal(verifySignature(`${body} `, sig, secret), false);
  });

  it("rejects wrong secret", () => {
    assert.equal(verifySignature(body, sign(body, secret), "whsec_other"), false);
  });

  it("rejects missing header", () => {
    assert.equal(verifySignature(body, null, secret), false);
  });

  it("rejects empty secret", () => {
    assert.equal(verifySignature(body, sign(body, ""), ""), false);
  });

  it("rejects signature of different length without timing leak", () => {
    assert.equal(verifySignature(body, "abc", secret), false);
  });
});
