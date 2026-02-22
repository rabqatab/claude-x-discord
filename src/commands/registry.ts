import { REST, Routes, type ChatInputCommandInteraction, type AutocompleteInteraction, SlashCommandBuilder } from "discord.js";

export interface Command {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction, ctx: CommandContext) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction, ctx: CommandContext) => Promise<void>;
}

export interface CommandContext {
  sessions: import("../db/sessions.js").SessionsDB;
  memory: import("../db/memory.js").MemoryDB;
  pool: import("../claude/pool.js").ClaudePool;
  forum: import("../discord/forum.js").ForumManager;
  config: import("../config/schema.js").Config;
  debateContext: Map<string, string>;
}

export class CommandRegistry {
  private commands = new Map<string, Command>();

  register(command: Command): void {
    this.commands.set(command.data.name, command);
  }

  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  async deployToGuild(token: string, clientId: string, guildId: string): Promise<void> {
    const rest = new REST({ version: "10" }).setToken(token);
    const body = [...this.commands.values()].map((c) => c.data.toJSON());
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  }

  list(): Command[] {
    return [...this.commands.values()];
  }
}
