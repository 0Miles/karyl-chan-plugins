import {
  componentCustomId,
  type ComponentContext,
  type ComponentReply,
} from "@karyl-chan/plugin-sdk";
import { EMBED_COLOR, PLUGIN_KEY } from "../constants.js";
import { t } from "../i18n/index.js";
import { playerByUserId, type GameState, type Player } from "../game/state.js";
import { ROLES, type Position } from "../game/roles.js";
import { buildVision } from "../game/vision.js";
import { getGame } from "../game/store.js";
import {
  followupEphemeral,
  sendMessage,
  toastEphemeral,
  type DiscordActionRow,
} from "./discord.js";
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
    // Use `image` (full-width below the fields) instead of
    // `thumbnail` (small top-right) so the role card reads as a
    // proper card face. Falls back to no image when the admin
    // hasn't uploaded art for this position / variant slot.
    ...(thumbnail ? { image: thumbnail } : {}),
  };
}

export async function handleDealClick(
  ctx: ComponentContext,
  tail: string,
): Promise<ComponentReply> {
  const game = getGame(ctx.channelId!);
  if (!game) {
    await toastEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "error.notRunning"),
    });
    return null;
  }
  const viewer = playerByUserId(game, ctx.userId);
  if (!viewer) {
    await toastEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.deal.notInGame"),
    });
    return null;
  }
  // tail === "help" — secondary ephemeral: a deeper role explanation
  // + the marker legend the viewer actually sees. Fired by the
  // "查看角色說明" button on the identity ephemeral.
  if (tail === "help") {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      embeds: [renderRoleHelp(viewer)],
    });
    return null;
  }
  // Default tail — render the identity ephemeral with the
  // "查看角色說明" follow-up button so the viewer can drill in.
  const reveal = await renderDealReveal(game, ctx.userId);
  if (!reveal) {
    await toastEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.deal.notInGame"),
    });
    return null;
  }
  await followupEphemeral({
    interactionToken: ctx.interactionToken,
    embeds: [reveal],
    components: dealRevealComponents(),
  });
  return null;
}

/**
 * Single-row action with one button that fires `deal:help` — the
 * viewer's secondary "角色說明" ephemeral. The deal-reveal main
 * ephemeral always carries this row so a player can re-open the help
 * at any time (and the row is per-viewer ephemeral, so it can't be
 * triggered by anyone else).
 */
export function dealRevealComponents(): DiscordActionRow[] {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          custom_id: componentCustomId(PLUGIN_KEY, "deal", "help"),
          label: t(undefined, "stage.deal.helpButton"),
        },
      ],
    },
  ];
}

/**
 * Build the "查看角色說明" ephemeral: a per-role description plus the
 * vision markers that role actually sees. Mirrors the per-role
 * `role.description.*` and the `markerLegendLines` derivation so the
 * Percival player sees the 🟣 line but a loyal doesn't.
 */
export function renderRoleHelp(viewer: Player): {
  color: number;
  title: string;
  description: string;
  fields: Array<{ name: string; value: string; inline?: boolean }>;
} {
  const roleName = t(undefined, ROLES[viewer.position].nameKey);
  const descKey = `role.description.${viewer.position}` as const;
  return {
    color: EMBED_COLOR,
    title: t(undefined, "stage.deal.helpTitle", { role: roleName }),
    description: t(undefined, descKey),
    fields: [
      {
        name: t(undefined, "stage.deal.markerSection"),
        value: markerLegendLines(viewer.position).join("\n"),
        inline: false,
      },
    ],
  };
}

/**
 * Per-role marker legend — only includes the markers a viewer of
 * `position` could actually see on the deal-reveal grid. Loyal /
 * Oberon get just self + unknown; Merlin gets the red explanation
 * (with the Mordred-invisible caveat); Percival gets purple; the
 * non-Oberon evil get red (with the Oberon-invisible caveat). Every
 * legend ends with the unknown marker for completeness.
 */
function markerLegendLines(position: Position): string[] {
  const lines: string[] = [
    `${markerEmoji("self")} ${t(undefined, "marker.self")}`,
  ];
  if (position === "merlin") {
    lines.push(`${markerEmoji("red")} ${t(undefined, "marker.merlinRed")}`);
  } else if (position === "percival") {
    lines.push(`${markerEmoji("purple")} ${t(undefined, "marker.percivalPurple")}`);
  } else if (
    position === "assassin" ||
    position === "morgana" ||
    position === "mordred" ||
    position === "minion"
  ) {
    lines.push(`${markerEmoji("red")} ${t(undefined, "marker.evilRed")}`);
  }
  lines.push(`${markerEmoji("unknown")} ${t(undefined, "marker.unknown")}`);
  return lines;
}

// Per-stage handlers live in sibling modules so this file stays
// shallow; re-export them so the dispatcher's switch table is
// stable.
export { handleAppointClick } from "./stages-appoint.js";
export { handlePublicVoteClick } from "./stages-publicvote.js";
export { handlePrivateVoteClick } from "./stages-privatevote.js";
export { handleLakeClick } from "./stages-lake.js";
export { handleAssassinateClick } from "./stages-assassinate.js";
