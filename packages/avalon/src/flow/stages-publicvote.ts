import {
  componentCustomId,
  type ComponentContext,
  type ComponentReply,
} from "@karyl-chan/plugin-sdk";
import { EMBED_COLOR, PLUGIN_KEY } from "../constants.js";
import { t } from "../i18n/index.js";
import {
  evaluateVerdict,
  leader,
  playerByIndex,
  playerByUserId,
  recordMvpRejection,
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
import { missionProgressLine } from "./presentation.js";
import { runtime } from "./runtime.js";
import { endGame } from "./stages-ending.js";
import { scheduleNpcStep } from "../npc/driver.js";

/**
 * Open the public-vote stage. Every seated player gets a turn at the
 * Approve / Reject buttons. Once everyone has voted the tally is
 * revealed; majority approve → mission begins (private-vote stage,
 * landed in a later commit), tie/minority → reject, rotate leader,
 * tick the rejection counter, re-open appoint (or end the game if 5
 * rejections in a row).
 *
 * The vote message is the source of truth — the live vote count
 * repaints into a "n / N voted" field with no per-player disclosure.
 */
export async function openPublicVote(
  state: GameState,
  missionMembers: number[],
): Promise<void> {
  const sent = await sendMessage({
    channelId: state.channelId,
    embeds: [renderPublicVoteEmbed(state, missionMembers, {})],
    components: publicVoteComponents(),
  });
  if (!sent) {
    runtime().log.error("avalon: failed to open publicVote stage", {
      channelId: state.channelId,
      round: state.round,
      stage: "publicVote",
    });
    return;
  }
  state.current = {
    kind: "publicVote",
    messageId: sent.id,
    missionMembers,
    votes: {},
  };
  scheduleNpcStep(state);
}

export async function handlePublicVoteClick(
  ctx: ComponentContext,
  tail: string,
): Promise<ComponentReply> {
  const game = getGame(ctx.channelId!);
  if (!game || game.current?.kind !== "publicVote") {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "error.notRunning"),
    });
    return null;
  }
  const me = playerByUserId(game, ctx.userId);
  if (!me) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.publicVote.notPlayer"),
    });
    return null;
  }
  if (game.current.votes[ctx.userId]) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.publicVote.alreadyVoted"),
    });
    return null;
  }
  if (tail !== "y" && tail !== "n") return null;
  const vote: "yes" | "no" = tail === "y" ? "yes" : "no";
  game.current.votes[ctx.userId] = vote;
  if (vote === "no") {
    recordMvpRejection(game, me, game.current.missionMembers);
  }

  await followupEphemeral({
    interactionToken: ctx.interactionToken,
    content: t(undefined, "stage.publicVote.recorded", {
      vote:
        vote === "yes"
          ? t(undefined, "stage.publicVote.approve")
          : t(undefined, "stage.publicVote.reject"),
    }),
  });

  // Live progress repaint — show vote count only, not who-voted-what.
  await editMessage({
    channelId: game.channelId,
    messageId: game.current.messageId,
    embeds: [
      renderPublicVoteEmbed(game, game.current.missionMembers, game.current.votes),
    ],
    components: publicVoteComponents(),
  });

  // Everyone voted? Tally + transition.
  if (Object.keys(game.current.votes).length === game.players.length) {
    await resolvePublicVote(game);
  }
  return null;
}

export async function resolvePublicVote(game: GameState): Promise<void> {
  if (game.current?.kind !== "publicVote") return;
  const votes = Object.values(game.current.votes);
  const yes = votes.filter((v) => v === "yes").length;
  const no = votes.length - yes;
  const passed = yes > no;
  const missionMembers = game.current.missionMembers;
  const messageId = game.current.messageId;

  // Reveal the final tally on the board.
  await editMessage({
    channelId: game.channelId,
    messageId,
    embeds: [
      renderPublicVoteResolved(game, missionMembers, yes, no, passed),
    ],
    components: [],
  });

  if (passed) {
    // Mission begins — private-vote stage opens it. Until that commit
    // lands we drop a "🚧 next stage" placeholder so manual e2e can
    // continue without the dispatch threading falling over.
    const { openPrivateVote } = await import("./stages-privatevote.js");
    await openPrivateVote(game, missionMembers);
    return;
  }

  // Rejected. Bump consecutive-rejection counter, rotate leader,
  // re-open appoint — or end the game if we just hit the 5th reject.
  game.consecutiveRejections++;
  game.current = null;
  const verdict = evaluateVerdict(game);
  if (verdict.ended) {
    await endGame(game, verdict);
    return;
  }
  rotateLeader(game);
  await openAppoint(game);
}

// ── rendering ──────────────────────────────────────────────────────────

export function renderPublicVoteEmbed(
  state: GameState,
  missionMembers: number[],
  votes: Record<string, "yes" | "no">,
) {
  const leaderPlayer = leader(state);
  const rosterLines = missionMembers
    .map((s) => playerByIndex(state, s))
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => `\`${p.index + 1}\` ${p.displayName}`)
    .join("\n");
  const voted = Object.keys(votes).length;
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    {
      name: t(undefined, "stage.board.fieldProgress"),
      value: missionProgressLine(state),
      inline: false,
    },
    {
      name: t(undefined, "stage.publicVote.fieldRoster"),
      value: rosterLines || "—",
      inline: false,
    },
    {
      name: t(undefined, "stage.publicVote.fieldVotes"),
      value: t(undefined, "stage.publicVote.voted", {
        n: voted,
        total: state.players.length,
      }),
      inline: true,
    },
  ];
  if (state.consecutiveRejections > 0) {
    fields.push({
      name: t(undefined, "stage.publicVote.fieldRejections"),
      value: t(undefined, "stage.publicVote.rejectionWarn", {
        n: state.consecutiveRejections,
      }),
      inline: true,
    });
  }
  return {
    title: t(undefined, "stage.publicVote.title", { round: state.round }),
    description: t(undefined, "stage.publicVote.content", {
      leader: `**${leaderPlayer.displayName}**`,
      num: missionMembers.length,
    }),
    color: EMBED_COLOR,
    fields,
  };
}

function renderPublicVoteResolved(
  state: GameState,
  missionMembers: number[],
  yes: number,
  no: number,
  passed: boolean,
) {
  const leaderPlayer = leader(state);
  const rosterLines = missionMembers
    .map((s) => playerByIndex(state, s))
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => `\`${p.index + 1}\` ${p.displayName}`)
    .join("\n");
  return {
    title: t(undefined, "stage.publicVote.title", { round: state.round }),
    description: t(undefined, "stage.publicVote.content", {
      leader: `**${leaderPlayer.displayName}**`,
      num: missionMembers.length,
    }),
    color: EMBED_COLOR,
    fields: [
      {
        name: t(undefined, "stage.publicVote.fieldRoster"),
        value: rosterLines || "—",
        inline: false,
      },
      {
        name: t(undefined, "stage.publicVote.fieldResult"),
        value:
          (passed
            ? `✅ ${t(undefined, "stage.publicVote.passed")}`
            : `❎ ${t(undefined, "stage.publicVote.rejected")}`) +
          " · " +
          t(undefined, "stage.publicVote.tally", { yes, no }),
        inline: false,
      },
    ],
  };
}

export function publicVoteComponents(): DiscordActionRow[] {
  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 3,
          custom_id: componentCustomId(PLUGIN_KEY, "pub", "y"),
          label: t(undefined, "stage.publicVote.approve"),
        },
        {
          type: 2,
          style: 4,
          custom_id: componentCustomId(PLUGIN_KEY, "pub", "n"),
          label: t(undefined, "stage.publicVote.reject"),
        },
      ],
    },
  ];
}
