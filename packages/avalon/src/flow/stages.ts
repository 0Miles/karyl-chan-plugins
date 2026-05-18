import {
  componentCustomId,
  type ComponentContext,
  type ComponentReply,
} from "@karyl-chan/plugin-sdk";
import { EMBED_COLOR, PLUGIN_KEY } from "../constants.js";
import { t } from "../i18n/index.js";
import { playerByUserId, type GameState } from "../game/state.js";
import { ROLES } from "../game/roles.js";
import { buildVision } from "../game/vision.js";
import { getGame } from "../game/store.js";
import { followupEphemeral, sendMessage } from "./discord.js";
import { markerEmoji, seatEmoji } from "./presentation.js";
import { openAppoint } from "./stages-appoint.js";

/**
 * Per-channel deal-reveal board. Posted once right after `deal()`
 * runs; every player taps [查看身份] to receive their role + vision
 * grid as an ephemeral. The board itself never gets edited — players
 * can re-tap it mid-game to re-check their info.
 *
 * After posting the reveal board we immediately open the round-1
 * appoint stage so the leader can pick the first mission roster.
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
  await openAppoint(state);
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

// Per-stage handlers live in sibling modules so this file stays
// shallow; re-export them so the dispatcher's switch table is
// stable.
export { handleAppointClick } from "./stages-appoint.js";
export { handlePublicVoteClick } from "./stages-publicvote.js";
export { handlePrivateVoteClick } from "./stages-privatevote.js";
export { handleLakeClick } from "./stages-lake.js";
export { handleAssassinateClick } from "./stages-assassinate.js";
