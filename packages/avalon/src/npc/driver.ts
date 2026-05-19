/**
 * NPC orchestrator. Watches each stage opening, finds whose turn is
 * up among the NPCs, schedules a thinking-delay timer, then on fire
 * applies one NPC action by mutating game state and driving the
 * stage transition directly (without going through the click
 * dispatcher — NPCs don't have Discord interaction tokens, so any
 * ephemeral-followup call would noise the bot's RPC logs).
 *
 * Concurrency model:
 *   • `scheduleNpcStep(state)` is called at the tail of every
 *     `open*()` while the channel lock is still held by the calling
 *     human's click handler. It only sets a `setTimeout`; the timer
 *     callback runs OUTSIDE the lock.
 *   • The callback re-acquires `withChannelLock(channelId, …)`,
 *     re-reads the GameState, validates `sessionId` (so a stop +
 *     fresh start between schedule and fire doesn't drive the new
 *     game), runs one NPC action, and recursively schedules the next
 *     step. After-action `state.current` may have advanced to a new
 *     stage — scheduleNpcStep figures that out from the latest
 *     `state.current.kind`.
 *   • One pending timer per channel — re-scheduling clears the old
 *     timer first. `clearNpcTimer(channelId)` is the hook /avalon
 *     stop and endGame use to abandon a pending action.
 */

import {
  factionOf,
  isNpc,
  leader,
  playerByIndex,
  recordMissionResult,
  rotateLeader,
  settleAssassinate,
  type GameState,
  type Player,
} from "../game/state.js";
import { evaluateVerdict } from "../game/state.js";
import { ROLES } from "../game/roles.js";
import { withChannelLock, getGame } from "../game/store.js";
import { t } from "../i18n/index.js";
import { EMBED_COLOR } from "../constants.js";
import { editMessage } from "../flow/discord.js";
import { runtime } from "../flow/runtime.js";
import {
  decideAppoint,
  decidePublicVote,
  decidePrivateBallot,
  decideLake,
  decideAssassinate,
  defaultRng,
  type Rng,
} from "./decide.js";

/** Per-channel pending timer handle. */
const timers = new Map<string, NodeJS.Timeout>();

/**
 * Acting delay window. Production default 1.5–3 s per action gives
 * humans a real "NPC is thinking" cadence. Tests set `[0, 0]` via
 * `setNpcDelayMs` to run actions synchronously.
 */
let delayMs: { min: number; max: number } = { min: 1500, max: 3000 };

/**
 * Override the per-action delay window. Tests use `{ min: 0, max: 0 }`
 * to disable the "thinking" pause so a full game can run inside the
 * 10s vitest timeout.
 */
export function setNpcDelayMs(opts: { min: number; max: number }): void {
  delayMs = opts;
}

/** Reset the delay back to production defaults. */
export function resetNpcDelayMs(): void {
  delayMs = { min: 1500, max: 3000 };
}

/** RNG override knob for tests that want reproducible NPC choices. */
let rng: Rng = defaultRng;
export function setNpcRng(r: Rng): void {
  rng = r;
}
export function resetNpcRng(): void {
  rng = defaultRng;
}

function nextDelay(): number {
  if (delayMs.max <= 0) return 0;
  const span = delayMs.max - delayMs.min;
  return delayMs.min + Math.floor(Math.random() * (span + 1));
}

/**
 * Find the NPC who should act next given the current stage state. For
 * stages with multiple actors (publicVote, privateVote) returns the
 * lowest-seat unfinished NPC; the caller fires one action per tick
 * and re-schedules.
 */
function nextNpcActor(state: GameState): Player | null {
  if (!state.current) return null;
  switch (state.current.kind) {
    case "appoint": {
      const lead = leader(state);
      return isNpc(lead) ? lead : null;
    }
    case "publicVote": {
      const votes = state.current.votes;
      return (
        state.players.find((p) => isNpc(p) && !(p.userId in votes)) ?? null
      );
    }
    case "privateVote": {
      const votes = state.current.votes;
      const members = new Set(state.current.missionMembers);
      return (
        state.players.find(
          (p) => isNpc(p) && members.has(p.index) && !(p.userId in votes),
        ) ?? null
      );
    }
    case "lake": {
      const holder = playerByIndex(state, state.current.holderIndex);
      return holder && isNpc(holder) ? holder : null;
    }
    case "assassinate": {
      const a = state.players.find((p) => p.position === "assassin");
      return a && isNpc(a) ? a : null;
    }
  }
}

/**
 * Cancel any pending NPC timer for this channel. Called by
 * /avalon stop and by endGame so the timer doesn't fire on a
 * removed-or-replaced GameState.
 */
export function clearNpcTimer(channelId: string): void {
  const handle = timers.get(channelId);
  if (handle) {
    clearTimeout(handle);
    timers.delete(channelId);
  }
}

/**
 * Schedule the next NPC action for this channel, if one is due.
 * Called at the tail of each `open*()` AND recursively after each
 * NPC action so we keep stepping through consecutive NPC turns.
 *
 * No-op if no NPC is currently expected to act.
 */
export function scheduleNpcStep(state: GameState): void {
  const channelId = state.channelId;
  // Already a pending timer for this channel — clear it; the new
  // schedule reflects the latest state.current.
  clearNpcTimer(channelId);
  if (state.stage === "ended" || state.winner !== null) return;
  const actor = nextNpcActor(state);
  if (!actor) return;
  const expectedSession = state.sessionId;
  const delay = nextDelay();
  if (delay === 0) {
    // Synchronous path for tests — wrap in withChannelLock so the
    // semantics stay identical. We've already been called from
    // INSIDE a lock (open*() runs under one), so we cannot re-enter
    // synchronously; defer to microtask.
    queueMicrotask(() => {
      void runStep(channelId, expectedSession);
    });
    return;
  }
  const handle = setTimeout(() => {
    timers.delete(channelId);
    void runStep(channelId, expectedSession);
  }, delay);
  // Don't block process exit on a pending NPC timer.
  if (typeof handle.unref === "function") handle.unref();
  timers.set(channelId, handle);
}

/**
 * Execute one NPC action under the channel lock. Re-validates the
 * game (session id, stage kind, actor identity) at fire time so a
 * race with a real human click or a /avalon stop doesn't corrupt
 * state.
 */
async function runStep(
  channelId: string,
  expectedSessionId: string,
): Promise<void> {
  await withChannelLock(channelId, async () => {
    const state = getGame(channelId);
    if (!state || state.sessionId !== expectedSessionId) return;
    if (state.stage === "ended" || state.winner !== null) return;
    const actor = nextNpcActor(state);
    if (!actor) return;
    try {
      switch (state.current?.kind) {
        case "appoint":
          await performAppoint(state, actor);
          break;
        case "publicVote":
          await performPublicVote(state, actor);
          break;
        case "privateVote":
          await performPrivateVote(state, actor);
          break;
        case "lake":
          await performLake(state, actor);
          break;
        case "assassinate":
          await performAssassinate(state, actor);
          break;
      }
    } catch (err) {
      runtime().log.error("avalon: NPC step threw", {
        channelId,
        err: String(err),
      });
      return;
    }
  });
  // After the lock is released, re-read state and queue the next NPC
  // tick. Done outside the lock so consecutive NPC turns don't block
  // human clicks in the meantime. SessionId guard prevents a stale
  // post-stop+restart `runStep` from cancelling the new session's
  // timer (the inner `scheduleNpcStep` clears any pending timer
  // before re-scheduling).
  const next = getGame(channelId);
  if (next && next.sessionId === expectedSessionId) scheduleNpcStep(next);
}

// ── per-stage execution ──────────────────────────────────────────

async function performAppoint(state: GameState, npc: Player): Promise<void> {
  if (state.current?.kind !== "appoint") return;
  const chosen = decideAppoint(state, npc, rng);
  state.current.selected = chosen;
  const messageId = state.current.messageId;
  // Strip the appoint board's buttons and freeze its content, mirroring
  // confirmAppoint's lock-the-board step.
  const { renderAppointEmbed } = await import("../flow/stages-appoint.js");
  const selectedNames = chosen.map(
    (s) => playerByIndex(state, s)?.displayName ?? `#${s + 1}`,
  );
  await editMessage({
    channelId: state.channelId,
    messageId,
    embeds: [renderAppointEmbed(state, npc.displayName, selectedNames)],
    components: [],
  });
  const { openPublicVote } = await import("../flow/stages-publicvote.js");
  await openPublicVote(state, chosen);
}

async function performPublicVote(state: GameState, npc: Player): Promise<void> {
  if (state.current?.kind !== "publicVote") return;
  const vote = decidePublicVote(
    state,
    npc,
    state.current.missionMembers,
    rng,
  );
  state.current.votes[npc.userId] = vote;
  const { renderPublicVoteEmbed, publicVoteComponents, resolvePublicVote } =
    await import("../flow/stages-publicvote.js");
  await editMessage({
    channelId: state.channelId,
    messageId: state.current.messageId,
    embeds: [
      renderPublicVoteEmbed(
        state,
        state.current.missionMembers,
        state.current.votes,
      ),
    ],
    components: publicVoteComponents(),
  });
  if (
    Object.keys(state.current.votes).length === state.players.length
  ) {
    await resolvePublicVote(state);
  }
}

async function performPrivateVote(
  state: GameState,
  npc: Player,
): Promise<void> {
  if (state.current?.kind !== "privateVote") return;
  let ballot = decidePrivateBallot(state, npc, rng);
  // Belt-and-braces: the engine refuses an Arthur "fail" ballot;
  // decidePrivateBallot already returns success for Arthur, but
  // re-clamp here so a future tweak to decide.ts can't slip a fail
  // through.
  if (ballot === "fail" && factionOf(npc) === "arthur") ballot = "success";
  state.current.votes[npc.userId] = ballot;
  const {
    renderPrivateVoteEmbed,
    privateVoteComponents,
    resolvePrivateVote,
  } = await import("../flow/stages-privatevote.js");
  await editMessage({
    channelId: state.channelId,
    messageId: state.current.messageId,
    embeds: [
      renderPrivateVoteEmbed(
        state,
        state.current.missionMembers,
        Object.keys(state.current.votes).length,
      ),
    ],
    components: privateVoteComponents(),
  });
  if (
    Object.keys(state.current.votes).length ===
    state.current.missionMembers.length
  ) {
    await resolvePrivateVote(state);
  }
  // recordMissionResult is called inside resolvePrivateVote — silence
  // the unused-import warning by referencing it conditionally below.
  void recordMissionResult;
}

async function performLake(state: GameState, npc: Player): Promise<void> {
  if (state.current?.kind !== "lake") return;
  const targetSeat = decideLake(state, npc, rng);
  const target = playerByIndex(state, targetSeat);
  if (!target || target.userId === npc.userId) return;
  // Mirror handleLakeClick's mutate + repaint + transition logic.
  npc.lakeTarget = target.userId;
  state.ladyHolderIndex = target.index;
  state.ladyUseCount++;
  const messageId = state.current.messageId;
  await editMessage({
    channelId: state.channelId,
    messageId,
    embeds: [
      {
        color: EMBED_COLOR,
        title: t(undefined, "stage.lake.title"),
        description: t(undefined, "stage.lake.checked", {
          holder: `**${npc.displayName}**`,
          target: `**${target.displayName}**`,
        }),
      },
    ],
    components: [],
  });
  state.current = null;
  const verdict = evaluateVerdict(state);
  if (verdict.ended) {
    const { endGame } = await import("../flow/stages-ending.js");
    await endGame(state, verdict);
    return;
  }
  rotateLeader(state);
  const { openAppoint } = await import("../flow/stages-appoint.js");
  await openAppoint(state);
}

async function performAssassinate(
  state: GameState,
  npc: Player,
): Promise<void> {
  if (state.current?.kind !== "assassinate") return;
  const targetSeat = decideAssassinate(state, npc, rng);
  const target = playerByIndex(state, targetSeat);
  if (!target || target.userId === npc.userId) return;
  state.assassinTargetIndex = targetSeat;
  const verdict = settleAssassinate(state);
  await editMessage({
    channelId: state.channelId,
    messageId: state.current.messageId,
    embeds: [
      {
        color: EMBED_COLOR,
        title: t(undefined, "stage.assassinate.title"),
        description: t(undefined, "stage.assassinate.result", {
          assassin: `**${npc.displayName}**`,
          target: `**${target.displayName}**`,
          role: t(undefined, ROLES[target.position].nameKey),
        }),
      },
    ],
    components: [],
  });
  state.current = null;
  const { endGame } = await import("../flow/stages-ending.js");
  await endGame(state, verdict);
}
