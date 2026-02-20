import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";

const data = new SlashCommandBuilder()
  .setName("reset")
  .setDescription("Kill process and clear session ID for a fresh start");

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const topicId = interaction.channelId;
  const project = ctx.sessions.getProjectByTopicId(topicId);

  if (!project) {
    await interaction.reply({ content: "This channel is not a registered project topic.", ephemeral: true });
    return;
  }

  ctx.pool.kill(topicId);
  ctx.sessions.updateSession(topicId, "", 0);
  ctx.sessions.setStatus(topicId, "idle");

  await interaction.reply("Session reset. Next message will start a fresh Claude session.");
}

export const resetCommand: Command = { data, execute };
