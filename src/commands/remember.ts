import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";

const data = new SlashCommandBuilder()
  .setName("remember")
  .setDescription("Store something in memory with full confidence")
  .addStringOption((opt) =>
    opt.setName("content").setDescription("What to remember").setRequired(true)
  ) as SlashCommandBuilder;

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const content = interaction.options.getString("content", true);

  ctx.memory.remember(content);

  await interaction.reply(`Remembered: "${content}"`);
}

export const rememberCommand: Command = { data, execute };
