import {
  readFile,
  writeFile,
  rename,
  unlink,
  readdir,
  stat,
} from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  canonicalSourceUrl,
  downloadAudio,
  ensureMusicDir,
  getMusicDir,
  type DownloadProgress,
} from "./downloader.js";
import { deleteCoverFor } from "./covers.js";
import { purgeTrackId } from "./queue.js";

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

interface LibraryData {
  tracks: LibraryTrack[];
}

const LIBRARY_FILE = "library.json";

let cache: LibraryData | null = null;
let writeLock: Promise<void> = Promise.resolve();

function libraryPath(): string {
  return join(getMusicDir(), LIBRARY_FILE);
}

async function load(): Promise<LibraryData> {
  if (cache) return cache;
  try {
    const raw = await readFile(libraryPath(), "utf-8");
    cache = JSON.parse(raw) as LibraryData;
  } catch {
    cache = { tracks: [] };
  }
  return cache;
}

async function save(): Promise<void> {
  await ensureMusicDir();
  const tmp = libraryPath() + ".tmp";
  await writeFile(tmp, JSON.stringify(cache, null, 2));
  await rename(tmp, libraryPath());
}

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let resolve: () => void;
  writeLock = new Promise((r) => {
    resolve = r;
  });
  return prev.then(fn).finally(() => resolve!());
}

export async function listTracks(): Promise<LibraryTrack[]> {
  const data = await load();
  return data.tracks;
}

/**
 * Low-level insert — does NOT de-duplicate by source URL. New code that
 * ingests a download should go through `downloadAndStore` instead.
 */
export function addTrack(
  entry: Omit<LibraryTrack, "id">,
): Promise<LibraryTrack> {
  return serialized(async () => {
    const data = await load();
    const id = randomUUID();
    const track: LibraryTrack = { id, ...entry };
    data.tracks.push(track);
    await save();
    return track;
  });
}

export function removeTrack(id: string): Promise<boolean> {
  return serialized(async () => {
    const data = await load();
    const idx = data.tracks.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    const [removed] = data.tracks.splice(idx, 1);
    try {
      await unlink(join(getMusicDir(), removed.filename));
    } catch {
      // file already gone
    }
    await deleteCoverFor(id);
    // Drop any ghost references from playback queues so a now-missing
    // file doesn't sit un-playable in someone's queue.
    purgeTrackId(id);
    await save();
    return true;
  });
}

export async function getTrack(id: string): Promise<LibraryTrack | null> {
  const data = await load();
  return data.tracks.find((t) => t.id === id) ?? null;
}

/**
 * Case-insensitive substring search over title / album / author /
 * sourceUrl / filename. Empty query returns everything.
 */
export async function searchTracks(query: string): Promise<LibraryTrack[]> {
  const data = await load();
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return data.tracks;
  return data.tracks.filter((t) =>
    [t.title, t.album, t.author, t.sourceUrl, t.filename]
      .filter((v): v is string => typeof v === "string")
      .some((v) => v.toLowerCase().includes(q)),
  );
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
export function updateTrack(
  id: string,
  patch: TrackMetadataPatch,
): Promise<LibraryTrack | null> {
  return serialized(async () => {
    const data = await load();
    const track = data.tracks.find((t) => t.id === id);
    if (!track) return null;
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
        if (trimmed) track.title = trimmed;
        return;
      }
      if (trimmed) track[key] = trimmed;
      else delete track[key];
    };
    setStr("title", 200);
    setStr("album", 200);
    setStr("author", 200);
    setStr("coverUrl", 500);
    await save();
    return track;
  });
}

export async function findByFilename(
  filename: string,
): Promise<LibraryTrack | null> {
  const data = await load();
  return data.tracks.find((t) => t.filename === filename) ?? null;
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
  const data = await load();
  const target = canonicalSourceUrl(url);
  return (
    data.tracks.find((t) => canonicalSourceUrl(t.sourceUrl) === target) ?? null
  );
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

export function syncWithDisk(): Promise<void> {
  return serialized(async () => {
    await ensureMusicDir();
    const data = await load();
    const dir = getMusicDir();
    const files = new Set(
      (await readdir(dir)).filter(
        (f) => f !== LIBRARY_FILE && !f.endsWith(".tmp"),
      ),
    );

    data.tracks = data.tracks.filter((t) => files.has(t.filename));

    for (const track of data.tracks) {
      try {
        const s = await stat(join(dir, track.filename));
        track.sizeBytes = s.size;
      } catch {
        track.sizeBytes = null;
      }
    }

    await save();
  });
}
