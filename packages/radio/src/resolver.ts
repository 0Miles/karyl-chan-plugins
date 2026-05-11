/**
 * Turning a "source" (a string the user typed, or a stored queue
 * entry) into something the bot can actually play.
 *
 *   resolveAnyTrack(source)        — one Track from a library id/title,
 *                                    a previously-downloaded URL, a
 *                                    YouTube URL (→ live stream), or a
 *                                    station / direct http(s) URL.
 *   resolvePlaylist(url)           — many *lazy* Tracks from a YouTube
 *                                    playlist URL (each `needsResolve`).
 *   playTrack(track, voicePlay)    — resolve (if `needsResolve`) + play a
 *                                    queued Track; returns a PlayOutcome
 *                                    (ok / unresolvable / play-failed).
 *
 * Lives in its own module (no Fastify deps) so the slash-command layer
 * (plugin.ts), the WebUI layer (web-routes.ts) and the advance loop all
 * share one implementation.
 */
import type { Track } from "./queue.js";
import {
  isHttpUrl,
  isYouTubeUrl,
  isYouTubePlaylistUrl,
  resolvePlaylistEntries,
  resolveYouTubeStreamUrl,
} from "./downloader.js";
import { findBySourceUrl, getTrack, searchTracks } from "./library.js";
import { resolveTrack } from "./format.js";

/** Docker-internal URL the bot uses to stream library files (voice.play). */
const PLUGIN_URL = (process.env.PLUGIN_URL || "http://localhost:3000").replace(
  /\/+$/,
  "",
);

/** Turn a stored library track into a playable Track (served from disk). */
export function libraryTrackToTrack(
  t: { id: string; filename: string; title: string; coverUrl?: string },
  userId: string | null,
): Track {
  return {
    url: `${PLUGIN_URL}/internal/audio/${encodeURIComponent(t.filename)}`,
    label: t.title,
    queuedBy: userId,
    trackId: t.id,
    ...(t.coverUrl ? { coverUrl: t.coverUrl } : {}),
  };
}

export { isYouTubePlaylistUrl };

/**
 * Resolve a single `source` into a playable Track. Order:
 *   1. library track by id, then by title substring
 *   2. if `source` is a URL we've already downloaded → that local file
 *   3. else if it's a YouTube URL → resolved to a direct audio stream
 *   4. else → radio station / arbitrary http(s) URL streamed as-is
 * Returns null when nothing matches; **throws** if a YouTube URL fails
 * to resolve (so callers can surface why).
 */
export async function resolveAnyTrack(
  source: string,
  userId: string | null,
): Promise<Track | null> {
  const s = (source ?? "").trim();
  if (!s) return null;
  const library = await searchTracks("");
  const byNameOrId =
    library.find((t) => t.id === s) ??
    library.find((t) => t.title.toLowerCase().includes(s.toLowerCase()));
  if (byNameOrId) return libraryTrackToTrack(byNameOrId, userId);

  if (isHttpUrl(s)) {
    const downloaded = await findBySourceUrl(s);
    if (downloaded) return libraryTrackToTrack(downloaded, userId);
  }
  if (isYouTubeUrl(s)) {
    const r = await resolveYouTubeStreamUrl(s);
    return {
      url: r.streamUrl,
      label: r.title,
      queuedBy: userId,
      ...(r.coverUrl ? { coverUrl: r.coverUrl } : {}),
    };
  }
  return resolveTrack(s, userId);
}

/**
 * Expand a YouTube playlist URL into queue-ready Tracks. Each is *lazy*
 * (`needsResolve: true`, `url` = the watch URL) — call
 * `resolveTrackForPlayback` right before playing it. Throws on yt-dlp
 * failure; returns [] for an empty / unavailable playlist.
 */
export async function resolvePlaylist(
  playlistUrl: string,
  userId: string | null,
): Promise<Track[]> {
  const entries = await resolvePlaylistEntries(playlistUrl);
  return entries.map((e) => ({
    url: e.url,
    label: e.title,
    queuedBy: userId,
    needsResolve: true,
  }));
}

/**
 * Outcome of trying to play a track:
 *  - ok          → it's playing; `track` is what to store as `current`
 *  - unresolvable → a lazy entry that couldn't be resolved — drop it
 *  - play-failed  → resolved fine but `voice.play` failed — re-queue & retry
 */
export type PlayOutcome =
  | { ok: true; track: Track }
  | { ok: false; reason: "unresolvable" }
  | { ok: false; reason: "play-failed" };

/**
 * Resolve `track` (re-fetching a fresh stream URL if `needsResolve`) and
 * play it via `voicePlay`. The single place that turns a queued Track into
 * an actual `voice.play` — used by the slash commands, the WebUI session
 * routes and the auto-advance loop.
 *
 * For a `needsResolve` YouTube entry that resolves to a stream (not a
 * since-downloaded local file), the returned `track` keeps `needsResolve`
 * and the original watch URL — so on the next cycle (loop=queue), replay
 * (loop=track) or `/radio back`, it re-resolves a *fresh* stream URL
 * instead of replaying the now-expired one. Only fresher metadata
 * (title / cover) is merged in.
 */
export async function playTrack(
  track: Track,
  voicePlay: (url: string) => Promise<unknown | null>,
): Promise<PlayOutcome> {
  let playUrl: string;
  let toStore: Track;
  if (!track.needsResolve) {
    // A library-sourced entry whose track was deleted since it was
    // queued → its file is gone; drop it rather than 404 on every retry.
    // (Lazy `needsResolve` entries never carry a `trackId`, so this only
    // matters on the non-lazy branch.)
    if (track.trackId && !(await getTrack(track.trackId))) {
      return { ok: false, reason: "unresolvable" };
    }
    playUrl = track.url;
    toStore = track;
  } else {
    let resolved: Track | null;
    try {
      resolved = await resolveAnyTrack(track.url, track.queuedBy);
    } catch {
      return { ok: false, reason: "unresolvable" };
    }
    if (!resolved) return { ok: false, reason: "unresolvable" };
    if (resolved.trackId) {
      // It's been downloaded since — the local file is stable, stop being lazy.
      playUrl = resolved.url;
      toStore = { ...resolved, queuedBy: track.queuedBy };
    } else {
      playUrl = resolved.url;
      toStore = {
        url: track.url, // keep the watch URL — re-resolvable next time
        label: resolved.label,
        queuedBy: track.queuedBy,
        needsResolve: true,
        ...(resolved.coverUrl ? { coverUrl: resolved.coverUrl } : {}),
      };
    }
  }
  const res = await Promise.resolve(voicePlay(playUrl)).catch(() => null);
  if (!res) return { ok: false, reason: "play-failed" };
  return { ok: true, track: toStore };
}
