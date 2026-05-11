/**
 * Pure formatting helpers used by the radio plugin's command handlers.
 * No bot RPC, no state mutation — every input → string output.
 */
import { type LoopMode, type Track, getState } from "./queue.js";
import { STATIONS, findStation } from "./stations.js";

export function formatStationList(): string {
  const lines = STATIONS.map(
    (s) => `• \`${s.key}\` — ${s.name} (${s.description})`,
  );
  return [
    "**Available stations:**",
    ...lines,
    "",
    "_Or paste any direct http(s) audio URL — mp3 / opus / Icecast streams etc._",
  ].join("\n");
}

/**
 * Resolve a `source` argument (station key or full URL) into a Track.
 * Returns null if the source is neither a known station nor a parseable
 * http(s) URL — caller should reply with an error.
 */
export function resolveTrack(
  source: string,
  queuedBy: string | null,
): Track | null {
  const s = source.trim();
  if (!s) return null;
  const station = findStation(s);
  if (station) {
    return { url: station.url, label: station.name, queuedBy };
  }
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const tail = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
  const label = tail ? `${parsed.hostname}/${tail}` : parsed.hostname;
  return { url: s, label, queuedBy };
}

export function loopBadge(loop: LoopMode): string {
  if (loop === "track") return "🔂";
  if (loop === "queue") return "🔁";
  return "▶️";
}

export function formatNowPlaying(
  guildId: string,
  channelId: string | null,
): string {
  const s = getState(guildId);
  if (!s) return "_(nothing playing)_\n_queue empty_";
  const head = s.current
    ? `🎵 **${s.current.label}**${s.current.queuedBy ? ` _(queued by <@${s.current.queuedBy}>)_` : ""}`
    : "_(nothing playing)_";
  const where = channelId ? ` in <#${channelId}>` : "";
  const queueSize = s.queue.length;
  const queueLine =
    queueSize === 0
      ? "_queue empty_"
      : `_queue: ${queueSize} track${queueSize > 1 ? "s" : ""}_`;
  return `${loopBadge(s.loop)} ${head}${where}\n${queueLine}`;
}

export function formatQueueList(guildId: string): string {
  const s = getState(guildId);
  if (!s) return "**Now:** _(nothing)_\n_(queue empty)_\nLoop: `off`";
  const lines: string[] = [];
  lines.push(
    s.current
      ? `**Now:** ${s.current.label}${s.current.queuedBy ? ` (<@${s.current.queuedBy}>)` : ""}`
      : "**Now:** _(nothing)_",
  );
  if (s.queue.length === 0) {
    lines.push("_(queue empty)_");
  } else {
    s.queue.slice(0, 15).forEach((t, i) => {
      lines.push(
        `${i + 1}. ${t.label}${t.queuedBy ? ` (<@${t.queuedBy}>)` : ""}`,
      );
    });
    if (s.queue.length > 15) {
      lines.push(`… and ${s.queue.length - 15} more`);
    }
  }
  lines.push(`Loop: \`${s.loop}\``);
  return lines.join("\n");
}
