import {
  componentCustomId,
  type CommandContext,
  type CommandReply,
  type ComponentContext,
  type ComponentReply,
} from "@karyl-chan/plugin-sdk";
import { EMBED_COLOR, PLUGIN_KEY } from "../constants.js";
import { t } from "../i18n/index.js";
import {
  getGame,
  removeGame,
  setGame,
  withChannelLock,
} from "../game/store.js";
import { deal, newGameState, type GameState } from "../game/state.js";
import { editMessage, followupEphemeral, sendMessage } from "./discord.js";
import { renderDealReveal, sendDealBoard } from "./stages.js";

/**
 * Per-channel sign-up scratch state. Held alongside the GameState
 * (which only exists after `deal`); when the host hits "start" we
 * promote this into a full GameState via `newGameState`.
 *
 * Keyed by channelId. One channel = one open signup at a time —
 * `/avalon start` errors out if either a GameState or a signup is
 * already live.
 */
interface Signup {
  guildId: string;
  channelId: string;
  hostUserId: string;
  hostDisplayName: string;
  messageId: string;
  players: Map<string, string>; // userId → displayName, insertion-ordered
  /**
   * Host-toggled at signup time via the `sig:lady` button. Surfaces in
   * the UI only when player count ≥ LADY_MIN_PLAYERS (Avalon rulebook
   * gates Lady-of-the-Lake to 7+ player tables). The handler resolves
   * the effective ladyEnabled on start so a stale `true` on a roster
   * that dropped below the threshold doesn't enable a lake that can
   * never fire.
   */
  ladyEnabled: boolean;
}

const signups = new Map<string, Signup>();

/**
 * Minimum / maximum players. Bumped from 4→5 (B-001): n=4 is not a
 * supported Avalon table in the official rulebook and the role-deck
 * builder rejects it anyway. The mission-size table still has a row
 * for n=4 for historical clarity but is unreachable through the
 * signup flow.
 */
const MIN_PLAYERS = 5;
const MAX_PLAYERS = 10;

/**
 * Lady-of-the-Lake is only legal at 7+ player tables per the
 * rulebook. The toggle button is hidden below this threshold; if a
 * roster drops below it after toggling on, the effective value is
 * forced false at start so we don't dump a dead `ladyEnabled` flag
 * onto the GameState.
 */
const LADY_MIN_PLAYERS = 7;

export type SignupAction = "join" | "leave" | "start" | "cancel" | "lady";

/**
 * Entry point from the `/avalon start` slash. Posts the public sign-up
 * embed with `加入 / 開始 / 取消` buttons; returns a short reply to
 * dismiss the slash command (Discord requires SOME reply).
 */
export async function startSignup(
  ctx: CommandContext,
  guildId: string,
  channelId: string,
): Promise<CommandReply> {
  return withChannelLock(channelId, async () => {
    if (getGame(channelId) || signups.has(channelId)) {
      return t(undefined, "error.alreadyRunning");
    }
    const hostMention = `<@${ctx.userId}>`;
    // Initial board: empty roster, no lady toggle (under 7 players).
    const sent = await sendMessage({
      channelId,
      embeds: [renderSignupEmbed(hostMention, [])],
      components: signupComponents({
        canStart: false,
        showLady: false,
        ladyEnabled: false,
      }),
    });
    if (!sent) {
      return "⚠ Failed to post sign-up message.";
    }
    signups.set(channelId, {
      guildId,
      channelId,
      hostUserId: ctx.userId,
      hostDisplayName: ctx.userDisplayName,
      messageId: sent.id,
      players: new Map([[ctx.userId, ctx.userDisplayName]]),
      ladyEnabled: false,
    });
    // Immediately repaint so the host shows up in the roster.
    await refreshSignupMessage(channelId);
    return {
      embeds: [
        {
          color: EMBED_COLOR,
          description: "✅",
        },
      ],
      // We replied via sendMessage above; the slash reply itself can
      // just be a thin ack that auto-dismisses.
    };
  });
}

/**
 * Button click handler for `kc:karyl-avalon:sig:<action>` —
 *   join   → toggle the clicker on (insert) / off (remove)
 *   leave  → remove the clicker
 *   start  → host-only, kicks off the game (deal + first round)
 *   cancel → host-only, tears down the signup
 *
 * Ephemeral reply per click so other players' rosters don't flash
 * with "X joined / X left" status; the main message repaints to show
 * the live roster + count.
 */
export async function handleSignupClick(
  ctx: ComponentContext,
  action: SignupAction,
): Promise<ComponentReply> {
  const channelId = ctx.channelId!;
  const signup = signups.get(channelId);
  if (!signup) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "error.notRunning"),
    });
    return null;
  }
  switch (action) {
    case "join":
      return handleJoinClick(ctx, signup);
    case "leave":
      return handleLeaveClick(ctx, signup);
    case "start":
      return handleStartClick(ctx, signup);
    case "cancel":
      return handleCancelClick(ctx, signup);
    case "lady":
      return handleLadyClick(ctx, signup);
    default:
      return null;
  }
}

/**
 * Host-only toggle for the Lady-of-the-Lake mechanic. Only meaningful
 * once the roster hits LADY_MIN_PLAYERS; the toggle button is hidden
 * below that. Non-host clicks ephemeral-reject the same as start /
 * cancel; under-quota clicks ephemeral with "需要 7 人才能啟用".
 */
async function handleLadyClick(
  ctx: ComponentContext,
  signup: Signup,
): Promise<ComponentReply> {
  if (ctx.userId !== signup.hostUserId) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.signup.onlyHost"),
    });
    return null;
  }
  if (signup.players.size < LADY_MIN_PLAYERS) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.signup.ladyNeeds7"),
    });
    return null;
  }
  signup.ladyEnabled = !signup.ladyEnabled;
  await refreshSignupMessage(signup.channelId);
  await followupEphemeral({
    interactionToken: ctx.interactionToken,
    content: signup.ladyEnabled
      ? t(undefined, "stage.signup.ladyOn")
      : t(undefined, "stage.signup.ladyOff"),
  });
  return null;
}

async function handleJoinClick(
  ctx: ComponentContext,
  signup: Signup,
): Promise<ComponentReply> {
  if (signup.players.has(ctx.userId)) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.signup.alreadyJoined"),
    });
    return null;
  }
  if (signup.players.size >= MAX_PLAYERS) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.signup.tooMany"),
    });
    return null;
  }
  signup.players.set(ctx.userId, ctx.userDisplayName);
  await refreshSignupMessage(signup.channelId);
  await followupEphemeral({
    interactionToken: ctx.interactionToken,
    content: t(undefined, "stage.signup.joined"),
  });
  return null;
}

async function handleLeaveClick(
  ctx: ComponentContext,
  signup: Signup,
): Promise<ComponentReply> {
  if (!signup.players.has(ctx.userId)) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.signup.notInList"),
    });
    return null;
  }
  // The host can leave the roster but the session stays under their
  // control — they still own the start / cancel buttons.
  signup.players.delete(ctx.userId);
  await refreshSignupMessage(signup.channelId);
  await followupEphemeral({
    interactionToken: ctx.interactionToken,
    content: t(undefined, "stage.signup.left"),
  });
  return null;
}

async function handleStartClick(
  ctx: ComponentContext,
  signup: Signup,
): Promise<ComponentReply> {
  if (ctx.userId !== signup.hostUserId) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.signup.onlyHost"),
    });
    return null;
  }
  if (signup.players.size < MIN_PLAYERS) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.signup.notEnough"),
    });
    return null;
  }
  // B-003: Lady-of-the-Lake toggle is now exposed via the `sig:lady`
  // button on the signup board. Effective value is gated by
  // LADY_MIN_PLAYERS — a stale `true` on a roster that dropped below
  // the threshold forces back to false so we don't ship a dead flag
  // into the GameState.
  const effectiveLady =
    signup.ladyEnabled && signup.players.size >= LADY_MIN_PLAYERS;
  const game = newGameState({
    guildId: signup.guildId,
    channelId: signup.channelId,
    hostUserId: signup.hostUserId,
    signups: [...signup.players.entries()].map(([userId, displayName]) => ({
      userId,
      displayName,
    })),
    ladyEnabled: effectiveLady,
  });
  deal(game);
  setGame(signup.channelId, game);
  signups.delete(signup.channelId);
  // Re-paint the sign-up message into a "dealing" snapshot so the
  // channel scrollback has a record, then post the reveal board.
  await editMessage({
    channelId: signup.channelId,
    messageId: signup.messageId,
    embeds: [
      {
        title: t(undefined, "stage.signup.title"),
        description: `▶ ${game.players
          .map((p, i) => `\`${i + 1}\` ${p.displayName}`)
          .join("\n")}`,
        color: EMBED_COLOR,
      },
    ],
    components: [],
  });
  await sendDealBoard(game);
  return null;
}

async function handleCancelClick(
  ctx: ComponentContext,
  signup: Signup,
): Promise<ComponentReply> {
  if (ctx.userId !== signup.hostUserId) {
    await followupEphemeral({
      interactionToken: ctx.interactionToken,
      content: t(undefined, "stage.signup.onlyHost"),
    });
    return null;
  }
  signups.delete(signup.channelId);
  await editMessage({
    channelId: signup.channelId,
    messageId: signup.messageId,
    embeds: [
      {
        title: t(undefined, "stage.signup.title"),
        description: t(undefined, "stage.signup.cancelled"),
        color: EMBED_COLOR,
      },
    ],
    components: [],
  });
  return null;
}

// ── rendering ───────────────────────────────────────────────────────────

function renderSignupEmbed(
  hostMention: string,
  names: string[],
  opts: { showLady: boolean; ladyEnabled: boolean } = {
    showLady: false,
    ladyEnabled: false,
  },
) {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    {
      name: t(undefined, "stage.signup.fieldCount"),
      value: String(names.length),
      inline: true,
    },
  ];
  if (opts.showLady) {
    fields.push({
      name: t(undefined, "stage.signup.fieldLady"),
      value: opts.ladyEnabled
        ? t(undefined, "stage.signup.ladyStateOn")
        : t(undefined, "stage.signup.ladyStateOff"),
      inline: true,
    });
  }
  if (names.length > 0) {
    fields.push({
      name: t(undefined, "stage.signup.fieldRoster"),
      value: names.map((n) => `\`${n}\``).join("\n"),
      inline: false,
    });
  }
  return {
    title: t(undefined, "stage.signup.title"),
    description: t(undefined, "stage.signup.content", { host: hostMention }),
    color: EMBED_COLOR,
    fields,
  };
}

function signupComponents(opts: {
  canStart: boolean;
  showLady: boolean;
  ladyEnabled: boolean;
}) {
  const row = [
    {
      type: 2 as const,
      style: 3 as const,
      custom_id: componentCustomId(PLUGIN_KEY, "sig", "join"),
      label: t(undefined, "stage.signup.join"),
    },
    {
      type: 2 as const,
      style: 2 as const,
      custom_id: componentCustomId(PLUGIN_KEY, "sig", "leave"),
      label: t(undefined, "stage.signup.leave"),
    },
    {
      type: 2 as const,
      style: 1 as const,
      custom_id: componentCustomId(PLUGIN_KEY, "sig", "start"),
      label: t(undefined, "stage.signup.start"),
      disabled: !opts.canStart,
    },
    {
      type: 2 as const,
      style: 4 as const,
      custom_id: componentCustomId(PLUGIN_KEY, "sig", "cancel"),
      label: t(undefined, "stage.signup.cancel"),
    },
  ];
  // Lady-of-the-Lake toggle only renders when the roster crosses the
  // rulebook threshold; below that there's no legal mode to enable.
  // Green when active, grey when off — mirrors the radio plugin's
  // loop-mode toggle convention.
  if (opts.showLady) {
    row.push({
      type: 2 as const,
      style: opts.ladyEnabled ? (3 as const) : (2 as const),
      custom_id: componentCustomId(PLUGIN_KEY, "sig", "lady"),
      label: opts.ladyEnabled
        ? t(undefined, "stage.signup.ladyButtonOn")
        : t(undefined, "stage.signup.ladyButtonOff"),
    });
  }
  return [{ type: 1 as const, components: row }];
}

async function refreshSignupMessage(channelId: string): Promise<void> {
  const signup = signups.get(channelId);
  if (!signup) return;
  const names = [...signup.players.values()];
  const hostMention = `<@${signup.hostUserId}>`;
  const showLady = signup.players.size >= LADY_MIN_PLAYERS;
  await editMessage({
    channelId,
    messageId: signup.messageId,
    embeds: [
      renderSignupEmbed(hostMention, names, {
        showLady,
        ladyEnabled: signup.ladyEnabled,
      }),
    ],
    components: signupComponents({
      canStart:
        signup.players.size >= MIN_PLAYERS &&
        signup.players.size <= MAX_PLAYERS,
      showLady,
      ladyEnabled: signup.ladyEnabled,
    }),
  });
}

/** Test helper / snapshot helper: WebUI lists active signups. */
export function listSignups(): Signup[] {
  return [...signups.values()];
}

/** Used by `/avalon stop` to also wipe a pending sign-up if no game yet. */
export function removeSignup(channelId: string): boolean {
  return signups.delete(channelId);
}

// Forward declaration to avoid a circular import — the deal-reveal
// renderer lives in stages.ts so it can share the per-player vision
// helper. handleSignupClick imports it lazily at call time.
export type DealRenderer = typeof renderDealReveal;
