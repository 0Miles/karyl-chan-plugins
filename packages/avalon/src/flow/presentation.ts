import type { VisionMarker } from "../game/vision.js";

/**
 * Shared rendering helpers used by every stage's board / ephemeral
 * card. Kept in its own module so stages can import from each other
 * without dragging in a circular `stages.ts ↔ stages-appoint.ts`.
 */

export function markerEmoji(marker: VisionMarker): string {
  switch (marker) {
    case "self":
      return "👤";
    case "red":
      return "🔴";
    case "blue":
      return "🔵";
    case "purple":
      return "🟣";
    case "unknown":
      return "⬜";
  }
}

const SEAT_EMOJI = [
  "1️⃣",
  "2️⃣",
  "3️⃣",
  "4️⃣",
  "5️⃣",
  "6️⃣",
  "7️⃣",
  "8️⃣",
  "9️⃣",
  "🔟",
];

export function seatEmoji(seat: number): string {
  return SEAT_EMOJI[seat - 1] ?? `[${seat}]`;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
