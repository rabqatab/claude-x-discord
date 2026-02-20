import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";

const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Stop the Claude process for the current topic");

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  const topicId = interaction.channelId;
  const project = ctx.sessions.getProjectByTopicId(topicId);

  if (!project) {
    await interaction.reply({ content: "This channel is not a registered project topic.", ephemeral: true });
    return;
  }

  const proc = ctx.pool.get(topicId);
  if (!proc || !proc.isAlive) {
    await interaction.reply({ content: "No active process for this topic.", ephemeral: true });
    return;
  }

  ctx.pool.kill(topicId);
  ctx.sessions.setStatus(topicId, "idle");

  await interaction.reply("Stopped the Claude process for this topic.");
}

export const stopCommand: Command = { data, execute };
