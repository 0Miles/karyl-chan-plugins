import { readFile, writeFile, rename } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { ensureMusicDir, getMusicDir } from "./downloader.js";

/**
 * User-curated playlists — an admin names a list and pastes / picks a
 * sequence of "source" strings (anything `/radio play` accepts: a
 * library track id, an external URL, a station key, …). At play time
 * each entry is resolved through the same dispatch as the slash
 * command, and the resulting Tracks are bulk-enqueued.
 *
 * Lives alongside library.json under MUSIC_DIR — same serialized-write
 * + atomic-rename pattern as library.ts, but its own file so editing
 * a playlist never racks the library cache or risks corrupting it.
 */

export interface Playlist {
  id: string;
  /** Trimmed display name. Case-insensitive unique across the store. */
  name: string;
  description?: string;
  /**
   * Ordered free-form source strings. Each is fed through
   * `resolveAnyTrack` at play time — entries that fail to resolve are
   * skipped, so a deleted library track or a dead URL doesn't break
   * the whole playlist.
   */
  entries: string[];
  /** Discord user id who created it. */
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlaylistPatch {
  name?: string;
  description?: string;
  entries?: string[];
}

interface PlaylistData {
  playlists: Playlist[];
}

const PLAYLISTS_FILE = "playlists.json";
const MAX_NAME = 80;
const MAX_DESC = 500;
const MAX_ENTRY = 500;
const MAX_ENTRIES = 500;

let cache: PlaylistData | null = null;
let writeLock: Promise<void> = Promise.resolve();

function playlistPath(): string {
  return join(getMusicDir(), PLAYLISTS_FILE);
}

async function load(): Promise<PlaylistData> {
  if (cache) return cache;
  try {
    const raw = await readFile(playlistPath(), "utf-8");
    cache = JSON.parse(raw) as PlaylistData;
  } catch {
    cache = { playlists: [] };
  }
  return cache;
}

async function save(): Promise<void> {
  await ensureMusicDir();
  const tmp = playlistPath() + ".tmp";
  await writeFile(tmp, JSON.stringify(cache, null, 2));
  await rename(tmp, playlistPath());
}

function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let resolve: () => void;
  writeLock = new Promise((r) => {
    resolve = r;
  });
  return prev.then(fn).finally(() => resolve!());
}

function normaliseName(s: string): string {
  return s.trim().toLowerCase();
}

function validateEntries(entries: unknown): string[] {
  if (!Array.isArray(entries)) throw new Error("entries must be an array");
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`Too many entries (max ${MAX_ENTRIES})`);
  }
  const out: string[] = [];
  for (const e of entries) {
    if (typeof e !== "string") throw new Error("Each entry must be a string");
    const trimmed = e.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_ENTRY) {
      throw new Error(`Entry too long (max ${MAX_ENTRY} chars)`);
    }
    out.push(trimmed);
  }
  return out;
}

function validateName(
  name: unknown,
  data: PlaylistData,
  excludeId?: string,
): string {
  if (typeof name !== "string") throw new Error("name must be a string");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("name is required");
  if (trimmed.length > MAX_NAME) {
    throw new Error(`name too long (max ${MAX_NAME})`);
  }
  const key = normaliseName(trimmed);
  const clash = data.playlists.find(
    (p) => normaliseName(p.name) === key && p.id !== excludeId,
  );
  if (clash) throw new Error(`A playlist named "${clash.name}" already exists`);
  return trimmed;
}

function validateDescription(desc: unknown): string | undefined {
  if (desc === undefined) return undefined;
  if (typeof desc !== "string") throw new Error("description must be a string");
  const trimmed = desc.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_DESC) {
    throw new Error(`description too long (max ${MAX_DESC})`);
  }
  return trimmed;
}

export async function listPlaylists(): Promise<Playlist[]> {
  const data = await load();
  return data.playlists;
}

export async function getPlaylist(id: string): Promise<Playlist | null> {
  const data = await load();
  return data.playlists.find((p) => p.id === id) ?? null;
}

/** Case-insensitive name lookup — the slash-command entry point. */
export async function findPlaylistByName(
  name: string,
): Promise<Playlist | null> {
  const key = normaliseName(name);
  if (!key) return null;
  const data = await load();
  return data.playlists.find((p) => normaliseName(p.name) === key) ?? null;
}

export function addPlaylist(input: {
  name: string;
  description?: string;
  entries?: string[];
  createdBy: string;
}): Promise<Playlist> {
  return serialized(async () => {
    const data = await load();
    const name = validateName(input.name, data);
    const description = validateDescription(input.description);
    const entries = validateEntries(input.entries ?? []);
    const now = Date.now();
    const playlist: Playlist = {
      id: randomUUID(),
      name,
      ...(description ? { description } : {}),
      entries,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    data.playlists.push(playlist);
    await save();
    return playlist;
  });
}

export function updatePlaylist(
  id: string,
  patch: PlaylistPatch,
): Promise<Playlist | null> {
  return serialized(async () => {
    const data = await load();
    const playlist = data.playlists.find((p) => p.id === id);
    if (!playlist) return null;
    if (patch.name !== undefined) {
      playlist.name = validateName(patch.name, data, id);
    }
    if (patch.description !== undefined) {
      const v = validateDescription(patch.description);
      if (v) playlist.description = v;
      else delete playlist.description;
    }
    if (patch.entries !== undefined) {
      playlist.entries = validateEntries(patch.entries);
    }
    playlist.updatedAt = Date.now();
    await save();
    return playlist;
  });
}

export function removePlaylist(id: string): Promise<boolean> {
  return serialized(async () => {
    const data = await load();
    const idx = data.playlists.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    data.playlists.splice(idx, 1);
    await save();
    return true;
  });
}
