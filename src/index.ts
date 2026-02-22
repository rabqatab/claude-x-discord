import { loadConfig, loadEnv } from "./config/index.js";
import { SessionManager } from "./session-manager.js";

async function main() {
  const env = loadEnv();
  const config = loadConfig();

  console.log(`claude-x-discord starting... [${config.machine_name}]`);

  const manager = new SessionManager(config, env);

  process.on("SIGINT", async () => {
    console.log("Shutting down...");
    await manager.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
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
