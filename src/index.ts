import { loadConfig, loadEnv } from "./config/index.js";

async function main() {
  const env = loadEnv();
  const config = loadConfig();
  console.log("claude-x-discord starting...");
  console.log(`Guild: ${config.discord.guild_id}`);
  console.log(`Max processes: ${config.claude.max_processes}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
