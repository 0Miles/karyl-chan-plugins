import {
  componentCustomId,
  type ComponentContext,
  type ComponentReply,
} from "@karyl-chan/plugin-sdk";
import { EMBED_COLOR, PLUGIN_KEY } from "../constants.js";
import { t } from "../i18n/index.js";
import {
  factionOf,
  playerByUserId,
  type GameState,
} from "../game/state.js";
import { ROLES } from "../game/roles.js";
import { buildVision, type VisionMarker } from "../game/vision.js";
import { getGame } from "../game/store.js";
import {
  editMessage,
  followupEphemeral,
  sendMessage,
  type DiscordActionRow,
  type DiscordButton,
} from "./discord.js";

/**
 * Post the per-channel deal-reveal board after `deal(state)` runs.
 * Public message:
 *
 *   身份已分發。
 *   每位玩家請點擊下方 [查看身份] 按鈕，私下查看你的角色與視野。
 *
 * Each click → ephemeral follow-up containing only that player's
 * role card + vision grid. Non-players get a "not in this game"
 * notice. Buttons stay live for the entire session so a player can
 * re-check their role mid-round (a UX upgrade over the DM original).
 */
export async function sendDealBoard(state: GameState): Promise<void> {
  await sendMessage({
    channelId: state.channelId,
    embeds: [
      {
        title: t(undefined, "stage.deal.title"),
        description: t(undefined, "stage.deal.content"),
        color: EMBED_COLOR,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            custom_id: componentCustomId(PLUGIN_KEY, "deal"),
            label: t(undefined, "stage.deal.reveal"),
          },
        ],
      },
    ],
  });
  // TODO (next commit): also post the appoint-mission board here so
  // the round-1 leader can pick mission members.
}

/** Ephemeral reveal for whoever clicked the [查看身份] button. */
export function renderDealReveal(state: GameState, viewerUserId: string) {
  const viewer = playerByUserId(state, viewerUserId);
  if (!viewer) return null;
  const role = ROLES[viewer.position];
  const vision = buildVision(state, viewer);
  const legend =
    viewer.position === "percival"
      ? t(undefined, "stage.deal.legendPercival")
      : t(undefined, "stage.deal.legend");
  const visionLines = vision.map((row) => {
    const marker = markerEmoji(row.marker);
    return `${seatEmoji(row.seat)} ${marker} ${row.player.displayName}`;
  });
  return {
    color: EMBED_COLOR,
    title: t(undefined, "stage.deal.title"),
    description:
      t(undefined, "stage.deal.yourRole", { role: t(undefined, role.nameKey) }) +
      "\n" +
      legend,
    fields: [
      {
        name: t(undefined, "stage.deal.vision"),
        value: visionLines.join("\n"),
        inline: false,
      },
    ],
  };
}

export async function handleDealClick(
  ctx: ComponentContext,
): Promise<ComponentReply> {
  const game = getGame(ctx.channelId!);
  if (!game) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "error.notRunning"),
    });
    return null;
  }
  const reveal = renderDealReveal(game, ctx.userId);
  if (!reveal) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.deal.notInGame"),
    });
    return null;
  }
  await followupEphemeral({
    interactionToken: ctx.interactionToken,
    embeds: [reveal],
  });
  return null;
}

// ── stub handlers for the remaining stages ──────────────────────────────
// These wire the dispatcher so the component endpoint compiles + the
// custom_id parser is exercised by Discord. The real logic for each
// lands in the next commit.

export async function handleAppointClick(
  ctx: ComponentContext,
  _tail: string,
): Promise<ComponentReply> {
  await stubReply(ctx, "appt");
  return null;
}

export async function handlePublicVoteClick(
  ctx: ComponentContext,
  _tail: string,
): Promise<ComponentReply> {
  await stubReply(ctx, "pub");
  return null;
}

export async function handlePrivateVoteClick(
  ctx: ComponentContext,
  _tail: string,
): Promise<ComponentReply> {
  await stubReply(ctx, "priv");
  return null;
}

export async function handleLakeClick(
  ctx: ComponentContext,
  _tail: string,
): Promise<ComponentReply> {
  await stubReply(ctx, "lake");
  return null;
}

export async function handleAssassinateClick(
  ctx: ComponentContext,
  _tail: string,
): Promise<ComponentReply> {
  await stubReply(ctx, "asn");
  return null;
}

async function stubReply(
  ctx: ComponentContext,
  stage: string,
): Promise<void> {
  await followupEphemeral({
    interactionToken: ctx.interactionToken,
    content: `🚧 \`${stage}\` stage not implemented yet.`,
  });
}

// ── presentation helpers ────────────────────────────────────────────────

function markerEmoji(marker: VisionMarker): string {
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

function seatEmoji(seat: number): string {
  return SEAT_EMOJI[seat - 1] ?? `[${seat}]`;
}

// Helpers exported for future use by stages2.ts (appoint / votes /
// lake / assassinate). Reuse the seat / marker emoji table from here.
export { seatEmoji, markerEmoji };
export type { DiscordActionRow, DiscordButton };
