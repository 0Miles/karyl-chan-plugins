import { unlink, readdir, stat } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  canonicalSourceUrl,
  downloadAudio,
  getMusicDir,
  type DownloadProgress,
} from "./downloader.js";
import { deleteCoverFor } from "./covers.js";
import { purgeTrackId } from "./queue.js";
import { getDb } from "./db.js";

export interface LibraryTrack {
  id: string;
  filename: string;
  title: string;
  /** Editable metadata — optional, absent on tracks added before this feature. */
  album?: string;
  author?: string;
  /** Cover image URL (any http(s) image). */
  coverUrl?: string;
  sourceUrl: string;
  duration: number | null;
  addedBy: string;
  addedAt: number;
  sizeBytes: number | null;
}

/** Fields an admin may edit via the WebUI. */
export interface TrackMetadataPatch {
  title?: string;
  album?: string;
  author?: string;
  coverUrl?: string;
}

interface TrackRow {
  id: string;
  filename: string;
  title: string;
  album: string | null;
  author: string | null;
  cover_url: string | null;
  source_url: string;
  duration: number | null;
  added_by: string;
  added_at: number;
  size_bytes: number | null;
}

function rowToTrack(r: TrackRow): LibraryTrack {
  const t: LibraryTrack = {
    id: r.id,
    filename: r.filename,
    title: r.title,
    sourceUrl: r.source_url,
    duration: r.duration,
    addedBy: r.added_by,
    addedAt: r.added_at,
    sizeBytes: r.size_bytes,
  };
  if (r.album) t.album = r.album;
  if (r.author) t.author = r.author;
  if (r.cover_url) t.coverUrl = r.cover_url;
  return t;
}

export async function listTracks(): Promise<LibraryTrack[]> {
  const rows = getDb()
    .prepare("SELECT * FROM tracks ORDER BY added_at")
    .all() as TrackRow[];
  return rows.map(rowToTrack);
}

/**
 * Low-level insert — does NOT de-duplicate by source URL. New code that
 * ingests a download should go through `downloadAndStore` instead.
 */
export async function addTrack(
  entry: Omit<LibraryTrack, "id">,
): Promise<LibraryTrack> {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO tracks (id, filename, title, album, author, cover_url,
                           source_url, duration, added_by, added_at, size_bytes)
       VALUES (@id, @filename, @title, @album, @author, @cover_url,
               @source_url, @duration, @added_by, @added_at, @size_bytes)`,
    )
    .run({
      id,
      filename: entry.filename,
      title: entry.title,
      album: entry.album ?? null,
      author: entry.author ?? null,
      cover_url: entry.coverUrl ?? null,
      source_url: entry.sourceUrl,
      duration: entry.duration,
      added_by: entry.addedBy,
      added_at: entry.addedAt,
      size_bytes: entry.sizeBytes,
    });
  return { id, ...entry };
}

export async function removeTrack(id: string): Promise<boolean> {
  const row = getDb()
    .prepare("SELECT filename FROM tracks WHERE id = ?")
    .get(id) as { filename: string } | undefined;
  if (!row) return false;
  getDb().prepare("DELETE FROM tracks WHERE id = ?").run(id);
  try {
    await unlink(join(getMusicDir(), row.filename));
  } catch {
    // file already gone
  }
  await deleteCoverFor(id);
  // Drop any ghost references from playback queues so a now-missing
  // file doesn't sit un-playable in someone's queue.
  purgeTrackId(id);
  return true;
}

export async function getTrack(id: string): Promise<LibraryTrack | null> {
  const row = getDb()
    .prepare("SELECT * FROM tracks WHERE id = ?")
    .get(id) as TrackRow | undefined;
  return row ? rowToTrack(row) : null;
}

/**
 * Case-insensitive substring search over title / album / author /
 * sourceUrl / filename. Empty query returns everything.
 */
export async function searchTracks(query: string): Promise<LibraryTrack[]> {
  const q = (query ?? "").trim();
  if (!q) return listTracks();
  const like = "%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const rows = getDb()
    .prepare(
      `SELECT * FROM tracks
       WHERE title       LIKE ? ESCAPE '\\'
          OR album       LIKE ? ESCAPE '\\'
          OR author      LIKE ? ESCAPE '\\'
          OR source_url  LIKE ? ESCAPE '\\'
          OR filename    LIKE ? ESCAPE '\\'
       ORDER BY added_at`,
    )
    .all(like, like, like, like, like) as TrackRow[];
  return rows.map(rowToTrack);
}

/** Reject characters that break out of an HTML attribute when rendered. */
const URL_UNSAFE_CHARS = /["'<>\s\\]/;

function isSafeImageUrl(s: string): boolean {
  if (URL_UNSAFE_CHARS.test(s)) return false;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  return u.protocol === "http:" || u.protocol === "https:";
}

/**
 * Update editable metadata on a track. Unknown / empty patch fields are
 * ignored; an empty string clears that field. Returns the updated track
 * or null if the id is unknown. Throws on invalid input (caller maps to 400).
 */
export async function updateTrack(
  id: string,
  patch: TrackMetadataPatch,
): Promise<LibraryTrack | null> {
  const current = await getTrack(id);
  if (!current) return null;
  const next: LibraryTrack = { ...current };
  const setStr = (
    key: "title" | "album" | "author" | "coverUrl",
    max: number,
  ): void => {
    const v = patch[key];
    if (v === undefined) return;
    if (typeof v !== "string") throw new Error(`${key} must be a string`);
    const trimmed = v.trim();
    if (trimmed.length > max) throw new Error(`${key} too long (max ${max})`);
    if (key === "coverUrl" && trimmed && !isSafeImageUrl(trimmed)) {
      throw new Error("coverUrl must be a plain http(s) URL");
    }
    if (key === "title") {
      // Title can't be blanked — fall back to keeping the old one.
      if (trimmed) next.title = trimmed;
      return;
    }
    if (trimmed) next[key] = trimmed;
    else delete next[key];
  };
  setStr("title", 200);
  setStr("album", 200);
  setStr("author", 200);
  setStr("coverUrl", 500);
  getDb()
    .prepare(
      `UPDATE tracks
         SET title = @title, album = @album, author = @author, cover_url = @cover_url
       WHERE id = @id`,
    )
    .run({
      id,
      title: next.title,
      album: next.album ?? null,
      author: next.author ?? null,
      cover_url: next.coverUrl ?? null,
    });
  return next;
}

export async function findByFilename(
  filename: string,
): Promise<LibraryTrack | null> {
  const row = getDb()
    .prepare("SELECT * FROM tracks WHERE filename = ?")
    .get(filename) as TrackRow | undefined;
  return row ? rowToTrack(row) : null;
}

/**
 * Find a track that was downloaded from `url`. Comparison is on the
 * canonical form, so e.g. `https://youtu.be/X`, `…/watch?v=X&t=5` and
 * `…/watch?v=X` all match the same library entry — including entries
 * stored before URL canonicalization existed (their `sourceUrl` was
 * always a full `https://…` URL, so it canonicalizes the same way).
 */
export async function findBySourceUrl(
  url: string,
): Promise<LibraryTrack | null> {
  const target = canonicalSourceUrl(url);
  // Fast path: exact match (tracks added since canonicalization).
  const exact = getDb()
    .prepare("SELECT * FROM tracks WHERE source_url = ?")
    .get(target) as TrackRow | undefined;
  if (exact) return rowToTrack(exact);
  // Fallback: pre-canonical rows — canonicalize each candidate. This is
  // O(n) but only hits when the index missed.
  const rows = getDb().prepare("SELECT * FROM tracks").all() as TrackRow[];
  const match = rows.find((r) => canonicalSourceUrl(r.source_url) === target);
  return match ? rowToTrack(match) : null;
}

// In-flight downloads keyed by canonical source URL — a second request
// for the same URL (whether from /radio download or the WebUI) joins the
// running one instead of starting a duplicate.
const inFlightDownloads = new Map<
  string,
  Promise<{ track: LibraryTrack; alreadyExisted: boolean }>
>();

/**
 * Ensure `url` is in the library: returns the existing track if it was
 * already downloaded (no re-download), otherwise downloads it (yt-dlp →
 * opus), records it, and returns the new track. `alreadyExisted`
 * distinguishes the two for the caller's reply.
 */
export function downloadAndStore(
  url: string,
  addedBy: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<{ track: LibraryTrack; alreadyExisted: boolean }> {
  const canonical = canonicalSourceUrl(url);
  const running = inFlightDownloads.get(canonical);
  if (running) return running;
  const job = (async () => {
    const existing = await findBySourceUrl(canonical);
    if (existing) return { track: existing, alreadyExisted: true };
    const result = await downloadAudio(url, onProgress);
    const sizeBytes = await stat(result.filepath)
      .then((s) => s.size)
      .catch(() => null);
    const track = await addTrack({
      filename: result.filename,
      title: result.title,
      sourceUrl: canonical,
      duration: result.duration,
      addedBy,
      addedAt: Date.now(),
      sizeBytes,
      // Auto-record the source thumbnail (YouTube etc.) as the cover.
      ...(result.coverUrl ? { coverUrl: result.coverUrl } : {}),
    });
    return { track, alreadyExisted: false };
  })().finally(() => inFlightDownloads.delete(canonical));
  inFlightDownloads.set(canonical, job);
  return job;
}

/**
 * Reconcile the tracks table with what's on disk: drop rows whose audio
 * file has vanished, and refresh `size_bytes` for the survivors. Run
 * once on web-route registration so a manual file deletion doesn't leave
 * a ghost row that 404s on stream.
 */
export async function syncWithDisk(): Promise<void> {
  const dir = getMusicDir();
  const files = new Set(
    (await readdir(dir).catch(() => [] as string[])).filter(
      (f) => !f.endsWith(".tmp") && !f.endsWith(".migrated"),
    ),
  );
  const rows = getDb()
    .prepare("SELECT id, filename FROM tracks")
    .all() as Array<{ id: string; filename: string }>;
  const del = getDb().prepare("DELETE FROM tracks WHERE id = ?");
  const updateSize = getDb().prepare(
    "UPDATE tracks SET size_bytes = ? WHERE id = ?",
  );
  const survivors: Array<{ id: string; filename: string }> = [];
  const tx = getDb().transaction(() => {
    for (const r of rows) {
      if (!files.has(r.filename)) del.run(r.id);
      else survivors.push(r);
    }
  });
  tx();
  for (const r of survivors) {
    try {
      const s = await stat(join(dir, r.filename));
      updateSize.run(s.size, r.id);
    } catch {
      updateSize.run(null, r.id);
    }
  }
}
