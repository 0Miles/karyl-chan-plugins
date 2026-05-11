# @karyl-chan/plugin-sdk

Shared SDK for [karyl-chan](https://github.com/0Miles/karyl-chan) plugins.
Encapsulates the boilerplate every plugin needs:

- Fastify server with HMAC-verified `/commands/:commandName` (and `…/autocomplete`) dispatch + behavior webhook routes
- Plugin lifecycle client: register + heartbeat + auto re-register on 401
- HMAC signing helpers (v0 + v1), byte-for-byte compatible with the bot's `karyl-chan/src/utils/hmac.ts`
- Manifest builder from your `definePlugin` config
- `verifyPluginSession()` — offline EdDSA verification of `plugin-session` JWTs (for plugins that expose a WebUI)

## Quickstart

```typescript
import { definePlugin, definePluginCommand } from '@karyl-chan/plugin-sdk';
import { randomUUID } from 'node:crypto';

export default function buildPlugin() {
  return definePlugin({
    key: 'karyl-example',
    name: 'Karyl Example',
    version: '0.1.0',
    description: 'Pure-logic example commands.',
    rpcMethodsUsed: ['interactions.respond'],
    storage: { guildKv: false },
    pluginCommands: [
      definePluginCommand({
        name: 'uuid',
        description: 'Generate a v4 UUID',
        scope: 'guild',
        integrationTypes: ['guild_install'],
        contexts: ['Guild', 'BotDM', 'PrivateChannel'],
        handler: async (_ctx) => '🔑 `' + randomUUID() + '`',
      }),
      definePluginCommand({
        name: 'passgen',
        description: 'Generate a strong random password',
        scope: 'guild',
        integrationTypes: ['guild_install'],
        contexts: ['Guild'],
        options: [
          { type: 'integer', name: 'length', description: 'Password length', required: false },
        ],
        handler: async (ctx) => ({ content: '🔒 …', ephemeral: true }),
      }),
    ],
  });
}

// index.ts
const started = await buildPlugin().start();
// Reads PORT, HOST, BOT_URL, PLUGIN_URL, KARYL_PLUGIN_SETUP_SECRET from env.
// Or pass overrides: await buildPlugin().start({ port: 3000, botUrl: 'http://…' });
```

`definePlugin` also takes `behaviors` (`defineBehavior`) and `capabilities`
(`definePluginCapability`); an `onReady(server)` hook lets you register extra
Fastify routes (e.g. a WebUI) before `listen()`.

## `start()` behaviour

1. Builds a Fastify instance (`logger: true`)
2. Mounts `GET /health`, the HMAC-verified `POST /commands/:name` (+ `…/autocomplete`) dispatch routes, and a route per declared behavior
3. Runs your `onReady(server)` hook, then `listen()`s on `PORT`/`HOST`
4. If `KARYL_PLUGIN_SETUP_SECRET` is set: builds the v2 manifest and starts the lifecycle client (register + heartbeat, exponential-backoff retry, auto re-register on 401)
5. Registers `SIGTERM`/`SIGINT` for graceful shutdown
6. Returns a `StartedPlugin` — `{ server, address(), stop(), botRpc(path, body), getSessionVerifyPublicKey() }` (the latter two are only meaningful after the first successful register)

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `HOST` | `0.0.0.0` | Listen host |
| `BOT_URL` | `http://karyl-chan:3000` | Bot base URL |
| `PLUGIN_URL` | `http://{key}:3000` | This plugin's URL (sent to the bot in the manifest; bot dispatches here). **Set this explicitly in production** — the default assumes the docker hostname equals `config.key`. |
| `KARYL_PLUGIN_SETUP_SECRET` | — | Per-plugin setup secret (admin pre-provisions it via `POST /api/plugins/setup-secret`). Absent → the plugin serves dispatch but never registers. |

## `CommandContext`

```typescript
interface CommandContext {
  pluginKey: string;                 // = manifest.plugin.id
  commandName: string;
  subCommandName: string | null;
  options: Record<string, unknown>;  // parsed { name: value }
  guildId: string | null;
  userId: string;
  log: Logger;
  botRpc(path: string, body?: unknown): Promise<unknown | null>;  // e.g. botRpc('/api/plugin/voice.play', {...})
}
```

A handler returns a `CommandReply`: a plain string (= `{ content }`) or
`{ content?, embeds?, components?, ephemeral? }`.

## WebUI plugins

If your plugin hands users a browser link, mint a `plugin-session` JWT via
`ctx.botRpc('/api/plugin/auth.session', { user_id, kind, guild_id? })` (needs the
`auth.session` RPC scope), put the token in the link, and on the WebUI side verify
it offline:

```typescript
import { verifyPluginSession, hasPluginCapability } from '@karyl-chan/plugin-sdk';

const claims = verifyPluginSession(token, getSessionVerifyPublicKey());  // → { userId, guildId, capabilities } | null
if (!claims) return reply.code(401).send();
if (!hasPluginCapability(claims.capabilities, pluginKey, 'webui.access')) return reply.code(403).send();
```

`getSessionVerifyPublicKey()` (from `StartedPlugin`, or `client.getSessionVerifyPublicKey()`)
returns the bot's Ed25519 public key — the bot signs these tokens with the matching
private key, which never leaves it, so a compromised plugin can verify but not forge.
The bot re-sends the key on every heartbeat, so a key rotation propagates within ~30 s.

## Protocol alignment

- HMAC: bot dual-signs **v0** (`v0:<ts>:<body>`) **and v1** (`v1:<METHOD>:<path>:<ts>:<body>`); the SDK verifies inbound dispatch with v1 when present (method+path bound), else v0. Replay window ±300 s.
- Manifest `schema_version: '2'` — commands (three-axis: scope / integration types / contexts), behaviors, guild features, capabilities.
- Dispatch: `POST /commands/{name}` (+ `/commands/{name}/autocomplete`); the plugin completes a deferred reply via `POST ${BOT_URL}/api/plugin/interactions.respond`.
- The `defineCommand` / `PluginConfig` v1 names are deprecated stubs kept only so old v1 plugin builds still import; calling `defineCommand()` throws. Use `definePluginCommand` + `definePlugin`.

## Docker

Each plugin ships its own Dockerfile (e.g. the monorepo's `Dockerfile.radio`)
that builds the SDK and the plugin in one multi-stage context. The bot's
`karyl-chan-net` external network must exist first (bring the bot up before the plugins).
