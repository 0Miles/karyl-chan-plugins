/**
 * Per-stage NPC decision functions — pure, deterministic given an Rng.
 *
 * Each function consumes the public `GameState` plus the acting NPC's
 * `Player` record, and returns the next concrete action. The rules are
 * intentionally light: an Avalon veteran would beat them, but the
 * point is to fill empty seats during a casual session, not to
 * benchmark engines.
 *
 * Information access is gated through `buildVision(state, viewer)` —
 * the SAME function the real-player ephemeral uses — so an NPC can
 * never "cheat" by reading information its role wouldn't see.
 */

import {
  currentMissionSize,
  currentRoundNeeds2Fail,
  factionOf,
  playerByIndex,
  type GameState,
  type Player,
} from "../game/state.js";
import { buildVision, type VisionMarker } from "../game/vision.js";

export type Rng = () => number;
export const defaultRng: Rng = Math.random;

/**
 * Pick `count` distinct elements from `pool` weighted by their
 * position (earlier = more likely). Used to keep "best candidate"
 * selection from being 100% deterministic — same weighting as a
 * temperature-1 softmax over rank.
 */
function pickWeighted<T>(pool: T[], count: number, rng: Rng): T[] {
  const remaining = [...pool];
  const out: T[] = [];
  while (out.length < count && remaining.length > 0) {
    // Bias toward the head of the list but not absolute.
    const r = rng();
    const idx = Math.min(
      Math.floor(r * r * remaining.length),
      remaining.length - 1,
    );
    out.push(remaining.splice(idx, 1)[0]);
  }
  return out;
}

/**
 * Leader chooses a mission roster. Approach:
 *   • Build a candidate list ordered by trust:
 *     - Always include self first (any role wants to be on its own
 *       mission for direct control).
 *     - Arthur faction: prefer seats NOT marked red. Demote red.
 *     - Mordred faction: include up to one teammate (red marker),
 *       fill rest with non-red (looks innocent to good players).
 *   • Apply a weighted random pick over the trust-ordered candidates
 *     so the leader doesn't always pick the most-trusted seats.
 */
export function decideAppoint(
  state: GameState,
  leader: Player,
  rng: Rng = defaultRng,
): number[] {
  const size = currentMissionSize(state);
  const vision = buildVision(state, leader);
  const me = factionOf(leader);
  // Sort seats by trust desc. Higher score = more desirable on a mission.
  const scored = vision
    .map((row) => {
      const marker: VisionMarker = row.marker;
      let score: number;
      if (marker === "self") {
        score = 100; // always want self in
      } else if (me === "arthur") {
        if (marker === "red") score = 0;
        else if (marker === "purple") score = 30; // could be morgana
        else score = 50;
      } else {
        // Mordred faction
        if (marker === "red") score = 60; // teammate — useful once
        else score = 70; // unknown blue is fine cover
      }
      // Add small jitter so equal-scored seats shuffle.
      score += rng() * 5;
      return { seat: row.player.index, score };
    })
    .sort((a, b) => b.score - a.score);

  if (me === "mordred") {
    // Cap red picks at 1 for non-round-4-needs-2 missions; on a
    // round-4 7+ player table we want 2 reds to actually fail.
    const cap = currentRoundNeeds2Fail(state) ? 2 : 1;
    const reds = vision.filter(
      (r) => r.marker === "red" && r.player.userId !== leader.userId,
    );
    if (reds.length > cap) {
      // Demote extra reds below blues so they fall off the pick list.
      const dropIds = new Set(
        reds
          .slice(cap)
          .map((r) => r.player.userId),
      );
      for (const s of scored) {
        const p = playerByIndex(state, s.seat);
        if (p && dropIds.has(p.userId)) s.score = -1;
      }
      scored.sort((a, b) => b.score - a.score);
    }
  }

  const ordered = scored.map((s) => s.seat);
  const picks = pickWeighted(ordered, size, rng);
  // De-dup defensively (shouldn't be needed — pickWeighted splices).
  return Array.from(new Set(picks)).slice(0, size);
}

/**
 * Public vote — approve/reject the proposed mission.
 *
 * Rules:
 *  • Leader of the proposal always approves their own pick.
 *  • If consecutiveRejections >= 4 — always approve regardless of
 *    faction, since one more reject loses the game for everyone.
 *  • Arthur side approves when the mission contains zero `red` seats
 *    (no known evil); rejects when it contains any. Loyal/Oberon see
 *    no markers so they coin-flip with a slight pro-approve lean.
 *  • Mordred side approves when the mission contains at least one
 *    `red` teammate (we want our person on the mission). Rejects
 *    when it's all blues (we can't help it fail). With low rejection
 *    counter, sometimes also rejects all-blue missions to burn down
 *    proposals.
 *  • A ~10% noise flip masks the determinism.
 */
export function decidePublicVote(
  state: GameState,
  voter: Player,
  missionMembers: number[],
  rng: Rng = defaultRng,
): "yes" | "no" {
  if (voter.index === state.leaderIndex) return "yes";
  if (state.consecutiveRejections >= 4) return "yes";

  const vision = buildVision(state, voter);
  const me = factionOf(voter);
  const memberSet = new Set(missionMembers);
  const memberRows = vision.filter((r) => memberSet.has(r.player.index));
  const knownEvilOnMission = memberRows.some((r) => r.marker === "red");
  const knownAllyOnMission =
    me === "mordred" && memberRows.some((r) => r.marker === "red");

  let base: "yes" | "no";
  if (me === "arthur") {
    if (knownEvilOnMission) base = "no";
    else if (voter.position === "loyal" || voter.position === "merlin") {
      // Loyal: coin-flip lean approve (60/40).
      // Merlin: already covered by the knownEvilOnMission check above —
      // if no red on team, approve.
      base = rng() < 0.6 ? "yes" : "no";
    } else {
      base = "yes";
    }
  } else {
    // Mordred faction
    if (knownAllyOnMission) base = "yes";
    else {
      // All-blue mission and no fail vote we can cast — reject to
      // burn rejection counter when it's safe.
      base = state.consecutiveRejections < 3 ? "no" : "yes";
    }
  }
  // Noise flip.
  if (rng() < 0.1) return base === "yes" ? "no" : "yes";
  return base;
}

/**
 * Private mission ballot.
 *
 *  • Arthur faction: always success (the engine rejects fail from
 *    them at the boundary anyway).
 *  • Mordred faction: fail with high probability. Tactical
 *    exceptions:
 *    - Round 4 with 7+ players needs 2 fails to bust the mission.
 *      If the player is the lone evil on the team, voting fail just
 *      outs them — pass instead.
 *    - If missions tally already has 2 fails, the next failure ends
 *      the game; vote fail unconditionally then.
 *    - Otherwise ~80% fail to keep things unpredictable.
 */
export function decidePrivateBallot(
  state: GameState,
  voter: Player,
  rng: Rng = defaultRng,
): "success" | "fail" {
  if (factionOf(voter) === "arthur") return "success";
  // Count fellow evil on this mission via vision.
  if (state.current?.kind !== "privateVote") return "success";
  const memberSet = new Set(state.current.missionMembers);
  const vision = buildVision(state, voter);
  const evilOnTeam = vision.filter(
    (r) => memberSet.has(r.player.index) && r.marker === "red",
  ).length;
  // Round-4 special: if 2-fail rule applies and only one evil sees
  // any teammate on team (i.e. could be us alone), pass to hide.
  if (currentRoundNeeds2Fail(state) && evilOnTeam < 1) {
    return "success";
  }
  // 2 fails already on the board — 3rd fail wins the game now.
  const fails = state.missionResults.filter((r) => r === "fail").length;
  if (fails >= 2) return "fail";
  return rng() < 0.8 ? "fail" : "success";
}

/**
 * Lake-of-the-Lady target. Pick a seat that's:
 *   • Not self, not previously a holder (`lakeTarget !== null`).
 *   • Preferring unknown-marker seats (max info gain) over already
 *     known seats (waste).
 */
export function decideLake(
  state: GameState,
  holder: Player,
  rng: Rng = defaultRng,
): number {
  const vision = buildVision(state, holder);
  const candidates = vision.filter(
    (r) =>
      r.player.userId !== holder.userId &&
      r.player.lakeTarget === null &&
      r.marker !== "self",
  );
  if (candidates.length === 0) {
    // Defensive fallback — the public board should never have opened
    // lake if no candidate existed.
    return holder.index;
  }
  const unknowns = candidates.filter((r) => r.marker === "unknown");
  const pool = unknowns.length > 0 ? unknowns : candidates;
  const pick = pool[Math.floor(rng() * pool.length)];
  return pick.player.index;
}

/**
 * Assassinate target. NPC assassin picks Merlin by elimination —
 * filter out:
 *   • self
 *   • known red teammates (we can see them, they're not Merlin)
 * From the remainder, pick a non-evil seat at random. With only the
 * vision marker (no behavioural read of the game history), this is
 * uniform random over the candidate pool.
 */
export function decideAssassinate(
  state: GameState,
  assassin: Player,
  rng: Rng = defaultRng,
): number {
  const vision = buildVision(state, assassin);
  const candidates = vision.filter(
    (r) => r.marker !== "self" && r.marker !== "red",
  );
  if (candidates.length === 0) {
    // Should be impossible — every legal table has at least one good seat.
    return assassin.index;
  }
  const pick = candidates[Math.floor(rng() * candidates.length)];
  return pick.player.index;
}
