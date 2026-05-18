import { createHash } from "crypto";
import { mkdir, readdir, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";
import type { Position } from "./game/roles.js";

/**
 * Storage for admin-uploaded role artwork. One image per role; named
 * `<position>.<ext>` so a re-upload of the same role replaces the
 * previous file (with cache-busting via mtime-stamped URL).
 *
 * Lives outside the container's read-only app code on a Docker volume
 * — see `avalon-art` in docker-compose.yml — so an image survives
 * container rebuilds.
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
]);

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

const ART_FILENAME_RE = /^[a-z][a-z-]*\.(jpe?g|png|webp|gif)$/i;

export function isSafeArtFilename(name: string): boolean {
  return (
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("..") &&
    ART_FILENAME_RE.test(name)
  );
}

export function artFilePath(filename: string): string {
  return join(ART_DIR, filename);
}

async function ensureArtDir(): Promise<void> {
  await mkdir(ART_DIR, { recursive: true });
}

/** Delete every existing `<position>.<ext>` file (best-effort). */
async function deleteArtFor(position: Position): Promise<void> {
  try {
    const files = await readdir(ART_DIR);
    await Promise.all(
      files
        .filter((f) => f.startsWith(`${position}.`))
        .map((f) => unlink(join(ART_DIR, f)).catch(() => undefined)),
    );
  } catch {
    // dir doesn't exist yet — nothing to clean
  }
}

export async function saveArt(
  position: Position,
  buffer: Buffer,
  ext: string,
): Promise<string> {
  await ensureArtDir();
  await deleteArtFor(position);
  const filename = `${position}.${ext}`;
  await writeFile(join(ART_DIR, filename), buffer);
  return filename;
}

export async function removeArt(position: Position): Promise<boolean> {
  let removed = false;
  try {
    const files = await readdir(ART_DIR);
    for (const f of files.filter((f) => f.startsWith(`${position}.`))) {
      await unlink(join(ART_DIR, f)).catch(() => undefined);
      removed = true;
    }
  } catch {
    // nothing
  }
  return removed;
}

export interface RoleArtEntry {
  position: Position;
  filename: string;
  size: number;
  mtimeMs: number;
}

/**
 * List every stored role-art file. The deal-reveal renderer + the
 * WebUI both read this to know which role has art on disk.
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
    const dot = f.indexOf(".");
    const pos = f.slice(0, dot);
    if (!isValidPosition(pos)) continue;
    try {
      const st = await stat(join(ART_DIR, f));
      out.push({
        position: pos,
        filename: f,
        size: st.size,
        mtimeMs: st.mtimeMs,
      });
    } catch {
      // race with delete — skip
    }
  }
  return out;
}

/**
 * Locate the most recent art file for `position` (or null). Used by
 * the deal-reveal renderer to slap a thumbnail on the role card and
 * by the GET /art/:position resolver. Returns the filename plus a
 * short content hash so the public URL changes whenever bytes change
 * (defeats the bot/CDN cache without us tracking versions manually).
 */
export async function findArt(
  position: Position,
): Promise<{ filename: string; etag: string } | null> {
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
