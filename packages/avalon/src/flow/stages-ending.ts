import { t } from "../i18n/index.js";
import {
  computeMvp,
  factionOf,
  type GameState,
  type Player,
  type Verdict,
} from "../game/state.js";
import { ROLES } from "../game/roles.js";
import { removeGame } from "../game/store.js";
import { findArt, findVariantArt, isVariantPosition } from "../art.js";
import { sendMessage, type DiscordEmbed } from "./discord.js";
import { FACTION_COLOR, missionProgressLine } from "./presentation.js";
import { runtime } from "./runtime.js";
import { clearNpcTimer } from "../npc/driver.js";

/**
 * End-of-game board. Reveals every seat's role with a faction
 * marker, names the reason the verdict landed where it did, and
 * subtly highlights the MVP — the "decisive figure" — by using
 * their card art as the embed's main image. No explicit "MVP: X"
 * field; the card itself is the hint, leaving the read as a
 * conversation prompt rather than an announcement.
 *
 * After posting, clears the in-memory state so a fresh
 * `/avalon start` can run in this channel.
 */
export async function endGame(state: GameState, verdict: Verdict): Promise<void> {
  state.stage = "ended";
  state.winner = verdict.winner ?? null;
  state.current = null;
  const rosterLines = state.players.map((p) => {
    const role = t(undefined, ROLES[p.position].nameKey);
    return `\`${p.index + 1}\` ${factionMarker(p)} ${p.displayName} — **${role}**`;
  });
  const arthurWin = verdict.winner === "arthur";

  const mvp = computeMvp(state, verdict);
  const mvpImage = mvp ? await resolveMvpImage(state, mvp) : undefined;

  const embed: DiscordEmbed = {
    title: arthurWin
      ? `🏆 ${t(undefined, "stage.ending.titleArthur")}`
      : `🗡 ${t(undefined, "stage.ending.titleMordred")}`,
    description: reasonText(verdict),
    color: arthurWin ? FACTION_COLOR.arthur : FACTION_COLOR.mordred,
    fields: [
      {
        name: t(undefined, "stage.board.fieldProgress"),
        value: missionProgressLine(state),
        inline: false,
      },
      {
        name: t(undefined, "stage.ending.fieldRoster"),
        value: rosterLines.join("\n"),
        inline: false,
      },
    ],
    ...(mvpImage ? { image: mvpImage } : {}),
  };
  await sendMessage({ channelId: state.channelId, embeds: [embed] });
  // The session is over; future `/avalon start` re-creates fresh
  // state. We keep the per-channel sign-up map separate (see
  // signup.ts) so its lifecycle isn't entangled.
  clearNpcTimer(state.channelId);
  removeGame(state.channelId);
}

function factionMarker(p: Player): string {
  return factionOf(p) === "arthur" ? "🔵" : "🔴";
}

function reasonText(verdict: Verdict): string {
  switch (verdict.reason) {
    case "missions-clean":
      return t(undefined, "stage.ending.reasonMissionsClean");
    case "missions-failed":
      return t(undefined, "stage.ending.reasonFailures");
    case "rejections":
      return t(undefined, "stage.ending.reasonRejections");
    case "merlin-killed":
      return t(undefined, "stage.ending.reasonMerlinKilled");
    case "merlin-survived":
      return t(undefined, "stage.ending.reasonMerlinSurvived");
    case "missions-then-assassinate":
      // Shouldn't surface — that verdict means the game continues into
      // assassinate, not ends. Fall through to a generic line.
      return t(undefined, "stage.ending.reasonMissions");
    default:
      return "";
  }
}

/**
 * Resolve the MVP's card art URL. Uses the same art store as the
 * deal-reveal ephemeral: variant positions (loyal / minion) pick
 * the variant indexed by the MVP's seat-rank among same-role
 * players; single-image positions go through `findArt`. Returns
 * undefined when no art is uploaded for the MVP's slot — caller
 * simply omits the embed image then.
 */
async function resolveMvpImage(
  state: GameState,
  mvp: Player,
): Promise<{ url: string } | undefined> {
  let art: { filename: string; etag: string } | null;
  if (isVariantPosition(mvp.position)) {
    // Inline seat-rank-among-same-role so we don't reach into
    // stages.ts and create a circular import via stages-publicvote
    // → stages-ending → stages → ...
    const sameRole = state.players
      .filter((p) => p.position === mvp.position)
      .sort((a, b) => a.index - b.index);
    const rankIdx = sameRole.findIndex((p) => p.userId === mvp.userId);
    const rank = rankIdx === -1 ? 0 : rankIdx + 1;
    if (rank === 0) return undefined;
    art = await findVariantArt(mvp.position, rank).catch(() => null);
  } else {
    art = await findArt(mvp.position).catch(() => null);
  }
  if (!art) return undefined;
  return {
    url: `${runtime().publicBaseUrl()}/art/${art.filename}?v=${art.etag}`,
  };
}
