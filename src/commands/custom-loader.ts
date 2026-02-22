import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Command } from "./registry.js";

const CUSTOM_COMMANDS_DIR = resolve(
  process.env.CLAUDE_X_DISCORD_HOME || process.cwd(),
  "commands"
);

export async function loadCustomCommands(): Promise<Command[]> {
  if (!existsSync(CUSTOM_COMMANDS_DIR)) {
    return [];
  }

  const files = readdirSync(CUSTOM_COMMANDS_DIR).filter(
    (f) => f.endsWith(".js") && f !== "index.js" && f !== "index.ts"
  );

  const commands: Command[] = [];

  for (const file of files) {
    try {
      const filePath = resolve(CUSTOM_COMMANDS_DIR, file);
      const fileUrl = pathToFileURL(filePath).href;
      const mod = await import(fileUrl);
      const command = mod.default ?? mod.command;
      if (command?.data && command?.execute) {
        commands.push(command as Command);
      } else {
        console.warn(`Custom command ${file}: missing data or execute export`);
      }
    } catch (err) {
      console.error(`Failed to load custom command ${file}:`, err);
    }
  }

  return commands;
}
