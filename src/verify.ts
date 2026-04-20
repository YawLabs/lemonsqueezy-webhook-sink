import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a LemonSqueezy webhook signature.
 *
 * LemonSqueezy signs the raw request body with HMAC-SHA256 using your signing
 * secret and sends the hex digest in `X-Signature`. We recompute the HMAC over
 * the exact bytes we received and timing-safe-compare.
 *
 * Callers MUST pass the raw body exactly as received — any JSON re-serialization
 * will change the bytes and the signature will not match.
 */
export function verifySignature(rawBody: Buffer | string, headerSignature: string | null, secret: string): boolean {
  if (!headerSignature) return false;
  if (!secret) return false;

  const bodyBuf = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const expected = createHmac("sha256", secret).update(bodyBuf).digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(headerSignature, "utf8");

  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}
