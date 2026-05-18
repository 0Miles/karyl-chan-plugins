import {
  componentCustomId,
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
import { getGame, removeGame, withChannelLock } from "./game/store.js";
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
 * Single slash command `/avalon` with subcommands `start` / `stop` —
 * matches the Python original's one-command surface. All in-game
 * interaction is button clicks (component handlers), routed through
 * the dispatcher in `flow/dispatcher.ts`.
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
    pluginCommands: [
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
          },
          {
            type: "sub_command",
            name: "stop",
            description: t(undefined, "command.avalon.stop.description"),
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
              removeGame(channelId);
              return t(undefined, "error.stopped");
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
          // Default: start.
          return startSignup(ctx, guildId, channelId);
        },
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
        key: "webui.access",
        description: "Access the Avalon admin WebUI (list / force-stop games).",
      },
    ],
    onReady: async (server) => {
      await registerWebRoutes(server, effectiveBase);
    },
  });
}

/** Re-export so the rest of the codebase can build accent embeds. */
export { EMBED_COLOR };
