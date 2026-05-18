import { runtime } from "./runtime.js";

/**
 * Thin typed wrappers over the bot's plugin RPC for the four Discord
 * operations Avalon uses. The flow files import these instead of
 * calling botRpc directly so a typo in the endpoint path or payload
 * shape is caught at the call site (and so a future RPC name change
 * is a one-file fix).
 *
 * The bot's discord-error normalisation already maps Missing
 * Permissions / Unknown Channel / etc. to honest HTTP statuses;
 * failure here returns null, the caller decides whether that's
 * recoverable.
 */

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  thumbnail?: { url: string };
  image?: { url: string };
  footer?: { text: string };
}

export interface DiscordButton {
  type: 2;
  /** Style: 1 primary / 2 secondary / 3 success / 4 danger / 5 link. */
  style: 1 | 2 | 3 | 4 | 5;
  custom_id: string;
  label: string;
  disabled?: boolean;
}

export interface DiscordActionRow {
  type: 1;
  components: DiscordButton[];
}

export type Components = DiscordActionRow[];

/**
 * Send a new message to a channel. Returns the message id on success,
 * or null on failure (RPC blip, missing permission). Caller should
 * treat null as "give up gracefully" — it's the SDK contract.
 */
export async function sendMessage(opts: {
  channelId: string;
  content?: string;
  embeds?: DiscordEmbed[];
  components?: Components;
}): Promise<{ id: string; channelId: string } | null> {
  const res = (await runtime().botRpc("/api/plugin/messages.send", {
    channel_id: opts.channelId,
    content: opts.content,
    embeds: opts.embeds,
    components: opts.components,
    allowed_mentions: { parse: [] },
  })) as { id?: string; channel_id?: string } | null;
  if (!res || !res.id || !res.channel_id) return null;
  return { id: res.id, channelId: res.channel_id };
}

/** Patch an existing message in place. */
export async function editMessage(opts: {
  channelId: string;
  messageId: string;
  content?: string;
  embeds?: DiscordEmbed[];
  components?: Components;
}): Promise<boolean> {
  const res = await runtime().botRpc("/api/plugin/messages.edit", {
    channel_id: opts.channelId,
    message_id: opts.messageId,
    content: opts.content,
    embeds: opts.embeds,
    components: opts.components,
  });
  return res !== null;
}

/** Delete a message (best-effort; missing / already-deleted is fine). */
export async function deleteMessage(opts: {
  channelId: string;
  messageId: string;
}): Promise<void> {
  await runtime().botRpc("/api/plugin/messages.delete", {
    channel_id: opts.channelId,
    message_id: opts.messageId,
  });
}

/**
 * Reply to a component interaction. The bot already `deferUpdate`d
 * the click, so this PATCHes the original message. Component handlers
 * can also return `{ content?, embeds?, components? }` directly and
 * the SDK does the same thing — use this when you need to edit a
 * DIFFERENT message than the one the button was on.
 */
export async function respondToInteraction(opts: {
  interactionToken: string;
  content?: string;
  embeds?: DiscordEmbed[];
  components?: Components;
}): Promise<boolean> {
  const res = await runtime().botRpc("/api/plugin/interactions.respond", {
    interaction_token: opts.interactionToken,
    content: opts.content,
    embeds: opts.embeds,
    components: opts.components,
  });
  return res !== null;
}

/**
 * Send an ephemeral follow-up to a component interaction. This is the
 * heart of the no-DM design — private reveals (role cards, mission
 * vote confirmations, lake check results) all go through here.
 */
export async function followupEphemeral(opts: {
  interactionToken: string;
  content?: string;
  embeds?: DiscordEmbed[];
  components?: Components;
}): Promise<boolean> {
  const res = await runtime().botRpc("/api/plugin/interactions.followup", {
    interaction_token: opts.interactionToken,
    content: opts.content,
    embeds: opts.embeds,
    components: opts.components,
    ephemeral: true,
  });
  return res !== null;
}
