import { describe, expect, it } from "vitest";
import {
  issueManagePair,
  verifyManageToken,
} from "../manage-tokens.js";

const CAPS = ["plugin:karyl-avalon:manage"];

describe("mt-001: issued access token verifies as manage-access", () => {
  it("round-trip access token", () => {
    const pair = issueManagePair("u1", CAPS);
    const claims = verifyManageToken(pair.accessToken, "manage-access");
    expect(claims).not.toBeNull();
    expect(claims!.purpose).toBe("manage-access");
    expect(claims!.userId).toBe("u1");
    expect(claims!.capabilities).toEqual(CAPS);
  });
});

describe("mt-002: refresh token does not verify as access", () => {
  it("refresh verified with purpose=manage-access → null", () => {
    const pair = issueManagePair("u1", CAPS);
    expect(verifyManageToken(pair.refreshToken, "manage-access")).toBeNull();
  });
  it("refresh verified as manage-refresh works", () => {
    const pair = issueManagePair("u1", CAPS);
    const claims = verifyManageToken(pair.refreshToken, "manage-refresh");
    expect(claims).not.toBeNull();
    expect(claims!.purpose).toBe("manage-refresh");
  });
});

describe("mt-003: tampered signature is rejected", () => {
  it("flipping the last sig segment yields null", () => {
    const pair = issueManagePair("u1", CAPS);
    const parts = pair.accessToken.split(".");
    // Mutate one character of the signature (base64url charset) into
    // another valid char to keep the structure parseable.
    const orig = parts[2];
    const replaced = orig[0] === "A" ? "B" + orig.slice(1) : "A" + orig.slice(1);
    parts[2] = replaced;
    const tampered = parts.join(".");
    expect(verifyManageToken(tampered, "manage-access")).toBeNull();
  });
});

describe("mt-005: wrong segment count rejected", () => {
  it("two-segment string is rejected", () => {
    expect(verifyManageToken("aa.bb", "manage-access")).toBeNull();
  });
  it("single-segment is rejected", () => {
    expect(verifyManageToken("aaaa", "manage-access")).toBeNull();
  });
});

describe("mt-006: bad alg / typ rejected", () => {
  it("alg=none hand-built token rejected", () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" }),
    ).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({
        purpose: "manage-access",
        userId: "u1",
        capabilities: CAPS,
        iat: Date.now(),
        exp: Date.now() + 60_000,
      }),
    ).toString("base64url");
    const token = `${header}.${body}.`;
    expect(verifyManageToken(token, "manage-access")).toBeNull();
  });
});
