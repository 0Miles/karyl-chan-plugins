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
import {
  editMessage,
  followupEphemeral,
  sendMessage,
  type DiscordActionRow,
  type DiscordButton,
} from "./discord.js";
import { openAppoint } from "./stages-appoint.js";
import { truncate } from "./presentation.js";
import { runtime } from "./runtime.js";
import { endGame } from "./stages-ending.js";

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

export async function openLake(state: GameState): Promise<void> {
  if (state.ladyHolderIndex === null) return;
  const holder = playerByIndex(state, state.ladyHolderIndex);
  if (!holder) return;
  const sent = await sendMessage({
    channelId: state.channelId,
    embeds: [renderLakeEmbed(state, holder.displayName)],
    components: lakeComponents(state),
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
    holderIndex: state.ladyHolderIndex,
  };
}

export async function handleLakeClick(
  ctx: ComponentContext,
  tail: string,
): Promise<ComponentReply> {
  const game = getGame(ctx.channelId!);
  if (!game || game.current?.kind !== "lake") {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "error.notRunning"),
    });
    return null;
  }
  const holder = playerByIndex(game, game.current.holderIndex);
  if (!holder || ctx.userId !== holder.userId) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.lake.notHolder"),
    });
    return null;
  }
  const seat = Number(tail);
  if (!Number.isFinite(seat)) return null;
  const target = playerByIndex(game, seat);
  if (!target) return null;
  if (target.userId === holder.userId) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.lake.cannotSelf"),
    });
    return null;
  }
  // Disallow re-inspecting a previous holder (encoded as a marker on
  // Player when the token last moved off them).
  if (target.lakeTarget !== null) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.lake.cannotRepeat"),
    });
    return null;
  }

  // Reveal result only to the holder via an ephemeral. Keep the
  // public board's text neutral ("X 用湖中女神查驗了 Y") so
  // bystanders can't infer the faction.
  const faction = factionOf(target);
  await followupEphemeral({
    interactionToken: ctx.interactionToken,
    embeds: [
      {
        color: EMBED_COLOR,
        title: t(undefined, "stage.lake.title"),
        description: t(undefined, "stage.lake.result", {
          target: `**${target.displayName}**`,
          faction:
            faction === "arthur"
              ? t(undefined, "faction.arthur")
              : t(undefined, "faction.mordred"),
        }),
      },
    ],
  });

  // Transfer the token to the inspected player. Mark the old holder so
  // they can't be re-inspected later.
  holder.lakeTarget = target.userId;
  game.ladyHolderIndex = target.index;
  game.ladyUseCount++;

  await editMessage({
    channelId: game.channelId,
    messageId: game.current.messageId,
    embeds: [
      {
        color: EMBED_COLOR,
        title: t(undefined, "stage.lake.title"),
        description: t(undefined, "stage.lake.checked", {
          holder: `**${holder.displayName}**`,
          target: `**${target.displayName}**`,
        }),
      },
    ],
    components: [],
  });

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
  return rows;
}
