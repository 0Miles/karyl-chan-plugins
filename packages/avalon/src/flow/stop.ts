import type { GameState } from "../game/state.js";
import { editMessage } from "./discord.js";
import { runtime } from "./runtime.js";

/**
 * Best-effort cleanup of the active stage board when a game is being
 * force-stopped. Without this, `/avalon stop` (and the WebUI
 * force-stop) leaves the previous stage's message in the channel with
 * live-looking buttons — players click them and get
 * `error.notRunning` ephemerals, which is confusing UX.
 *
 * Strips buttons (components: []) so the embed body stays for
 * scrollback but the buttons go grey. Failures are swallowed: the
 * caller is about to remove the in-memory state anyway, and we
 * shouldn't surface RPC blips on a stop path.
 */
export async function clearCurrentStageButtons(
  state: GameState,
): Promise<void> {
  if (!state.current) return;
  await editMessage({
    channelId: state.channelId,
    messageId: state.current.messageId,
    components: [],
  }).catch((err) => {
    runtime().log.warn("avalon: failed to clear stage buttons on stop", {
      channelId: state.channelId,
      err: err instanceof Error ? err.message : String(err),
    });
  });
}
