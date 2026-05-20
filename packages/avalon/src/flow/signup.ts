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
import {
  NPC_USERID_PREFIX,
  deal,
  newGameState,
  type GameState,
} from "../game/state.js";
import { editMessage, sendMessage } from "./discord.js";
import { renderDealReveal, sendDealBoard } from "./stages.js";
import { sampleNpcDisplayNames } from "../npc/names.js";

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
   * Synthetic NPC players pre-seated at signup time so a small group
   * can fill a 5+ table. Stored as `[userId, displayName]` pairs,
   * insertion-ordered, with `userId` always prefixed `npc:` (see
   * `state.NPC_USERID_PREFIX`). The size is bounded by
   * MIN_PLAYERS/MAX_PLAYERS together with `players.size` (a total
   * roster of 5–10).
   */
  npcs: Array<{ userId: string; displayName: string }>;
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

export type SignupAction =
  | "join"
  | "leave"
  | "start"
  | "cancel"
  | "lady"
  | "npc+"
  | "npc-";

/**
 * Entry point from the `/avalon start` slash. Posts the public sign-up
 * embed with `加入 / 開始 / 取消` buttons; returns a short reply to
 * dismiss the slash command (Discord requires SOME reply).
 */
export async function startSignup(
  ctx: CommandContext,
  guildId: string,
  channelId: string,
  opts: { npcCount?: number } = {},
): Promise<CommandReply> {
  return withChannelLock(channelId, async () => {
    if (getGame(channelId) || signups.has(channelId)) {
      return t(undefined, "error.alreadyRunning");
    }
    const hostMention = `<@${ctx.userId}>`;
    // Cap the upfront NPC count so a single user can't spawn 50 seats
    // — the engine's MAX_PLAYERS clamps the roster total anyway, but
    // here we trim early so we don't allocate names we'll never use.
    const requestedNpcs = Math.max(
      0,
      Math.min(opts.npcCount ?? 0, MAX_PLAYERS - 1),
    );
    const initialNpcs = sampleNpcDisplayNames(
      requestedNpcs,
      new Set([ctx.userDisplayName]),
    ).map((displayName, i) => ({
      userId: `${NPC_USERID_PREFIX}${i}`,
      displayName,
    }));
    // Initial board: host + seeded NPCs in the roster.
    const sent = await sendMessage({
      channelId,
      embeds: [renderSignupEmbed(hostMention, [ctx.userDisplayName], {
        npcNames: initialNpcs.map((n) => n.displayName),
        showLady: false,
        ladyEnabled: false,
      })],
      components: signupComponents({
        canStart:
          1 + initialNpcs.length >= MIN_PLAYERS &&
          1 + initialNpcs.length <= MAX_PLAYERS,
        showLady: false,
        ladyEnabled: false,
        canAddNpc: 1 + initialNpcs.length < MAX_PLAYERS,
        canRemoveNpc: initialNpcs.length > 0,
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
      npcs: initialNpcs,
      ladyEnabled: false,
    });
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
  // Stale signup board — drop the click silently.
  if (!signup) return null;
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
    case "npc+":
      return handleNpcAddClick(ctx, signup);
    case "npc-":
      return handleNpcRemoveClick(ctx, signup);
    default:
      return null;
  }
}

/**
 * Host-only NPC roster controls. Mirrors the sig:lady pattern: host
 * gate first, capacity gate next, mutate then repaint. Total roster
 * (humans + NPCs) is bounded by MAX_PLAYERS = 10.
 */
async function handleNpcAddClick(
  ctx: ComponentContext,
  signup: Signup,
): Promise<ComponentReply> {
  // Non-host clicks and at-cap clicks are no-ops — drop silently
  // (the button is rendered disabled at cap anyway).
  if (ctx.userId !== signup.hostUserId) return null;
  if (signup.players.size + signup.npcs.length >= MAX_PLAYERS) return null;
  const taken = new Set<string>([
    ...signup.players.values(),
    ...signup.npcs.map((n) => n.displayName),
  ]);
  const [name] = sampleNpcDisplayNames(1, taken);
  const newIndex = signup.npcs.length;
  signup.npcs.push({
    userId: `${NPC_USERID_PREFIX}${newIndex}`,
    displayName: name,
  });
  await refreshSignupMessage(signup.channelId);
  return null;
}

async function handleNpcRemoveClick(
  ctx: ComponentContext,
  signup: Signup,
): Promise<ComponentReply> {
  // Non-host clicks and no-NPC clicks are no-ops — drop silently
  // (the button is rendered disabled when there are no NPCs).
  if (ctx.userId !== signup.hostUserId) return null;
  if (signup.npcs.length === 0) return null;
  signup.npcs.pop();
  // Mirror handleLeaveClick: if the roster drops below the lady
  // threshold, clear the toggle so a re-add doesn't silently inherit
  // a stale `true` for a freshly-composed roster.
  if (signup.players.size + signup.npcs.length < LADY_MIN_PLAYERS) {
    signup.ladyEnabled = false;
  }
  await refreshSignupMessage(signup.channelId);
  return null;
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
  // Non-host clicks and under-quota clicks are no-ops — drop silently
  // (the toggle button only renders at all once the roster hits 7).
  if (ctx.userId !== signup.hostUserId) return null;
  if (signup.players.size + signup.npcs.length < LADY_MIN_PLAYERS) {
    return null;
  }
  signup.ladyEnabled = !signup.ladyEnabled;
  await refreshSignupMessage(signup.channelId);
  return null;
}

async function handleJoinClick(
  ctx: ComponentContext,
  signup: Signup,
): Promise<ComponentReply> {
  // Already joined → no-op. The roster repaint is the feedback.
  if (signup.players.has(ctx.userId)) return null;
  if (signup.players.size + signup.npcs.length >= MAX_PLAYERS) {
    // A human joining at cap evicts the last-seeded NPC so
    // /avalon start npc:9 doesn't render the roster unjoinable for
    // every other human. If there's no NPC to evict, the roster is
    // genuinely full — drop the click silently.
    if (signup.npcs.length > 0) {
      signup.npcs.pop();
    } else {
      return null;
    }
  }
  signup.players.set(ctx.userId, ctx.userDisplayName);
  await refreshSignupMessage(signup.channelId);
  return null;
}

async function handleLeaveClick(
  ctx: ComponentContext,
  signup: Signup,
): Promise<ComponentReply> {
  // Not on the roster → no-op.
  if (!signup.players.has(ctx.userId)) return null;
  // The host can leave the roster but the session stays under their
  // control — they still own the start / cancel buttons.
  signup.players.delete(ctx.userId);
  // Lady-of-the-Lake is only legal at 7+. If we drop below the
  // threshold after a leave, force the toggle back to false so a
  // later re-join doesn't silently inherit a stale `true` for a
  // freshly-composed roster (H-1: the host hasn't re-confirmed
  // their intent for the new player mix).
  if (signup.players.size + signup.npcs.length < LADY_MIN_PLAYERS) {
    signup.ladyEnabled = false;
  }
  await refreshSignupMessage(signup.channelId);
  return null;
}

async function handleStartClick(
  ctx: ComponentContext,
  signup: Signup,
): Promise<ComponentReply> {
  // Non-host start, or start below the minimum, are no-ops — the
  // Start button is host-rendered and disabled below MIN_PLAYERS, so
  // these shouldn't be reachable; drop them silently if they arrive.
  if (ctx.userId !== signup.hostUserId) return null;
  const totalSize = signup.players.size + signup.npcs.length;
  if (totalSize < MIN_PLAYERS) return null;
  // B-003: Lady-of-the-Lake toggle is now exposed via the `sig:lady`
  // button on the signup board. Effective value is gated by
  // LADY_MIN_PLAYERS — a stale `true` on a roster that dropped below
  // the threshold forces back to false so we don't ship a dead flag
  // into the GameState.
  const effectiveLady =
    signup.ladyEnabled && totalSize >= LADY_MIN_PLAYERS;
  const game = newGameState({
    guildId: signup.guildId,
    channelId: signup.channelId,
    hostUserId: signup.hostUserId,
    // Humans first, then NPCs — `deal()` reshuffles before assigning
    // positions, so insertion order doesn't bias role distribution.
    signups: [
      ...[...signup.players.entries()].map(([userId, displayName]) => ({
        userId,
        displayName,
      })),
      ...signup.npcs,
    ],
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
  // Only the host can cancel — non-host clicks are no-ops.
  if (ctx.userId !== signup.hostUserId) return null;
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
  opts: {
    showLady: boolean;
    ladyEnabled: boolean;
    npcNames?: string[];
  } = {
    showLady: false,
    ladyEnabled: false,
  },
) {
  const npcNames = opts.npcNames ?? [];
  const total = names.length + npcNames.length;
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    {
      name: t(undefined, "stage.signup.fieldCount"),
      value: String(total),
      inline: true,
    },
  ];
  if (npcNames.length > 0) {
    fields.push({
      name: t(undefined, "stage.signup.fieldNpcCount"),
      value: String(npcNames.length),
      inline: true,
    });
  }
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
  if (npcNames.length > 0) {
    const suffix = t(undefined, "stage.signup.npcLineSuffix");
    fields.push({
      name: t(undefined, "stage.signup.fieldNpcRoster"),
      value: npcNames.map((n) => `\`${n}\`${suffix}`).join("\n"),
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
  canAddNpc: boolean;
  canRemoveNpc: boolean;
}) {
  const row1 = [
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
    row1.push({
      type: 2 as const,
      style: opts.ladyEnabled ? (3 as const) : (2 as const),
      custom_id: componentCustomId(PLUGIN_KEY, "sig", "lady"),
      label: opts.ladyEnabled
        ? t(undefined, "stage.signup.ladyButtonOn")
        : t(undefined, "stage.signup.ladyButtonOff"),
    });
  }
  // NPC +/− on their own row so the primary controls stay in row 1.
  // Discord allows up to 5 action rows per message; signup uses 2.
  const row2: Array<{
    type: 2;
    style: 1 | 2 | 3 | 4 | 5;
    custom_id: string;
    label: string;
    disabled?: boolean;
  }> = [
    {
      type: 2 as const,
      style: 2 as const,
      custom_id: componentCustomId(PLUGIN_KEY, "sig", "npc+"),
      label: t(undefined, "stage.signup.npcAdd"),
      disabled: !opts.canAddNpc,
    },
    {
      type: 2 as const,
      style: 2 as const,
      custom_id: componentCustomId(PLUGIN_KEY, "sig", "npc-"),
      label: t(undefined, "stage.signup.npcRemove"),
      disabled: !opts.canRemoveNpc,
    },
  ];
  return [
    { type: 1 as const, components: row1 },
    { type: 1 as const, components: row2 },
  ];
}

async function refreshSignupMessage(channelId: string): Promise<void> {
  const signup = signups.get(channelId);
  if (!signup) return;
  const names = [...signup.players.values()];
  const npcNames = signup.npcs.map((n) => n.displayName);
  const total = names.length + npcNames.length;
  const hostMention = `<@${signup.hostUserId}>`;
  const showLady = total >= LADY_MIN_PLAYERS;
  await editMessage({
    channelId,
    messageId: signup.messageId,
    embeds: [
      renderSignupEmbed(hostMention, names, {
        showLady,
        ladyEnabled: signup.ladyEnabled,
        npcNames,
      }),
    ],
    components: signupComponents({
      canStart: total >= MIN_PLAYERS && total <= MAX_PLAYERS,
      showLady,
      ladyEnabled: signup.ladyEnabled,
      canAddNpc: total < MAX_PLAYERS,
      canRemoveNpc: signup.npcs.length > 0,
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
