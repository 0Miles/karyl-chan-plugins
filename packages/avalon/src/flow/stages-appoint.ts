import {
  componentCustomId,
  type ComponentContext,
  type ComponentReply,
} from "@karyl-chan/plugin-sdk";
import { EMBED_COLOR, PLUGIN_KEY } from "../constants.js";
import { t } from "../i18n/index.js";
import {
  currentMissionSize,
  leader,
  playerByIndex,
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
import { missionProgressLine, truncate } from "./presentation.js";
import { openPublicVote } from "./stages-publicvote.js";

/**
 * Round opener. Posts the appoint board and primes
 * `state.current = { kind: "appoint", … }` so the seat-toggle handler
 * can edit-in-place. Called from:
 *  - `signup.handleStartClick` once the deck is dealt,
 *  - `stages-publicvote` after a rejection,
 *  - `stages-private-vote` after a mission resolves and the game
 *    isn't over yet (lands in a later commit).
 */
export async function openAppoint(state: GameState): Promise<void> {
  const num = currentMissionSize(state);
  const leaderPlayer = leader(state);
  const sent = await sendMessage({
    channelId: state.channelId,
    embeds: [renderAppointEmbed(state, leaderPlayer.displayName, [])],
    components: appointComponents(state, []),
  });
  if (!sent) {
    // Permission glitch or RPC hiccup — caller (channel lock holder)
    // will see the unset state.current and can surface a generic
    // "❌ failed to post the appoint board" if they want. We log only.
    return;
  }
  state.current = {
    kind: "appoint",
    messageId: sent.id,
    selected: [],
  };
  void num;
}

export async function handleAppointClick(
  ctx: ComponentContext,
  tail: string,
): Promise<ComponentReply> {
  const game = getGame(ctx.channelId!);
  if (!game || game.current?.kind !== "appoint") {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "error.notRunning"),
    });
    return null;
  }
  const leaderPlayer = leader(game);
  if (ctx.userId !== leaderPlayer.userId) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.appoint.notLeader"),
    });
    return null;
  }
  // tail shape: `s:<seat>` to toggle, `c` to confirm.
  if (tail === "c") {
    return confirmAppoint(ctx, game);
  }
  if (tail.startsWith("s:")) {
    const seat = Number(tail.slice(2));
    return toggleAppoint(ctx, game, seat);
  }
  return null;
}

async function toggleAppoint(
  ctx: ComponentContext,
  game: GameState,
  seat: number,
): Promise<ComponentReply> {
  if (game.current?.kind !== "appoint") return null;
  const player = playerByIndex(game, seat);
  if (!player) return null;
  const num = currentMissionSize(game);
  const selected = game.current.selected;
  const idx = selected.indexOf(seat);
  if (idx >= 0) {
    selected.splice(idx, 1);
  } else {
    if (selected.length >= num) {
      await followupEphemeral({
        interactionToken: ctx.interactionToken,
        content: t(undefined, "stage.appoint.full"),
      });
      return null;
    }
    selected.push(seat);
  }
  // Edit the appoint board in place. Returning the new payload from
  // the handler would PATCH @original, but the appoint board is a
  // standalone message — use the explicit edit RPC.
  const leaderPlayer = leader(game);
  const selectedNames = selected
    .map((s) => playerByIndex(game, s)?.displayName ?? `#${s + 1}`);
  await editMessage({
    channelId: game.channelId,
    messageId: game.current.messageId,
    embeds: [renderAppointEmbed(game, leaderPlayer.displayName, selectedNames)],
    components: appointComponents(game, selected),
  });
  return null;
}

async function confirmAppoint(
  ctx: ComponentContext,
  game: GameState,
): Promise<ComponentReply> {
  if (game.current?.kind !== "appoint") return null;
  const num = currentMissionSize(game);
  if (game.current.selected.length !== num) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.appoint.needExact", { num }),
    });
    return null;
  }
  // Lock the appoint board (strip buttons, leave the embed for
  // scrollback) and open the public-vote board.
  const leaderPlayer = leader(game);
  const selectedNames = game.current.selected.map(
    (s) => playerByIndex(game, s)?.displayName ?? `#${s + 1}`,
  );
  await editMessage({
    channelId: game.channelId,
    messageId: game.current.messageId,
    embeds: [renderAppointEmbed(game, leaderPlayer.displayName, selectedNames)],
    components: [],
  });
  const missionMembers = [...game.current.selected];
  await openPublicVote(game, missionMembers);
  return null;
}

// ── rendering ──────────────────────────────────────────────────────────

function renderAppointEmbed(
  state: GameState,
  leaderName: string,
  selectedNames: string[],
) {
  const num = currentMissionSize(state);
  return {
    title: t(undefined, "stage.appoint.title", { round: state.round }),
    description: t(undefined, "stage.appoint.content", {
      leader: `**${leaderName}**`,
      num,
    }),
    color: EMBED_COLOR,
    fields: [
      {
        name: t(undefined, "stage.board.fieldProgress"),
        value: missionProgressLine(state),
        inline: false,
      },
      {
        name: t(undefined, "stage.appoint.fieldSelected"),
        value:
          selectedNames.length === 0
            ? t(undefined, "stage.appoint.selectedNone")
            : selectedNames.map((n) => `\`${n}\``).join("\n"),
        inline: false,
      },
    ],
  };
}

function appointComponents(
  state: GameState,
  selected: number[],
): DiscordActionRow[] {
  const num = currentMissionSize(state);
  const rows: DiscordActionRow[] = [];
  // Seat buttons: row of up to 5, then wrap. With 10 players we get 2
  // full rows of 5. Confirm sits on its own row so the action row
  // count never exceeds 5 (Discord limit).
  const seatButtons: DiscordButton[] = state.players.map((p, i) => ({
    type: 2,
    style: selected.includes(i) ? 3 : 2,
    custom_id: componentCustomId(PLUGIN_KEY, "appt", `s:${i}`),
    label: `${i + 1}. ${truncate(p.displayName, 18)}`,
  }));
  for (let i = 0; i < seatButtons.length; i += 5) {
    rows.push({ type: 1, components: seatButtons.slice(i, i + 5) });
  }
  rows.push({
    type: 1,
    components: [
      {
        type: 2,
        style: 1,
        custom_id: componentCustomId(PLUGIN_KEY, "appt", "c"),
        label: t(undefined, "stage.appoint.confirm"),
        disabled: selected.length !== num,
      },
    ],
  });
  return rows;
}

export { renderAppointEmbed, appointComponents };
