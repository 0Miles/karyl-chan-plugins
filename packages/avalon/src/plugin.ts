import {
  componentCustomId,
  defineGuildFeature,
  definePlugin,
  definePluginCommand,
  definePluginComponent,
  type CommandReply,
  type ComponentContext,
  type ComponentReply,
  type CommandContext,
} from "@karyl-chan/plugin-sdk";
import { EMBED_COLOR, PLUGIN_KEY, PLUGIN_NAME, PLUGIN_VERSION } from "./constants.js";
import { t } from "./i18n/index.js";
import { startSignup } from "./flow/signup.js";
import { onComponent } from "./flow/dispatcher.js";
import { clearCurrentStageButtons } from "./flow/stop.js";
import {
  dealRevealComponents,
  renderCurrentStageBoard,
  renderDealReveal,
} from "./flow/stages.js";
import { deleteMessage, sendMessage } from "./flow/discord.js";
import { playerByUserId } from "./game/state.js";
import { getGame, removeGame, withChannelLock } from "./game/store.js";
import { cleanupOrphanArt } from "./art.js";
import { clearNpcTimer } from "./npc/driver.js";
import {
  effectiveBase,
  registerWebRoutes,
  setPublicUrlEnvFallback,
} from "./web-routes.js";

const AVALON_PUBLIC_URL_ENV = process.env.AVALON_PUBLIC_URL
  ? process.env.AVALON_PUBLIC_URL.replace(/\/+$/, "")
  : undefined;
// Propagate env fallback into web-routes.ts at module init time so
// effectiveBase() can use it before any SDK wiring happens.
setPublicUrlEnvFallback(AVALON_PUBLIC_URL_ENV);

/** Discord component-v1 action row with a single Link button. */
function linkButtonRow(label: string, url: string): unknown {
  return { type: 1, components: [{ type: 2, style: 5, label, url }] };
}

/**
 * Build the karyl-avalon plugin instance.
 *
 * `/avalon` is a **guild feature** (軌一) — bot admins enable it per
 * guild via the admin UI. When enabled, Discord registers the slash
 * command on that guild's command list with subcommands
 * `start` / `stop` / `manage`. Off by default; mirrors how the radio
 * plugin gates its `/radio` command.
 *
 * All in-game interaction is button clicks (component handlers),
 * routed through the dispatcher in `flow/dispatcher.ts`. Components
 * remain plugin-level (軌二) so a guild that's currently
 * mid-game keeps responding to clicks even if an admin happens to
 * disable the feature mid-session — the command stops surfacing but
 * the in-flight game stays clickable until it ends.
 */
export function buildPlugin() {
  return definePlugin({
    key: PLUGIN_KEY,
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    description: t(undefined, "plugin.description"),
    author: "0Miles",
    rpcMethodsUsed: [
      // Public game-board / dialog messages live in the invocation
      // channel; private reveals use interaction follow-ups (ephemeral).
      "messages.send",
      "messages.edit",
      "messages.delete",
      "interactions.respond",
      "interactions.followup",
      // The admin WebUI requires this to mint plugin-session JWTs.
      "auth.session",
    ],
    guildFeatures: [
      defineGuildFeature({
        key: "avalon",
        name: "Karyl Avalon",
        description:
          "阿瓦隆桌遊：透過共用按鈕進行的多人桌遊。啟用後此 guild 多出 /avalon 指令；對局狀態存記憶體、跨重啟會掉。預設關閉，逐 guild 啟用。",
        enabledByDefault: false,
        commands: [
          definePluginCommand({
            name: "avalon",
            description: t(undefined, "command.avalon.description"),
            scope: "guild",
            integrationTypes: ["guild_install"],
            contexts: ["Guild"],
            options: [
              {
                type: "sub_command",
                name: "start",
                description: t(undefined, "command.avalon.start.description"),
                options: [
                  {
                    type: "integer",
                    name: "npc",
                    description: t(
                      undefined,
                      "command.avalon.start.npcOption",
                    ),
                    required: false,
                  },
                ],
              },
              {
                type: "sub_command",
                name: "stop",
                description: t(undefined, "command.avalon.stop.description"),
              },
              {
                type: "sub_command",
                name: "card",
                description: t(undefined, "command.avalon.card.description"),
              },
              {
                type: "sub_command",
                name: "status",
                description: t(undefined, "command.avalon.status.description"),
                options: [
                  {
                    type: "boolean",
                    name: "public",
                    description: t(
                      undefined,
                      "command.avalon.status.publicOption",
                    ),
                    required: false,
                  },
                ],
              },
              {
                type: "sub_command",
                name: "manage",
                description: t(undefined, "command.avalon.manage.description"),
              },
            ],
            handler: async (ctx: CommandContext): Promise<CommandReply> => {
              const guildId = ctx.guildId;
              const channelId = ctx.channelId;
              if (!guildId || !channelId) {
                return t(undefined, "error.notInGuild");
              }
              const sub = ctx.subCommandName;
              if (sub === "stop") {
                return withChannelLock(channelId, async () => {
                  const existing = getGame(channelId);
                  if (!existing) return t(undefined, "error.notRunning");
                  if (
                    existing.hostUserId !== ctx.userId &&
                    !ctx.hasCapability?.("admin")
                  ) {
                    return t(undefined, "error.notHostCannotStop");
                  }
                  // B-002: strip live-looking buttons from the active stage
                  // board so the channel's scrollback doesn't keep clickable
                  // remnants of the just-stopped game.
                  await clearCurrentStageButtons(existing);
                  clearNpcTimer(channelId);
                  removeGame(channelId);
                  return t(undefined, "error.stopped");
                });
              }
              if (sub === "card") {
                // Re-show the player's role card. Same payload as
                // clicking the deal-reveal board's [查看身份] button —
                // accessible at any time during the game so a player
                // who lost the original ephemeral can pull it back up.
                const existing = getGame(channelId);
                if (!existing) {
                  return {
                    content: t(undefined, "error.notRunning"),
                    ephemeral: true,
                  };
                }
                if (!playerByUserId(existing, ctx.userId)) {
                  return {
                    content: t(undefined, "stage.deal.notInGame"),
                    ephemeral: true,
                  };
                }
                const reveal = await renderDealReveal(existing, ctx.userId);
                if (!reveal) {
                  return {
                    content: t(undefined, "stage.deal.notInGame"),
                    ephemeral: true,
                  };
                }
                return {
                  embeds: [reveal.embed],
                  components: dealRevealComponents(),
                  ephemeral: true,
                  ...(reveal.attachment
                    ? { attachments: [reveal.attachment] }
                    : {}),
                };
              }
              if (sub === "status") {
                // Re-surface the current stage's board so players
                // don't have to scroll the channel back past a text
                // discussion to find it. Default: a private
                // (ephemeral) copy. `public:true` (host/admin only)
                // deletes the stale public board and re-posts a
                // fresh one at the bottom of the channel.
                return withChannelLock(channelId, async () => {
                  const game = getGame(channelId);
                  if (!game || !game.current) {
                    return {
                      content: t(undefined, "error.notRunning"),
                      ephemeral: true,
                    };
                  }
                  const wantsPublic = ctx.options.public === true;
                  // Gate before rendering: public is host/admin-only,
                  // the private copy is for seated players. The whole
                  // handler runs under withChannelLock, which also
                  // serialises every component click + NPC tick on
                  // this channel — so `game.current` can't be cleared
                  // out from under us across the awaits below.
                  if (wantsPublic) {
                    if (
                      game.hostUserId !== ctx.userId &&
                      !ctx.hasCapability?.("admin")
                    ) {
                      return {
                        content: t(undefined, "status.publicOnlyHost"),
                        ephemeral: true,
                      };
                    }
                  } else if (!playerByUserId(game, ctx.userId)) {
                    return {
                      content: t(undefined, "stage.deal.notInGame"),
                      ephemeral: true,
                    };
                  }
                  const board = await renderCurrentStageBoard(game);
                  if (!board) {
                    return {
                      content: t(undefined, "error.notRunning"),
                      ephemeral: true,
                    };
                  }
                  if (wantsPublic) {
                    // Drop the stale public board, re-post a fresh
                    // one, and re-point state.current at it so every
                    // later edit / click lands on the new message.
                    await deleteMessage({
                      channelId,
                      messageId: game.current.messageId,
                    });
                    const sent = await sendMessage({
                      channelId,
                      embeds: board.embeds,
                      components: board.components,
                      ...(board.attachments
                        ? { attachments: board.attachments }
                        : {}),
                    });
                    if (!sent) {
                      // The old board is already gone; the re-post
                      // failed (RPC blip). Don't claim success —
                      // re-running the command retries cleanly.
                      return {
                        content: t(undefined, "status.refreshFailed"),
                        ephemeral: true,
                      };
                    }
                    game.current.messageId = sent.id;
                    return {
                      content: t(undefined, "status.refreshed"),
                      ephemeral: true,
                    };
                  }
                  // Default: a private copy. Buttons still work — a
                  // click drives the public board — but this copy
                  // won't repaint, so it's a snapshot, not a live view.
                  return {
                    embeds: board.embeds,
                    components: board.components,
                    ephemeral: true,
                    ...(board.attachments
                      ? { attachments: board.attachments }
                      : {}),
                  };
                });
              }
              if (sub === "manage") {
                // 15-min bot JWT — only used to bootstrap a plugin-side
                // manage session (access + refresh) on first load.
                const res = (await ctx.botRpc("/api/plugin/auth.session", {
                  user_id: ctx.userId,
                  kind: "manage",
                })) as { allowed?: boolean; token?: string } | null;
                if (res === null) {
                  return {
                    content: `⚠ ${t(undefined, "manage.botRejected")}`,
                    ephemeral: true,
                  };
                }
                if (res.allowed !== true || typeof res.token !== "string") {
                  return {
                    content: `⚠ ${t(undefined, "manage.notAllowed")}`,
                    ephemeral: true,
                  };
                }
                return {
                  content: `🔧 **${t(undefined, "manage.title")}**\n${t(undefined, "manage.description")}`,
                  components: [
                    linkButtonRow(
                      `🔧 ${t(undefined, "manage.openButton")}`,
                      `${effectiveBase()}/?token=${res.token}`,
                    ),
                  ],
                  ephemeral: true,
                };
              }
              // Default: start. Optional `npc` integer adds synthetic
              // players to the roster at signup time so a small group
              // can fill out a 5+ table without recruiting more
              // humans.
              const rawNpc = ctx.options.npc;
              const npcCount =
                typeof rawNpc === "number" && Number.isFinite(rawNpc)
                  ? Math.floor(rawNpc)
                  : 0;
              return startSignup(ctx, guildId, channelId, { npcCount });
            },
          }),
        ],
      }),
    ],
    components: [
      definePluginComponent({
        id: "sig",
        handler: (ctx: ComponentContext): Promise<ComponentReply> =>
          onComponent(ctx, "sig"),
      }),
      definePluginComponent({
        id: "deal",
        handler: (ctx: ComponentContext): Promise<ComponentReply> =>
          onComponent(ctx, "deal"),
      }),
      definePluginComponent({
        id: "appt",
        handler: (ctx: ComponentContext): Promise<ComponentReply> =>
          onComponent(ctx, "appt"),
      }),
      definePluginComponent({
        id: "pub",
        handler: (ctx: ComponentContext): Promise<ComponentReply> =>
          onComponent(ctx, "pub"),
      }),
      definePluginComponent({
        id: "priv",
        handler: (ctx: ComponentContext): Promise<ComponentReply> =>
          onComponent(ctx, "priv"),
      }),
      definePluginComponent({
        id: "lake",
        handler: (ctx: ComponentContext): Promise<ComponentReply> =>
          onComponent(ctx, "lake"),
      }),
      definePluginComponent({
        id: "asn",
        handler: (ctx: ComponentContext): Promise<ComponentReply> =>
          onComponent(ctx, "asn"),
      }),
    ],
    capabilities: [
      {
        key: "manage",
        description: "Access the Avalon admin WebUI (list / force-stop games).",
      },
    ],
    onReady: async (server) => {
      await registerWebRoutes(server, effectiveBase);
      // One-shot cleanup of orphan art files whose names no longer
      // match the current schema (notably pre-rename `loyal.<ext>` /
      // `minion.<ext>` from before the variant slot redesign). Safe
      // no-op once the volume is clean.
      const cleaned = await cleanupOrphanArt();
      if (cleaned.removed.length > 0 || cleaned.errors.length > 0) {
        server.log.info(
          { removed: cleaned.removed, errors: cleaned.errors },
          "avalon: cleaned orphan art files on start",
        );
      }
    },
  });
}

/** Re-export so the rest of the codebase can build accent embeds. */
export { EMBED_COLOR };
