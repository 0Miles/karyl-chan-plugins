import {
  componentCustomId,
  type ComponentContext,
  type ComponentReply,
} from "@karyl-chan/plugin-sdk";
import { EMBED_COLOR, PLUGIN_KEY } from "../constants.js";
import { t } from "../i18n/index.js";
import { playerByUserId, type GameState, type Player } from "../game/state.js";
import { buildVision } from "../game/vision.js";
import { getGame } from "../game/store.js";
import { followupEphemeral, sendMessage } from "./discord.js";
import { markerEmoji, seatEmoji } from "./presentation.js";
import { openAppoint } from "./stages-appoint.js";
import { findArt, findVariantArt, isVariantPosition } from "../art.js";
import { runtime } from "./runtime.js";

/**
 * Rank of `viewer` among players sharing the same role, 1-indexed
 * by ascending seat. Used by `renderDealReveal` to pick a variant
 * image for `loyal` / `minion` roles where the deck can contain
 * multiple cards of the same kind.
 *
 * Returns 0 if the viewer somehow isn't found in the same-role set
 * (shouldn't happen in practice — vision is built from the same
 * `state.players`).
 */
export function seatRankAmongSameRole(
  players: ReadonlyArray<Player>,
  viewer: Player,
): number {
  const sameRole = players
    .filter((p) => p.position === viewer.position)
    .sort((a, b) => a.index - b.index);
  const idx = sameRole.findIndex((p) => p.userId === viewer.userId);
  return idx === -1 ? 0 : idx + 1;
}

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

/**
 * Ephemeral reveal for whoever clicked the [查看身份] button. Awaits
 * the admin-uploaded role art (if any) so the embed can carry a
 * thumbnail Discord will render alongside the flavour line.
 */
export async function renderDealReveal(
  state: GameState,
  viewerUserId: string,
): Promise<{
  color: number;
  title: string;
  description: string;
  fields: Array<{ name: string; value: string; inline?: boolean }>;
  thumbnail?: { url: string };
} | null> {
  const viewer = playerByUserId(state, viewerUserId);
  if (!viewer) return null;
  const vision = buildVision(state, viewer);
  const legend =
    viewer.position === "percival"
      ? t(undefined, "stage.deal.legendPercival")
      : t(undefined, "stage.deal.legend");
  const visionLines = vision.map((row) => {
    const marker = markerEmoji(row.marker);
    return `${seatEmoji(row.seat)} ${marker} ${row.player.displayName}`;
  });
  // Pull the role-flavor blurb if there is one; loyal/loose roles
  // share a generic line. The flavour text repeats the role name so
  // we drop the older `stage.deal.yourRole` line for it.
  const flavorKey = `role.flavor.${viewer.position}` as const;
  // Look up admin-uploaded art for this position. Variant positions
  // (loyal, minion) pick a variant indexed by the viewer's
  // seat-rank among same-role players — 1-indexed, ascending seat
  // order. If the admin uploaded fewer variants than the game has
  // copies of the role, `findVariantArt` returns null for the
  // un-ranked seats and we omit the thumbnail (no reuse, by design).
  //
  // The URL embeds the mtime-derived etag so a re-upload busts
  // Discord's CDN cache.
  let art: { filename: string; etag: string } | null;
  if (isVariantPosition(viewer.position)) {
    const rank = seatRankAmongSameRole(state.players, viewer);
    if (rank === 0) {
      // Should never reach here in practice — vision is built from
      // the same state.players that this lookup walks. If it does,
      // we get no thumbnail (variant 0 isn't a valid slot). Log so
      // ops can spot the regression rather than chase a silent
      // missing-art bug.
      runtime().log.warn("avalon: seat-rank lookup failed for variant role", {
        channelId: state.channelId,
        viewerUserId: viewer.userId,
        position: viewer.position,
      });
    }
    art = await findVariantArt(viewer.position, rank).catch(() => null);
  } else {
    art = await findArt(viewer.position).catch(() => null);
  }
  const thumbnail =
    art != null
      ? { url: `${runtime().publicBaseUrl()}/art/${art.filename}?v=${art.etag}` }
      : undefined;
  return {
    color: EMBED_COLOR,
    title: t(undefined, "stage.deal.title"),
    description: t(undefined, flavorKey) + "\n\n" + legend,
    fields: [
      {
        name: t(undefined, "stage.deal.vision"),
        value: visionLines.join("\n"),
        inline: false,
      },
    ],
    ...(thumbnail ? { thumbnail } : {}),
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
  const reveal = await renderDealReveal(game, ctx.userId);
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
