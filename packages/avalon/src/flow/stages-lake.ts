import {
  componentCustomId,
  type ComponentContext,
  type ComponentReply,
} from "@karyl-chan/plugin-sdk";
import { EMBED_COLOR, PLUGIN_KEY } from "../constants.js";
import { t } from "../i18n/index.js";
import {
  evaluateVerdict,
  factionOf,
  playerByIndex,
  playerByUserId,
  rotateLeader,
  type GameState,
} from "../game/state.js";
import { getGame } from "../game/store.js";
import { recordEvent } from "../game/events.js";
import {
  editMessage,
  followupEphemeral,
  sendMessage,
  type DiscordActionRow,
  type DiscordAttachment,
  type DiscordButton,
  type DiscordEmbed,
} from "./discord.js";
import { openAppoint } from "./stages-appoint.js";
import { truncate, viewCardButtonRow } from "./presentation.js";
import { runtime } from "./runtime.js";
import { findAsset } from "../art.js";
import { endGame } from "./stages-ending.js";
import { scheduleNpcStep } from "../npc/driver.js";

/**
 * Resolve the optional lake-of-the-lady asset into a thumbnail-ref
 * + attachment descriptor. Returns undefined when the admin hasn't
 * uploaded one. The asset ships as a real attachment so it renders
 * without a Discord-reachable public URL.
 */
async function lakeThumbnail(): Promise<
  { thumbnail: { url: string }; attachment: DiscordAttachment } | undefined
> {
  const art = await findAsset("lake").catch(() => null);
  if (!art) return undefined;
  return {
    thumbnail: { url: `attachment://${art.filename}` },
    attachment: { name: art.filename, path: `/art/${art.filename}` },
  };
}

/**
 * Lake of the Lady (湖中女神):
 *  - Only fires if `ladyEnabled` and the player count is >= 7.
 *  - Triggers between rounds 2/3/4 (i.e. after missions 2, 3, 4).
 *  - The current holder picks a target via seat buttons; the result
 *    (target's faction) is shown only to the holder via an ephemeral.
 *  - The Lady token transfers to the inspected player. They can't
 *    re-give it to a previous holder (the inspected-self counter on
 *    Player tracks that).
 */
export function lakeIsDueAfterRound(state: GameState, round: number): boolean {
  if (!state.ladyEnabled) return false;
  if (state.players.length < 7) return false;
  return round >= 2 && round <= 4;
}

/**
 * Build the lake stage's public board payload — embed (with the
 * optional lake-asset thumbnail) + seat buttons + the matching
 * attachment. Single source of truth for the active-lake board:
 * `openLake` posts it, and `/avalon status` re-renders it. Returns
 * null when there's no current Lady holder.
 */
export async function lakeBoardPayload(state: GameState): Promise<{
  embeds: DiscordEmbed[];
  components: DiscordActionRow[];
  attachments?: DiscordAttachment[];
} | null> {
  if (state.ladyHolderIndex === null) return null;
  const holder = playerByIndex(state, state.ladyHolderIndex);
  if (!holder) return null;
  const lakeArt = await lakeThumbnail();
  return {
    embeds: [withThumbnail(renderLakeEmbed(state, holder.displayName), lakeArt)],
    components: lakeComponents(state),
    ...(lakeArt ? { attachments: [lakeArt.attachment] } : {}),
  };
}

export async function openLake(state: GameState): Promise<void> {
  if (state.ladyHolderIndex === null) return;
  const holderIndex = state.ladyHolderIndex;
  const payload = await lakeBoardPayload(state);
  if (!payload) return;
  const sent = await sendMessage({
    channelId: state.channelId,
    ...payload,
  });
  if (!sent) {
    runtime().log.error("avalon: failed to open lake stage", {
      channelId: state.channelId,
      round: state.round,
      stage: "lake",
    });
    return;
  }
  state.current = {
    kind: "lake",
    messageId: sent.id,
    holderIndex,
  };
  scheduleNpcStep(state);
}

/** Returns the embed with the lake thumbnail set when present. */
function withThumbnail(
  embed: DiscordEmbed,
  lakeArt: { thumbnail: { url: string } } | undefined,
): DiscordEmbed {
  return lakeArt ? { ...embed, thumbnail: lakeArt.thumbnail } : embed;
}

export async function handleLakeClick(
  ctx: ComponentContext,
  tail: string,
): Promise<ComponentReply> {
  const game = getGame(ctx.channelId!);
  // Invalid clicks (stale board, non-holder, self, already-inspected
  // target) are dropped silently — the seat buttons already disable
  // illegal targets, and a per-click ephemeral nag disrupts play.
  if (!game || game.current?.kind !== "lake") return null;
  const holder = playerByIndex(game, game.current.holderIndex);
  if (!holder || ctx.userId !== holder.userId) return null;
  const seat = Number(tail);
  if (!Number.isFinite(seat)) return null;
  const target = playerByIndex(game, seat);
  if (!target) return null;
  if (target.userId === holder.userId) return null;
  // Disallow re-inspecting a previous holder (encoded as a marker on
  // Player when the token last moved off them).
  if (target.lakeTarget !== null) return null;

  // Reveal result only to the holder via an ephemeral. Keep the
  // public board's text neutral ("X 用湖中女神查驗了 Y") so
  // bystanders can't infer the faction.
  const faction = factionOf(target);
  const lakeArt = await lakeThumbnail();
  await followupEphemeral({
    interactionToken: ctx.interactionToken,
    embeds: [
      withThumbnail(
        {
          color: EMBED_COLOR,
          title: t(undefined, "stage.lake.resultTitle"),
          description: t(undefined, "stage.lake.result", {
            target: `**${target.displayName}**`,
            // Prefix the faction with its board emoji (🔵 藍方 /
            // 🔴 紅方) so the result reads at a glance.
            faction:
              faction === "arthur"
                ? `🔵 ${t(undefined, "faction.arthur")}`
                : `🔴 ${t(undefined, "faction.mordred")}`,
          }),
        },
        lakeArt,
      ),
    ],
    ...(lakeArt ? { attachments: [lakeArt.attachment] } : {}),
  });

  // Transfer the token to the inspected player. Mark the old holder so
  // they can't be re-inspected later.
  holder.lakeTarget = target.userId;
  game.ladyHolderIndex = target.index;
  game.ladyUseCount++;
  // Timeline: who inspected whom is public; the revealed faction is
  // the holder's private knowledge and is deliberately not recorded.
  recordEvent(game, {
    kind: "lake-used",
    holderSeat: holder.index,
    targetSeat: target.index,
  });

  await editLakeCheckedBoard(
    game.channelId,
    game.current.messageId,
    holder.displayName,
    target.displayName,
  );

  game.current = null;
  const verdict = evaluateVerdict(game);
  if (verdict.ended) {
    await endGame(game, verdict);
    return null;
  }
  rotateLeader(game);
  await openAppoint(game);
  return null;
}

/**
 * Repaint the lake public board into its post-check "X 用湖中女神查驗
 * 了 Y" state, keeping the lake thumbnail embedded.
 *
 * The embed's `thumbnail` must keep referencing `attachment://<lake>`
 * so Discord renders the asset INSIDE the card. A message edit that
 * omits `attachments` retains the file posted by `openLake`, so the
 * reference still resolves — but the embed has to carry the
 * reference. Shared by the human (`handleLakeClick`) and NPC
 * (`driver.performLake`) paths so both render identically; a
 * thumbnail-less edit would orphan the retained file into a separate
 * image block below the card.
 */
export async function editLakeCheckedBoard(
  channelId: string,
  messageId: string,
  holderName: string,
  targetName: string,
): Promise<void> {
  const lakeArt = await lakeThumbnail();
  await editMessage({
    channelId,
    messageId,
    embeds: [
      withThumbnail(
        {
          color: EMBED_COLOR,
          title: t(undefined, "stage.lake.title"),
          description: t(undefined, "stage.lake.checked", {
            holder: `**${holderName}**`,
            target: `**${targetName}**`,
          }),
        },
        lakeArt,
      ),
    ],
    components: [],
  });
}

// ── rendering ──────────────────────────────────────────────────────────

function renderLakeEmbed(state: GameState, holderName: string) {
  return {
    title: t(undefined, "stage.lake.title"),
    description: t(undefined, "stage.lake.content", {
      holder: `**${holderName}**`,
      n: state.ladyUseCount + 1,
    }),
    color: EMBED_COLOR,
    fields: [
      {
        name: t(undefined, "stage.lake.fieldHolder"),
        value: holderName,
        inline: true,
      },
    ],
  };
}

function lakeComponents(state: GameState): DiscordActionRow[] {
  const rows: DiscordActionRow[] = [];
  const buttons: DiscordButton[] = state.players
    .filter((p) => p.index !== state.ladyHolderIndex)
    .map((p) => ({
      type: 2,
      style: p.lakeTarget !== null ? 2 : 1,
      custom_id: componentCustomId(PLUGIN_KEY, "lake", `${p.index}`),
      label: `${p.index + 1}. ${truncate(p.displayName, 18)}`,
      // Already-inspected players can't be checked again — make that
      // visible at click time, not just at the engine boundary.
      disabled: p.lakeTarget !== null,
    }));
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push({ type: 1, components: buttons.slice(i, i + 5) });
  }
  rows.push(viewCardButtonRow());
  return rows;
}
