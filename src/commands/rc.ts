import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { type Command, type CommandContext } from "./registry.js";

const data = new SlashCommandBuilder()
  .setName("rc")
  .setDescription("Get a web chat URL for this project");

async function execute(interaction: ChatInputCommandInteraction, ctx: CommandContext): Promise<void> {
  if (!ctx.webServer) {
    await interaction.reply({ content: "Web chat is not enabled.", ephemeral: true });
    return;
  }

  const topicId = interaction.channelId;
  const project = ctx.sessions.getProjectByTopicId(topicId);
  if (!project) {
    await interaction.reply({ content: "No project registered in this topic.", ephemeral: true });
    return;
  }

  const token = ctx.webServer.createToken(topicId, interaction.user.id);
  const baseUrl = ctx.webServer.getUrl();
  const url = `${baseUrl}?token=${token}`;
  const ttl = ctx.config.web.token_ttl;
  const minutes = Math.floor(ttl / 60);

  await interaction.reply({
    content: `**Web Chat** for **${project.project_name}**\n${url}\n\n_Link expires in ${minutes} minute${minutes !== 1 ? "s" : ""}._`,
    ephemeral: true,
  });
}

export const rcCommand: Command = { data, execute };
