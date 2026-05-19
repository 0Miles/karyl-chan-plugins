import {
  componentCustomId,
  type ComponentContext,
  type ComponentReply,
} from "@karyl-chan/plugin-sdk";
import { EMBED_COLOR, PLUGIN_KEY } from "../constants.js";
import { t } from "../i18n/index.js";
import {
  currentRoundNeeds2Fail,
  evaluateVerdict,
  factionOf,
  leader,
  playerByIndex,
  playerByUserId,
  recordMissionResult,
  recordMvpFails,
  rotateLeader,
  type GameState,
} from "../game/state.js";
import { getGame } from "../game/store.js";
import {
  editMessage,
  followupEphemeral,
  sendMessage,
  type DiscordActionRow,
} from "./discord.js";
import { openAppoint } from "./stages-appoint.js";
import { openLake, lakeIsDueAfterRound } from "./stages-lake.js";
import { openAssassinate } from "./stages-assassinate.js";
import { missionProgressLine } from "./presentation.js";
import { runtime } from "./runtime.js";
import { endGame } from "./stages-ending.js";
import { scheduleNpcStep } from "../npc/driver.js";

/**
 * Mission voting. Discord can't ack a private vote on a public
 * message, so we use a two-step ephemeral handshake:
 *
 *   1. The public mission roster carries a single [前往投票] button.
 *   2. A mission member clicks it → ephemeral with [✅ 成功] [❎ 失敗].
 *   3. Their button click on the ephemeral records their vote and
 *      sends back an ephemeral confirmation. The public message
 *      repaints to show only the running "n / N voted" count.
 *
 * Non-mission members who click [前往投票] get an ephemeral
 * "你不在這次任務名單中" notice.
 *
 * The original Python bot drove this via DM and individual reaction
 * tracking; the ephemeral path keeps every interaction in-channel
 * without leaking faction info.
 */
export async function openPrivateVote(
  state: GameState,
  missionMembers: number[],
): Promise<void> {
  const sent = await sendMessage({
    channelId: state.channelId,
    embeds: [renderPrivateVoteEmbed(state, missionMembers, 0)],
    components: privateVoteComponents(),
  });
  if (!sent) {
    runtime().log.error("avalon: failed to open privateVote stage", {
      channelId: state.channelId,
      round: state.round,
      stage: "privateVote",
    });
    return;
  }
  state.current = {
    kind: "privateVote",
    messageId: sent.id,
    missionMembers,
    votes: {},
  };
  scheduleNpcStep(state);
}

export async function handlePrivateVoteClick(
  ctx: ComponentContext,
  tail: string,
): Promise<ComponentReply> {
  const game = getGame(ctx.channelId!);
  if (!game || game.current?.kind !== "privateVote") {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "error.notRunning"),
    });
    return null;
  }
  if (tail === "open") {
    return handlePrivateOpen(ctx, game);
  }
  if (tail === "s" || tail === "f") {
    return handlePrivateBallot(ctx, game, tail === "s" ? "success" : "fail");
  }
  return null;
}

async function handlePrivateOpen(
  ctx: ComponentContext,
  game: GameState,
): Promise<ComponentReply> {
  if (game.current?.kind !== "privateVote") return null;
  const me = playerByUserId(game, ctx.userId);
  if (!me || !game.current.missionMembers.includes(me.index)) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.privateVote.notMember"),
    });
    return null;
  }
  if (game.current.votes[ctx.userId]) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.privateVote.alreadyVoted"),
    });
    return null;
  }
  const isEvil = factionOf(me) === "mordred";
  const row: DiscordActionRow = {
    type: 1,
    components: [
      {
        type: 2,
        style: 3,
        custom_id: componentCustomId(PLUGIN_KEY, "priv", "s"),
        label: t(undefined, "stage.privateVote.success"),
      },
      {
        type: 2,
        style: 4,
        custom_id: componentCustomId(PLUGIN_KEY, "priv", "f"),
        label: t(undefined, "stage.privateVote.fail"),
        disabled: !isEvil,
      },
    ],
  };
  await followupEphemeral({
    interactionToken: ctx.interactionToken,
    content: t(undefined, "stage.privateVote.ephemeralPrompt"),
    components: [row],
  });
  return null;
}

async function handlePrivateBallot(
  ctx: ComponentContext,
  game: GameState,
  ballot: "success" | "fail",
): Promise<ComponentReply> {
  if (game.current?.kind !== "privateVote") return null;
  const me = playerByUserId(game, ctx.userId);
  if (!me || !game.current.missionMembers.includes(me.index)) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.privateVote.notMember"),
    });
    return null;
  }
  if (game.current.votes[ctx.userId]) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.privateVote.alreadyVoted"),
    });
    return null;
  }
  // Defence in depth — the success button is disabled for evil only
  // *visually*; reject a fail vote from a non-evil player at the
  // engine boundary too.
  if (ballot === "fail" && factionOf(me) === "arthur") {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.privateVote.evilOnly"),
    });
    return null;
  }
  game.current.votes[ctx.userId] = ballot;
  await followupEphemeral({
    interactionToken: ctx.interactionToken,
    content:
      ballot === "success"
        ? t(undefined, "stage.privateVote.recordedSuccess")
        : t(undefined, "stage.privateVote.recordedFail"),
  });
  // Repaint the public board's "n/N voted" line. Vote contents stay
  // hidden until everyone's in.
  await editMessage({
    channelId: game.channelId,
    messageId: game.current.messageId,
    embeds: [
      renderPrivateVoteEmbed(
        game,
        game.current.missionMembers,
        Object.keys(game.current.votes).length,
      ),
    ],
    components: privateVoteComponents(),
  });
  if (
    Object.keys(game.current.votes).length === game.current.missionMembers.length
  ) {
    await resolvePrivateVote(game);
  }
  return null;
}

export async function resolvePrivateVote(game: GameState): Promise<void> {
  if (game.current?.kind !== "privateVote") return;
  const ballots = Object.values(game.current.votes);
  const failCount = ballots.filter((v) => v === "fail").length;
  const needs2 = currentRoundNeeds2Fail(game);
  const passed = needs2 ? failCount < 2 : failCount < 1;
  const messageId = game.current.messageId;
  const missionMembers = game.current.missionMembers;
  // Capture per-player fail-vote stats before we clear state.current
  // — feeds the MVP picker on the ending board.
  recordMvpFails(game, game.current.votes);

  // Reveal the resolved board (hide who voted what — only the
  // aggregate fail count is public, mirroring the original game).
  await editMessage({
    channelId: game.channelId,
    messageId,
    embeds: [renderPrivateVoteResolved(game, missionMembers, failCount, passed)],
    components: [],
  });

  recordMissionResult(game, passed ? "success" : "fail");
  game.current = null;

  // After-mission decision tree.
  //  1) Did the missions just end the game outright? (3 fails / 3 cleans on 4p)
  //  2) Otherwise, three successes → assassinate stage.
  //  3) Otherwise, the lady-of-the-lake might be due (7+ player, rounds
  //     2/3/4) — open lake stage before next appoint.
  //  4) Otherwise, rotate leader, re-open appoint.
  const verdict = evaluateVerdict(game);
  if (verdict.ended) {
    await endGame(game, verdict);
    return;
  }
  if (verdict.reason === "missions-then-assassinate") {
    await openAssassinate(game);
    return;
  }
  // round has already been bumped by recordMissionResult — lake fires
  // *after* the round that just resolved (i.e. between round R and R+1).
  const resolvedRound = game.round - 1;
  if (lakeIsDueAfterRound(game, resolvedRound)) {
    await openLake(game);
    return;
  }
  rotateLeader(game);
  await openAppoint(game);
}

// ── rendering ──────────────────────────────────────────────────────────

export function renderPrivateVoteEmbed(
  state: GameState,
  missionMembers: number[],
  voted: number,
) {
  const leaderPlayer = leader(state);
  const rosterLines = missionMembers
    .map((s) => playerByIndex(state, s))
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => `\`${p.index + 1}\` ${p.displayName}`)
    .join("\n");
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    {
      name: t(undefined, "stage.board.fieldProgress"),
      value: missionProgressLine(state),
      inline: false,
    },
    {
      name: t(undefined, "stage.privateVote.fieldRoster"),
      value: rosterLines || "—",
      inline: false,
    },
    {
      name: t(undefined, "stage.privateVote.fieldVotes"),
      value: t(undefined, "stage.privateVote.voted", {
        n: voted,
        total: missionMembers.length,
      }),
      inline: true,
    },
  ];
  if (currentRoundNeeds2Fail(state)) {
    fields.push({
      name: "⚠",
      value: t(undefined, "stage.privateVote.need2Fail"),
      inline: false,
    });
  }
  return {
    title: t(undefined, "stage.privateVote.title", { round: state.round }),
    description: t(undefined, "stage.privateVote.content", {
      leader: `**${leaderPlayer.displayName}**`,
      num: missionMembers.length,
    }),
    color: EMBED_COLOR,
    fields,
  };
}

function renderPrivateVoteResolved(
  state: GameState,
  missionMembers: number[],
  failCount: number,
  passed: boolean,
) {
  const rosterLines = missionMembers
    .map((s) => playerByIndex(state, s))
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => `\`${p.index + 1}\` ${p.displayName}`)
    .join("\n");
  return {
    title: passed
      ? t(undefined, "stage.privateVote.resultSuccess", { round: state.round })
      : t(undefined, "stage.privateVote.resultFail", { round: state.round }),
    description:
      failCount > 0
        ? t(undefined, "stage.privateVote.failCount", { n: failCount })
        : t(undefined, "stage.privateVote.noFails"),
    color: EMBED_COLOR,
    fields: [
      {
        name: t(undefined, "stage.privateVote.fieldRoster"),
        value: rosterLines || "—",
        inline: false,
      },
    ],
  };
}

export function privateVoteComponents(): DiscordActionRow[] {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          custom_id: componentCustomId(PLUGIN_KEY, "priv", "open"),
          label: t(undefined, "stage.privateVote.openVote"),
        },
      ],
    },
  ];
}
