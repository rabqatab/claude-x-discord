import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { config as loadDotenv } from "dotenv";
import { configSchema, envSchema, type Config, type Env } from "./schema.js";

const CONFIG_DIR = resolve(
  process.env.CLAUDE_X_DISCORD_HOME || `${process.env.HOME}/.claude-x-discord`
);

export function loadEnv(): Env {
  const envPath = resolve(CONFIG_DIR, ".env");
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }
  return envSchema.parse(process.env);
}

export function loadConfig(): Config {
  const configPath = resolve(CONFIG_DIR, "config.yaml");
  if (!existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }
  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseYaml(raw);
  return configSchema.parse(parsed);
}

export { CONFIG_DIR };
