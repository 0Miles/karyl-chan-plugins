import { createHash } from "crypto";
import { mkdir, readdir, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";
import type { Position } from "./game/roles.js";

/**
 * Storage for admin-uploaded role artwork.
 *
 * Two flavours of artwork live in the same flat directory:
 *
 *  - **Single-image positions** (merlin / percival / assassin / morgana /
 *    mordred / oberon): exactly one file `<position>.<ext>` per role.
 *    Replaces on re-upload; the deal-reveal embed uses it whenever
 *    that role appears in a game.
 *
 *  - **Variant positions** (loyal / minion): admin uploads up to N
 *    distinct images, named `<position>-<variant>.<ext>` (variant ∈
 *    1..N). At deal-reveal the renderer picks one variant based on the
 *    viewer's "rank" among same-role seats — see `findVariantArt`. If
 *    fewer variants are uploaded than the game has copies of the role,
 *    the un-ranked seats simply get no thumbnail (never reused, by
 *    design).
 *
 * Lives on a Docker volume (`avalon-art`) so uploads survive container
 * rebuilds.
 */
const ART_DIR = process.env.AVALON_ART_DIR || "/app/data/art";

const ALLOWED_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const VALID_POSITIONS: ReadonlySet<Position> = new Set<Position>([
  "merlin",
  "percival",
  "assassin",
  "morgana",
  "mordred",
  "oberon",
  "loyal",
  "minion",
]);

/**
 * Positions that support multiple uploaded variants. The value is the
 * hard upper bound on variant index that the API accepts. Anything not
 * in this map is treated as single-image.
 *
 * Rationale for the caps:
 *  - `loyal`: max 4 copies appear in the official Avalon table (n=9/10);
 *    5 leaves headroom for a future high-player-count variant and is
 *    the user-facing slot count.
 *  - `minion`: officially up to 4 evils, but `minion` isn't actually
 *    in the current deck — these 3 slots are pre-staged for a future
 *    addition (e.g. swapping Oberon for plain minions).
 */
export const VARIANT_POSITIONS: Readonly<Partial<Record<Position, number>>> = {
  loyal: 5,
  minion: 3,
};

/**
 * Non-role game-element assets. Kept in the same flat art directory
 * as role art but addressed separately so they don't pollute the
 * `Position` type — lake is a game mechanic, not a role.
 *
 * Filename shape: `<key>.<ext>` directly in ART_DIR. The asset keys
 * are listed here exhaustively; `isSafeArtFilename` accepts them via
 * a dedicated regex group so a typo can't slip onto disk.
 */
export const ASSET_KEYS = ["lake"] as const;
export type AssetKey = (typeof ASSET_KEYS)[number];
const ASSET_KEY_SET: ReadonlySet<string> = new Set(ASSET_KEYS);

export function isValidAssetKey(s: string): s is AssetKey {
  return ASSET_KEY_SET.has(s);
}

export function isVariantPosition(p: Position): boolean {
  return VARIANT_POSITIONS[p] !== undefined;
}

export function maxVariantsForPosition(p: Position): number {
  return VARIANT_POSITIONS[p] ?? 0;
}

export function isValidVariant(p: Position, variant: number): boolean {
  if (!Number.isInteger(variant)) return false;
  const max = maxVariantsForPosition(p);
  if (max === 0) return false;
  return variant >= 1 && variant <= max;
}

export function getArtDir(): string {
  return ART_DIR;
}

export function isValidPosition(s: string): s is Position {
  return VALID_POSITIONS.has(s as Position);
}

export function extForMime(mime: string): string | null {
  return ALLOWED_EXT[mime.toLowerCase()] ?? null;
}

export function mimeForArtFile(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}

// Single-image positions match `<position>.<ext>`. Variant positions
// match `<position>-<digit>.<ext>` where digit ∈ 1..max. Assets match
// `<asset-key>.<ext>`. Anything outside these shapes is rejected at
// parse time so a typo can't end up on disk.
const SINGLE_FILENAME_RE = /^(merlin|percival|assassin|morgana|mordred|oberon)\.(jpe?g|png|webp|gif)$/i;
const VARIANT_FILENAME_RE = /^(loyal|minion)-(\d+)\.(jpe?g|png|webp|gif)$/i;
const ASSET_FILENAME_RE = /^([a-z][a-z0-9-]*)\.(jpe?g|png|webp|gif)$/i;

export function isSafeArtFilename(name: string): boolean {
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return false;
  }
  if (SINGLE_FILENAME_RE.test(name)) return true;
  const v = VARIANT_FILENAME_RE.exec(name);
  if (v) {
    const pos = v[1].toLowerCase() as Position;
    const variant = Number(v[2]);
    return isValidVariant(pos, variant);
  }
  const a = ASSET_FILENAME_RE.exec(name);
  if (a) {
    return isValidAssetKey(a[1].toLowerCase());
  }
  return false;
}

export function artFilePath(filename: string): string {
  return join(ART_DIR, filename);
}

async function ensureArtDir(): Promise<void> {
  await mkdir(ART_DIR, { recursive: true });
}

/**
 * Delete every existing file for a (position, optional variant) slot.
 * Best-effort — if multiple extensions exist for the same slot they
 * all get cleared so the new upload doesn't shadow an old format.
 */
async function deleteSlotFiles(
  position: Position,
  variant: number | null,
): Promise<void> {
  try {
    const files = await readdir(ART_DIR);
    const prefix = variant === null ? `${position}.` : `${position}-${variant}.`;
    await Promise.all(
      files
        .filter((f) => f.startsWith(prefix))
        .map((f) => unlink(join(ART_DIR, f)).catch(() => undefined)),
    );
  } catch {
    // dir doesn't exist yet — nothing to clean
  }
}

/**
 * Save bytes for a single-image position (`<position>.<ext>`),
 * replacing any prior file regardless of its extension.
 */
export async function saveArt(
  position: Position,
  buffer: Buffer,
  ext: string,
): Promise<string> {
  await ensureArtDir();
  await deleteSlotFiles(position, null);
  const filename = `${position}.${ext}`;
  await writeFile(join(ART_DIR, filename), buffer);
  return filename;
}

/**
 * Save bytes for a variant slot (`<position>-<variant>.<ext>`),
 * replacing any prior file for the same slot. Caller is responsible
 * for validating `variant` via `isValidVariant`.
 */
export async function saveVariantArt(
  position: Position,
  variant: number,
  buffer: Buffer,
  ext: string,
): Promise<string> {
  if (!isValidVariant(position, variant)) {
    throw new Error(`variant ${variant} out of range for ${position}`);
  }
  await ensureArtDir();
  await deleteSlotFiles(position, variant);
  const filename = `${position}-${variant}.${ext}`;
  await writeFile(join(ART_DIR, filename), buffer);
  return filename;
}

/** Remove the file for a single-image position. */
export async function removeArt(position: Position): Promise<boolean> {
  let removed = false;
  try {
    const files = await readdir(ART_DIR);
    const prefix = `${position}.`;
    for (const f of files.filter((f) => f.startsWith(prefix))) {
      await unlink(join(ART_DIR, f)).catch(() => undefined);
      removed = true;
    }
  } catch {
    // nothing
  }
  return removed;
}

/** Remove the file for a specific variant slot. */
export async function removeVariantArt(
  position: Position,
  variant: number,
): Promise<boolean> {
  if (!isValidVariant(position, variant)) return false;
  let removed = false;
  try {
    const files = await readdir(ART_DIR);
    const prefix = `${position}-${variant}.`;
    for (const f of files.filter((f) => f.startsWith(prefix))) {
      await unlink(join(ART_DIR, f)).catch(() => undefined);
      removed = true;
    }
  } catch {
    // nothing
  }
  return removed;
}

// ── Non-role game-element assets ─────────────────────────────────────
// Same flat-directory storage as role art, but addressed by a
// separately-validated asset key so a future "throne" / "questCard" /
// etc. doesn't have to pretend to be a Position. Filename: `<key>.<ext>`.

/** Save bytes for an asset slot, replacing any prior file. */
export async function saveAsset(
  key: AssetKey,
  buffer: Buffer,
  ext: string,
): Promise<string> {
  await ensureArtDir();
  // Reuse the slot-cleanup helper — the prefix `<key>.` doesn't
  // collide with any role filename pattern (single roles have
  // distinct names; variant roles always have a `-<n>` infix).
  await deleteSlotFiles(key as unknown as Position, null);
  const filename = `${key}.${ext}`;
  await writeFile(join(ART_DIR, filename), buffer);
  return filename;
}

/** Remove the file for an asset slot. */
export async function removeAsset(key: AssetKey): Promise<boolean> {
  let removed = false;
  try {
    const files = await readdir(ART_DIR);
    const prefix = `${key}.`;
    for (const f of files.filter((f) => f.startsWith(prefix))) {
      await unlink(join(ART_DIR, f)).catch(() => undefined);
      removed = true;
    }
  } catch {
    // nothing
  }
  return removed;
}

/** Asset lookup for stage renderers (lake board, ephemeral result). */
export async function findAsset(
  key: AssetKey,
): Promise<{ filename: string; etag: string } | null> {
  let files: string[];
  try {
    files = await readdir(ART_DIR);
  } catch {
    return null;
  }
  const match = files.find(
    (f) => f.startsWith(`${key}.`) && isSafeArtFilename(f),
  );
  if (!match) return null;
  return statEntry(match);
}

export interface AssetEntry {
  assetKey: AssetKey;
  filename: string;
  size: number;
  mtimeMs: number;
}

/** List every stored asset file (mirrors listArt's role surface). */
export async function listAssets(): Promise<AssetEntry[]> {
  const out: AssetEntry[] = [];
  let files: string[];
  try {
    files = await readdir(ART_DIR);
  } catch {
    return out;
  }
  for (const f of files) {
    if (!isSafeArtFilename(f)) continue;
    // Skip role files — role filename regexes are checked first
    // inside `isSafeArtFilename`; we re-check here to keep listAssets
    // self-contained.
    if (SINGLE_FILENAME_RE.test(f)) continue;
    if (VARIANT_FILENAME_RE.test(f)) continue;
    const m = ASSET_FILENAME_RE.exec(f);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (!isValidAssetKey(key)) continue;
    try {
      const st = await stat(join(ART_DIR, f));
      out.push({
        assetKey: key,
        filename: f,
        size: st.size,
        mtimeMs: st.mtimeMs,
      });
    } catch {
      // race with delete — skip
    }
  }
  out.sort((a, b) => a.assetKey.localeCompare(b.assetKey));
  return out;
}

/**
 * One-shot cleanup of orphan files that no longer match the current
 * filename schema. Notably: when this codebase moved variant
 * positions (loyal / minion) to suffixed filenames, any pre-existing
 * `<variant-pos>.<ext>` upload would become unreachable. This sweep
 * deletes them so the volume doesn't accumulate dead bytes.
 *
 * Safe to call on every plugin start; a no-op once the volume is
 * clean.
 */
export async function cleanupOrphanArt(): Promise<{
  removed: string[];
  errors: string[];
}> {
  const removed: string[] = [];
  const errors: string[] = [];
  let files: string[];
  try {
    files = await readdir(ART_DIR);
  } catch {
    return { removed, errors };
  }
  for (const f of files) {
    if (isSafeArtFilename(f)) continue;
    try {
      await unlink(join(ART_DIR, f));
      removed.push(f);
    } catch (e) {
      errors.push(f + ": " + (e instanceof Error ? e.message : String(e)));
    }
  }
  return { removed, errors };
}

export interface RoleArtEntry {
  position: Position;
  /** Present only for variant positions; 1-indexed slot number. */
  variant?: number;
  filename: string;
  size: number;
  mtimeMs: number;
}

/**
 * List every stored role-art file. Includes both single-image and
 * variant entries; the WebUI uses this to populate per-role tiles
 * (single roles → one tile, variant roles → N sub-tiles).
 */
export async function listArt(): Promise<RoleArtEntry[]> {
  const out: RoleArtEntry[] = [];
  let files: string[];
  try {
    files = await readdir(ART_DIR);
  } catch {
    return out;
  }
  for (const f of files) {
    if (!isSafeArtFilename(f)) continue;
    const v = VARIANT_FILENAME_RE.exec(f);
    let position: Position;
    let variant: number | undefined;
    if (v) {
      position = v[1].toLowerCase() as Position;
      variant = Number(v[2]);
    } else {
      const dot = f.indexOf(".");
      const slug = f.slice(0, dot).toLowerCase();
      if (!isValidPosition(slug)) continue;
      position = slug;
    }
    try {
      const st = await stat(join(ART_DIR, f));
      out.push({
        position,
        ...(variant !== undefined ? { variant } : {}),
        filename: f,
        size: st.size,
        mtimeMs: st.mtimeMs,
      });
    } catch {
      // race with delete — skip
    }
  }
  // Stable sort: position then variant ascending so the WebUI gets a
  // predictable ordering without having to sort client-side.
  out.sort((a, b) => {
    if (a.position !== b.position) return a.position.localeCompare(b.position);
    return (a.variant ?? 0) - (b.variant ?? 0);
  });
  return out;
}

/**
 * Single-image art lookup for the deal-reveal renderer (and the GET
 * resolver). Returns filename + a short content-hashed etag so the
 * public URL changes whenever bytes change — defeats the bot/CDN
 * cache without us tracking versions manually.
 */
export async function findArt(
  position: Position,
): Promise<{ filename: string; etag: string } | null> {
  if (isVariantPosition(position)) return null;
  let files: string[];
  try {
    files = await readdir(ART_DIR);
  } catch {
    return null;
  }
  const match = files.find(
    (f) => f.startsWith(`${position}.`) && isSafeArtFilename(f),
  );
  if (!match) return null;
  return statEntry(match);
}

/**
 * Variant art lookup: the seat's `rank` is 1-indexed among players
 * sharing the same `position`, sorted by seat index ascending. If
 * the admin hasn't uploaded a variant for this rank, returns null so
 * the caller drops the thumbnail (per the "never reuse a variant"
 * design choice).
 */
export async function findVariantArt(
  position: Position,
  rank: number,
): Promise<{ filename: string; etag: string } | null> {
  if (!isVariantPosition(position)) return null;
  if (!isValidVariant(position, rank)) return null;
  let files: string[];
  try {
    files = await readdir(ART_DIR);
  } catch {
    return null;
  }
  const match = files.find(
    (f) => f.startsWith(`${position}-${rank}.`) && isSafeArtFilename(f),
  );
  if (!match) return null;
  return statEntry(match);
}

async function statEntry(
  match: string,
): Promise<{ filename: string; etag: string } | null> {
  try {
    const st = await stat(join(ART_DIR, match));
    const etag = createHash("sha1")
      .update(`${match}:${st.size}:${st.mtimeMs}`)
      .digest("hex")
      .slice(0, 8);
    return { filename: match, etag };
  } catch {
    return null;
  }
}
