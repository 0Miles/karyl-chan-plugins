import { spawn } from "child_process";
import { mkdir } from "fs/promises";
import { join } from "path";

export interface DownloadResult {
  filename: string;
  title: string;
  /** Thumbnail URL from the source (YouTube etc.), recorded as the track's cover. */
  coverUrl?: string;
  duration: number | null;
  filepath: string;
}

/** http(s) URL with no characters that would break out of an HTML attribute. */
const SAFE_HTTPS_URL_RE = /^https?:\/\/[^\s"'<>\\]+$/i;

export interface DownloadProgress {
  percent: number;
  speed: string;
  eta: string;
}

/** A YouTube URL resolved to a directly-streamable audio URL (+ metadata). */
export interface ResolvedStream {
  /** Direct CDN media URL ffmpeg can read. Time-limited (~hours). */
  streamUrl: string;
  title: string;
  /** Thumbnail URL, if YouTube provided a plain http(s) one. */
  coverUrl?: string;
  duration: number | null;
}

const MUSIC_DIR = process.env.MUSIC_DIR || "/app/data/music";

export function getMusicDir(): string {
  return MUSIC_DIR;
}

export async function ensureMusicDir(): Promise<void> {
  await mkdir(MUSIC_DIR, { recursive: true });
}

/** Characters that are illegal in file names on common filesystems. */
const ILLEGAL_FILENAME_CHARS = new Set('<>:"/\\|?*');

function sanitizeFilename(name: string): string {
  // Replace the illegal characters above and any ASCII control character
  // (0x00–0x1F) with "_", then cap the length. Done char-by-char rather
  // than with a regex so there's no literal control character inside a
  // pattern.
  let out = "";
  for (const ch of name) {
    out += ILLEGAL_FILENAME_CHARS.has(ch) || ch.charCodeAt(0) < 0x20 ? "_" : ch;
  }
  return out.slice(0, 200);
}

export async function downloadAudio(
  url: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<DownloadResult> {
  await ensureMusicDir();

  const infoArgs = [
    "--no-download",
    "--no-playlist",
    "--no-warnings",
    "--print",
    "%(title)s",
    "--print",
    "%(thumbnail)s",
    "--print",
    "%(duration)s",
    url,
  ];

  const info = await runYtDlp(infoArgs);
  const lines = info.split("\n").map((l) => l.trim());
  const title = lines[0] && lines[0] !== "NA" ? lines[0] : "untitled";
  const thumb = lines[1];
  const coverUrl =
    thumb && thumb !== "NA" && SAFE_HTTPS_URL_RE.test(thumb)
      ? thumb
      : undefined;
  const durNum = Number(lines[2]);
  const duration = Number.isFinite(durNum) && durNum > 0 ? durNum : null;
  const safeTitle = sanitizeFilename(title);
  const filename = `${safeTitle}-${Date.now()}.opus`;
  const filepath = join(MUSIC_DIR, filename);

  const dlArgs = [
    "-x",
    "--audio-format",
    "opus",
    "--audio-quality",
    "128K",
    "-o",
    filepath,
    "--no-playlist",
    "--no-overwrites",
    "--newline",
    url,
  ];

  // The actual download + transcode can legitimately take minutes.
  await runYtDlp(dlArgs, onProgress, 15 * 60_000);

  return {
    filename,
    title,
    duration,
    filepath,
    ...(coverUrl ? { coverUrl } : {}),
  };
}

/**
 * Resolve a YouTube (or other yt-dlp-supported) page URL into a direct
 * audio stream URL ffmpeg can play, plus the title / thumbnail / duration.
 * Throws if yt-dlp fails or returns nothing usable. The stream URL is
 * signed and time-limited — fine for immediate playback, not for tracks
 * that may sit queued for hours (use `/radio download` for those).
 */
export async function resolveYouTubeStreamUrl(
  url: string,
): Promise<ResolvedStream> {
  const out = await runYtDlp([
    "-f",
    "bestaudio[ext=webm]/bestaudio/best",
    "--no-playlist",
    "--no-warnings",
    "--print",
    "%(title)s",
    "--print",
    "%(thumbnail)s",
    "--print",
    "%(duration)s",
    "--print",
    "%(urls)s",
    url,
  ]);
  const lines = out.split("\n").map((l) => l.trim());
  // Output order matches the --print flags above; the stream URL(s) is
  // last (may be >1 line if the chosen "format" is split — take the first).
  const streamUrl = lines.filter((l) => SAFE_HTTPS_URL_RE.test(l)).pop() ?? "";
  if (!streamUrl) {
    throw new Error("yt-dlp returned no playable stream URL");
  }
  const title = lines[0] && lines[0] !== "NA" ? lines[0] : "YouTube audio";
  const thumb = lines[1];
  const coverUrl =
    thumb && thumb !== "NA" && SAFE_HTTPS_URL_RE.test(thumb)
      ? thumb
      : undefined;
  const durNum = Number(lines[2]);
  const duration = Number.isFinite(durNum) && durNum > 0 ? durNum : null;
  return { streamUrl, title, ...(coverUrl ? { coverUrl } : {}), duration };
}

/** One entry of an expanded playlist (flat — no per-video network fetch). */
export interface PlaylistEntry {
  /** Canonical watch URL, e.g. https://www.youtube.com/watch?v=<id>. */
  url: string;
  title: string;
}

/** Hard cap on how many playlist entries we expand into the queue. */
export const PLAYLIST_MAX_ENTRIES = 100;

/**
 * Expand a YouTube playlist URL into its entries (flat — fast, no
 * per-video extraction). Capped at PLAYLIST_MAX_ENTRIES. Throws if
 * yt-dlp fails; returns [] if the playlist is empty / unavailable.
 */
export async function resolvePlaylistEntries(
  playlistUrl: string,
): Promise<PlaylistEntry[]> {
  const out = await runYtDlp([
    "--flat-playlist",
    "--no-warnings",
    "--playlist-end",
    String(PLAYLIST_MAX_ENTRIES),
    "--print",
    "%(url)s",
    "--print",
    "%(title)s",
    playlistUrl,
  ]);
  // Each entry prints exactly two lines: <url>\n<title> (YouTube titles
  // never contain newlines). Pair them up; skip any entry whose first
  // line isn't an http(s) URL (defensive against unexpected output).
  const lines = out.split("\n").map((l) => l.trim());
  const entries: PlaylistEntry[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const url = lines[i];
    const title = lines[i + 1];
    if (!SAFE_HTTPS_URL_RE.test(url)) {
      // Output drifted (or a blank trailing line) — re-sync by stepping 1.
      i -= 1;
      continue;
    }
    entries.push({
      url,
      title: title && title !== "NA" ? title : "YouTube video",
    });
  }
  return entries;
}

/** Default hard timeout for a yt-dlp invocation (the long download path
 *  passes a bigger value explicitly). Without this a hung yt-dlp could
 *  block the 5 s advance loop forever. */
const DEFAULT_YTDLP_TIMEOUT_MS = 120_000;

function runYtDlp(
  args: string[],
  onProgress?: (p: DownloadProgress) => void,
  timeoutMs: number = DEFAULT_YTDLP_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish(() =>
        reject(
          new Error(`yt-dlp timed out after ${Math.round(timeoutMs / 1000)}s`),
        ),
      );
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (onProgress) {
        const match = text.match(
          /\[download\]\s+([\d.]+)%.*?at\s+(\S+).*?ETA\s+(\S+)/,
        );
        if (match) {
          onProgress({
            percent: parseFloat(match[1]),
            speed: match[2],
            eta: match[3],
          });
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      finish(() => {
        if (code === 0) resolve(stdout);
        else
          reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(0, 500)}`));
      });
    });

    proc.on("error", (err) => {
      finish(() => reject(new Error(`Failed to spawn yt-dlp: ${err.message}`)));
    });
  });
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.hostname === "youtube.com" ||
      u.hostname === "www.youtube.com" ||
      u.hostname === "m.youtube.com" ||
      u.hostname === "youtu.be" ||
      u.hostname === "music.youtube.com"
    );
  } catch {
    return false;
  }
}

/** True iff `s` parses as an http(s) URL — the gate for "/radio download". */
export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * True iff `s` is a YouTube **playlist** URL — `…/playlist?list=<id>`.
 * A `watch?v=X&list=Y` is deliberately NOT a playlist here (it's the
 * single video X); paste the `/playlist?list=` form to queue the list.
 */
export function isYouTubePlaylistUrl(s: string): boolean {
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  if (!isYouTubeUrl(s)) return false;
  return (
    u.pathname.replace(/\/+$/, "") === "/playlist" &&
    !!u.searchParams.get("list")
  );
}

/** Extract the 11-char YouTube video id from a watch / youtu.be / embed URL. */
function youtubeVideoId(u: URL): string | null {
  if (u.hostname === "youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  }
  const v = u.searchParams.get("v");
  if (v && /^[\w-]{11}$/.test(v)) return v;
  // /embed/<id>, /shorts/<id>, /v/<id> — anchor the segment end so a
  // longer (junk-padded) path can't be silently truncated to 11 chars.
  const m = u.pathname.match(/^\/(?:embed|shorts|v)\/([\w-]{11})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

/**
 * Canonicalize a source URL for de-duplication. YouTube links (any of
 * the watch / youtu.be / embed / shorts / music forms, with or without
 * extra `&t=` / `&list=` params) collapse to
 * `https://www.youtube.com/watch?v=<id>`. Other URLs just have their
 * fragment stripped. Non-URL input is returned trimmed, unchanged.
 */
export function canonicalSourceUrl(url: string): string {
  const trimmed = (url ?? "").trim();
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }
  const ytHosts = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
  ]);
  if (ytHosts.has(u.hostname)) {
    const id = youtubeVideoId(u);
    if (id) return `https://www.youtube.com/watch?v=${id}`;
  }
  u.hash = "";
  return u.href;
}
