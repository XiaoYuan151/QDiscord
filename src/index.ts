import { loadConfig } from "./config.js";
import { QDiscordBridge } from "./bridge.js";
import { HealthServer } from "./health.js";
import { createLogger } from "./logger.js";

const config = loadConfig();
const logger = createLogger(config.logLevel);
const bridge = new QDiscordBridge(config, logger);
const healthServer = new HealthServer({
  enabled: config.healthEnabled,
  host: config.healthHost,
  port: config.healthPort,
  getStatus: () => bridge.getStatus(),
  logger
});

await healthServer.start();
await bridge.start();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info("Received shutdown signal", { signal });
    void shutdown(0);
  });
}

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", {
    error: reason instanceof Error ? reason : new Error(String(reason))
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { error });
  void shutdown(1);
});

let shuttingDown = false;

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  try {
    await healthServer.stop();
    await bridge.stop();
  } catch (error) {
    logger.error("Shutdown failed", { error });
  } finally {
    process.exit(exitCode);
  }
}
