import {
  componentCustomId,
  type ComponentContext,
  type ComponentReply,
} from "@karyl-chan/plugin-sdk";
import { EMBED_COLOR, PLUGIN_KEY } from "../constants.js";
import { t } from "../i18n/index.js";
import {
  playerByIndex,
  playerByUserId,
  settleAssassinate,
  type GameState,
} from "../game/state.js";
import { getGame } from "../game/store.js";
import { ROLES } from "../game/roles.js";
import {
  editMessage,
  toastEphemeral,
  sendMessage,
  type DiscordActionRow,
  type DiscordButton,
} from "./discord.js";
import { truncate, viewCardButtonRow } from "./presentation.js";
import { runtime } from "./runtime.js";
import { endGame } from "./stages-ending.js";
import { scheduleNpcStep } from "../npc/driver.js";

/**
 * Assassinate stage:
 *  - Posts a public board with one button per *non-evil* player so the
 *    assassin can't waste their shot on a teammate. Only the
 *    `assassin` role can click; others get an ephemeral nudge.
 *  - On confirmation the target is revealed (everyone sees who got
 *    shot and what their real role was), then `settleAssassinate`
 *    decides whether evil flips the win or Arthur takes it.
 */
export async function openAssassinate(state: GameState): Promise<void> {
  state.stage = "assassinate";
  const assassin = state.players.find((p) => p.position === "assassin");
  if (!assassin) {
    // Should be impossible — every legal Avalon table has an assassin.
    // Bail to ending with the missions verdict that's already in hand.
    runtime().log.error("avalon: no assassin in deck on assassinate stage", {
      channelId: state.channelId,
      stage: "assassinate",
    });
    return;
  }
  const sent = await sendMessage({
    channelId: state.channelId,
    embeds: [renderAssassinateEmbed(assassin.displayName)],
    components: assassinateComponents(state),
  });
  if (!sent) {
    runtime().log.error("avalon: failed to open assassinate stage", {
      channelId: state.channelId,
      round: state.round,
      stage: "assassinate",
    });
    return;
  }
  state.current = {
    kind: "assassinate",
    messageId: sent.id,
  };
  scheduleNpcStep(state);
}

export async function handleAssassinateClick(
  ctx: ComponentContext,
  tail: string,
): Promise<ComponentReply> {
  const game = getGame(ctx.channelId!);
  if (!game || game.current?.kind !== "assassinate") {
    await toastEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "error.notRunning"),
    });
    return null;
  }
  const me = playerByUserId(game, ctx.userId);
  if (!me || me.position !== "assassin") {
    await toastEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.assassinate.notAssassin"),
    });
    return null;
  }
  const seat = Number(tail);
  const target = playerByIndex(game, seat);
  if (!target) return null;
  if (target.userId === me.userId) {
    await toastEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.assassinate.cannotSelf"),
    });
    return null;
  }

  game.assassinTargetIndex = seat;
  const verdict = settleAssassinate(game);
  await editMessage({
    channelId: game.channelId,
    messageId: game.current.messageId,
    embeds: [
      {
        color: EMBED_COLOR,
        title: t(undefined, "stage.assassinate.title"),
        description: t(undefined, "stage.assassinate.result", {
          assassin: `**${me.displayName}**`,
          target: `**${target.displayName}**`,
          role: t(undefined, ROLES[target.position].nameKey),
        }),
      },
    ],
    components: [],
  });
  game.current = null;
  await endGame(game, verdict);
  return null;
}

// ── rendering ──────────────────────────────────────────────────────────

function renderAssassinateEmbed(assassinName: string) {
  return {
    title: t(undefined, "stage.assassinate.title"),
    description: t(undefined, "stage.assassinate.content", {
      assassin: `**${assassinName}**`,
    }),
    color: EMBED_COLOR,
  };
}

function assassinateComponents(state: GameState): DiscordActionRow[] {
  // Show every non-assassin seat. We deliberately don't pre-filter
  // out the assassin's own faction here — doing so would leak Oberon
  // (who's evil but invisible to other evil) to the assassin.
  const rows: DiscordActionRow[] = [];
  const buttons: DiscordButton[] = state.players
    .filter((p) => p.position !== "assassin")
    .map((p) => ({
      type: 2,
      style: 1,
      custom_id: componentCustomId(PLUGIN_KEY, "asn", `${p.index}`),
      label: `${p.index + 1}. ${truncate(p.displayName, 18)}`,
    }));
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push({ type: 1, components: buttons.slice(i, i + 5) });
  }
  rows.push(viewCardButtonRow());
  return rows;
}
