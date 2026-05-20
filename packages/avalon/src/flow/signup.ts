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
import {
  DEFAULT_ROLE_TOGGLES,
  ROLES,
  type RoleToggles,
} from "../game/roles.js";
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
   * Optional special roles, fixed by the `/avalon start` options.
   * Threaded into the GameState verbatim at start time.
   */
  roleToggles: RoleToggles;
  /**
   * Whether the host asked for Lady-of-the-Lake at `/avalon start`.
   * Only takes effect if the final roster reaches LADY_MIN_PLAYERS —
   * the rulebook gates the lake to 7+ player tables — so the handler
   * resolves the effective value when the game is dealt.
   */
  lakeEnabled: boolean;
}

const signups = new Map<string, Signup>();

/**
 * Minimum / maximum players. Bumped from 4→5 (B-001): n=4 is not a
 * supported Avalon table in the official rulebook. The deck builder
 * and mission-size table still handle n=4, but it is unreachable
 * through the signup flow.
 */
const MIN_PLAYERS = 5;
const MAX_PLAYERS = 10;

/**
 * Lady-of-the-Lake is only legal at 7+ player tables per the
 * rulebook. The host opts in via the `/avalon start lake:` option;
 * `handleStartClick` forces the effective value false if the final
 * roster never reaches this threshold, so we don't dump a dead
 * `ladyEnabled` flag onto the GameState.
 */
const LADY_MIN_PLAYERS = 7;

export type SignupAction =
  | "join"
  | "leave"
  | "start"
  | "cancel"
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
  opts: {
    npcCount?: number;
    /** Optional special roles; defaults to all enabled. */
    roleToggles?: RoleToggles;
    /** Lady-of-the-Lake opt-in; defaults to enabled (7+ tables only). */
    lakeEnabled?: boolean;
  } = {},
): Promise<CommandReply> {
  return withChannelLock(channelId, async () => {
    if (getGame(channelId) || signups.has(channelId)) {
      return t(undefined, "error.alreadyRunning");
    }
    const roleToggles = opts.roleToggles ?? DEFAULT_ROLE_TOGGLES;
    const lakeEnabled = opts.lakeEnabled ?? true;
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
    const initialTotal = 1 + initialNpcs.length;
    const sent = await sendMessage({
      channelId,
      embeds: [renderSignupEmbed(hostMention, [ctx.userDisplayName], {
        npcNames: initialNpcs.map((n) => n.displayName),
        roleToggles,
        lakeEnabled,
      })],
      components: signupComponents({
        canStart:
          initialTotal >= MIN_PLAYERS && initialTotal <= MAX_PLAYERS,
        canAddNpc: initialTotal < MAX_PLAYERS,
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
      roleToggles,
      lakeEnabled,
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
    case "npc+":
      return handleNpcAddClick(ctx, signup);
    case "npc-":
      return handleNpcRemoveClick(ctx, signup);
    default:
      return null;
  }
}

/**
 * Host-only NPC roster controls: host gate first, capacity gate next,
 * mutate then repaint. Total roster (humans + NPCs) is bounded by
 * MAX_PLAYERS = 10.
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
  // Lady-of-the-Lake was opted in via `/avalon start lake:`. It only
  // fires on 7+ tables, so a smaller final roster forces the
  // effective value false rather than shipping a dead flag.
  const effectiveLady =
    signup.lakeEnabled && totalSize >= LADY_MIN_PLAYERS;
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
    roleToggles: signup.roleToggles,
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

/**
 * One-line-per-side summary of the rules picked at `/avalon start`:
 * the four optional roles, then Lady-of-the-Lake. ✓ = in play,
 * ✗ = replaced by a powerless stand-in (or, for the lake, off).
 */
function renderRulesValue(
  roleToggles: RoleToggles,
  lakeEnabled: boolean,
): string {
  const mark = (on: boolean): string => (on ? "✓" : "✗");
  const roleLine = (["morgana", "percival", "mordred", "oberon"] as const)
    .map((pos) => `${t(undefined, ROLES[pos].nameKey)} ${mark(roleToggles[pos])}`)
    .join("　");
  const lakeLine =
    `${t(undefined, "stage.signup.fieldLady")} ${mark(lakeEnabled)}` +
    `${lakeEnabled ? t(undefined, "stage.signup.lakeNote") : ""}`;
  return `${roleLine}\n${lakeLine}`;
}

function renderSignupEmbed(
  hostMention: string,
  names: string[],
  opts: {
    roleToggles: RoleToggles;
    lakeEnabled: boolean;
    npcNames?: string[];
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
  // Rule settings (optional roles + lake) are fixed at `/avalon start`
  // time — shown read-only so joiners see the table they're entering.
  fields.push({
    name: t(undefined, "stage.signup.fieldRules"),
    value: renderRulesValue(opts.roleToggles, opts.lakeEnabled),
    inline: false,
  });
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
  canAddNpc: boolean;
  canRemoveNpc: boolean;
}) {
  const row1: Array<{
    type: 2;
    style: 1 | 2 | 3 | 4 | 5;
    custom_id: string;
    label: string;
    disabled?: boolean;
  }> = [
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
  await editMessage({
    channelId,
    messageId: signup.messageId,
    embeds: [
      renderSignupEmbed(hostMention, names, {
        roleToggles: signup.roleToggles,
        lakeEnabled: signup.lakeEnabled,
        npcNames,
      }),
    ],
    components: signupComponents({
      canStart: total >= MIN_PLAYERS && total <= MAX_PLAYERS,
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
