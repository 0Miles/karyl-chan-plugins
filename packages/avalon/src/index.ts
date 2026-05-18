import { buildPlugin } from "./plugin.js";
import { wireRuntime } from "./flow/dispatcher.js";

const started = await buildPlugin().start();
// Hand the live bot RPC + logger into the component dispatcher — the
// individual flow files share them via a single module-level handle so
// they don't all have to thread `started` through every call site.
wireRuntime({
  botRpc: started.botRpc,
  log: {
    info: (msg, meta) => started.server.log.info(meta ?? {}, msg),
    warn: (msg, meta) => started.server.log.warn(meta ?? {}, msg),
    error: (msg, meta) => started.server.log.error(meta ?? {}, msg),
  },
});
