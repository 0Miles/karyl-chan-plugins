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
 * A file the bot should attach to a message. `path` is a path on
 * THIS plugin's own HTTP surface (e.g. `/art/merlin.png`); the bot
 * fetches it over the internal bot↔plugin network and uploads the
 * bytes to Discord as a real attachment. An embed references the
 * file via `image: { url: "attachment://<name>" }`.
 *
 * This is how role-card / MVP-card images render without the plugin
 * needing a Discord-reachable public URL — Discord serves the file
 * from its own CDN once uploaded.
 */
export interface DiscordAttachment {
  /** Attachment filename; must match the `attachment://<name>` ref. */
  name: string;
  /** Leading-slash path on the plugin's HTTP surface. */
  path: string;
}

/**
 * Build the `{ image, attachment }` pair for an admin-uploaded art
 * file (served by web-routes at `/art/<filename>`). The embed sets
 * `image` to `attachment://<filename>`; the message carries the
 * matching attachment so the bot can fetch + upload it. Used by the
 * deal-reveal, ending MVP, and lake embeds.
 */
export function artAttachment(filename: string): {
  image: { url: string };
  attachment: DiscordAttachment;
} {
  return {
    image: { url: `attachment://${filename}` },
    attachment: { name: filename, path: `/art/${filename}` },
  };
}

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
  attachments?: DiscordAttachment[];
}): Promise<{ id: string; channelId: string } | null> {
  const res = (await runtime().botRpc("/api/plugin/messages.send", {
    channel_id: opts.channelId,
    content: opts.content,
    embeds: opts.embeds,
    components: opts.components,
    allowed_mentions: { parse: [] },
    ...(opts.attachments && opts.attachments.length > 0
      ? { attachments: opts.attachments }
      : {}),
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
  attachments?: DiscordAttachment[];
}): Promise<{ id: string | null } | null> {
  const res = (await runtime().botRpc(
    "/api/plugin/interactions.followup",
    {
      interaction_token: opts.interactionToken,
      content: opts.content,
      embeds: opts.embeds,
      components: opts.components,
      ephemeral: true,
      ...(opts.attachments && opts.attachments.length > 0
        ? { attachments: opts.attachments }
        : {}),
    },
  )) as { ok?: boolean; id?: string | null } | null;
  if (res === null) return null;
  return { id: res.id ?? null };
}

/**
 * Delete a follow-up message previously created via
 * `followupEphemeral`. Required because `messages.delete` doesn't
 * work on ephemeral followups — Discord routes their lifecycle
 * through the interaction's webhook instead. Used by `toastEphemeral`
 * to auto-dismiss short-lived nudges.
 */
export async function deleteEphemeralFollowup(opts: {
  interactionToken: string;
  messageId: string;
}): Promise<boolean> {
  const res = await runtime().botRpc(
    "/api/plugin/interactions.delete_followup",
    {
      interaction_token: opts.interactionToken,
      message_id: opts.messageId,
    },
  );
  return res !== null;
}

/**
 * Default lifetime for an ephemeral "toast" — short feedback nudges
 * like "已記錄你的投票" or "只有此輪隊長可以指派". Long enough to
 * read, short enough that the chat doesn't pile up with stale
 * notifications. 2 s matches the standard Material toast cadence.
 */
const DEFAULT_TOAST_TTL_MS = 2000;

/**
 * Send an ephemeral followup and schedule its deletion after
 * `ttlMs`. Use this for transient feedback — anything informational
 * the user needs to ack but won't refer back to (vote-recorded
 * confirmations, "not your turn" rejections, "already voted"
 * warnings). For content the user MIGHT want to re-read (role card
 * reveal, lake check result, role help), use `followupEphemeral`
 * directly so it stays visible until they dismiss it manually.
 *
 * The delete is fire-and-forget: a failure is logged (delete throws
 * on already-deleted or interaction-token-expired) but never
 * surfaced to the caller.
 */
export function toastEphemeral(opts: {
  interactionToken: string;
  content?: string;
  embeds?: DiscordEmbed[];
  ttlMs?: number;
}): Promise<{ id: string | null } | null> {
  const ttl = opts.ttlMs ?? DEFAULT_TOAST_TTL_MS;
  return followupEphemeral({
    interactionToken: opts.interactionToken,
    content: opts.content,
    embeds: opts.embeds,
  }).then((sent) => {
    if (sent?.id) {
      const handle = setTimeout(() => {
        void deleteEphemeralFollowup({
          interactionToken: opts.interactionToken,
          messageId: sent.id!,
        });
      }, ttl);
      if (typeof handle.unref === "function") handle.unref();
    }
    return sent;
  });
}
