import { describe, expect, it } from "vitest";
import {
  ASSET_KEYS,
  extForMime,
  isSafeArtFilename,
  isValidAssetKey,
  isValidPosition,
  isValidVariant,
  isVariantPosition,
  maxVariantsForPosition,
  mimeForArtFile,
} from "../art.js";

describe("art-001: extForMime accepts the documented mime set", () => {
  it.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
    ["IMAGE/JPEG", "jpg"], // case-insensitive
  ])("extForMime(%s) === %s", (mime, expected) => {
    expect(extForMime(mime)).toBe(expected);
  });
});

describe("art-002: extForMime rejects others", () => {
  it.each(["image/svg+xml", "image/avif", "image/bmp", "text/plain"])(
    "extForMime(%s) === null",
    (mime) => {
      expect(extForMime(mime)).toBeNull();
    },
  );
});

describe("art-003: isValidPosition allows the 8 game positions (incl. minion)", () => {
  // `minion` was added to support the future Minion-of-Mordred art slot
  // even though no current `rolesForPlayerCount` deck includes it.
  it.each([
    "merlin",
    "percival",
    "assassin",
    "morgana",
    "mordred",
    "oberon",
    "loyal",
    "minion",
  ])("isValidPosition(%s) is true", (p) => {
    expect(isValidPosition(p)).toBe(true);
  });
  it.each(["lancelot", "MERLIN", "", "merlin "])(
    "isValidPosition(%s) is false",
    (p) => {
      expect(isValidPosition(p)).toBe(false);
    },
  );
});

describe("art-004: isSafeArtFilename blocks traversal and unwanted shapes", () => {
  it("rejects path-traversal forms", () => {
    expect(isSafeArtFilename("../foo.png")).toBe(false);
    expect(isSafeArtFilename("..\\foo.png")).toBe(false);
    expect(isSafeArtFilename("/etc/passwd")).toBe(false);
    expect(isSafeArtFilename("a/b.png")).toBe(false);
  });
  it("rejects non-image extensions", () => {
    expect(isSafeArtFilename("merlin.svg")).toBe(false);
    expect(isSafeArtFilename("merlin")).toBe(false);
    expect(isSafeArtFilename(".jpg")).toBe(false);
  });
  it("accepts single-image positions only", () => {
    expect(isSafeArtFilename("merlin.jpg")).toBe(true);
    expect(isSafeArtFilename("percival.jpg")).toBe(true);
    expect(isSafeArtFilename("morgana.png")).toBe(true);
    expect(isSafeArtFilename("assassin.webp")).toBe(true);
    expect(isSafeArtFilename("mordred.gif")).toBe(true);
    expect(isSafeArtFilename("oberon.jpeg")).toBe(true);
  });
  it("REJECTS the legacy single-file shape for variant positions", () => {
    // loyal.<ext> / minion.<ext> were valid before the variant
    // redesign; cleanupOrphanArt sweeps them at start, but the
    // filename guard also has to refuse them so they can't sneak
    // into listArt() / GET /art/<file> if they appear on disk.
    expect(isSafeArtFilename("loyal.png")).toBe(false);
    expect(isSafeArtFilename("minion.png")).toBe(false);
  });
  it("accepts variant filenames inside each role's range", () => {
    for (let i = 1; i <= 5; i++) {
      expect(isSafeArtFilename(`loyal-${i}.png`)).toBe(true);
    }
    for (let i = 1; i <= 3; i++) {
      expect(isSafeArtFilename(`minion-${i}.png`)).toBe(true);
    }
  });
  it("rejects variant filenames outside the configured range", () => {
    expect(isSafeArtFilename("loyal-0.png")).toBe(false);
    expect(isSafeArtFilename("loyal-6.png")).toBe(false);
    expect(isSafeArtFilename("minion-4.png")).toBe(false);
    expect(isSafeArtFilename("minion-0.png")).toBe(false);
  });
  it("rejects variant filenames for non-variant positions", () => {
    expect(isSafeArtFilename("merlin-1.png")).toBe(false);
    expect(isSafeArtFilename("assassin-2.png")).toBe(false);
  });
  it("regex is case-insensitive on extension only", () => {
    expect(isSafeArtFilename("merlin.JPG")).toBe(true);
    expect(isSafeArtFilename("loyal-1.JPG")).toBe(true);
  });
});

describe("variant positions metadata", () => {
  it("isVariantPosition flags loyal + minion only", () => {
    expect(isVariantPosition("loyal")).toBe(true);
    expect(isVariantPosition("minion")).toBe(true);
    expect(isVariantPosition("merlin")).toBe(false);
    expect(isVariantPosition("percival")).toBe(false);
    expect(isVariantPosition("assassin")).toBe(false);
    expect(isVariantPosition("morgana")).toBe(false);
    expect(isVariantPosition("mordred")).toBe(false);
    expect(isVariantPosition("oberon")).toBe(false);
  });
  it("maxVariantsForPosition is 5 / 3 / 0", () => {
    expect(maxVariantsForPosition("loyal")).toBe(5);
    expect(maxVariantsForPosition("minion")).toBe(3);
    expect(maxVariantsForPosition("merlin")).toBe(0);
  });
  it("isValidVariant clamps to 1..max", () => {
    expect(isValidVariant("loyal", 0)).toBe(false);
    expect(isValidVariant("loyal", 1)).toBe(true);
    expect(isValidVariant("loyal", 5)).toBe(true);
    expect(isValidVariant("loyal", 6)).toBe(false);
    expect(isValidVariant("minion", 1)).toBe(true);
    expect(isValidVariant("minion", 3)).toBe(true);
    expect(isValidVariant("minion", 4)).toBe(false);
    expect(isValidVariant("merlin", 1)).toBe(false);
  });
  it("isValidVariant rejects non-integer", () => {
    expect(isValidVariant("loyal", 1.5)).toBe(false);
    expect(isValidVariant("loyal", Number.NaN)).toBe(false);
    expect(isValidVariant("loyal", Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("game-element assets metadata", () => {
  it("ASSET_KEYS currently lists exactly one key (lake)", () => {
    expect([...ASSET_KEYS]).toEqual(["lake"]);
  });
  it("isValidAssetKey accepts known asset keys only", () => {
    expect(isValidAssetKey("lake")).toBe(true);
    expect(isValidAssetKey("LAKE")).toBe(false);
    expect(isValidAssetKey("throne")).toBe(false);
    expect(isValidAssetKey("")).toBe(false);
  });
  it("isSafeArtFilename accepts <asset>.<ext>", () => {
    expect(isSafeArtFilename("lake.png")).toBe(true);
    expect(isSafeArtFilename("lake.jpg")).toBe(true);
    expect(isSafeArtFilename("lake.webp")).toBe(true);
    expect(isSafeArtFilename("lake.gif")).toBe(true);
  });
  it("isSafeArtFilename rejects unknown asset keys", () => {
    expect(isSafeArtFilename("throne.png")).toBe(false);
    expect(isSafeArtFilename("questCard.png")).toBe(false);
  });
});

describe("mimeForArtFile mirrors extForMime", () => {
  it.each([
    ["merlin.jpg", "image/jpeg"],
    ["merlin.jpeg", "image/jpeg"],
    ["merlin.png", "image/png"],
    ["merlin.webp", "image/webp"],
    ["merlin.gif", "image/gif"],
    ["merlin.unknown", "application/octet-stream"],
    ["merlin", "application/octet-stream"],
  ])("mimeForArtFile(%s) === %s", (file, expected) => {
    expect(mimeForArtFile(file)).toBe(expected);
  });
});
