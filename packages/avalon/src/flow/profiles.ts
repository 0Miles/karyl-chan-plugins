/**
 * One-shot player profile enrichment.
 *
 * Sign-up only captures a player's *global* Discord display name —
 * the interaction payload carries nothing else. For the WebUI game
 * board we want the names + faces the guild actually sees, so right
 * after `deal()` we ask the bot (one `members.get` RPC for the whole
 * roster) for each human's guild nickname + avatar URL and write
 * them onto the Player records.
 *
 * Best-effort: any RPC failure leaves the sign-up-time names in
 * place and avatars null — the board falls back to a generated
 * placeholder. NPC seats are skipped (no Discord identity).
 */

import { isNpc, type GameState } from "../game/state.js";
import { runtime } from "./runtime.js";

interface MembersGetResponse {
  members?: Array<{
    userId?: unknown;
    displayName?: unknown;
    avatarUrl?: unknown;
  }>;
}

export async function enrichPlayerProfiles(game: GameState): Promise<void> {
  const humanIds = game.players
    .filter((p) => !isNpc(p))
    .map((p) => p.userId);
  if (humanIds.length === 0) return;
  try {
    const res = (await runtime().botRpc("/api/plugin/members.get", {
      guild_id: game.guildId,
      user_ids: humanIds,
    })) as MembersGetResponse | null;
    const members = Array.isArray(res?.members) ? res.members : [];
    for (const m of members) {
      if (typeof m.userId !== "string") continue;
      const player = game.players.find((p) => p.userId === m.userId);
      if (!player) continue;
      if (typeof m.displayName === "string" && m.displayName.length > 0) {
        player.displayName = m.displayName;
      }
      if (typeof m.avatarUrl === "string" && m.avatarUrl.length > 0) {
        player.avatarUrl = m.avatarUrl;
      }
    }
  } catch (err) {
    runtime().log.warn("avalon: member profile enrichment failed", {
      channelId: game.channelId,
      err: String(err),
    });
  }
}
