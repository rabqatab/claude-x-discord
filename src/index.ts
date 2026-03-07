import { loadConfig, loadEnv } from "./config/index.js";
import { SessionManager } from "./session-manager.js";
import { WebChatServer } from "./web/server.js";
import { initFileLogging } from "./utils/logger.js";

const NODE_MAJOR_MIN = 22;

async function main() {
  const major = parseInt(process.versions.node.split(".")[0], 10);
  if (major < NODE_MAJOR_MIN) {
    console.error(
      `Node.js v${process.versions.node} detected. Requires >=v${NODE_MAJOR_MIN}. ` +
      `Run: nvm use ${NODE_MAJOR_MIN}`
    );
    process.exit(1);
  }

  const env = loadEnv();
  const config = loadConfig();

  initFileLogging(config.machine_name);
  console.log(`claude-x-discord starting... [${config.machine_name}] node=${process.versions.node}`);

  const manager = new SessionManager(config, env);

  // Start web chat server
  const webServer = new WebChatServer(manager.claudePool, manager.sessionsDB, config);
  manager.webServer = webServer;
  await webServer.start();

  process.on("SIGINT", async () => {
    console.log("Shutting down...");
    await webServer.stop();
    await manager.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await webServer.stop();
    await manager.stop();
    process.exit(0);
  });

  await manager.start();
  console.log("claude-x-discord running");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
