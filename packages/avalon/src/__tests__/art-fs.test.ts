/**
 * Filesystem-touching art tests. Use an isolated AVALON_ART_DIR per
 * test via env override → tmpdir. Each suite resets `process.env.AVALON_ART_DIR`
 * before `art.js` is re-imported so it picks up the new dir.
 *
 * The module reads ART_DIR once at load time (`const ART_DIR =
 * process.env.AVALON_ART_DIR || …`), so we use vitest's
 * `vi.resetModules()` between tests that need a fresh dir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "avalon-art-"));
  process.env.AVALON_ART_DIR = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const TINY_PNG = Buffer.from(
  // 1×1 transparent PNG
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
    "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

describe("art fs: saveArt + listArt round-trip for single-image position", () => {
  it("write merlin.png → list returns one entry without variant", async () => {
    const art = await import("../art.js");
    await art.saveArt("merlin", TINY_PNG, "png");
    const list = await art.listArt();
    expect(list).toHaveLength(1);
    expect(list[0].position).toBe("merlin");
    expect(list[0].filename).toBe("merlin.png");
    expect(list[0].variant).toBeUndefined();
  });
  it("saveArt replaces a prior extension", async () => {
    const art = await import("../art.js");
    await art.saveArt("merlin", TINY_PNG, "png");
    await art.saveArt("merlin", TINY_PNG, "jpg");
    const list = await art.listArt();
    expect(list).toHaveLength(1);
    expect(list[0].filename).toBe("merlin.jpg");
  });
});

describe("art fs: variant slots are independent", () => {
  it("saveVariantArt loyal-1 and loyal-2 produces two list entries", async () => {
    const art = await import("../art.js");
    await art.saveVariantArt("loyal", 1, TINY_PNG, "png");
    await art.saveVariantArt("loyal", 2, TINY_PNG, "png");
    const list = await art.listArt();
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.variant)).toEqual([1, 2]);
    expect(list.every((e) => e.position === "loyal")).toBe(true);
  });
  it("re-uploading the same variant replaces the previous file", async () => {
    const art = await import("../art.js");
    await art.saveVariantArt("loyal", 1, TINY_PNG, "jpg");
    await art.saveVariantArt("loyal", 1, TINY_PNG, "png");
    const list = await art.listArt();
    expect(list).toHaveLength(1);
    expect(list[0].filename).toBe("loyal-1.png");
  });
  it("saveVariantArt rejects out-of-range variant", async () => {
    const art = await import("../art.js");
    await expect(
      art.saveVariantArt("loyal", 6, TINY_PNG, "png"),
    ).rejects.toThrow(/out of range/);
    await expect(
      art.saveVariantArt("merlin", 1, TINY_PNG, "png"),
    ).rejects.toThrow(/out of range/);
  });
});

describe("art fs: findArt vs findVariantArt", () => {
  it("findArt returns null for variant positions", async () => {
    const art = await import("../art.js");
    await art.saveVariantArt("loyal", 1, TINY_PNG, "png");
    expect(await art.findArt("loyal")).toBeNull();
  });
  it("findVariantArt returns null for non-variant positions", async () => {
    const art = await import("../art.js");
    await art.saveArt("merlin", TINY_PNG, "png");
    expect(await art.findVariantArt("merlin", 1)).toBeNull();
  });
  it("findVariantArt returns null when the requested rank isn't uploaded", async () => {
    const art = await import("../art.js");
    await art.saveVariantArt("loyal", 1, TINY_PNG, "png");
    // Rank 2 not uploaded → null → caller skips thumbnail (no reuse).
    expect(await art.findVariantArt("loyal", 2)).toBeNull();
  });
  it("findVariantArt returns the right file + a stable etag", async () => {
    const art = await import("../art.js");
    await art.saveVariantArt("loyal", 3, TINY_PNG, "png");
    const hit = await art.findVariantArt("loyal", 3);
    expect(hit).not.toBeNull();
    expect(hit!.filename).toBe("loyal-3.png");
    expect(hit!.etag).toMatch(/^[a-f0-9]{8}$/);
  });
});

describe("art fs: removeArt / removeVariantArt", () => {
  it("removeArt clears the single-image slot only", async () => {
    const art = await import("../art.js");
    await art.saveArt("merlin", TINY_PNG, "png");
    await art.saveVariantArt("loyal", 1, TINY_PNG, "png");
    const ok = await art.removeArt("merlin");
    expect(ok).toBe(true);
    const list = await art.listArt();
    expect(list.map((e) => e.filename)).toEqual(["loyal-1.png"]);
  });
  it("removeVariantArt clears exactly one slot", async () => {
    const art = await import("../art.js");
    await art.saveVariantArt("loyal", 1, TINY_PNG, "png");
    await art.saveVariantArt("loyal", 2, TINY_PNG, "png");
    const ok = await art.removeVariantArt("loyal", 1);
    expect(ok).toBe(true);
    const list = await art.listArt();
    expect(list.map((e) => e.filename)).toEqual(["loyal-2.png"]);
  });
  it("removeVariantArt rejects out-of-range slot", async () => {
    const art = await import("../art.js");
    expect(await art.removeVariantArt("loyal", 99)).toBe(false);
  });
});

describe("art fs: cleanupOrphanArt sweeps non-conforming filenames", () => {
  it("deletes pre-rename loyal.<ext> and minion.<ext>", async () => {
    // Plant orphans BEFORE the module loads (cleanupOrphanArt reads
    // them at runtime so this works regardless of import order).
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "loyal.png"), TINY_PNG);
    writeFileSync(join(tmpDir, "minion.jpg"), TINY_PNG);
    writeFileSync(join(tmpDir, "merlin.png"), TINY_PNG); // legitimate, keep
    writeFileSync(join(tmpDir, "stray.txt"), "garbage"); // unrelated junk

    const art = await import("../art.js");
    const res = await art.cleanupOrphanArt();
    expect(res.removed.sort()).toEqual(
      ["loyal.png", "minion.jpg", "stray.txt"].sort(),
    );
    const remaining = readdirSync(tmpDir);
    expect(remaining).toEqual(["merlin.png"]);
  });
  it("is a no-op on a clean dir", async () => {
    const art = await import("../art.js");
    await art.saveArt("merlin", TINY_PNG, "png");
    await art.saveVariantArt("loyal", 1, TINY_PNG, "png");
    const res = await art.cleanupOrphanArt();
    expect(res.removed).toEqual([]);
    expect(res.errors).toEqual([]);
  });
});

describe("art fs: listArt sorts by position then variant", () => {
  it("returns entries in stable lexical position + ascending variant order", async () => {
    const art = await import("../art.js");
    await art.saveVariantArt("minion", 3, TINY_PNG, "png");
    await art.saveVariantArt("loyal", 2, TINY_PNG, "png");
    await art.saveArt("merlin", TINY_PNG, "png");
    await art.saveVariantArt("loyal", 1, TINY_PNG, "png");
    await art.saveVariantArt("minion", 1, TINY_PNG, "png");
    const order = (await art.listArt()).map(
      (e) => `${e.position}${e.variant !== undefined ? "-" + e.variant : ""}`,
    );
    expect(order).toEqual([
      "loyal-1",
      "loyal-2",
      "merlin",
      "minion-1",
      "minion-3",
    ]);
  });
});

describe("art fs: assets (lake)", () => {
  it("saveAsset + findAsset round-trip", async () => {
    const art = await import("../art.js");
    await art.saveAsset("lake", TINY_PNG, "png");
    const hit = await art.findAsset("lake");
    expect(hit).not.toBeNull();
    expect(hit!.filename).toBe("lake.png");
    expect(hit!.etag).toMatch(/^[a-f0-9]{8}$/);
  });
  it("saveAsset replaces a prior extension", async () => {
    const art = await import("../art.js");
    await art.saveAsset("lake", TINY_PNG, "jpg");
    await art.saveAsset("lake", TINY_PNG, "png");
    const list = await art.listAssets();
    expect(list).toHaveLength(1);
    expect(list[0].filename).toBe("lake.png");
  });
  it("removeAsset returns true on success, false when nothing on disk", async () => {
    const art = await import("../art.js");
    await art.saveAsset("lake", TINY_PNG, "png");
    expect(await art.removeAsset("lake")).toBe(true);
    expect(await art.findAsset("lake")).toBeNull();
    expect(await art.removeAsset("lake")).toBe(false);
  });
  it("listArt does NOT include assets; listAssets does NOT include roles", async () => {
    const art = await import("../art.js");
    await art.saveArt("merlin", TINY_PNG, "png");
    await art.saveVariantArt("loyal", 1, TINY_PNG, "png");
    await art.saveAsset("lake", TINY_PNG, "png");

    const roleEntries = await art.listArt();
    expect(roleEntries.map((e) => e.filename).sort()).toEqual(
      ["loyal-1.png", "merlin.png"].sort(),
    );

    const assetEntries = await art.listAssets();
    expect(assetEntries.map((e) => e.filename)).toEqual(["lake.png"]);
  });
  it("cleanupOrphanArt keeps a legitimate lake.<ext>", async () => {
    const art = await import("../art.js");
    await art.saveAsset("lake", TINY_PNG, "png");
    const res = await art.cleanupOrphanArt();
    expect(res.removed).toEqual([]);
    expect(await art.findAsset("lake")).not.toBeNull();
  });
});
