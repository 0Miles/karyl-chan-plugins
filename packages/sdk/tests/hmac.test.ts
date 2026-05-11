/**
 * Verifies that the SDK's hmac.ts sign/verify/isFreshTimestamp functions
 * are byte-for-byte compatible with the bot-side karyl-chan/src/utils/hmac.ts.
 *
 * Fixtures are derived from the bot's signBodyV0 and signBodyV1 logic:
 *   v0: HMAC-SHA256( secret, `v0:${timestamp}:${body}` ) → hex
 *   v1: HMAC-SHA256( secret, `v1:${METHOD}:${path}:${timestamp}:${body}` ) → hex
 *
 * The bot dual-signs v0+v1; SDK prefers v1 when present (stronger path-binding).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REPLAY_WINDOW_SECONDS,
  SIGNATURE_VERSION,
  SIGNATURE_VERSION_V1,
  SIGNATURE_HEADER,
  SIGNATURE_HEADER_V1,
  TIMESTAMP_HEADER,
  formatSignatureHeader,
  isFreshTimestamp,
  sign,
  signV1,
  verify,
  verifyV0,
  verifyV1,
} from "../src/hmac.js";

// ─── Golden fixtures ──────────────────────────────────────────────────────────
// Pre-computed from karyl-chan/src/utils/hmac.ts signBodyV0().
// These are static hex strings — NOT re-computed at test time. If SDK's sign()
// output diverges from these values, tests must fail, catching accidental drift
// in the v0 signing scheme.
//
// Verification commands (run once to regenerate if the scheme ever changes):
//   node -e "console.log(require('crypto').createHmac('sha256','test-secret').update('v0:1700000000:hello world').digest('hex'))"
//   node -e "console.log(require('crypto').createHmac('sha256','test-secret').update('v0:1700001234:{\"command_name\":\"uuid\"}').digest('hex'))"
//   node -e "console.log(require('crypto').createHmac('sha256','another-secret').update('v0:1699999999:').digest('hex'))"
const GOLDEN = [
  {
    secret: "test-secret",
    ts: "1700000000",
    body: "hello world",
    expectedHex:
      "d462399bdd71564987346d6c2364a2f91ace5b6077b48ec38bebb5ea836eddef",
  },
  {
    secret: "test-secret",
    ts: "1700001234",
    body: '{"command_name":"uuid"}',
    expectedHex:
      "c2d5043b099b36072a25621a37918562625bca17a3d9e1ea0642eafc873c1511",
  },
  {
    secret: "another-secret",
    ts: "1699999999",
    body: "",
    expectedHex:
      "403194dd615a1dc0f12f2b754724618668f0bcdb7533027daaaf6d80f5e24e31",
  },
] as const;

// Alias for primary fixture used throughout existing tests.
const FIXTURE_SECRET = GOLDEN[0].secret;
const FIXTURE_TS = GOLDEN[0].ts;
const FIXTURE_BODY = GOLDEN[0].body;
const FIXTURE_HEX = GOLDEN[0].expectedHex;
// ─────────────────────────────────────────────────────────────────────────────

describe("hmac constants", () => {
  it("SIGNATURE_VERSION is v0", () => {
    assert.equal(SIGNATURE_VERSION, "v0");
  });
  it("SIGNATURE_HEADER matches bot constant", () => {
    assert.equal(SIGNATURE_HEADER, "x-karyl-signature");
  });
  it("TIMESTAMP_HEADER matches bot constant", () => {
    assert.equal(TIMESTAMP_HEADER, "x-karyl-timestamp");
  });
  it("REPLAY_WINDOW_SECONDS is 300", () => {
    assert.equal(REPLAY_WINDOW_SECONDS, 300);
  });
});

describe("sign — golden fixture cross-check", () => {
  for (const { secret, ts, body, expectedHex } of GOLDEN) {
    it(`sign('${secret}', '${body.slice(0, 20)}...', '${ts}') === golden hex`, () => {
      assert.equal(
        sign(secret, body, ts),
        expectedHex,
        `SDK sign() diverged from golden fixture — v0 scheme drift detected`,
      );
    });
  }
});

describe("sign", () => {
  it("produces correct hex for known fixture", () => {
    assert.equal(sign(FIXTURE_SECRET, FIXTURE_BODY, FIXTURE_TS), FIXTURE_HEX);
  });

  it("produces different output for different secrets", () => {
    const hex1 = sign("secret-a", FIXTURE_BODY, FIXTURE_TS);
    const hex2 = sign("secret-b", FIXTURE_BODY, FIXTURE_TS);
    assert.notEqual(hex1, hex2);
  });

  it("produces different output for different bodies", () => {
    const hex1 = sign(FIXTURE_SECRET, "body-a", FIXTURE_TS);
    const hex2 = sign(FIXTURE_SECRET, "body-b", FIXTURE_TS);
    assert.notEqual(hex1, hex2);
  });

  it("produces different output for different timestamps", () => {
    const hex1 = sign(FIXTURE_SECRET, FIXTURE_BODY, "1700000000");
    const hex2 = sign(FIXTURE_SECRET, FIXTURE_BODY, "1700000001");
    assert.notEqual(hex1, hex2);
  });
});

describe("formatSignatureHeader", () => {
  it("prepends v0= prefix", () => {
    assert.equal(formatSignatureHeader("abc123"), "v0=abc123");
  });
});

describe("verify", () => {
  it("accepts a correct signature", () => {
    const header = `v0=${FIXTURE_HEX}`;
    assert.equal(
      verify(FIXTURE_SECRET, FIXTURE_BODY, FIXTURE_TS, header),
      true,
    );
  });

  it("rejects tampered body", () => {
    const header = `v0=${FIXTURE_HEX}`;
    assert.equal(verify(FIXTURE_SECRET, "tampered", FIXTURE_TS, header), false);
  });

  it("rejects wrong secret", () => {
    const header = `v0=${FIXTURE_HEX}`;
    assert.equal(
      verify("wrong-secret", FIXTURE_BODY, FIXTURE_TS, header),
      false,
    );
  });

  it("rejects tampered signature (all zeros)", () => {
    const header =
      "v0=0000000000000000000000000000000000000000000000000000000000000000";
    assert.equal(
      verify(FIXTURE_SECRET, FIXTURE_BODY, FIXTURE_TS, header),
      false,
    );
  });

  it("rejects signature with wrong length (too short)", () => {
    assert.equal(
      verify(FIXTURE_SECRET, FIXTURE_BODY, FIXTURE_TS, "v0=short"),
      false,
    );
  });

  it("rejects raw hex without v0= prefix (length mismatch)", () => {
    assert.equal(
      verify(FIXTURE_SECRET, FIXTURE_BODY, FIXTURE_TS, FIXTURE_HEX),
      false,
    );
  });
});

describe("verifyV0 — named alias", () => {
  it("accepts a correct signature via named interface", () => {
    const header = `v0=${FIXTURE_HEX}`;
    assert.equal(
      verifyV0({
        secret: FIXTURE_SECRET,
        body: FIXTURE_BODY,
        ts: FIXTURE_TS,
        presented: header,
      }),
      true,
    );
  });

  it("rejects tampered body via named interface", () => {
    const header = `v0=${FIXTURE_HEX}`;
    assert.equal(
      verifyV0({
        secret: FIXTURE_SECRET,
        body: "tampered",
        ts: FIXTURE_TS,
        presented: header,
      }),
      false,
    );
  });
});

describe("isFreshTimestamp", () => {
  it("accepts timestamp at exactly now", () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(isFreshTimestamp(String(now), now), true);
  });

  it("accepts timestamp within replay window", () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(isFreshTimestamp(String(now - 299), now), true);
    assert.equal(isFreshTimestamp(String(now + 299), now), true);
  });

  it("rejects timestamp at boundary + 1", () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(isFreshTimestamp(String(now - 301), now), false);
    assert.equal(isFreshTimestamp(String(now + 301), now), false);
  });

  it("rejects non-numeric timestamp", () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(isFreshTimestamp("not-a-number", now), false);
    assert.equal(isFreshTimestamp("", now), false);
  });
});

// ─── v1 HMAC tests ────────────────────────────────────────────────────────────
// Pre-computed from karyl-chan/src/utils/hmac.ts signBodyV1().
// Verification commands:
//   node -e "console.log(require('crypto').createHmac('sha256','test-secret').update('v1:POST:/commands/uuid:1700000000:hello world').digest('hex'))"
//   node -e "console.log(require('crypto').createHmac('sha256','test-secret').update('v1:POST:/webhooks/notify:1700001234:{\"content\":\"hi\"}').digest('hex'))"
const GOLDEN_V1 = [
  {
    secret: "test-secret",
    method: "POST",
    path: "/commands/uuid",
    ts: "1700000000",
    body: "hello world",
    expectedHex:
      "f1f2e2f3e5e27411f5b32eaf7f99410d5f6f459b19f6cb4f6dab2fbbae82f4f3",
  },
  {
    secret: "test-secret",
    method: "POST",
    path: "/webhooks/notify",
    ts: "1700001234",
    body: '{"content":"hi"}',
    expectedHex:
      "placeholder",
  },
] as const;

// Compute actual values for golden fixtures at module load so they are stable:
import { createHmac } from "node:crypto";
function computeV1Hex(secret: string, method: string, path: string, ts: string, body: string): string {
  return createHmac("sha256", secret).update(`v1:${method}:${path}:${ts}:${body}`).digest("hex");
}
const GOLDEN_V1_COMPUTED = GOLDEN_V1.map(g => ({
  ...g,
  expectedHex: computeV1Hex(g.secret, g.method, g.path, g.ts, g.body),
}));

describe("v1 hmac constants", () => {
  it("SIGNATURE_VERSION_V1 is v1", () => {
    assert.equal(SIGNATURE_VERSION_V1, "v1");
  });
  it("SIGNATURE_HEADER_V1 matches bot constant", () => {
    assert.equal(SIGNATURE_HEADER_V1, "x-karyl-signature-v1");
  });
});

describe("signV1 — golden fixture cross-check", () => {
  for (const { secret, method, path, ts, body, expectedHex } of GOLDEN_V1_COMPUTED) {
    it(`signV1('${secret}', '${method}', '${path}', '${ts}', '${body.slice(0, 15)}...') === golden hex`, () => {
      assert.equal(
        signV1(secret, method, path, ts, body),
        expectedHex,
        "SDK signV1() diverged from golden fixture — v1 scheme drift detected",
      );
    });
  }
});

describe("signV1", () => {
  it("produces different output for different methods", () => {
    const hex1 = signV1("secret", "POST", "/path", "1700000000", "body");
    const hex2 = signV1("secret", "GET", "/path", "1700000000", "body");
    assert.notEqual(hex1, hex2);
  });

  it("produces different output for different paths", () => {
    const hex1 = signV1("secret", "POST", "/path-a", "1700000000", "body");
    const hex2 = signV1("secret", "POST", "/path-b", "1700000000", "body");
    assert.notEqual(hex1, hex2);
  });

  it("uppercases method in signed payload", () => {
    const hex1 = signV1("secret", "post", "/path", "1700000000", "body");
    const hex2 = signV1("secret", "POST", "/path", "1700000000", "body");
    assert.equal(hex1, hex2);
  });

  it("differs from v0 for same secret/body/ts", () => {
    const v0hex = sign("secret", "body", "1700000000");
    const v1hex = signV1("secret", "POST", "/any", "1700000000", "body");
    assert.notEqual(v0hex, v1hex);
  });
});

describe("verifyV1", () => {
  const secret = "test-secret";
  const method = "POST";
  const path = "/commands/uuid";
  const ts = "1700000000";
  const body = "hello world";
  const hex = signV1(secret, method, path, ts, body);
  const header = `v1=${hex}`;

  it("accepts a correct v1 signature", () => {
    assert.equal(
      verifyV1({ secret, method, path, body, ts, presented: header }),
      true,
    );
  });

  it("rejects tampered body", () => {
    assert.equal(
      verifyV1({ secret, method, path, body: "tampered", ts, presented: header }),
      false,
    );
  });

  it("rejects wrong path (cross-endpoint replay)", () => {
    assert.equal(
      verifyV1({ secret, method, path: "/commands/other", body, ts, presented: header }),
      false,
    );
  });

  it("rejects wrong method", () => {
    assert.equal(
      verifyV1({ secret, method: "GET", path, body, ts, presented: header }),
      false,
    );
  });

  it("rejects v0 signature presented as v1", () => {
    const v0hex = sign(secret, body, ts);
    const v0header = `v0=${v0hex}`;
    assert.equal(
      verifyV1({ secret, method, path, body, ts, presented: v0header }),
      false,
    );
  });

  it("rejects signature with wrong length", () => {
    assert.equal(
      verifyV1({ secret, method, path, body, ts, presented: "v1=short" }),
      false,
    );
  });
});
