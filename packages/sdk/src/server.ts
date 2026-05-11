import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import {
  SIGNATURE_HEADER,
  SIGNATURE_HEADER_V1,
  TIMESTAMP_HEADER,
  isFreshTimestamp,
  verifyV0,
  verifyV1,
} from "./hmac.js";
import type {
  BehaviorDefinition,
  CommandDefinition,
  PluginCommandDefinition,
} from "./plugin.js";
import type { BehaviorContext, CommandContext, CommandReply } from "./types.js";

export interface PluginServerOptions {
  pluginKey: string;
  botUrl: string;
  /**
   * v2：plugin 自訂指令（軌三）。若同時提供 commands（v1），
   * pluginCommands 優先；v1 commands 僅在 pluginCommands 為空時 fallback。
   * M1-E 升級後移除 commands 欄位。
   */
  pluginCommands?: PluginCommandDefinition[];
  /**
   * v2：behaviors（軌二 webhook 接口層）。
   */
  behaviors?: BehaviorDefinition[];
  /**
   * @deprecated v1 commands。請改用 pluginCommands。
   * 保留以不破壞既有 v1 plugin server build；M1-E 升級後移除。
   */
  commands?: CommandDefinition[];
  getToken: () => string | null;
  getDispatchHmacKey?: () => string | null;
}

interface InteractionPayload {
  interaction_id: string;
  interaction_token: string;
  command_name: string;
  sub_command_name: string | null;
  options: Array<{ name: string; type: number; value?: unknown }>;
  guild_id: string | null;
  user: { id: string };
  /** Bot-resolved subset of the invoker's RBAC tokens: `admin` + this plugin's `plugin:<key>:*`. */
  member?: { capabilities?: string[] };
}

function verifyDispatchAuth(
  request: FastifyRequest,
  rawBody: string,
  secret: string,
): { ok: true } | { ok: false; reason: string } {
  const tsHeader = request.headers[TIMESTAMP_HEADER];
  const sigV1Header = request.headers[SIGNATURE_HEADER_V1];
  const sigHeader = request.headers[SIGNATURE_HEADER];
  if (typeof tsHeader !== "string") {
    return { ok: false, reason: "missing timestamp header" };
  }
  if (typeof sigV1Header !== "string" && typeof sigHeader !== "string") {
    return { ok: false, reason: "missing signature headers" };
  }
  if (!isFreshTimestamp(tsHeader, Math.floor(Date.now() / 1000))) {
    return { ok: false, reason: "timestamp outside replay window" };
  }
  // Prefer v1 (method+path binding) over v0 when both are present.
  if (typeof sigV1Header === "string") {
    const urlPath = request.url.split("?")[0];
    if (
      !verifyV1({
        secret,
        method: request.method,
        path: urlPath,
        body: rawBody,
        ts: tsHeader,
        presented: sigV1Header,
      })
    ) {
      return { ok: false, reason: "v1 signature mismatch" };
    }
    return { ok: true };
  }
  if (
    !verifyV0({
      secret,
      body: rawBody,
      ts: tsHeader,
      presented: sigHeader as string,
    })
  ) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

/**
 * Generic bot RPC caller. Used by `ctx.botRpc()`, `respondToInteraction`,
 * and re-exported for `StartedPlugin.botRpc()` to share one implementation.
 * Returns the parsed JSON body, an empty object on 204, or null on
 * network / non-2xx errors (already logged).
 */
export async function callBotRpc(
  log: FastifyInstance["log"],
  botUrl: string,
  token: string,
  path: string,
  body: unknown,
): Promise<unknown | null> {
  try {
    const res = await fetch(`${botUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn(
        { path, status: res.status, body: text.slice(0, 200) },
        "bot rpc call failed",
      );
      return null;
    }
    if (res.status === 204) return {};
    return await res.json().catch(() => ({}));
  } catch (err) {
    log.error({ err, path }, "bot rpc call threw");
    return null;
  }
}

async function respondToInteraction(
  log: FastifyInstance["log"],
  botUrl: string,
  token: string,
  interactionToken: string,
  content: string | undefined,
  ephemeral: boolean,
  embeds?: unknown[],
  components?: unknown[],
): Promise<void> {
  await callBotRpc(log, botUrl, token, "/api/plugin/interactions.respond", {
    interaction_token: interactionToken,
    ...(content !== undefined ? { content } : {}),
    ...(embeds !== undefined ? { embeds } : {}),
    ...(components !== undefined ? { components } : {}),
    ephemeral,
  });
}

function readOpts(payload: InteractionPayload): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const o of payload.options ?? []) {
    if (typeof o.name === "string") out[o.name] = o.value;
  }
  return out;
}

/** Normalize a CommandReply to { content, ephemeral, embeds, components }. */
function normalizeReply(reply: CommandReply): {
  content: string | undefined;
  ephemeral: boolean;
  embeds: unknown[] | undefined;
  components: unknown[] | undefined;
} {
  if (typeof reply === "string") {
    return {
      content: reply,
      ephemeral: false,
      embeds: undefined,
      components: undefined,
    };
  }
  return {
    content: reply.content,
    ephemeral: reply.ephemeral ?? false,
    embeds: reply.embeds,
    components: reply.components,
  };
}

export function createPluginServer(opts: PluginServerOptions): FastifyInstance {
  // v2 優先使用 pluginCommands，fallback 到 v1 commands（deprecated）。
  const commandMap = new Map<
    string,
    PluginCommandDefinition["handler"] | CommandDefinition["handler"]
  >([
    ...(opts.pluginCommands ?? []).map(
      (cmd) =>
        [cmd.name, cmd.handler] as [string, PluginCommandDefinition["handler"]],
    ),
    // v1 fallback：pluginCommands 存在時跳過（避免重複）
    ...((opts.pluginCommands ?? []).length === 0
      ? (opts.commands ?? []).map(
          (cmd) =>
            [cmd.name, cmd.handler] as [string, CommandDefinition["handler"]],
        )
      : []),
  ]);

  // v2 behavior map：key → handler
  const behaviorMap = new Map<string, BehaviorDefinition["handler"]>(
    (opts.behaviors ?? []).map((b) => [b.key, b.handler]),
  );

  const server = Fastify({ logger: true });
  server.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => done(null, body),
  );
  server.get("/health", async () => ({ status: "ok" }));

  // ── 軌三：plugin command dispatch（HMAC 驗證）────────────────────────────
  server.post(
    "/commands/:commandName",
    async (
      request: FastifyRequest<{ Params: { commandName: string } }>,
      reply: FastifyReply,
    ) => {
      const signingKey = opts.getDispatchHmacKey?.() ?? null;
      if (!signingKey) {
        return reply.code(503).send({
          error: "dispatch HMAC key not available; plugin must re-register",
        });
      }
      const rawBody = typeof request.body === "string" ? request.body : "";
      const auth = verifyDispatchAuth(request, rawBody, signingKey);
      if (!auth.ok) return reply.code(401).send({ error: auth.reason });

      let payload: InteractionPayload;
      try {
        payload = JSON.parse(rawBody) as InteractionPayload;
      } catch {
        return reply.code(400).send({ error: "invalid JSON" });
      }

      if (request.params.commandName !== payload.command_name) {
        return reply.code(400).send({ error: "command_name mismatch" });
      }

      if (!payload.user || typeof payload.user.id !== "string") {
        return reply.code(400).send({ error: "missing user.id" });
      }

      const token = opts.getToken();
      if (!token) return reply.code(200).send({ ok: true });
      reply.code(204).send();

      const handler = commandMap.get(payload.command_name);
      if (!handler) {
        await respondToInteraction(
          server.log,
          opts.botUrl,
          token,
          payload.interaction_token,
          `⚠ Unknown command \`${payload.command_name}\``,
          false,
          undefined,
        );
        return;
      }

      const capabilities = Array.isArray(payload.member?.capabilities)
        ? payload.member!.capabilities!.filter(
            (c): c is string => typeof c === "string",
          )
        : [];
      const ctx: CommandContext = {
        pluginKey: opts.pluginKey,
        commandName: payload.command_name,
        subCommandName: payload.sub_command_name,
        options: readOpts(payload),
        guildId: payload.guild_id,
        userId: payload.user.id,
        capabilities,
        hasCapability: (capKey: string): boolean =>
          capabilities.includes("admin") ||
          capabilities.includes(`plugin:${opts.pluginKey}:${capKey}`),
        log: {
          info: (msg, meta) => server.log.info(meta ?? {}, msg),
          warn: (msg, meta) => server.log.warn(meta ?? {}, msg),
          error: (msg, meta) => server.log.error(meta ?? {}, msg),
        },
        botRpc: (path: string, body?: unknown) =>
          callBotRpc(server.log, opts.botUrl, token, path, body),
      };

      try {
        const rawReply = await handler(ctx);
        const { content, ephemeral, embeds, components } =
          normalizeReply(rawReply);
        await respondToInteraction(
          server.log,
          opts.botUrl,
          token,
          payload.interaction_token,
          content,
          ephemeral,
          embeds,
          components,
        );
      } catch (err) {
        server.log.error({ err }, "command handler threw");
        await respondToInteraction(
          server.log,
          opts.botUrl,
          token,
          payload.interaction_token,
          "⚠ Internal error while handling command",
          false,
          undefined,
        );
      }
    },
  );

  // ── 軌二：behavior webhook dispatch（無 HMAC，裸 HTTP；可選 token 驗證）──
  // Bot 呼叫時（source='plugin' behavior），可能帶 X-Plugin-Webhook-Token header。
  // Plugin 端若需要驗身，在 handler 內自行呼叫 verifyWebhookToken()。
  // SDK 不在路由層強制驗證，以保持「裸 webhook 相容」契約。
  //
  // 每個 behavior 掛載其宣告的 webhookPath 作為獨立路由（對齊 bot 端
  // WebhookForwarder 以 manifest behaviors[].webhook_path 為完整路徑派送）。
  for (const behavior of opts.behaviors ?? []) {
    const behaviorKey = behavior.key;
    const handler = behaviorMap.get(behaviorKey);
    if (!handler) continue;

    const wp = behavior.webhookPath;
    if (wp === "/health" || wp.startsWith("/commands/") || wp === "/commands") {
      throw new Error(
        `behavior '${behaviorKey}' webhookPath '${wp}' conflicts with SDK reserved routes`,
      );
    }

    server.post(
      behavior.webhookPath,
      async (request: FastifyRequest, reply: FastifyReply) => {
        let body: unknown;
        try {
          body =
            typeof request.body === "string"
              ? JSON.parse(request.body)
              : request.body;
        } catch {
          body = request.body;
        }

        // Strip Authorization header to avoid leaking bot tokens to handler.
        const headers = Object.fromEntries(
          Object.entries(
            request.headers as Record<string, string | string[] | undefined>,
          )
            .filter(([k]) => k.toLowerCase() !== "authorization")
            .map(([k, v]) => [k, Array.isArray(v) ? (v[0] ?? "") : (v ?? "")]),
        );

        const token = opts.getToken();
        const ctx: BehaviorContext = {
          pluginKey: opts.pluginKey,
          behaviorKey,
          body,
          headers,
          log: {
            info: (msg, meta) => server.log.info(meta ?? {}, msg),
            warn: (msg, meta) => server.log.warn(meta ?? {}, msg),
            error: (msg, meta) => server.log.error(meta ?? {}, msg),
          },
          botRpc: (path: string, rpcBody?: unknown) => {
            if (!token) return Promise.resolve(null);
            return callBotRpc(server.log, opts.botUrl, token, path, rpcBody);
          },
        };

        try {
          const result = await handler(ctx);
          if (result === null || result === undefined) {
            return reply.code(204).send();
          }
          if (typeof result === "string") {
            return reply.code(200).send({ content: result });
          }
          return reply.code(200).send(result);
        } catch (err) {
          server.log.error({ err, behaviorKey }, "behavior handler threw");
          return reply.code(500).send({ error: "internal error" });
        }
      },
    );
  }

  return server;
}
