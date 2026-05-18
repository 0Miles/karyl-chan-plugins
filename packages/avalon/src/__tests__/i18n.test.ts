import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "../i18n/index.js";
import { zhTW } from "../i18n/zh-TW.js";
import type { Position } from "../game/roles.js";

const SRC_DIR = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
);

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      // Skip the tests dir itself — tests routinely include LocaleKey
      // strings as test fixtures that aren't real lookups.
      if (full.endsWith("__tests__")) continue;
      walk(full, acc);
    } else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

describe("i18n-001: every literal t() key in src/** exists in zhTW", () => {
  it("no literal t(...) key is missing", () => {
    const files = walk(SRC_DIR);
    const tLiteral = /\bt\(\s*[A-Za-z_.[\]]+\s*,\s*"([^"]+)"/g;
    const missing: { file: string; key: string }[] = [];
    const dict = zhTW as Record<string, string>;
    for (const file of files) {
      const src = readFileSync(file, "utf-8");
      let m: RegExpExecArray | null;
      while ((m = tLiteral.exec(src)) !== null) {
        const key = m[1];
        if (!(key in dict)) {
          missing.push({ file: file.slice(SRC_DIR.length + 1), key });
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("i18n-002: role.flavor.<position> covers every Position", () => {
  it.each<Position>([
    "merlin",
    "percival",
    "assassin",
    "morgana",
    "mordred",
    "oberon",
    "loyal",
  ])("role.flavor.%s is present", (pos) => {
    const key = `role.flavor.${pos}` as const;
    expect(zhTW).toHaveProperty(key);
  });
});

describe("i18n-003: missing key returns the key (loudly)", () => {
  it("warns + returns the literal", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Cast bypasses LocaleKey to simulate a runtime-only miss.
    const out = t(undefined, "fake.nonexistent" as never);
    expect(out).toBe("fake.nonexistent");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("i18n: {var} interpolation", () => {
  it("substitutes {round} in stage.appoint.title", () => {
    const out = t(undefined, "stage.appoint.title", { round: 3 });
    expect(out).toContain("3");
    expect(out).not.toContain("{round}");
  });
});
