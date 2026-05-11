import { createHmac, timingSafeEqual } from "node:crypto";

// Match karyl-chan's signing scheme byte-for-byte. The receiving side
// MUST hash the exact same string we hash here, so any drift in this
// file (version prefix, separator, body bytes) breaks signature
// verification on both directions.
//
// Reference: karyl-chan/src/utils/hmac.ts (signBodyV0 / verifyInboundSignature)
export const SIGNATURE_VERSION = "v0";
export const SIGNATURE_VERSION_V1 = "v1";
export const SIGNATURE_HEADER = "x-karyl-signature";
export const SIGNATURE_HEADER_V1 = "x-karyl-signature-v1";
export const TIMESTAMP_HEADER = "x-karyl-timestamp";
export const REPLAY_WINDOW_SECONDS = 300;

/** Compute the hex SHA-256 HMAC over `v0:<ts>:<body>`. */
export function sign(secret: string, body: string, ts: string): string {
  return createHmac("sha256", secret)
    .update(`${SIGNATURE_VERSION}:${ts}:${body}`)
    .digest("hex");
}

/** Compute the hex SHA-256 HMAC over `v1:<METHOD>:<path>:<ts>:<body>`. */
export function signV1(
  secret: string,
  method: string,
  path: string,
  ts: string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(`${SIGNATURE_VERSION_V1}:${method.toUpperCase()}:${path}:${ts}:${body}`)
    .digest("hex");
}

/** Format the value that goes into the X-Karyl-Signature header. */
export function formatSignatureHeader(hex: string): string {
  return `${SIGNATURE_VERSION}=${hex}`;
}

/**
 * Constant-time signature check. The header must arrive as
 * `v0=<hex>` and decode to the same length as our recomputed hex —
 * otherwise we reject without ever calling timingSafeEqual (which
 * throws on length mismatch).
 *
 * @deprecated Prefer the named `verifyV0()` for forward-compatibility.
 * This export is kept for backward compatibility with existing callers.
 */
export function verify(
  secret: string,
  body: string,
  ts: string,
  presented: string,
): boolean {
  const expected = formatSignatureHeader(sign(secret, body, ts));
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Versioned alias for v0 signature verification — use this in new code.
 * When v1 verification is introduced, callers can migrate to `verifyV1`
 * without touching existing `verifyV0` callsites.
 *
 * The `presented` string must be the full header value: `v0=<hex>`.
 */
export function verifyV0(opts: {
  secret: string;
  body: string;
  ts: string;
  presented: string;
}): boolean {
  return verify(opts.secret, opts.body, opts.ts, opts.presented);
}

/**
 * v1 signature verification — binds HTTP method + URL path into the
 * signed payload, preventing cross-endpoint replay attacks.
 *
 * The `presented` string must be the full header value: `v1=<hex>`.
 */
export function verifyV1(opts: {
  secret: string;
  method: string;
  path: string;
  body: string;
  ts: string;
  presented: string;
}): boolean {
  const expected = `${SIGNATURE_VERSION_V1}=${signV1(opts.secret, opts.method, opts.path, opts.ts, opts.body)}`;
  const a = Buffer.from(opts.presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** True if `ts` (unix seconds, string) is within the replay window of now. */
export function isFreshTimestamp(ts: string, nowSec: number): boolean {
  const n = Number.parseInt(ts, 10);
  if (!Number.isFinite(n)) return false;
  return Math.abs(nowSec - n) <= REPLAY_WINDOW_SECONDS;
}
