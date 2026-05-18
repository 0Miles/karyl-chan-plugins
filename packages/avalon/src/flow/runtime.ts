/**
 * Shared runtime handles for the flow files. Set once at startup by
 * `index.ts` via `wireRuntime`; everywhere else reads `runtime()` to
 * call the bot RPC or log. Splitting this out avoids threading
 * `started` (the SDK's `StartedPlugin`) through every command /
 * component handler signature.
 *
 * `runtime()` throws if accessed before `wireRuntime` — which only
 * matters if you import a flow file at module-init time and try to
 * call out to the bot synchronously. The slash + component handler
 * paths run after start, so they're safe.
 */

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export type BotRpc = (
  path: string,
  body?: unknown,
) => Promise<unknown | null>;

interface Runtime {
  botRpc: BotRpc;
  log: Logger;
  /**
   * Browser-reachable base URL for this plugin's HTTP surface
   * (e.g. `https://bot.example.com/plugin/karyl-avalon`). Discord
   * embed thumbnails / images use this — the bot needs a public URL
   * it can fetch from, not the internal http://karyl-avalon-plugin:3000.
   */
  publicBaseUrl(): string;
}

let active: Runtime | null = null;

export function wireRuntime(r: Runtime): void {
  active = r;
}

export function runtime(): Runtime {
  if (!active) {
    throw new Error("avalon runtime not wired yet — call wireRuntime first");
  }
  return active;
}
