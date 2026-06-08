import { loadConfig } from "./config.js";
import { QDiscordBridge } from "./bridge.js";

const bridge = new QDiscordBridge(loadConfig());

await bridge.start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`Received ${signal}, shutting down`);
    bridge.stop();
    process.exit(0);
  });
}
