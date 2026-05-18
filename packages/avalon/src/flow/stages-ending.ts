import { t } from "../i18n/index.js";
import { type GameState, type Verdict } from "../game/state.js";
import { ROLES } from "../game/roles.js";
import { removeGame } from "../game/store.js";
import { sendMessage } from "./discord.js";
import { FACTION_COLOR, missionProgressLine } from "./presentation.js";

/**
 * End-of-game board. Reveals every seat's role and the reason the
 * verdict landed where it did, then clears the in-memory state so a
 * fresh `/avalon start` can run in this channel.
 */
export async function endGame(state: GameState, verdict: Verdict): Promise<void> {
  state.stage = "ended";
  state.winner = verdict.winner ?? null;
  state.current = null;
  const rosterLines = state.players.map((p) => {
    const role = t(undefined, ROLES[p.position].nameKey);
    return `\`${p.index + 1}\` ${p.displayName} — **${role}**`;
  });
  const arthurWin = verdict.winner === "arthur";
  await sendMessage({
    channelId: state.channelId,
    embeds: [
      {
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
      },
    ],
  });
  // The session is over; future `/avalon start` re-creates fresh
  // state. We keep the per-channel sign-up map separate (see
  // signup.ts) so its lifecycle isn't entangled.
  removeGame(state.channelId);
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
