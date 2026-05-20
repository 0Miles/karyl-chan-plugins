import { componentCustomId } from "@karyl-chan/plugin-sdk";
import { PLUGIN_KEY } from "../constants.js";
import { t } from "../i18n/index.js";
import type { VisionMarker } from "../game/vision.js";
import type { GameState } from "../game/state.js";
import type { DiscordActionRow } from "./discord.js";

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

/**
 * Five-slot mission progress bar. 🔵 a mission the blue side won, 🔴 a
 * mission the red side won, 🔲 the round currently in play, ▫️ a round
 * not yet started.
 *
 * Includes a final rejection-counter chunk (`⚠ n/5`) when the round
 * has open rejection bookings — important context for the public-vote
 * stage, where a 5th rejection ends the game.
 */
export function missionProgressLine(state: GameState): string {
  const slots: string[] = [];
  for (let i = 0; i < 5; i++) {
    const r = state.missionResults[i];
    if (r === "success") slots.push("🔵");
    else if (r === "fail") slots.push("🔴");
    else if (i + 1 === state.round && state.stage !== "ended") slots.push("🔲");
    else slots.push("▫️");
  }
  const base = slots.join(" ");
  if (state.consecutiveRejections > 0 && state.stage !== "ended") {
    return `${base}  ·  ⚠ ${state.consecutiveRejections}/5`;
  }
  return base;
}

/** Per-faction embed accent color, used by the ending board. */
export const FACTION_COLOR = {
  arthur: 0x458588, // soft blue
  mordred: 0xcc241d, // soft red
} as const;

/**
 * "🪪 查看角色卡" button row. Routed through the existing `deal`
 * component handler — clicking it during any stage replays the
 * deal-reveal ephemeral for the clicker. Attached at the bottom of
 * every stage board so a player who lost track of their role can
 * pull it back up without scrolling for the original deal-reveal
 * message.
 */
export function viewCardButtonRow(): DiscordActionRow {
  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 2,
        custom_id: componentCustomId(PLUGIN_KEY, "deal"),
        label: t(undefined, "stage.board.viewCard"),
      },
    ],
  };
}
