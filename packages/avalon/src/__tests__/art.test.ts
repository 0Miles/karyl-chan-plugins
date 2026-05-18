import { describe, expect, it } from "vitest";
import {
  extForMime,
  isSafeArtFilename,
  isValidPosition,
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

describe("art-003: isValidPosition allows exactly the 7 game positions", () => {
  it.each([
    "merlin",
    "percival",
    "assassin",
    "morgana",
    "mordred",
    "oberon",
    "loyal",
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
  it("accepts simple lower-case <name>.<ext>", () => {
    expect(isSafeArtFilename("merlin.jpg")).toBe(true);
    expect(isSafeArtFilename("morgana.png")).toBe(true);
    expect(isSafeArtFilename("morgana.webp")).toBe(true);
    expect(isSafeArtFilename("morgana.gif")).toBe(true);
    expect(isSafeArtFilename("merlin.jpeg")).toBe(true);
  });
  it("regex is case-insensitive on extension only", () => {
    // Comment in art.ts says /i — current behaviour accepts JPG/JPEG.
    // This pins the behaviour so if someone tightens the regex later
    // we know about it.
    expect(isSafeArtFilename("merlin.JPG")).toBe(true);
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
