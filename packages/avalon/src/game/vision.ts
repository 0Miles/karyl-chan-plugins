import { ROLES, type Position } from "./roles.js";
import { factionOf, type GameState, type Player } from "./state.js";

/**
 * Per-role "what you see" reveal logic — the heart of Avalon's bluffing.
 *
 *   Merlin       sees every evil EXCEPT Mordred.
 *   Percival     sees Merlin AND Morgana as "indistinguishable purple".
 *   Evil         sees other evil — except Oberon, who sees nobody and
 *                is invisible to other evil.
 *   Loyal        sees nothing.
 *
 * Lady-of-the-lake checks override this: whoever used the lady on `p`
 * sees `p`'s faction with no role-specific masking (the lady reveals
 * faction, not role).
 *
 * Returned as a per-player marker so the caller can render an emoji
 * grid in the ephemeral reveal embed.
 */

export type VisionMarker =
  | "red" // confirmed evil
  | "blue" // confirmed good
  | "purple" // Merlin-or-Morgana from Percival's POV
  | "self"
  | "unknown";

export interface VisionRow {
  /** Seat number 1..N. */
  seat: number;
  player: Player;
  marker: VisionMarker;
}

export function buildVision(state: GameState, viewer: Player): VisionRow[] {
  return state.players.map((p) => {
    if (p.userId === viewer.userId) {
      return { seat: p.index + 1, player: p, marker: "self" };
    }
    // Lady override: if the viewer is the lady holder and has already
    // checked p, expose p's faction unconditionally.
    if (viewer.lakeTarget === p.userId) {
      return {
        seat: p.index + 1,
        player: p,
        marker: factionOf(p) === "mordred" ? "red" : "blue",
      };
    }
    return {
      seat: p.index + 1,
      player: p,
      marker: visionFor(viewer.position, p.position),
    };
  });
}

function visionFor(viewer: Position, target: Position): VisionMarker {
  // Percival sees Merlin AND Morgana — but can't tell them apart.
  if (viewer === "percival" && (target === "merlin" || target === "morgana")) {
    return "purple";
  }
  // Merlin sees every evil except Mordred.
  if (viewer === "merlin") {
    return ROLES[target].faction === "mordred" && target !== "mordred"
      ? "red"
      : "unknown";
  }
  // Evil sees other evil — except Oberon and viewers who are Oberon.
  if (
    ROLES[viewer].faction === "mordred" &&
    viewer !== "oberon" &&
    ROLES[target].faction === "mordred" &&
    target !== "oberon"
  ) {
    return "red";
  }
  return "unknown";
}
