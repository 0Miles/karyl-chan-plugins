import type { ComponentContext, ComponentReply } from "@karyl-chan/plugin-sdk";
import { withChannelLock } from "../game/store.js";
import { followupEphemeral } from "./discord.js";
import { runtime } from "./runtime.js";
import {
  handleSignupClick,
  type SignupAction,
} from "./signup.js";
import {
  handleDealClick,
  handleAppointClick,
  handlePublicVoteClick,
  handlePrivateVoteClick,
  handleLakeClick,
  handleAssassinateClick,
} from "./stages.js";

export { wireRuntime } from "./runtime.js";

/**
 * Single dispatch entrypoint for every `kc:karyl-avalon:*` button.
 *
 * Discord delivers a button click as a fresh interaction with its own
 * 15-minute token. We extract the `tail` (the part after the
 * component id — e.g. `kc:karyl-avalon:appt:3` ⇒ tail="3") and hand
 * it to the per-stage handler under `withChannelLock` so concurrent
 * clicks across the same channel serialise cleanly.
 *
 * Most handler errors land back here as a non-throw ephemeral nudge
 * — that way one player's misclick can't crash the whole session.
 */
export async function onComponent(
  ctx: ComponentContext,
  componentId: string,
): Promise<ComponentReply> {
  if (!ctx.channelId) {
    await safeEphemeral(ctx, "Channel context missing.");
    return null;
  }
  const channelId = ctx.channelId;
  try {
    return await withChannelLock(channelId, async () => {
      switch (componentId) {
        case "sig":
          return handleSignupClick(ctx, ctx.tail as SignupAction);
        case "deal":
          return handleDealClick(ctx, ctx.tail);
        case "appt":
          return handleAppointClick(ctx, ctx.tail);
        case "pub":
          return handlePublicVoteClick(ctx, ctx.tail);
        case "priv":
          return handlePrivateVoteClick(ctx, ctx.tail);
        case "lake":
          return handleLakeClick(ctx, ctx.tail);
        case "asn":
          return handleAssassinateClick(ctx, ctx.tail);
        default:
          runtime().log.warn("avalon: unknown component", {
            componentId,
            customId: ctx.customId,
          });
          return null;
      }
    });
  } catch (err) {
    runtime().log.error("avalon: component handler threw", {
      componentId,
      err: String(err),
    });
    await safeEphemeral(
      ctx,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

async function safeEphemeral(
  ctx: ComponentContext,
  content: string,
): Promise<void> {
  await followupEphemeral({
    interactionToken: ctx.interactionToken,
    content,
  }).catch(() => {});
}
